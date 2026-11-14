import { LLMError } from '../types';
import type { ChatMessage, GenerateOptions, LLMProvider, StreamChunk } from '../types';
import { getJson, postStream, sendableHistory } from '../http';
import type { FetchLike } from '../http';
import { readSSE } from '../sse';
import { errorFromException } from '../errors';

export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

interface GeminiPart {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}
interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

/** Converts our history to Gemini `contents`, grouping tool results into one user turn. */
export function toGeminiContents(messages: ChatMessage[]): GeminiContent[] {
  const out: GeminiContent[] = [];
  for (const m of sendableHistory(messages)) {
    if (m.role === 'system') continue;
    if (m.role === 'user') {
      out.push({ role: 'user', parts: [{ text: m.content }] });
    } else if (m.role === 'assistant') {
      const parts: GeminiPart[] = [];
      if (m.content) parts.push({ text: m.content });
      for (const call of m.toolCalls ?? []) {
        const part: GeminiPart = { functionCall: { name: call.name, args: call.args } };
        const sig = call.providerMeta?.thoughtSignature;
        if (typeof sig === 'string') part.thoughtSignature = sig;
        parts.push(part);
      }
      out.push({ role: 'model', parts });
    } else if (m.role === 'tool') {
      const part: GeminiPart = {
        functionResponse: { name: m.toolName ?? 'tool', response: { result: m.content } },
      };
      const last = out[out.length - 1];
      if (last && last.role === 'user' && last.parts.every((p) => p.functionResponse)) {
        last.parts.push(part);
      } else {
        out.push({ role: 'user', parts: [part] });
      }
    }
  }
  return out;
}

export function createGeminiProvider(opts: {
  apiKey: string;
  fetch: FetchLike;
  baseUrl?: string;
}): LLMProvider {
  const base = (opts.baseUrl ?? GEMINI_BASE_URL).replace(/\/$/, '');

  return {
    id: 'gemini',
    async *generate(options: GenerateOptions): AsyncGenerator<StreamChunk> {
      if (!opts.apiKey) throw new LLMError('auth', 'Add a Gemini API key in Settings → Models.');

      const model = options.model.replace(/^models\//, '');
      const body: Record<string, unknown> = {
        contents: toGeminiContents(options.messages),
      };
      if (options.system) body.systemInstruction = { parts: [{ text: options.system }] };
      if (options.tools?.length) {
        body.tools = [
          {
            functionDeclarations: options.tools.map((t) => ({
              name: t.name,
              description: t.description,
              parameters: t.parameters,
            })),
          },
        ];
      }
      const generationConfig: Record<string, unknown> = {};
      if (options.temperature !== undefined) generationConfig.temperature = options.temperature;
      if (options.maxTokens !== undefined) generationConfig.maxOutputTokens = options.maxTokens;
      if (Object.keys(generationConfig).length) body.generationConfig = generationConfig;

      const stream = await postStream(
        opts.fetch,
        `${base}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
        { 'x-goog-api-key': opts.apiKey },
        body,
        options.signal,
      );

      let callCounter = 0;
      try {
        for await (const ev of readSSE(stream, options.signal)) {
          let json: any;
          try {
            json = JSON.parse(ev.data);
          } catch {
            continue;
          }
          if (json.error) {
            const status = typeof json.error.code === 'number' ? json.error.code : 400;
            const isQuota = json.error.status === 'RESOURCE_EXHAUSTED' || status === 429;
            throw new LLMError(isQuota ? 'quota' : 'invalid', json.error.message ?? 'Gemini error', {
              status,
            });
          }
          if (json.promptFeedback?.blockReason) {
            throw new LLMError('invalid', `Request blocked: ${json.promptFeedback.blockReason}`);
          }
          const candidate = json.candidates?.[0];
          for (const part of (candidate?.content?.parts ?? []) as GeminiPart[]) {
            if (part.thought) continue; // thought summaries are not shown
            if (part.functionCall) {
              callCounter += 1;
              yield {
                type: 'toolCall',
                call: {
                  id: `call_${Date.now().toString(36)}_${callCounter}`,
                  name: part.functionCall.name,
                  args: part.functionCall.args ?? {},
                  providerMeta: part.thoughtSignature
                    ? { thoughtSignature: part.thoughtSignature }
                    : undefined,
                },
              };
            } else if (part.text) {
              yield { type: 'text', text: part.text };
            }
          }
          const finish = candidate?.finishReason;
          if (finish === 'SAFETY' || finish === 'PROHIBITED_CONTENT' || finish === 'BLOCKLIST') {
            throw new LLMError('invalid', 'The response was blocked by Gemini safety filters.');
          }
        }
      } catch (err) {
        throw errorFromException(err);
      }
      yield { type: 'done' };
    },
  };
}

/** Lists models that support generateContent (so the picker never hard-codes names). */
export async function listGeminiModels(opts: {
  apiKey: string;
  fetch: FetchLike;
  baseUrl?: string;
}): Promise<{ id: string; label: string }[]> {
  const base = (opts.baseUrl ?? GEMINI_BASE_URL).replace(/\/$/, '');
  const json = await getJson<{
    models?: { name: string; displayName?: string; supportedGenerationMethods?: string[] }[];
  }>(opts.fetch, `${base}/models?pageSize=200`, { 'x-goog-api-key': opts.apiKey });
  return (json.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .filter((m) => /gemini/i.test(m.name) && !/embedding|aqa|imagen|veo|tts|image/i.test(m.name))
    .map((m) => ({ id: m.name.replace(/^models\//, ''), label: m.displayName ?? m.name }));
}
