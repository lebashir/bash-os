"use server";

import { createClient } from "@/lib/supabase/server";

// R3.5 brief panel state — pure deterministic computation from current DB
// rows. No LLM call. Each attention bar is only included when its trigger
// actually fires; the panel can be empty except for the day update card.

export type AttentionBarKind =
  | "calendar-imminent"
  | "tasks-overdue"
  | "emails-urgent"
  | "needs-review"
  | "emails-triage"
  | "items-unsnoozed";

export type AttentionTreatment = "urgent" | "amber" | "info";

export interface AttentionBar {
  kind: AttentionBarKind;
  treatment: AttentionTreatment;
  message: string;
  count: number;
  payload?: {
    eventId?: string;
    columnId?: string;
  };
}

export interface DayUpdateEvent {
  id: string;
  title: string;
  startsAt: string;
  minutesUntil: number;
}

export interface DayUpdate {
  nextEvent: DayUpdateEvent | null;
  onPlate: number;
  urgent: number;
  inbox: number;
}

export interface BriefState {
  attentionBars: AttentionBar[];
  dayUpdate: DayUpdate;
}

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const URGENT_EMAIL_THRESHOLD = 9;

interface ColumnRow {
  id: string;
  name: string;
}

interface TaskRow {
  id: string;
  title: string;
  column_id: string;
  source: string;
  due_date: string | null;
  priority: string | null;
  importance: number | null;
  needs_review: boolean;
  snoozed_until: string | null;
}

interface PendingEmailRow {
  id: string;
  score: number;
  snoozed_until: string | null;
}

export async function getBriefState(): Promise<BriefState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return emptyState();
  }

  const nowIso = new Date().toISOString();

  const [columnsRes, tasksRes, pendingRes] = await Promise.all([
    supabase
      .from("columns")
      .select("id, name")
      .eq("user_id", user.id),
    supabase
      .from("tasks")
      .select(
        "id, title, column_id, source, due_date, priority, importance, needs_review, snoozed_until",
      )
      .eq("user_id", user.id)
      .or(`snoozed_until.is.null,snoozed_until.lte.${nowIso}`),
    supabase
      .from("pending_emails")
      .select("id, score, snoozed_until")
      .eq("user_id", user.id)
      .or(`snoozed_until.is.null,snoozed_until.lte.${nowIso}`),
  ]);

  if (columnsRes.error || tasksRes.error || pendingRes.error) {
    return emptyState();
  }

  const columns = (columnsRes.data ?? []) as ColumnRow[];
  const tasks = (tasksRes.data ?? []) as TaskRow[];
  const pending = (pendingRes.data ?? []) as PendingEmailRow[];

  const columnByName = new Map(columns.map((c) => [c.name, c.id]));
  const doneId = columnByName.get("Done");
  const inboxId = columnByName.get("Inbox");
  const todayId = columnByName.get("Today");
  const reviewId = columnByName.get("Review");
  const nonDone = (t: TaskRow) => t.column_id !== doneId;

  const now = Date.now();
  const fifteenFromNow = now + FIFTEEN_MINUTES_MS;
  const twentyFourAgo = now - TWENTY_FOUR_HOURS_MS;

  const activeTasks = tasks.filter(nonDone);

  const upcomingCalendar = activeTasks
    .filter((t) => t.source === "calendar" && t.due_date !== null)
    .map((t) => ({ ...t, _dueMs: Date.parse(t.due_date!) }))
    .filter((t) => Number.isFinite(t._dueMs) && t._dueMs > now)
    .sort((a, b) => a._dueMs - b._dueMs);

  const imminent = upcomingCalendar.filter((t) => t._dueMs <= fifteenFromNow);
  const overdue = activeTasks.filter(
    (t) => t.due_date !== null && Date.parse(t.due_date) < now,
  );
  const urgentEmails = activeTasks.filter(
    (t) =>
      t.source === "gmail" &&
      typeof t.importance === "number" &&
      t.importance >= URGENT_EMAIL_THRESHOLD,
  );
  const needsReview = activeTasks.filter((t) => t.needs_review);
  const pendingEmails = pending;
  const unsnoozedRecently = tasks.filter((t) => {
    if (t.snoozed_until === null) return false;
    const ms = Date.parse(t.snoozed_until);
    return ms >= twentyFourAgo && ms <= now;
  });

  const bars: AttentionBar[] = [];

  if (imminent.length > 0) {
    const next = imminent[0];
    const mins = Math.max(0, Math.round((next._dueMs - now) / 60000));
    bars.push({
      kind: "calendar-imminent",
      treatment: "urgent",
      message: `${truncate(next.title, 40)} in ${mins} min`,
      count: imminent.length,
      payload: { eventId: next.id },
    });
  }

  if (overdue.length > 0) {
    bars.push({
      kind: "tasks-overdue",
      treatment: "urgent",
      message: `${overdue.length} overdue ${overdue.length === 1 ? "task" : "tasks"}`,
      count: overdue.length,
    });
  }

  if (urgentEmails.length > 0) {
    bars.push({
      kind: "emails-urgent",
      treatment: "urgent",
      message: `${urgentEmails.length} urgent ${urgentEmails.length === 1 ? "email" : "emails"}`,
      count: urgentEmails.length,
    });
  }

  if (needsReview.length > 0) {
    bars.push({
      kind: "needs-review",
      treatment: "amber",
      message: `${needsReview.length} ${needsReview.length === 1 ? "task" : "tasks"} need review`,
      count: needsReview.length,
      payload: reviewId ? { columnId: reviewId } : undefined,
    });
  }

  if (pendingEmails.length > 0) {
    bars.push({
      kind: "emails-triage",
      treatment: "amber",
      message: `${pendingEmails.length} ${pendingEmails.length === 1 ? "email" : "emails"} to review`,
      count: pendingEmails.length,
    });
  }

  if (unsnoozedRecently.length > 0) {
    bars.push({
      kind: "items-unsnoozed",
      treatment: "info",
      message: `${unsnoozedRecently.length} unsnoozed`,
      count: unsnoozedRecently.length,
    });
  }

  const nextEvent: DayUpdateEvent | null = upcomingCalendar[0]
    ? {
        id: upcomingCalendar[0].id,
        title: upcomingCalendar[0].title,
        startsAt: upcomingCalendar[0].due_date!,
        minutesUntil: Math.max(
          0,
          Math.round((upcomingCalendar[0]._dueMs - now) / 60000),
        ),
      }
    : null;

  const onPlate = todayId
    ? activeTasks.filter((t) => t.column_id === todayId).length
    : 0;
  const urgent = activeTasks.filter(
    (t) =>
      t.priority === "urgent" ||
      (typeof t.importance === "number" &&
        t.importance >= URGENT_EMAIL_THRESHOLD),
  ).length;
  const inbox = inboxId
    ? activeTasks.filter((t) => t.column_id === inboxId).length
    : 0;

  return {
    attentionBars: bars,
    dayUpdate: { nextEvent, onPlate, urgent, inbox },
  };
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
}

function emptyState(): BriefState {
  return {
    attentionBars: [],
    dayUpdate: { nextEvent: null, onPlate: 0, urgent: 0, inbox: 0 },
  };
}
