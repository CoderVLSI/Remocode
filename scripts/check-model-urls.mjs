#!/usr/bin/env node
// Verifies that every curated on-device model URL still resolves (HTTP 200 after redirects).
// Usage: node scripts/check-model-urls.mjs
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/lib/llm/localCatalog.ts', import.meta.url), 'utf8');
const urls = [...src.matchAll(/url:\s*'(https:\/\/[^']+\.gguf)'/g)].map((m) => m[1]);
let failed = 0;
for (const url of urls) {
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    const size = Number(res.headers.get('content-length') ?? 0);
    const ok = res.ok && (size === 0 || size > 8 * 1024 * 1024);
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${res.status} ${(size / 1e9).toFixed(2)} GB  ${url}`);
    if (!ok) failed++;
  } catch (err) {
    console.log(`FAIL --- ${url} (${err.message})`);
    failed++;
  }
}
process.exit(failed ? 1 : 0);
