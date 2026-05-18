-- R2.5 — Briefs get their own table.
--
-- The R2 daily brief was stored as a row in public.tasks with source='brief'.
-- That was expedient (no migration, reuse the kanban surface) but wrong: a
-- brief isn't a task — it has no column, no priority, no position semantics,
-- and "one per day" needs DB-level enforcement instead of an ad-hoc delete in
-- the cron path. R2.5 lifts briefs into their own table with a unique-per-day
-- constraint and a dedicated UI surface, and removes the brief escape hatch
-- from tasks.source so future code can't accidentally re-conflate them.
--
-- DESTRUCTIVE: this migration deletes any existing brief rows from public.tasks.
-- Brief-task rows can't be cleanly migrated to public.briefs because the old
-- schema didn't capture brief_date in a way that survives without title
-- string-parsing, and there's no historical brief data worth preserving (R2
-- only shipped on 2026-05-18). See docs/ARCHITECTURE.md → "Briefs vs tasks".

-- ---------------------------------------------------------------------------
-- briefs
-- ---------------------------------------------------------------------------
create table public.briefs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  brief_date date not null,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, brief_date)
);

create index briefs_user_date_idx
  on public.briefs (user_id, brief_date desc);

create trigger briefs_set_updated_at
  before update on public.briefs
  for each row execute function public.set_updated_at();

alter table public.briefs enable row level security;

create policy "briefs_select_own"
  on public.briefs
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "briefs_insert_own"
  on public.briefs
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "briefs_update_own"
  on public.briefs
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "briefs_delete_own"
  on public.briefs
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Retire the brief-as-task escape hatch
-- ---------------------------------------------------------------------------

-- 1) Drop any existing brief-tasks. There's no path to migrate these into
--    public.briefs without parsing the title for the date; the new cron run
--    will re-generate today's brief into the new table on its next firing.
delete from public.tasks where source = 'brief';

-- 2) Remove 'brief' from the tasks.source CHECK so future writes can't put
--    briefs back into the kanban.
alter table public.tasks
  drop constraint tasks_source_check;

alter table public.tasks
  add constraint tasks_source_check
  check (source in (
    'manual',
    'gmail',
    'calendar',
    'slack',
    'jira',
    'clickup'
  ));
