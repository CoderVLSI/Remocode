import { LLMError } from '../types';
import type { ChatMessage, GenerateOptions, LLMProvider, StreamChunk } from '../types';
import { getJson, postStream, sendableHistory } from '../http';
import type { FetchLike } from '../http';
import { readSSE } from '../sse';
import { errorFromException } from '../errors';

export const ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MAX_TOKENS = 8192;

type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: Block[];
}

/** Anthropic wants tool results as a user turn; adjacent results share one turn. */
export function toAnthropicMessages(messages: ChatMessage[]): AnthropicMessage[] {
  const out: AnthropicMessage[] = [];
  for (const m of sendableHistory(messages)) {
    if (m.role === 'system') continue;
    if (m.role === 'user') {
      out.push({ role: 'user', content: [{ type: 'text', text: m.content }] });
    } else if (m.role === 'assistant') {
      const content: Block[] = [];
      if (m.content) content.push({ type: 'text', text: m.content });
      for (const c of m.toolCalls ?? []) {
        content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args });
      }
      out.push({ role: 'assistant', content });
    } else if (m.role === 'tool' && m.toolCallId) {
      const block: Block = { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content };
      const last = out[out.length - 1];
      if (last && last.role === 'user' && last.content.every((b) => b.type === 'tool_result')) {
        last.content.push(block);
      } else {
        out.push({ role: 'user', content: [block] });
      }
    }
  }
  return out;
}

export function createAnthropicProvider(opts: {
  apiKey: string;
  fetch: FetchLike;
  baseUrl?: string;
}): LLMProvider {
  const base = (opts.baseUrl ?? ANTHROPIC_BASE_URL).replace(/\/$/, '');

  return {
    id: 'anthropic',
    async *generate(options: GenerateOptions): AsyncGenerator<StreamChunk> {
      if (!opts.apiKey) throw new LLMError('auth', 'Add an Anthropic API key in Settings → Models.');

      const body: Record<string, unknown> = {
        model: options.model,
        max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
        messages: toAnthropicMessages(options.messages),
        stream: true,
      };
      if (options.system) body.system = options.system;
      if (options.temperature !== undefined) body.temperature = options.temperature;
      if (options.tools?.length) {
        body.tools = options.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters.type ? t.parameters : { type: 'object', ...t.parameters },
        }));
      }

      const stream = await postStream(
        opts.fetch,
        `${base}/messages`,
        { 'x-api-key': opts.apiKey, 'anthropic-version': ANTHROPIC_VERSION },
        body,
        options.signal,
      );

      const tools = new Map<number, { id: string; name: string; json: string }>();
      try {
        for await (const ev of readSSE(stream, options.signal)) {
          let json: any;
          try {
            json = JSON.parse(ev.data);
          } catch {
            continue;
          }
          switch (json.type) {
            case 'content_block_start':
              if (json.content_block?.type === 'tool_use') {
                tools.set(json.index, {
                  id: json.content_block.id,
                  name: json.content_block.name,
                  json: '',
                });
              }
              break;
            case 'content_block_delta':
              if (json.delta?.type === 'text_delta' && json.delta.text) {
                yield { type: 'text', text: json.delta.text };
              } else if (json.delta?.type === 'input_json_delta') {
                const t = tools.get(json.index);
                if (t) t.json += json.delta.partial_json ?? '';
              }
              break;
            case 'content_block_stop': {
              const t = tools.get(json.index);
              if (t) {
                let args: Record<string, unknown> = {};
                try {
                  args = t.json ? JSON.parse(t.json) : {};
                } catch {
                  // leave empty; the tool will report missing arguments
                }
                yield { type: 'toolCall', call: { id: t.id, name: t.name, args } };
                tools.delete(json.index);
              }
              break;
            }
            case 'error': {
              const type = json.error?.type as string | undefined;
              const kind =
                type === 'rate_limit_error' || type === 'overloaded_error'
                  ? 'quota'
                  : type === 'authentication_error' || type === 'permission_error'
                    ? 'auth'
                    : 'invalid';
              throw new LLMError(kind, json.error?.message ?? 'Anthropic error');
            }
            default:
              break;
          }
        }
      } catch (err) {
        throw errorFromException(err);
      }
      yield { type: 'done' };
    },
  };
}

export async function listAnthropicModels(opts: {
  apiKey: string;
  fetch: FetchLike;
  baseUrl?: string;
}): Promise<{ id: string; label: string }[]> {
  const base = (opts.baseUrl ?? ANTHROPIC_BASE_URL).replace(/\/$/, '');
  const json = await getJson<{ data?: { id: string; display_name?: string }[] }>(
    opts.fetch,
    `${base}/models?limit=100`,
    { 'x-api-key': opts.apiKey, 'anthropic-version': ANTHROPIC_VERSION },
  );
  return (json.data ?? []).map((m) => ({ id: m.id, label: m.display_name ?? m.id }));
}
