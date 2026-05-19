-- R3.5 — Phase 1, part B: seed starter columns + back-fill tasks.column_id / owner.
--
-- For every user that has at least one task row, insert the 5 starter columns
-- (Inbox / Today / Active / Review / Done) with the exact icons, accent colors
-- and positions defined in the R3.5 spec. Then UPDATE every task to set
-- column_id + owner + needs_review based on its legacy status value:
--
--   'things to think about' -> Inbox,  owner = bash
--   'on the menu'           -> Inbox,  owner = bash
--   'todays plate'          -> Today,  owner = bash
--   'Bash work'             -> Active, owner = bash
--   'Claude work'           -> Active, owner = claude
--   'Boss Check'            -> Review, owner = claude, needs_review = true
--   'DIgested.'             -> Done,   owner = bash
--
-- This migration assumes the previous migration has already run (column_id
-- exists on tasks and the columns table exists) and that tasks.status is
-- still in place (it's dropped in the third migration).

-- 1) Seed the 5 starter columns for every distinct user that owns a task.
--    The (user_id, name) unique constraint makes this safely re-runnable:
--    a partial re-run will fail loudly on already-seeded users rather than
--    silently inserting duplicates. The (user_id, position) constraint is
--    DEFERRABLE INITIALLY DEFERRED so positions resolve at COMMIT time.
insert into public.columns (user_id, name, position, icon, accent_color, is_default)
select t.user_id, c.name, c.position, c.icon, c.accent_color, true
from (select distinct user_id from public.tasks) t
cross join (values
  ('Inbox',   0, 'ti-inbox',        '#7a7a80'),
  ('Today',   1, 'ti-target',       '#5e8aff'),
  ('Active',  2, 'ti-player-play',  '#5e8aff'),
  ('Review',  3, 'ti-eye',          '#f5a23a'),
  ('Done',    4, 'ti-check',        '#5a5a60')
) as c(name, position, icon, accent_color);

-- 2) Back-fill tasks.column_id, tasks.owner, tasks.needs_review from the
--    legacy status value. One UPDATE per target column keeps the joins
--    simple and the row count obvious in psql.
update public.tasks t
set
  column_id = c.id,
  owner = 'bash'
from public.columns c
where c.user_id = t.user_id
  and c.name = 'Inbox'
  and t.status in ('things to think about', 'on the menu');

update public.tasks t
set
  column_id = c.id,
  owner = 'bash'
from public.columns c
where c.user_id = t.user_id
  and c.name = 'Today'
  and t.status = 'todays plate';

update public.tasks t
set
  column_id = c.id,
  owner = 'bash'
from public.columns c
where c.user_id = t.user_id
  and c.name = 'Active'
  and t.status = 'Bash work';

update public.tasks t
set
  column_id = c.id,
  owner = 'claude'
from public.columns c
where c.user_id = t.user_id
  and c.name = 'Active'
  and t.status = 'Claude work';

update public.tasks t
set
  column_id = c.id,
  owner = 'claude',
  needs_review = true
from public.columns c
where c.user_id = t.user_id
  and c.name = 'Review'
  and t.status = 'Boss Check';

update public.tasks t
set
  column_id = c.id,
  owner = 'bash'
from public.columns c
where c.user_id = t.user_id
  and c.name = 'Done'
  and t.status = 'DIgested.';

-- 3) Verify zero tasks remain with a NULL column_id. The DO block raises
--    EXCEPTION on a non-zero count so the migration aborts before the
--    third migration tries to ALTER column_id to NOT NULL.
do $$
declare
  orphan_count integer;
begin
  select count(*) into orphan_count
  from public.tasks
  where column_id is null;

  if orphan_count > 0 then
    raise exception 'R3.5 migration: % task rows have null column_id after back-fill — aborting.', orphan_count;
  end if;
end;
$$;
