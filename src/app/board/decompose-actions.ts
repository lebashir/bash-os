"use server";

import { generateObject } from "ai";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { CHAT_MODEL_ID, google } from "@/lib/gemini/client";
import { createClient } from "@/lib/supabase/server";
import {
  TASK_PRIORITIES,
  type Task,
  type TaskPriority,
} from "@/lib/supabase/types";

// Children are routed into one of these three columns. Other statuses
// (intake / staging / done) aren't meaningful destinations for a brand-new
// decomposed sub-task.
const CHILD_STATUSES = ["Bash work", "Claude work", "Boss Check"] as const;
export type ChildStatus = (typeof CHILD_STATUSES)[number];

const MAX_CHILDREN = 5;
const MIN_CHILDREN = 2;

const DECOMPOSE_SYSTEM_PROMPT = `You break down a vague task into 2-5 atomic child tasks. Each child must be doable in a single sitting and routed into one of three columns based on who should do it:

- "Bash work" — relationships, judgment calls, irreversible actions. Meetings to hold, decisions to make, external messages to send, things that require Bashir's personal context or authority.
- "Claude work" — mechanical, low-judgment, reversible. Research, drafting, formatting, cross-referencing, gathering background info. The kind of thing an LLM agent can do unattended and produce a useful output.
- "Boss Check" — Claude drafts something, Bashir approves before it goes out. Procedure responses, status updates, draft replies, anything where Bashir needs to review LLM output before it ships externally.

Rules for the children:
- 2-5 children. No more, no less. If a task is too small to need 2 children, don't decompose it — pick the smallest sensible split.
- Each child has a concrete title (under 80 chars), a short description (1-2 sentences), a status (one of the three above), and a one-sentence rationale explaining why it lives in that column.
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
        status: z.enum(CHILD_STATUSES),
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
    .select("id, title, description, status, priority, parent_id")
    .eq("id", taskId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) throw new Error(`Failed to load task: ${error.message}`);
  if (!parent) throw new Error("Task not found");
  if (parent.parent_id !== null) {
    throw new Error("This task already has a parent — children can't themselves be decomposed.");
  }

  const { object } = await generateObject({
    model: google(CHAT_MODEL_ID),
    schema: decompositionSchema,
    system: DECOMPOSE_SYSTEM_PROMPT,
    prompt: renderParent(parent as ParentRow),
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
        status: z.enum(CHILD_STATUSES),
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

  // source_id prefix per ARCHITECTURE.md → "Task decomposition". When the
  // parent came from a connector (Jira issue PMP-65, Gmail message id, etc.)
  // the children get something like "PMP-65/research-pricing". When the
  // parent was manually created (source_id null) the prefix falls back to
  // the parent's UUID so the relationship is still visible.
  const sourceIdPrefix = (parent.source_id as string | null) ?? (parent.id as string);

  // Compute next positions per destination column in one pass.
  const distinctStatuses = Array.from(new Set(parsed.children.map((c) => c.status)));
  const nextPositionByStatus = new Map<string, number>();
  for (const status of distinctStatuses) {
    const { data: maxPos } = await supabase
      .from("tasks")
      .select("position")
      .eq("user_id", user.id)
      .eq("status", status)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    nextPositionByStatus.set(status, (maxPos?.position ?? -1) + 1);
  }

  const rows = parsed.children.map((child) => {
    const slug = slugify(child.title);
    const sourceId = `${sourceIdPrefix}/${slug}`;
    const position = nextPositionByStatus.get(child.status) ?? 0;
    nextPositionByStatus.set(child.status, position + 1);
    return {
      user_id: user.id,
      title: child.title,
      description: child.description || null,
      status: child.status,
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

type ParentRow = Pick<
  Task,
  "id" | "title" | "description" | "status" | "priority" | "parent_id"
>;

function renderParent(parent: ParentRow): string {
  const lines = [
    `Parent task: ${parent.title}`,
    `Current column: ${parent.status}`,
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
