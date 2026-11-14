import { createAnthropicProvider, toAnthropicMessages } from '../providers/anthropic';
import { createGeminiProvider, toGeminiContents } from '../providers/gemini';
import { createOpenAICompatibleProvider, toOpenAIMessages } from '../providers/openai';
import type { ChatMessage, ToolSpec } from '../types';
import { LLMError } from '../types';
import { collect, fakeFetch, sse, streamResponse } from './helpers';

const msg = (m: Partial<ChatMessage> & Pick<ChatMessage, 'role' | 'content'>): ChatMessage => ({
  id: Math.random().toString(36),
  createdAt: 0,
  ...m,
});

const tool: ToolSpec = {
  name: 'read_file',
  description: 'Read a file',
  parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
};

const toolHistory: ChatMessage[] = [
  msg({ role: 'user', content: 'open a.txt and b.txt' }),
  msg({
    role: 'assistant',
    content: '',
    toolCalls: [
      { id: 'c1', name: 'read_file', args: { path: 'a.txt' }, providerMeta: { thoughtSignature: 'sig1' } },
      { id: 'c2', name: 'read_file', args: { path: 'b.txt' } },
    ],
  }),
  msg({ role: 'tool', content: 'AAA', toolCallId: 'c1', toolName: 'read_file' }),
  msg({ role: 'tool', content: 'BBB', toolCallId: 'c2', toolName: 'read_file' }),
];

describe('Gemini', () => {
  it('maps history, groups tool results, and echoes thought signatures', () => {
    const contents = toGeminiContents(toolHistory);
    expect(contents).toHaveLength(3);
    expect(contents[1].role).toBe('model');
    expect(contents[1].parts[0]).toEqual({
      functionCall: { name: 'read_file', args: { path: 'a.txt' } },
      thoughtSignature: 'sig1',
    });
    expect(contents[2].role).toBe('user');
    expect(contents[2].parts).toHaveLength(2);
    expect(contents[2].parts[1].functionResponse?.response).toEqual({ result: 'BBB' });
  });

  it('drops failed empty assistant turns from history', () => {
    const contents = toGeminiContents([
      msg({ role: 'user', content: 'hi' }),
      msg({ role: 'assistant', content: '', error: 'quota' }),
      msg({ role: 'user', content: 'again' }),
    ]);
    expect(contents.map((c) => c.role)).toEqual(['user', 'user']);
  });

  it('streams text, skips thought parts, and surfaces function calls', async () => {
    const { fetch, calls } = fakeFetch(() =>
      streamResponse(
        sse(
          { candidates: [{ content: { parts: [{ text: 'Hel', thought: true }, { text: 'Hello' }] } }] },
          {
            candidates: [
              {
                content: {
                  parts: [{ text: ' world' }, { functionCall: { name: 'read_file', args: { path: 'x' } }, thoughtSignature: 'S' }],
                },
                finishReason: 'STOP',
              },
            ],
          },
        ),
      ),
    );
    const p = createGeminiProvider({ apiKey: 'K', fetch });
    const out = await collect(
      p.generate({ model: 'models/gemini-flash-latest', messages: [msg({ role: 'user', content: 'hi' })], system: 'sys', tools: [tool] }),
    );
    expect(out.filter((c) => c.type === 'text').map((c: any) => c.text).join('')).toBe('Hello world');
    const call: any = out.find((c) => c.type === 'toolCall');
    expect(call.call.name).toBe('read_file');
    expect(call.call.providerMeta).toEqual({ thoughtSignature: 'S' });
    expect(out[out.length - 1]).toEqual({ type: 'done' });

    expect(calls[0].url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:streamGenerateContent?alt=sse',
    );
    expect(calls[0].init.headers?.['x-goog-api-key']).toBe('K');
    expect(calls[0].json.systemInstruction.parts[0].text).toBe('sys');
    expect(calls[0].json.tools[0].functionDeclarations[0].name).toBe('read_file');
  });

  it('requires an API key', async () => {
    const { fetch } = fakeFetch(() => streamResponse([]));
    const p = createGeminiProvider({ apiKey: '', fetch });
    await expect(collect(p.generate({ model: 'm', messages: [] }))).rejects.toMatchObject({ kind: 'auth' });
  });

  it('turns HTTP quota errors into LLMError(quota)', async () => {
    const { fetch } = fakeFetch(() =>
      streamResponse(['{"error":{"message":"You exceeded your quota","status":"RESOURCE_EXHAUSTED"}}'], {
        status: 429,
        headers: { 'retry-after': '120' },
      }),
    );
    const p = createGeminiProvider({ apiKey: 'K', fetch });
    const err = await collect(p.generate({ model: 'm', messages: [msg({ role: 'user', content: 'x' })] })).catch((e) => e);
    expect(err).toBeInstanceOf(LLMError);
    expect(err.kind).toBe('quota');
    expect(err.retryAfter).toBe(120);
  });

  it('reports safety blocks', async () => {
    const { fetch } = fakeFetch(() => streamResponse(sse({ promptFeedback: { blockReason: 'SAFETY' } })));
    const p = createGeminiProvider({ apiKey: 'K', fetch });
    await expect(collect(p.generate({ model: 'm', messages: [msg({ role: 'user', content: 'x' })] }))).rejects.toMatchObject({
      kind: 'invalid',
    });
  });
});

describe('OpenAI-compatible', () => {
  it('maps history with tool calls and results', () => {
    const out = toOpenAIMessages(toolHistory, 'sys');
    expect(out[0]).toEqual({ role: 'system', content: 'sys' });
    const assistant: any = out[2];
    expect(assistant.content).toBeNull();
    expect(assistant.tool_calls[0]).toEqual({
      id: 'c1',
      type: 'function',
      function: { name: 'read_file', arguments: '{"path":"a.txt"}' },
    });
    expect(out[3]).toEqual({ role: 'tool', tool_call_id: 'c1', content: 'AAA' });
    expect(out[4]).toEqual({ role: 'tool', tool_call_id: 'c2', content: 'BBB' });
  });

  it('streams text and assembles fragmented tool-call arguments', async () => {
    const { fetch, calls } = fakeFetch(() =>
      streamResponse(
        sse(
          { choices: [{ delta: { content: 'Hi' } }] },
          { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'read_file', arguments: '{"pa' } }] } }] },
          { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"a.txt"}' } }] } }] },
          { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
          '[DONE]',
        ),
      ),
    );
    const p = createOpenAICompatibleProvider({ id: 'openai', apiKey: 'sk', baseUrl: 'https://api.openai.com/v1/', fetch });
    const out = await collect(
      p.generate({ model: 'gpt', messages: [msg({ role: 'user', content: 'x' })], tools: [tool], maxTokens: 50 }),
    );
    expect(out[0]).toEqual({ type: 'text', text: 'Hi' });
    const call: any = out.find((c) => c.type === 'toolCall');
    expect(call.call).toEqual({ id: 'call_1', name: 'read_file', args: { path: 'a.txt' } });
    expect(calls[0].url).toBe('https://api.openai.com/v1/chat/completions');
    expect(calls[0].init.headers?.authorization).toBe('Bearer sk');
    expect(calls[0].json.max_completion_tokens).toBe(50);
    expect(calls[0].json.stream).toBe(true);
  });

  it('allows keyless custom servers and uses max_tokens there', async () => {
    const { fetch, calls } = fakeFetch(() => streamResponse(sse({ choices: [{ delta: { content: 'ok' } }] }, '[DONE]')));
    const p = createOpenAICompatibleProvider({
      id: 'custom',
      apiKey: '',
      keyOptional: true,
      baseUrl: 'http://192.168.1.5:11434/v1',
      fetch,
    });
    const out = await collect(p.generate({ model: 'llama', messages: [msg({ role: 'user', content: 'x' })], maxTokens: 9 }));
    expect(out[0]).toEqual({ type: 'text', text: 'ok' });
    expect(calls[0].init.headers?.authorization).toBeUndefined();
    expect(calls[0].json.max_tokens).toBe(9);
  });

  it('rejects a missing key for hosted providers', async () => {
    const { fetch } = fakeFetch(() => streamResponse([]));
    const p = createOpenAICompatibleProvider({ id: 'openai', apiKey: '', baseUrl: 'https://x', fetch });
    await expect(collect(p.generate({ model: 'm', messages: [] }))).rejects.toMatchObject({ kind: 'auth' });
  });
});

describe('Anthropic', () => {
  it('groups consecutive tool results into one user turn', () => {
    const out = toAnthropicMessages(toolHistory);
    expect(out).toHaveLength(3);
    expect(out[1].content[0]).toEqual({ type: 'tool_use', id: 'c1', name: 'read_file', input: { path: 'a.txt' } });
    expect(out[2].role).toBe('user');
    expect(out[2].content).toEqual([
      { type: 'tool_result', tool_use_id: 'c1', content: 'AAA' },
      { type: 'tool_result', tool_use_id: 'c2', content: 'BBB' },
    ]);
  });

  it('streams text and tool_use blocks', async () => {
    const { fetch, calls } = fakeFetch(() =>
      streamResponse(
        sse(
          { type: 'message_start' },
          { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Let me look.' } },
          { type: 'content_block_stop', index: 0 },
          { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tu_1', name: 'read_file' } },
          { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"path":' } },
          { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '"a.txt"}' } },
          { type: 'content_block_stop', index: 1 },
          { type: 'message_stop' },
        ),
      ),
    );
    const p = createAnthropicProvider({ apiKey: 'ak', fetch });
    const out = await collect(
      p.generate({ model: 'claude-sonnet-5-5', messages: [msg({ role: 'user', content: 'x' })], system: 'S', tools: [tool] }),
    );
    expect(out[0]).toEqual({ type: 'text', text: 'Let me look.' });
    expect((out[1] as any).call).toEqual({ id: 'tu_1', name: 'read_file', args: { path: 'a.txt' } });
    expect(calls[0].init.headers?.['x-api-key']).toBe('ak');
    expect(calls[0].init.headers?.['anthropic-version']).toBe('2023-06-01');
    expect(calls[0].json.system).toBe('S');
    expect(calls[0].json.max_tokens).toBeGreaterThan(0);
    expect(calls[0].json.tools[0].input_schema.type).toBe('object');
  });

  it('maps in-stream overload errors to quota', async () => {
    const { fetch } = fakeFetch(() =>
      streamResponse(sse({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } })),
    );
    const p = createAnthropicProvider({ apiKey: 'ak', fetch });
    await expect(
      collect(p.generate({ model: 'm', messages: [msg({ role: 'user', content: 'x' })] })),
    ).rejects.toMatchObject({ kind: 'quota' });
  });
});
