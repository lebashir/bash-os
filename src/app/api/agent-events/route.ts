import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// POST /api/agent-events ingests events from external sources (a Claude
// Code hook, a Cowork session, a cron worker) into public.agent_events so
// the right-panel feed can surface them.
//
// Auth: Authorization: Bearer <AGENT_EVENTS_TOKEN>. The token is a
// project-shared secret, not a per-user JWT — RLS is bypassed via the
// admin client because the caller may be a worker that doesn't have a
// Supabase session. The user_id in the payload determines whose feed the
// event lands in.

const eventSchema = z.object({
  user_id: z.string().uuid(),
  source: z.string().trim().min(1).max(80),
  project: z.string().trim().min(1).max(80).optional().nullable(),
  action: z.string().trim().min(1).max(160),
  target: z.string().trim().min(1).max(400).optional().nullable(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: NextRequest) {
  const auth = verifyBearer(request);
  if (auth) return auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const parsed = eventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("agent_events")
    .insert({
      user_id: parsed.data.user_id,
      source: parsed.data.source,
      project: parsed.data.project ?? null,
      action: parsed.data.action,
      target: parsed.data.target ?? null,
      payload: parsed.data.payload ?? {},
    })
    .select("id, created_at")
    .single();

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    id: data.id,
    created_at: data.created_at,
  });
}

function verifyBearer(request: NextRequest): NextResponse | null {
  const expected = process.env.AGENT_EVENTS_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: "AGENT_EVENTS_TOKEN not configured" },
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
