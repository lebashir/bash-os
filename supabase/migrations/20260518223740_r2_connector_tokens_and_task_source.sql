-- Bash OS Round 2 (phase 1) — connector token storage + tasks.source
-- Adds:
--   * connector_tokens: per-user OAuth tokens for external providers
--   * tasks.source: tag each task by its origin (manual or a connector)
--   * partial unique index on (user_id, source, source_id) for connector dedupe

-- ---------------------------------------------------------------------------
-- connector_tokens
-- ---------------------------------------------------------------------------
create table public.connector_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('google')),
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  scopes text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

create trigger connector_tokens_set_updated_at
  before update on public.connector_tokens
  for each row execute function public.set_updated_at();

alter table public.connector_tokens enable row level security;

create policy "connector_tokens_select_own"
  on public.connector_tokens
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "connector_tokens_insert_own"
  on public.connector_tokens
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "connector_tokens_update_own"
  on public.connector_tokens
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "connector_tokens_delete_own"
  on public.connector_tokens
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- tasks.source
-- ---------------------------------------------------------------------------
alter table public.tasks
  add column source text not null default 'manual'
  check (source in ('manual', 'gmail', 'calendar', 'slack', 'jira', 'clickup'));

-- Prevents the same external item from being imported twice for the same user.
-- Manual rows (source_id null) are excluded so users can create duplicate-title
-- tasks freely.
create unique index tasks_user_source_source_id_idx
  on public.tasks (user_id, source, source_id)
  where source_id is not null;
