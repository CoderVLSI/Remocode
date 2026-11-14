import * as FileSystem from 'expo-file-system/legacy';

import type { LocalCatalogEntry } from './localCatalog';

const MODELS_DIR = `${FileSystem.documentDirectory ?? ''}models/`;
/** A GGUF smaller than this is almost certainly an error page, not a model. */
const MIN_VALID_BYTES = 8 * 1024 * 1024;

export interface DownloadHandle {
  promise: Promise<{ uri: string; sizeBytes: number }>;
  cancel(): Promise<void>;
}

async function ensureDir() {
  const info = await FileSystem.getInfoAsync(MODELS_DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(MODELS_DIR, { intermediates: true });
}

export function modelPath(entry: Pick<LocalCatalogEntry, 'filename'>): string {
  return `${MODELS_DIR}${entry.filename}`;
}

/**
 * Downloads to `<file>.part`, validates, then renames, so an interrupted
 * download never looks like an installed model.
 */
export function downloadModel(
  entry: LocalCatalogEntry,
  onProgress: (fraction: number, bytesWritten: number) => void,
): DownloadHandle {
  const finalUri = modelPath(entry);
  const partUri = `${finalUri}.part`;
  let resumable: FileSystem.DownloadResumable | null = null;
  let cancelled = false;

  const promise = (async () => {
    await ensureDir();

    if (entry.sizeBytes > 0) {
      const free = await FileSystem.getFreeDiskStorageAsync().catch(() => Infinity);
      if (free < entry.sizeBytes * 1.1) {
        throw new Error('Not enough free storage for this model.');
      }
    }

    await FileSystem.deleteAsync(partUri, { idempotent: true });
    resumable = FileSystem.createDownloadResumable(entry.url, partUri, {}, (p) => {
      const total = p.totalBytesExpectedToWrite || entry.sizeBytes || 0;
      onProgress(total > 0 ? Math.min(1, p.totalBytesWritten / total) : 0, p.totalBytesWritten);
    });

    const result = await resumable.downloadAsync();
    if (cancelled || !result) {
      await FileSystem.deleteAsync(partUri, { idempotent: true });
      throw new Error('Download cancelled.');
    }
    if (result.status < 200 || result.status >= 300) {
      await FileSystem.deleteAsync(partUri, { idempotent: true });
      throw new Error(`Download failed (HTTP ${result.status}).`);
    }
    const info = await FileSystem.getInfoAsync(partUri);
    const size = info.exists && 'size' in info ? info.size : 0;
    if (size < MIN_VALID_BYTES) {
      await FileSystem.deleteAsync(partUri, { idempotent: true });
      throw new Error('The downloaded file is too small to be a model. Check the URL.');
    }
    await FileSystem.deleteAsync(finalUri, { idempotent: true });
    await FileSystem.moveAsync({ from: partUri, to: finalUri });
    return { uri: finalUri, sizeBytes: size };
  })();

  return {
    promise,
    async cancel() {
      cancelled = true;
      try {
        await resumable?.pauseAsync();
      } catch {
        // already finished
      }
      await FileSystem.deleteAsync(partUri, { idempotent: true });
    },
  };
}

export async function deleteModelFile(entry: Pick<LocalCatalogEntry, 'filename'>): Promise<void> {
  await FileSystem.deleteAsync(modelPath(entry), { idempotent: true });
}

export async function modelFileExists(uri: string): Promise<boolean> {
  try {
    return (await FileSystem.getInfoAsync(uri)).exists;
  } catch {
    return false;
  }
}
