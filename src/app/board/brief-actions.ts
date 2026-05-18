"use server";

import { createClient } from "@/lib/supabase/server";
import type { Brief } from "@/lib/supabase/types";

const BRIEF_HISTORY_LIMIT = 7;

export async function listRecentBriefs(): Promise<Brief[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("Not authenticated");
  }

  const { data, error } = await supabase
    .from("briefs")
    .select("*")
    .eq("user_id", user.id)
    .order("brief_date", { ascending: false })
    .limit(BRIEF_HISTORY_LIMIT);

  if (error) {
    throw new Error(`Failed to load briefs: ${error.message}`);
  }
  return (data ?? []) as Brief[];
}
