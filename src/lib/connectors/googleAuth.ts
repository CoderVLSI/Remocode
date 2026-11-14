import * as AuthSession from 'expo-auth-session';
import Constants from 'expo-constants';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { deleteSecret, getSecret, setSecret } from '../secure';

import { GOOGLE_SCOPES } from './google';

WebBrowser.maybeCompleteAuthSession();

const discovery: AuthSession.DiscoveryDocument = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  revocationEndpoint: 'https://oauth2.googleapis.com/revoke',
};

interface StoredTokens {
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms. */
  expiresAt: number;
}

const SECRET = 'google.tokens';

function clientId(): string {
  const id =
    Platform.OS === 'ios'
      ? process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID
      : process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID;
  if (!id) {
    throw new Error(
      `Google sign-in is not configured. Set EXPO_PUBLIC_GOOGLE_${Platform.OS === 'ios' ? 'IOS' : 'ANDROID'}_CLIENT_ID and rebuild.`,
    );
  }
  return id;
}

/** Google's native-app redirect: reversed client id on iOS, package name on Android. */
export function googleRedirectUri(id: string, packageName: string): string {
  return Platform.OS === 'ios'
    ? `com.googleusercontent.apps.${id.replace('.apps.googleusercontent.com', '')}:/oauthredirect`
    : `${packageName}:/oauthredirect`;
}

async function save(tokens: AuthSession.TokenResponse, previousRefresh?: string): Promise<StoredTokens> {
  const stored: StoredTokens = {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken ?? previousRefresh,
    expiresAt: Date.now() + (tokens.expiresIn ?? 3600) * 1000,
  };
  await setSecret(SECRET, JSON.stringify(stored));
  return stored;
}

export async function connectGoogle(): Promise<void> {
  const id = clientId();
  const redirectUri = googleRedirectUri(id, Constants.expoConfig?.android?.package ?? 'app.remocode.mobile');
  const request = new AuthSession.AuthRequest({
    clientId: id,
    redirectUri,
    scopes: GOOGLE_SCOPES,
    responseType: AuthSession.ResponseType.Code,
    usePKCE: true,
    extraParams: { access_type: 'offline', prompt: 'consent' },
  });
  const result = await request.promptAsync(discovery);
  if (result.type !== 'success') throw new Error('Google sign-in was cancelled.');
  const code = result.params.code;
  if (!code || !request.codeVerifier) throw new Error('Google did not return an authorization code.');
  const tokens = await AuthSession.exchangeCodeAsync(
    { clientId: id, code, redirectUri, extraParams: { code_verifier: request.codeVerifier } },
    discovery,
  );
  await save(tokens);
}

export async function disconnectGoogle(): Promise<void> {
  const raw = await getSecret(SECRET);
  await deleteSecret(SECRET);
  if (!raw) return;
  try {
    const t = JSON.parse(raw) as StoredTokens;
    await AuthSession.revokeAsync({ token: t.refreshToken ?? t.accessToken }, discovery);
  } catch {
    // Revocation is best-effort; local tokens are already gone.
  }
}

/** Returns a valid access token, refreshing it when it is about to expire. */
export async function getGoogleAccessToken(): Promise<string> {
  const raw = await getSecret(SECRET);
  if (!raw) throw new Error('Google is not connected. Connect it in Customizations.');
  let tokens = JSON.parse(raw) as StoredTokens;
  if (tokens.expiresAt - 60_000 > Date.now()) return tokens.accessToken;
  if (!tokens.refreshToken) throw new Error('Google access expired. Reconnect Google in Customizations.');
  try {
    const refreshed = await AuthSession.refreshAsync({ clientId: clientId(), refreshToken: tokens.refreshToken }, discovery);
    tokens = await save(refreshed, tokens.refreshToken);
    return tokens.accessToken;
  } catch {
    throw new Error('Google access expired. Reconnect Google in Customizations.');
  }
}
