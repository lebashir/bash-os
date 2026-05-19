import type { SupabaseClient } from "@supabase/supabase-js";
import { getGoogleAccessToken } from "@/lib/google/token";
import { resolveColumnId } from "./columns";
import {
  IMPORTANCE_THRESHOLD,
  scoreEmailImportance,
  type EmailScore,
} from "./email-importance";

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const GMAIL_QUERY = "is:unread in:inbox";
const SYNC_LIMIT = 20;

export type SyncGmailAccountResult = {
  accountEmail: string;
  created: number;
  skipped: number;
  filtered: number;
  error?: string;
};

export type SyncGmailResult = {
  perAccount: SyncGmailAccountResult[];
  totalCreated: number;
  totalSkipped: number;
  totalFiltered: number;
};

export type SyncGmailOptions = {
  // When true, low-importance messages are admitted with their score and a
  // visible [filtered:N] title prefix instead of being silently dropped. Used
  // by the /board?show_filtered=1 query param for spot-checking the rubric.
  showFiltered?: boolean;
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
  options: SyncGmailOptions = {},
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
      const accountResult = await syncOneAccount(
        supabase,
        userId,
        accountEmail,
        options,
      );
      perAccount.push(accountResult);
    } catch (error) {
      perAccount.push({
        accountEmail,
        created: 0,
        skipped: 0,
        filtered: 0,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  const totalCreated = perAccount.reduce((sum, r) => sum + r.created, 0);
  const totalSkipped = perAccount.reduce((sum, r) => sum + r.skipped, 0);
  const totalFiltered = perAccount.reduce((sum, r) => sum + r.filtered, 0);

  return { perAccount, totalCreated, totalSkipped, totalFiltered };
}

async function syncOneAccount(
  supabase: SupabaseClient,
  userId: string,
  accountEmail: string,
  options: SyncGmailOptions,
): Promise<SyncGmailAccountResult> {
  const inboxColumnId = await resolveColumnId(supabase, userId, "Inbox");
  if (!inboxColumnId) {
    throw new Error("No Inbox column found for user — schema not seeded?");
  }
  const accessToken = await getGoogleAccessToken(supabase, userId, accountEmail);

  const listUrl = new URL(`${GMAIL_BASE}/messages`);
  listUrl.searchParams.set("q", GMAIL_QUERY);
  listUrl.searchParams.set("maxResults", String(SYNC_LIMIT));

  const list = await gmailFetch<GmailListResponse>(listUrl, accessToken);
  const messageRefs = list.messages ?? [];
  if (messageRefs.length === 0) {
    return { accountEmail, created: 0, skipped: 0, filtered: 0 };
  }

  const messages = await Promise.all(
    messageRefs.map((ref) =>
      gmailFetch<GmailMessage>(buildMessageUrl(ref.id), accessToken),
    ),
  );

  // Score each message in parallel. Promise.allSettled so one slow or
  // erroring scoring call doesn't block the whole sync — failures default to
  // score 5 inside scoreEmailImportance.
  const scoreResults = await Promise.allSettled(
    messages.map((msg) =>
      scoreEmailImportance(
        {
          subject: headerValue(msg, "Subject") ?? "",
          from: headerValue(msg, "From") ?? "",
          snippet: decodeSnippet(msg.snippet),
        },
        { messageId: msg.id },
      ),
    ),
  );

  const scores: EmailScore[] = scoreResults.map((r) =>
    r.status === "fulfilled"
      ? r.value
      : { score: 5, reason: "scoring-rejected" },
  );

  const { data: maxPos } = await supabase
    .from("tasks")
    .select("position")
    .eq("user_id", userId)
    .eq("column_id", inboxColumnId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const basePosition = (maxPos?.position ?? -1) + 1;

  // R3.5 routes scored messages three ways:
  //   score >= AUTOTASK_THRESHOLD  -> insert as task in Inbox (existing path)
  //   IMPORTANCE_THRESHOLD <= score < AUTOTASK_THRESHOLD
  //                                -> insert into pending_emails (triage queue)
  //   score < IMPORTANCE_THRESHOLD -> drop silently (or admit if showFiltered)
  const AUTOTASK_THRESHOLD = 8;

  const showFiltered = options.showFiltered === true;
  const taskRows: Array<{
    user_id: string;
    title: string;
    description: string;
    column_id: string;
    owner: "bash";
    source: "gmail";
    source_account: string;
    source_id: string;
    position: number;
    importance: number;
  }> = [];
  const pendingRows: Array<{
    user_id: string;
    gmail_message_id: string;
    subject: string;
    sender: string;
    snippet: string | null;
    score: number;
  }> = [];

  let filtered = 0;
  let nextPosition = basePosition;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const score = scores[i];
    const rawSubject = headerValue(msg, "Subject") ?? "(no subject)";
    const from = headerValue(msg, "From") ?? "(unknown sender)";
    const snippet = decodeSnippet(msg.snippet);

    if (score.score >= AUTOTASK_THRESHOLD) {
      taskRows.push({
        user_id: userId,
        title: rawSubject,
        description: `From: ${from}\n\n${snippet}`,
        column_id: inboxColumnId,
        owner: "bash",
        source: "gmail",
        source_account: accountEmail,
        source_id: msg.id,
        position: nextPosition,
        importance: score.score,
      });
      nextPosition += 1;
      continue;
    }

    if (score.score >= IMPORTANCE_THRESHOLD) {
      pendingRows.push({
        user_id: userId,
        gmail_message_id: msg.id,
        subject: rawSubject,
        sender: from,
        snippet: snippet.slice(0, 800),
        score: score.score,
      });
      continue;
    }

    // score < IMPORTANCE_THRESHOLD
    if (showFiltered) {
      taskRows.push({
        user_id: userId,
        title: `[filtered:${score.score}] ${rawSubject}`,
        description: `From: ${from}\n\n${snippet}`,
        column_id: inboxColumnId,
        owner: "bash",
        source: "gmail",
        source_account: accountEmail,
        source_id: msg.id,
        position: nextPosition,
        importance: score.score,
      });
      nextPosition += 1;
    } else {
      filtered += 1;
    }
  }

  let created = 0;
  let skipped = 0;
  if (taskRows.length > 0) {
    const { data: inserted, error } = await supabase
      .from("tasks")
      .upsert(taskRows, {
        onConflict: "user_id,source,source_account,source_id",
        ignoreDuplicates: true,
      })
      .select("id");
    if (error) {
      throw new Error(`Gmail sync upsert failed: ${error.message}`);
    }
    created = inserted?.length ?? 0;
    skipped = taskRows.length - created;
  }

  if (pendingRows.length > 0) {
    const { error } = await supabase
      .from("pending_emails")
      .upsert(pendingRows, {
        onConflict: "user_id,gmail_message_id",
        ignoreDuplicates: true,
      });
    if (error) {
      console.warn(`[gmail-sync] pending_emails upsert failed: ${error.message}`);
    }
  }

  return { accountEmail, created, skipped, filtered };
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
