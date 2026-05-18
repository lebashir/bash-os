-- ---------------------------------------------------------------------------
-- Vector index + RPC for semantic memory retrieval.
--
-- match_memories runs as the caller (SECURITY INVOKER, the default), so the
-- existing memories_select_own RLS policy restricts the result set to the
-- authenticated user's own rows. Cosine distance via the `<=>` operator
-- pairs with the HNSW vector_cosine_ops index below.
-- ---------------------------------------------------------------------------

create index if not exists memories_embedding_idx
  on public.memories
  using hnsw (embedding vector_cosine_ops);

create or replace function public.match_memories(
  query_embedding vector(1536),
  match_count int default 5
)
returns table (
  id uuid,
  content text,
  tags text[],
  created_at timestamptz,
  similarity double precision
)
language sql
stable
as $$
  select
    m.id,
    m.content,
    m.tags,
    m.created_at,
    1 - (m.embedding <=> query_embedding) as similarity
  from public.memories m
  where m.embedding is not null
  order by m.embedding <=> query_embedding
  limit match_count;
$$;

grant execute on function public.match_memories(vector, int) to authenticated;
