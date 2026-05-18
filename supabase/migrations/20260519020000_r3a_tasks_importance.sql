-- R3a — Email importance scoring.
--
-- Adds a nullable `importance` smallint column on public.tasks. The Gmail sync
-- path runs each unread message through a Gemini call that returns a 1-10
-- score; messages below a threshold are dropped before the upsert, and the
-- score is persisted on the surviving rows.
--
-- Threshold lives in app code, not in the DB. The column is intentionally
-- unconstrained so future rounds can experiment with different scales or
-- per-source rubrics without another migration. Existing rows keep importance
-- NULL — they were inserted before scoring existed and the UI/agent treats
-- NULL as "unscored", not "low importance".

alter table public.tasks
  add column importance smallint;

comment on column public.tasks.importance is
  'Optional 1-10 importance score assigned at intake time. NULL means unscored.';
