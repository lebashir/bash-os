"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  type Task,
} from "@/lib/supabase/types";

const statusSchema = z.enum(TASK_STATUSES);
const prioritySchema = z.enum(TASK_PRIORITIES);

const upsertSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(500),
  description: z
    .string()
    .trim()
    .max(10_000)
    .nullish()
    .transform((v) => (v && v.length > 0 ? v : null)),
  status: statusSchema,
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
    .order("status", { ascending: true })
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
    .eq("status", parsed.status)
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
  revalidatePath("/board");
  return data as Task;
}

export async function updateTask(
  id: string,
  input: TaskFormInput,
): Promise<Task> {
  const parsed = upsertSchema.parse(input);
  const { supabase } = await requireUser();

  const { data, error } = await supabase
    .from("tasks")
    .update(parsed)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Update failed: ${error.message}`);
  }
  revalidatePath("/board");
  return data as Task;
}

export async function deleteTask(id: string): Promise<void> {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("tasks").delete().eq("id", id);
  if (error) {
    throw new Error(`Delete failed: ${error.message}`);
  }
  revalidatePath("/board");
}

const moveSchema = z.object({
  id: z.string().uuid(),
  status: statusSchema,
  orderedIdsByStatus: z.record(statusSchema, z.array(z.string().uuid())),
});

export type MoveTaskInput = z.input<typeof moveSchema>;

export async function moveTask(input: MoveTaskInput): Promise<void> {
  const parsed = moveSchema.parse(input);
  const { supabase, user } = await requireUser();

  // The client sends the authoritative ordering; mirror it to the DB.
  for (const [status, ids] of Object.entries(parsed.orderedIdsByStatus)) {
    for (let position = 0; position < ids.length; position++) {
      const { error } = await supabase
        .from("tasks")
        .update({ status, position })
        .eq("id", ids[position])
        .eq("user_id", user.id);
      if (error) {
        throw new Error(`Move failed: ${error.message}`);
      }
    }
  }
  revalidatePath("/board");
}
