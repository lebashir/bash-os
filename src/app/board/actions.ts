"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import {
  TASK_OWNERS,
  TASK_PRIORITIES,
  type Task,
} from "@/lib/supabase/types";

const prioritySchema = z.enum(TASK_PRIORITIES);
const ownerSchema = z.enum(TASK_OWNERS);

const upsertSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(500),
  description: z
    .string()
    .trim()
    .max(10_000)
    .nullish()
    .transform((v) => (v && v.length > 0 ? v : null)),
  column_id: z.string().uuid(),
  owner: ownerSchema.default("bash"),
  priority: prioritySchema.nullish().transform((v) => v ?? null),
  due_date: z
    .string()
    .nullish()
    .transform((v) => (v && v.length > 0 ? new Date(v).toISOString() : null)),
  source_id: z
    .string()
    .trim()
    .max(200)
    .nullish()
    .transform((v) => (v && v.length > 0 ? v : null)),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  needs_review: z.boolean().optional(),
});

export type TaskFormInput = z.input<typeof upsertSchema>;

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

export async function listTasks(): Promise<Task[]> {
  const { supabase, user } = await requireUser();
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("user_id", user.id)
    .order("column_id", { ascending: true })
    .order("position", { ascending: true });

  if (error) {
    throw new Error(`Failed to load tasks: ${error.message}`);
  }
  return (data ?? []) as Task[];
}

export async function createTask(input: TaskFormInput): Promise<Task> {
  const parsed = upsertSchema.parse(input);
  const { supabase, user } = await requireUser();

  const { data: maxPos } = await supabase
    .from("tasks")
    .select("position")
    .eq("user_id", user.id)
    .eq("column_id", parsed.column_id)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextPosition = (maxPos?.position ?? -1) + 1;

  const { data, error } = await supabase
    .from("tasks")
    .insert({
      ...parsed,
      user_id: user.id,
      position: nextPosition,
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Create failed: ${error.message}`);
  }

  await recordTaskEvent(supabase, user.id, data.id, "created", {
    source: data.source,
    column_id: data.column_id,
  });

  revalidatePath("/");
  return data as Task;
}

export async function updateTask(
  id: string,
  input: TaskFormInput,
): Promise<Task> {
  const parsed = upsertSchema.parse(input);
  const { supabase, user } = await requireUser();

  const { data: prior } = await supabase
    .from("tasks")
    .select("column_id")
    .eq("id", id)
    .single();

  const { data, error } = await supabase
    .from("tasks")
    .update(parsed)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Update failed: ${error.message}`);
  }

  if (prior?.column_id && prior.column_id !== data.column_id) {
    await recordTaskEvent(supabase, user.id, id, "moved", {
      from_column_id: prior.column_id,
      to_column_id: data.column_id,
    });
  } else {
    await recordTaskEvent(supabase, user.id, id, "updated", {});
  }

  revalidatePath("/");
  return data as Task;
}

export async function deleteTask(id: string): Promise<void> {
  const { supabase, user } = await requireUser();
  const { data: prior } = await supabase
    .from("tasks")
    .select("title")
    .eq("id", id)
    .maybeSingle();

  // Record the deletion before the row goes; task_events.task_id is
  // ON DELETE CASCADE so the row itself would disappear, but a
  // snapshot of the title preserves the timeline entry.
  await recordTaskEvent(supabase, user.id, id, "deleted", {
    title: prior?.title ?? null,
  });

  const { error } = await supabase.from("tasks").delete().eq("id", id);
  if (error) {
    throw new Error(`Delete failed: ${error.message}`);
  }
  revalidatePath("/");
}

const moveSchema = z.object({
  id: z.string().uuid(),
  column_id: z.string().uuid(),
  orderedIdsByColumn: z.record(z.string().uuid(), z.array(z.string().uuid())),
});

export type MoveTaskInput = z.input<typeof moveSchema>;

export async function moveTask(input: MoveTaskInput): Promise<void> {
  const parsed = moveSchema.parse(input);
  const { supabase, user } = await requireUser();

  const { data: prior } = await supabase
    .from("tasks")
    .select("column_id")
    .eq("id", parsed.id)
    .eq("user_id", user.id)
    .maybeSingle();

  for (const [columnId, ids] of Object.entries(parsed.orderedIdsByColumn)) {
    for (let position = 0; position < ids.length; position++) {
      const { error } = await supabase
        .from("tasks")
        .update({ column_id: columnId, position })
        .eq("id", ids[position])
        .eq("user_id", user.id);
      if (error) {
        throw new Error(`Move failed: ${error.message}`);
      }
    }
  }

  if (prior && prior.column_id !== parsed.column_id) {
    await recordTaskEvent(supabase, user.id, parsed.id, "moved", {
      from_column_id: prior.column_id,
      to_column_id: parsed.column_id,
    });
  }

  revalidatePath("/");
}

async function recordTaskEvent(
  supabase: SupabaseClient,
  userId: string,
  taskId: string,
  eventType:
    | "created"
    | "completed"
    | "moved"
    | "updated"
    | "deleted"
    | "importance_set",
  metadata: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.from("task_events").insert({
    user_id: userId,
    task_id: taskId,
    event_type: eventType,
    metadata,
  });
  if (error) {
    console.warn("[task_events] insert failed:", error.message);
  }
}
