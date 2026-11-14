#!/usr/bin/env node
// End-to-end check of your deployed backend:  node scripts/convex-selftest.mjs <deployment url>
//
// It signs in, pairs a pretend computer with a real pairing code, runs a task through the real
// companion with a harmless stand-in agent, reads the output back as the phone would, and cleans up.
//
// Needs an account. Either let it create a throwaway one (works while email codes are NOT set up),
// or use yours:  SELFTEST_EMAIL=you@example.com SELFTEST_PASSWORD=... node scripts/convex-selftest.mjs <url>
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ConvexHttpClient } from 'convex/browser';
import { anyApi as api } from 'convex/server';

const url = process.argv[2];
if (!url) {
  console.error('Usage: node scripts/convex-selftest.mjs https://your-name-123.convex.cloud');
  process.exit(1);
}

const companionDir = fileURLToPath(new URL('../companion/', import.meta.url));
if (!existsSync(join(companionDir, 'node_modules'))) {
  console.error('Install the companion first:  cd companion && npm install');
  process.exit(1);
}

const steps = [];
const ok = (name, detail = '') => {
  steps.push(name);
  console.log(`  ✓ ${name}${detail ? ` (${detail})` : ''}`);
};
const die = (name, err) => {
  console.error(`\n  ✗ ${name}\n    ${String(err?.data ?? err?.message ?? err).split('\n')[0]}`);
  console.error(hint(name));
  process.exit(1);
};
const hint = (name) => {
  if (/sign in|sign-in|account/i.test(name)) {
    return '    Hint: run `node scripts/convex-setup.mjs` once (it creates the auth keys), and check `npx convex logs` for the real error.';
  }
  return '    Hint: `npx convex logs` shows the server-side error for the last call.';
};
const step = async (name, fn) => {
  try {
    return await fn();
  } catch (err) {
    die(name, err);
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log(`Checking ${url}\n`);
const phone = new ConvexHttpClient(url);

// 1. Auth: the part nothing else can verify without a deployment.
const email = process.env.SELFTEST_EMAIL ?? `selftest-${Date.now()}@example.invalid`;
const password = process.env.SELFTEST_PASSWORD ?? `st-${Math.random().toString(36).slice(2)}-${Date.now()}`;
const flow = process.env.SELFTEST_EMAIL ? 'signIn' : 'signUp';
const auth = await step(`${flow === 'signUp' ? 'create a throwaway account' : 'sign in'} (auth works)`, () =>
  phone.action('auth:signIn', { provider: 'password', params: { email, password, flow } }),
);
if (!auth.tokens) {
  die(
    'sign in',
    new Error('The backend wants an email code first (AUTH_RESEND_KEY is set). Re-run with SELFTEST_EMAIL / SELFTEST_PASSWORD of an existing account.'),
  );
}
phone.setAuth(auth.tokens.token);
ok('signed in with a valid session token');

const me = await step('read who is signed in', () => phone.query(api.users.me, {}));
if (me?.email?.toLowerCase() !== email.toLowerCase()) die('read who is signed in', new Error(`expected ${email}, got ${me?.email}`));
ok('the backend recognises the session', me.email);

// 2. Pairing
const { code } = await step('make a pairing code', () => phone.action(api.pairing.create, {}));
ok('pairing code created', code);

// 3. Companion pairs (non-interactively) and runs a task with a stand-in agent.
const home = mkdtempSync(join(tmpdir(), 'remocode-selftest-'));
const childEnv = {
  ...process.env,
  HOME: home,
  USERPROFILE: home,
  REMOCODE_DEVICE_NAME: 'selftest-computer',
  REMOCODE_AGENT_CMD: process.execPath,
  REMOCODE_AGENT_ARGS: JSON.stringify(['-e', 'console.log("selftest-output:" + process.argv[1])', '{prompt}']),
  REMOCODE_WORKDIR: home,
};
const run = (args, input) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, ['index.mjs', ...args], { cwd: companionDir, env: childEnv, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    if (input) child.stdin.end(input);
    child.on('close', (status) => resolve({ status, out }));
  });

const paired = await run(['pair'], `${url}\n${code}\n`);
if (paired.status !== 0) die('pair the companion', new Error(paired.out.trim().split('\n').pop()));
ok('companion paired with the code');

const devices = await step('list devices', () => phone.query(api.devices.list, {}));
const device = devices.find((d) => d.name === 'selftest-computer');
if (!device) die('list devices', new Error('the paired computer is missing from the list'));
ok('the paired computer shows up in the app’s list');

const companion = spawn(process.execPath, ['index.mjs', 'run'], { cwd: companionDir, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
let companionLog = '';
companion.stdout.on('data', (d) => (companionLog += d));
companion.stderr.on('data', (d) => (companionLog += d));

try {
  await sleep(2500); // let it connect and subscribe
  const taskId = await step('queue a task from the phone', () => phone.mutation(api.tasks.create, { deviceId: device._id, prompt: 'hello from the selftest' }));
  ok('task queued');

  let task;
  for (let i = 0; i < 40; i++) {
    task = await phone.query(api.tasks.get, { taskId });
    if (task && ['done', 'failed', 'cancelled'].includes(task.status)) break;
    await sleep(1000);
  }
  if (task?.status !== 'done') {
    die('the companion runs the task', new Error(`status ended as "${task?.status}". Companion log:\n${companionLog.trim().split('\n').slice(-6).join('\n')}`));
  }
  ok('the companion ran the task and reported success', `exit ${task.exitCode}`);

  const events = await phone.query(api.tasks.events, { taskId });
  const text = events.map((e) => e.data).join('');
  if (!text.includes('selftest-output:hello from the selftest')) die('read the output', new Error(`output was: ${JSON.stringify(text.slice(0, 200))}`));
  ok('the phone can read the task output back');
} finally {
  companion.kill('SIGTERM');
  await run(['logout']); // removes the pretend computer and its history
  rmSync(home, { recursive: true, force: true });
}

const left = await phone.query(api.devices.list, {});
if (left.some((d) => d.name === 'selftest-computer')) die('clean up', new Error('the pretend computer is still listed'));
ok('cleaned up the pretend computer');

console.log(`\nAll ${steps.length} checks passed. Your backend is ready.`);
if (!process.env.SELFTEST_EMAIL) console.log(`(A throwaway account ${email} was created; delete it from the Convex dashboard's "users" table if you like.)`);
