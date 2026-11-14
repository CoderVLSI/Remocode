import { fetch as expoFetch } from 'expo/fetch';

import { readApiKey, useSettings } from '@/store/settings';

import type { FetchLike } from './http';
import { LOCAL_CATALOG } from './localCatalog';
import type { LocalCatalogEntry } from './localCatalog';
import { buildModelOptions } from './modelOptions';
import { createAnthropicProvider, listAnthropicModels } from './providers/anthropic';
import { createGeminiProvider, listGeminiLiveModels, listGeminiModels } from './providers/gemini';
import { createLocalProvider } from './providers/local';
import {
  OPENAI_BASE_URL,
  OPENROUTER_BASE_URL,
  createOpenAICompatibleProvider,
  listOpenAIModels,
} from './providers/openai';
import { LLMError } from './types';
import type { LLMProvider, ModelOption, ProviderId } from './types';

// expo/fetch supports streaming response bodies, which plain RN fetch does not.
const fetchImpl = expoFetch as unknown as FetchLike;

export function allLocalEntries(): LocalCatalogEntry[] {
  return [...LOCAL_CATALOG, ...useSettings.getState().customLocalModels];
}

export function currentModelOptions(): ModelOption[] {
  const s = useSettings.getState();
  return buildModelOptions({
    hasKey: s.hasKey,
    fetchedModels: s.fetchedModels,
    extraModels: s.extraModels,
    baseUrls: s.baseUrls,
    localDownloads: s.localDownloads,
    localCatalog: allLocalEntries(),
  });
}

export async function getProvider(providerId: ProviderId): Promise<LLMProvider> {
  const s = useSettings.getState();
  switch (providerId) {
    case 'gemini':
      return createGeminiProvider({ apiKey: await readApiKey('gemini'), fetch: fetchImpl });
    case 'anthropic':
      return createAnthropicProvider({ apiKey: await readApiKey('anthropic'), fetch: fetchImpl });
    case 'openai':
      return createOpenAICompatibleProvider({
        id: 'openai',
        apiKey: await readApiKey('openai'),
        baseUrl: s.baseUrls.openai || OPENAI_BASE_URL,
        fetch: fetchImpl,
      });
    case 'openrouter':
      return createOpenAICompatibleProvider({
        id: 'openrouter',
        apiKey: await readApiKey('openrouter'),
        baseUrl: OPENROUTER_BASE_URL,
        fetch: fetchImpl,
      });
    case 'custom': {
      if (!s.baseUrls.custom) throw new LLMError('invalid', 'Set a base URL for the custom provider in Settings → Models.');
      return createOpenAICompatibleProvider({
        id: 'custom',
        apiKey: await readApiKey('custom'),
        baseUrl: s.baseUrls.custom,
        fetch: fetchImpl,
        keyOptional: true,
      });
    }
    case 'local':
      return createLocalProvider({
        resolvePath(modelId) {
          const installed = useSettings.getState().localDownloads[modelId];
          if (!installed) return null;
          const entry = allLocalEntries().find((e) => e.id === modelId);
          return { path: installed.uri, contextTokens: entry?.contextLength ?? 4096 };
        },
      });
  }
}

/** Fetches the provider's real model list and caches it for the picker. */
export async function refreshModels(providerId: ProviderId): Promise<number> {
  const s = useSettings.getState();
  const apiKey = await readApiKey(providerId);
  let models: { id: string; label: string }[] = [];
  switch (providerId) {
    case 'gemini': {
      models = await listGeminiModels({ apiKey, fetch: fetchImpl });
      // Live models are a separate capability; a failure here must not hide the normal list.
      try {
        s.setLiveModels(await listGeminiLiveModels({ apiKey, fetch: fetchImpl }));
      } catch {
        // keep whatever was cached
      }
      break;
    }
    case 'anthropic':
      models = await listAnthropicModels({ apiKey, fetch: fetchImpl });
      break;
    case 'openai':
      models = await listOpenAIModels({
        apiKey,
        baseUrl: s.baseUrls.openai || OPENAI_BASE_URL,
        fetch: fetchImpl,
        chatOnly: true,
      });
      break;
    case 'custom':
      if (!s.baseUrls.custom) throw new LLMError('invalid', 'Set a base URL first.');
      models = await listOpenAIModels({ apiKey, baseUrl: s.baseUrls.custom, fetch: fetchImpl });
      break;
    default:
      return 0; // OpenRouter's list is huge; use "Add model" for specific ones.
  }
  useSettings.getState().setFetchedModels(providerId, models);
  return models.length;
}
