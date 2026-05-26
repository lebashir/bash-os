-- Pillar 3 Slice B — make deletion-as-verdict capturable, and let staged
-- emails be snoozed like pending_emails were.

-- 1. task_events.task_id is ON DELETE CASCADE, so deleting a task wipes its
--    events (including the source_id-bearing 'deleted' event). Make it
--    SET NULL so the verdict survives the task row.
alter table public.task_events
  drop constraint task_events_task_id_fkey;
alter table public.task_events
  alter column task_id drop not null;
alter table public.task_events
  add constraint task_events_task_id_fkey
  foreign key (task_id) references public.tasks(id) on delete set null;

-- 2. staged_emails gains snoozed_until (the triage UI's snooze action).
alter table public.staged_emails
  add column snoozed_until timestamptz;

create index staged_emails_snoozed_idx
  on public.staged_emails (snoozed_until)
  where snoozed_until is not null;
