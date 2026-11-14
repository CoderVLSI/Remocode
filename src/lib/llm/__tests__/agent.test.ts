import { runTurn } from '../agent';
import type { ToolExecutor } from '../agent';
import type { ChatMessage, GenerateOptions, LLMProvider, StreamChunk } from '../types';
import { LLMError } from '../types';
import { newId } from './helpers';

const user = (content: string): ChatMessage => ({ id: newId(), role: 'user', content, createdAt: 0 });

function scripted(turns: (StreamChunk | Error)[][]): { provider: LLMProvider; seen: GenerateOptions[] } {
  const seen: GenerateOptions[] = [];
  let i = 0;
  const provider: LLMProvider = {
    id: 'custom',
    async *generate(options) {
      seen.push({ ...options, messages: [...options.messages] });
      const turn = turns[i++] ?? [{ type: 'done' }];
      for (const item of turn) {
        if (item instanceof Error) throw item;
        yield item;
      }
    },
  };
  return { provider, seen };
}

const base = { model: 'm', modelId: 'custom:m', newId };

describe('runTurn', () => {
  it('returns a plain text answer', async () => {
    const { provider } = scripted([[{ type: 'text', text: 'Hel' }, { type: 'text', text: 'lo' }, { type: 'done' }]]);
    const updates: number[] = [];
    const res = await runTurn({ ...base, provider, history: [user('hi')], onUpdate: (m) => updates.push(m.length) });
    expect(res.error).toBeUndefined();
    expect(res.produced).toHaveLength(1);
    expect(res.produced[0]).toMatchObject({ role: 'assistant', content: 'Hello', modelId: 'custom:m' });
    expect(updates.length).toBeGreaterThan(2);
  });

  it('executes tools and feeds results back until the model answers', async () => {
    const execute = jest.fn(async (args: Record<string, unknown>) => `contents of ${args.path}`);
    const tool: ToolExecutor = {
      spec: { name: 'read_file', description: 'd', parameters: { type: 'object' } },
      execute,
    };
    const { provider, seen } = scripted([
      [{ type: 'toolCall', call: { id: 'c1', name: 'read_file', args: { path: 'a.txt' } } }, { type: 'done' }],
      [{ type: 'text', text: 'It says hello.' }, { type: 'done' }],
    ]);
    const res = await runTurn({ ...base, provider, history: [user('read a.txt')], tools: [tool] });
    expect(res.error).toBeUndefined();
    expect(res.produced.map((m) => m.role)).toEqual(['assistant', 'tool', 'assistant']);
    expect(res.produced[0].toolCalls?.[0].name).toBe('read_file');
    expect(res.produced[1]).toMatchObject({ role: 'tool', toolCallId: 'c1', content: 'contents of a.txt' });
    expect(execute).toHaveBeenCalledWith({ path: 'a.txt' }, expect.anything());
    // The second request must include the assistant tool call and the tool result.
    expect(seen[1].messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool']);
  });

  it('reports unknown tools and tool exceptions back to the model instead of crashing', async () => {
    const boom: ToolExecutor = {
      spec: { name: 'boom', description: 'd', parameters: { type: 'object' } },
      execute: async () => {
        throw new Error('disk on fire');
      },
    };
    const { provider } = scripted([
      [
        { type: 'toolCall', call: { id: 'a', name: 'boom', args: {} } },
        { type: 'toolCall', call: { id: 'b', name: 'nope', args: {} } },
        { type: 'done' },
      ],
      [{ type: 'text', text: 'recovered' }, { type: 'done' }],
    ]);
    const res = await runTurn({ ...base, provider, history: [user('go')], tools: [boom] });
    expect(res.produced[1].content).toBe('Error: disk on fire');
    expect(res.produced[2].content).toBe('Error: unknown tool "nope".');
    expect(res.produced[3].content).toBe('recovered');
  });

  it('keeps partial text and attaches a friendly message on provider errors', async () => {
    const { provider } = scripted([[{ type: 'text', text: 'partial' }, new LLMError('quota', 'limit', { retryAfter: 60 })]]);
    const res = await runTurn({ ...base, provider, history: [user('hi')] });
    expect(res.error?.kind).toBe('quota');
    expect(res.produced[0].content).toBe('partial');
    expect(res.produced[0].error).toMatch(/quota reached/i);
  });

  it('removes an empty assistant bubble when cancelled before any output', async () => {
    const abort = Object.assign(new Error('x'), { name: 'AbortError' });
    const { provider } = scripted([[abort]]);
    const res = await runTurn({ ...base, provider, history: [user('hi')] });
    expect(res.error?.kind).toBe('aborted');
    expect(res.produced).toHaveLength(0);
  });

  it('flags an empty model response', async () => {
    const { provider } = scripted([[{ type: 'done' }]]);
    const res = await runTurn({ ...base, provider, history: [user('hi')] });
    expect(res.error).toBeDefined();
    expect(res.produced[0].error).toMatch(/empty response/);
  });

  it('stops runaway tool loops', async () => {
    const tool: ToolExecutor = {
      spec: { name: 't', description: 'd', parameters: { type: 'object' } },
      execute: async () => 'x',
    };
    const loop: StreamChunk[] = [{ type: 'toolCall', call: { id: 'c', name: 't', args: {} } }, { type: 'done' }];
    const { provider } = scripted([loop, loop, loop, loop]);
    const res = await runTurn({ ...base, provider, history: [user('go')], tools: [tool], maxSteps: 3 });
    expect(res.error?.message).toMatch(/Stopped after 3 tool steps/);
    expect(res.produced[res.produced.length - 1].error).toMatch(/Stopped after 3/);
  });

  it('truncates very large tool output', async () => {
    const tool: ToolExecutor = {
      spec: { name: 't', description: 'd', parameters: { type: 'object' } },
      execute: async () => 'x'.repeat(50_000),
    };
    const { provider } = scripted([
      [{ type: 'toolCall', call: { id: 'c', name: 't', args: {} } }, { type: 'done' }],
      [{ type: 'text', text: 'ok' }, { type: 'done' }],
    ]);
    const res = await runTurn({ ...base, provider, history: [user('go')], tools: [tool] });
    expect(res.produced[1].content.length).toBeLessThan(25_000);
    expect(res.produced[1].content).toMatch(/truncated 26000 characters/);
  });
});
