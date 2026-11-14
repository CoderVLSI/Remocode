import { getAuthUserId } from '@convex-dev/auth/server';
import type { Auth } from 'convex/server';
import { ConvexError } from 'convex/values';

import type { Id } from './_generated/dataModel';

/** A computer counts as online if its heartbeat is newer than this (the companion beats every 15s). */
export const ONLINE_WINDOW_MS = 45_000;
export const MAX_PROMPT_CHARS = 20_000;
export const MAX_QUEUED_PER_DEVICE = 10;
export const PAIRING_TTL_MS = 10 * 60 * 1000;
/** After this many wrong pairing attempts in a minute, pairing is paused (stops code guessing). */
export const PAIRING_MAX_FAILURES_PER_MINUTE = 20;
export const MAX_EVENT_CHARS = 65_536;
export const MAX_EVENTS_PER_TASK = 2_000;

/** The signed-in user, or a clear error. Works in queries, mutations and actions. */
export async function requireUser(ctx: { auth: Auth }): Promise<Id<'users'>> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new ConvexError('Not signed in.');
  return userId;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Uniformly random string from `alphabet` (alphabet length must divide 256 to avoid bias). Use in actions. */
export function randomString(length: number, alphabet: string): string {
  if (256 % alphabet.length !== 0) throw new Error('alphabet length must divide 256');
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

/** Crockford base32: 32 distinct symbols (so no modulo bias) and no I, L, O or U to confuse with 1, 0 or V. */
export const PAIRING_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const TOKEN_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Uppercases, drops separators, and maps the look-alikes people mistype (O->0, I/L->1). */
export function normalizePairingCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

export const PAIRING_CODE_LENGTH = 8;

export function formatPairingCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export function cleanDeviceName(name: string): string {
  const trimmed = name.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 80);
  return trimmed || 'My computer';
}
