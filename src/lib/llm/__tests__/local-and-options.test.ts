import { createChunkedStorage } from '../../chunkedStorage';
import type { KeyValueBackend } from '../../chunkedStorage';
import { customEntryFromUrl, LOCAL_CATALOG } from '../localCatalog';
import { estimateTokens, fitToContext } from '../localContext';
import { buildModelOptions, pickLiveModel, resolveSelection } from '../modelOptions';
import type { ChatMessage } from '../types';
import { makeModelId, parseModelId } from '../types';

const m = (role: ChatMessage['role'], content: string): ChatMessage => ({ id: content, role, content, createdAt: 0 });

describe('fitToContext', () => {
  it('keeps everything when it fits', () => {
    const out = fitToContext([m('user', 'hi'), m('assistant', 'hello'), m('user', 'again')], 'sys', 4096, 512);
    expect(out.map((x) => x.role)).toEqual(['system', 'user', 'assistant', 'user']);
  });

  it('drops the oldest turns first and always keeps the newest user message', () => {
    const big = 'x'.repeat(700);
    const history = [m('user', big + '1'), m('assistant', big + '2'), m('user', big + '3'), m('assistant', big + '4'), m('user', 'latest')];
    const out = fitToContext(history, undefined, 700, 300);
    expect(out[out.length - 1].content).toBe('latest');
    expect(out[0].role).toBe('user');
    expect(out.length).toBeLessThan(history.length);
    const total = out.reduce((n, x) => n + estimateTokens(x.content), 0);
    expect(total).toBeLessThanOrEqual(700 - 300);
  });

  it('truncates a single oversized message instead of sending nothing', () => {
    const out = fitToContext([m('user', 'y'.repeat(20_000))], undefined, 1024, 256);
    expect(out).toHaveLength(1);
    expect(estimateTokens(out[0].content)).toBeLessThanOrEqual(1024 - 256);
  });

  it('caps an enormous system prompt so the conversation still fits', () => {
    const out = fitToContext([m('user', 'question')], 's'.repeat(50_000), 2048, 512);
    expect(out[0].role).toBe('system');
    expect(out[0].content).toMatch(/truncated/);
    expect(out[out.length - 1].content).toBe('question');
  });

  it('ignores tool messages and empty turns', () => {
    const out = fitToContext([m('user', 'a'), m('tool', 'ignored'), m('assistant', '   '), m('user', 'b')], undefined, 4096, 512);
    expect(out.map((x) => x.content)).toEqual(['a', 'b']);
  });
});

describe('model ids', () => {
  it('round-trips ids containing colons in the model name', () => {
    const id = makeModelId('openrouter', 'meta/llama-3:free');
    expect(parseModelId(id)).toEqual({ providerId: 'openrouter', model: 'meta/llama-3:free' });
    expect(parseModelId('nonsense')).toBeNull();
  });
});

describe('buildModelOptions', () => {
  const empty = { hasKey: {}, fetchedModels: {}, extraModels: {}, baseUrls: {}, localDownloads: {}, localCatalog: LOCAL_CATALOG };

  it('offers nothing until a key or download exists', () => {
    expect(buildModelOptions(empty)).toEqual([]);
  });

  it('shows defaults for keyed providers, then prefers fetched lists, and appends extras without duplicates', () => {
    const withKey = buildModelOptions({ ...empty, hasKey: { gemini: true } });
    expect(withKey.every((o) => o.providerId === 'gemini' && o.tools)).toBe(true);
    expect(withKey.length).toBeGreaterThan(0);

    const fetched = buildModelOptions({
      ...empty,
      hasKey: { gemini: true },
      fetchedModels: { gemini: [{ id: 'gemini-x', label: 'Gemini X' }] },
      extraModels: { gemini: ['gemini-x', 'my-tuned'] },
    });
    expect(fetched.map((o) => o.model)).toEqual(['gemini-x', 'my-tuned']);
  });

  it('enables the custom provider by base URL alone and lists downloaded local models without tools', () => {
    const out = buildModelOptions({
      ...empty,
      baseUrls: { custom: 'http://192.168.1.2:11434/v1' },
      extraModels: { custom: ['llama3'] },
      localDownloads: { [LOCAL_CATALOG[0].id]: { uri: 'file:///x.gguf', sizeBytes: 1 } },
    });
    expect(out.map((o) => o.id)).toEqual(['custom:llama3', `local:${LOCAL_CATALOG[0].id}`]);
    expect(out[1].tools).toBe(false);
    expect(out[1].label).toMatch(/on-device/);
  });

  it('resolveSelection falls back to the first option when the selection disappears', () => {
    const opts = buildModelOptions({ ...empty, hasKey: { anthropic: true } });
    expect(resolveSelection(opts, 'gemini:gone')?.id).toBe(opts[0].id);
    expect(resolveSelection(opts, opts[1].id)?.id).toBe(opts[1].id);
    expect(resolveSelection([], null)).toBeNull();
  });
});

describe('customEntryFromUrl', () => {
  it('accepts direct https .gguf links', () => {
    const e = customEntryFromUrl('https://huggingface.co/org/repo/resolve/main/My-Model.Q4_K_M.gguf');
    expect('error' in e).toBe(false);
    if (!('error' in e)) {
      expect(e.filename).toBe('My-Model.Q4_K_M.gguf');
      expect(e.id).toBe('custom-my-model.q4-k-m');
      expect(e.custom).toBe(true);
    }
  });

  it.each([
    ['not a url', /valid URL/],
    ['http://example.com/a.gguf', /https/],
    ['https://example.com/readme.txt', /\.gguf/],
    ['https://example.com/../../etc/passwd.gguf%2F..', /\.gguf/],
  ])('rejects %s', (input, message) => {
    const e = customEntryFromUrl(input);
    expect('error' in e && e.error).toMatch(message);
  });

  it('catalog entries have unique ids and filenames', () => {
    expect(new Set(LOCAL_CATALOG.map((e) => e.id)).size).toBe(LOCAL_CATALOG.length);
    expect(new Set(LOCAL_CATALOG.map((e) => e.filename)).size).toBe(LOCAL_CATALOG.length);
  });
});

describe('chunked storage', () => {
  function memory(): KeyValueBackend & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return {
      data,
      getItem: async (k) => data.get(k) ?? null,
      setItem: async (k, v) => {
        if (v.length > 2048) throw new Error('value too large');
        data.set(k, v);
      },
      removeItem: async (k) => {
        data.delete(k);
      },
    };
  }

  it('round-trips values larger than the per-item limit', async () => {
    const backend = memory();
    const store = createChunkedStorage(backend, 100);
    const value = JSON.stringify({ token: 'a'.repeat(950), user: { id: 'u' } });
    await store.setItem('session', value);
    expect(await store.getItem('session')).toBe(value);
    expect(backend.data.get('session.n')).toBe('10');
  });

  it('cleans up stale chunks when a value shrinks and on remove', async () => {
    const backend = memory();
    const store = createChunkedStorage(backend, 10);
    await store.setItem('k', 'x'.repeat(95));
    await store.setItem('k', 'short');
    expect([...backend.data.keys()].sort()).toEqual(['k.0', 'k.n']);
    await store.removeItem('k');
    expect(backend.data.size).toBe(0);
  });

  it('returns null for a missing or torn value', async () => {
    const backend = memory();
    const store = createChunkedStorage(backend, 10);
    expect(await store.getItem('nope')).toBeNull();
    await store.setItem('k', 'x'.repeat(30));
    backend.data.delete('k.1');
    expect(await store.getItem('k')).toBeNull();
  });
});

describe('pickLiveModel', () => {
  const models = [{ id: 'gemini-2.5-flash-live' }, { id: 'gemini-3.1-flash-live-preview' }, { id: 'gemini-3.0-flash-live' }];
  it('keeps the saved choice while it still exists', () => {
    expect(pickLiveModel(models, 'gemini-2.5-flash-live')).toBe('gemini-2.5-flash-live');
  });
  it('falls back to the newest version, comparing numbers properly', () => {
    expect(pickLiveModel(models, null)).toBe('gemini-3.1-flash-live-preview');
    expect(pickLiveModel(models, 'retired-model')).toBe('gemini-3.1-flash-live-preview');
    expect(pickLiveModel([{ id: 'live-9' }, { id: 'live-10' }], null)).toBe('live-10');
  });
  it('trusts a saved choice when the list has not been fetched, and returns null with nothing known', () => {
    expect(pickLiveModel([], 'typed-by-hand')).toBe('typed-by-hand');
    expect(pickLiveModel([], null)).toBeNull();
  });
});
