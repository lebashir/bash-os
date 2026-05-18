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

## Status CHECK constraint

The 7 status values are CHECK-constrained at the DB and mirrored as a TypeScript const in `src/lib/supabase/types.ts`. They must stay in sync.

**Exact current values (case + punctuation matter):**

```
things to think about
on the menu
todays plate
Bash work
Claude work
Boss Check
DIgested.
```

Changing this set requires:
1. A migration that ALTER-TABLEs the CHECK constraint.
2. Updating `TASK_STATUSES` in `src/lib/supabase/types.ts`.
3. Any tool / agent / UI that hard-codes a status (e.g. `INTAKE_STATUS` in `gmail-sync.ts`, `ASSIGNED_STATUS` in `jira-sync.ts`, the chat agent's "things to think about" default).

Renaming a status is destructive — existing rows with the old value will violate the new constraint. The migration must `UPDATE tasks SET status = '<new>' WHERE status = '<old>'` before swapping the constraint.

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
