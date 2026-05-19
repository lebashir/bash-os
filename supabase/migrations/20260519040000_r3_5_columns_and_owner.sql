-- R3.5 — Phase 1, part A: schema for user-managed columns + owner + supporting tables.
--
-- This migration is purely additive. It creates the new tables (columns,
-- task_events, recurrences, agent_events, pending_emails) and adds new
-- columns to tasks (column_id NULLABLE for now, owner, needs_review, tags,
-- snoozed_until). The existing tasks.status CHECK constraint stays in place
-- until the third R3.5 migration so the app keeps working between deploys.
--
-- The follow-up migrations are:
--   _050000_r3_5_seed_columns_and_migrate_tasks.sql — seeds starter columns
--     per user and back-fills tasks.column_id + owner from the legacy status.
--   _060000_r3_5_drop_status_column.sql            — drops tasks.status and
--     enforces NOT NULL on tasks.column_id.
--
-- See docs/ROUNDS.md → R3.5 and docs/ARCHITECTURE.md → "Custom columns +
-- owner model".

-- ---------------------------------------------------------------------------
-- columns — user-managed kanban columns (replaces the 7-value status CHECK)
-- ---------------------------------------------------------------------------
create table public.columns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  position integer not null,
  icon text,
  accent_color text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, position) deferrable initially deferred,
  unique (user_id, name)
);

create index columns_user_position_idx
  on public.columns (user_id, position);

alter table public.columns enable row level security;

create policy "columns_select_own"
  on public.columns
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "columns_insert_own"
  on public.columns
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "columns_update_own"
  on public.columns
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "columns_delete_own"
  on public.columns
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- task_events — append-only event log for the timeline panel
-- ---------------------------------------------------------------------------
create table public.task_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete cascade,
  event_type text not null check (event_type in (
    'created',
    'completed',
    'moved',
    'updated',
    'deleted',
    'importance_set'
  )),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index task_events_user_created_idx
  on public.task_events (user_id, created_at desc);

create index task_events_task_idx
  on public.task_events (task_id);

alter table public.task_events enable row level security;

create policy "task_events_select_own"
  on public.task_events
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "task_events_insert_own"
  on public.task_events
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "task_events_update_own"
  on public.task_events
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "task_events_delete_own"
  on public.task_events
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- recurrences — recurring task templates, fired by the hourly cron
-- ---------------------------------------------------------------------------
create table public.recurrences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  template_task_id uuid not null references public.tasks(id) on delete cascade,
  cadence text not null check (cadence in (
    'daily',
    'weekly',
    'monthly',
    'annually',
    'custom'
  )),
  cron_expression text,
  next_fire_at timestamptz not null,
  last_fired_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index recurrences_user_idx
  on public.recurrences (user_id);

create index recurrences_next_fire_idx
  on public.recurrences (next_fire_at)
  where active = true;

create trigger recurrences_set_updated_at
  before update on public.recurrences
  for each row execute function public.set_updated_at();

alter table public.recurrences enable row level security;

create policy "recurrences_select_own"
  on public.recurrences
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "recurrences_insert_own"
  on public.recurrences
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "recurrences_update_own"
  on public.recurrences
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "recurrences_delete_own"
  on public.recurrences
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- agent_events — external + internal agent activity feed
-- ---------------------------------------------------------------------------
create table public.agent_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null,
  project text,
  action text not null,
  target text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index agent_events_user_created_idx
  on public.agent_events (user_id, created_at desc);

alter table public.agent_events enable row level security;

create policy "agent_events_select_own"
  on public.agent_events
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "agent_events_insert_own"
  on public.agent_events
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "agent_events_update_own"
  on public.agent_events
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "agent_events_delete_own"
  on public.agent_events
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- pending_emails — score-4-to-7 messages awaiting triage decision
-- ---------------------------------------------------------------------------
create table public.pending_emails (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  gmail_message_id text not null,
  subject text not null,
  sender text not null,
  snippet text,
  score smallint not null,
  received_at timestamptz,
  snoozed_until timestamptz,
  inserted_at timestamptz not null default now(),
  unique (user_id, gmail_message_id)
);

create index pending_emails_user_inserted_idx
  on public.pending_emails (user_id, inserted_at desc);

alter table public.pending_emails enable row level security;

create policy "pending_emails_select_own"
  on public.pending_emails
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "pending_emails_insert_own"
  on public.pending_emails
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "pending_emails_update_own"
  on public.pending_emails
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "pending_emails_delete_own"
  on public.pending_emails
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- tasks — add column_id (nullable), owner, needs_review, tags, snoozed_until
-- ---------------------------------------------------------------------------
alter table public.tasks
  add column column_id uuid references public.columns(id) on delete restrict;

alter table public.tasks
  add column owner text not null default 'bash'
    check (owner in ('bash', 'claude'));

alter table public.tasks
  add column needs_review boolean not null default false;

alter table public.tasks
  add column tags text[] not null default '{}';

alter table public.tasks
  add column snoozed_until timestamptz;

create index tasks_user_column_position_idx
  on public.tasks (user_id, column_id, position);

create index tasks_owner_idx
  on public.tasks (user_id, owner);

create index tasks_snoozed_idx
  on public.tasks (snoozed_until)
  where snoozed_until is not null;
