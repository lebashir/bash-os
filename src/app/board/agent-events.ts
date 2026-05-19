"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { AgentEvent } from "@/lib/supabase/types";

const FEED_LIMIT = 20;

export async function listAgentEvents(): Promise<AgentEvent[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("agent_events")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(FEED_LIMIT);

  if (error) return [];
  return (data ?? []) as AgentEvent[];
}

// Fire-and-forget helper for internal event writes. Used by chat tools,
// sync paths, and the cron route. Swallows errors — telemetry must not
// fail user-facing requests.
export async function recordInternalAgentEvent(
  supabase: SupabaseClient,
  userId: string,
  source: string,
  action: string,
  target?: string,
  payload?: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.from("agent_events").insert({
    user_id: userId,
    source,
    action,
    target: target ?? null,
    payload: payload ?? {},
  });
  if (error) {
    console.warn("[agent_events] internal insert failed:", error.message);
  }
}
