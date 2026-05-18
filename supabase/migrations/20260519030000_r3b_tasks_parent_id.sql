-- R3b — Task decomposition.
--
-- Adds a nullable self-referencing FK so a task can declare a parent task.
-- The "Break it down" agent flow proposes 2-5 child tasks for a vague parent
-- and inserts them with parent_id set. ON DELETE CASCADE means deleting a
-- parent removes its children — explicit decision: a parent's removal makes
-- the children orphans that no longer mean anything on the board.
--
-- The decomposition tree is at most two levels deep in R3b: children can't
-- themselves be decomposed. The UI enforces this (Break it down button is
-- hidden when parent_id is set); the schema doesn't.
--
-- Children are normal task rows — they appear on the board with their own
-- status, priority, and column placement. The parent_id field is read by
-- the TaskDialog (to render a faded "parent: <title>" line) but doesn't
-- change rendering or ordering otherwise.

alter table public.tasks
  add column parent_id uuid references public.tasks(id) on delete cascade;

-- Partial index — most tasks won't have a parent, so we only pay the index
-- cost on rows that do. Useful for "find all children of X" queries.
create index idx_tasks_parent_id
  on public.tasks (parent_id)
  where parent_id is not null;

comment on column public.tasks.parent_id is
  'Optional reference to a parent task. Set by the R3b decomposition flow. ON DELETE CASCADE; children removed when parent is deleted.';
