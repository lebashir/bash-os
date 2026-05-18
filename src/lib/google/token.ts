import type { SupabaseClient } from "@supabase/supabase-js";
import { GOOGLE_TOKEN_URL, readGoogleOAuthCredentials } from "./oauth";

// Refresh proactively while the stored token still has a little time left,
// to avoid a race where it expires mid-request.
const REFRESH_LEEWAY_SECONDS = 60;

type StoredToken = {
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
};

type GoogleRefreshResponse = {
  access_token: string;
  expires_in: number;
  scope?: string;
  token_type?: string;
};

export async function getGoogleAccessToken(
  supabase: SupabaseClient,
  userId: string,
  accountEmail: string,
): Promise<string> {
  const { data, error } = await supabase
    .from("connector_tokens")
    .select("access_token, refresh_token, expires_at")
    .eq("user_id", userId)
    .eq("provider", "google")
    .eq("account_email", accountEmail)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to read connector token: ${error.message}`);
  }
  if (!data) {
    throw new Error(
      `No Google connector token on file for ${accountEmail}. Connect the account again.`,
    );
  }

  const stored = data as StoredToken;

  if (!isExpired(stored.expires_at)) {
    return stored.access_token;
  }

  if (!stored.refresh_token) {
    throw new Error(
      `Google token expired for ${accountEmail} and no refresh token is stored. Reconnect the account.`,
    );
  }

  const refreshed = await refreshGoogleToken(stored.refresh_token);
  const expiresAt = new Date(
    Date.now() + refreshed.expires_in * 1000,
  ).toISOString();

  const { error: updateError } = await supabase
    .from("connector_tokens")
    .update({
      access_token: refreshed.access_token,
      expires_at: expiresAt,
    })
    .eq("user_id", userId)
    .eq("provider", "google")
    .eq("account_email", accountEmail);

  if (updateError) {
    throw new Error(`Failed to persist refreshed token: ${updateError.message}`);
  }

  return refreshed.access_token;
}

function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return true;
  const expiryMs = new Date(expiresAt).getTime();
  return expiryMs - REFRESH_LEEWAY_SECONDS * 1000 <= Date.now();
}

async function refreshGoogleToken(
  refreshToken: string,
): Promise<GoogleRefreshResponse> {
  const { clientId, clientSecret } = readGoogleOAuthCredentials();

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Google token refresh failed (${response.status}): ${detail}`,
    );
  }

  return (await response.json()) as GoogleRefreshResponse;
}
