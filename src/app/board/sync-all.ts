"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  syncGmailForUser,
  type SyncGmailResult,
} from "@/lib/board/gmail-sync";
import {
  syncCalendarForUser,
  type SyncCalendarResult,
} from "@/lib/board/calendar-sync";
import {
  syncSlackForUser,
  type SyncSlackOutcome,
} from "@/lib/board/slack-sync";
import {
  syncJiraForUser,
  type SyncJiraOutcome,
} from "@/lib/board/jira-sync";

export type SyncAllResult = {
  gmail: SyncGmailResult | { error: string };
  calendar: SyncCalendarResult | { error: string };
  slack: SyncSlackOutcome | { error: string };
  jira: SyncJiraOutcome | { error: string };
};

export async function syncAll(): Promise<SyncAllResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("Not authenticated");
  }

  const [gmail, calendar, slack, jira] = await Promise.all([
    syncGmailForUser(supabase, user.id).catch((e: unknown) => ({
      error: e instanceof Error ? e.message : "Gmail sync failed",
    })),
    syncCalendarForUser(supabase, user.id).catch((e: unknown) => ({
      error: e instanceof Error ? e.message : "Calendar sync failed",
    })),
    syncSlackForUser(supabase, user.id).catch((e: unknown) => ({
      error: e instanceof Error ? e.message : "Slack sync failed",
    })),
    syncJiraForUser(supabase, user.id).catch((e: unknown) => ({
      error: e instanceof Error ? e.message : "Jira sync failed",
    })),
  ]);

  const createdSomething =
    ("totalCreated" in gmail && gmail.totalCreated > 0) ||
    ("totalCreated" in calendar && calendar.totalCreated > 0) ||
    ("totalCreated" in slack && slack.totalCreated > 0) ||
    ("totalCreated" in jira && jira.totalCreated > 0);
  if (createdSomething) {
    revalidatePath("/");
  }

  return { gmail, calendar, slack, jira };
}
