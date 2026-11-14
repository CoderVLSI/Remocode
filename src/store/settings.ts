import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { deleteSecret, getSecret, setSecret } from '@/lib/secure';
import type { LocalCatalogEntry } from '@/lib/llm/localCatalog';
import type { ProviderId } from '@/lib/llm/types';

export interface VoiceSettings {
  /** Read replies aloud in voice mode. */
  speak: boolean;
  /** Require on-device speech recognition (no audio leaves the phone) when supported. */
  onDeviceRecognition: boolean;
  /** BCP-47 locale, e.g. en-US. */
  language: string;
  /** Speech rate multiplier for text-to-speech. */
  rate: number;
}

export interface ModelListEntry {
  id: string;
  label: string;
}

interface SettingsState {
  selectedModelId: string | null;
  systemPrompt: string;
  /** Which providers currently have a key in secure storage (mirrors SecureStore for sync UI). */
  hasKey: Partial<Record<ProviderId, boolean>>;
  baseUrls: { openai?: string; custom?: string };
  /** Models the user typed in by name for a provider. */
  extraModels: Partial<Record<ProviderId, string[]>>;
  /** Models fetched from a provider's list endpoint after a key was added. */
  fetchedModels: Partial<Record<ProviderId, ModelListEntry[]>>;
  localDownloads: Record<string, { uri: string; sizeBytes: number }>;
  customLocalModels: LocalCatalogEntry[];
  voice: VoiceSettings;

  selectModel(id: string): void;
  setSystemPrompt(text: string): void;
  setBaseUrl(provider: 'openai' | 'custom', url: string): void;
  saveApiKey(provider: ProviderId, key: string): Promise<void>;
  removeApiKey(provider: ProviderId): Promise<void>;
  addExtraModel(provider: ProviderId, model: string): void;
  removeExtraModel(provider: ProviderId, model: string): void;
  setFetchedModels(provider: ProviderId, models: ModelListEntry[]): void;
  setLocalDownload(id: string, info: { uri: string; sizeBytes: number } | null): void;
  addCustomLocalModel(entry: LocalCatalogEntry): void;
  removeCustomLocalModel(id: string): void;
  updateVoice(patch: Partial<VoiceSettings>): void;
}

export const DEFAULT_SYSTEM_PROMPT =
  'You are Remocode, a helpful assistant on a phone. Keep answers concise and well structured. ' +
  'When you show code, use fenced code blocks.';

export const useSettings = create<SettingsState>()(
  persist(
    (set, get) => ({
      selectedModelId: null,
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      hasKey: {},
      baseUrls: {},
      extraModels: {},
      fetchedModels: {},
      localDownloads: {},
      customLocalModels: [],
      voice: { speak: true, onDeviceRecognition: true, language: 'en-US', rate: 1 },

      selectModel: (id) => set({ selectedModelId: id }),
      setSystemPrompt: (text) => set({ systemPrompt: text }),
      setBaseUrl: (provider, url) => set({ baseUrls: { ...get().baseUrls, [provider]: url.trim() } }),

      async saveApiKey(provider, key) {
        const trimmed = key.trim();
        if (!trimmed) throw new Error('The key is empty.');
        await setSecret(`apikey.${provider}`, trimmed);
        set({ hasKey: { ...get().hasKey, [provider]: true } });
      },
      async removeApiKey(provider) {
        await deleteSecret(`apikey.${provider}`);
        const { [provider]: _removed, ...rest } = get().fetchedModels;
        set({ hasKey: { ...get().hasKey, [provider]: false }, fetchedModels: rest });
      },

      addExtraModel(provider, model) {
        const name = model.trim();
        if (!name) return;
        const list = get().extraModels[provider] ?? [];
        if (list.includes(name)) return;
        set({ extraModels: { ...get().extraModels, [provider]: [...list, name] } });
      },
      removeExtraModel(provider, model) {
        const list = get().extraModels[provider] ?? [];
        set({ extraModels: { ...get().extraModels, [provider]: list.filter((m) => m !== model) } });
      },
      setFetchedModels: (provider, models) =>
        set({ fetchedModels: { ...get().fetchedModels, [provider]: models } }),

      setLocalDownload(id, info) {
        const next = { ...get().localDownloads };
        if (info) next[id] = info;
        else delete next[id];
        set({ localDownloads: next });
      },
      addCustomLocalModel(entry) {
        const rest = get().customLocalModels.filter((m) => m.id !== entry.id);
        set({ customLocalModels: [...rest, entry] });
      },
      removeCustomLocalModel: (id) =>
        set({ customLocalModels: get().customLocalModels.filter((m) => m.id !== id) }),
      updateVoice: (patch) => set({ voice: { ...get().voice, ...patch } }),
    }),
    {
      name: 'remocode.settings.v1',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);

export async function readApiKey(provider: ProviderId): Promise<string> {
  return (await getSecret(`apikey.${provider}`)) ?? '';
}
