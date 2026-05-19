import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// Nightly cron that clears expired snoozed_until on tasks and
// pending_emails. Scheduled at 00:05 Dubai (20:05 UTC) via vercel.json.
// Snoozed items effectively reappear at the start of the user's local day.

export async function GET(request: NextRequest) {
  const auth = verifyCronSecret(request);
  if (auth) return auth;

  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  const [tasksRes, emailsRes] = await Promise.all([
    admin
      .from("tasks")
      .update({ snoozed_until: null })
      .lte("snoozed_until", nowIso)
      .select("id"),
    admin
      .from("pending_emails")
      .update({ snoozed_until: null })
      .lte("snoozed_until", nowIso)
      .select("id"),
  ]);

  if (tasksRes.error) {
    return NextResponse.json(
      { ok: false, error: `tasks unsnooze failed: ${tasksRes.error.message}` },
      { status: 500 },
    );
  }
  if (emailsRes.error) {
    return NextResponse.json(
      { ok: false, error: `pending_emails unsnooze failed: ${emailsRes.error.message}` },
      { status: 500 },
    );
  }

  revalidatePath("/");
  return NextResponse.json({
    ok: true,
    tasksUnsnoozed: tasksRes.data?.length ?? 0,
    pendingEmailsUnsnoozed: emailsRes.data?.length ?? 0,
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
