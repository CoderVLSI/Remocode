import type { Device, RemoteEvent, RemoteTask, TaskStatus } from '../model';
import { createRemoteTools, pickDevice } from '../voiceTools';
import type { RemoteApi } from '../voiceTools';

const NOW = Date.parse('2026-11-14T12:00:00Z');
const dev = (name: string, secondsAgo: number): Device => ({
  id: `${name}-id`,
  name,
  platform: 'linux',
  last_seen_at: new Date(NOW - secondsAgo * 1000).toISOString(),
});
const TASK_ID = '123e4567-e89b-12d3-a456-426614174000';

describe('pickDevice', () => {
  const laptop = dev('Work laptop', 5);
  const desktop = dev('Home desktop', 5);
  const asleep = dev('Old box', 3600);

  it('refuses when nothing is connected or everything is offline', () => {
    expect(pickDevice([], undefined, NOW)).toMatchObject({ error: expect.stringMatching(/No computers are connected/) });
    expect(pickDevice([asleep], undefined, NOW)).toMatchObject({ error: expect.stringMatching(/offline/) });
  });

  it('uses the only online computer without asking', () => {
    expect(pickDevice([laptop, asleep], undefined, NOW)).toEqual({ device: laptop });
  });

  it('never guesses between several online computers', () => {
    const r = pickDevice([laptop, desktop], undefined, NOW);
    expect('error' in r && r.error).toMatch(/Several computers are online/);
  });

  it('matches by name, case-insensitively and by substring', () => {
    expect(pickDevice([laptop, desktop], 'HOME', NOW)).toEqual({ device: desktop });
    const none = pickDevice([laptop], 'nas', NOW);
    expect('error' in none && none.error).toMatch(/No computer matches/);
    const off = pickDevice([asleep], 'old', NOW);
    expect('error' in off && off.error).toMatch(/offline/);
    const ambiguous = pickDevice([laptop, dev('Work desktop', 5)], 'work', NOW);
    expect('error' in ambiguous && ambiguous.error).toMatch(/several online/);
  });
});

function fakeApi(over: Partial<RemoteApi> = {}, state: { status: TaskStatus; events: RemoteEvent[]; polls: number } = { status: 'running', events: [], polls: 0 }) {
  let clock = NOW;
  const created: { deviceId: string; prompt: string }[] = [];
  const cancelled: string[] = [];
  const api: RemoteApi = {
    listDevices: async () => [dev('Work laptop', 5)],
    createTask: async (deviceId, prompt) => {
      created.push({ deviceId, prompt });
      return { id: TASK_ID, device_id: deviceId, prompt, status: 'queued', exit_code: null, created_at: '', started_at: null, finished_at: null };
    },
    getTask: async () => {
      state.polls += 1;
      return { id: TASK_ID, device_id: 'd', prompt: 'p', status: state.status, exit_code: state.status === 'done' ? 0 : null, created_at: '', started_at: null, finished_at: null } as RemoteTask;
    },
    listEvents: async (_id, after = 0) => state.events.filter((e) => e.id > after),
    cancelTask: async (id) => {
      cancelled.push(id);
    },
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
    ...over,
  };
  return { api, created, cancelled, state };
}
const out = (id: number, data: string, kind: RemoteEvent['kind'] = 'stdout'): RemoteEvent => ({ id, task_id: TASK_ID, kind, data, created_at: '' });
const tool = (tools: ReturnType<typeof createRemoteTools>, name: string) => tools.find((t) => t.spec.name === name)!;

describe('voice remote tools', () => {
  it('requires approval to run a task and describes it for the prompt', () => {
    const t = tool(createRemoteTools(fakeApi().api), 'run_on_computer');
    expect(t.needsApproval).toBe(true);
    expect(t.describe?.({ task: 'add a login page', computer: 'Work laptop' })).toContain('Work laptop');
    expect(t.describe?.({ task: 'add a login page' })).toContain('add a login page');
    // the read-only and cancel tools must not need approval
    for (const name of ['list_computers', 'check_task', 'cancel_task']) {
      expect(tool(createRemoteTools(fakeApi().api), name).needsApproval).toBeFalsy();
    }
  });

  it('creates the task on the right computer and returns the id', async () => {
    const { api, created } = fakeApi();
    const msg = await tool(createRemoteTools(api), 'run_on_computer').execute({ task: '  build a todo app  ' }, {});
    expect(created).toEqual([{ deviceId: 'Work laptop-id', prompt: 'build a todo app' }]);
    expect(msg).toContain(TASK_ID);
  });

  it('rejects empty, oversized and unroutable tasks', async () => {
    const run = tool(createRemoteTools(fakeApi().api), 'run_on_computer');
    await expect(run.execute({ task: '   ' }, {})).rejects.toThrow(/required/);
    await expect(run.execute({ task: 'x'.repeat(5000) }, {})).rejects.toThrow(/too long/);
    const offline = tool(createRemoteTools(fakeApi({ listDevices: async () => [dev('Old box', 9999)] }).api), 'run_on_computer');
    await expect(offline.execute({ task: 'hi' }, {})).rejects.toThrow(/offline/);
  });

  it('waits for completion, then reports status and output', async () => {
    const state = { status: 'running' as TaskStatus, events: [out(1, 'compiling…\n'), out(2, 'warn\n', 'stderr')], polls: 0 };
    const { api } = fakeApi({}, state);
    const check = tool(createRemoteTools(api), 'check_task');
    // the task finishes on the third poll
    const base = api.getTask;
    api.getTask = async (id) => {
      const t = await base(id);
      if (state.polls >= 3) state.status = 'done';
      return t;
    };
    const text = await check.execute({ task_id: TASK_ID, wait_seconds: 20 }, {});
    expect(text).toMatch(/Status: Finished \(exit code 0\)/);
    expect(text).toContain('compiling…');
    expect(text).toContain('warn');
  });

  it('stops waiting at the deadline and reports it is still running', async () => {
    const { api, state } = fakeApi();
    const text = await tool(createRemoteTools(api), 'check_task').execute({ task_id: TASK_ID, wait_seconds: 3 }, {});
    expect(text).toMatch(/Status: Running/);
    expect(text).toMatch(/No output yet/);
    expect(state.polls).toBeLessThanOrEqual(5);
  });

  it('caps the wait and truncates long output to the tail', async () => {
    const big = Array.from({ length: 5 }, (_, i) => out(i + 1, `${String(i).repeat(2000)}\n`));
    const { api } = fakeApi({}, { status: 'done', events: big, polls: 0 });
    const text = await tool(createRemoteTools(api), 'check_task').execute({ task_id: TASK_ID, wait_seconds: 9999 }, {});
    expect(text.length).toBeLessThan(3300);
    expect(text).toContain('…');
    expect(text).toContain('4444'); // the tail, not the head
    expect(text).not.toContain('0000');
  });

  it('validates task ids before touching the API', async () => {
    const { api, cancelled } = fakeApi();
    const tools = createRemoteTools(api);
    await expect(tool(tools, 'check_task').execute({ task_id: 'nope' }, {})).rejects.toThrow(/valid task id/);
    await expect(tool(tools, 'cancel_task').execute({ task_id: '../x' }, {})).rejects.toThrow(/valid task id/);
    expect(await tool(tools, 'cancel_task').execute({ task_id: TASK_ID }, {})).toBe('Cancelled.');
    expect(cancelled).toEqual([TASK_ID]);
  });

  it('lists computers with presence', async () => {
    const { api } = fakeApi({ listDevices: async () => [dev('A', 5), dev('B', 9999)] });
    expect(await tool(createRemoteTools(api), 'list_computers').execute({}, {})).toBe('A: online\nB: offline');
  });
});
