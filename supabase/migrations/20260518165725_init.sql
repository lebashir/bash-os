-- Bash OS Round 1 — initial schema
-- Tables: tasks (kanban), memories (future use, pgvector-backed)
-- Auth: RLS gated by auth.uid() = user_id on every row

-- Extensions
create extension if not exists "pgcrypto";
create extension if not exists "vector";

-- ---------------------------------------------------------------------------
-- updated_at trigger function (shared)
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- tasks
-- ---------------------------------------------------------------------------
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  status text not null default 'things to think about'
    check (status in (
      'things to think about',
      'on the menu',
      'todays plate',
      'Bash work',
      'Claude work',
      'Boss Check',
      'DIgested.'
    )),
  source_id text,
  description text,
  priority text check (priority in ('low', 'normal', 'high', 'urgent')),
  due_date timestamptz,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tasks_user_status_position_idx
  on public.tasks (user_id, status, position);

create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

alter table public.tasks enable row level security;

create policy "tasks_select_own"
  on public.tasks
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "tasks_insert_own"
  on public.tasks
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "tasks_update_own"
  on public.tasks
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "tasks_delete_own"
  on public.tasks
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- memories (reserved for Round 2+; schema in place now to avoid later churn)
-- ---------------------------------------------------------------------------
create table public.memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null,
  embedding vector(1536),
  tags text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index memories_user_idx on public.memories (user_id);

alter table public.memories enable row level security;

create policy "memories_select_own"
  on public.memories
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "memories_insert_own"
  on public.memories
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "memories_update_own"
  on public.memories
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "memories_delete_own"
  on public.memories
  for delete
  to authenticated
  using (auth.uid() = user_id);
