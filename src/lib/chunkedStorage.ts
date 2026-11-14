/**
 * Supabase session storage on top of a small-value secure store.
 *
 * Auth sessions (JWT + refresh token + user) exceed SecureStore's ~2 KB value
 * limit, so values are split into chunks. The backend is injected so this is
 * unit-testable without native modules.
 */
export interface KeyValueBackend {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export const CHUNK_SIZE = 1800;

export function createChunkedStorage(backend: KeyValueBackend, chunkSize = CHUNK_SIZE): KeyValueBackend {
  const countKey = (k: string) => `${k}.n`;
  const chunkKey = (k: string, i: number) => `${k}.${i}`;

  async function readCount(key: string): Promise<number> {
    const raw = await backend.getItem(countKey(key));
    const n = raw === null ? 0 : Number(raw);
    return Number.isInteger(n) && n > 0 ? n : 0;
  }

  async function removeItem(key: string): Promise<void> {
    const n = await readCount(key);
    for (let i = 0; i < n; i++) await backend.removeItem(chunkKey(key, i));
    await backend.removeItem(countKey(key));
  }

  return {
    async getItem(key) {
      const n = await readCount(key);
      if (n === 0) return null;
      let out = '';
      for (let i = 0; i < n; i++) {
        const part = await backend.getItem(chunkKey(key, i));
        if (part === null) return null; // torn write: treat as signed out rather than crash
        out += part;
      }
      return out;
    },
    async setItem(key, value) {
      const previous = await readCount(key);
      const chunks: string[] = [];
      for (let i = 0; i < value.length; i += chunkSize) chunks.push(value.slice(i, i + chunkSize));
      if (chunks.length === 0) chunks.push('');
      // Write chunks first and the count last, so a crash never exposes a partial value.
      for (let i = 0; i < chunks.length; i++) await backend.setItem(chunkKey(key, i), chunks[i]);
      await backend.setItem(countKey(key), String(chunks.length));
      for (let i = chunks.length; i < previous; i++) await backend.removeItem(chunkKey(key, i));
    },
    removeItem,
  };
}
