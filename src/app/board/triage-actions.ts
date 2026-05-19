"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { resolveColumnId } from "@/lib/board/columns";
import { createClient } from "@/lib/supabase/server";
import type { PendingEmail } from "@/lib/supabase/types";

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

export async function listPendingEmails(): Promise<PendingEmail[]> {
  const { supabase, user } = await requireUser();
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("pending_emails")
    .select("*")
    .eq("user_id", user.id)
    .or(`snoozed_until.is.null,snoozed_until.lte.${nowIso}`)
    .order("score", { ascending: false })
    .order("inserted_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to load pending emails: ${error.message}`);
  }
  return (data ?? []) as PendingEmail[];
}

const idSchema = z.object({ id: z.string().uuid() });

export async function dismissPendingEmail(
  input: z.input<typeof idSchema>,
): Promise<void> {
  const { id } = idSchema.parse(input);
  const { supabase, user } = await requireUser();

  const { error } = await supabase
    .from("pending_emails")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) {
    throw new Error(`Dismiss failed: ${error.message}`);
  }
  revalidatePath("/");
}

export async function promotePendingEmailToTask(
  input: z.input<typeof idSchema>,
): Promise<void> {
  const { id } = idSchema.parse(input);
  const { supabase, user } = await requireUser();

  const { data: pending, error: loadErr } = await supabase
    .from("pending_emails")
    .select("subject, sender, snippet, gmail_message_id, score")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (loadErr) throw new Error(`Load failed: ${loadErr.message}`);
  if (!pending) throw new Error("Pending email not found.");

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
      title: pending.subject,
      description: `From: ${pending.sender}\n\n${pending.snippet ?? ""}`,
      column_id: inboxId,
      owner: "bash",
      source: "gmail",
      source_id: pending.gmail_message_id,
      importance: pending.score,
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

  const { error: delErr } = await supabase
    .from("pending_emails")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (delErr) throw new Error(`Cleanup failed: ${delErr.message}`);

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
    .from("pending_emails")
    .update({ snoozed_until: until })
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) throw new Error(`Snooze failed: ${error.message}`);
  revalidatePath("/");
}
