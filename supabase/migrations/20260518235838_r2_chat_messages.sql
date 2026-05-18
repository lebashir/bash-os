-- Chat messages persist the back-and-forth between Bashir and the assistant.
-- Long-term memories (with embeddings) live in the existing public.memories
-- table; this is purely conversation history.

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index chat_messages_user_created_idx
  on public.chat_messages (user_id, created_at);

alter table public.chat_messages enable row level security;

create policy "chat_messages_select_own"
  on public.chat_messages
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "chat_messages_insert_own"
  on public.chat_messages
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "chat_messages_delete_own"
  on public.chat_messages
  for delete
  to authenticated
  using (auth.uid() = user_id);
