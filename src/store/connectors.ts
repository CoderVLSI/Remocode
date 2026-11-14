import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

interface ConnectorsState {
  /** Mirrors secure storage so the UI can render synchronously. Tokens never live here. */
  github: { connected: boolean; login?: string };
  google: { connected: boolean };
  /** User-level switch: connected services can still be turned off for the model. */
  enabled: { github: boolean; google: boolean };
  setGitHub(v: { connected: boolean; login?: string }): void;
  setGoogle(connected: boolean): void;
  setEnabled(key: 'github' | 'google', on: boolean): void;
}

export const useConnectors = create<ConnectorsState>()(
  persist(
    (set, get) => ({
      github: { connected: false },
      google: { connected: false },
      enabled: { github: true, google: true },
      setGitHub: (github) => set({ github }),
      setGoogle: (connected) => set({ google: { connected } }),
      setEnabled: (key, on) => set({ enabled: { ...get().enabled, [key]: on } }),
    }),
    { name: 'remocode.connectors.v1', storage: createJSONStorage(() => AsyncStorage) },
  ),
);
