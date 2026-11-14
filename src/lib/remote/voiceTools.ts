import type { LiveTool } from '../live/session';

import { isFinal, isOnline, statusLabel, toSegments } from './model';
import type { Device, RemoteEvent, RemoteTask } from './model';

/** The slice of the Remote Control API these tools need (injectable for tests). */
export interface RemoteApi {
  listDevices(): Promise<Device[]>;
  createTask(deviceId: string, prompt: string): Promise<RemoteTask>;
  getTask(id: string): Promise<RemoteTask | null>;
  listEvents(taskId: string, afterId?: number): Promise<RemoteEvent[]>;
  cancelTask(id: string): Promise<void>;
  sleep(ms: number): Promise<void>;
  now(): number;
}

const MAX_PROMPT_CHARS = 4000;
/** How much recent output goes back to the model; voice sessions cannot read pages of logs. */
const TAIL_CHARS = 3000;
const MAX_WAIT_SECONDS = 25;

export type DevicePick = { device: Device } | { error: string };

/** Chooses which computer a task goes to, without ever guessing between several. */
export function pickDevice(devices: Device[], requested: string | undefined, now: number): DevicePick {
  if (devices.length === 0) {
    return { error: 'No computers are connected. The user needs to run the Remocode companion on their computer first.' };
  }
  const name = requested?.trim().toLowerCase();
  if (name) {
    const matches = devices.filter((d) => d.name.toLowerCase().includes(name));
    if (matches.length === 0) return { error: `No computer matches "${requested}". Known computers: ${devices.map((d) => d.name).join(', ')}.` };
    const online = matches.filter((d) => isOnline(d, now));
    if (online.length === 1) return { device: online[0] };
    if (online.length === 0) return { error: `"${matches[0].name}" is offline. Ask the user to start the companion on it.` };
    return { error: `"${requested}" matches several online computers: ${online.map((d) => d.name).join(', ')}. Ask which one.` };
  }
  const online = devices.filter((d) => isOnline(d, now));
  if (online.length === 1) return { device: online[0] };
  if (online.length === 0) return { error: `All computers are offline (${devices.map((d) => d.name).join(', ')}). Ask the user to start the companion.` };
  return { error: `Several computers are online: ${online.map((d) => d.name).join(', ')}. Ask the user which one to use.` };
}

function tail(events: RemoteEvent[]): string {
  const text = toSegments(events)
    .map((s) => s.text)
    .join('')
    .trim();
  return text.length > TAIL_CHARS ? `…${text.slice(-TAIL_CHARS)}` : text;
}

/**
 * Tools that let a voice session run work on the user's own computer through the companion.
 * Starting a task requires the user's explicit on-screen approval every time, so text the
 * model read (a web page, a Drive file) can never silently trigger commands on their machine.
 */
export function createRemoteTools(api: RemoteApi): LiveTool[] {
  return [
    {
      spec: {
        name: 'list_computers',
        description: "List the user's computers connected to Remocode and whether each is online.",
        parameters: { type: 'object', properties: {} },
      },
      async execute() {
        const devices = await api.listDevices();
        const now = api.now();
        return devices.length
          ? devices.map((d) => `${d.name}: ${isOnline(d, now) ? 'online' : 'offline'}`).join('\n')
          : 'No computers are connected.';
      },
    },
    {
      needsApproval: true,
      describe: (args) => {
        const where = typeof args.computer === 'string' && args.computer ? `on “${args.computer}”` : 'on your computer';
        return `Run ${where}:\n${String(args.task ?? '').slice(0, 400)}`;
      },
      spec: {
        name: 'run_on_computer',
        description:
          "Start a coding task on the user's computer, where an AI coding agent can read and edit files and run commands in the configured project folder. " +
          'Returns a task id immediately; use check_task to follow progress and report results to the user. ' +
          'Write the task as a clear, self-contained instruction. The user must approve each task on screen.',
        parameters: {
          type: 'object',
          properties: {
            task: { type: 'string', description: 'What the coding agent should do, in full sentences.' },
            computer: { type: 'string', description: 'Computer name, only needed if several are online.' },
          },
          required: ['task'],
        },
      },
      async execute(args) {
        const task = typeof args.task === 'string' ? args.task.trim() : '';
        if (!task) throw new Error('A task description is required.');
        if (task.length > MAX_PROMPT_CHARS) throw new Error(`The task is too long (${task.length} characters; limit ${MAX_PROMPT_CHARS}).`);
        const pick = pickDevice(await api.listDevices(), typeof args.computer === 'string' ? args.computer : undefined, api.now());
        if ('error' in pick) throw new Error(pick.error);
        const created = await api.createTask(pick.device.id, task);
        return `Started task ${created.id} on ${pick.device.name}. Use check_task with this id to follow progress.`;
      },
    },
    {
      spec: {
        name: 'check_task',
        description:
          'Check a task started with run_on_computer: returns its status and the latest output. ' +
          'Optionally wait a few seconds for it to finish. Summarize the result for the user out loud.',
        parameters: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'Task id returned by run_on_computer.' },
            wait_seconds: { type: 'number', description: 'Seconds to wait for completion (0-25, default 10).' },
          },
          required: ['task_id'],
        },
      },
      async execute(args, { signal }) {
        const id = typeof args.task_id === 'string' ? args.task_id : '';
        if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('That is not a valid task id.');
        const wait = Math.min(Math.max(Number(args.wait_seconds ?? 10) || 0, 0), MAX_WAIT_SECONDS) * 1000;
        const deadline = api.now() + wait;
        let task = await api.getTask(id);
        if (!task) throw new Error('No such task.');
        while (!isFinal(task.status) && api.now() < deadline && !signal?.aborted) {
          await api.sleep(1500);
          task = (await api.getTask(id)) ?? task;
        }
        const events: RemoteEvent[] = [];
        let after = 0;
        for (let page = 0; page < 20; page++) {
          const batch = await api.listEvents(id, after);
          if (batch.length === 0) break;
          events.push(...batch);
          after = batch[batch.length - 1].id;
        }
        const output = tail(events);
        const head = `Status: ${statusLabel(task.status)}${task.exit_code !== null ? ` (exit code ${task.exit_code})` : ''}.`;
        return output ? `${head}\nLatest output:\n${output}` : `${head}\nNo output yet.`;
      },
    },
    {
      spec: {
        name: 'cancel_task',
        description: 'Cancel a running or queued task on the computer.',
        parameters: { type: 'object', properties: { task_id: { type: 'string', description: 'Task id to cancel.' } }, required: ['task_id'] },
      },
      async execute(args) {
        const id = typeof args.task_id === 'string' ? args.task_id : '';
        if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('That is not a valid task id.');
        await api.cancelTask(id);
        return 'Cancelled.';
      },
    },
  ];
}
