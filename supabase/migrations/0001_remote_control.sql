-- Remote Control relay: phone -> Supabase -> companion on your computer.
-- Everything is owned by a single user and protected by row level security, so
-- one account can never see or drive another account's devices.

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  platform text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.remote_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  device_id uuid not null references public.devices (id) on delete cascade,
  prompt text not null check (char_length(prompt) between 1 and 20000),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'done', 'failed', 'cancelled')),
  exit_code integer,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create table public.remote_events (
  id bigint generated always as identity primary key,
  task_id uuid not null references public.remote_tasks (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('stdout', 'stderr', 'info')),
  data text not null check (char_length(data) <= 65536),
  created_at timestamptz not null default now()
);

create index remote_tasks_device_status_idx on public.remote_tasks (device_id, status, created_at);
create index remote_tasks_user_created_idx on public.remote_tasks (user_id, created_at desc);
create index remote_events_task_idx on public.remote_events (task_id, id);

alter table public.devices enable row level security;
alter table public.remote_tasks enable row level security;
alter table public.remote_events enable row level security;

-- devices: owner only
create policy "devices_select_own" on public.devices for select using (user_id = auth.uid());
create policy "devices_insert_own" on public.devices for insert with check (user_id = auth.uid());
create policy "devices_update_own" on public.devices for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "devices_delete_own" on public.devices for delete using (user_id = auth.uid());

-- tasks: owner only, and a task may only target one of the owner's own devices
create policy "tasks_select_own" on public.remote_tasks for select using (user_id = auth.uid());
create policy "tasks_insert_own" on public.remote_tasks for insert with check (
  user_id = auth.uid()
  and exists (select 1 from public.devices d where d.id = device_id and d.user_id = auth.uid())
);
create policy "tasks_update_own" on public.remote_tasks for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "tasks_delete_own" on public.remote_tasks for delete using (user_id = auth.uid());

-- events: owner only, and only for the owner's own tasks
create policy "events_select_own" on public.remote_events for select using (user_id = auth.uid());
create policy "events_insert_own" on public.remote_events for insert with check (
  user_id = auth.uid()
  and exists (select 1 from public.remote_tasks t where t.id = task_id and t.user_id = auth.uid())
);
create policy "events_delete_own" on public.remote_events for delete using (user_id = auth.uid());

-- Live updates to the phone (Realtime enforces the policies above).
alter publication supabase_realtime add table public.devices;
alter publication supabase_realtime add table public.remote_tasks;
alter publication supabase_realtime add table public.remote_events;
