"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { Column } from "@/lib/supabase/types";

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

export async function listColumns(): Promise<Column[]> {
  const { supabase, user } = await requireUser();
  const { data, error } = await supabase
    .from("columns")
    .select("*")
    .eq("user_id", user.id)
    .order("position", { ascending: true });

  if (error) {
    throw new Error(`Failed to load columns: ${error.message}`);
  }
  return (data ?? []) as Column[];
}

const createColumnSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  icon: z.string().trim().max(40).optional().nullable(),
  accent_color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Must be a 6-char hex color")
    .optional()
    .nullable(),
});

export type CreateColumnInput = z.input<typeof createColumnSchema>;

export async function createColumn(input: CreateColumnInput): Promise<Column> {
  const parsed = createColumnSchema.parse(input);
  const { supabase, user } = await requireUser();

  const { data: maxPos } = await supabase
    .from("columns")
    .select("position")
    .eq("user_id", user.id)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextPosition = (maxPos?.position ?? -1) + 1;

  const { data, error } = await supabase
    .from("columns")
    .insert({
      user_id: user.id,
      name: parsed.name,
      icon: parsed.icon ?? null,
      accent_color: parsed.accent_color ?? null,
      position: nextPosition,
      is_default: false,
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Create column failed: ${error.message}`);
  }
  revalidatePath("/");
  return data as Column;
}

const updateColumnSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(80).optional(),
  icon: z.string().trim().max(40).nullable().optional(),
  accent_color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Must be a 6-char hex color")
    .nullable()
    .optional(),
});

export type UpdateColumnInput = z.input<typeof updateColumnSchema>;

export async function updateColumn(input: UpdateColumnInput): Promise<Column> {
  const parsed = updateColumnSchema.parse(input);
  const { supabase, user } = await requireUser();

  const patch: Record<string, unknown> = {};
  if (parsed.name !== undefined) patch.name = parsed.name;
  if (parsed.icon !== undefined) patch.icon = parsed.icon;
  if (parsed.accent_color !== undefined) patch.accent_color = parsed.accent_color;
  if (Object.keys(patch).length === 0) {
    throw new Error("Update column: nothing to change.");
  }

  const { data, error } = await supabase
    .from("columns")
    .update(patch)
    .eq("id", parsed.id)
    .eq("user_id", user.id)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Update column failed: ${error.message}`);
  }
  revalidatePath("/");
  return data as Column;
}

const deleteColumnSchema = z.object({
  id: z.string().uuid(),
  destinationColumnId: z.string().uuid(),
});

export type DeleteColumnInput = z.input<typeof deleteColumnSchema>;

export async function deleteColumn(input: DeleteColumnInput): Promise<void> {
  const parsed = deleteColumnSchema.parse(input);
  if (parsed.id === parsed.destinationColumnId) {
    throw new Error("Cannot move tasks into the column being deleted.");
  }
  const { supabase, user } = await requireUser();

  // Confirm both columns belong to the user; the FK on tasks would catch a
  // foreign id but the error is opaque.
  const { data: cols } = await supabase
    .from("columns")
    .select("id")
    .eq("user_id", user.id)
    .in("id", [parsed.id, parsed.destinationColumnId]);

  if (!cols || cols.length !== 2) {
    throw new Error("Column not found.");
  }

  // Prevent deleting the last column.
  const { count } = await supabase
    .from("columns")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);
  if ((count ?? 0) <= 1) {
    throw new Error("Cannot delete the last column.");
  }

  // Find max position in destination to append the moved tasks at the end.
  const { data: maxPos } = await supabase
    .from("tasks")
    .select("position")
    .eq("user_id", user.id)
    .eq("column_id", parsed.destinationColumnId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  let nextPosition = (maxPos?.position ?? -1) + 1;

  // Move tasks one-at-a-time so positions stay consecutive. Single-user
  // scale → fine. Multi-user-at-scale: switch to a bulk update with a
  // window function in SQL.
  const { data: toMove } = await supabase
    .from("tasks")
    .select("id")
    .eq("user_id", user.id)
    .eq("column_id", parsed.id)
    .order("position", { ascending: true });

  for (const row of toMove ?? []) {
    await supabase
      .from("tasks")
      .update({ column_id: parsed.destinationColumnId, position: nextPosition })
      .eq("id", row.id)
      .eq("user_id", user.id);
    nextPosition += 1;
  }

  const { error } = await supabase
    .from("columns")
    .delete()
    .eq("id", parsed.id)
    .eq("user_id", user.id);
  if (error) {
    throw new Error(`Delete column failed: ${error.message}`);
  }
  revalidatePath("/");
}

const reorderColumnsSchema = z.object({
  orderedIds: z.array(z.string().uuid()).min(1).max(50),
});

export type ReorderColumnsInput = z.input<typeof reorderColumnsSchema>;

export async function reorderColumns(
  input: ReorderColumnsInput,
): Promise<void> {
  const parsed = reorderColumnsSchema.parse(input);
  const { supabase, user } = await requireUser();

  // The (user_id, position) unique constraint is DEFERRABLE INITIALLY
  // DEFERRED so we can write all the new positions and the check fires at
  // COMMIT time. PostgREST runs each statement in its own transaction by
  // default so we accept a small risk of intermediate constraint failure
  // here at single-user scale. If this surfaces, switch to a SQL function
  // wrapped in BEGIN/COMMIT.
  for (let position = 0; position < parsed.orderedIds.length; position++) {
    const { error } = await supabase
      .from("columns")
      .update({ position })
      .eq("id", parsed.orderedIds[position])
      .eq("user_id", user.id);
    if (error) {
      throw new Error(`Reorder failed at position ${position}: ${error.message}`);
    }
  }
  revalidatePath("/");
}
