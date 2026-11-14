import { v } from 'convex/values';

import { mutation, query } from './_generated/server';
import { requireUser } from './lib';

/** The signed-in user's computers. The phone decides online/offline from `lastSeenAt`. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const devices = await ctx.db
      .query('devices')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect();
    // Never send the token hash to the client.
    return devices
      .map((d) => ({ _id: d._id, name: d.name, platform: d.platform ?? null, lastSeenAt: d.lastSeenAt }))
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  },
});

/** Removes a computer, its tasks and their output. The computer's token stops working immediately. */
export const remove = mutation({
  args: { deviceId: v.id('devices') },
  handler: async (ctx, { deviceId }) => {
    const userId = await requireUser(ctx);
    const device = await ctx.db.get(deviceId);
    if (!device || device.userId !== userId) return; // nothing to remove (or not yours): same answer
    const tasks = await ctx.db
      .query('tasks')
      .withIndex('by_device', (q) => q.eq('deviceId', deviceId))
      .take(200);
    for (const task of tasks) {
      const events = await ctx.db
        .query('taskEvents')
        .withIndex('by_task', (q) => q.eq('taskId', task._id))
        .take(500);
      for (const e of events) await ctx.db.delete(e._id);
      await ctx.db.delete(task._id);
    }
    await ctx.db.delete(deviceId);
  },
});
