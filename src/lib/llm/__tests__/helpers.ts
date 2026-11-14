import type { FetchLike, FetchResponse } from '../http';

const enc = new TextEncoder();

/** Builds a streaming Response-like object from raw string chunks. */
export function streamResponse(chunks: string[], init: { status?: number; headers?: Record<string, string> } = {}): FetchResponse {
  const status = init.status ?? 200;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  const headers = init.headers ?? {};
  const text = chunks.join('');
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
    body,
    text: async () => text,
    json: async () => JSON.parse(text),
  };
}

export function sse(...events: (object | string)[]): string[] {
  return events.map((e) => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`);
}

export interface Recorded {
  url: string;
  init: Parameters<FetchLike>[1];
  json: any;
}

export function fakeFetch(
  responder: (req: Recorded) => FetchResponse,
): { fetch: FetchLike; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const fetch: FetchLike = async (url, init) => {
    const rec: Recorded = { url, init, json: init.body ? JSON.parse(init.body) : undefined };
    calls.push(rec);
    return responder(rec);
  };
  return { fetch, calls };
}

export async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

let counter = 0;
export const newId = () => `id${++counter}`;
