import { cancelTask, createTask, getTask, listDevices, listEvents } from './api';
import type { RemoteApi } from './voiceTools';

/** The real Remote Control API for the voice tools. */
export const liveRemoteApi: RemoteApi = {
  listDevices,
  createTask,
  getTask,
  listEvents,
  cancelTask,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => Date.now(),
};
