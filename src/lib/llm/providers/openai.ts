import { LLMError } from '../types';
import type { ChatMessage, GenerateOptions, LLMProvider, ProviderId, StreamChunk } from '../types';
import { getJson, postStream, sendableHistory } from '../http';
import type { FetchLike } from '../http';
import { readSSE } from '../sse';
import { errorFromException } from '../errors';

export const OPENAI_BASE_URL = 'https://api.openai.com/v1';
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

type OAIMessage =
  | { role: 'system' | 'user'; content: string }
  | {
      role: 'assistant';
      content: string | null;
      tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
    }
  | { role: 'tool'; tool_call_id: string; content: string };

export function toOpenAIMessages(messages: ChatMessage[], system?: string): OAIMessage[] {
  const out: OAIMessage[] = [];
  if (system) out.push({ role: 'system', content: system });
  for (const m of sendableHistory(messages)) {
    if (m.role === 'system') {
      out.push({ role: 'system', content: m.content });
    } else if (m.role === 'user') {
      out.push({ role: 'user', content: m.content });
    } else if (m.role === 'assistant') {
      const msg: OAIMessage = { role: 'assistant', content: m.content || null };
      if (m.toolCalls?.length) {
        msg.tool_calls = m.toolCalls.map((c) => ({
          id: c.id,
          type: 'function' as const,
          function: { name: c.name, arguments: JSON.stringify(c.args) },
        }));
      }
      out.push(msg);
    } else if (m.role === 'tool' && m.toolCallId) {
      out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
    }
  }
  return out;
}

/**
 * OpenAI-compatible chat completions: OpenAI, OpenRouter, Groq, Together,
 * LM Studio / Ollama on your LAN, or any custom base URL.
 */
export function createOpenAICompatibleProvider(opts: {
  id: Extract<ProviderId, 'openai' | 'openrouter' | 'custom'>;
  apiKey: string;
  baseUrl: string;
  fetch: FetchLike;
  /** Local servers (Ollama, LM Studio) accept requests without a key. */
  keyOptional?: boolean;
}): LLMProvider {
  const base = opts.baseUrl.replace(/\/$/, '');

  return {
    id: opts.id,
    async *generate(options: GenerateOptions): AsyncGenerator<StreamChunk> {
      if (!opts.apiKey && !opts.keyOptional) {
        throw new LLMError('auth', 'Add an API key in Settings → Models.');
      }
      const body: Record<string, unknown> = {
        model: options.model,
        messages: toOpenAIMessages(options.messages, options.system),
        stream: true,
      };
      if (options.tools?.length) {
        body.tools = options.tools.map((t) => ({
          type: 'function',
          function: { name: t.name, description: t.description, parameters: t.parameters },
        }));
      }
      if (options.temperature !== undefined) body.temperature = options.temperature;
      if (options.maxTokens !== undefined) {
        body[opts.id === 'openai' ? 'max_completion_tokens' : 'max_tokens'] = options.maxTokens;
      }

      const headers: Record<string, string> = {};
      if (opts.apiKey) headers.authorization = `Bearer ${opts.apiKey}`;

      const stream = await postStream(opts.fetch, `${base}/chat/completions`, headers, body, options.signal);

      const pending = new Map<number, { id: string; name: string; args: string }>();
      const flushCalls = function* (): Generator<StreamChunk> {
        for (const [, c] of [...pending.entries()].sort((a, b) => a[0] - b[0])) {
          let args: Record<string, unknown> = {};
          try {
            args = c.args ? JSON.parse(c.args) : {};
          } catch {
            // Malformed arguments: pass an empty object so the tool can report the problem.
          }
          yield { type: 'toolCall', call: { id: c.id || `call_${c.name}`, name: c.name, args } };
        }
        pending.clear();
      };

      try {
        for await (const ev of readSSE(stream, options.signal)) {
          if (ev.data === '[DONE]') break;
          let json: any;
          try {
            json = JSON.parse(ev.data);
          } catch {
            continue;
          }
          if (json.error) {
            const msg = json.error.message ?? 'Provider error';
            const quota = /quota|rate/i.test(`${json.error.code ?? ''} ${json.error.type ?? ''} ${msg}`);
            throw new LLMError(quota ? 'quota' : 'invalid', msg);
          }
          const choice = json.choices?.[0];
          const delta = choice?.delta;
          if (delta?.content) yield { type: 'text', text: delta.content };
          for (const tc of delta?.tool_calls ?? []) {
            const idx: number = tc.index ?? 0;
            const cur = pending.get(idx) ?? { id: '', name: '', args: '' };
            if (tc.id) cur.id = tc.id;
            if (tc.function?.name) cur.name += tc.function.name;
            if (tc.function?.arguments) cur.args += tc.function.arguments;
            pending.set(idx, cur);
          }
          if (choice?.finish_reason) yield* flushCalls();
        }
        yield* flushCalls();
      } catch (err) {
        throw errorFromException(err);
      }
      yield { type: 'done' };
    },
  };
}

export async function listOpenAIModels(opts: {
  apiKey: string;
  baseUrl: string;
  fetch: FetchLike;
  chatOnly?: boolean;
}): Promise<{ id: string; label: string }[]> {
  const headers: Record<string, string> = {};
  if (opts.apiKey) headers.authorization = `Bearer ${opts.apiKey}`;
  const json = await getJson<{ data?: { id: string }[] }>(
    opts.fetch,
    `${opts.baseUrl.replace(/\/$/, '')}/models`,
    headers,
  );
  return (json.data ?? [])
    .map((m) => m.id)
    .filter((id) => !opts.chatOnly || !/embed|whisper|tts|dall-e|moderation|image|audio|realtime/i.test(id))
    .sort()
    .map((id) => ({ id, label: id }));
}
