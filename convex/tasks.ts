import { ConvexError, v } from 'convex/values';

import type { Id } from './_generated/dataModel';
import type { QueryCtx } from './_generated/server';
import { mutation, query } from './_generated/server';
import { MAX_PROMPT_CHARS, MAX_QUEUED_PER_DEVICE, requireUser } from './lib';

/** Loads a task only if it belongs to the signed-in user; anything else looks like "not found". */
async function ownTask(ctx: QueryCtx, taskId: Id<'tasks'>, userId: Id<'users'>) {
  const task = await ctx.db.get(taskId);
  return task && task.userId === userId ? task : null;
}

const publicTask = (t: {
  _id: Id<'tasks'>;
  deviceId: Id<'devices'>;
  prompt: string;
  status: string;
  exitCode?: number;
  startedAt?: number;
  finishedAt?: number;
  _creationTime: number;
}) => ({
  _id: t._id,
  deviceId: t.deviceId,
  prompt: t.prompt,
  status: t.status,
  exitCode: t.exitCode ?? null,
  startedAt: t.startedAt ?? null,
  finishedAt: t.finishedAt ?? null,
  createdAt: t._creationTime,
});

export const create = mutation({
  args: { deviceId: v.id('devices'), prompt: v.string() },
  handler: async (ctx, { deviceId, prompt }) => {
    const userId = await requireUser(ctx);
    const device = await ctx.db.get(deviceId);
    if (!device || device.userId !== userId) throw new ConvexError('That computer was not found.');
    const text = prompt.trim();
    if (!text) throw new ConvexError('Enter a task first.');
    if (text.length > MAX_PROMPT_CHARS) throw new ConvexError(`The task is too long (limit ${MAX_PROMPT_CHARS} characters).`);

    const queued = await ctx.db
      .query('tasks')
      .withIndex('by_device_status', (q) => q.eq('deviceId', deviceId).eq('status', 'queued'))
      .take(MAX_QUEUED_PER_DEVICE);
    if (queued.length >= MAX_QUEUED_PER_DEVICE) {
      throw new ConvexError('Too many tasks are waiting for this computer. Wait for them or cancel some.');
    }
    return await ctx.db.insert('tasks', { userId, deviceId, prompt: text, status: 'queued' });
  },
});

/** Newest first. */
export const list = query({
  args: { deviceId: v.id('devices'), limit: v.optional(v.number()) },
  handler: async (ctx, { deviceId, limit }) => {
    const userId = await requireUser(ctx);
    const device = await ctx.db.get(deviceId);
    if (!device || device.userId !== userId) return [];
    const rows = await ctx.db
      .query('tasks')
      .withIndex('by_device', (q) => q.eq('deviceId', deviceId))
      .order('desc')
      .take(Math.min(Math.max(limit ?? 20, 1), 50));
    return rows.map(publicTask);
  },
});

export const get = query({
  args: { taskId: v.id('tasks') },
  handler: async (ctx, { taskId }) => {
    const userId = await requireUser(ctx);
    const task = await ownTask(ctx, taskId, userId);
    return task ? publicTask(task) : null;
  },
});

/** Output in order. Reactive: the phone re-renders as the computer appends. */
export const events = query({
  args: { taskId: v.id('tasks') },
  handler: async (ctx, { taskId }) => {
    const userId = await requireUser(ctx);
    if (!(await ownTask(ctx, taskId, userId))) return [];
    const rows = await ctx.db
      .query('taskEvents')
      .withIndex('by_task', (q) => q.eq('taskId', taskId))
      .order('asc')
      .take(400);
    return rows.map((e) => ({ _id: e._id, kind: e.kind, data: e.data }));
  },
});

/** Only tasks that have not finished can be cancelled. */
export const cancel = mutation({
  args: { taskId: v.id('tasks') },
  handler: async (ctx, { taskId }) => {
    const userId = await requireUser(ctx);
    const task = await ownTask(ctx, taskId, userId);
    if (!task || (task.status !== 'queued' && task.status !== 'running')) return;
    await ctx.db.patch(taskId, { status: 'cancelled', finishedAt: Date.now() });
  },
});
