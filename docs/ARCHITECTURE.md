# Architecture decisions

Non-obvious choices made during R1 and R2 that future-Bashir or future-Claude shouldn't have to re-derive. One section per decision. Update when a decision changes.

---

## Multi-account connector model

One Bash OS user can connect multiple accounts per provider — work Gmail + personal Gmail being the canonical example. The schema enforces this:

```
public.connector_tokens (
  user_id        uuid    references auth.users(id) on delete cascade,
  provider       text    check (provider in ('google')),
  account_email  text,
  access_token   text    not null,
  refresh_token  text,
  expires_at     timestamptz,
  scopes         text[],
  unique (user_id, provider, account_email)
)
```

The original R2 v1 had `unique (user_id, provider)` (one Google account max per user). Migration `20260518230026_r2_multi_account_connectors.sql` lifted the unique key to include `account_email` so additional connects don't UPSERT-overwrite the previous one.

Tasks dedupe across accounts via `(user_id, source, source_account, source_id)`. `source_account` carries the originating account email (or workspace/site host for non-OAuth connectors). This means Gmail messages from `bashir@personal.com` and `bashir@tabby.ai` don't collide on `source_id`.

The `provider` CHECK currently only allows `'google'`. Adding a new OAuth provider (e.g. Atlassian for full Jira OAuth instead of PAT) requires a migration to extend the CHECK plus a corresponding bump to `CONNECTOR_PROVIDERS` in `src/lib/supabase/types.ts`. Jira and Slack don't store rows here — they use env-var PATs and skip the table entirely.

---

## Token storage

OAuth refresh tokens are stored in `connector_tokens` in **plaintext columns**, not Vault- or pgcrypto-encrypted. The protection model is:

1. **RLS at the row level** — `connector_tokens_select_own` policy gates SELECT on `auth.uid() = user_id`. A user can only ever read their own tokens.
2. **Supabase encryption at rest** at the disk level (provider-managed). Tokens are not on disk in cleartext, but they are readable by anything with the service-role key.
3. **Service-role key restricted to server-only paths** — `src/lib/supabase/admin.ts` constructs an admin client used only by the cron route and never imported by client components.

**Known security debt:** anything that gets the service-role key (a leaked Vercel env var, a compromised cron route) reads every user's refresh tokens in cleartext. For a single-user personal tool this is acceptable. If Bash OS ever grows to multi-user, this needs upgrading to Supabase Vault or pgcrypto with a project-secret key. Flagged in `docs/KNOWN_ISSUES.md`.

Slack and Jira tokens don't hit the DB at all — they live in env vars only. Same trust boundary as the service-role key.

---

## Token refresh

Lazy + opportunistic. `src/lib/google/token.ts → getGoogleAccessToken(supabase, userId, accountEmail)`:

1. SELECT the row from `connector_tokens` for `(user_id, 'google', accountEmail)`.
2. If `expires_at` is more than 60 seconds in the future, return the stored `access_token` directly.
3. Otherwise POST to `https://oauth2.googleapis.com/token` with the stored `refresh_token` and the client ID/secret from env.
4. On success, UPDATE the row with the new access token + new expiry, return the new token.
5. On failure (missing refresh token, or Google returns invalid_grant): throw an actionable error message telling the user to reconnect the account.

The 60-second leeway avoids a race where a token "looked valid" at the start of a request but expired by the time Gmail received it. There's no scheduled refresh job — refresh only happens at the moment a token is needed.

---

## Custom columns + owner model (R3.5)

The 7-value `tasks.status` CHECK that R1 baked in is gone. Replaced by:

```
public.columns (
  id           uuid pk,
  user_id      uuid references auth.users(id) on delete cascade,
  name         text not null,
  position     int not null,
  icon         text,            -- Tabler icon name, e.g. 'ti-inbox'
  accent_color text,            -- 6-char hex, e.g. '#5e8aff'
  is_default   bool not null default false,
  unique (user_id, position)   -- DEFERRABLE for batch reorders
  unique (user_id, name)
)

public.tasks.column_id uuid not null references columns(id) on delete restrict
public.tasks.owner     text not null default 'bash' check (owner in ('bash','claude'))
public.tasks.needs_review bool not null default false
public.tasks.tags      text[] not null default '{}'
public.tasks.snoozed_until timestamptz
```

**Why columns are user-managed.** R1's seven statuses encoded an opinion about Bashir's workflow that wasn't durable (he never used `on the menu`, `Claude work` was aspirational, `DIgested.` had a typo). Lifting to a table lets him rename, recolor, add, delete without a migration each time. The five starter columns (Inbox / Today / Active / Review / Done) are seeded per user at sign-up.

**Why owner is its own field.** R1 split Bash-and-Claude work across two columns. R3.5 collapsed both into a single Active column with `owner ∈ {bash, claude}` per task. The card shows the owner via an icon + a 5% purple background tint for claude-owned cards. Decomposed children map: "Bash work" → Active+bash, "Claude work" → Active+claude, "Boss Check" → Review+claude+needs_review=true.

**Migration shape.** Three migrations applied 2026-05-19, in order:

1. `20260519040000_r3_5_columns_and_owner.sql` — additive. New tables (`columns`, `task_events`, `recurrences`, `agent_events`, `pending_emails`), new task columns (`column_id` nullable, `owner`, `needs_review`, `tags`, `snoozed_until`). Old `tasks.status` keeps working.
2. `20260519050000_r3_5_seed_columns_and_migrate_tasks.sql` — seeds the 5 starter columns for every user with at least one task row, back-fills `column_id` + `owner` + `needs_review` based on legacy status. Verifies zero rows have null `column_id` via a DO block.
3. `20260519060000_r3_5_drop_status_column.sql` — destructive. Drops `tasks.status`, drops the old `tasks_user_status_position_idx`, locks `column_id` to NOT NULL.

**No hardcoded column names in app logic.** App paths that need a "well-known" column (gmail sync → Inbox, jira sync → Active) resolve via `resolveColumnId(supabase, userId, name)` in `src/lib/board/columns.ts`. Falls back to the user's lowest-position column if the requested name doesn't exist (covers rename / delete).

**R4 hookpoint.** R4 wants to scan for `owner='claude'` tasks, execute them, and move into Review with `needs_review=true`. That's now a single index lookup (`idx_tasks_owner`) plus a column-id-by-name resolve.

---

## Brief panel architecture (R3.5)

The brief panel is a **deterministic** server action that reads current DB state and returns a `BriefState` shape. No LLM call. Lives at `src/app/board/brief-state.ts → getBriefState()`.

**Attention bars** are rendered in priority order; only those whose trigger fires are included:

| Kind | Trigger | Treatment | Click target |
|---|---|---|---|
| `calendar-imminent` | calendar-source task with `due_date BETWEEN now AND now+15min` | red | (toast — future: scroll timeline to that event) |
| `tasks-overdue` | active task (non-Done) with `due_date < now` | red | (toast — future: open overdue list) |
| `emails-urgent` | active board task with `source='gmail'` AND `importance >= 9` | red | (toast — future: filter board) |
| `needs-review` | active task with `needs_review = true` | amber | dispatches `bash-os:filter-column` CustomEvent with the Review column id |
| `emails-triage` | pending_emails row count > 0 | amber | dispatches `bash-os:open-triage` CustomEvent → opens `TriageModal` |
| `items-unsnoozed` | task with `snoozed_until` in the last 24h | blue | (toast) |

**Day update card** (always rendered): next calendar event with countdown, then "N on plate · M urgent · K in inbox" stats. Counts are computed by filtering the snapshot (no extra queries).

**Why deterministic.** R2 generated the brief via Gemini. Two problems: (1) every cron run cost a model call to summarize state the user could read at a glance from the board, (2) the LLM occasionally invented context that wasn't there. R3.5's panel can't hallucinate — every bar's count comes from a literal SQL filter. `public.briefs` stays in place for a possible future hybrid mode (an LLM-generated headline overlaid on the deterministic panel) but the cron no longer writes to it.

**Snoozed items.** The state query filters `tasks.snoozed_until` and `pending_emails.snoozed_until` with `is.null OR <= now`, so a snoozed item is invisible to the panel until its time comes.

---

## Command bar pattern (R3.5)

Chat moved out of the right-side drawer (`ChatLauncher.tsx` deleted) and into a persistent 40px bar at the bottom of the homepage. ⌘K (Ctrl+K on non-Mac) focuses the input from anywhere; Escape dismisses the response popover.

**Short-circuit prefixes.** Input starting with `task:`, `add:`, `capture:`, or `todo:` skips the LLM entirely. The rest of the line goes straight to `createTask()` with `column_id` resolved to Inbox and `owner='bash'`. Toast confirms the capture. This makes "quick capture" zero-token.

**Other input → /api/chat.** The backend hasn't changed since R2.5 — it still loads history from `chat_messages`, builds the per-turn context, runs `ToolLoopAgent` with six tools, streams via `useChat` + `DefaultChatTransport`. What changed: the request body only ships the latest user message (history is server-side), and the streamed response renders in a popover above the bar instead of a drawer.

**Popover semantics.** Slides up above the bar on submit, shows the last 8 turns, supports Stop + Clear. Click-outside or Escape closes it; the messages survive (they're persisted server-side anyway).

**Drawer is gone.** `BriefDrawer.tsx`, `ChatLauncher.tsx`, and `SyncButton.tsx` were all deleted in R3.5. The brief lives in the left panel; sync runs from the morning cron (no manual button — Bashir can hit `/api/cron/daily-brief` with the bearer secret if he ever needs to force a re-sync).

---

## Agent activity ingestion (R3.5)

External agents (a Claude Code hook, a Cowork session, anything that wants to surface "I'm working on X right now") can POST to `/api/agent-events` to write a row into `public.agent_events`. The right-panel feed renders the latest 20 events, refreshing every 30s.

**Endpoint shape**:

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

Returns `{ ok: true, id, created_at }` on success, 401 on missing/bad bearer, 400 on schema violation.

**Auth model.** The token is a project-wide shared secret in `AGENT_EVENTS_TOKEN`. Insert goes through the admin client (RLS bypassed) because the caller may be a worker with no Supabase session. The `user_id` in the payload determines whose feed it lands in — there's no per-token user binding yet (single-user project), but a future multi-user version would scope tokens by user.

**Internal events.** Bash OS itself writes to the same table:

- `/api/cron/daily-brief` — one event per user per run, source `cron`, action `morning sync`, payload with per-source counts.
- `/api/chat` — one event per user turn, source `chat`, action `message`, target = first 120 chars of the prompt.

Future: gmail/calendar/jira sync paths could each write a per-account event. Not in R3.5 — kept the noise down.

**R4 hookpoint.** When R4 wires autonomous Claude-owned execution, each agent step (start, tool call, completion) becomes an `agent_events` row tagged `source='r4-worker'`, project = the originating task, action describing the step. The feed already renders that shape.

---

## Email triage flow (R3.5)

R3a admitted any email with `importance >= 4` to the board. R3.5 splits the admit band into two:

| Score | Routing | UI |
|---|---|---|
| 8-10 | Auto-task to Inbox column with `source='gmail'`, `importance` set | Renders on board immediately. |
| 4-7 | Insert into `public.pending_emails` (subject, sender, snippet, score) | Triage queue. Brief panel shows an amber "N emails to review" bar; click opens `TriageModal`. |
| 0-3 | Drop silently | Visible only with `/?show_filtered=1` for rubric debugging. |

**Triage modal**: keyboard-driven (`↑↓` navigate, `T` make task, `D` dismiss, `S` snooze 24h, `O` open in Gmail). "Make task" promotes the pending row into a board task in Inbox (records a `task_events` 'created' row tagged `source='triage'`) and deletes the pending row.

**Snooze semantics**. Both `tasks.snoozed_until` and `pending_emails.snoozed_until` mean "treat this row as invisible until that timestamp passes". The brief panel's state query honors it (`is.null OR <= now`). A nightly `/api/cron/unsnooze` at 20:05 UTC (00:05 Dubai) clears expired snoozes — items literally reappear at the start of the user's local day.

**Why 4-7 isn't just "auto-task with a flag".** Phase 9 needed a separation between "this email definitely deserves your attention" (8-10) and "this might be useful, you decide" (4-7). Surfacing the 4-7 band as an attention bar with a single decision point is faster than triaging each one as a board task — Bashir reads the snippet, hits T or D, moves on.

---

## AI SDK v6 choice

R2 originally hand-rolled the chat against `https://generativelanguage.googleapis.com` — REST fetches, a manual function-call loop with `functionCall` / `functionResponse` parts, and a hand-managed contents array. That was ~300 LOC of plumbing that grew with every new tool.

Mid-R2 we replaced it with AI SDK v6 (`ai` + `@ai-sdk/google` + `@ai-sdk/react`). What it bought:

- **`ToolLoopAgent`** — one place to declare tools with zod `inputSchema`. The agent runs the multi-step loop internally; we stopped writing `for (let loop = 0; loop < MAX; loop++)`.
- **Streaming** — `agent.stream({ messages })` + `toUIMessageStreamResponse()` gives streaming chat without a custom protocol.
- **Provider abstraction** — `google('gemini-3-flash-preview')` is the only place the provider matters. Swapping to `'google/gemini-3-flash'` via AI Gateway is a one-line change.
- **`useChat`** — client hook handles state, transport, and chunk assembly. Replaced ~200 LOC of custom message-state + fetch-reader plumbing.

What it cost: two extra packages, a slightly indirect knob for Gemini-specific options (e.g. `providerOptions.google.thinkingConfig.thinkingBudget` instead of a raw field). Worth it.

Migration was three commits: `2090e1b` refactor, `fc07d04` more chat tools (the +178 LOC savings from the refactor paid for the extra tools), `9afa4b0` streaming.

---

## Streaming chat

`/api/chat` is the single endpoint. Flow:

1. Auth via Supabase server client (`createClient` reads cookies). 401 if no user.
2. Parse body: `{ message: UIMessage }` — `useChat` is configured with `prepareSendMessagesRequest` to ship only the new message; history lives in Supabase.
3. Extract `userText` from `message.parts[].text` concatenation. INSERT a row into `chat_messages` BEFORE invoking the model so the user's turn survives a mid-stream failure.
4. Build `messages: ModelMessage[]` via `buildAgentMessages(supabase, userId, userText)` — that helper loads the last 20 chat_messages rows, runs `searchMemories` for the current question, queries board + calendar + gmail context, and prepends a single user/assistant pair containing the rendered context.
5. `agent.stream({ messages })` → `result.toUIMessageStreamResponse({ onFinish })`.
6. `result.consumeStream()` is called (no await) so the model output drains even if the client disconnects — onFinish still fires and the assistant message still hits the DB.
7. `onFinish` extracts the assistant text from `responseMessage.parts`, INSERTs into `chat_messages`, then `revalidatePath('/board')`.

The client (`ChatLauncher.tsx`) hydrates from `listChatUIMessages()` on drawer open via `setMessages(initial)`. Tool actions surface as `tool-{name}` parts in the streamed response; the client scans them in `onFinish` and toasts per tool, then `router.refresh()` if any tool succeeded.

---

## Memory retrieval flow

Every `/api/chat` POST runs the full RAG pipeline. No caching — it's cheap enough at single-user scale and keeps the matches fresh.

1. **Embed the current question.** `geminiEmbed({ text: userText, taskType: 'RETRIEVAL_QUERY' })` returns a 1536-d vector. Note the taskType mismatch with writes (which use `RETRIEVAL_DOCUMENT`) — Gemini's recommendation, it tells the model what direction the comparison goes.
2. **Encode as pgvector literal.** `'[v1,v2,…,v1536]'` string. PostgREST RPC parameter typing handles the cast to `vector(1536)` based on the function signature.
3. **Call the RPC.** `supabase.rpc('match_memories', { query_embedding: literal, match_count: 5 })`. The function is SECURITY INVOKER, so RLS applies — only this user's rows are visible.

   ```sql
   create or replace function public.match_memories(
     query_embedding vector(1536),
     match_count int default 5
   ) returns table (id uuid, content text, tags text[], created_at timestamptz, similarity double precision)
   language sql stable
   as $$
     select id, content, tags, created_at, 1 - (embedding <=> query_embedding) as similarity
     from public.memories
     where embedding is not null
     order by embedding <=> query_embedding
     limit match_count;
   $$;
   ```
4. **Filter by cosine.** Drop any match below 0.55. That threshold was picked empirically — Gemini 1536-d embeddings on related content typically score 0.6+; under ~0.5 drifts to off-topic noise.
5. **Inject into context.** Top-K matches rendered above the board state in the per-turn context, with system-prompt instruction "treat as ground truth about preferences, decisions, or state".

Failures of the embed call or the RPC are caught and logged; the chat turn still proceeds with an empty memory list rather than failing.

Index: HNSW on `memories.embedding` with `vector_cosine_ops`. Fine for read-heavy small data. Not needed at single-digit row counts but keeps the shape right as the table grows.

---

## Cron security

`/api/cron/daily-brief` is publicly addressable (Vercel cron uses an HTTP call into the deployment) so it has to authenticate the caller. Pattern:

- Env: `CRON_SECRET` is a random string set in Vercel.
- Vercel cron is configured to send `Authorization: Bearer <value-of-CRON_SECRET>` automatically (Vercel injects this when the cron is declared in `vercel.json`).
- The route's `verifyCronSecret` function compares the header to `process.env.CRON_SECRET`. Anything else: 401.

This is the same pattern Vercel docs recommend. The route uses the service-role admin client because it operates across all users (RLS would block a normal authenticated client). The admin client never leaves this route + the brief generation pipeline; it's not exposed to anything user-facing.

Manual invocation: `curl -H "Authorization: Bearer $CRON_SECRET" https://bash-os.vercel.app/api/cron/daily-brief`. Returns a JSON summary of what ran per user, useful for debugging.

---

## Briefs vs tasks

R2 stored the daily brief as a row in `public.tasks` with `source='brief'`. That was expedient — no new table, the brief shows up at the top of `todays plate` automatically, the existing CRUD handles it. R2.5 unwound it.

Why it was wrong:

- A brief has no column, no priority, no `position`. Putting it in a kanban row meant carrying a bunch of NULL/dummy fields and a magic `source` value the rest of the code had to special-case.
- "One brief per day" was enforced by an ad-hoc DELETE before each insert in `generateAndStoreBrief`. That worked but it was app-level enforcement of a DB-level invariant.
- The brief's date semantics were never captured — `brief_date` was implicit in the title string (`"Daily brief — 2026-05-19"`).

R2.5 schema:

```
public.briefs (
  id          uuid primary key,
  user_id     uuid references auth.users(id) on delete cascade,
  brief_date  date not null,           -- Dubai-local calendar date
  content     text not null,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  unique (user_id, brief_date)
)
```

The unique constraint enforces one-per-day at the DB. The cron now `upsert`s on `(user_id, brief_date)` — re-runs same day replace, don't stack. The `updated_at` trigger reuses the shared `public.set_updated_at()` function from R1. RLS is the same four-policy `auth.uid() = user_id` pattern every other table uses.

`brief_date` is computed in JS from the current Dubai-TZ date via `Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' })`. Dubai is a fixed UTC+4 (no DST), so the 05:30 UTC cron always lands on the correct Dubai morning even if a manual re-run happens later in the same UTC day.

**Data loss on migration.** The R2.5 migration `delete from public.tasks where source = 'brief'` permanently removed the one existing brief-task. There was no path to migrate it into `public.briefs` without parsing its title for the date, and no historical brief data worth preserving (R2 had only shipped the day before). The next cron firing populates the new table cleanly.

UI surface: `BriefDrawer` (`src/components/board/BriefDrawer.tsx`) is a right-side drawer mirroring the chat drawer pattern. A `FileText` icon in the board header opens it; the body renders the selected day's content with `whitespace-pre-wrap` (briefs are plain prose by design, no markdown lib needed); a 7-day history list at the bottom swaps which day is shown. Server action `listRecentBriefs()` in `src/app/board/brief-actions.ts` is the only read path — `LIMIT 7` is fine for the foreseeable future.

---

## Dev / prod Supabase split

R2.5 introduced a second Supabase project to keep R3's LLM iteration out of production data.

- **bash-os** (ref `vbooingflkmzxcqnbvxr`, Singapore) — production. Vercel env vars point here. The morning cron writes here. End-user state lives here.
- **bash-os-dev** (ref `xuqpifhojipuzqrowadt`, Sydney) — dev sandbox. `.env.local` points here. `pnpm dev` against this DB. Free to seed weird test data, blow away the schema, iterate prompts against synthetic boards.

Both projects share the same Google OAuth client. The dev project's `auth/v1/callback` is in the OAuth client's authorized redirect URIs alongside prod's. Site URL on dev is `http://localhost:3000` (so post-sign-in lands locally); on prod it's `https://bash-os.vercel.app`.

**Migration workflow:**

```bash
# Default: linked to dev for iteration
supabase migration new <name>
# … edit migration …
supabase db push                          # applies to DEV

# After explicit approval to ship:
supabase link --project-ref vbooingflkmzxcqnbvxr
supabase db push                          # applies to PROD
supabase link --project-ref xuqpifhojipuzqrowadt   # re-link back to dev
```

Hard rule: never apply a migration to prod before dev. Never iterate LLM prompts (chat system prompt, brief system prompt) against prod. The dev project's region differs from prod (Sydney vs Singapore), which is fine — region doesn't change behavior, only latency.

The service-role keys are different per project. `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` is the dev key; the prod key lives only in Vercel env vars.

---

## Chat agent tool taxonomy

The `ToolLoopAgent` in `src/lib/board/chat.ts` exposes six tools, split by side-effects:

**Four mutating tools** (R2):

| Tool | Verb |
|---|---|
| `createTask` | Insert a new task into a column. |
| `moveTask` | Resolve by title fragment, move to a different column. |
| `updateTask` | Resolve by title fragment, patch title/description/priority/status. |
| `deleteTask` | Resolve by title fragment, permanent delete. |

**Two read-only tools** (R2.5):

| Tool | Verb |
|---|---|
| `findTasks` | Keyword + status/source filtered query across the full board (limit 1-25, default 10). |
| `findMemories` | Semantic search over `public.memories` with the same cosine-0.55 threshold as the per-turn auto-injection. |

**When to reach for read tools vs the injected context.** Every chat turn ships a snapshot of the board (truncated to 12 tasks per column), the next 24h of calendar, the last 48h of email, and the top-5 memory matches for the user's question. That snapshot is fine for "what should I do today?" type questions. The read tools exist for the cases the snapshot doesn't cover:

- A column has more than 12 tasks and the user asks about something in the tail.
- The user references a keyword that might match across columns — `findTasks` with a `query` filter is more reliable than scanning the snapshot.
- The user asks "what did I tell you about X?" — `findMemories` lets the agent fetch matches even if the per-turn auto-injection didn't surface them (different question text → different embeddings → different matches).

**Why `findMemories` duplicates the auto-injection.** Different use cases. The auto-injection runs on the *user's current message* once per turn — it's always-on context. `findMemories` runs on a query the *agent* constructs, often in response to an explicit recall request, and can re-query mid-conversation with different phrasings until something matches. The cosine threshold and limits are identical so the two paths return the same kind of results; only the trigger differs.

Mutating tool calls surface as `tool-{name}` parts in the streamed response, the client toasts per call, and `router.refresh()` is fired on success. Read tools surface as tool parts too but `collectToolToasts` ignores them — no toast, no refresh, because nothing on the board changed.

---

## Email importance scoring

R3a wires a triage step into the Gmail sync. For each unread message, after metadata is fetched and before the `tasks` upsert, `scoreEmailImportance({ subject, from, snippet })` calls Gemini 3 Flash with a one-shot rubric and returns `{ score: 1-10, reason: string }`. Scores below 4 are dropped silently; scores >= 4 are upserted and persisted on the new `tasks.importance smallint null` column.

Why the column is unconstrained: the threshold is intentionally an app-code knob, not a CHECK. Future rounds may want per-source rubrics (e.g. different cutoffs for Slack vs Gmail) or different scales — keeping the DB schema generic avoids a migration each time. Existing pre-R3a rows stay `importance NULL`, which the rest of the code reads as "unscored", not "low".

Failure semantics: if the model errors, throws a schema mismatch, or the request times out, `scoreEmailImportance` returns `{ score: 5, reason: 'scoring-failed' }`. The message is admitted with a neutral score rather than dropped — a noisy false-positive is recoverable (Bashir archives it), but a silently-dropped real email is not. The failure is `console.warn`-logged with the Gmail message ID so it can be traced.

Concurrency: scoring runs across all fetched messages via `Promise.allSettled`, so a single slow call doesn't block the rest of the sync. The Gmail API list cap is 20 messages per account per sync, so concurrent scoring loads are bounded.

Threshold is `IMPORTANCE_THRESHOLD = 4` in `src/lib/board/email-importance.ts`. Anything `< 4` is dropped. Calendar invites the user is required for typically score 8; personal action requests score 9-10; newsletters and CC chains hover at 3-4; marketing scores 1-2 and is consistently filtered.

`/board?show_filtered=1` is a spot-check toggle: re-runs the Gmail sync with the filter disabled and tags admitted-but-low-score rows with a `[filtered:N]` title prefix so Bashir can eyeball what the rubric dropped. Deliberately a query-param affordance, not a UI button — it's a debug tool.

---

## Task decomposition

R3b adds a "Break it down" affordance on each task: an icon button on the card opens a dialog that asks Gemini 3 Flash to propose 2-5 atomic child tasks for the parent, classified into one of three work columns. The user reviews, edits, and confirms before any rows are inserted.

**Schema.** `public.tasks.parent_id uuid null references public.tasks(id) on delete cascade`, plus a partial index on rows where `parent_id is not null`. Children are normal task rows on the board — they're not nested visually, just queryable via the FK. ON DELETE CASCADE was a deliberate choice: a parent without its children isn't load-bearing for the kanban, and orphan children with no context point to deleted work make the board harder to read.

**No nested decomposition.** R3b is two levels deep — a child can't itself be decomposed. The UI enforces this by hiding the Break-it-down button when `parent_id` is set; the schema doesn't. Lifting this would mean handling tree depth in the agent prompt (to avoid recursive sub-task explosions) and the UI (parent-of-parent chains). Not worth the complexity for the single-user case.

**Classification rubric.** The decomposition agent routes each child into one of:
- `Bash work` — relationships, judgment calls, irreversible actions. Meetings, decisions, external communications, anything requiring Bashir's personal context or authority.
- `Claude work` — mechanical, low-judgment, reversible. Research, drafting, formatting, cross-referencing. The kind of unattended LLM work that produces a useful output.
- `Boss Check` — Claude drafts something, Bashir approves before it ships. Procedure responses, status updates, draft replies, code that needs review before deploy.

The agent returns `{ children: [{ title, description, status, rationale }] }` via `generateObject` with a Zod schema. `rationale` is shown in the dialog but not persisted — it's there to make the agent's reasoning legible during review.

**Show, don't auto-insert.** `decomposeTask(taskId)` only proposes; it does not write. The user reviews children in the `DecomposeDialog`, edits inline (title, description, column), can deselect any, and clicks "Create N sub-tasks". `createDecomposedChildren(parentId, children[])` is the write path. This is the same pattern as the chat agent's mutating tools — propose then confirm, no surprise writes.

**Child source IDs.** Children inherit the parent's `source_id` (or fall back to its UUID) and append a kebab-case slug derived from the child title: `{parent.source_id ?? parent.id}/{slug}`. The slug is 1-3 lowercased words, max 30 chars. Examples: `PMP-65/draft-pricing-tiers`, `<parent-uuid>/check-calendar`. The slash is significant — it makes the parent-child relationship visible in any UI that surfaces `source_id` (TaskDialog, future filters) without needing to read `parent_id` separately.

**Parent display in TaskDialog.** When a child task is opened, the TaskDialog renders a faded `↑ parent: <parent title>` line above the title field. The parent title is fetched lazily via `getParentSummary(parentId)` so the dialog doesn't need to ship the full parent row in every prop tree.

---

## The Tabby network TLS issue

Local Supabase via Docker is **broken on the Tabby corporate network** and we don't develop against it. The story:

- Tabby's network does TLS interception. Traffic to external HTTPS hosts is MITM'd by a corporate proxy with a custom root CA.
- macOS host trusts that root CA (via IT-provided keychain config), so `curl` and `pnpm install` work fine from the host shell.
- Docker containers do NOT trust the corporate root CA by default — their own trust stores don't know about it.
- Inside the Supabase Docker stack, GoTrue tries to reach `accounts.google.com` for OAuth and `oauth2.googleapis.com` for token exchange. Both 4xx with `x509: certificate signed by unknown authority`.
- Same problem for `edge-runtime` (it pulls Deno bootstrap modules from `deno.land`) and `logflare`/`vector` (less critical but also broken).

**Workaround in practice:** `.env.local` points at the cloud Supabase project (`https://vbooingflkmzxcqnbvxr.supabase.co`). Local Docker is never started. Dev hits the cloud DB directly.

**Real fix if we ever need local:** extract the corporate root CA (`security find-certificate -a -p /Library/Keychains/System.keychain | …`), bake it into a custom Dockerfile layer on top of `supabase/gotrue` that copies it to `/usr/local/share/ca-certificates/` and runs `update-ca-certificates`. Same for `edge-runtime`. Repeat after any IT cert rotation.

Don't propose "spin up local Supabase to debug X" as a first move. Cloud is the dev environment.
