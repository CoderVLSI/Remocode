/** Remote Control data model and pure helpers (shapes match convex/devices.ts and convex/tasks.ts). */
import type { Id } from '../../../convex/_generated/dataModel';

export type TaskStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface Device {
  _id: Id<'devices'>;
  name: string;
  platform: string | null;
  /** Epoch ms of the companion's last heartbeat. */
  lastSeenAt: number;
}

export interface RemoteTask {
  _id: Id<'tasks'>;
  deviceId: Id<'devices'>;
  prompt: string;
  status: TaskStatus;
  exitCode: number | null;
  startedAt: number | null;
  finishedAt: number | null;
  createdAt: number;
}

export interface RemoteEvent {
  _id: Id<'taskEvents'>;
  kind: 'stdout' | 'stderr' | 'info';
  data: string;
}

/** The companion heartbeats every 15s; allow a couple of missed beats. */
export const ONLINE_WINDOW_MS = 45_000;

export function isOnline(device: Pick<Device, 'lastSeenAt'>, now = Date.now()): boolean {
  return Number.isFinite(device.lastSeenAt) && now - device.lastSeenAt <= ONLINE_WINDOW_MS;
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

export interface OutputSegment {
  kind: RemoteEvent['kind'];
  text: string;
}

/** Joins consecutive events of the same kind so the console renders few, large text runs. */
export function toSegments(events: Pick<RemoteEvent, 'kind' | 'data'>[]): OutputSegment[] {
  const out: OutputSegment[] = [];
  for (const e of events) {
    const text = e.kind === 'info' ? `\n# ${e.data.trim()}\n` : e.data;
    const last = out[out.length - 1];
    if (last && last.kind === e.kind && e.kind !== 'info') last.text += text;
    else out.push({ kind: e.kind, text });
  }
  return out;
}

/** "9:41" style countdown for a pairing code. */
export function formatCountdown(msLeft: number): string {
  const s = Math.max(0, Math.ceil(msLeft / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
