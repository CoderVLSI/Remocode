import { v } from 'convex/values';

import { internalMutation } from './_generated/server';

const DAY = 24 * 60 * 60 * 1000;
export const TASK_RETENTION_MS = 30 * DAY;
const BATCH = 50;

/**
 * Daily cleanup (see crons.ts): expired pairing codes, old pairing failures, and finished tasks
 * older than 30 days along with their output. Bounded per run so it stays within Convex limits.
 */
export const purge = internalMutation({
  // `retentionMs` exists so tests can exercise the age cut-off; the daily cron uses the default.
  args: { retentionMs: v.optional(v.number()) },
  handler: async (ctx, { retentionMs }) => {
    const now = Date.now();
    const retention = retentionMs ?? TASK_RETENTION_MS;

    const expired = await ctx.db
      .query('pairingCodes')
      .withIndex('by_expiresAt', (q) => q.lt('expiresAt', now))
      .take(BATCH);
    for (const row of expired) await ctx.db.delete(row._id);

    const failures = await ctx.db
      .query('pairingFailures')
      .withIndex('by_at', (q) => q.lt('at', now - 60 * 60 * 1000))
      .take(BATCH);
    for (const row of failures) await ctx.db.delete(row._id);

    // Tasks are ordered by creation time, so the oldest come first.
    const oldTasks = await ctx.db
      .query('tasks')
      .order('asc')
      .filter((q) => q.lt(q.field('_creationTime'), now - retention))
      .take(BATCH);
    let tasksRemoved = 0;
    for (const task of oldTasks) {
      if (task.status === 'queued' || task.status === 'running') continue;
      const events = await ctx.db
        .query('taskEvents')
        .withIndex('by_task', (q) => q.eq('taskId', task._id))
        .take(500);
      for (const e of events) await ctx.db.delete(e._id);
      await ctx.db.delete(task._id);
      tasksRemoved += 1;
    }
    return { codes: expired.length, failures: failures.length, tasks: tasksRemoved };
  },
});
