import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import {
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_TTL_SECONDS,
  buildConnectorCallbackUrl,
  buildGoogleAuthUrl,
  generateOAuthState,
  readGoogleOAuthCredentials,
} from "@/lib/google/oauth";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const { clientId } = readGoogleOAuthCredentials();
  const origin = new URL(request.url).origin;
  const state = generateOAuthState();

  const cookieStore = await cookies();
  cookieStore.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: origin.startsWith("https://"),
    sameSite: "lax",
    path: "/connectors/google",
    maxAge: OAUTH_STATE_TTL_SECONDS,
  });

  const authUrl = buildGoogleAuthUrl({
    clientId,
    redirectUri: buildConnectorCallbackUrl(origin),
    state,
  });

  return NextResponse.redirect(authUrl);
}
