/**
 * Minimal Server-Sent Events parser for fetch streaming bodies.
 * Works with any ReadableStream<Uint8Array> (expo/fetch, Node, browsers).
 */

export interface SSEEvent {
  event?: string;
  data: string;
}

/** Splits decoded text into complete SSE events, returning the unparsed tail. */
export function parseSSEBuffer(buffer: string): { events: SSEEvent[]; rest: string } {
  // Normalise CRLF / CR so blocks always end with a blank line ("\n\n").
  const normalised = buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = normalised.split('\n\n');
  const rest = blocks.pop() ?? '';
  const events: SSEEvent[] = [];

  for (const block of blocks) {
    if (!block.trim()) continue;
    let event: string | undefined;
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (!line || line.startsWith(':')) continue; // comment / keep-alive
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
    if (data.length > 0) events.push({ event, data: data.join('\n') });
  }
  return { events, rest };
}

export async function* readSSE(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<SSEEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const onAbort = () => {
    reader.cancel().catch(() => {});
  };
  signal?.addEventListener('abort', onAbort);

  try {
    while (true) {
      if (signal?.aborted) {
        const err = new Error('Aborted');
        err.name = 'AbortError';
        throw err;
      }
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parsed = parseSSEBuffer(buffer);
      buffer = parsed.rest;
      for (const ev of parsed.events) yield ev;
    }
    buffer += decoder.decode();
    // Flush a final event that lacked the trailing blank line.
    const parsed = parseSSEBuffer(buffer + '\n\n');
    for (const ev of parsed.events) yield ev;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    try {
      reader.releaseLock();
    } catch {
      // already released by cancel()
    }
  }
}
