import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type ModelMessage,
  stepCountIs,
  tool,
  ToolLoopAgent,
} from "ai";
import { z } from "zod";
import { CHAT_MODEL_ID, google } from "@/lib/gemini/client";
import { searchMemories } from "@/lib/board/memory-search";
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  type ChatMessage,
  type Task,
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

You can take real action on the board through these tools:
- createTask: add a new task. Use whenever the user asks to capture, add, jot, or queue something. Default to "things to think about" for vague captures and "todays plate" only when the user explicitly says today/now/urgent.
- moveTask: move an existing task to a different column. Refer to the task by a fragment of its title — the tool resolves it server-side.
- updateTask: change the title, description, priority, or status of an existing task. Pass only the fields that change.
- deleteTask: permanently remove a task. Only call this when the user explicitly asks to delete (not "archive", "move", or "done"). If unsure, ask first.

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
  // PostgREST ilike pattern; escape PostgREST reserved chars conservatively.
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

  // Prefer exact (case-insensitive) match if present — agents often pass the
  // full title from context.
  const lower = trimmed.toLowerCase();
  const exact = rows.find((r) => r.title.toLowerCase() === lower);
  if (exact) return exact;

  if (rows.length === 1) return rows[0];

  const list = rows
    .map((r) => `- "${r.title}" [${r.status}]`)
    .join("\n");
  throw new Error(
    `Needs clarification: "${trimmed}" matches ${rows.length} tasks:\n${list}\nAsk the user which one they meant.`,
  );
}

// ---------------------------------------------------------------------------
// Tool implementations
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

type CreateTaskInput = z.infer<typeof createTaskInputSchema>;
type MoveTaskInput = z.infer<typeof moveTaskInputSchema>;
type UpdateTaskInput = z.infer<typeof updateTaskInputSchema>;
type DeleteTaskInput = z.infer<typeof deleteTaskInputSchema>;

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
    // Re-position to end of target column to avoid colliding with an existing
    // position there.
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

function buildAgent(supabase: SupabaseClient, userId: string) {
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
    },
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const TOOL_NAMES = [
  "createTask",
  "moveTask",
  "updateTask",
  "deleteTask",
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export type ChatTurnInput = {
  supabase: SupabaseClient;
  userId: string;
  userMessage: string;
};

export type ChatTurnOutput = {
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
  toolActions: Array<{ name: ToolName; result: Record<string, unknown> }>;
};

export async function runChatTurn(
  input: ChatTurnInput,
): Promise<ChatTurnOutput> {
  const trimmed = input.userMessage.trim();
  if (!trimmed) throw new Error("Message is empty.");

  const { data: userRow, error: userErr } = await input.supabase
    .from("chat_messages")
    .insert({ user_id: input.userId, role: "user", content: trimmed })
    .select("*")
    .single();
  if (userErr) throw new Error(`Failed to save message: ${userErr.message}`);

  const [history, contextLines] = await Promise.all([
    loadHistory(input.supabase, input.userId),
    buildContextLines(input.supabase, input.userId, trimmed),
  ]);

  const messages: ModelMessage[] = [
    {
      role: "user",
      content: `[Current context — refreshed every turn]\n${contextLines.join("\n")}`,
    },
    { role: "assistant", content: "Acknowledged. I'll use this context as needed." },
    ...history.map<ModelMessage>((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    })),
  ];

  const agent = buildAgent(input.supabase, input.userId);
  const result = await agent.generate({ messages });

  const finalText = result.text.trim();
  if (!finalText) {
    throw new Error(
      `Chat returned no text (finish: ${result.finishReason}, steps: ${result.steps.length}).`,
    );
  }

  const toolActions = collectToolActions(result.steps);

  const { data: assistantRow, error: assistantErr } = await input.supabase
    .from("chat_messages")
    .insert({
      user_id: input.userId,
      role: "assistant",
      content: finalText,
    })
    .select("*")
    .single();
  if (assistantErr) {
    throw new Error(`Failed to save reply: ${assistantErr.message}`);
  }

  return {
    userMessage: userRow as ChatMessage,
    assistantMessage: assistantRow as ChatMessage,
    toolActions,
  };
}

type AgentSteps = Awaited<ReturnType<ReturnType<typeof buildAgent>["generate"]>>["steps"];

function isToolName(name: string): name is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(name);
}

function collectToolActions(
  steps: AgentSteps,
): ChatTurnOutput["toolActions"] {
  const actions: ChatTurnOutput["toolActions"] = [];
  for (const step of steps) {
    for (const tr of step.toolResults) {
      if (!isToolName(tr.toolName)) continue;
      // Successful tool results expose `output`; error results don't.
      if (!("output" in tr) || tr.output === undefined) continue;
      actions.push({
        name: tr.toolName,
        result: tr.output as Record<string, unknown>,
      });
    }
  }
  return actions;
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
    // Memory search failures shouldn't break the chat turn — treat them as
    // "no memories matched" and log; the assistant can still reply.
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
