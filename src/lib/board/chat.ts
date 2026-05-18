import type { SupabaseClient } from "@supabase/supabase-js";
import { type ModelMessage, stepCountIs, tool, ToolLoopAgent } from "ai";
import { z } from "zod";
import { CHAT_MODEL_ID, google } from "@/lib/gemini/client";
import { searchMemories } from "@/lib/board/memory-search";
import {
  TASK_PRIORITIES,
  TASK_SOURCES,
  TASK_STATUSES,
  type ChatMessage,
  type ChatRole,
  type Task,
  type TaskSource,
  type TaskStatus,
} from "@/lib/supabase/types";

const CHAT_HISTORY_LIMIT = 20;
const CALENDAR_HORIZON_HOURS = 24;
const GMAIL_LOOKBACK_HOURS = 48;
const MAX_TOOL_STEPS = 8;
const RESOLVE_CANDIDATE_LIMIT = 5;
const CONTEXT_TASKS_PER_COLUMN = 12;
const MEMORY_MATCH_LIMIT = 5;

const CHAT_SYSTEM_PROMPT = `You are Bash OS's chat assistant — a calm, sharp helper for Bashir's personal life-OS.
You have visibility into the current kanban board, today's calendar events, recently-synced emails, and long-term memories that Bashir has explicitly chosen to remember (retrieved by semantic similarity to the current question). Use this context when it's relevant; ignore it when it isn't. Memories represent facts the user has said are worth remembering — treat them as ground truth about preferences, decisions, or state.

You can take real action on the board through these mutating tools:
- createTask: add a new task. Use whenever the user asks to capture, add, jot, or queue something. Default to "things to think about" for vague captures and "todays plate" only when the user explicitly says today/now/urgent.
- moveTask: move an existing task to a different column. Refer to the task by a fragment of its title — the tool resolves it server-side.
- updateTask: change the title, description, priority, or status of an existing task. Pass only the fields that change.
- deleteTask: permanently remove a task. Only call this when the user explicitly asks to delete (not "archive", "move", or "done"). If unsure, ask first.

You also have two read-only lookup tools:
- findTasks: keyword/filter search across Bashir's full board. Prefer this for specific lookups ("any task about X?", "what's in Bash work?") rather than scanning the injected board snapshot, which is truncated per column. Filter by status or source when the request is column- or source-specific.
- findMemories: semantic search over the long-term memory store, beyond the per-turn auto-injected matches. Reach for it when the user asks "what did I say about…" or when the visible memories don't cover what's needed.

When a tool returns a "needs clarification" error listing candidates, surface those candidates to the user and ask which one they meant — do not pick one yourself.

Keep replies tight: a few sentences for most questions, a short list only when explicitly asked for structure. No emojis, no over-apologizing, no preamble like "Sure! Let me help…". When the user gives you a fact worth remembering long-term, acknowledge it in one short sentence — the UI handles persistence.
When the user asks for next-action proposals, name specific items by their titles. If something the user is asking about isn't in the context, say so plainly.`;

// ---------------------------------------------------------------------------
// Task resolution (by title fragment)
// ---------------------------------------------------------------------------

type ResolvedTask = Pick<Task, "id" | "title" | "status">;

async function resolveTaskByQuery(
  supabase: SupabaseClient,
  userId: string,
  query: string,
): Promise<ResolvedTask> {
  const trimmed = query.trim();
  if (!trimmed) {
    throw new Error("Task query is empty.");
  }
  const safe = trimmed.replace(/[%,()]/g, " ");
  const { data, error } = await supabase
    .from("tasks")
    .select("id, title, status")
    .eq("user_id", userId)
    .ilike("title", `%${safe}%`)
    .order("updated_at", { ascending: false })
    .limit(RESOLVE_CANDIDATE_LIMIT);
  if (error) throw new Error(`Task lookup failed: ${error.message}`);

  const rows = (data ?? []) as ResolvedTask[];
  if (rows.length === 0) {
    throw new Error(
      `No task matches "${trimmed}". Ask the user to clarify or restate the title.`,
    );
  }

  const lower = trimmed.toLowerCase();
  const exact = rows.find((r) => r.title.toLowerCase() === lower);
  if (exact) return exact;

  if (rows.length === 1) return rows[0];

  const list = rows.map((r) => `- "${r.title}" [${r.status}]`).join("\n");
  throw new Error(
    `Needs clarification: "${trimmed}" matches ${rows.length} tasks:\n${list}\nAsk the user which one they meant.`,
  );
}

// ---------------------------------------------------------------------------
// Tool schemas + executors
// ---------------------------------------------------------------------------

const createTaskInputSchema = z.object({
  title: z.string().trim().min(1).max(500).describe("Short title (under 100 chars)"),
  description: z
    .string()
    .trim()
    .max(10_000)
    .optional()
    .describe("Optional longer detail or context"),
  status: z
    .enum(TASK_STATUSES)
    .optional()
    .describe("Which kanban column. Default 'things to think about' if unclear."),
  priority: z.enum(TASK_PRIORITIES).optional().describe("Optional priority"),
});

const moveTaskInputSchema = z.object({
  taskQuery: z
    .string()
    .trim()
    .min(1)
    .max(300)
    .describe("Title (or distinctive fragment) of the task to move."),
  toStatus: z.enum(TASK_STATUSES).describe("Destination column."),
});

const updateTaskInputSchema = z.object({
  taskQuery: z
    .string()
    .trim()
    .min(1)
    .max(300)
    .describe("Title (or distinctive fragment) of the task to update."),
  title: z.string().trim().min(1).max(500).optional().describe("New title."),
  description: z
    .string()
    .trim()
    .max(10_000)
    .optional()
    .describe("New description. Pass empty string to clear."),
  priority: z.enum(TASK_PRIORITIES).optional().describe("New priority."),
  status: z
    .enum(TASK_STATUSES)
    .optional()
    .describe(
      "Move to a different column. Prefer moveTask when only the column changes.",
    ),
});

const deleteTaskInputSchema = z.object({
  taskQuery: z
    .string()
    .trim()
    .min(1)
    .max(300)
    .describe(
      "Title (or distinctive fragment) of the task to delete. Permanent — only call when the user explicitly asks to delete.",
    ),
});

const FIND_TASKS_DEFAULT_LIMIT = 10;
const FIND_TASKS_MAX_LIMIT = 25;

const findTasksInputSchema = z.object({
  query: z
    .string()
    .trim()
    .max(300)
    .optional()
    .describe(
      "Keyword fragment matched against title and description (case-insensitive). Omit to list by filter alone.",
    ),
  status: z
    .enum(TASK_STATUSES)
    .optional()
    .describe("Restrict to a specific kanban column."),
  source: z
    .enum(TASK_SOURCES)
    .optional()
    .describe(
      "Restrict to a specific origin (e.g. 'gmail' for emailed-in items, 'jira' for assigned issues).",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(FIND_TASKS_MAX_LIMIT)
    .optional()
    .describe(
      `Max rows to return. Default ${FIND_TASKS_DEFAULT_LIMIT}, cap ${FIND_TASKS_MAX_LIMIT}.`,
    ),
});

const FIND_MEMORIES_DEFAULT_LIMIT = 5;
const FIND_MEMORIES_MAX_LIMIT = 10;

const findMemoriesInputSchema = z.object({
  query: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .describe("Question or phrase to semantically match against saved memories."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(FIND_MEMORIES_MAX_LIMIT)
    .optional()
    .describe(
      `Max matches to return. Default ${FIND_MEMORIES_DEFAULT_LIMIT}, cap ${FIND_MEMORIES_MAX_LIMIT}.`,
    ),
});

type CreateTaskInput = z.infer<typeof createTaskInputSchema>;
type MoveTaskInput = z.infer<typeof moveTaskInputSchema>;
type UpdateTaskInput = z.infer<typeof updateTaskInputSchema>;
type DeleteTaskInput = z.infer<typeof deleteTaskInputSchema>;
type FindTasksInput = z.infer<typeof findTasksInputSchema>;
type FindMemoriesInput = z.infer<typeof findMemoriesInputSchema>;

type TaskSummary = {
  id: string;
  title: string;
  status: TaskStatus;
  source: TaskSource;
  source_account: string | null;
  priority: Task["priority"];
  due_date: string | null;
};

type MemoryMatchSummary = {
  id: string;
  content: string;
  similarity: number;
  created_at: string;
};

type TaskMutationResult = {
  id: string;
  title: string;
  status: TaskStatus;
};

async function execCreateTask(
  supabase: SupabaseClient,
  userId: string,
  args: CreateTaskInput,
): Promise<TaskMutationResult> {
  const status: TaskStatus = args.status ?? "things to think about";

  const { data: maxPos } = await supabase
    .from("tasks")
    .select("position")
    .eq("user_id", userId)
    .eq("status", status)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const position = (maxPos?.position ?? -1) + 1;

  const { data, error } = await supabase
    .from("tasks")
    .insert({
      user_id: userId,
      title: args.title,
      description: args.description ?? null,
      status,
      priority: args.priority ?? null,
      position,
    })
    .select("id, title, status")
    .single();
  if (error) throw new Error(`createTask: ${error.message}`);
  return data as TaskMutationResult;
}

async function execMoveTask(
  supabase: SupabaseClient,
  userId: string,
  args: MoveTaskInput,
): Promise<TaskMutationResult & { fromStatus: TaskStatus }> {
  const target = await resolveTaskByQuery(supabase, userId, args.taskQuery);
  if (target.status === args.toStatus) {
    return { ...target, fromStatus: target.status };
  }

  const { data: maxPos } = await supabase
    .from("tasks")
    .select("position")
    .eq("user_id", userId)
    .eq("status", args.toStatus)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const position = (maxPos?.position ?? -1) + 1;

  const { data, error } = await supabase
    .from("tasks")
    .update({ status: args.toStatus, position })
    .eq("id", target.id)
    .eq("user_id", userId)
    .select("id, title, status")
    .single();
  if (error) throw new Error(`moveTask: ${error.message}`);

  return {
    ...(data as TaskMutationResult),
    fromStatus: target.status,
  };
}

async function execUpdateTask(
  supabase: SupabaseClient,
  userId: string,
  args: UpdateTaskInput,
): Promise<TaskMutationResult & { changedFields: string[] }> {
  const target = await resolveTaskByQuery(supabase, userId, args.taskQuery);

  const patch: Record<string, unknown> = {};
  if (args.title !== undefined) patch.title = args.title;
  if (args.description !== undefined) {
    patch.description = args.description === "" ? null : args.description;
  }
  if (args.priority !== undefined) patch.priority = args.priority;
  if (args.status !== undefined && args.status !== target.status) {
    patch.status = args.status;
    const { data: maxPos } = await supabase
      .from("tasks")
      .select("position")
      .eq("user_id", userId)
      .eq("status", args.status)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    patch.position = (maxPos?.position ?? -1) + 1;
  }

  if (Object.keys(patch).length === 0) {
    throw new Error("updateTask: nothing to change — pass at least one field.");
  }

  const { data, error } = await supabase
    .from("tasks")
    .update(patch)
    .eq("id", target.id)
    .eq("user_id", userId)
    .select("id, title, status")
    .single();
  if (error) throw new Error(`updateTask: ${error.message}`);

  return {
    ...(data as TaskMutationResult),
    changedFields: Object.keys(patch).filter((k) => k !== "position"),
  };
}

async function execDeleteTask(
  supabase: SupabaseClient,
  userId: string,
  args: DeleteTaskInput,
): Promise<TaskMutationResult> {
  const target = await resolveTaskByQuery(supabase, userId, args.taskQuery);

  const { error } = await supabase
    .from("tasks")
    .delete()
    .eq("id", target.id)
    .eq("user_id", userId);
  if (error) throw new Error(`deleteTask: ${error.message}`);

  return target;
}

async function execFindTasks(
  supabase: SupabaseClient,
  userId: string,
  args: FindTasksInput,
): Promise<{ tasks: TaskSummary[]; count: number }> {
  const limit = Math.min(
    args.limit ?? FIND_TASKS_DEFAULT_LIMIT,
    FIND_TASKS_MAX_LIMIT,
  );

  let query = supabase
    .from("tasks")
    .select("id, title, status, source, source_account, priority, due_date")
    .eq("user_id", userId);

  if (args.status) query = query.eq("status", args.status);
  if (args.source) query = query.eq("source", args.source);

  if (args.query && args.query.length > 0) {
    const safe = args.query.replace(/[%,()]/g, " ");
    const pattern = `%${safe}%`;
    query = query.or(`title.ilike.${pattern},description.ilike.${pattern}`);
  }

  const { data, error } = await query
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`findTasks: ${error.message}`);

  const tasks = (data ?? []) as TaskSummary[];
  return { tasks, count: tasks.length };
}

async function execFindMemories(
  supabase: SupabaseClient,
  args: FindMemoriesInput,
): Promise<{ memories: MemoryMatchSummary[]; count: number }> {
  const limit = Math.min(
    args.limit ?? FIND_MEMORIES_DEFAULT_LIMIT,
    FIND_MEMORIES_MAX_LIMIT,
  );

  const matches = await searchMemories(supabase, args.query, limit);
  const memories: MemoryMatchSummary[] = matches.map((m) => ({
    id: m.id,
    content: m.content,
    similarity: m.similarity,
    created_at: m.created_at,
  }));
  return { memories, count: memories.length };
}

// ---------------------------------------------------------------------------
// Agent factory
// ---------------------------------------------------------------------------

export function buildAgent(supabase: SupabaseClient, userId: string) {
  return new ToolLoopAgent({
    model: google(CHAT_MODEL_ID),
    instructions: CHAT_SYSTEM_PROMPT,
    stopWhen: stepCountIs(MAX_TOOL_STEPS),
    temperature: 0.6,
    maxOutputTokens: 1500,
    providerOptions: {
      google: { thinkingConfig: { thinkingBudget: 0 } },
    },
    tools: {
      createTask: tool({
        description:
          "Add a new task to Bashir's kanban board. Use whenever the user asks to capture, add, jot, or queue something.",
        inputSchema: createTaskInputSchema,
        execute: (args) => execCreateTask(supabase, userId, args),
      }),
      moveTask: tool({
        description:
          "Move an existing task to a different kanban column. Identify the task by a fragment of its title.",
        inputSchema: moveTaskInputSchema,
        execute: (args) => execMoveTask(supabase, userId, args),
      }),
      updateTask: tool({
        description:
          "Change the title, description, priority, or status of an existing task. Pass only the fields that should change.",
        inputSchema: updateTaskInputSchema,
        execute: (args) => execUpdateTask(supabase, userId, args),
      }),
      deleteTask: tool({
        description:
          "Permanently remove a task. Call only when the user explicitly asks to delete.",
        inputSchema: deleteTaskInputSchema,
        execute: (args) => execDeleteTask(supabase, userId, args),
      }),
      findTasks: tool({
        description:
          "Read-only keyword/filter search across Bashir's full board. Use for specific lookups instead of relying on the truncated injected snapshot.",
        inputSchema: findTasksInputSchema,
        execute: (args) => execFindTasks(supabase, userId, args),
      }),
      findMemories: tool({
        description:
          "Read-only semantic search over Bashir's long-term memories. Use when the auto-injected memories don't cover what's needed.",
        inputSchema: findMemoriesInputSchema,
        execute: (args) => execFindMemories(supabase, args),
      }),
    },
  });
}

// ---------------------------------------------------------------------------
// Tool name registry (mirrored on the client for typed UIMessage parts)
// ---------------------------------------------------------------------------

export const TOOL_NAMES = [
  "createTask",
  "moveTask",
  "updateTask",
  "deleteTask",
  "findTasks",
  "findMemories",
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

// ---------------------------------------------------------------------------
// Message persistence + history hydration
// ---------------------------------------------------------------------------

export async function saveChatMessage(
  supabase: SupabaseClient,
  userId: string,
  role: ChatRole,
  content: string,
): Promise<ChatMessage> {
  const { data, error } = await supabase
    .from("chat_messages")
    .insert({ user_id: userId, role, content })
    .select("*")
    .single();
  if (error) throw new Error(`Failed to save ${role} message: ${error.message}`);
  return data as ChatMessage;
}

export async function loadHistory(
  supabase: SupabaseClient,
  userId: string,
  limit: number = CHAT_HISTORY_LIMIT,
): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from("chat_messages")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Failed to load chat history: ${error.message}`);
  return ((data ?? []) as ChatMessage[]).reverse();
}

// ---------------------------------------------------------------------------
// Build the ModelMessage[] payload sent to the agent for a given turn
// ---------------------------------------------------------------------------

export async function buildAgentMessages(
  supabase: SupabaseClient,
  userId: string,
  userMessage: string,
): Promise<ModelMessage[]> {
  const [history, contextLines] = await Promise.all([
    loadHistory(supabase, userId),
    buildContextLines(supabase, userId, userMessage),
  ]);

  return [
    {
      role: "user",
      content: `[Current context — refreshed every turn]\n${contextLines.join("\n")}`,
    },
    {
      role: "assistant",
      content: "Acknowledged. I'll use this context as needed.",
    },
    ...history.map<ModelMessage>((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    })),
  ];
}

async function buildContextLines(
  supabase: SupabaseClient,
  userId: string,
  userMessage: string,
): Promise<string[]> {
  const now = new Date();
  const gmailSince = new Date(
    now.getTime() - GMAIL_LOOKBACK_HOURS * 60 * 60 * 1000,
  ).toISOString();
  const calendarHorizon = new Date(
    now.getTime() + CALENDAR_HORIZON_HOURS * 60 * 60 * 1000,
  ).toISOString();

  const [tasks, upcomingEvents, recentGmail, memories] = await Promise.all([
    supabase
      .from("tasks")
      .select("title, status, priority")
      .eq("user_id", userId)
      .order("position", { ascending: true }),
    supabase
      .from("tasks")
      .select("title, due_date")
      .eq("user_id", userId)
      .eq("source", "calendar")
      .gte("due_date", now.toISOString())
      .lte("due_date", calendarHorizon)
      .order("due_date", { ascending: true })
      .limit(12),
    supabase
      .from("tasks")
      .select("title, description, source_account, created_at")
      .eq("user_id", userId)
      .eq("source", "gmail")
      .gte("created_at", gmailSince)
      .order("created_at", { ascending: false })
      .limit(8),
    searchMemories(supabase, userMessage, MEMORY_MATCH_LIMIT).catch((err) => {
      console.error("[chat] memory search failed:", err);
      return [];
    }),
  ]);

  const allTasks = (tasks.data ?? []) as Task[];

  const lines: string[] = [];
  lines.push(`Today: ${now.toISOString().slice(0, 10)}`);
  lines.push("");

  if (memories.length > 0) {
    lines.push("Memories matching this message (most-relevant first):");
    for (const m of memories) {
      lines.push(`  - ${m.content}`);
    }
    lines.push("");
  }

  lines.push("Board (tasks by column — refer to them by title when calling tools):");
  for (const status of TASK_STATUSES) {
    const inColumn = allTasks.filter((t) => t.status === status);
    lines.push(`  ${status} (${inColumn.length}):`);
    for (const t of inColumn.slice(0, CONTEXT_TASKS_PER_COLUMN)) {
      lines.push(
        `    - ${t.title}${t.priority ? ` [${t.priority}]` : ""}`,
      );
    }
    if (inColumn.length > CONTEXT_TASKS_PER_COLUMN) {
      lines.push(
        `    … and ${inColumn.length - CONTEXT_TASKS_PER_COLUMN} more`,
      );
    }
  }
  lines.push("");

  if ((upcomingEvents.data ?? []).length > 0) {
    lines.push("Calendar (next 24h):");
    for (const e of upcomingEvents.data ?? []) {
      const when = e.due_date
        ? new Date(e.due_date as string).toLocaleString(undefined, {
            weekday: "short",
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
          })
        : "time unknown";
      lines.push(`  - ${e.title} (${when})`);
    }
    lines.push("");
  }

  if ((recentGmail.data ?? []).length > 0) {
    lines.push("Recent emails (last 48h):");
    for (const t of recentGmail.data ?? []) {
      const snippet = ((t.description as string | null) ?? "")
        .replace(/^From:.*?\n\n/, "")
        .slice(0, 120);
      lines.push(`  - ${t.title}${snippet ? ` — ${snippet}` : ""}`);
    }
    lines.push("");
  }

  return lines;
}
