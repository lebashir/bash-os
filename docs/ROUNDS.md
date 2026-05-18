# Rounds

The single source of truth for what's shipped vs planned. Update this file at the end of each round, not in the middle.

---

## R1 — Bootstrap kanban + auth — ✅ Complete (2026-05-18)

- Next.js 16 App Router + TypeScript + Tailwind 4 + Turbopack scaffold
- Supabase Postgres + pgvector + Auth + RLS (RLS gated on `auth.uid() = user_id` for every table)
- Google OAuth-only sign-in (`/auth/callback`)
- `public.tasks` with the 7-status CHECK constraint, position-ordered within a column, optional priority / due date / source ID
- `public.memories` reserved with a `vector(1536)` column (write/read flow lands in R2)
- 7-column kanban view with drag-and-drop (dnd-kit, SSR mount-guarded `DndContext`)
- Full CRUD via shadcn dialog
- Next 16 `proxy.ts` (the renamed `middleware.ts`)
- Deploy to Vercel at `bash-os.vercel.app` under the personal `lebashir` account
- Toasts via `sonner` (chose this over the deprecated shadcn `toast`)
- No tests / no CI — deliberate skip, not an oversight

---

## R2 — Connectors + brief + chat + memory — ✅ Complete (2026-05-18 → 2026-05-19)

### Shipped

**Connectors:**
- Gmail connector — multi-account OAuth (one user can link work + personal Gmail), refresh tokens in `connector_tokens`, lands unread inbox messages in `things to think about`.
- Google Calendar connector — same multi-account pattern, lands next-24h events with `due_date` set.
- Multi-account UI — sign-out + per-account disconnect via menu.
- Unified Sync button — `syncAll()` runs every configured connector in parallel and toasts per-source counts.
- Jira connector — PAT auth (env vars), JQL `assignee = currentUser() AND statusCategory != Done`, lands in `Bash work` with Jira priority mapped to bash-os priority.

**Scheduled jobs:**
- Daily brief at 5:30 UTC (9:30 Dubai) via Vercel Cron. Re-syncs Gmail + Calendar per user, generates a brief paragraph via Gemini, drops it at the top of `todays plate`. Idempotent re-runs refresh rather than stack.

**Chat assistant:**
- Right-side drawer with persistent `chat_messages` history.
- Streaming replies via `/api/chat` + `useChat` (AI SDK v6). Only the new message is sent on the wire; server pulls history from Supabase.
- `ToolLoopAgent` with four mutating tools: `createTask`, `moveTask`, `updateTask`, `deleteTask`. Tasks resolved by title fragment with an ambiguity-error path that lists candidates so the agent asks the user instead of guessing.

**Memory layer:**
- "Remember" button on user messages embeds the content via `gemini-embedding-001` (1536 dims) and writes to `public.memories`.
- Per-turn semantic retrieval — every chat turn calls the `match_memories` RPC (HNSW cosine + RLS-gated, SECURITY INVOKER), filters above cosine 0.55, injects matches into the LLM context as ground truth.

**Refactors / infrastructure (pulled in from later rounds during R2):**
- **AI SDK v6 migration** — replaced the hand-rolled REST + manual function-call loop with `@ai-sdk/google` + `ToolLoopAgent`. Net –178 LOC, cleaner extension path for future tools. Wasn't in the original R2 sketch.
- **Streaming chat** — `/api/chat` + `useChat` + `DefaultChatTransport`. Wasn't in the original R2 sketch either, but landed cheaply once AI SDK was in place.
- **Gemini 3 Flash** — chat + brief moved from `gemini-2.5-flash` to `gemini-3-flash-preview` on the direct Google Generative Language API (Vercel AI Gateway has plain `gemini-3-flash` but Gateway swap is deferred).

### Deviations from the original sketch

- **Pulled in:** the AI SDK v6 refactor and chat streaming were introduced as quality-of-life upgrades during R2, not originally planned. Both kept the surface area small (the streaming refactor reused the same persistence model).
- **Cut entirely:** ClickUp connector — Bash OS replaces ClickUp, building it would be self-defeating. **Will never be built.**
- **Code shipped but blocked at install:** Slack connector — `src/lib/board/slack-sync.ts` exists and no-ops when `SLACK_USER_TOKEN` is unset. Bashir can't create Slack apps at Tabby (not a workspace admin) and Slack killed legacy user PATs in 2020, so the token can't currently be obtained. If admin status ever changes, dropping the token in env activates the connector with zero code change.

---

## R2.5 — Cleanup pass — ✅ Complete (2026-05-19)

A small round between R2 and R3 to fix one wrong abstraction, add one missing primitive, and isolate dev from prod before R3's LLM iteration starts. No scope expansion — three changes, exact list.

- **Briefs got their own table.** `public.briefs` replaces the R2 "brief is a task row" pattern. Unique on `(user_id, brief_date)` so re-runs upsert in place. RLS-gated like every other table. `'brief'` removed from the `tasks.source` CHECK so the conflation can't come back. New `BriefDrawer` (right-side drawer, parallel to chat) with a 7-day history list. Existing R2 brief-tasks were deleted in the migration — no historical data was preserved.
- **Chat got read tools.** `findTasks` (keyword + status/source filters across the full board) and `findMemories` (semantic search beyond the per-turn auto-injected matches) joined the four mutating tools. System prompt updated to nudge the agent toward these for specific lookups.
- **Dev / prod Supabase split.** A second project `bash-os-dev` (ref `xuqpifhojipuzqrowadt`, Sydney) now sits between local iteration and prod. `.env.local` points at dev; Vercel env vars stay on prod. Migrations are applied to dev first, prod second, after explicit approval.

---

## R3 — Email importance filtering + decomposition — 🚧 In progress

Split into two sub-rounds shipped back-to-back. R3a in flight on 2026-05-19; R3b queued behind it.

### R3a — Email importance filtering — ✅ Complete (2026-05-19)

- New `tasks.importance smallint null` column (migration `20260519020000_r3a_tasks_importance.sql`). Unconstrained at the DB so the threshold + scale can be retuned in app code.
- New helper `src/lib/board/email-importance.ts`: per-message Gemini 3 Flash call that returns `{ score: 1-10, reason: <short phrase> }`. Rubric weighs sender relationship, action verbs, calendar/deadline mentions, and marketing markers. Failures default to score 5 (admit) and a `console.warn` log; never silently drop on infrastructure error.
- Gmail sync now scores each fetched message in parallel via `Promise.allSettled`. Score < 4 is dropped before the upsert; score >= 4 is upserted with `importance` set.
- `?show_filtered=1` query param on `/board` re-runs the Gmail sync without dropping low-score messages. Filtered messages land with a `[filtered:N]` title prefix so they're visually distinguishable when spot-checking the rubric. Deliberately a debug affordance — no UI button.
- Rubric verified on five canonical fixtures against the dev project: personal action request → 10, calendar invite (required) → 8, newsletter → 4, marketing promo → 1, CC chain → 4. No prompt iteration needed.
- Cleared known issue #6 (Gmail firehose).

### R3b — Task decomposition — 🔜 Planned

- *Why it matters:* A Jira issue or a vague capture like "ship the new pricing flow" isn't actionable — it's a project. The board has a `Claude work` column and a `Boss Check` column precisely because some tasks should be split into sub-tasks across multiple actors. Right now there's no way to do that split.
- *Rough shape:* A "Break it down" button on a task opens an agent flow that proposes a tree: parent → 2-5 children. Children are classified into `Bash work` / `Claude work` / `Boss Check` per the agent rubric. A `parent_id uuid` column on `tasks` (FK self-reference, ON DELETE CASCADE) makes the tree queryable; children get a slashed source ID like `{parent.source_id ?? parent.id}/{slug}` so the relationship is visible at a glance.

**Possible R3 stretch items** (lift only one or two — don't blow scope):
- Connector retry / backoff for transient 429s and 5xxs.
- Per-task "remind me" timers backed by Vercel Cron + a `due_date`-driven trigger.

---

## R4 — Autonomous Claude-work column — 🔮 Sketched

- *Why it matters:* The `Claude work` column exists for a reason. Right now Bashir manually moves tasks there but nothing actually happens; the column is aspirational. R4 makes the column real.
- *Rough shape:* A Vercel Cron job (separate from the morning brief) scans `Claude work` every N minutes for tasks ready to execute. For each, it invokes a worker agent with the same `ToolLoopAgent` tools the chat already has, plus task-specific tools (web fetch, file write, draft-email, draft-comment). The agent runs autonomously, produces an output, and moves the task into `Boss Check` with the output attached to `description` for Bashir to review and either approve or kick back.
- Key questions to resolve before R4 can start: how to bound autonomous execution (token budget, time budget, tool-call count); how to handle agent failures (retry vs surface as error); how to render the agent's output in the `Boss Check` card (markdown? link out? attachment?).

---

## R5 — Personal domains + AI Gateway — 🔮 Sketched

- **Personal-life domains.** Bills, appointments, anniversaries, car registration. The kanban handles work + delegation well; R5 extends it to the rest of life. Likely shape: a dedicated set of recurring-task generators (Vercel Cron) that drop reminders into `things to think about` ahead of due dates. Specific generators for: monthly bill payment reminders (a "bills" YAML or table), annual renewals (registration, insurance), birthday/anniversary lookups.
- **AI Gateway swap.** Currently deferred — production runs on the direct Google API with `GEMINI_API_KEY`. Swapping to Vercel AI Gateway unlocks observability (per-model latency / cost dashboards), multi-provider routing, and easy model swaps (`google/gemini-3-flash` non-preview is in the Gateway catalog). One-line model-string change in `src/lib/gemini/client.ts` once `AI_GATEWAY_API_KEY` is in env. Per-token cost is identical (BYOK keeps the existing Gemini free tier intact).

---

## Permanently dropped

- **ClickUp connector.** Bash OS *replaces* ClickUp for Bashir's personal use. Building a connector for the tool you're moving away from is self-defeating. Never building this. If you see a future-me prompt that says "let's add ClickUp", stop and re-read this section.
