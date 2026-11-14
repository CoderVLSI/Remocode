import { formatCountdown, isFinal, isOnline, ONLINE_WINDOW_MS, statusLabel, toSegments } from '../model';
import type { RemoteEvent, TaskStatus } from '../model';

const ev = (kind: RemoteEvent['kind'], data: string) => ({ kind, data });

describe('isOnline', () => {
  const now = Date.parse('2026-11-14T12:00:00Z');
  it('is online within the heartbeat window and offline after it', () => {
    expect(isOnline({ lastSeenAt: now - 10_000 }, now)).toBe(true);
    expect(isOnline({ lastSeenAt: now - ONLINE_WINDOW_MS }, now)).toBe(true);
    expect(isOnline({ lastSeenAt: now - ONLINE_WINDOW_MS - 1 }, now)).toBe(false);
  });
  it('treats a missing or non-numeric timestamp as offline', () => {
    expect(isOnline({ lastSeenAt: NaN }, now)).toBe(false);
    expect(isOnline({ lastSeenAt: undefined as unknown as number }, now)).toBe(false);
  });
});

describe('task status', () => {
  it.each<[TaskStatus, boolean]>([
    ['queued', false],
    ['running', false],
    ['done', true],
    ['failed', true],
    ['cancelled', true],
  ])('%s final=%s', (status, final) => {
    expect(isFinal(status)).toBe(final);
    expect(statusLabel(status)).toBeTruthy();
  });
});

describe('toSegments', () => {
  it('joins consecutive same-kind output and keeps info separate', () => {
    expect(toSegments([ev('stdout', 'he'), ev('stdout', 'llo'), ev('stderr', 'warn'), ev('info', ' Cancelled '), ev('stdout', 'x')])).toEqual([
      { kind: 'stdout', text: 'hello' },
      { kind: 'stderr', text: 'warn' },
      { kind: 'info', text: '\n# Cancelled\n' },
      { kind: 'stdout', text: 'x' },
    ]);
  });
  it('is empty for no output', () => {
    expect(toSegments([])).toEqual([]);
  });
});

describe('formatCountdown', () => {
  it.each([
    [600_000, '10:00'],
    [581_000, '9:41'],
    [61_000, '1:01'],
    [999, '0:01'],
    [0, '0:00'],
    [-5000, '0:00'],
  ])('%d ms -> %s', (ms, expected) => {
    expect(formatCountdown(ms)).toBe(expected);
  });
});
