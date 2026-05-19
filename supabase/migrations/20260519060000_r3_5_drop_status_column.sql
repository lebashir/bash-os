-- R3.5 — Phase 1, part C: drop the legacy tasks.status column.
--
-- Destructive. Run only after the previous two migrations have applied and
-- the app code is already reading tasks.column_id (Phase 2+). This drops the
-- 7-value status CHECK constraint along with the column itself, and locks
-- tasks.column_id to NOT NULL so future inserts have to pick a column.
--
-- The status -> column_id back-fill in 050000 must have succeeded for this
-- to be safe; it raises an exception if any task row still has a NULL
-- column_id.

-- 1) Drop the existing position index that references status, then drop
--    the column itself. The status CHECK constraint goes with the column.
drop index if exists public.tasks_user_status_position_idx;

alter table public.tasks
  drop column status;

-- 2) Now that no task can be orphan, lock column_id to NOT NULL.
alter table public.tasks
  alter column column_id set not null;
