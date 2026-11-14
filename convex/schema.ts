import { authTables } from '@convex-dev/auth/server';
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export const taskStatus = v.union(
  v.literal('queued'),
  v.literal('running'),
  v.literal('done'),
  v.literal('failed'),
  v.literal('cancelled'),
);

export const eventKind = v.union(v.literal('stdout'), v.literal('stderr'), v.literal('info'));

export default defineSchema({
  // users, sessions, accounts and verification codes (managed by Convex Auth)
  ...authTables,

  // A computer running the companion. The device token itself is never stored, only its hash.
  devices: defineTable({
    userId: v.id('users'),
    name: v.string(),
    platform: v.optional(v.string()),
    lastSeenAt: v.number(),
    tokenHash: v.string(),
  })
    .index('by_user', ['userId'])
    .index('by_tokenHash', ['tokenHash']),

  // One-time codes the phone shows so a computer can pair. Only the hash is stored.
  pairingCodes: defineTable({
    userId: v.id('users'),
    codeHash: v.string(),
    expiresAt: v.number(),
  })
    .index('by_codeHash', ['codeHash'])
    .index('by_user', ['userId'])
    .index('by_expiresAt', ['expiresAt']),

  // Wrong pairing attempts, used to throttle guessing.
  pairingFailures: defineTable({ at: v.number() }).index('by_at', ['at']),

  tasks: defineTable({
    userId: v.id('users'),
    deviceId: v.id('devices'),
    prompt: v.string(),
    status: taskStatus,
    exitCode: v.optional(v.number()),
    startedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
  })
    .index('by_device', ['deviceId'])
    .index('by_device_status', ['deviceId', 'status'])
    .index('by_user', ['userId']),

  taskEvents: defineTable({
    taskId: v.id('tasks'),
    kind: eventKind,
    data: v.string(),
  }).index('by_task', ['taskId']),
});
