import { describeError, errorFromException, errorFromResponse, parseRetryAfter } from '../errors';
import { parseSSEBuffer, readSSE } from '../sse';
import { LLMError } from '../types';
import { collect, streamResponse } from './helpers';

describe('parseSSEBuffer', () => {
  it('splits events and keeps the incomplete tail', () => {
    const { events, rest } = parseSSEBuffer('data: {"a":1}\n\ndata: {"b":2}\n\ndata: {"c"');
    expect(events.map((e) => e.data)).toEqual(['{"a":1}', '{"b":2}']);
    expect(rest).toBe('data: {"c"');
  });

  it('handles CRLF, comments, event names and multi-line data', () => {
    const { events } = parseSSEBuffer(': ping\r\n\r\nevent: delta\r\ndata: one\r\ndata: two\r\n\r\n');
    expect(events).toEqual([{ event: 'delta', data: 'one\ntwo' }]);
  });
});

describe('readSSE', () => {
  it('reassembles events split across arbitrary chunk boundaries', async () => {
    const res = streamResponse(['dat', 'a: {"x":', '1}\n', '\ndata: [DONE]\n\n']);
    const events = await collect(readSSE(res.body!));
    expect(events.map((e) => e.data)).toEqual(['{"x":1}', '[DONE]']);
  });

  it('flushes a final event without a trailing blank line', async () => {
    const res = streamResponse(['data: last']);
    const events = await collect(readSSE(res.body!));
    expect(events.map((e) => e.data)).toEqual(['last']);
  });

  it('throws AbortError when the signal is already aborted', async () => {
    const res = streamResponse(['data: a\n\n']);
    const ac = new AbortController();
    ac.abort();
    await expect(collect(readSSE(res.body!, ac.signal))).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('errors', () => {
  const headers = (h: Record<string, string>) => ({ get: (n: string) => h[n.toLowerCase()] ?? null });

  it('classifies 429 as quota and reads Retry-After', () => {
    const err = errorFromResponse(429, '{"error":{"message":"Slow down"}}', headers({ 'retry-after': '30' }));
    expect(err.kind).toBe('quota');
    expect(err.retryAfter).toBe(30);
    expect(err.message).toBe('Slow down');
  });

  it('treats Gemini RESOURCE_EXHAUSTED as quota even without 429', () => {
    const err = errorFromResponse(
      400,
      '{"error":{"code":400,"message":"Quota exceeded","status":"RESOURCE_EXHAUSTED"}}',
    );
    expect(err.kind).toBe('quota');
  });

  it('classifies auth failures and server errors', () => {
    expect(errorFromResponse(401, '{"error":{"message":"bad key"}}').kind).toBe('auth');
    expect(errorFromResponse(403, 'nope').kind).toBe('auth');
    expect(errorFromResponse(503, 'down').kind).toBe('unknown');
    expect(errorFromResponse(400, 'bad').kind).toBe('invalid');
  });

  it('does not treat a 401 mentioning quota as a quota error', () => {
    expect(errorFromResponse(401, '{"error":{"message":"invalid key for quota project"}}').kind).toBe('auth');
  });

  it('parses Retry-After dates and rejects junk', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    expect(parseRetryAfter('Thu, 01 Jan 2026 00:01:00 GMT', now)).toBe(60);
    expect(parseRetryAfter('soon')).toBeUndefined();
    expect(parseRetryAfter(null)).toBeUndefined();
  });

  it('maps exceptions', () => {
    const abort = Object.assign(new Error('x'), { name: 'AbortError' });
    expect(errorFromException(abort).kind).toBe('aborted');
    expect(errorFromException(new Error('Network request failed')).kind).toBe('network');
    expect(errorFromException('boom').kind).toBe('unknown');
  });

  it('describes quota errors with a refresh time when known', () => {
    const now = Date.parse('2026-11-13T12:00:00Z');
    const text = describeError(new LLMError('quota', 'q', { retryAfter: 3600 }), now);
    expect(text).toMatch(/quota reached/i);
    expect(text).toMatch(/refresh around/);
    expect(describeError(new LLMError('quota', 'q'))).toMatch(/add your own API key/);
  });
});
