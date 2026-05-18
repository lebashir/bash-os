import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncGmailForUser } from "@/lib/board/gmail-sync";
import { generateAndStoreBrief } from "@/lib/board/brief";

export const dynamic = "force-dynamic";

type UserBriefSummary = {
  userId: string;
  syncedCreated: number;
  syncedSkipped: number;
  syncErrors: string[];
  briefTaskId?: string;
  briefError?: string;
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
      syncedCreated: 0,
      syncedSkipped: 0,
      syncErrors: [],
    };

    try {
      const syncResult = await syncGmailForUser(admin, userId);
      summary.syncedCreated = syncResult.totalCreated;
      summary.syncedSkipped = syncResult.totalSkipped;
      summary.syncErrors = syncResult.perAccount
        .filter((r) => r.error)
        .map((r) => `${r.accountEmail}: ${r.error}`);
    } catch (error) {
      summary.syncErrors.push(
        error instanceof Error ? error.message : "Unknown sync error",
      );
    }

    try {
      const { taskId } = await generateAndStoreBrief(admin, userId);
      summary.briefTaskId = taskId;
    } catch (error) {
      summary.briefError =
        error instanceof Error ? error.message : "Unknown brief error";
    }

    summaries.push(summary);
  }

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
