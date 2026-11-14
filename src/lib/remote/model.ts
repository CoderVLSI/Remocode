/** Remote Control data model and pure helpers (no native imports). */

export type TaskStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface Device {
  id: string;
  name: string;
  platform: string | null;
  last_seen_at: string;
}

export interface RemoteTask {
  id: string;
  device_id: string;
  prompt: string;
  status: TaskStatus;
  exit_code: number | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface RemoteEvent {
  id: number;
  task_id: string;
  kind: 'stdout' | 'stderr' | 'info';
  data: string;
  created_at: string;
}

/** The companion heartbeats every 15s; allow a couple of missed beats. */
export const ONLINE_WINDOW_MS = 45_000;

export function isOnline(device: Pick<Device, 'last_seen_at'>, now = Date.now()): boolean {
  const seen = Date.parse(device.last_seen_at);
  return Number.isFinite(seen) && now - seen <= ONLINE_WINDOW_MS;
}

export function isFinal(status: TaskStatus): boolean {
  return status === 'done' || status === 'failed' || status === 'cancelled';
}

export function statusLabel(status: TaskStatus): string {
  switch (status) {
    case 'queued':
      return 'Waiting for device';
    case 'running':
      return 'Running';
    case 'done':
      return 'Finished';
    case 'failed':
      return 'Failed';
    case 'cancelled':
      return 'Cancelled';
  }
}

/** Merges event batches: dedupes by id (realtime and polling overlap) and orders by id. */
export function mergeEvents(existing: RemoteEvent[], incoming: RemoteEvent[]): RemoteEvent[] {
  if (incoming.length === 0) return existing;
  const byId = new Map<number, RemoteEvent>();
  for (const e of existing) byId.set(e.id, e);
  for (const e of incoming) byId.set(e.id, e);
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

export interface OutputSegment {
  kind: RemoteEvent['kind'];
  text: string;
}

/** Joins consecutive events of the same kind so the console renders few, large text runs. */
export function toSegments(events: RemoteEvent[]): OutputSegment[] {
  const out: OutputSegment[] = [];
  for (const e of events) {
    const text = e.kind === 'info' ? `\n# ${e.data.trim()}\n` : e.data;
    const last = out[out.length - 1];
    if (last && last.kind === e.kind && e.kind !== 'info') last.text += text;
    else out.push({ kind: e.kind, text });
  }
  return out;
}

export function lastEventId(events: RemoteEvent[]): number {
  return events.length ? events[events.length - 1].id : 0;
}
