/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { api, internal } from '../convex/_generated/api';
import schema from '../convex/schema';

// Load every backend module except the auth wiring, which needs a real deployment (keys, HTTP routes).
const all = import.meta.glob('../convex/**/*.{ts,js}');
const modules = Object.fromEntries(
  Object.entries(all).filter(([path]) => !/\.d\.ts$|\/auth\.ts$|\/auth\.config\.ts$|\/http\.ts$/.test(path)),
);

async function setup() {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert('users', { email: 'me@example.com' }));
  const otherId = await t.run((ctx) => ctx.db.insert('users', { email: 'other@example.com' }));
  // Convex Auth identities carry "<userId>|<sessionId>" as the subject.
  const me = t.withIdentity({ subject: `${userId}|s1` });
  const other = t.withIdentity({ subject: `${otherId}|s2` });
  return { t, me, other, userId, otherId };
}

type Ctx = Awaited<ReturnType<typeof setup>>;

/** Pairs a computer the way the real flow does: the phone makes a code, the computer redeems it. */
async function pair({ t, me }: Ctx, name = 'Work laptop') {
  const { code } = await me.action(api.pairing.create, {});
  const { token, deviceId } = await t.action(api.pairing.redeem, { code, name, platform: 'linux' });
  return { token, deviceId, code };
}

describe('pairing', () => {
  it('lets a computer pair with the code shown on the phone and shows up in the device list', async () => {
    const ctx = await setup();
    const { code, token, deviceId } = await pair(ctx);
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(token.length).toBe(48);
    const devices = await ctx.me.query(api.devices.list, {});
    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({ _id: deviceId, name: 'Work laptop', platform: 'linux' });
    expect(Object.keys(devices[0])).not.toContain('tokenHash'); // never sent to clients
    // the stored device keeps a hash, not the token
    const row = await ctx.t.run((c) => c.db.get(deviceId));
    expect(row?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.tokenHash).not.toContain(token);
  });

  it('accepts the code typed in lower case, with look-alikes, or without the dash', async () => {
    const ctx = await setup();
    const { code } = await ctx.me.action(api.pairing.create, {});
    const typed = code.toLowerCase().replace('-', ' ').replace(/0/g, 'o').replace(/1/g, 'l');
    const result = await ctx.t.action(api.pairing.redeem, { code: typed, name: 'Mac' });
    expect(result.token).toBeTruthy();
  });

  it('works only once', async () => {
    const ctx = await setup();
    const { code } = await pair(ctx);
    await expect(ctx.t.action(api.pairing.redeem, { code, name: 'Second' })).rejects.toThrow(/wrong or has expired/);
  });

  it('a new code replaces the previous one', async () => {
    const ctx = await setup();
    const first = await ctx.me.action(api.pairing.create, {});
    await ctx.me.action(api.pairing.create, {});
    await expect(ctx.t.action(api.pairing.redeem, { code: first.code, name: 'x' })).rejects.toThrow(/wrong or has expired/);
  });

  it('rejects an expired code', async () => {
    const ctx = await setup();
    const { code } = await ctx.me.action(api.pairing.create, {});
    await ctx.t.run(async (c) => {
      for (const row of await c.db.query('pairingCodes').collect()) await c.db.patch(row._id, { expiresAt: Date.now() - 1 });
    });
    await expect(ctx.t.action(api.pairing.redeem, { code, name: 'x' })).rejects.toThrow(/wrong or has expired/);
  });

  it('needs a signed-in phone to create a code', async () => {
    const { t } = await setup();
    await expect(t.action(api.pairing.create, {})).rejects.toThrow(/Not signed in/);
  });

  it('throttles guessing: after 20 wrong codes even the right one is refused for a minute', async () => {
    const ctx = await setup();
    const { code } = await ctx.me.action(api.pairing.create, {});
    for (let i = 0; i < 20; i++) {
      await expect(ctx.t.action(api.pairing.redeem, { code: `ZZZZ${String(1000 + i).slice(0, 4)}`.replace(/[^0-9A-Z]/g, 'Z'), name: 'x' })).rejects.toThrow();
    }
    await expect(ctx.t.action(api.pairing.redeem, { code, name: 'x' })).rejects.toThrow(/Too many wrong codes/);
  });

  it('cleans up control characters and overlong names', async () => {
    const ctx = await setup();
    const { code } = await ctx.me.action(api.pairing.create, {});
    const { deviceId } = await ctx.t.action(api.pairing.redeem, { code, name: `  Bad\u0000Name${'x'.repeat(200)}  ` });
    const row = await ctx.t.run((c) => c.db.get(deviceId as never));
    expect((row as { name: string }).name.length).toBeLessThanOrEqual(80);
    expect((row as { name: string }).name).not.toContain('\u0000');
  });
});

describe('tasks (phone side)', () => {
  it('creates, lists, gets and cancels a task for your own computer', async () => {
    const ctx = await setup();
    const { deviceId } = await pair(ctx);
    const taskId = await ctx.me.mutation(api.tasks.create, { deviceId, prompt: '  add a login page  ' });
    const list = await ctx.me.query(api.tasks.list, { deviceId });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ _id: taskId, prompt: 'add a login page', status: 'queued', exitCode: null });
    expect((await ctx.me.query(api.tasks.get, { taskId }))?.status).toBe('queued');

    await ctx.me.mutation(api.tasks.cancel, { taskId });
    const after = await ctx.me.query(api.tasks.get, { taskId });
    expect(after?.status).toBe('cancelled');
    expect(after?.finishedAt).not.toBeNull();
  });

  it('lists newest first', async () => {
    const ctx = await setup();
    const { deviceId } = await pair(ctx);
    await ctx.me.mutation(api.tasks.create, { deviceId, prompt: 'first' });
    await ctx.me.mutation(api.tasks.create, { deviceId, prompt: 'second' });
    expect((await ctx.me.query(api.tasks.list, { deviceId })).map((t) => t.prompt)).toEqual(['second', 'first']);
  });

  it('validates the prompt and limits the queue', async () => {
    const ctx = await setup();
    const { deviceId } = await pair(ctx);
    await expect(ctx.me.mutation(api.tasks.create, { deviceId, prompt: '   ' })).rejects.toThrow(/Enter a task/);
    await expect(ctx.me.mutation(api.tasks.create, { deviceId, prompt: 'x'.repeat(20_001) })).rejects.toThrow(/too long/);
    for (let i = 0; i < 10; i++) await ctx.me.mutation(api.tasks.create, { deviceId, prompt: `t${i}` });
    await expect(ctx.me.mutation(api.tasks.create, { deviceId, prompt: 'one too many' })).rejects.toThrow(/Too many tasks/);
  });

  it("never lets another user touch your computer or your tasks", async () => {
    const ctx = await setup();
    const { deviceId } = await pair(ctx);
    const taskId = await ctx.me.mutation(api.tasks.create, { deviceId, prompt: 'private' });

    await expect(ctx.other.mutation(api.tasks.create, { deviceId, prompt: 'hijack' })).rejects.toThrow(/not found/);
    expect(await ctx.other.query(api.tasks.list, { deviceId })).toEqual([]);
    expect(await ctx.other.query(api.tasks.get, { taskId })).toBeNull();
    expect(await ctx.other.query(api.tasks.events, { taskId })).toEqual([]);
    await ctx.other.mutation(api.tasks.cancel, { taskId }); // silently ignored
    expect((await ctx.me.query(api.tasks.get, { taskId }))?.status).toBe('queued');
    expect(await ctx.other.query(api.devices.list, {})).toEqual([]);
    await ctx.other.mutation(api.devices.remove, { deviceId });
    expect(await ctx.me.query(api.devices.list, {})).toHaveLength(1);
  });

  it('requires sign-in for every phone-side function', async () => {
    const { t } = await setup();
    await expect(t.query(api.devices.list, {})).rejects.toThrow(/Not signed in/);
    await expect(t.query(api.tasks.get, { taskId: 'x' as never })).rejects.toThrow();
  });
});

describe('companion (computer side)', () => {
  it('runs a task end to end: claim, stream output, finish', async () => {
    const ctx = await setup();
    const { token, deviceId } = await pair(ctx);
    const taskId = await ctx.me.mutation(api.tasks.create, { deviceId, prompt: 'build it' });

    const claimed = await ctx.t.mutation(api.companion.claimNext, { token });
    expect(claimed).toEqual({ id: taskId, prompt: 'build it' });
    expect(await ctx.t.mutation(api.companion.claimNext, { token })).toBeNull(); // nothing else queued
    expect((await ctx.me.query(api.tasks.get, { taskId }))?.status).toBe('running');

    await ctx.t.mutation(api.companion.appendEvents, { token, taskId, events: [{ kind: 'info', data: 'Running' }, { kind: 'stdout', data: 'hello ' }] });
    await ctx.t.mutation(api.companion.appendEvents, { token, taskId, events: [{ kind: 'stdout', data: 'world' }] });
    expect((await ctx.me.query(api.tasks.events, { taskId })).map((e) => `${e.kind}:${e.data}`)).toEqual(['info:Running', 'stdout:hello ', 'stdout:world']);

    await ctx.t.mutation(api.companion.finish, { token, taskId, status: 'done', exitCode: 0 });
    const done = await ctx.me.query(api.tasks.get, { taskId });
    expect(done).toMatchObject({ status: 'done', exitCode: 0 });
    expect(done?.finishedAt).not.toBeNull();
  });

  it('hands out queued tasks oldest first, one at a time', async () => {
    const ctx = await setup();
    const { token, deviceId } = await pair(ctx);
    const a = await ctx.me.mutation(api.tasks.create, { deviceId, prompt: 'a' });
    const b = await ctx.me.mutation(api.tasks.create, { deviceId, prompt: 'b' });
    expect((await ctx.t.mutation(api.companion.claimNext, { token }))?.id).toBe(a);
    expect((await ctx.t.mutation(api.companion.claimNext, { token }))?.id).toBe(b);
  });

  it('a cancel from the phone is visible to the companion and is never overwritten by finish', async () => {
    const ctx = await setup();
    const { token, deviceId } = await pair(ctx);
    const taskId = await ctx.me.mutation(api.tasks.create, { deviceId, prompt: 'long job' });
    await ctx.t.mutation(api.companion.claimNext, { token });
    await ctx.me.mutation(api.tasks.cancel, { taskId });
    expect(await ctx.t.query(api.companion.taskStatus, { token, taskId })).toBe('cancelled');
    await ctx.t.mutation(api.companion.finish, { token, taskId, status: 'failed', exitCode: 143 });
    const task = await ctx.me.query(api.tasks.get, { taskId });
    expect(task?.status).toBe('cancelled');
    expect(task?.exitCode).toBe(143);
  });

  it('rejects unknown tokens everywhere', async () => {
    const ctx = await setup();
    const { deviceId } = await pair(ctx);
    const taskId = await ctx.me.mutation(api.tasks.create, { deviceId, prompt: 'x' });
    const bad = { token: 'not-a-real-token' };
    await expect(ctx.t.mutation(api.companion.heartbeat, bad)).rejects.toThrow(/not paired/);
    await expect(ctx.t.mutation(api.companion.claimNext, bad)).rejects.toThrow(/not paired/);
    await expect(ctx.t.mutation(api.companion.appendEvents, { ...bad, taskId, events: [] })).rejects.toThrow(/not paired/);
    await expect(ctx.t.query(api.companion.taskStatus, { ...bad, taskId })).rejects.toThrow(/not paired/);
    await expect(ctx.t.mutation(api.companion.finish, { ...bad, taskId, status: 'done' })).rejects.toThrow(/not paired/);
  });

  it("one computer's token cannot read or write another computer's tasks", async () => {
    const ctx = await setup();
    const a = await pair(ctx, 'Laptop A');
    const b = await pair(ctx, 'Laptop B');
    const taskOnA = await ctx.me.mutation(api.tasks.create, { deviceId: a.deviceId, prompt: 'for A' });
    await ctx.t.mutation(api.companion.claimNext, { token: a.token });
    expect(await ctx.t.mutation(api.companion.claimNext, { token: b.token })).toBeNull();
    await expect(ctx.t.query(api.companion.taskStatus, { token: b.token, taskId: taskOnA })).rejects.toThrow(/No such task/);
    await expect(ctx.t.mutation(api.companion.appendEvents, { token: b.token, taskId: taskOnA, events: [{ kind: 'stdout', data: 'x' }] })).rejects.toThrow(/No such task/);
    await expect(ctx.t.mutation(api.companion.finish, { token: b.token, taskId: taskOnA, status: 'done' })).rejects.toThrow(/No such task/);
  });

  it('heartbeat marks the computer online and can rename it', async () => {
    const ctx = await setup();
    const { token, deviceId } = await pair(ctx);
    await ctx.t.run((c) => c.db.patch(deviceId as never, { lastSeenAt: 1 }));
    const result = await ctx.t.mutation(api.companion.heartbeat, { token, name: ' Renamed ' });
    expect(result.name).toBe('Renamed');
    const [device] = await ctx.me.query(api.devices.list, {});
    expect(device.lastSeenAt).toBeGreaterThan(Date.now() - 5000);
    expect(device.name).toBe('Renamed');
  });

  it('caps stored output per task and truncates oversized chunks', async () => {
    const ctx = await setup();
    const { token, deviceId } = await pair(ctx);
    const taskId = await ctx.me.mutation(api.tasks.create, { deviceId, prompt: 'noisy' });
    await ctx.t.mutation(api.companion.claimNext, { token });
    await ctx.t.mutation(api.companion.appendEvents, { token, taskId, events: [{ kind: 'stdout', data: 'y'.repeat(70_000) }] });
    const stored = await ctx.t.run((c) => c.db.query('taskEvents').collect());
    expect(stored[0].data.length).toBe(65_536);
    for (let i = 0; i < 25; i++) {
      await ctx.t.mutation(api.companion.appendEvents, { token, taskId, events: Array.from({ length: 100 }, () => ({ kind: 'stdout' as const, data: 'z' })) });
    }
    expect((await ctx.t.run((c) => c.db.query('taskEvents').collect())).length).toBe(2000);
  });

  it('fails tasks left running by a crashed companion', async () => {
    const ctx = await setup();
    const { token, deviceId } = await pair(ctx);
    const taskId = await ctx.me.mutation(api.tasks.create, { deviceId, prompt: 'was running' });
    await ctx.t.mutation(api.companion.claimNext, { token });
    expect(await ctx.t.mutation(api.companion.failStale, { token })).toBe(1);
    expect((await ctx.me.query(api.tasks.get, { taskId }))?.status).toBe('failed');
    expect((await ctx.me.query(api.tasks.events, { taskId })).some((e) => /restarted/.test(e.data))).toBe(true);
  });
});

describe('companion extras', () => {
  it('queuedCount reflects waiting tasks, so the companion can subscribe instead of polling', async () => {
    const ctx = await setup();
    const { token, deviceId } = await pair(ctx);
    expect(await ctx.t.query(api.companion.queuedCount, { token })).toBe(0);
    await ctx.me.mutation(api.tasks.create, { deviceId, prompt: 'a' });
    await ctx.me.mutation(api.tasks.create, { deviceId, prompt: 'b' });
    expect(await ctx.t.query(api.companion.queuedCount, { token })).toBe(2);
    await ctx.t.mutation(api.companion.claimNext, { token });
    expect(await ctx.t.query(api.companion.queuedCount, { token })).toBe(1);
    await expect(ctx.t.query(api.companion.queuedCount, { token: 'bogus' })).rejects.toThrow(/not paired/);
  });

  it('unpair removes the computer and its history and kills its own token', async () => {
    const ctx = await setup();
    const { token, deviceId } = await pair(ctx);
    const taskId = await ctx.me.mutation(api.tasks.create, { deviceId, prompt: 'x' });
    await ctx.t.mutation(api.companion.claimNext, { token });
    await ctx.t.mutation(api.companion.appendEvents, { token, taskId, events: [{ kind: 'stdout', data: 'out' }] });
    await ctx.t.mutation(api.companion.unpair, { token });
    expect(await ctx.me.query(api.devices.list, {})).toEqual([]);
    expect(await ctx.t.run((c) => c.db.query('tasks').collect())).toEqual([]);
    expect(await ctx.t.run((c) => c.db.query('taskEvents').collect())).toEqual([]);
    await expect(ctx.t.mutation(api.companion.heartbeat, { token })).rejects.toThrow(/not paired/);
  });
});

describe('who am I', () => {
  it('returns the signed-in user, and null when signed out', async () => {
    const ctx = await setup();
    expect(await ctx.me.query(api.users.me, {})).toMatchObject({ email: 'me@example.com' });
    expect(await ctx.t.query(api.users.me, {})).toBeNull();
  });
});

describe('removing a computer', () => {
  it('deletes its tasks and output, and its token stops working at once', async () => {
    const ctx = await setup();
    const { token, deviceId } = await pair(ctx);
    const taskId = await ctx.me.mutation(api.tasks.create, { deviceId, prompt: 'x' });
    await ctx.t.mutation(api.companion.claimNext, { token });
    await ctx.t.mutation(api.companion.appendEvents, { token, taskId, events: [{ kind: 'stdout', data: 'out' }] });

    await ctx.me.mutation(api.devices.remove, { deviceId });
    expect(await ctx.me.query(api.devices.list, {})).toEqual([]);
    expect(await ctx.t.run((c) => c.db.query('tasks').collect())).toEqual([]);
    expect(await ctx.t.run((c) => c.db.query('taskEvents').collect())).toEqual([]);
    await expect(ctx.t.mutation(api.companion.heartbeat, { token })).rejects.toThrow(/not paired/);
  });
});

describe('daily cleanup', () => {
  it('removes expired codes and stale failures but keeps live ones', async () => {
    const ctx = await setup();
    await ctx.t.run(async (c) => {
      const userId = (await c.db.query('users').first())!._id;
      await c.db.insert('pairingCodes', { userId, codeHash: 'expired', expiresAt: Date.now() - 1000 });
      await c.db.insert('pairingCodes', { userId: (await c.db.query('users').order('desc').first())!._id, codeHash: 'live', expiresAt: Date.now() + 60_000 });
      await c.db.insert('pairingFailures', { at: Date.now() - 2 * 60 * 60 * 1000 });
      await c.db.insert('pairingFailures', { at: Date.now() });
    });
    const result = await ctx.t.mutation(internal.maintenance.purge, {});
    expect(result).toMatchObject({ codes: 1, failures: 1 });
    expect((await ctx.t.run((c) => c.db.query('pairingCodes').collect())).map((r) => r.codeHash)).toEqual(['live']);
    expect(await ctx.t.run((c) => c.db.query('pairingFailures').collect())).toHaveLength(1);
  });

  it('purges old finished tasks with their output, and never touches queued or running ones', async () => {
    const ctx = await setup();
    const { deviceId } = await pair(ctx);
    const ids = await ctx.t.run(async (c) => {
      const userId = (await c.db.query('users').first())!._id;
      const mk = async (status: 'done' | 'failed' | 'cancelled' | 'queued' | 'running') => {
        const id = await c.db.insert('tasks', { userId, deviceId, prompt: status, status });
        await c.db.insert('taskEvents', { taskId: id, kind: 'stdout', data: status });
        return id;
      };
      return { done: await mk('done'), failed: await mk('failed'), cancelled: await mk('cancelled'), queued: await mk('queued'), running: await mk('running') };
    });
    // A negative retention makes every task "old", so this checks which statuses are protected.
    const result = await ctx.t.mutation(internal.maintenance.purge, { retentionMs: -1000 });
    expect(result.tasks).toBe(3);
    const left = await ctx.t.run((c) => c.db.query('tasks').collect());
    expect(left.map((t) => t.status).sort()).toEqual(['queued', 'running']);
    expect(left.map((t) => t._id).sort()).toEqual([ids.queued, ids.running].sort());
    // output of the deleted tasks went with them; output of the kept ones stays
    const events = await ctx.t.run((c) => c.db.query('taskEvents').collect());
    expect(events.map((e) => e.data).sort()).toEqual(['queued', 'running']);
  });

  it('keeps recent tasks under the default 30-day retention', async () => {
    const ctx = await setup();
    const { deviceId } = await pair(ctx);
    await ctx.t.run(async (c) => {
      const userId = (await c.db.query('users').first())!._id;
      await c.db.insert('tasks', { userId, deviceId, prompt: 'recent', status: 'done' });
    });
    expect((await ctx.t.mutation(internal.maintenance.purge, {})).tasks).toBe(0);
  });
});
