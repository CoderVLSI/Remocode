import { ConvexAuthProvider } from '@convex-dev/auth/react';
import { ConvexReactClient, useConvexAuth } from 'convex/react';
import type { ReactNode } from 'react';
import { useEffect, useMemo } from 'react';

import { authStorage } from '@/lib/secure';
import { useAuth } from '@/store/auth';
import { useBackend } from '@/store/backend';

/** Mirrors Convex's auth state into the small store the router reads. */
function AuthBridge() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const set = useAuth((s) => s.set);
  useEffect(() => {
    set({ ready: !isLoading, signedIn: isAuthenticated });
  }, [isLoading, isAuthenticated, set]);
  return null;
}

/**
 * Connects the app to the user's Convex deployment. With no deployment URL yet there is no
 * provider (and the sign-in screen asks for the URL); changing the URL swaps in a new client.
 */
export function BackendProvider({ children }: { children: ReactNode }) {
  const url = useBackend((s) => s.url);
  const loaded = useBackend((s) => s.loaded);
  const setAuth = useAuth((s) => s.set);

  useEffect(() => {
    void useBackend.getState().load();
  }, []);

  const client = useMemo(() => (url ? new ConvexReactClient(url, { unsavedChangesWarning: false }) : null), [url]);

  useEffect(() => {
    return () => {
      void client?.close();
    };
  }, [client]);

  // Without a backend nobody can be signed in; the app is "ready" to show the setup screen.
  useEffect(() => {
    if (loaded && !client) setAuth({ ready: true, signedIn: false });
  }, [loaded, client, setAuth]);

  if (!loaded) return null;
  if (!client) return <>{children}</>;

  return (
    <ConvexAuthProvider
      client={client}
      storage={authStorage}
      // This is a native app: there is no URL to read a sign-in code from.
      shouldHandleCode={() => false}
    >
      <AuthBridge />
      {children}
    </ConvexAuthProvider>
  );
}
