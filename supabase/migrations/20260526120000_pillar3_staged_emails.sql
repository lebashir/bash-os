-- Pillar 3 Slice A — staged_emails: everything fetched that did not auto-admit
-- (TRIAGE + DROP), carrying the scorer's full guess so Slice B can sync verdicts.
create table public.staged_emails (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null default 'gmail',
  source_account text not null,
  source_id text not null,
  subject text not null,
  sender text not null,
  snippet text,
  score smallint not null,
  band text not null check (band in ('TRIAGE', 'DROP')),
  reason text,
  scorer_title text,
  scorer_tags text[] not null default '{}',
  decision text not null default 'pending'
    check (decision in ('pending', 'promoted', 'dropped', 'kept')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  unique (user_id, source, source_account, source_id)
);

create index staged_emails_user_band_idx
  on public.staged_emails (user_id, band, created_at desc);

alter table public.staged_emails enable row level security;

create policy "staged_emails_select_own" on public.staged_emails
  for select to authenticated using (auth.uid() = user_id);
create policy "staged_emails_insert_own" on public.staged_emails
  for insert to authenticated with check (auth.uid() = user_id);
create policy "staged_emails_update_own" on public.staged_emails
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "staged_emails_delete_own" on public.staged_emails
  for delete to authenticated using (auth.uid() = user_id);
