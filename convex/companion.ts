import { ConvexError, v } from 'convex/values';

import type { Doc } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { mutation, query } from './_generated/server';
import { MAX_EVENT_CHARS, MAX_EVENTS_PER_TASK, sha256Hex } from './lib';
import { eventKind } from './schema';

/**
 * Everything the companion on a computer may do. It authenticates with the device token it got
 * when pairing (only a hash is stored) and can only ever touch that device's own tasks.
 */
async function deviceFor(ctx: QueryCtx | MutationCtx, token: string): Promise<Doc<'devices'>> {
  const tokenHash = await sha256Hex(token);
  const device = await ctx.db
    .query('devices')
    .withIndex('by_tokenHash', (q) => q.eq('tokenHash', tokenHash))
    .unique();
  if (!device) throw new ConvexError('This computer is not paired (or was removed). Pair it again.');
  return device;
}

async function taskOf(ctx: QueryCtx | MutationCtx, device: Doc<'devices'>, taskId: Doc<'tasks'>['_id']) {
  const task = await ctx.db.get(taskId);
  // A task from another device looks exactly like a missing one.
  if (!task || task.deviceId !== device._id) throw new ConvexError('No such task for this computer.');
  return task;
}

/** Called every ~15s; the phone shows the computer as online while this is recent. */
export const heartbeat = mutation({
  args: { token: v.string(), name: v.optional(v.string()) },
  handler: async (ctx, { token, name }) => {
    const device = await deviceFor(ctx, token);
    const patch: Partial<Doc<'devices'>> = { lastSeenAt: Date.now() };
    if (name && name.trim()) patch.name = name.trim().slice(0, 80);
    await ctx.db.patch(device._id, patch);
    return { name: patch.name ?? device.name };
  },
});

/** After a crash or restart, anything still marked running can never finish: fail it. */
export const failStale = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const device = await deviceFor(ctx, token);
    const stale = await ctx.db
      .query('tasks')
      .withIndex('by_device_status', (q) => q.eq('deviceId', device._id).eq('status', 'running'))
      .take(50);
    for (const task of stale) {
      await ctx.db.patch(task._id, { status: 'failed', finishedAt: Date.now() });
      await ctx.db.insert('taskEvents', { taskId: task._id, kind: 'info', data: 'The companion restarted before this task finished.' });
    }
    return stale.length;
  },
});

/** Takes the oldest queued task (atomic: two callers can never get the same one). */
export const claimNext = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const device = await deviceFor(ctx, token);
    const next = await ctx.db
      .query('tasks')
      .withIndex('by_device_status', (q) => q.eq('deviceId', device._id).eq('status', 'queued'))
      .order('asc')
      .first();
    if (!next) return null;
    await ctx.db.patch(next._id, { status: 'running', startedAt: Date.now() });
    return { id: next._id, prompt: next.prompt };
  },
});

export const appendEvents = mutation({
  args: {
    token: v.string(),
    taskId: v.id('tasks'),
    events: v.array(v.object({ kind: eventKind, data: v.string() })),
  },
  handler: async (ctx, { token, taskId, events }) => {
    const device = await deviceFor(ctx, token);
    await taskOf(ctx, device, taskId);
    if (events.length === 0) return;

    // Cap total output per task so one runaway process cannot fill the database.
    const existing = await ctx.db
      .query('taskEvents')
      .withIndex('by_task', (q) => q.eq('taskId', taskId))
      .take(MAX_EVENTS_PER_TASK);
    const room = MAX_EVENTS_PER_TASK - existing.length;
    for (const e of events.slice(0, Math.max(room, 0))) {
      await ctx.db.insert('taskEvents', { taskId, kind: e.kind, data: e.data.slice(0, MAX_EVENT_CHARS) });
    }
  },
});

/** The companion polls this while a task runs, to notice a cancel from the phone. */
export const taskStatus = query({
  args: { token: v.string(), taskId: v.id('tasks') },
  handler: async (ctx, { token, taskId }) => {
    const device = await deviceFor(ctx, token);
    return (await taskOf(ctx, device, taskId)).status;
  },
});

/** Only a running task can finish, so a cancel made from the phone is never overwritten. */
export const finish = mutation({
  args: {
    token: v.string(),
    taskId: v.id('tasks'),
    status: v.union(v.literal('done'), v.literal('failed')),
    exitCode: v.optional(v.number()),
  },
  handler: async (ctx, { token, taskId, status, exitCode }) => {
    const device = await deviceFor(ctx, token);
    const task = await taskOf(ctx, device, taskId);
    if (task.status === 'running') {
      await ctx.db.patch(taskId, { status, exitCode, finishedAt: Date.now() });
    } else if (task.status === 'cancelled') {
      await ctx.db.patch(taskId, { exitCode });
    }
  },
});

/**
 * How many tasks are waiting. The companion subscribes to this, so it is told the moment work
 * arrives and does not have to poll (which would waste function calls while idle).
 */
export const queuedCount = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const device = await deviceFor(ctx, token);
    const queued = await ctx.db
      .query('tasks')
      .withIndex('by_device_status', (q) => q.eq('deviceId', device._id).eq('status', 'queued'))
      .take(11);
    return queued.length;
  },
});

/** The computer removes itself (its history is deleted and the token stops working). */
export const unpair = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const device = await deviceFor(ctx, token);
    const tasks = await ctx.db
      .query('tasks')
      .withIndex('by_device', (q) => q.eq('deviceId', device._id))
      .take(200);
    for (const task of tasks) {
      const events = await ctx.db
        .query('taskEvents')
        .withIndex('by_task', (q) => q.eq('taskId', task._id))
        .take(500);
      for (const e of events) await ctx.db.delete(e._id);
      await ctx.db.delete(task._id);
    }
    await ctx.db.delete(device._id);
  },
});
