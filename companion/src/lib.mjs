// Pure helpers for the companion. No network or filesystem access, so they are unit-testable.

/** Default: Claude Code in non-interactive mode. Everything is overridable via env. */
export const DEFAULT_AGENT_CMD = 'claude';
export const DEFAULT_AGENT_ARGS = ['-p', '--output-format', 'text', '--', '{prompt}'];

/**
 * A prompt that starts with "-" could be parsed as a command-line flag by the
 * agent CLI (e.g. "--dangerously-skip-permissions"). Neutralise that.
 */
export function safePrompt(prompt) {
  const p = String(prompt).trim();
  return p.startsWith('-') ? `Task: ${p}` : p;
}

/** Parses REMOCODE_AGENT_ARGS: a JSON array of strings; falls back to the default. */
export function parseArgsEnv(raw) {
  if (!raw) return [...DEFAULT_AGENT_ARGS];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('REMOCODE_AGENT_ARGS must be a JSON array of strings, e.g. ["-p","{prompt}"]');
  }
  if (!Array.isArray(parsed) || !parsed.every((a) => typeof a === 'string')) {
    throw new Error('REMOCODE_AGENT_ARGS must be a JSON array of strings, e.g. ["-p","{prompt}"]');
  }
  if (!parsed.some((a) => a.includes('{prompt}'))) {
    throw new Error('REMOCODE_AGENT_ARGS must contain "{prompt}" so the task reaches the agent.');
  }
  return parsed;
}

/** Substitutes {prompt} in each argument. The result is an argv array: never passed through a shell. */
export function buildArgs(template, prompt) {
  const p = safePrompt(prompt);
  return template.map((arg) => arg.split('{prompt}').join(p));
}

/** Splits text into pieces no longer than `max` characters (the DB caps one event at 64 KB). */
export function chunkText(text, max = 32_000) {
  if (text.length <= max) return [text];
  const out = [];
  for (let i = 0; i < text.length; i += max) out.push(text.slice(i, i + max));
  return out;
}

/**
 * Batches child-process output into few, larger events: flushes when the kind
 * changes, the buffer is big, or after `flushMs`. Stops forwarding after
 * `maxTotal` characters and says so once.
 */
export function createBatcher({ onFlush, flushMs = 400, maxBytes = 16_384, maxTotal = 1_000_000, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let kind = null;
  let buffer = '';
  let timer = null;
  let total = 0;
  let truncated = false;

  const emit = (k, text) => {
    for (const piece of chunkText(text)) onFlush(k, piece);
  };

  function flush() {
    if (timer) {
      clearTimer(timer);
      timer = null;
    }
    if (buffer) emit(kind, buffer);
    buffer = '';
    kind = null;
  }

  function push(k, text) {
    if (!text) return;
    if (truncated) return;
    if (total + text.length > maxTotal) {
      text = text.slice(0, Math.max(0, maxTotal - total));
      truncated = true;
    }
    total += text.length;
    if (kind !== null && kind !== k) flush();
    kind = k;
    buffer += text;
    if (truncated) {
      flush();
      onFlush('info', `Output truncated after ${maxTotal} characters.`);
      return;
    }
    if (buffer.length >= maxBytes) flush();
    else if (!timer) timer = setTimer(flush, flushMs);
  }

  return { push, flush, get truncated() { return truncated; } };
}

/** Minimal .env parser (KEY=VALUE, # comments, optional quotes). */
export function parseDotenv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

/** Resolves when `notify()` is called or after `ms`, whichever is first. Notifications are not lost. */
export class Signal {
  constructor() {
    this.pending = false;
    this.wake = null;
  }
  notify() {
    this.pending = true;
    this.wake?.();
  }
  /** Returns true if woken by a notification, false on timeout. */
  async wait(ms, setTimer = setTimeout, clearTimer = clearTimeout) {
    if (this.pending) {
      this.pending = false;
      return true;
    }
    const woken = await new Promise((resolve) => {
      const timer = setTimer(() => {
        this.wake = null;
        resolve(false);
      }, ms);
      this.wake = () => {
        clearTimer(timer);
        this.wake = null;
        resolve(true);
      };
    });
    this.pending = false;
    return woken;
  }
}

/**
 * Normalises a Convex deployment URL: accepts https://name.convex.cloud, a bare host, or a
 * dashboard link; rejects the .convex.site address (HTTP actions) and plain http except locally.
 * Returns the URL string, or throws with a helpful message.
 */
export function normalizeConvexUrl(raw) {
  let input = String(raw ?? '').trim();
  if (!input) throw new Error('Enter your Convex deployment URL, e.g. https://your-name-123.convex.cloud');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) input = `https://${input}`;
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error('That does not look like a valid URL.');
  }
  if (url.hostname === 'dashboard.convex.dev') {
    const name = /\/d\/([a-z0-9-]+)/i.exec(url.pathname)?.[1];
    if (!name) throw new Error('Copy the deployment URL (ending .convex.cloud) from the Convex dashboard settings.');
    return `https://${name.toLowerCase()}.convex.cloud`;
  }
  if (url.hostname.endsWith('.convex.site')) throw new Error('That is the HTTP actions URL (.convex.site). Use the .convex.cloud URL.');
  const local = /^(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(url.hostname);
  if (url.protocol === 'http:' && !local) throw new Error('Use an https:// URL (plain http is only allowed for local servers).');
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Use an https:// URL.');
  return url.origin;
}
