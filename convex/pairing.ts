import { ConvexError, v } from 'convex/values';

import { internal } from './_generated/api';
import { action, internalMutation } from './_generated/server';
import {
  PAIRING_ALPHABET,
  PAIRING_CODE_LENGTH,
  PAIRING_MAX_FAILURES_PER_MINUTE,
  PAIRING_TTL_MS,
  TOKEN_ALPHABET,
  cleanDeviceName,
  formatPairingCode,
  normalizePairingCode,
  randomString,
  requireUser,
  sha256Hex,
} from './lib';

/**
 * Phone side: makes a short one-time code to type on the computer. An action, because secure
 * randomness is only available there; only the code's hash is stored.
 */
export const create = action({
  args: {},
  handler: async (ctx): Promise<{ code: string; expiresAt: number }> => {
    const userId = await requireUser(ctx);
    const code = randomString(PAIRING_CODE_LENGTH, PAIRING_ALPHABET);
    const expiresAt = Date.now() + PAIRING_TTL_MS;
    await ctx.runMutation(internal.pairing.store, { userId, codeHash: await sha256Hex(code), expiresAt });
    return { code: formatPairingCode(code), expiresAt };
  },
});

export const store = internalMutation({
  args: { userId: v.id('users'), codeHash: v.string(), expiresAt: v.number() },
  handler: async (ctx, { userId, codeHash, expiresAt }) => {
    // One live code per user: asking for a new one invalidates the old one.
    const old = await ctx.db
      .query('pairingCodes')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .take(20);
    for (const row of old) await ctx.db.delete(row._id);
    await ctx.db.insert('pairingCodes', { userId, codeHash, expiresAt });
  },
});

/**
 * Computer side (no sign-in): trades a valid code for a long-lived device token. The code works
 * once and for ten minutes, and guessing is throttled across the whole deployment.
 */
export const redeem = action({
  args: { code: v.string(), name: v.string(), platform: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ token: string; deviceId: string }> => {
    const code = normalizePairingCode(args.code);
    const token = randomString(48, TOKEN_ALPHABET);
    const result = await ctx.runMutation(internal.pairing.consume, {
      codeHash: await sha256Hex(code),
      validFormat: code.length === PAIRING_CODE_LENGTH,
      tokenHash: await sha256Hex(token),
      name: cleanDeviceName(args.name),
      platform: args.platform?.slice(0, 40),
    });
    if (!result.ok) throw new ConvexError(result.error);
    return { token, deviceId: result.deviceId };
  },
});

export const consume = internalMutation({
  args: {
    codeHash: v.string(),
    validFormat: v.boolean(),
    tokenHash: v.string(),
    name: v.string(),
    platform: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ ok: true; deviceId: string } | { ok: false; error: string }> => {
    const now = Date.now();

    const recent = await ctx.db
      .query('pairingFailures')
      .withIndex('by_at', (q) => q.gte('at', now - 60_000))
      .take(PAIRING_MAX_FAILURES_PER_MINUTE + 1);
    if (recent.length >= PAIRING_MAX_FAILURES_PER_MINUTE) {
      return { ok: false, error: 'Too many wrong codes. Wait a minute and try again.' };
    }

    const row = args.validFormat
      ? await ctx.db
          .query('pairingCodes')
          .withIndex('by_codeHash', (q) => q.eq('codeHash', args.codeHash))
          .unique()
      : null;

    if (!row || row.expiresAt < now) {
      if (row) await ctx.db.delete(row._id); // expired
      await ctx.db.insert('pairingFailures', { at: now });
      return { ok: false, error: 'That code is wrong or has expired. Make a new one in the app.' };
    }

    await ctx.db.delete(row._id); // single use
    const deviceId = await ctx.db.insert('devices', {
      userId: row.userId,
      name: args.name,
      platform: args.platform,
      lastSeenAt: now,
      tokenHash: args.tokenHash,
    });
    return { ok: true, deviceId };
  },
});
