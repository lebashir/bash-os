import type { SupabaseClient } from "@supabase/supabase-js";
import { getGoogleAccessToken } from "@/lib/google/token";
import type { TaskStatus } from "@/lib/supabase/types";

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const GMAIL_QUERY = "is:unread in:inbox";
const SYNC_LIMIT = 20;
const INTAKE_STATUS: TaskStatus = "things to think about";

export type SyncGmailAccountResult = {
  accountEmail: string;
  created: number;
  skipped: number;
  error?: string;
};

export type SyncGmailResult = {
  perAccount: SyncGmailAccountResult[];
  totalCreated: number;
  totalSkipped: number;
};

type GmailListResponse = {
  messages?: Array<{ id: string; threadId: string }>;
};

type GmailMessage = {
  id: string;
  snippet?: string;
  payload?: {
    headers?: Array<{ name: string; value: string }>;
  };
};

export async function syncGmailForUser(
  supabase: SupabaseClient,
  userId: string,
): Promise<SyncGmailResult> {
  const { data: tokens, error: tokensError } = await supabase
    .from("connector_tokens")
    .select("account_email")
    .eq("user_id", userId)
    .eq("provider", "google")
    .not("account_email", "is", null)
    .order("account_email", { ascending: true });

  if (tokensError) {
    throw new Error(`Failed to read connector tokens: ${tokensError.message}`);
  }
  if (!tokens || tokens.length === 0) {
    throw new Error(
      "No Google accounts connected. Open the menu next to your email and connect one.",
    );
  }

  const perAccount: SyncGmailAccountResult[] = [];

  // Sequential per-account so each account's position-bumping reads a consistent
  // tail of "things to think about". Within an account, message fetches still
  // run in parallel.
  for (const row of tokens) {
    const accountEmail = row.account_email as string;
    try {
      const accountResult = await syncOneAccount(supabase, userId, accountEmail);
      perAccount.push(accountResult);
    } catch (error) {
      perAccount.push({
        accountEmail,
        created: 0,
        skipped: 0,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  const totalCreated = perAccount.reduce((sum, r) => sum + r.created, 0);
  const totalSkipped = perAccount.reduce((sum, r) => sum + r.skipped, 0);

  return { perAccount, totalCreated, totalSkipped };
}

async function syncOneAccount(
  supabase: SupabaseClient,
  userId: string,
  accountEmail: string,
): Promise<SyncGmailAccountResult> {
  const accessToken = await getGoogleAccessToken(supabase, userId, accountEmail);

  const listUrl = new URL(`${GMAIL_BASE}/messages`);
  listUrl.searchParams.set("q", GMAIL_QUERY);
  listUrl.searchParams.set("maxResults", String(SYNC_LIMIT));

  const list = await gmailFetch<GmailListResponse>(listUrl, accessToken);
  const messageRefs = list.messages ?? [];
  if (messageRefs.length === 0) {
    return { accountEmail, created: 0, skipped: 0 };
  }

  const messages = await Promise.all(
    messageRefs.map((ref) =>
      gmailFetch<GmailMessage>(buildMessageUrl(ref.id), accessToken),
    ),
  );

  const { data: maxPos } = await supabase
    .from("tasks")
    .select("position")
    .eq("user_id", userId)
    .eq("status", INTAKE_STATUS)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const basePosition = (maxPos?.position ?? -1) + 1;

  const rows = messages.map((msg, i) => {
    const subject = headerValue(msg, "Subject") ?? "(no subject)";
    const from = headerValue(msg, "From") ?? "(unknown sender)";
    const snippet = decodeSnippet(msg.snippet);
    return {
      user_id: userId,
      title: subject,
      description: `From: ${from}\n\n${snippet}`,
      status: INTAKE_STATUS,
      source: "gmail" as const,
      source_account: accountEmail,
      source_id: msg.id,
      position: basePosition + i,
    };
  });

  const { data: inserted, error } = await supabase
    .from("tasks")
    .upsert(rows, {
      onConflict: "user_id,source,source_account,source_id",
      ignoreDuplicates: true,
    })
    .select("id");

  if (error) {
    throw new Error(`Gmail sync upsert failed: ${error.message}`);
  }

  const created = inserted?.length ?? 0;
  const skipped = rows.length - created;
  return { accountEmail, created, skipped };
}

function buildMessageUrl(id: string): URL {
  const url = new URL(`${GMAIL_BASE}/messages/${id}`);
  url.searchParams.set("format", "metadata");
  url.searchParams.append("metadataHeaders", "Subject");
  url.searchParams.append("metadataHeaders", "From");
  return url;
}

async function gmailFetch<T>(url: URL, accessToken: string): Promise<T> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Gmail API ${response.status}: ${detail}`);
  }
  return (await response.json()) as T;
}

function headerValue(msg: GmailMessage, name: string): string | null {
  const header = msg.payload?.headers?.find(
    (h) => h.name.toLowerCase() === name.toLowerCase(),
  );
  return header?.value ?? null;
}

// Gmail returns HTML-entity-encoded snippets (e.g. &#39; for apostrophes).
// Decoding the common ones keeps task descriptions readable without pulling
// in an HTML-parsing dependency.
function decodeSnippet(snippet: string | undefined): string {
  if (!snippet) return "";
  return snippet
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}
