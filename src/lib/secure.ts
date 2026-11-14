import * as SecureStore from 'expo-secure-store';

import { createChunkedStorage } from './chunkedStorage';
import type { KeyValueBackend } from './chunkedStorage';

/** SecureStore keys may only contain [A-Za-z0-9._-]. */
const safe = (key: string) => key.replace(/[^A-Za-z0-9._-]/g, '_');

const backend: KeyValueBackend = {
  getItem: (key) => SecureStore.getItemAsync(safe(key)),
  setItem: (key, value) => SecureStore.setItemAsync(safe(key), value),
  removeItem: (key) => SecureStore.deleteItemAsync(safe(key)),
};

/** For short secrets such as API keys and tokens. */
export async function getSecret(name: string): Promise<string | null> {
  try {
    return await backend.getItem(`remocode.${name}`);
  } catch {
    return null;
  }
}

export async function setSecret(name: string, value: string): Promise<void> {
  await backend.setItem(`remocode.${name}`, value);
}

export async function deleteSecret(name: string): Promise<void> {
  try {
    await backend.removeItem(`remocode.${name}`);
  } catch {
    // nothing to delete
  }
}

/** Storage adapter for the Supabase auth client (handles values over 2 KB). */
export const authStorage = createChunkedStorage(backend);
