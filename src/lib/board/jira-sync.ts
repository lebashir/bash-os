import type { SupabaseClient } from "@supabase/supabase-js";
import type { TaskPriority, TaskStatus } from "@/lib/supabase/types";

// Same shape rationale as slack-sync: single-site personal-tool, paste a
// Jira API token + email in env. Multi-site → upgrade to connector_tokens.
const ASSIGNEE_JQL = "assignee = currentUser() AND statusCategory != Done";
const FIELDS = ["summary", "status", "priority", "duedate", "issuetype"];
const SEARCH_LIMIT = 50;
const ASSIGNED_STATUS: TaskStatus = "Bash work";

export type SyncJiraAccountResult = {
  accountEmail: string;
  created: number;
  skipped: number;
  error?: string;
};

export type SyncJiraResult = {
  perAccount: SyncJiraAccountResult[];
  totalCreated: number;
  totalSkipped: number;
};

export type SyncJiraOutcome = SyncJiraResult | { skipped: "not configured" };

type JiraIssue = {
  id: string;
  key: string;
  fields: {
    summary?: string;
    status?: { name?: string };
    priority?: { name?: string };
    duedate?: string | null;
    issuetype?: { name?: string };
  };
};

type SearchResponse = {
  issues?: JiraIssue[];
};

export async function syncJiraForUser(
  supabase: SupabaseClient,
  userId: string,
): Promise<SyncJiraOutcome> {
  const baseUrl = process.env.JIRA_BASE_URL;
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  if (!baseUrl || !email || !token) {
    return { skipped: "not configured" };
  }

  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const accountEmail = new URL(normalizedBase).host;

  try {
    const auth = `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`;
    const result = await syncOneSite(
      supabase,
      userId,
      normalizedBase,
      accountEmail,
      auth,
    );
    return {
      perAccount: [result],
      totalCreated: result.created,
      totalSkipped: result.skipped,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      perAccount: [
        { accountEmail, created: 0, skipped: 0, error: message },
      ],
      totalCreated: 0,
      totalSkipped: 0,
    };
  }
}

async function syncOneSite(
  supabase: SupabaseClient,
  userId: string,
  baseUrl: string,
  accountEmail: string,
  auth: string,
): Promise<SyncJiraAccountResult> {
  // Use the new /search/jql endpoint (POST) which Atlassian's deprecation
  // notice points to from the older GET /search.
  const response = await fetch(`${baseUrl}/rest/api/3/search/jql`, {
    method: "POST",
    headers: {
      Authorization: auth,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jql: ASSIGNEE_JQL,
      fields: FIELDS,
      maxResults: SEARCH_LIMIT,
    }),
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Jira search ${response.status}: ${detail}`);
  }
  const body = (await response.json()) as SearchResponse;
  const issues = body.issues ?? [];
  if (issues.length === 0) {
    return { accountEmail, created: 0, skipped: 0 };
  }

  const { data: maxPos } = await supabase
    .from("tasks")
    .select("position")
    .eq("user_id", userId)
    .eq("status", ASSIGNED_STATUS)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const basePosition = (maxPos?.position ?? -1) + 1;

  const rows = issues.map((issue, i) => {
    const summary = issue.fields.summary?.trim() || `(no summary) ${issue.key}`;
    const statusName = issue.fields.status?.name ?? "unknown status";
    const priorityName = issue.fields.priority?.name;
    const typeName = issue.fields.issuetype?.name ?? "Issue";

    const description = [
      `${typeName} ${issue.key} — ${statusName}`,
      priorityName ? `Priority: ${priorityName}` : null,
      `Link: ${baseUrl}/browse/${issue.key}`,
    ]
      .filter(Boolean)
      .join("\n");

    return {
      user_id: userId,
      title: `[${issue.key}] ${summary}`,
      description,
      status: ASSIGNED_STATUS,
      source: "jira" as const,
      source_account: accountEmail,
      source_id: issue.key,
      priority: mapPriority(priorityName),
      due_date: issue.fields.duedate ?? null,
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
    throw new Error(`Jira sync upsert failed: ${error.message}`);
  }

  const created = inserted?.length ?? 0;
  const skipped = rows.length - created;
  return { accountEmail, created, skipped };
}

function mapPriority(name: string | undefined): TaskPriority | null {
  if (!name) return null;
  switch (name.toLowerCase()) {
    case "highest":
      return "urgent";
    case "high":
      return "high";
    case "medium":
      return "normal";
    case "low":
    case "lowest":
      return "low";
    default:
      return null;
  }
}
