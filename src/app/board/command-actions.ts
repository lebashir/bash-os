"use server";

import type { UIMessage } from "ai";
import { resolveColumnId } from "@/lib/board/columns";
import { createClient } from "@/lib/supabase/server";

export async function resolveInboxColumn(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return resolveColumnId(supabase, user.id, "Inbox");
}

export async function listChatUIMessages(
  limit: number = 20,
): Promise<UIMessage[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("chat_messages")
    .select("id, role, content, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return [];

  return ((data ?? []) as Array<{
    id: string;
    role: string;
    content: string;
  }>)
    .reverse()
    .map((m) => ({
      id: m.id,
      role: m.role === "assistant" ? "assistant" : "user",
      parts: [{ type: "text" as const, text: m.content }],
    }));
}
