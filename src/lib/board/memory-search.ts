import type { SupabaseClient } from "@supabase/supabase-js";
import { geminiEmbed } from "@/lib/gemini/embed";

// Cosine similarity threshold below which a memory is treated as off-topic
// noise and dropped from the context injection. Gemini embeddings on related
// content typically score 0.6+; under ~0.5 starts to drift.
const MIN_SIMILARITY = 0.55;
const MIN_QUERY_LENGTH = 3;

export type MemoryMatch = {
  id: string;
  content: string;
  tags: string[];
  created_at: string;
  similarity: number;
};

type RpcRow = {
  id: string;
  content: string;
  tags: string[] | null;
  created_at: string;
  similarity: number;
};

export async function searchMemories(
  supabase: SupabaseClient,
  query: string,
  limit: number = 5,
): Promise<MemoryMatch[]> {
  const trimmed = query.trim();
  if (trimmed.length < MIN_QUERY_LENGTH) return [];

  const queryEmbedding = await geminiEmbed({
    text: trimmed,
    taskType: "RETRIEVAL_QUERY",
  });
  const embeddingLiteral = `[${queryEmbedding.join(",")}]`;

  const { data, error } = await supabase.rpc("match_memories", {
    query_embedding: embeddingLiteral,
    match_count: limit,
  });
  if (error) throw new Error(`Memory search failed: ${error.message}`);

  const rows = (data ?? []) as RpcRow[];
  return rows
    .filter((r) => r.similarity >= MIN_SIMILARITY)
    .map((r) => ({
      id: r.id,
      content: r.content,
      tags: r.tags ?? [],
      created_at: r.created_at,
      similarity: r.similarity,
    }));
}
