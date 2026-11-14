import { create } from 'zustand';

import { downloadModel, deleteModelFile } from '@/lib/llm/localModels';
import type { DownloadHandle } from '@/lib/llm/localModels';
import type { LocalCatalogEntry } from '@/lib/llm/localCatalog';
import { unloadLocalModel } from '@/lib/llm/providers/local';

import { useSettings } from './settings';

interface DownloadState {
  /** Fraction 0..1 for each model id currently downloading. */
  progress: Record<string, number>;
  errors: Record<string, string | undefined>;
  start(entry: LocalCatalogEntry): void;
  cancel(id: string): void;
  remove(entry: LocalCatalogEntry): Promise<void>;
}

// Handles live outside React state so leaving the screen does not cancel a download.
const handles = new Map<string, DownloadHandle>();

export const useDownloads = create<DownloadState>((set, get) => ({
  progress: {},
  errors: {},

  start(entry) {
    if (handles.has(entry.id)) return;
    set({ progress: { ...get().progress, [entry.id]: 0 }, errors: { ...get().errors, [entry.id]: undefined } });
    const handle = downloadModel(entry, (fraction) => {
      // Throttle to ~1% steps so a fast download does not re-render on every chunk.
      const prev = get().progress[entry.id] ?? 0;
      if (fraction - prev >= 0.01 || fraction === 1) set({ progress: { ...get().progress, [entry.id]: fraction } });
    });
    handles.set(entry.id, handle);
    handle.promise
      .then((result) => {
        useSettings.getState().setLocalDownload(entry.id, result);
        if (entry.custom) useSettings.getState().addCustomLocalModel(entry);
      })
      .catch((err: Error) => {
        if (!/cancelled/i.test(err.message)) set({ errors: { ...get().errors, [entry.id]: err.message } });
      })
      .finally(() => {
        handles.delete(entry.id);
        const { [entry.id]: _done, ...rest } = get().progress;
        set({ progress: rest });
      });
  },

  cancel(id) {
    void handles.get(id)?.cancel();
  },

  async remove(entry) {
    await unloadLocalModel();
    await deleteModelFile(entry);
    useSettings.getState().setLocalDownload(entry.id, null);
    if (entry.custom) useSettings.getState().removeCustomLocalModel(entry.id);
  },
}));
