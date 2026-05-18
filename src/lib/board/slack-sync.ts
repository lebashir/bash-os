import type { SupabaseClient } from "@supabase/supabase-js";
import type { TaskStatus } from "@/lib/supabase/types";

// Unlike Gmail/Calendar (multi-account OAuth in connector_tokens), Slack is a
// single-workspace personal token stored in env: paste once, no callback flow.
// If we ever want multi-workspace, lift this to the connector_tokens pattern.
const SLACK_BASE = "https://slack.com/api";
const LOOKBACK_HOURS = 48;
const HISTORY_LIMIT_PER_DM = 20;
const DM_FETCH_LIMIT = 50;
const INTAKE_STATUS: TaskStatus = "things to think about";

export type SyncSlackAccountResult = {
  accountEmail: string;
  created: number;
  skipped: number;
  error?: string;
};

export type SyncSlackResult = {
  perAccount: SyncSlackAccountResult[];
  totalCreated: number;
  totalSkipped: number;
};

export type SyncSlackOutcome = SyncSlackResult | { skipped: "not configured" };

type SlackResponse<T> = T & { ok: boolean; error?: string };

type AuthTestResponse = {
  url?: string;
  team?: string;
  team_id?: string;
  user?: string;
  user_id?: string;
};

type Conversation = {
  id: string;
  user?: string;
  is_im?: boolean;
  is_user_deleted?: boolean;
};

type ConversationsListResponse = {
  channels?: Conversation[];
};

type SlackMessage = {
  type?: string;
  subtype?: string;
  user?: string;
  text?: string;
  ts: string;
  bot_id?: string;
};

type HistoryResponse = {
  messages?: SlackMessage[];
};

type UserInfoResponse = {
  user?: {
    id: string;
    real_name?: string;
    profile?: { real_name?: string; display_name?: string };
  };
};

export async function syncSlackForUser(
  supabase: SupabaseClient,
  userId: string,
): Promise<SyncSlackOutcome> {
  const token = process.env.SLACK_USER_TOKEN;
  if (!token) {
    return { skipped: "not configured" };
  }

  try {
    const auth = await slackFetch<AuthTestResponse>("auth.test", token);
    const accountEmail = auth.team ?? auth.url ?? "slack";
    const selfId = auth.user_id;
    if (!selfId) {
      throw new Error("Slack auth.test returned no user_id");
    }

    const accountResult = await syncOneWorkspace(
      supabase,
      userId,
      token,
      accountEmail,
      selfId,
    );
    return {
      perAccount: [accountResult],
      totalCreated: accountResult.created,
      totalSkipped: accountResult.skipped,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      perAccount: [
        { accountEmail: "slack", created: 0, skipped: 0, error: message },
      ],
      totalCreated: 0,
      totalSkipped: 0,
    };
  }
}

async function syncOneWorkspace(
  supabase: SupabaseClient,
  userId: string,
  token: string,
  accountEmail: string,
  selfId: string,
): Promise<SyncSlackAccountResult> {
  const dms = await slackFetch<ConversationsListResponse>(
    `conversations.list?types=im&limit=${DM_FETCH_LIMIT}&exclude_archived=true`,
    token,
  );
  const channels = (dms.channels ?? []).filter(
    (c) => c.is_im && c.user && c.user !== selfId && !c.is_user_deleted,
  );
  if (channels.length === 0) {
    return { accountEmail, created: 0, skipped: 0 };
  }

  const oldest = (Date.now() / 1000 - LOOKBACK_HOURS * 3600).toFixed(0);

  type Pending = {
    channelId: string;
    senderId: string;
    message: SlackMessage;
  };

  const pending: Pending[] = [];
  const senderIds = new Set<string>();

  await Promise.all(
    channels.map(async (channel) => {
      try {
        const history = await slackFetch<HistoryResponse>(
          `conversations.history?channel=${channel.id}&oldest=${oldest}&limit=${HISTORY_LIMIT_PER_DM}`,
          token,
        );
        for (const msg of history.messages ?? []) {
          if (msg.type !== "message") continue;
          if (msg.subtype) continue; // skip joins/leaves/etc.
          if (msg.bot_id) continue;
          if (!msg.user || msg.user === selfId) continue; // only messages from the other person
          if (!msg.text || msg.text.trim().length === 0) continue;
          pending.push({ channelId: channel.id, senderId: msg.user, message: msg });
          senderIds.add(msg.user);
        }
      } catch {
        // One bad channel shouldn't fail the whole sync.
      }
    }),
  );

  if (pending.length === 0) {
    return { accountEmail, created: 0, skipped: 0 };
  }

  const senderNames = await resolveUserNames(token, [...senderIds]);

  const { data: maxPos } = await supabase
    .from("tasks")
    .select("position")
    .eq("user_id", userId)
    .eq("status", INTAKE_STATUS)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const basePosition = (maxPos?.position ?? -1) + 1;

  // Sort oldest-first so basePosition + i lines up chronologically.
  pending.sort((a, b) => Number(a.message.ts) - Number(b.message.ts));

  const rows = pending.map((p, i) => {
    const senderName = senderNames.get(p.senderId) ?? p.senderId;
    const text = p.message.text ?? "";
    const titleSource = text.replace(/\s+/g, " ").trim();
    const title =
      titleSource.length > 80
        ? `${titleSource.slice(0, 80)}…`
        : titleSource || `(message from ${senderName})`;
    return {
      user_id: userId,
      title: `Slack DM: ${title}`,
      description: `From: ${senderName} in DM\n\n${text}`,
      status: INTAKE_STATUS,
      source: "slack" as const,
      source_account: accountEmail,
      source_id: `${p.channelId}:${p.message.ts}`,
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
    throw new Error(`Slack sync upsert failed: ${error.message}`);
  }

  const created = inserted?.length ?? 0;
  const skipped = rows.length - created;
  return { accountEmail, created, skipped };
}

async function resolveUserNames(
  token: string,
  userIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  await Promise.all(
    userIds.map(async (uid) => {
      try {
        const info = await slackFetch<UserInfoResponse>(
          `users.info?user=${uid}`,
          token,
        );
        const name =
          info.user?.profile?.display_name ||
          info.user?.profile?.real_name ||
          info.user?.real_name ||
          uid;
        out.set(uid, name);
      } catch {
        out.set(uid, uid);
      }
    }),
  );
  return out;
}

async function slackFetch<T>(
  path: string,
  token: string,
): Promise<T> {
  const response = await fetch(`${SLACK_BASE}/${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Slack ${path} HTTP ${response.status}`);
  }
  const body = (await response.json()) as SlackResponse<T>;
  if (!body.ok) {
    throw new Error(`Slack ${path}: ${body.error ?? "unknown error"}`);
  }
  return body as T;
}
