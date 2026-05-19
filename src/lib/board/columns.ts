import type { SupabaseClient } from "@supabase/supabase-js";
import type { StarterColumnName } from "@/lib/supabase/types";

// Look up the column id for a user-by-name (case-sensitive). Used by sync
// paths and the chat agent to resolve "well-known" columns like Inbox and
// Active to the user's actual column UUID without hardcoding it.
//
// Falls back to the first column (lowest position) if the requested name
// doesn't exist for the user — covers the edge case where the user has
// renamed or deleted a starter column. Returns null only when the user has
// no columns at all (should be impossible post-migration).
export async function resolveColumnId(
  supabase: SupabaseClient,
  userId: string,
  name: StarterColumnName,
): Promise<string | null> {
  const { data: exact } = await supabase
    .from("columns")
    .select("id")
    .eq("user_id", userId)
    .eq("name", name)
    .maybeSingle();
  if (exact?.id) return exact.id as string;

  const { data: fallback } = await supabase
    .from("columns")
    .select("id")
    .eq("user_id", userId)
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (fallback?.id as string) ?? null;
}

export interface ColumnLookup {
  byName: Map<string, string>;
  byId: Map<string, string>;
  doneId: string | null;
  inboxId: string | null;
  activeId: string | null;
  reviewId: string | null;
  todayId: string | null;
}

export async function loadColumnLookup(
  supabase: SupabaseClient,
  userId: string,
): Promise<ColumnLookup> {
  const { data } = await supabase
    .from("columns")
    .select("id, name")
    .eq("user_id", userId);

  const rows = (data ?? []) as { id: string; name: string }[];
  const byName = new Map(rows.map((r) => [r.name, r.id]));
  const byId = new Map(rows.map((r) => [r.id, r.name]));
  return {
    byName,
    byId,
    doneId: byName.get("Done") ?? null,
    inboxId: byName.get("Inbox") ?? null,
    activeId: byName.get("Active") ?? null,
    reviewId: byName.get("Review") ?? null,
    todayId: byName.get("Today") ?? null,
  };
}
