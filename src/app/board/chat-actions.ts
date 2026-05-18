"use server";

import type { UIMessage } from "ai";
import { createClient } from "@/lib/supabase/server";
import { loadHistory } from "@/lib/board/chat";

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  return { supabase, user };
}

export async function listChatUIMessages(): Promise<UIMessage[]> {
  const { supabase, user } = await requireUser();
  const rows = await loadHistory(supabase, user.id, 200);
  return rows.map<UIMessage>((m) => ({
    id: m.id,
    role: m.role,
    parts: [{ type: "text", text: m.content }],
  }));
}

export async function clearChat(): Promise<void> {
  const { supabase, user } = await requireUser();
  const { error } = await supabase
    .from("chat_messages")
    .delete()
    .eq("user_id", user.id);
  if (error) throw new Error(`Failed to clear chat: ${error.message}`);
}
