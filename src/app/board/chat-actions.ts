"use server";

import { createClient } from "@/lib/supabase/server";
import { loadHistory, runChatTurn } from "@/lib/board/chat";
import type { ChatMessage } from "@/lib/supabase/types";

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  return { supabase, user };
}

export async function listChatMessages(): Promise<ChatMessage[]> {
  const { supabase, user } = await requireUser();
  return loadHistory(supabase, user.id, 200);
}

export async function sendChatMessage(content: string): Promise<{
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
}> {
  const { supabase, user } = await requireUser();
  return runChatTurn({
    supabase,
    userId: user.id,
    userMessage: content,
  });
}

export async function clearChat(): Promise<void> {
  const { supabase, user } = await requireUser();
  const { error } = await supabase
    .from("chat_messages")
    .delete()
    .eq("user_id", user.id);
  if (error) throw new Error(`Failed to clear chat: ${error.message}`);
}
