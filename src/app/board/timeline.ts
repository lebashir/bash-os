"use server";

import { createClient } from "@/lib/supabase/server";

// Timeline panel data. Returns calendar events (from public.tasks rows
// originating in the Google Calendar connector) interleaved with task
// events (from public.task_events). All times are ISO strings; the client
// renders them in the user's local timezone.

export type TimelineEventKind =
  | "calendar"
  | "task-created"
  | "task-completed"
  | "task-moved"
  | "task-updated"
  | "task-deleted";

export interface TimelineEvent {
  id: string;
  kind: TimelineEventKind;
  at: string;
  title: string;
  meta?: string;
}

const DEFAULT_DAY_LOOKBACK_HOURS = 4;
const DEFAULT_DAY_LOOKAHEAD_HOURS = 16;

interface CalendarTaskRow {
  id: string;
  title: string;
  due_date: string | null;
}

interface TaskEventRow {
  id: string;
  task_id: string | null;
  event_type: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  // PostgREST returns embedded relations as arrays. The FK is many-to-one so
  // at most one row appears.
  tasks: { title: string | null }[] | null;
}

export async function getTimelineEvents(): Promise<TimelineEvent[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const now = Date.now();
  const fromIso = new Date(
    now - DEFAULT_DAY_LOOKBACK_HOURS * 60 * 60 * 1000,
  ).toISOString();
  const toIso = new Date(
    now + DEFAULT_DAY_LOOKAHEAD_HOURS * 60 * 60 * 1000,
  ).toISOString();

  const [calendarRes, eventsRes] = await Promise.all([
    supabase
      .from("tasks")
      .select("id, title, due_date")
      .eq("user_id", user.id)
      .eq("source", "calendar")
      .gte("due_date", fromIso)
      .lte("due_date", toIso)
      .order("due_date", { ascending: true }),
    supabase
      .from("task_events")
      .select("id, task_id, event_type, metadata, created_at, tasks(title)")
      .eq("user_id", user.id)
      .gte("created_at", fromIso)
      .lte("created_at", toIso)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  if (calendarRes.error || eventsRes.error) return [];

  const calendarEvents: TimelineEvent[] = (
    (calendarRes.data ?? []) as CalendarTaskRow[]
  )
    .filter((r) => r.due_date !== null)
    .map((r) => ({
      id: `cal-${r.id}`,
      kind: "calendar",
      at: r.due_date!,
      title: r.title,
    }));

  const taskEvents: TimelineEvent[] = (
    (eventsRes.data ?? []) as TaskEventRow[]
  ).map((r) => mapTaskEvent(r));

  const combined = [...calendarEvents, ...taskEvents]
    .filter((e) => Number.isFinite(Date.parse(e.at)))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  return combined;
}

function mapTaskEvent(row: TaskEventRow): TimelineEvent {
  const title = row.tasks?.[0]?.title ?? "(task)";
  const metadata = row.metadata ?? {};
  switch (row.event_type) {
    case "created":
      return {
        id: row.id,
        kind: "task-created",
        at: row.created_at,
        title,
        meta:
          typeof metadata.source === "string"
            ? `from ${metadata.source}`
            : undefined,
      };
    case "completed":
      return {
        id: row.id,
        kind: "task-completed",
        at: row.created_at,
        title,
      };
    case "moved":
      return {
        id: row.id,
        kind: "task-moved",
        at: row.created_at,
        title,
        meta:
          typeof metadata.to_column === "string"
            ? `to ${metadata.to_column}`
            : undefined,
      };
    case "deleted":
      return { id: row.id, kind: "task-deleted", at: row.created_at, title };
    default:
      return { id: row.id, kind: "task-updated", at: row.created_at, title };
  }
}
