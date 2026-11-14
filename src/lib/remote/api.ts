import { supabase } from '../supabase';

import type { Device, RemoteEvent, RemoteTask } from './model';

function check<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
}

export async function listDevices(): Promise<Device[]> {
  return check(
    await supabase.from('devices').select('id,name,platform,last_seen_at').order('last_seen_at', { ascending: false }),
  );
}

export async function deleteDevice(id: string): Promise<void> {
  check(await supabase.from('devices').delete().eq('id', id).select('id'));
}

export async function listTasks(deviceId: string, limit = 20): Promise<RemoteTask[]> {
  return check(
    await supabase
      .from('remote_tasks')
      .select('id,device_id,prompt,status,exit_code,created_at,started_at,finished_at')
      .eq('device_id', deviceId)
      .order('created_at', { ascending: false })
      .limit(limit),
  );
}

export async function getTask(id: string): Promise<RemoteTask | null> {
  const { data, error } = await supabase
    .from('remote_tasks')
    .select('id,device_id,prompt,status,exit_code,created_at,started_at,finished_at')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as RemoteTask | null;
}

export async function createTask(deviceId: string, prompt: string): Promise<RemoteTask> {
  const text = prompt.trim();
  if (!text) throw new Error('Enter a task first.');
  return check(
    await supabase
      .from('remote_tasks')
      .insert({ device_id: deviceId, prompt: text })
      .select('id,device_id,prompt,status,exit_code,created_at,started_at,finished_at')
      .single(),
  );
}

/** Only cancels tasks that have not already finished. */
export async function cancelTask(id: string): Promise<void> {
  check(
    await supabase
      .from('remote_tasks')
      .update({ status: 'cancelled', finished_at: new Date().toISOString() })
      .eq('id', id)
      .in('status', ['queued', 'running'])
      .select('id'),
  );
}

export async function listEvents(taskId: string, afterId = 0): Promise<RemoteEvent[]> {
  return check(
    await supabase
      .from('remote_events')
      .select('id,task_id,kind,data,created_at')
      .eq('task_id', taskId)
      .gt('id', afterId)
      .order('id', { ascending: true })
      .limit(500),
  );
}

/** Subscribes to device presence changes. Returns an unsubscribe function. */
export function subscribeDevices(onChange: () => void): () => void {
  const channel = supabase
    .channel('devices')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'devices' }, onChange)
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

/** Subscribes to live events and status changes for one task. */
export function subscribeTask(
  taskId: string,
  handlers: { onEvent: (e: RemoteEvent) => void; onTask: (t: RemoteTask) => void },
): () => void {
  const channel = supabase
    .channel(`task:${taskId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'remote_events', filter: `task_id=eq.${taskId}` },
      (payload) => handlers.onEvent(payload.new as RemoteEvent),
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'remote_tasks', filter: `id=eq.${taskId}` },
      (payload) => handlers.onTask(payload.new as RemoteTask),
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}
