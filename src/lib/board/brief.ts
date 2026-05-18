import { generateText } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CHAT_MODEL_ID, google } from "@/lib/gemini/client";
import { TASK_STATUSES, type Task, type TaskStatus } from "@/lib/supabase/types";

const BRIEF_SYSTEM_PROMPT = `You are a calm, sharp morning briefer for Bash OS, a single-user life-OS kanban.
Write one short brief (90 to 130 words) in plain prose — no bullet lists, no headers, no emojis.
Open with a one-sentence read on the day. Then call out the 2-3 most important things to focus on, naming specific tasks by their titles when possible. Close with a single nudge toward action.
Avoid platitudes, never invent items that aren't in the context, and don't summarize the brief itself.`;

const BRIEF_TIMEZONE = "Asia/Dubai";

type BriefContext = {
  today: string;
  countsByStatus: Record<TaskStatus, number>;
  recentGmailTasks: Pick<Task, "title" | "description" | "created_at">[];
  upcomingCalendarEvents: Pick<Task, "title" | "description" | "due_date">[];
  activePlateTasks: Pick<Task, "title" | "priority">[];
  thingsToThinkAboutSample: Pick<Task, "title">[];
};

export async function generateAndStoreBrief(
  supabase: SupabaseClient,
  userId: string,
  now: Date = new Date(),
): Promise<{ briefId: string; briefDate: string; content: string }> {
  const briefDate = dubaiDate(now);
  const context = await assembleContext(supabase, userId, now, briefDate);

  const { text: briefText, finishReason } = await generateText({
    model: google(CHAT_MODEL_ID),
    system: BRIEF_SYSTEM_PROMPT,
    prompt: renderContext(context),
    maxOutputTokens: 600,
    temperature: 0.5,
    providerOptions: {
      google: { thinkingConfig: { thinkingBudget: 0 } },
    },
  });
  if (finishReason !== "stop") {
    throw new Error(
      `Brief truncated (${finishReason}). Raise maxOutputTokens or lower thinkingBudget.`,
    );
  }

  // Upsert on (user_id, brief_date). Re-running the cron same day overwrites
  // the day's brief rather than stacking — the unique constraint enforces it
  // at the DB level and the trigger bumps updated_at.
  const { data: inserted, error } = await supabase
    .from("briefs")
    .upsert(
      {
        user_id: userId,
        brief_date: briefDate,
        content: briefText,
      },
      { onConflict: "user_id,brief_date" },
    )
    .select("id, brief_date, content")
    .single();

  if (error) {
    throw new Error(`Failed to upsert brief: ${error.message}`);
  }

  return {
    briefId: inserted.id as string,
    briefDate: inserted.brief_date as string,
    content: inserted.content as string,
  };
}

async function assembleContext(
  supabase: SupabaseClient,
  userId: string,
  now: Date,
  briefDate: string,
): Promise<BriefContext> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const horizon = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

  const [allTasks, recentGmail, upcomingEvents] = await Promise.all([
    supabase
      .from("tasks")
      .select("title, status, priority, description, created_at")
      .eq("user_id", userId)
      .order("position", { ascending: true }),
    supabase
      .from("tasks")
      .select("title, description, created_at")
      .eq("user_id", userId)
      .eq("source", "gmail")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(12),
    supabase
      .from("tasks")
      .select("title, description, due_date")
      .eq("user_id", userId)
      .eq("source", "calendar")
      .gte("due_date", now.toISOString())
      .lte("due_date", horizon)
      .order("due_date", { ascending: true })
      .limit(15),
  ]);

  if (allTasks.error) {
    throw new Error(`Brief: failed to read tasks: ${allTasks.error.message}`);
  }
  if (recentGmail.error) {
    throw new Error(
      `Brief: failed to read recent Gmail tasks: ${recentGmail.error.message}`,
    );
  }
  if (upcomingEvents.error) {
    throw new Error(
      `Brief: failed to read upcoming calendar events: ${upcomingEvents.error.message}`,
    );
  }

  const tasks = (allTasks.data ?? []) as Task[];

  const countsByStatus = Object.fromEntries(
    TASK_STATUSES.map((s) => [s, 0]),
  ) as Record<TaskStatus, number>;
  for (const t of tasks) countsByStatus[t.status] += 1;

  const activePlateTasks = tasks
    .filter((t) => t.status === "todays plate")
    .map(({ title, priority }) => ({ title, priority }));

  const thingsToThinkAboutSample = tasks
    .filter((t) => t.status === "things to think about")
    .slice(0, 6)
    .map(({ title }) => ({ title }));

  return {
    today: briefDate,
    countsByStatus,
    recentGmailTasks: (recentGmail.data ?? []) as BriefContext["recentGmailTasks"],
    upcomingCalendarEvents: (upcomingEvents.data ??
      []) as BriefContext["upcomingCalendarEvents"],
    activePlateTasks,
    thingsToThinkAboutSample,
  };
}

function renderContext(ctx: BriefContext): string {
  const lines: string[] = [];
  lines.push(`Today: ${ctx.today}`);
  lines.push("");
  lines.push("Board state (count by column):");
  for (const status of TASK_STATUSES) {
    lines.push(`  - ${status}: ${ctx.countsByStatus[status]}`);
  }
  lines.push("");

  if (ctx.activePlateTasks.length > 0) {
    lines.push("Today's plate (in order):");
    for (const t of ctx.activePlateTasks) {
      lines.push(
        `  - ${t.title}${t.priority ? ` [priority: ${t.priority}]` : ""}`,
      );
    }
    lines.push("");
  }

  if (ctx.thingsToThinkAboutSample.length > 0) {
    lines.push("Sampled from 'things to think about':");
    for (const t of ctx.thingsToThinkAboutSample) {
      lines.push(`  - ${t.title}`);
    }
    lines.push("");
  }

  if (ctx.upcomingCalendarEvents.length > 0) {
    lines.push("Calendar events in the next 24 hours:");
    for (const e of ctx.upcomingCalendarEvents) {
      const when = e.due_date
        ? new Date(e.due_date).toLocaleString(undefined, {
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

  if (ctx.recentGmailTasks.length > 0) {
    lines.push("New emails synced in the last 24 hours:");
    for (const t of ctx.recentGmailTasks) {
      const snippet = (t.description ?? "")
        .replace(/^From:.*?\n\n/, "")
        .slice(0, 160);
      lines.push(`  - ${t.title} — ${snippet}`);
    }
    lines.push("");
  }

  lines.push("Write the brief now.");
  return lines.join("\n");
}

// Convert a Date to a YYYY-MM-DD string in Dubai's local calendar. Dubai is a
// fixed UTC+4 (no DST), so a brief generated at 05:30 UTC always lands on the
// correct Dubai morning even if a re-run happens later in the same UTC day.
function dubaiDate(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BRIEF_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const year = parts.find((p) => p.type === "year")?.value ?? "0000";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}
