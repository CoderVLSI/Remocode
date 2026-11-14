import type { LocalCatalogEntry } from './localCatalog';
import { makeModelId } from './types';
import type { ModelOption, ProviderId } from './types';

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  gemini: 'Google Gemini',
  anthropic: 'Anthropic Claude',
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
  custom: 'Custom (OpenAI-compatible)',
  local: 'On-device',
};

/** Providers that take a user-supplied API key. */
export const KEYED_PROVIDERS: Exclude<ProviderId, 'local'>[] = ['gemini', 'anthropic', 'openai', 'openrouter', 'custom'];

/**
 * Offline fallbacks shown before the provider's model list has been fetched.
 * Aliases like `*-latest` avoid hard-coding versions that go stale.
 */
export const DEFAULT_MODELS: Partial<Record<ProviderId, { model: string; label: string }[]>> = {
  gemini: [
    { model: 'gemini-flash-latest', label: 'Gemini Flash (latest)' },
    { model: 'gemini-pro-latest', label: 'Gemini Pro (latest)' },
  ],
  anthropic: [
    { model: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
    { model: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
    { model: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
  ],
  openai: [{ model: 'gpt-4o-mini', label: 'GPT-4o mini' }],
  openrouter: [{ model: 'openrouter/auto', label: 'OpenRouter Auto' }],
};

export interface ModelOptionInputs {
  hasKey: Partial<Record<ProviderId, boolean>>;
  fetchedModels: Partial<Record<ProviderId, { id: string; label: string }[]>>;
  extraModels: Partial<Record<ProviderId, string[]>>;
  baseUrls: { openai?: string; custom?: string };
  localDownloads: Record<string, { uri: string; sizeBytes: number }>;
  localCatalog: LocalCatalogEntry[];
}

export function buildModelOptions(input: ModelOptionInputs): ModelOption[] {
  const out: ModelOption[] = [];
  const seen = new Set<string>();
  const add = (o: ModelOption) => {
    if (seen.has(o.id)) return;
    seen.add(o.id);
    out.push(o);
  };

  for (const providerId of KEYED_PROVIDERS) {
    // A custom endpoint is usable once it has a base URL (many local servers need no key).
    const enabled = providerId === 'custom' ? !!input.baseUrls.custom : !!input.hasKey[providerId];
    if (!enabled) continue;

    const base = input.fetchedModels[providerId]?.length
      ? input.fetchedModels[providerId]!.map((m) => ({ model: m.id, label: m.label }))
      : (DEFAULT_MODELS[providerId] ?? []);
    for (const m of base) {
      add({ id: makeModelId(providerId, m.model), providerId, model: m.model, label: m.label, tools: true });
    }
    for (const name of input.extraModels[providerId] ?? []) {
      add({ id: makeModelId(providerId, name), providerId, model: name, label: name, tools: true });
    }
  }

  for (const entry of input.localCatalog) {
    if (!input.localDownloads[entry.id]) continue;
    add({
      id: makeModelId('local', entry.id),
      providerId: 'local',
      model: entry.id,
      label: `${entry.name} (on-device)`,
      tools: false,
    });
  }
  return out;
}

/** Returns the selected id if still available, otherwise the first option. */
export function resolveSelection(options: ModelOption[], selectedId: string | null): ModelOption | null {
  return options.find((o) => o.id === selectedId) ?? options[0] ?? null;
}
