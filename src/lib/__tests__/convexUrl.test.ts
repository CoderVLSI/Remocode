import { validateConvexUrl } from '../convexUrl';

describe('validateConvexUrl', () => {
  it('accepts a normal deployment URL and normalises it', () => {
    expect(validateConvexUrl('  https://wonderful-caiman-362.convex.cloud/  ')).toEqual({ ok: true, url: 'https://wonderful-caiman-362.convex.cloud' });
  });

  it('adds https when the scheme is missing', () => {
    expect(validateConvexUrl('wonderful-caiman-362.convex.cloud')).toEqual({ ok: true, url: 'https://wonderful-caiman-362.convex.cloud' });
  });

  it('turns a dashboard link into the deployment URL', () => {
    expect(validateConvexUrl('https://dashboard.convex.dev/d/Wonderful-Caiman-362/data')).toEqual({ ok: true, url: 'https://wonderful-caiman-362.convex.cloud' });
    const bad = validateConvexUrl('https://dashboard.convex.dev/t/my-team');
    expect(!bad.ok && bad.error).toMatch(/Open your deployment/);
  });

  it('rejects the .convex.site HTTP-actions URL with a helpful message', () => {
    const r = validateConvexUrl('https://wonderful-caiman-362.convex.site');
    expect(!r.ok && r.error).toMatch(/\.convex\.cloud/);
  });

  it('rejects placeholders, paths, queries, junk and non-http schemes', () => {
    expect(validateConvexUrl('https://happy-animal-123.convex.cloud').ok).toBe(false);
    expect(validateConvexUrl('https://a-b-1.convex.cloud/api').ok).toBe(false);
    expect(validateConvexUrl('https://a-b-1.convex.cloud/?x=1').ok).toBe(false);
    expect(validateConvexUrl('').ok).toBe(false);
    expect(validateConvexUrl('ht!tp://bad url').ok).toBe(false);
    expect(validateConvexUrl('ftp://a-b-1.convex.cloud').ok).toBe(false);
  });

  it('allows http only for local and private-network servers', () => {
    expect(validateConvexUrl('http://example.com').ok).toBe(false);
    expect(validateConvexUrl('http://127.0.0.1:3210')).toEqual({ ok: true, url: 'http://127.0.0.1:3210' });
    expect(validateConvexUrl('http://10.0.2.2:3210').ok).toBe(true);
    expect(validateConvexUrl('http://192.168.1.5:3210').ok).toBe(true);
  });

  it('allows self-hosted https deployments', () => {
    expect(validateConvexUrl('https://convex.mycompany.dev')).toEqual({ ok: true, url: 'https://convex.mycompany.dev' });
  });
});
