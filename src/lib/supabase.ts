import 'react-native-url-polyfill/auto';

import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';

import { authStorage } from './secure';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/** False until real Supabase credentials are provided; the UI shows setup help instead of crashing. */
export const isSupabaseConfigured = Boolean(url && anonKey && !url.includes('YOUR-PROJECT') && !anonKey.startsWith('YOUR-'));

export const supabase = createClient(url || 'http://localhost:54321', anonKey || 'not-configured', {
  auth: {
    storage: authStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: 'pkce',
  },
});

// Refresh tokens only while the app is in the foreground (Supabase's React Native guidance).
let subscribed = false;
export function startAuthAppStateRefresh(): void {
  if (subscribed || !isSupabaseConfigured) return;
  subscribed = true;
  if (AppState.currentState === 'active') supabase.auth.startAutoRefresh();
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
