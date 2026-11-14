import type { ConvexReactClient } from 'convex/react';

import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';

import type { Device, RemoteEvent, RemoteTask } from './model';
import type { RemoteApi } from './voiceTools';

/** The real Remote Control API for the voice tools, backed by the signed-in Convex client. */
export function liveRemoteApi(client: ConvexReactClient): RemoteApi {
  return {
    listDevices: () => client.query(api.devices.list, {}) as Promise<Device[]>,
    createTask: (deviceId, prompt) => client.mutation(api.tasks.create, { deviceId: deviceId as Id<'devices'>, prompt }) as Promise<string>,
    getTask: (id) => client.query(api.tasks.get, { taskId: id as Id<'tasks'> }) as Promise<RemoteTask | null>,
    listEvents: (id) => client.query(api.tasks.events, { taskId: id as Id<'tasks'> }) as Promise<RemoteEvent[]>,
    cancelTask: async (id) => {
      await client.mutation(api.tasks.cancel, { taskId: id as Id<'tasks'> });
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => Date.now(),
  };
}
