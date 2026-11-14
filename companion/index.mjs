#!/usr/bin/env node
// Remocode companion: runs tasks sent from the phone app on this computer.
//
//   node index.mjs login    sign in with the same email you use in the app
//   node index.mjs run      register this computer and start taking tasks
//   node index.mjs status   show who is signed in
//   node index.mjs logout   forget the session and device id
//
// Config (environment variables, or the project's .env):
//   REMOCODE_SUPABASE_URL / REMOCODE_SUPABASE_ANON_KEY   (or EXPO_PUBLIC_SUPABASE_*)
//   REMOCODE_AGENT_CMD      executable to run             default: claude
//   REMOCODE_AGENT_ARGS     JSON array, with "{prompt}"   default: ["-p","--output-format","text","--","{prompt}"]
//   REMOCODE_WORKDIR        working directory for tasks   default: current directory
//   REMOCODE_TIMEOUT_MIN    kill a task after N minutes   default: 30
//   REMOCODE_DEVICE_NAME    name shown in the app         default: hostname

import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, hostname, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';

import { buildArgs, createBatcher, DEFAULT_AGENT_CMD, parseArgsEnv, parseDotenv } from './src/lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = join(homedir(), '.remocode');
const SESSION_FILE = join(STATE_DIR, 'session.json');
const DEVICE_FILE = join(STATE_DIR, 'device.json');

const HEARTBEAT_MS = 15_000;
const POLL_MS = 3_000;
const CANCEL_POLL_MS = 2_000;

// ---------- config ----------

function loadEnv() {
  const env = { ...process.env };
  for (const file of [join(process.cwd(), '.env'), join(HERE, '..', '.env')]) {
    if (existsSync(file)) {
      for (const [k, v] of Object.entries(parseDotenv(readFileSync(file, 'utf8')))) env[k] ??= v;
    }
  }
  return env;
}

const env = loadEnv();
const SUPABASE_URL = env.REMOCODE_SUPABASE_URL ?? env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = env.REMOCODE_SUPABASE_ANON_KEY ?? env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

function fail(message) {
  console.error(`remocode: ${message}`);
  process.exit(1);
}

// ---------- local state (session lives in a 0600 file under ~/.remocode) ----------

function ensureStateDir() {
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writePrivate(file, data) {
  ensureStateDir();
  writeFileSync(file, JSON.stringify(data), { mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    // Windows: permissions are inherited from the user profile directory.
  }
}

/** Storage adapter so supabase-js persists and refreshes the session on disk. */
const fileStorage = {
  getItem: (key) => (readJson(SESSION_FILE) ?? {})[key] ?? null,
  setItem: (key, value) => writePrivate(SESSION_FILE, { ...(readJson(SESSION_FILE) ?? {}), [key]: value }),
  removeItem: (key) => {
    const data = readJson(SESSION_FILE) ?? {};
    delete data[key];
    writePrivate(SESSION_FILE, data);
  },
};

function client() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    fail('Supabase is not configured. Set REMOCODE_SUPABASE_URL and REMOCODE_SUPABASE_ANON_KEY (or run from the project folder that has a .env).');
  }
  return createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { storage: fileStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
}

// ---------- commands ----------

async function login() {
  const supabase = client();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const email = (await rl.question('Email (the one you use in the app): ')).trim().toLowerCase();
    // shouldCreateUser:false so a typo never silently creates a stray account.
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
    if (error) fail(error.message.includes('Signups not allowed') ? 'No account with that email. Sign up in the app first.' : error.message);
    const token = (await rl.question('Code from the email: ')).replace(/\D/g, '');
    const { data, error: verifyError } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
    if (verifyError) fail(verifyError.message);
    console.log(`Signed in as ${data.user?.email}. Now run: node index.mjs run`);
  } finally {
    rl.close();
  }
}

function logout() {
  rmSync(SESSION_FILE, { force: true });
  rmSync(DEVICE_FILE, { force: true });
  console.log('Signed out. The computer stays listed in the app until you remove it there.');
}

async function status() {
  const supabase = client();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return console.log('Not signed in. Run: node index.mjs login');
  const device = readJson(DEVICE_FILE);
  console.log(`Signed in as ${data.user.email}${device ? `, device ${device.id}` : ''}`);
}

async function registerDevice(supabase) {
  const name = env.REMOCODE_DEVICE_NAME || hostname();
  const saved = readJson(DEVICE_FILE);
  if (saved?.id) {
    const { data } = await supabase
      .from('devices')
      .update({ name, platform: platform(), last_seen_at: new Date().toISOString() })
      .eq('id', saved.id)
      .select('id')
      .maybeSingle();
    if (data) return saved.id;
  }
  const { data, error } = await supabase.from('devices').insert({ name, platform: platform() }).select('id').single();
  if (error) fail(`Could not register this computer: ${error.message}`);
  writePrivate(DEVICE_FILE, { id: data.id });
  return data.id;
}

async function run() {
  const supabase = client();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) fail('Not signed in. Run: node index.mjs login');

  const cmd = env.REMOCODE_AGENT_CMD || DEFAULT_AGENT_CMD;
  let template;
  try {
    template = parseArgsEnv(env.REMOCODE_AGENT_ARGS);
  } catch (err) {
    fail(err.message);
  }
  const cwd = resolve(env.REMOCODE_WORKDIR || process.cwd());
  if (!existsSync(cwd)) fail(`REMOCODE_WORKDIR does not exist: ${cwd}`);
  const timeoutMs = Math.max(1, Number(env.REMOCODE_TIMEOUT_MIN) || 30) * 60_000;

  const deviceId = await registerDevice(supabase);
  console.log(`Remocode companion online as ${auth.user.email}`);
  console.log(`  agent:   ${cmd} ${template.join(' ')}`);
  console.log(`  folder:  ${cwd}`);
  console.log('  Waiting for tasks from your phone. Press Ctrl+C to stop.');

  const heartbeat = setInterval(() => {
    supabase.from('devices').update({ last_seen_at: new Date().toISOString() }).eq('id', deviceId).then(({ error }) => {
      if (error) console.warn(`heartbeat failed: ${error.message}`);
    });
  }, HEARTBEAT_MS);

  let current = null; // { taskId, child }
  let stopping = false;

  const shutdown = async (signal) => {
    if (stopping) return;
    stopping = true;
    console.log(`\n${signal}: shutting down…`);
    clearInterval(heartbeat);
    if (current) {
      current.child.kill('SIGTERM');
      await supabase
        .from('remote_tasks')
        .update({ status: 'failed', finished_at: new Date().toISOString() })
        .eq('id', current.taskId)
        .eq('status', 'running');
    }
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  async function claimNext() {
    const { data: queued, error } = await supabase
      .from('remote_tasks')
      .select('id,prompt')
      .eq('device_id', deviceId)
      .eq('status', 'queued')
      .order('created_at', { ascending: true })
      .limit(1);
    if (error) {
      console.warn(`poll failed: ${error.message}`);
      return null;
    }
    if (!queued?.length) return null;
    // Conditional update makes claiming atomic if two companions ever share a device id.
    const { data: claimed } = await supabase
      .from('remote_tasks')
      .update({ status: 'running', started_at: new Date().toISOString() })
      .eq('id', queued[0].id)
      .eq('status', 'queued')
      .select('id,prompt');
    return claimed?.[0] ?? null;
  }

  async function runTask(task) {
    console.log(`▶ task ${task.id.slice(0, 8)}: ${task.prompt.slice(0, 80).replace(/\s+/g, ' ')}`);

    const rows = [];
    let writing = Promise.resolve();
    const send = (kind, data) => {
      rows.push({ task_id: task.id, kind, data });
      // Serialise inserts so event ids (and therefore display order) match output order.
      writing = writing.then(async () => {
        const batch = rows.splice(0, rows.length);
        if (!batch.length) return;
        const { error } = await supabase.from('remote_events').insert(batch);
        if (error) console.warn(`could not send output: ${error.message}`);
      });
    };
    const batcher = createBatcher({ onFlush: send });
    send('info', `Running ${cmd} in ${cwd}`);

    let finished = false;
    const finish = async (status, exitCode, note) => {
      if (finished) return;
      finished = true;
      clearInterval(cancelTimer);
      clearTimeout(timeoutTimer);
      batcher.flush();
      if (note) send('info', note);
      await writing;
      // Conditional on 'running' so a cancellation made from the phone is never overwritten.
      await supabase
        .from('remote_tasks')
        .update({ status, exit_code: exitCode, finished_at: new Date().toISOString() })
        .eq('id', task.id)
        .eq('status', 'running');
      current = null;
      console.log(`■ task ${task.id.slice(0, 8)} ${status}${exitCode !== null ? ` (exit ${exitCode})` : ''}`);
    };

    let child;
    try {
      // argv array + shell:false: the prompt is data, never shell syntax.
      child = spawn(cmd, buildArgs(template, task.prompt), { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
    } catch (err) {
      return finish('failed', null, `Could not start ${cmd}: ${err.message}`);
    }
    current = { taskId: task.id, child };

    child.stdout.setEncoding('utf8').on('data', (d) => batcher.push('stdout', d));
    child.stderr.setEncoding('utf8').on('data', (d) => batcher.push('stderr', d));

    const terminate = () => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5_000).unref();
    };
    const cancelTimer = setInterval(async () => {
      const { data } = await supabase.from('remote_tasks').select('status').eq('id', task.id).maybeSingle();
      if (data?.status === 'cancelled') {
        send('info', 'Cancelled from the phone.');
        terminate();
      }
    }, CANCEL_POLL_MS);
    const timeoutTimer = setTimeout(() => {
      send('info', `Timed out after ${Math.round(timeoutMs / 60_000)} minutes.`);
      terminate();
    }, timeoutMs);

    await new Promise((done) => {
      child.on('error', async (err) => {
        await finish('failed', null, err.code === 'ENOENT' ? `Command not found: ${cmd}. Set REMOCODE_AGENT_CMD.` : `Process error: ${err.message}`);
        done();
      });
      child.on('close', async (code, signal) => {
        await finish(code === 0 ? 'done' : 'failed', code, signal ? `Stopped by ${signal}.` : undefined);
        done();
      });
    });
  }

  // One task at a time: simple, and keeps the agent from racing itself in one working folder.
  while (!stopping) {
    try {
      const task = await claimNext();
      if (task) await runTask(task);
      else await new Promise((r) => setTimeout(r, POLL_MS));
    } catch (err) {
      console.warn(`error: ${err.message}`);
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }
}

const command = process.argv[2];
switch (command) {
  case 'login':
    await login();
    break;
  case 'run':
    await run();
    break;
  case 'status':
    await status();
    break;
  case 'logout':
    logout();
    break;
  default:
    console.log('Usage: node index.mjs <login | run | status | logout>');
    process.exit(command ? 1 : 0);
}
