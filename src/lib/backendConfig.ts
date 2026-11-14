/** Validation for the Supabase connection details a user can enter inside the app. Pure. */

export interface BackendConfig {
  url: string;
  anonKey: string;
}

export type ConfigResult = { ok: true; config: BackendConfig } | { ok: false; error: string };

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    // atob exists in Hermes and Node 16+; decode as UTF-8 safely.
    const json = decodeURIComponent(
      atob(padded)
        .split('')
        .map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`)
        .join(''),
    );
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** http is only acceptable for local development servers. */
function isLocalHost(host: string): boolean {
  return /^(localhost|127\.0\.0\.1|10\.0\.2\.2|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/i.test(host);
}

export function validateBackendConfig(urlRaw: string, keyRaw: string): ConfigResult {
  const key = keyRaw.trim();
  let url = urlRaw.trim().replace(/\/+$/, '');
  if (!url) return { ok: false, error: 'Enter your project URL, e.g. https://abcd1234.supabase.co' };
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: 'That does not look like a valid URL.' };
  }
  if (parsed.protocol === 'http:' && !isLocalHost(parsed.hostname)) {
    return { ok: false, error: 'Use an https:// URL (plain http is only allowed for local servers).' };
  }
  if (/your-project/i.test(parsed.hostname)) return { ok: false, error: 'Replace the placeholder with your real project URL.' };
  if (parsed.pathname !== '/' && parsed.pathname !== '') {
    return { ok: false, error: 'Use the project root URL only, without a path (no /rest/v1 or /auth/v1).' };
  }

  if (!key) return { ok: false, error: 'Enter your anon (publishable) key.' };
  if (/\s/.test(key)) return { ok: false, error: 'The key must not contain spaces or line breaks.' };
  if (/^YOUR-/i.test(key) || key.length < 20) return { ok: false, error: 'That does not look like a real key.' };

  // A service-role key bypasses all security rules. It must never be shipped inside an app.
  if (key.startsWith('sb_secret_')) {
    return { ok: false, error: 'That is a secret key. Never put it in an app. Use the publishable (anon) key instead.' };
  }
  const payload = key.startsWith('eyJ') ? decodeJwtPayload(key) : null;
  if (payload?.role === 'service_role') {
    return { ok: false, error: 'That is the service-role key, which bypasses all security. Never put it in an app. Use the anon (public) key instead.' };
  }
  if (key.startsWith('eyJ') && !payload) return { ok: false, error: 'That key is malformed. Copy the whole anon key.' };

  return { ok: true, config: { url: parsed.origin, anonKey: key } };
}

/** Build-time configuration from EXPO_PUBLIC_* variables, if valid. */
export function configFromEnv(url: string | undefined, key: string | undefined): BackendConfig | null {
  if (!url || !key) return null;
  const r = validateBackendConfig(url, key);
  return r.ok ? r.config : null;
}
