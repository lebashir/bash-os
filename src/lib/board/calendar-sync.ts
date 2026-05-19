import type { SupabaseClient } from "@supabase/supabase-js";
import { getGoogleAccessToken } from "@/lib/google/token";
import { resolveColumnId } from "./columns";

const CALENDAR_BASE = "https://www.googleapis.com/calendar/v3";
const SYNC_LIMIT = 25;
const HORIZON_HOURS = 24;

export type SyncCalendarAccountResult = {
  accountEmail: string;
  created: number;
  skipped: number;
  error?: string;
};

export type SyncCalendarResult = {
  perAccount: SyncCalendarAccountResult[];
  totalCreated: number;
  totalSkipped: number;
};

type EventTime = { dateTime?: string; date?: string; timeZone?: string };

type CalendarEvent = {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  hangoutLink?: string;
  htmlLink?: string;
  start?: EventTime;
  end?: EventTime;
};

type CalendarListResponse = {
  items?: CalendarEvent[];
};

export async function syncCalendarForUser(
  supabase: SupabaseClient,
  userId: string,
): Promise<SyncCalendarResult> {
  const { data: tokens, error } = await supabase
    .from("connector_tokens")
    .select("account_email")
    .eq("user_id", userId)
    .eq("provider", "google")
    .not("account_email", "is", null)
    .order("account_email", { ascending: true });

  if (error) {
    throw new Error(`Failed to read connector tokens: ${error.message}`);
  }
  if (!tokens || tokens.length === 0) {
    throw new Error(
      "No Google accounts connected. Open the menu next to your email and connect one.",
    );
  }

  const perAccount: SyncCalendarAccountResult[] = [];

  for (const row of tokens) {
    const accountEmail = row.account_email as string;
    try {
      const accountResult = await syncOneAccount(
        supabase,
        userId,
        accountEmail,
      );
      perAccount.push(accountResult);
    } catch (e) {
      perAccount.push({
        accountEmail,
        created: 0,
        skipped: 0,
        error: e instanceof Error ? e.message : "Unknown error",
      });
    }
  }

  return {
    perAccount,
    totalCreated: perAccount.reduce((sum, r) => sum + r.created, 0),
    totalSkipped: perAccount.reduce((sum, r) => sum + r.skipped, 0),
  };
}

async function syncOneAccount(
  supabase: SupabaseClient,
  userId: string,
  accountEmail: string,
): Promise<SyncCalendarAccountResult> {
  const todayColumnId = await resolveColumnId(supabase, userId, "Today");
  if (!todayColumnId) {
    throw new Error("No Today column found for user — schema not seeded?");
  }
  const accessToken = await getGoogleAccessToken(supabase, userId, accountEmail);

  const now = new Date();
  const horizon = new Date(now.getTime() + HORIZON_HOURS * 60 * 60 * 1000);

  const url = new URL(`${CALENDAR_BASE}/calendars/primary/events`);
  url.searchParams.set("timeMin", now.toISOString());
  url.searchParams.set("timeMax", horizon.toISOString());
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", String(SYNC_LIMIT));

  const data = await calendarFetch<CalendarListResponse>(url, accessToken);
  const events = (data.items ?? []).filter(
    (e) => e.status !== "cancelled" && (e.start?.dateTime || e.start?.date),
  );
  if (events.length === 0) {
    return { accountEmail, created: 0, skipped: 0 };
  }

  const { data: maxPos } = await supabase
    .from("tasks")
    .select("position")
    .eq("user_id", userId)
    .eq("column_id", todayColumnId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const basePosition = (maxPos?.position ?? -1) + 1;

  const rows = events.map((event, i) => {
    const startIso = event.start?.dateTime ?? event.start?.date ?? null;
    return {
      user_id: userId,
      title: event.summary ?? "(no title)",
      description: renderEventDescription(event),
      column_id: todayColumnId,
      owner: "bash" as const,
      source: "calendar" as const,
      source_account: accountEmail,
      source_id: event.id,
      due_date: startIso ? new Date(startIso).toISOString() : null,
      position: basePosition + i,
    };
  });

  const { data: inserted, error: upsertError } = await supabase
    .from("tasks")
    .upsert(rows, {
      onConflict: "user_id,source,source_account,source_id",
      ignoreDuplicates: true,
    })
    .select("id");

  if (upsertError) {
    throw new Error(`Calendar upsert failed: ${upsertError.message}`);
  }

  const created = inserted?.length ?? 0;
  return { accountEmail, created, skipped: rows.length - created };
}

function renderEventDescription(event: CalendarEvent): string {
  const lines: string[] = [];

  const start = event.start?.dateTime ?? event.start?.date;
  const end = event.end?.dateTime ?? event.end?.date;
  if (start && end) {
    lines.push(`When: ${formatRange(start, end, !!event.start?.date)}`);
  } else if (start) {
    lines.push(`When: ${start}`);
  }

  if (event.location) {
    lines.push(`Where: ${event.location}`);
  }
  if (event.hangoutLink) {
    lines.push(`Meet: ${event.hangoutLink}`);
  }
  if (event.htmlLink) {
    lines.push(`Calendar: ${event.htmlLink}`);
  }
  if (event.description) {
    lines.push("", event.description.trim());
  }

  return lines.join("\n");
}

function formatRange(start: string, end: string, allDay: boolean): string {
  if (allDay) {
    return start === end ? start : `${start} → ${end}`;
  }
  const s = new Date(start);
  const e = new Date(end);
  const opts: Intl.DateTimeFormatOptions = {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  };
  return `${s.toLocaleString(undefined, opts)} → ${e.toLocaleTimeString(
    undefined,
    { hour: "numeric", minute: "2-digit", hour12: true },
  )}`;
}

async function calendarFetch<T>(url: URL, accessToken: string): Promise<T> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Calendar API ${response.status}: ${detail}`);
  }
  return (await response.json()) as T;
}
