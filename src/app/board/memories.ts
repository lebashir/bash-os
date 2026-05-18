"use server";

import { createClient } from "@/lib/supabase/server";
import { geminiEmbed } from "@/lib/gemini/embed";
import type { Memory } from "@/lib/supabase/types";

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  return { supabase, user };
}

export async function commitToMemory(
  content: string,
  tags: string[] = [],
): Promise<Memory> {
  const trimmed = content.trim();
  if (!trimmed) throw new Error("Cannot remember an empty note.");

  const { supabase, user } = await requireUser();

  const embedding = await geminiEmbed({
    text: trimmed,
    taskType: "RETRIEVAL_DOCUMENT",
  });

  // pgvector accepts the text representation '[v1,v2,...]' over the REST API.
  const embeddingLiteral = `[${embedding.join(",")}]`;

  const { data, error } = await supabase
    .from("memories")
    .insert({
      user_id: user.id,
      content: trimmed,
      embedding: embeddingLiteral,
      tags,
    })
    .select("*")
    .single();

  if (error) throw new Error(`Failed to save memory: ${error.message}`);
  return data as Memory;
}

export async function listMemories(limit: number = 50): Promise<Memory[]> {
  const { supabase, user } = await requireUser();
  const { data, error } = await supabase
    .from("memories")
    .select("id, user_id, content, tags, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Failed to list memories: ${error.message}`);
  return (data ?? []).map((row) => ({ ...row, embedding: null })) as Memory[];
}
