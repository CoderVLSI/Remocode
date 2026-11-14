#!/usr/bin/env node
// Remo Code companion: runs tasks sent from the phone app on this computer.
//
//   node index.mjs pair     pair this computer using the code shown in the app
//   node index.mjs run      take tasks from your phone (keep this running)
//   node index.mjs status   show what this computer is paired with
//   node index.mjs logout   unpair this computer and forget the device token
//
// Config (environment variables, or the project's .env):
//   REMOCODE_CONVEX_URL     your deployment URL (asked for when pairing; saved afterwards)
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

import { ConvexClient, ConvexHttpClient } from 'convex/browser';
import { anyApi } from 'convex/server';

import { buildArgs, createBatcher, DEFAULT_AGENT_CMD, normalizeConvexUrl, parseArgsEnv, parseDotenv, Signal } from './src/lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = join(homedir(), '.remocode');
const DEVICE_FILE = join(STATE_DIR, 'device.json');
const HEARTBEAT_MS = 15_000;
const IDLE_RECHECK_MS = 60_000;

// Function references by name; no code generation needed in the companion.
const api = anyApi;

// ---------- config and local state ----------

function loadEnv() {
  const env = { ...process.env };
  for (const file of [join(process.cwd(), '.env'), join(HERE, '..', '.env')]) {
    if (existsSync(file)) for (const [k, v] of Object.entries(parseDotenv(readFileSync(file, 'utf8')))) env[k] ??= v;
  }
  return env;
}
const env = loadEnv();

function fail(message) {
  console.error(`remocode: ${message}`);
  process.exit(1);
}

function readDevice() {
  try {
    return JSON.parse(readFileSync(DEVICE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

/** The device token is a credential: keep it in a file only this user can read. */
function writeDevice(data) {
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(DEVICE_FILE, JSON.stringify(data), { mode: 0o600 });
  try {
    chmodSync(DEVICE_FILE, 0o600);
  } catch {
    // Windows: permissions are inherited from the user profile directory.
  }
}

function requireDevice() {
  const device = readDevice();
  if (!device?.token || !device?.url) fail('This computer is not paired. Run: node index.mjs pair');
  return device;
}

/** Convex wraps server errors in a prefix; show the useful part. */
function clean(err) {
  return String(err?.data ?? err?.message ?? err)
    .replace(/^\[CONVEX [^\]]*\]\s*(\[Request ID: [^\]]*\]\s*)?(Server Error\s*)?/i, '')
    .replace(/^Uncaught (Convex)?Error:\s*/i, '')
    .split('\n')[0];
}

// ---------- commands ----------

async function pair() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    let url;
    const fromEnv = env.REMOCODE_CONVEX_URL ?? env.EXPO_PUBLIC_CONVEX_URL;
    for (;;) {
      try {
        url = normalizeConvexUrl(fromEnv ?? (await rl.question('Convex deployment URL (the one you entered in the app): ')));
        break;
      } catch (err) {
        if (fromEnv) fail(err.message);
        console.log(err.message);
      }
    }
    const code = await rl.question('Pairing code from the app (Remote Control → Pair a computer): ');
    const name = env.REMOCODE_DEVICE_NAME || hostname();
    const client = new ConvexHttpClient(url);
    let result;
    try {
      result = await client.action(api.pairing.redeem, { code, name, platform: platform() });
    } catch (err) {
      fail(clean(err));
    }
    writeDevice({ url, token: result.token, deviceId: result.deviceId, name });
    console.log(`Paired as “${name}”. Now run: node index.mjs run`);
  } finally {
    rl.close();
  }
}

async function status() {
  const device = readDevice();
  if (!device) return console.log('Not paired. Run: node index.mjs pair');
  const client = new ConvexHttpClient(device.url);
  try {
    await client.mutation(api.companion.heartbeat, { token: device.token });
    console.log(`Paired as “${device.name}” on ${new URL(device.url).host}. The backend accepted this computer.`);
  } catch (err) {
    console.log(`Paired as “${device.name}” on ${new URL(device.url).host}, but: ${clean(err)}`);
  }
}

async function logout() {
  const device = readDevice();
  if (device) {
    try {
      await new ConvexHttpClient(device.url).mutation(api.companion.unpair, { token: device.token });
      console.log('Removed this computer from your account.');
    } catch (err) {
      console.log(`Could not tell the backend (${clean(err)}). You can remove it from the app instead.`);
    }
  }
  rmSync(DEVICE_FILE, { force: true });
  console.log('Forgot the local device token.');
}

async function run() {
  const device = requireDevice();
  const { token } = device;

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

  const client = new ConvexClient(device.url);
  const name = env.REMOCODE_DEVICE_NAME || device.name;

  try {
    await client.mutation(api.companion.heartbeat, { token, name });
    const stale = await client.mutation(api.companion.failStale, { token });
    if (stale) console.log(`Marked ${stale} unfinished task(s) from a previous run as failed.`);
  } catch (err) {
    client.close();
    fail(clean(err));
  }

  console.log(`Remo Code companion online as “${name}”`);
  console.log(`  agent:   ${cmd} ${template.join(' ')}`);
  console.log(`  folder:  ${cwd}`);
  console.log('  Waiting for tasks from your phone. Press Ctrl+C to stop.');

  const heartbeat = setInterval(() => {
    client.mutation(api.companion.heartbeat, { token }).catch((e) => console.warn(`heartbeat failed: ${clean(e)}`));
  }, HEARTBEAT_MS);

  // Told the moment a task is queued; no polling while idle.
  const work = new Signal();
  const stopWatching = client.onUpdate(api.companion.queuedCount, { token }, (n) => n > 0 && work.notify(), (e) => console.warn(`watch error: ${clean(e)}`));

  let current = null; // { taskId, child }
  let stopping = false;

  const shutdown = async (signal) => {
    if (stopping) return;
    stopping = true;
    console.log(`\n${signal}: shutting down…`);
    clearInterval(heartbeat);
    stopWatching();
    if (current) {
      current.child.kill('SIGTERM');
      await client.mutation(api.companion.finish, { token, taskId: current.taskId, status: 'failed' }).catch(() => {});
    }
    await client.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  async function runTask(task) {
    console.log(`▶ task ${String(task.id).slice(0, 8)}: ${task.prompt.slice(0, 80).replace(/\s+/g, ' ')}`);

    // Serialise writes so output order is preserved.
    let writing = Promise.resolve();
    const send = (kind, data) => {
      writing = writing.then(() =>
        client.mutation(api.companion.appendEvents, { token, taskId: task.id, events: [{ kind, data }] }).catch((e) => console.warn(`could not send output: ${clean(e)}`)),
      );
    };
    const batcher = createBatcher({ onFlush: send });
    send('info', `Running ${cmd} in ${cwd}`);

    let finished = false;
    let stopCancelWatch = () => {};
    let timeoutTimer;
    const finish = async (status, exitCode, note) => {
      if (finished) return;
      finished = true;
      stopCancelWatch();
      clearTimeout(timeoutTimer);
      batcher.flush();
      if (note) send('info', note);
      await writing;
      // The backend only lets a running task finish, so a cancel from the phone is never overwritten.
      await client.mutation(api.companion.finish, { token, taskId: task.id, status, exitCode: exitCode ?? undefined }).catch((e) => console.warn(`could not finish: ${clean(e)}`));
      current = null;
      console.log(`■ task ${String(task.id).slice(0, 8)} ${status}${exitCode !== null && exitCode !== undefined ? ` (exit ${exitCode})` : ''}`);
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
    // Instant cancel: the backend pushes the new status the moment the phone cancels.
    let cancelled = false;
    stopCancelWatch = client.onUpdate(api.companion.taskStatus, { token, taskId: task.id }, (status) => {
      if (status === 'cancelled' && !cancelled) {
        cancelled = true;
        send('info', 'Cancelled from the phone.');
        terminate();
      }
    }, () => {});
    timeoutTimer = setTimeout(() => {
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
      const task = await client.mutation(api.companion.claimNext, { token });
      if (task) await runTask(task);
      else await work.wait(IDLE_RECHECK_MS);
    } catch (err) {
      console.warn(`error: ${clean(err)}`);
      await new Promise((r) => setTimeout(r, 3_000));
    }
  }
}

const command = process.argv[2];
switch (command) {
  case 'pair':
    await pair();
    break;
  case 'run':
    await run();
    break;
  case 'status':
    await status();
    break;
  case 'logout':
    await logout();
    break;
  default:
    console.log('Usage: node index.mjs <pair | run | status | logout>');
    process.exit(command ? 1 : 0);
}
