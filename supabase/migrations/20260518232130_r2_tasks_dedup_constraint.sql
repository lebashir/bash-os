-- The previous dedup index was partial (WHERE source_id is not null), which
-- means Postgres requires INSERT ... ON CONFLICT to also specify the matching
-- predicate to use it as a conflict target. Supabase's upsert API doesn't
-- expose a WHERE clause, so the partial index was unusable for dedup.
--
-- Replace it with a full unique constraint. PG15+ defaults unique indexes to
-- NULLS DISTINCT, so multiple manual tasks (source_id IS NULL) still don't
-- collide.

drop index public.tasks_user_source_account_source_id_idx;

alter table public.tasks
  add constraint tasks_user_source_account_source_id_key
  unique (user_id, source, source_account, source_id);
