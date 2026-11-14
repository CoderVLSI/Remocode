import type { Session, User } from '@supabase/supabase-js';
import { create } from 'zustand';

import { normalizeEmail } from '@/lib/authValidation';
import { isBackendConfigured, loadSavedBackend, onBackendChange, startAuthAppStateRefresh, supabase } from '@/lib/supabase';

export type VerifyKind = 'email' | 'signup';

interface AuthState {
  session: Session | null;
  user: User | null;
  /** True once the stored session has been read; avoids flashing the sign-in screen. */
  ready: boolean;
  init(): () => void;
  /** Sends a one-time code (creates the account on first use). */
  sendCode(email: string): Promise<void>;
  verifyCode(email: string, code: string, kind: VerifyKind): Promise<void>;
  signInWithPassword(email: string, password: string): Promise<void>;
  /** Returns true when the email must be confirmed with a code before sign-in completes. */
  signUpWithPassword(email: string, password: string): Promise<boolean>;
  signOut(): Promise<void>;
}

function throwIfError(error: { message: string } | null): void {
  if (error) throw error;
}

export const useAuth = create<AuthState>((set) => ({
  session: null,
  user: null,
  ready: false,

  init() {
    let unsubscribeAuth: (() => void) | null = null;
    let cancelled = false;
    // Only the most recent attach may install a listener; earlier ones that are still awaiting bail out.
    let generation = 0;

    // (Re)attaches to whichever backend is configured right now.
    const attach = async () => {
      const mine = ++generation;
      const stale = () => cancelled || mine !== generation;
      unsubscribeAuth?.();
      unsubscribeAuth = null;
      await loadSavedBackend();
      if (stale()) return;
      if (!isBackendConfigured()) {
        set({ session: null, user: null, ready: true });
        return;
      }
      startAuthAppStateRefresh();
      try {
        const { data } = await supabase.auth.getSession();
        if (stale()) return;
        set({ session: data.session, user: data.session?.user ?? null, ready: true });
      } catch {
        if (!stale()) set({ ready: true });
      }
      if (stale()) return;
      const { data } = supabase.auth.onAuthStateChange((_event, session) => {
        set({ session, user: session?.user ?? null, ready: true });
      });
      unsubscribeAuth = () => data.subscription.unsubscribe();
    };

    void attach();
    // Entering or changing the backend inside the app re-attaches without a restart.
    const stopWatching = onBackendChange(() => void attach());
    return () => {
      cancelled = true;
      stopWatching();
      unsubscribeAuth?.();
    };
  },

  async sendCode(email) {
    const { error } = await supabase.auth.signInWithOtp({
      email: normalizeEmail(email),
      options: { shouldCreateUser: true },
    });
    throwIfError(error);
  },

  async verifyCode(email, code, kind) {
    const { error } = await supabase.auth.verifyOtp({ email: normalizeEmail(email), token: code, type: kind });
    throwIfError(error);
  },

  async signInWithPassword(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email: normalizeEmail(email), password });
    throwIfError(error);
  },

  async signUpWithPassword(email, password) {
    const { data, error } = await supabase.auth.signUp({ email: normalizeEmail(email), password });
    throwIfError(error);
    // With "Confirm email" enabled Supabase returns a user but no session until the code is entered.
    return !data.session;
  },

  async signOut() {
    await supabase.auth.signOut();
    set({ session: null, user: null });
  },
}));
