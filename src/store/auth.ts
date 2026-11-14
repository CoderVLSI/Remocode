import { create } from 'zustand';

/**
 * Sign-in state for routing. Convex owns the real session (see AuthBridge, which mirrors it here);
 * screens call `useAuthActions()` from @convex-dev/auth/react to sign in or out.
 */
interface AuthState {
  /** False until we know whether a saved session exists (avoids flashing the sign-in screen). */
  ready: boolean;
  signedIn: boolean;
  set(next: { ready: boolean; signedIn: boolean }): void;
}

export const useAuth = create<AuthState>((set) => ({
  ready: false,
  signedIn: false,
  set: (next) => set(next),
}));
