import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';

import { classifyUpload, isProbablyTextFile } from './uploads';
import type { UploadResult } from './uploads';

/**
 * Lets the user pick one or more text/code files from the device and reads them.
 * Returns one result per file (accepted or rejected with a reason), or null if cancelled.
 */
export async function pickTextFiles(): Promise<UploadResult[] | null> {
  const picked = await DocumentPicker.getDocumentAsync({
    type: '*/*',
    multiple: true,
    // A cached copy is always readable, whichever app the file came from.
    copyToCacheDirectory: true,
  });
  if (picked.canceled) return null;

  const results: UploadResult[] = [];
  for (const asset of picked.assets) {
    const meta = { name: asset.name, size: asset.size ?? null, mimeType: asset.mimeType ?? null };
    // Do not even read files that are obviously not text (images, archives, …).
    let content: string | null = null;
    if (isProbablyTextFile(meta) || !asset.mimeType) {
      try {
        content = await FileSystem.readAsStringAsync(asset.uri);
      } catch {
        content = null;
      }
    }
    results.push(classifyUpload(meta, content));
  }
  return results;
}
