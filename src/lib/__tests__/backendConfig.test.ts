import { configFromEnv, validateBackendConfig } from '../backendConfig';

declare const Buffer: { from(s: string): { toString(enc: 'base64'): string } };
const b64url = (obj: object) => Buffer.from(JSON.stringify(obj)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const jwt = (role: string) => `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ iss: 'supabase', role })}.sig_sig_sig_sig_sig`;

describe('validateBackendConfig', () => {
  it('accepts a normal project URL and anon key and normalises the URL', () => {
    const r = validateBackendConfig('  https://abcd1234.supabase.co/  ', jwt('anon'));
    expect(r).toEqual({ ok: true, config: { url: 'https://abcd1234.supabase.co', anonKey: jwt('anon') } });
  });

  it('adds https when the scheme is missing and accepts new-style publishable keys', () => {
    const r = validateBackendConfig('abcd1234.supabase.co', 'sb_publishable_abcdefghijklmnopqrstuvwxyz');
    expect(r.ok && r.config.url).toBe('https://abcd1234.supabase.co');
  });

  it('REFUSES a service-role key, in both formats', () => {
    const r = validateBackendConfig('https://abcd1234.supabase.co', jwt('service_role'));
    expect(!r.ok && r.error).toMatch(/service-role/);
    const s = validateBackendConfig('https://abcd1234.supabase.co', 'sb_secret_abcdefghijklmnopqrstuvwxyz');
    expect(!s.ok && s.error).toMatch(/secret key/);
  });

  it('rejects malformed JWTs, placeholders and whitespace', () => {
    expect(validateBackendConfig('https://a.supabase.co', 'eyJnotavalidjwtatall').ok).toBe(false);
    expect(validateBackendConfig('https://YOUR-PROJECT.supabase.co', jwt('anon')).ok).toBe(false);
    expect(validateBackendConfig('https://a.supabase.co', 'YOUR-ANON-KEY-PLACEHOLDER').ok).toBe(false);
    expect(validateBackendConfig('https://a.supabase.co', `${jwt('anon')}\n`).ok).toBe(true); // trailing newline from paste is trimmed
    expect(validateBackendConfig('https://a.supabase.co', `${jwt('anon')} extra`).ok).toBe(false);
  });

  it('rejects empty input, bad URLs and URLs with paths', () => {
    expect(validateBackendConfig('', jwt('anon')).ok).toBe(false);
    expect(validateBackendConfig('https://a.supabase.co', '').ok).toBe(false);
    expect(validateBackendConfig('ht!tp://bad url', jwt('anon')).ok).toBe(false);
    const path = validateBackendConfig('https://a.supabase.co/rest/v1', jwt('anon'));
    expect(!path.ok && path.error).toMatch(/root URL/);
  });

  it('allows http only for local development servers', () => {
    expect(validateBackendConfig('http://example.com', jwt('anon')).ok).toBe(false);
    expect(validateBackendConfig('http://192.168.1.20:54321', jwt('anon')).ok).toBe(true);
    expect(validateBackendConfig('http://10.0.2.2:54321', jwt('anon')).ok).toBe(true);
    expect(validateBackendConfig('http://localhost:54321', jwt('anon')).ok).toBe(true);
  });
});

describe('configFromEnv', () => {
  it('returns null when missing or invalid, and a config when valid', () => {
    expect(configFromEnv(undefined, undefined)).toBeNull();
    expect(configFromEnv('https://YOUR-PROJECT.supabase.co', 'YOUR-ANON-KEY')).toBeNull();
    expect(configFromEnv('https://a.supabase.co', jwt('anon'))).toEqual({ url: 'https://a.supabase.co', anonKey: jwt('anon') });
  });
});
