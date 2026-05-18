import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import {
  OAUTH_STATE_COOKIE,
  buildConnectorCallbackUrl,
  exchangeAuthCode,
  fetchGoogleUserInfo,
  readGoogleOAuthCredentials,
} from "@/lib/google/oauth";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError) {
    return redirectToBoard(request, { error: oauthError });
  }
  if (!code || !state) {
    return redirectToBoard(request, { error: "missing_params" });
  }

  const cookieStore = await cookies();
  const expectedState = cookieStore.get(OAUTH_STATE_COOKIE)?.value;
  cookieStore.delete(OAUTH_STATE_COOKIE);
  if (!expectedState || expectedState !== state) {
    return redirectToBoard(request, { error: "state_mismatch" });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", url));
  }

  const { clientId, clientSecret } = readGoogleOAuthCredentials();
  const redirectUri = buildConnectorCallbackUrl(url.origin);

  const token = await exchangeAuthCode({
    code,
    redirectUri,
    clientId,
    clientSecret,
  });

  const profile = await fetchGoogleUserInfo(token.access_token);
  const expiresAt = new Date(Date.now() + token.expires_in * 1000).toISOString();
  const scopes = token.scope?.split(" ") ?? [];

  // If the user previously connected this Google account, Google won't always
  // re-issue a refresh_token even with prompt=consent — preserve the existing
  // one in that case.
  let refreshToken: string | null = token.refresh_token ?? null;
  if (!refreshToken) {
    const { data: existing } = await supabase
      .from("connector_tokens")
      .select("refresh_token")
      .eq("user_id", user.id)
      .eq("provider", "google")
      .eq("account_email", profile.email)
      .maybeSingle();
    refreshToken = existing?.refresh_token ?? null;
  }

  const { error: upsertError } = await supabase.from("connector_tokens").upsert(
    {
      user_id: user.id,
      provider: "google",
      account_email: profile.email,
      access_token: token.access_token,
      refresh_token: refreshToken,
      expires_at: expiresAt,
      scopes,
    },
    { onConflict: "user_id,provider,account_email" },
  );

  if (upsertError) {
    return redirectToBoard(request, { error: upsertError.message });
  }

  return redirectToBoard(request, { connected: profile.email });
}

function redirectToBoard(
  request: NextRequest,
  params: Record<string, string>,
): NextResponse {
  const target = new URL("/board", request.url);
  for (const [key, value] of Object.entries(params)) {
    target.searchParams.set(key, value);
  }
  return NextResponse.redirect(target);
}
