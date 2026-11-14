import { isFinal, isOnline, lastEventId, mergeEvents, ONLINE_WINDOW_MS, statusLabel, toSegments } from '../model';
import type { RemoteEvent, TaskStatus } from '../model';

const ev = (id: number, kind: RemoteEvent['kind'], data: string): RemoteEvent => ({
  id,
  task_id: 't',
  kind,
  data,
  created_at: '2026-01-01T00:00:00Z',
});

describe('isOnline', () => {
  const now = Date.parse('2026-11-14T12:00:00Z');
  it('is online within the heartbeat window and offline after it', () => {
    expect(isOnline({ last_seen_at: new Date(now - 10_000).toISOString() }, now)).toBe(true);
    expect(isOnline({ last_seen_at: new Date(now - ONLINE_WINDOW_MS).toISOString() }, now)).toBe(true);
    expect(isOnline({ last_seen_at: new Date(now - ONLINE_WINDOW_MS - 1).toISOString() }, now)).toBe(false);
  });
  it('treats an unparseable timestamp as offline', () => {
    expect(isOnline({ last_seen_at: 'garbage' }, now)).toBe(false);
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

describe('mergeEvents', () => {
  it('dedupes realtime/polling overlap and orders by id', () => {
    const a = [ev(1, 'stdout', 'a'), ev(2, 'stdout', 'b')];
    const merged = mergeEvents(a, [ev(3, 'stdout', 'c'), ev(2, 'stdout', 'b'), ev(1, 'stdout', 'a')]);
    expect(merged.map((e) => e.id)).toEqual([1, 2, 3]);
  });
  it('handles out-of-order arrival', () => {
    expect(mergeEvents([ev(5, 'stdout', 'e')], [ev(3, 'stdout', 'c')]).map((e) => e.id)).toEqual([3, 5]);
  });
  it('returns the same array when nothing is added (no needless re-render)', () => {
    const a = [ev(1, 'stdout', 'a')];
    expect(mergeEvents(a, [])).toBe(a);
  });
  it('lastEventId is 0 for empty', () => {
    expect(lastEventId([])).toBe(0);
    expect(lastEventId([ev(1, 'stdout', ''), ev(9, 'stdout', '')])).toBe(9);
  });
});

describe('toSegments', () => {
  it('joins consecutive same-kind output and keeps info separate', () => {
    const out = toSegments([ev(1, 'stdout', 'he'), ev(2, 'stdout', 'llo'), ev(3, 'stderr', 'warn'), ev(4, 'info', ' Cancelled '), ev(5, 'stdout', 'x')]);
    expect(out).toEqual([
      { kind: 'stdout', text: 'hello' },
      { kind: 'stderr', text: 'warn' },
      { kind: 'info', text: '\n# Cancelled\n' },
      { kind: 'stdout', text: 'x' },
    ]);
  });
});
