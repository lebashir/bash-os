"use server";

import { generateObject } from "ai";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { CHAT_MODEL_ID, google } from "@/lib/gemini/client";
import { loadColumnLookup } from "@/lib/board/columns";
import { createClient } from "@/lib/supabase/server";
import {
  TASK_PRIORITIES,
  type Task,
  type TaskOwner,
} from "@/lib/supabase/types";

// R3.5 collapsed Bash work + Claude work into a single Active column with
// per-task owner. The LLM still classifies into the three semantic buckets
// below because those map naturally to (column, owner, needs_review) tuples
// at insert time:
//
//   "Bash work"   -> Active,  owner='bash'
//   "Claude work" -> Active,  owner='claude'
//   "Boss Check"  -> Review,  owner='claude', needs_review=true
const CHILD_KINDS = ["Bash work", "Claude work", "Boss Check"] as const;
export type ChildKind = (typeof CHILD_KINDS)[number];

const MAX_CHILDREN = 5;
const MIN_CHILDREN = 2;

const DECOMPOSE_SYSTEM_PROMPT = `You break down a vague task into 2-5 atomic child tasks. Each child must be doable in a single sitting and routed into one of three kinds based on who should do it:

- "Bash work" — relationships, judgment calls, irreversible actions. Meetings to hold, decisions to make, external messages to send, things that require Bashir's personal context or authority. Owned by Bashir.
- "Claude work" — mechanical, low-judgment, reversible. Research, drafting, formatting, cross-referencing, gathering background info. The kind of thing an LLM agent can do unattended and produce a useful output. Owned by Claude.
- "Boss Check" — Claude drafts something, Bashir approves before it goes out. Procedure responses, status updates, draft replies, anything where Bashir needs to review LLM output before it ships externally. Owned by Claude, flagged for review.

Rules for the children:
- 2-5 children. No more, no less. If a task is too small to need 2 children, don't decompose it — pick the smallest sensible split.
- Each child has a concrete title (under 80 chars), a short description (1-2 sentences), a kind (one of the three above), and a one-sentence rationale explaining why it falls in that bucket.
- Children are atomic and roughly sequential. Order matters — the first child should be the first thing to do.
- Don't restate the parent. Don't echo "Step 1:", "Step 2:" — the children already form an ordered list.
- Don't propose meta-tasks like "plan the work" or "review the plan". Propose actual work.

Return JSON only. No prose, no explanation, no preamble.`;

const decompositionSchema = z.object({
  children: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(200),
        description: z.string().trim().min(1).max(1000),
        kind: z.enum(CHILD_KINDS),
        rationale: z.string().trim().min(1).max(300),
      }),
    )
    .min(MIN_CHILDREN)
    .max(MAX_CHILDREN),
});

export type ProposedChild = z.infer<typeof decompositionSchema>["children"][number];

export type DecomposeResult = {
  parent: { id: string; title: string };
  proposedChildren: ProposedChild[];
};

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

export async function decomposeTask(taskId: string): Promise<DecomposeResult> {
  const { supabase, user } = await requireUser();

  const { data: parent, error } = await supabase
    .from("tasks")
    .select("id, title, description, column_id, priority, parent_id")
    .eq("id", taskId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) throw new Error(`Failed to load task: ${error.message}`);
  if (!parent) throw new Error("Task not found");
  if (parent.parent_id !== null) {
    throw new Error("This task already has a parent — children can't themselves be decomposed.");
  }

  const lookup = await loadColumnLookup(supabase, user.id);
  const columnName = lookup.byId.get(parent.column_id as string) ?? "(unknown column)";

  const { object } = await generateObject({
    model: google(CHAT_MODEL_ID),
    schema: decompositionSchema,
    system: DECOMPOSE_SYSTEM_PROMPT,
    prompt: renderParent({
      title: parent.title as string,
      columnName,
      priority: parent.priority as string | null,
      description: parent.description as string | null,
    }),
    temperature: 0.4,
    maxOutputTokens: 1500,
    providerOptions: {
      google: { thinkingConfig: { thinkingBudget: 0 } },
    },
  });

  return {
    parent: { id: parent.id as string, title: parent.title as string },
    proposedChildren: object.children,
  };
}

const createChildrenSchema = z.object({
  parentId: z.string().uuid(),
  children: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(500),
        description: z.string().trim().max(10_000),
        kind: z.enum(CHILD_KINDS),
        priority: z
          .enum(TASK_PRIORITIES)
          .nullish()
          .transform((v) => v ?? null),
      }),
    )
    .min(1)
    .max(MAX_CHILDREN),
});

export type CreateChildrenInput = z.input<typeof createChildrenSchema>;

interface KindMapping {
  columnId: string;
  owner: TaskOwner;
  needsReview: boolean;
}

export async function createDecomposedChildren(
  input: CreateChildrenInput,
): Promise<Task[]> {
  const parsed = createChildrenSchema.parse(input);
  const { supabase, user } = await requireUser();

  const { data: parent, error: parentError } = await supabase
    .from("tasks")
    .select("id, source, source_id")
    .eq("id", parsed.parentId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (parentError) {
    throw new Error(`Failed to load parent task: ${parentError.message}`);
  }
  if (!parent) {
    throw new Error("Parent task not found");
  }

  const lookup = await loadColumnLookup(supabase, user.id);
  if (!lookup.activeId || !lookup.reviewId) {
    throw new Error(
      "Decomposition requires Active and Review columns — schema not seeded?",
    );
  }

  const kindToMapping: Record<ChildKind, KindMapping> = {
    "Bash work": {
      columnId: lookup.activeId,
      owner: "bash",
      needsReview: false,
    },
    "Claude work": {
      columnId: lookup.activeId,
      owner: "claude",
      needsReview: false,
    },
    "Boss Check": {
      columnId: lookup.reviewId,
      owner: "claude",
      needsReview: true,
    },
  };

  const sourceIdPrefix =
    (parent.source_id as string | null) ?? (parent.id as string);

  // Compute next positions per destination column in one pass.
  const distinctColumns = Array.from(
    new Set(parsed.children.map((c) => kindToMapping[c.kind].columnId)),
  );
  const nextPositionByColumn = new Map<string, number>();
  for (const columnId of distinctColumns) {
    const { data: maxPos } = await supabase
      .from("tasks")
      .select("position")
      .eq("user_id", user.id)
      .eq("column_id", columnId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    nextPositionByColumn.set(columnId, (maxPos?.position ?? -1) + 1);
  }

  const rows = parsed.children.map((child) => {
    const slug = slugify(child.title);
    const sourceId = `${sourceIdPrefix}/${slug}`;
    const mapping = kindToMapping[child.kind];
    const position = nextPositionByColumn.get(mapping.columnId) ?? 0;
    nextPositionByColumn.set(mapping.columnId, position + 1);
    return {
      user_id: user.id,
      title: child.title,
      description: child.description || null,
      column_id: mapping.columnId,
      owner: mapping.owner,
      needs_review: mapping.needsReview,
      priority: child.priority,
      source: "manual" as const,
      source_id: sourceId,
      parent_id: parsed.parentId,
      position,
    };
  });

  const { data, error } = await supabase
    .from("tasks")
    .insert(rows)
    .select("*");

  if (error) throw new Error(`Failed to create children: ${error.message}`);

  // Bulk task_events insert for the new children.
  if (data && data.length > 0) {
    await supabase.from("task_events").insert(
      data.map((row) => ({
        user_id: user.id,
        task_id: row.id,
        event_type: "created",
        metadata: { source: "decompose", column_id: row.column_id },
      })),
    );
  }

  revalidatePath("/");
  return (data ?? []) as Task[];
}

export async function getParentSummary(
  parentId: string,
): Promise<{ id: string; title: string } | null> {
  const { supabase, user } = await requireUser();
  const { data, error } = await supabase
    .from("tasks")
    .select("id, title")
    .eq("id", parentId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw new Error(`Failed to load parent: ${error.message}`);
  if (!data) return null;
  return { id: data.id as string, title: data.title as string };
}

interface ParentSnapshot {
  title: string;
  columnName: string;
  priority: string | null;
  description: string | null;
}

function renderParent(parent: ParentSnapshot): string {
  const lines = [
    `Parent task: ${parent.title}`,
    `Current column: ${parent.columnName}`,
  ];
  if (parent.priority) {
    lines.push(`Priority: ${parent.priority}`);
  }
  if (parent.description) {
    lines.push("");
    lines.push(`Description:`);
    lines.push(parent.description.slice(0, 2000));
  }
  lines.push("");
  lines.push("Break this into 2-5 atomic children now. Return JSON only.");
  return lines.join("\n");
}

// Kebab-case slug, 1-3 words, max ~30 chars. Used in child source_id so the
// parent-child relationship is visible in the task's source_id without the
// full title.
function slugify(title: string): string {
  const cleaned = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const words = cleaned.split(" ").filter(Boolean).slice(0, 3);
  const slug = words.join("-").slice(0, 30);
  return slug || "child";
}
