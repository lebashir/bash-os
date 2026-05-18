import type { SupabaseClient } from "@supabase/supabase-js";
import { geminiChat, type GeminiChatMessage } from "@/lib/gemini/client";
import { TASK_STATUSES, type ChatMessage, type Task, type TaskStatus } from "@/lib/supabase/types";

const CHAT_HISTORY_LIMIT = 20;
const CALENDAR_HORIZON_HOURS = 24;
const GMAIL_LOOKBACK_HOURS = 48;

const CHAT_SYSTEM_PROMPT = `You are Bash OS's chat assistant — a calm, sharp helper for Bashir's personal life-OS.
You have visibility into the current kanban board, today's calendar events, and recently-synced emails. Use this context when it's relevant; ignore it when it isn't.
Keep replies tight: a few sentences for most questions, a short list only when explicitly asked for structure. No emojis, no over-apologizing, no preamble like "Sure! Let me help…". When the user gives you a fact worth remembering long-term, acknowledge it in one short sentence — the UI handles persistence.
When the user asks for next-action proposals, name specific items by their titles. If something the user is asking about isn't in the context, say so plainly.`;

export type ChatTurnInput = {
  supabase: SupabaseClient;
  userId: string;
  userMessage: string;
};

export type ChatTurnOutput = {
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
};

export async function runChatTurn(
  input: ChatTurnInput,
): Promise<ChatTurnOutput> {
  const trimmed = input.userMessage.trim();
  if (!trimmed) throw new Error("Message is empty.");

  const { data: userRow, error: userErr } = await input.supabase
    .from("chat_messages")
    .insert({
      user_id: input.userId,
      role: "user",
      content: trimmed,
    })
    .select("*")
    .single();
  if (userErr) throw new Error(`Failed to save message: ${userErr.message}`);

  const [history, contextLines] = await Promise.all([
    loadHistory(input.supabase, input.userId),
    buildContextLines(input.supabase, input.userId),
  ]);

  const messages: GeminiChatMessage[] = [
    {
      role: "user",
      content: `[Current context — refreshed every turn]\n${contextLines.join("\n")}`,
    },
    {
      role: "assistant",
      content: "Acknowledged. I'll use this context as needed.",
    },
    ...history.map<GeminiChatMessage>((m) => ({
      role: m.role,
      content: m.content,
    })),
  ];

  const assistantText = await geminiChat({
    systemInstruction: CHAT_SYSTEM_PROMPT,
    messages,
    maxOutputTokens: 1200,
    temperature: 0.6,
    thinkingBudget: 0,
  });

  const { data: assistantRow, error: assistantErr } = await input.supabase
    .from("chat_messages")
    .insert({
      user_id: input.userId,
      role: "assistant",
      content: assistantText,
    })
    .select("*")
    .single();
  if (assistantErr) {
    throw new Error(`Failed to save reply: ${assistantErr.message}`);
  }

  return {
    userMessage: userRow as ChatMessage,
    assistantMessage: assistantRow as ChatMessage,
  };
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
): Promise<string[]> {
  const now = new Date();
  const gmailSince = new Date(
    now.getTime() - GMAIL_LOOKBACK_HOURS * 60 * 60 * 1000,
  ).toISOString();
  const calendarHorizon = new Date(
    now.getTime() + CALENDAR_HORIZON_HOURS * 60 * 60 * 1000,
  ).toISOString();

  const [tasks, upcomingEvents, recentGmail] = await Promise.all([
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
  ]);

  const allTasks = (tasks.data ?? []) as Task[];

  const lines: string[] = [];
  lines.push(`Today: ${now.toISOString().slice(0, 10)}`);
  lines.push("");

  lines.push("Board (count by column):");
  const countsByStatus = Object.fromEntries(
    TASK_STATUSES.map((s) => [s, 0]),
  ) as Record<TaskStatus, number>;
  for (const t of allTasks) countsByStatus[t.status] += 1;
  for (const status of TASK_STATUSES) {
    lines.push(`  - ${status}: ${countsByStatus[status]}`);
  }
  lines.push("");

  const plate = allTasks
    .filter((t) => t.status === "todays plate")
    .slice(0, 10);
  if (plate.length > 0) {
    lines.push("Today's plate:");
    for (const t of plate) {
      lines.push(
        `  - ${t.title}${t.priority ? ` [priority: ${t.priority}]` : ""}`,
      );
    }
    lines.push("");
  }

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
