import { LLMError } from './types';

/** Parses a `Retry-After` header: either delta-seconds or an HTTP date. */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const at = Date.parse(value);
  if (Number.isFinite(at)) return Math.max(0, Math.ceil((at - now) / 1000));
  return undefined;
}

/** Pulls a human-readable message out of the common provider error envelopes. */
export function extractErrorMessage(bodyText: string): string {
  if (!bodyText) return '';
  try {
    const json = JSON.parse(bodyText);
    const candidate =
      json?.error?.message ?? // OpenAI, Gemini, Anthropic
      json?.message ??
      (typeof json?.error === 'string' ? json.error : undefined);
    if (typeof candidate === 'string') return candidate;
  } catch {
    // not JSON; fall through to the raw text
  }
  return bodyText.slice(0, 300);
}

/**
 * Maps an HTTP failure to a typed LLMError. `status` strings used by Gemini
 * ("RESOURCE_EXHAUSTED") and Anthropic ("rate_limit_error") are recognised even
 * when the HTTP status is unusual (some gateways answer 400/403).
 */
export function errorFromResponse(
  status: number,
  bodyText: string,
  headers?: { get(name: string): string | null },
): LLMError {
  const message = extractErrorMessage(bodyText) || `Request failed (${status})`;
  const retryAfter = parseRetryAfter(headers?.get('retry-after'));
  const lower = bodyText.toLowerCase();

  const quotaMarker =
    lower.includes('resource_exhausted') ||
    lower.includes('rate_limit') ||
    lower.includes('insufficient_quota') ||
    lower.includes('quota');

  if (status === 429 || (quotaMarker && status !== 401)) {
    return new LLMError('quota', message, { status, retryAfter });
  }
  if (status === 401 || status === 403) {
    return new LLMError('auth', message, { status });
  }
  if (status >= 500) {
    return new LLMError('unknown', message, { status, retryAfter });
  }
  return new LLMError('invalid', message, { status });
}

export function errorFromException(err: unknown): LLMError {
  if (err instanceof LLMError) return err;
  if (err instanceof Error) {
    if (err.name === 'AbortError') return new LLMError('aborted', 'Cancelled');
    const msg = err.message || 'Unknown error';
    if (/network|failed to fetch|timeout|timed out|offline/i.test(msg)) {
      return new LLMError('network', 'Network error. Check your connection and try again.');
    }
    return new LLMError('unknown', msg);
  }
  return new LLMError('unknown', String(err));
}

/** Short, friendly text for the error banner / failed message bubble. */
export function describeError(err: LLMError, now = Date.now()): string {
  switch (err.kind) {
    case 'quota': {
      if (err.retryAfter && err.retryAfter > 0) {
        const at = new Date(now + err.retryAfter * 1000);
        return `Model quota reached. It should refresh around ${at.toLocaleString()}. Try another model or add your own API key.`;
      }
      return 'Model quota reached. Try another model or add your own API key.';
    }
    case 'auth':
      return 'The API key was rejected or is missing. Check it in Settings → Models.';
    case 'network':
      return err.message;
    case 'aborted':
      return 'Stopped.';
    default:
      return err.message;
  }
}
