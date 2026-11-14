import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';

import { configFromEnv, validateBackendConfig } from './backendConfig';
import type { BackendConfig } from './backendConfig';
import { authStorage } from './secure';

const STORAGE_KEY = 'remocode.backend.v1';

/**
 * The backend can come from build-time env vars or be entered inside the app, so a prebuilt APK
 * works with anyone's own Supabase project. The anon key is public by design (row-level security
 * is what protects data), but the validator still refuses service-role keys.
 */
let config: BackendConfig | null = configFromEnv(process.env.EXPO_PUBLIC_SUPABASE_URL, process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);
let client: SupabaseClient | null = null;
let appStateSubscribed = false;
const listeners = new Set<() => void>();

function createFor(cfg: BackendConfig): SupabaseClient {
  return createClient(cfg.url, cfg.anonKey, {
    auth: {
      storage: authStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      flowType: 'pkce',
    },
  });
}

function ensureClient(): SupabaseClient | null {
  if (!client && config) client = createFor(config);
  return client;
}

export function isBackendConfigured(): boolean {
  return config !== null;
}

export function getBackendHost(): string | null {
  return config ? new URL(config.url).host : null;
}

export function getSupabase(): SupabaseClient {
  const c = ensureClient();
  if (!c) throw new Error('The backend is not set up yet. Enter your Supabase URL and anon key on the sign-in screen.');
  return c;
}

/** Stable handle used across the app; always delegates to the current client. */
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const c = getSupabase();
    const value = Reflect.get(c, prop);
    return typeof value === 'function' ? value.bind(c) : value;
  },
});

export function onBackendChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Loads a connection saved inside the app (build-time env wins if it is valid). */
export async function loadSavedBackend(): Promise<void> {
  if (config) return;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw) as Partial<BackendConfig>;
    const result = validateBackendConfig(saved.url ?? '', saved.anonKey ?? '');
    if (result.ok) config = result.config;
  } catch {
    // unreadable storage: stay unconfigured and let the user enter it again
  }
}

/** Validates, saves and switches to a new backend. Returns an error message, or null on success. */
export async function saveBackend(urlRaw: string, keyRaw: string): Promise<string | null> {
  const result = validateBackendConfig(urlRaw, keyRaw);
  if (!result.ok) return result.error;
  try {
    client?.auth.stopAutoRefresh();
  } catch {
    // the previous client may already be gone
  }
  config = result.config;
  client = null;
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(result.config));
  startAuthAppStateRefresh();
  for (const fn of listeners) fn();
  return null;
}

export async function clearBackend(): Promise<void> {
  try {
    client?.auth.stopAutoRefresh();
  } catch {
    // ignore
  }
  config = null;
  client = null;
  await AsyncStorage.removeItem(STORAGE_KEY);
  for (const fn of listeners) fn();
}

// Refresh tokens only while the app is in the foreground (Supabase's React Native guidance).
export function startAuthAppStateRefresh(): void {
  const c = ensureClient();
  if (!c) return;
  if (AppState.currentState === 'active') c.auth.startAutoRefresh();
  if (appStateSubscribed) return;
  appStateSubscribed = true;
  AppState.addEventListener('change', (state) => {
    const current = client;
    if (!current) return;
    if (state === 'active') current.auth.startAutoRefresh();
    else current.auth.stopAutoRefresh();
  });
}
