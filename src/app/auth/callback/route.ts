import { NextResponse, type NextRequest } from "next/server";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

// Google access tokens are valid for 1 hour; Supabase doesn't expose the exact
// expiry from the upstream OAuth response, so we estimate.
const GOOGLE_ACCESS_TOKEN_TTL_SECONDS = 3600;

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/";

  if (!code) {
    return NextResponse.redirect(new URL("/login?error=missing_code", url));
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(error.message)}`, url),
    );
  }

  if (data.session) {
    await persistGoogleProviderTokens(supabase, data.session);
  }

  return NextResponse.redirect(new URL(next, url));
}

async function persistGoogleProviderTokens(
  supabase: SupabaseClient,
  session: Session,
) {
  if (!session.provider_token) return;

  const expiresAt = new Date(
    Date.now() + GOOGLE_ACCESS_TOKEN_TTL_SECONDS * 1000,
  ).toISOString();

  const accountEmail = session.user.email ?? null;

  // Google only returns refresh_token on the very first consent with
  // access_type=offline. On re-auth we may get only an access_token — keep the
  // previously-stored refresh_token in that case.
  let refreshToken: string | null = session.provider_refresh_token ?? null;
  if (!refreshToken && accountEmail) {
    const { data } = await supabase
      .from("connector_tokens")
      .select("refresh_token")
      .eq("user_id", session.user.id)
      .eq("provider", "google")
      .eq("account_email", accountEmail)
      .maybeSingle();
    refreshToken = data?.refresh_token ?? null;
  }

  await supabase.from("connector_tokens").upsert(
    {
      user_id: session.user.id,
      provider: "google",
      account_email: accountEmail,
      access_token: session.provider_token,
      refresh_token: refreshToken,
      expires_at: expiresAt,
    },
    { onConflict: "user_id,provider,account_email" },
  );
}
