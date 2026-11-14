import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import { validateConvexUrl } from '@/lib/convexUrl';

const STORAGE_KEY = 'remocode.backend.v2';

/** A URL baked in at build time (EXPO_PUBLIC_CONVEX_URL) wins; otherwise the one entered in the app. */
function fromEnv(): string | null {
  const raw = process.env.EXPO_PUBLIC_CONVEX_URL;
  if (!raw) return null;
  const result = validateConvexUrl(raw);
  return result.ok ? result.url : null;
}

interface BackendState {
  /** The Convex deployment this app talks to, or null until one is set. */
  url: string | null;
  /** True once the saved URL has been read, so the UI does not flash the setup screen. */
  loaded: boolean;
  load(): Promise<void>;
  /** Validates, saves and switches. Returns an error message, or null on success. */
  save(raw: string): Promise<string | null>;
  clear(): Promise<void>;
}

export const useBackend = create<BackendState>((set, get) => ({
  url: fromEnv(),
  loaded: false,

  async load() {
    if (get().loaded) return;
    if (!get().url) {
      try {
        const saved = await AsyncStorage.getItem(STORAGE_KEY);
        const result = saved ? validateConvexUrl(saved) : null;
        if (result?.ok) set({ url: result.url });
      } catch {
        // unreadable storage: stay unconfigured and let the user enter it again
      }
    }
    set({ loaded: true });
  },

  async save(raw) {
    const result = validateConvexUrl(raw);
    if (!result.ok) return result.error;
    await AsyncStorage.setItem(STORAGE_KEY, result.url);
    set({ url: result.url });
    return null;
  },

  async clear() {
    await AsyncStorage.removeItem(STORAGE_KEY);
    set({ url: fromEnv() });
  },
}));

export function backendHost(url: string | null): string | null {
  try {
    return url ? new URL(url).host : null;
  } catch {
    return null;
  }
}
