"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getGoogleAccessToken } from "@/lib/google/token";
import type { TaskStatus } from "@/lib/supabase/types";

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const GMAIL_QUERY = "is:unread in:inbox";
const SYNC_LIMIT = 20;
const INTAKE_STATUS: TaskStatus = "things to think about";

export type SyncGmailResult = {
  created: number;
  skipped: number;
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

export async function syncGmail(): Promise<SyncGmailResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("Not authenticated");
  }

  const accessToken = await getGoogleAccessToken(supabase, user.id);

  const listUrl = new URL(`${GMAIL_BASE}/messages`);
  listUrl.searchParams.set("q", GMAIL_QUERY);
  listUrl.searchParams.set("maxResults", String(SYNC_LIMIT));

  const list = await gmailFetch<GmailListResponse>(listUrl, accessToken);
  const messageRefs = list.messages ?? [];
  if (messageRefs.length === 0) {
    return { created: 0, skipped: 0 };
  }

  const messages = await Promise.all(
    messageRefs.map((ref) =>
      gmailFetch<GmailMessage>(buildMessageUrl(ref.id), accessToken),
    ),
  );

  const { data: maxPos } = await supabase
    .from("tasks")
    .select("position")
    .eq("user_id", user.id)
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
      user_id: user.id,
      title: subject,
      description: `From: ${from}\n\n${snippet}`,
      status: INTAKE_STATUS,
      source: "gmail" as const,
      source_id: msg.id,
      position: basePosition + i,
    };
  });

  const { data: inserted, error } = await supabase
    .from("tasks")
    .upsert(rows, {
      onConflict: "user_id,source,source_id",
      ignoreDuplicates: true,
    })
    .select("id");

  if (error) {
    throw new Error(`Gmail sync upsert failed: ${error.message}`);
  }

  const created = inserted?.length ?? 0;
  const skipped = rows.length - created;

  if (created > 0) {
    revalidatePath("/board");
  }

  return { created, skipped };
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
