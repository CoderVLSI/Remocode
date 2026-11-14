import { errorFromException, errorFromResponse } from './errors';
import { LLMError } from './types';

/** The subset of fetch() the providers rely on; lets tests inject a fake. */
export interface FetchResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  body: ReadableStream<Uint8Array> | null;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

export type FetchLike = (
  url: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<FetchResponse>;

/** POSTs JSON and returns a streaming body, translating failures to LLMError. */
export async function postStream(
  fetchImpl: FetchLike,
  url: string,
  headers: Record<string, string>,
  payload: unknown,
  signal?: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
  let res: FetchResponse;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream', ...headers },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (err) {
    throw errorFromException(err);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw errorFromResponse(res.status, text, res.headers);
  }
  if (!res.body) {
    throw new LLMError('network', 'The server returned no response stream.');
  }
  return res.body;
}

export async function getJson<T>(
  fetchImpl: FetchLike,
  url: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<T> {
  let res: FetchResponse;
  try {
    res = await fetchImpl(url, { method: 'GET', headers, signal });
  } catch (err) {
    throw errorFromException(err);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw errorFromResponse(res.status, text, res.headers);
  }
  return (await res.json()) as T;
}

/** Drops empty assistant turns (e.g. failed generations) before sending history. */
export function sendableHistory<T extends { role: string; content: string; error?: string; toolCalls?: unknown[] }>(
  messages: T[],
): T[] {
  return messages.filter((m) => {
    if (m.role === 'assistant' && m.error && !m.content && !m.toolCalls?.length) return false;
    if (m.role === 'assistant' && !m.content && !m.toolCalls?.length) return false;
    return true;
  });
}
