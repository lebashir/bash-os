# Bash OS

## What Bash OS is

A personal life-OS for one person (Bashir). A three-panel homepage at `/` is the surface: a deterministic brief + a vertical-axis timeline on the left, a user-managed kanban board in the middle, an agent-activity feed on the right, and a persistent command bar across the bottom. Behind it sits a Supabase store, a set of connectors that ingest signals from Gmail, Google Calendar, and Jira, a chat assistant that can read the board and take action through tool-calls, a long-term memory layer that the assistant retrieves from per turn, and a `/api/agent-events` ingestion endpoint that lets external workers (a Claude Code hook, a Cowork session, anything) surface their activity on the right-panel feed.

## Stack

- **Next.js 16** — App Router, TypeScript, Turbopack. Note: Next 16 renamed `middleware.ts` → `proxy.ts`.
- **Tailwind 4** — utility-first styling.
- **shadcn/ui** — components on Radix primitives; toasts via `sonner`.
- **@dnd-kit** — drag-and-drop on the board (`core` + `sortable` + `utilities`).
- **AI SDK v6** (`ai` + `@ai-sdk/google` + `@ai-sdk/react`) — chat agent, streaming, embeddings, daily brief generation.
- **Gemini** — `gemini-3-flash-preview` for chat + daily brief; `gemini-embedding-001` (1536 dims) for memories.
- **Supabase** — Postgres + pgvector + Auth + RLS. Cloud project ref `vbooingflkmzxcqnbvxr`.
- **Vercel** — hosting at `bash-os.vercel.app`; Vercel Cron for the daily brief.
- **pnpm** — package manager.

## Architecture overview

Tasks live in `public.tasks` and belong to user-managed columns in `public.columns` (R3.5 — the R1 7-status CHECK was retired in `20260519060000`). RLS gates everything on `auth.uid() = user_id`. The homepage at `/` (the only board surface — `/board` is a redirect) is a three-panel + command bar shell:

- **Left panel** — deterministic brief (attention bars for calendar / overdue / urgent emails / needs-review / triage queue / unsnoozed; plus a "next event" card with "N on plate · M urgent · K in inbox" stats) above a vertical-axis timeline that interleaves calendar events with `public.task_events` (created / moved / completed / deleted).
- **Middle panel** — kanban board. Columns render dynamically from `public.columns`; drag to reorder. Each card shows owner icon (Bashir or Claude), priority dot, title, up to 2 tag chips. Drag-and-drop within and between columns. "+" at the end of the row adds a column inline; column header "..." menu handles rename / accent color / delete-with-destination.
- **Right panel** — agent activity feed from `public.agent_events` (top section, polled every 30s) above a context placeholder.
- **Command bar** — persistent at the bottom. ⌘K focus. Prefixes `task:` / `add:` / `capture:` / `todo:` short-circuit straight to a `createTask` server action (no LLM). Everything else streams chat through `/api/chat` into a popover above the bar.

Connectors run server-side: Gmail and Google Calendar use multi-account OAuth with refresh tokens stored in `connector_tokens`; Jira uses a personal access token from env. Each connector resolves its target column (`Inbox` for gmail/slack, `Today` for calendar, `Active` for jira) via `resolveColumnId` and upserts into `tasks`, deduped on `(user_id, source, source_account, source_id)`. Gmail's R3a importance scorer now splits the admit band three ways: score 8-10 auto-task to Inbox, 4-7 → `public.pending_emails` (triage queue), 0-3 drop. The triage queue surfaces in the brief as an attention bar; clicking opens a keyboard-driven `TriageModal`.

Chat backend is unchanged from R2.5: `/api/chat` builds a per-turn context (column-grouped board state, calendar next-24h, recent emails, top-K semantically matched memories from `match_memories`) and runs a `ToolLoopAgent` with four mutating tools (`createTask`, `moveTask`, `updateTask`, `deleteTask`) and two read tools (`findTasks`, `findMemories`). The tools take column **names** which resolve to ids server-side. Memory writes still happen via the "Remember" affordance; memory reads happen automatically per turn.

A Vercel Cron at 5:30 UTC (9:30 Dubai) re-syncs Gmail + Calendar per user. The R2 LLM-generated brief was retired — the brief panel reads current state every page render. A second cron at 20:05 UTC (00:05 Dubai) clears expired snoozed_until on tasks and pending_emails.

## Prerequisites

- Node 20+
- pnpm
- Docker (only if you want to run a local Supabase stack — see Local dev caveat)
- Supabase CLI (`brew install supabase/tap/supabase`)
- A Google Cloud project with an OAuth 2.0 Web client + Gemini API key
- For Jira: an Atlassian site and API token (https://id.atlassian.com/manage-profile/security/api-tokens)
- For Slack: a custom Slack app with `im:history`, `im:read`, `users:read` user scopes (requires workspace admin to install — see Known issues)

## Local dev

```bash
pnpm install
cp .env.example .env.local
# Edit .env.local — fill in cloud Supabase URL + anon key + GEMINI_API_KEY + Google OAuth client + (optional) Jira/Slack
pnpm dev
```

Then open `http://localhost:3000` and sign in with Google.

**Two Supabase projects, by design.** Local dev points at the `bash-os-dev` project (ref `xuqpifhojipuzqrowadt`, Sydney); production runs on `bash-os` (ref `vbooingflkmzxcqnbvxr`, Singapore). Vercel env vars are configured against prod; `.env.local` against dev. Schema changes go to dev first, prod second, after explicit approval. See `docs/ARCHITECTURE.md` → "Dev / prod Supabase split" for the full migration workflow.

**Tabby network caveat:** local Supabase via Docker (`supabase start`) is broken on the Tabby corporate network. Outbound TLS from inside the GoTrue / `edge-runtime` containers fails with `x509: certificate signed by unknown authority` because of corporate TLS interception, so Google OAuth and Deno module fetches don't work. The actual dev workflow is **cloud-only** — `.env.local` points at the cloud Supabase project and there's no local DB at all. If you ever need local Supabase, you'd need IT to provide the corporate root CA and mount it into the GoTrue container's trust store. See `docs/ARCHITECTURE.md` for the full story.

## Database migrations

```bash
# Create a new migration
supabase migration new <descriptive_name>

# Apply to cloud (after `supabase link --project-ref vbooingflkmzxcqnbvxr`)
supabase db push
```

`supabase db reset` works against the local stack — it's not part of the normal dev flow here for the network reasons above.

Migrations (in apply order):

| File | Purpose |
|---|---|
| `20260518165725_init.sql` | R1 — `tasks` + `memories` tables, the 7-status CHECK constraint, RLS policies on both, `pgvector` extension. |
| `20260518223740_r2_connector_tokens_and_task_source.sql` | Adds `connector_tokens` for OAuth + `tasks.source` CHECK. |
| `20260518230026_r2_multi_account_connectors.sql` | Lifts the unique key on `connector_tokens` from `(user_id, provider)` to `(user_id, provider, account_email)` so one user can link multiple Google accounts. |
| `20260518232130_r2_tasks_dedup_constraint.sql` | Replaces the partial dedup index with a full unique constraint compatible with PostgREST `upsert`. |
| `20260518232847_r2_add_brief_source.sql` | Adds `'brief'` to the `tasks.source` CHECK so the daily brief writes don't violate it. |
| `20260518235838_r2_chat_messages.sql` | Chat persistence table for the assistant drawer. |
| `20260519000100_r2_memory_search.sql` | HNSW cosine index on `memories.embedding` + `match_memories(query_embedding, match_count)` RPC. |
| `20260519010000_r2_5_briefs_table.sql` | R2.5 — adds `public.briefs` with `unique (user_id, brief_date)`, deletes any existing brief-tasks, drops `'brief'` from the `tasks.source` CHECK. |
| `20260519020000_r3a_tasks_importance.sql` | R3a — adds `tasks.importance smallint null` for the Gmail importance scorer. |
| `20260519030000_r3b_tasks_parent_id.sql` | R3b — adds `tasks.parent_id uuid` (self-FK, ON DELETE CASCADE) + partial index for the task-decomposition feature. |
| `20260519040000_r3_5_columns_and_owner.sql` | R3.5 — creates `columns` / `task_events` / `recurrences` / `agent_events` / `pending_emails`. Adds `tasks.column_id` (nullable), `owner`, `needs_review`, `tags`, `snoozed_until`. |
| `20260519050000_r3_5_seed_columns_and_migrate_tasks.sql` | R3.5 — seeds 5 starter columns (Inbox / Today / Active / Review / Done) per user; back-fills `tasks.column_id` + `owner` from the legacy status mapping. Aborts if any row remains with null column_id. |
| `20260519060000_r3_5_drop_status_column.sql` | R3.5 — destructive. Drops `tasks.status` and the old `tasks_user_status_position_idx`. Locks `tasks.column_id` to NOT NULL. |

## Environment variables

See `.env.example` for the canonical list. Quick reference:

| Variable | Required | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Cloud Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Cloud Supabase anon/publishable key. |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Server-only. Used by the cron job to bypass RLS when fanning out per-user syncs. Never exposed client-side. |
| `GOOGLE_OAUTH_CLIENT_ID` | yes | Google OAuth Web client ID. Used by `/connectors/google/connect` to start the OAuth dance and by token refresh. |
| `GOOGLE_OAUTH_CLIENT_SECRET` | yes | Paired with the client ID. |
| `GEMINI_API_KEY` | yes | Direct Google Generative Language API key from https://aistudio.google.com/apikey. Used for chat, brief, embeddings. |
| `CRON_SECRET` | yes | Random string. Vercel Cron sends it as `Authorization: Bearer <value>` to `/api/cron/daily-brief`. |
| `JIRA_BASE_URL` | optional | e.g. `https://tabby.atlassian.net`. Skipping any of the three Jira vars silently disables the Jira connector. |
| `JIRA_EMAIL` | optional | Atlassian login email. |
| `JIRA_API_TOKEN` | optional | Personal API token. |
| `SLACK_USER_TOKEN` | optional | `xoxp-…` user token. Silently disables Slack connector when unset. See Known issues — currently blocked by org admin policy. |
| `AGENT_EVENTS_TOKEN` | yes | Project-wide shared secret for the `/api/agent-events` ingestion endpoint. Generate with `node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))'`. Distinct values per environment. |

## Connectors

### Google (Gmail + Calendar) — OAuth, multi-account

- Token flow: `/connectors/google/connect` redirects to Google OAuth; `/connectors/google/callback` exchanges the code, stores `access_token` + `refresh_token` + `expires_at` + `scopes` in `connector_tokens` keyed on `(user_id, provider='google', account_email)`. One Bash OS user can connect multiple Google accounts (e.g. work + personal).
- Scopes requested: `openid email profile https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.readonly`.
- Refresh: lazy. On each connector call, `getGoogleAccessToken` reads the stored row; if it's within 60s of expiry, refreshes against `https://oauth2.googleapis.com/token` and persists the new access token + expiry. Failed refresh surfaces as "reconnect the account".
- **Gmail sync:** queries `is:unread in:inbox`, pulls last 20 messages, scores each via Gemini 3 Flash (`src/lib/board/email-importance.ts`), drops anything with `importance < 4`, and lands the survivors in `things to think about` with `source='gmail'`, `source_account=<email>`, `source_id=<gmail message id>`, and `importance` set on the row. Dedup via `(user_id, source, source_account, source_id)`. Scoring failures default to `score=5` (admit) so a model outage never silently swallows real mail. Append `?show_filtered=1` to `/board` to re-run sync without dropping low-score messages — admitted-but-low rows get a `[filtered:N]` title prefix for spot-checking the rubric.
- **Calendar sync:** pulls the next 24h of events, lands them with `source='calendar'`. `due_date` is set to the event start time.

### Jira — PAT, single site

- No OAuth dance. Token read from `JIRA_API_TOKEN` env, paired with `JIRA_EMAIL` for HTTP Basic auth against `JIRA_BASE_URL`.
- JQL: `assignee = currentUser() AND statusCategory != Done`. Hits `POST /rest/api/3/search/jql` (the new endpoint after Atlassian deprecated `GET /search`).
- Lands issues in **Bash work** (assigned issues are already actionable) with `source='jira'`, `source_account=<host>`, `source_id=<ISSUE-KEY>`. Maps Jira priority Highest/High/Medium/Low/Lowest → bash-os `urgent`/`high`/`normal`/`low`. Sets `due_date` from `fields.duedate` if present.

### Slack — code shipped, blocked at install time

- Code lives at `src/lib/board/slack-sync.ts`. Reads `SLACK_USER_TOKEN` (a `xoxp-…` user token), calls `auth.test` to discover workspace + self ID, lists DM channels via `conversations.list?types=im`, pulls last 48h from each via `conversations.history`, drops the OTHER party's messages into `things to think about` deduped by `(channel:ts)`.
- Bashir is not a workspace admin at Tabby and Slack killed legacy user tokens in 2020, so the token can't currently be obtained. The connector silently no-ops when `SLACK_USER_TOKEN` is unset, so the rest of the app is unaffected.

## Command bar + chat tools

The chat used to live in a right-side drawer. R3.5 moved it into a persistent command bar at the bottom of `/`. ⌘K (Ctrl+K on non-Mac) focuses it from anywhere. Prefixes `task:` / `add:` / `capture:` / `todo:` short-circuit to a direct Inbox insert with no LLM call. Everything else POSTs to `/api/chat` and streams the response into a popover above the bar.

The chat agent (`ToolLoopAgent` in `src/lib/board/chat.ts`) has six tools, all scoped to the authenticated user via RLS. Tools take column **names**, not ids — they're resolved server-side via `resolveColumnByName`.

**Mutating tools** (board write access):

| Tool | Purpose |
|---|---|
| `createTask` | Adds a new task. Defaults to `Inbox` for vague captures; uses `Today` only when the user explicitly says today/now/urgent. Accepts optional `owner` ('bash' default, 'claude' when the user asks Claude to do it). |
| `moveTask` | Resolves by title fragment (`ILIKE`), moves to a destination column by name. |
| `updateTask` | Resolves by title fragment; partial update of title/description/priority/column. |
| `deleteTask` | Permanent removal. System prompt restricts to explicit user delete intent. |

All mutating tools also insert a row into `public.task_events` so the timeline panel reflects the activity.

**Read tools**:

| Tool | Purpose |
|---|---|
| `findTasks` | Keyword + column/source filtered search across the full board (default 10, max 25). Reach for this when the truncated per-column snapshot won't cover the question. |
| `findMemories` | Semantic search over `public.memories` with the same cosine-0.55 threshold as the auto-injection (default 5, max 10). |

Task resolution returns an "ambiguity" error with candidate titles when more than one task matches the fragment — the agent surfaces those to the user instead of guessing.

## Agent activity ingestion

External agents (Claude Code hooks, Cowork sessions, anything that wants to surface "I'm working on X right now") can POST to `/api/agent-events` to land a row in `public.agent_events`. The right-panel feed renders the latest 20 events, refreshing every 30s.

```
POST /api/agent-events
Authorization: Bearer $AGENT_EVENTS_TOKEN
Content-Type: application/json
{
  "user_id": "<uuid>",
  "source":  "claude-code",
  "project": "bash-os",                  // optional
  "action":  "editing",
  "target":  "src/queries.ts",           // optional
  "payload": { "line": 42 }              // optional, arbitrary JSON
}
```

Returns `{ ok: true, id, created_at }` on success, 401 on missing/bad bearer, 400 on schema violation. The token bypasses RLS via the admin client because the caller may be a worker with no Supabase session; the `user_id` in the payload determines whose feed the event lands in.

**Wiring a Claude Code hook**: in your project, add a Stop hook in `.claude/settings.json` that posts to the endpoint. Sketch:

```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "curl -s -X POST https://bash-os.vercel.app/api/agent-events -H \"Authorization: Bearer $AGENT_EVENTS_TOKEN\" -H \"Content-Type: application/json\" -d '{\"user_id\":\"<your-uuid>\",\"source\":\"claude-code\",\"project\":\"<project-name>\",\"action\":\"session ended\"}'"
          }
        ]
      }
    ]
  }
}
```

Bash OS itself writes to the same table from the morning cron (one "morning sync" event per user, with per-source counts in the payload) and `/api/chat` (one "message" event per user turn, target = leading 120 chars of the prompt).

## Task decomposition ("Break it down")

Hover any task on the board and a small split icon appears in the top-right of the card (hidden on child tasks — R3b is two levels deep). Clicking opens a dialog that asks Gemini 3 Flash to propose 2-5 atomic sub-tasks classified into `Bash work` / `Claude work` / `Boss Check`. Each proposed child is editable inline (title, description, column) and has a checkbox; the user clicks "Create N sub-tasks" to insert them, or cancels.

The agent never writes directly — `decomposeTask(taskId)` only proposes; `createDecomposedChildren(parentId, children[])` is a separate action triggered by the dialog's Create button. Children carry `parent_id` set to the parent's UUID and inherit a `source_id` prefix from the parent (`{parent.source_id ?? parent.id}/{kebab-slug}`) so the relationship is visible at a glance. Opening a child task in the editor shows a faded `↑ parent: <title>` line above the title.

See `docs/ARCHITECTURE.md` → "Task decomposition" for the schema, classification rubric, and rationale.

## Memories + RAG

- **Write side ("Remember" button):** each user chat bubble has a button that calls `commitToMemory(content, ['from-chat'])` (`src/app/board/memories.ts`). The content is embedded via `gemini-embedding-001` at 1536 dims with `taskType='RETRIEVAL_DOCUMENT'`, and inserted into `public.memories` (one row per memory, `embedding vector(1536)`, free-form `tags text[]`).
- **Read side (per chat turn):** every `/api/chat` POST embeds the user's incoming message with `taskType='RETRIEVAL_QUERY'`, calls the `match_memories(query_embedding, match_count)` RPC (SECURITY INVOKER — RLS-gated automatically), filters matches under cosine 0.55, and injects the top-K above the board state in the LLM context with the system-prompt instruction "treat as ground truth".
- HNSW `vector_cosine_ops` index on `memories.embedding` keeps the search fast as the table grows.

## Scheduled jobs

`vercel.json` declares two crons:

```json
[
  { "path": "/api/cron/daily-brief", "schedule": "30 5 * * *" },
  { "path": "/api/cron/unsnooze",    "schedule": "5 20 * * *" }
]
```

**Morning sync** (05:30 UTC = 09:30 Dubai). For each user with at least one connected Google account, syncs Gmail + Calendar in parallel and writes a "morning sync" row to `public.agent_events`. R3.5 stopped generating an LLM brief — the brief panel reads current state every page render. The endpoint verifies the `Authorization: Bearer <CRON_SECRET>` header (401 otherwise).

**Nightly unsnooze** (20:05 UTC = 00:05 Dubai). Clears expired `snoozed_until` on `tasks` and `pending_emails`. Same `CRON_SECRET` bearer.

Manual invocation: `curl -H "Authorization: Bearer $CRON_SECRET" https://bash-os.vercel.app/api/cron/daily-brief`. Returns `{ok:true, userCount, summaries:[…]}` on success.

## Deploying to Vercel

1. Repo lives at `https://github.com/lebashir/bash-os` (personal GitHub account). Pushes to `main` auto-deploy to `bash-os.vercel.app`.
2. All env vars from `.env.example` must be set on the Vercel project (Settings → Environment Variables, Production scope). `vercel env add NAME production` is the CLI shortcut.
3. In **Supabase dashboard → Authentication → URL Configuration**: Site URL = `https://bash-os.vercel.app`; Redirect URLs include `https://bash-os.vercel.app/**`.
4. In **Google Cloud Console → OAuth client**: Authorized redirect URIs include `https://bash-os.vercel.app/auth/callback`, `https://bash-os.vercel.app/connectors/google/callback`, and the Supabase auth callback `https://vbooingflkmzxcqnbvxr.supabase.co/auth/v1/callback`.

Vercel Server Actions and Route Handlers read env vars at runtime — adding or rotating a non-`NEXT_PUBLIC_*` var does not require a redeploy. `NEXT_PUBLIC_*` vars are inlined at build time and DO require a redeploy.

## Round status

R1, R2, R2.5, R3 (both R3a and R3b), and R3.5 (UX redesign + custom columns + owner + command bar + agent activity + email triage) are complete. A small R3.5c follow-up holds the trimmed items (board filter/sort, recurring tasks UI, right-panel chat history). Next strategic round is R4 — autonomous Claude-owned tasks. See `docs/ROUNDS.md` for the round-by-round breakdown.
