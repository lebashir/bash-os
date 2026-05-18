-- Bash OS Round 2 — multi-account connectors
-- One Bash OS user can now link multiple accounts per provider (e.g. a
-- personal Gmail and a work Gmail), so token uniqueness keys on account_email
-- in addition to provider. Tasks get a source_account column so the dedup
-- index treats messages from different accounts as distinct.

-- ---------------------------------------------------------------------------
-- connector_tokens
-- ---------------------------------------------------------------------------
alter table public.connector_tokens
  drop constraint connector_tokens_user_id_provider_key;

alter table public.connector_tokens
  add column account_email text;

-- Multiple rows with NULL account_email would still be considered distinct by
-- Postgres, which is fine: the callback always writes a non-null email going
-- forward, and any pre-existing nulls (from the brief window before this
-- migration) are stale and will be overwritten on next sign-in.
alter table public.connector_tokens
  add constraint connector_tokens_user_provider_account_key
  unique (user_id, provider, account_email);

-- ---------------------------------------------------------------------------
-- tasks
-- ---------------------------------------------------------------------------
alter table public.tasks
  add column source_account text;

drop index public.tasks_user_source_source_id_idx;

create unique index tasks_user_source_account_source_id_idx
  on public.tasks (user_id, source, source_account, source_id)
  where source_id is not null;
