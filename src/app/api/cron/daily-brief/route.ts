import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncGmailForUser } from "@/lib/board/gmail-sync";
import { syncCalendarForUser } from "@/lib/board/calendar-sync";

export const dynamic = "force-dynamic";

// R3.5 made the brief panel deterministic. The morning cron used to call
// generateAndStoreBrief() to write an LLM-generated paragraph into the
// briefs table; that's gone now. The brief panel reads current state
// every page render. public.briefs stays in place for a future hybrid
// mode (optional headline) but the cron no longer writes to it.

type UserBriefSummary = {
  userId: string;
  gmailCreated: number;
  gmailSkipped: number;
  calendarCreated: number;
  calendarSkipped: number;
  syncErrors: string[];
};

export async function GET(request: NextRequest) {
  const authError = verifyCronSecret(request);
  if (authError) return authError;

  const admin = createAdminClient();

  const { data: tokenRows, error: tokenErr } = await admin
    .from("connector_tokens")
    .select("user_id")
    .eq("provider", "google")
    .not("account_email", "is", null);

  if (tokenErr) {
    return NextResponse.json(
      { ok: false, error: `Failed to list users: ${tokenErr.message}` },
      { status: 500 },
    );
  }

  const userIds = Array.from(
    new Set((tokenRows ?? []).map((row) => row.user_id as string)),
  );

  const summaries: UserBriefSummary[] = [];

  for (const userId of userIds) {
    const summary: UserBriefSummary = {
      userId,
      gmailCreated: 0,
      gmailSkipped: 0,
      calendarCreated: 0,
      calendarSkipped: 0,
      syncErrors: [],
    };

    const [gmailOutcome, calendarOutcome] = await Promise.allSettled([
      syncGmailForUser(admin, userId),
      syncCalendarForUser(admin, userId),
    ]);

    if (gmailOutcome.status === "fulfilled") {
      summary.gmailCreated = gmailOutcome.value.totalCreated;
      summary.gmailSkipped = gmailOutcome.value.totalSkipped;
      for (const r of gmailOutcome.value.perAccount) {
        if (r.error) summary.syncErrors.push(`Gmail/${r.accountEmail}: ${r.error}`);
      }
    } else {
      summary.syncErrors.push(
        `Gmail: ${gmailOutcome.reason instanceof Error ? gmailOutcome.reason.message : String(gmailOutcome.reason)}`,
      );
    }

    if (calendarOutcome.status === "fulfilled") {
      summary.calendarCreated = calendarOutcome.value.totalCreated;
      summary.calendarSkipped = calendarOutcome.value.totalSkipped;
      for (const r of calendarOutcome.value.perAccount) {
        if (r.error)
          summary.syncErrors.push(`Calendar/${r.accountEmail}: ${r.error}`);
      }
    } else {
      summary.syncErrors.push(
        `Calendar: ${calendarOutcome.reason instanceof Error ? calendarOutcome.reason.message : String(calendarOutcome.reason)}`,
      );
    }

    summaries.push(summary);
  }

  // Invalidate the cached homepage so the brief / timeline / board panels
  // reflect the freshly-synced items on the next page render.
  revalidatePath("/");

  return NextResponse.json({
    ok: true,
    userCount: userIds.length,
    summaries,
  });
}

function verifyCronSecret(request: NextRequest): NextResponse | null {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET not configured." },
      { status: 500 },
    );
  }
  const header = request.headers.get("authorization");
  if (header !== `Bearer ${expected}`) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }
  return null;
}
