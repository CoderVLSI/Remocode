/** Validation for the Convex deployment URL a user can enter inside the app. Pure. */

export type UrlResult = { ok: true; url: string } | { ok: false; error: string };

/** http is only acceptable for local development / self-hosted servers on a private network. */
function isLocalHost(host: string): boolean {
  return /^(localhost|127\.0\.0\.1|10\.0\.2\.2|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/i.test(host);
}

/**
 * Accepts the deployment URL (https://name.convex.cloud) and, for convenience, a dashboard link
 * (https://dashboard.convex.dev/d/name). Rejects the `.convex.site` address, which is for HTTP
 * actions and is the most common copy-paste mistake.
 */
export function validateConvexUrl(raw: string): UrlResult {
  let input = raw.trim();
  if (!input) return { ok: false, error: 'Enter your Convex deployment URL, e.g. https://happy-animal-123.convex.cloud' };
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) input = `https://${input}`;

  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return { ok: false, error: 'That does not look like a valid URL.' };
  }

  if (parsed.hostname === 'dashboard.convex.dev') {
    const name = /\/d\/([a-z0-9-]+)/i.exec(parsed.pathname)?.[1];
    if (!name) return { ok: false, error: 'Open your deployment in the dashboard and copy the URL from Settings → URL & Deploy Key.' };
    return { ok: true, url: `https://${name.toLowerCase()}.convex.cloud` };
  }
  if (parsed.hostname.endsWith('.convex.site')) {
    return { ok: false, error: 'That is the HTTP actions URL (.convex.site). Use the .convex.cloud URL instead.' };
  }
  if (parsed.protocol === 'http:' && !isLocalHost(parsed.hostname)) {
    return { ok: false, error: 'Use an https:// URL (plain http is only allowed for local servers).' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, error: 'Use an https:// URL.' };
  }
  if ((parsed.pathname !== '/' && parsed.pathname !== '') || parsed.search || parsed.hash) {
    return { ok: false, error: 'Use the deployment root URL only, without a path or query.' };
  }
  if (/^(happy-animal-123|your-deployment|name)\b/i.test(parsed.hostname)) {
    return { ok: false, error: 'Replace the example with your real deployment URL.' };
  }
  return { ok: true, url: parsed.origin };
}
