"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { resolveColumnId } from "@/lib/board/columns";
import { createClient } from "@/lib/supabase/server";
import type { StagedEmail } from "@/lib/supabase/types";

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("Not authenticated");
  }
  return { supabase, user };
}

// Slice B: the triage surface now reads staged_emails (TRIAGE + DROP band rows
// the scorer did not auto-admit). Promote/dismiss/snooze soft-delete by stamping
// `decision`/`snoozed_until` rather than removing the row, so the lifeofbash
// verdict sync can read Bashir's call back into decisions.jsonl.
export async function listPendingEmails(): Promise<StagedEmail[]> {
  const { supabase, user } = await requireUser();
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("staged_emails")
    .select("*")
    .eq("user_id", user.id)
    .eq("decision", "pending")
    .or(`snoozed_until.is.null,snoozed_until.lte.${nowIso}`)
    .order("score", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to load staged emails: ${error.message}`);
  }
  return (data ?? []) as StagedEmail[];
}

const idSchema = z.object({ id: z.string().uuid() });

export async function dismissPendingEmail(
  input: z.input<typeof idSchema>,
): Promise<void> {
  const { id } = idSchema.parse(input);
  const { supabase, user } = await requireUser();
  const { error } = await supabase
    .from("staged_emails")
    .update({ decision: "dropped", decided_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) throw new Error(`Dismiss failed: ${error.message}`);
  revalidatePath("/");
}

export async function promotePendingEmailToTask(
  input: z.input<typeof idSchema>,
): Promise<void> {
  const { id } = idSchema.parse(input);
  const { supabase, user } = await requireUser();

  const { data: staged, error: loadErr } = await supabase
    .from("staged_emails")
    .select("subject, sender, snippet, source_id, source_account, score, scorer_tags")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (loadErr) throw new Error(`Load failed: ${loadErr.message}`);
  if (!staged) throw new Error("Staged email not found.");

  const inboxId = await resolveColumnId(supabase, user.id, "Inbox");
  if (!inboxId) throw new Error("No Inbox column found for user.");

  const { data: maxPos } = await supabase
    .from("tasks")
    .select("position")
    .eq("user_id", user.id)
    .eq("column_id", inboxId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const position = (maxPos?.position ?? -1) + 1;

  const { data: task, error: insertErr } = await supabase
    .from("tasks")
    .insert({
      user_id: user.id,
      title: staged.subject,
      description: `From: ${staged.sender}\n\n${staged.snippet ?? ""}`,
      column_id: inboxId,
      owner: "bash",
      source: "gmail",
      source_account: staged.source_account,
      source_id: staged.source_id,
      importance: staged.score,
      tags: staged.scorer_tags ?? [],
      position,
    })
    .select("id")
    .single();
  if (insertErr) throw new Error(`Create task failed: ${insertErr.message}`);

  await supabase.from("task_events").insert({
    user_id: user.id,
    task_id: task.id,
    event_type: "created",
    metadata: { source: "triage" },
  });

  // Soft-delete: mark the verdict, do NOT remove the row (the sync reads it).
  const { error: updErr } = await supabase
    .from("staged_emails")
    .update({ decision: "promoted", decided_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id);
  if (updErr) throw new Error(`Mark promoted failed: ${updErr.message}`);

  revalidatePath("/");
}

const snoozeSchema = z.object({
  id: z.string().uuid(),
  hours: z.number().int().min(1).max(24 * 30),
});

export async function snoozePendingEmail(
  input: z.input<typeof snoozeSchema>,
): Promise<void> {
  const { id, hours } = snoozeSchema.parse(input);
  const { supabase, user } = await requireUser();
  const until = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
  const { error } = await supabase
    .from("staged_emails")
    .update({ snoozed_until: until })
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) throw new Error(`Snooze failed: ${error.message}`);
  revalidatePath("/");
}
