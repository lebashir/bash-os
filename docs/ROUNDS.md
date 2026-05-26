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

## R3 — Email importance filtering + decomposition — ✅ Complete (2026-05-19)

Split into two sub-rounds shipped back-to-back on 2026-05-19.

### R3a — Email importance filtering — ✅ Complete (2026-05-19)

- New `tasks.importance smallint null` column (migration `20260519020000_r3a_tasks_importance.sql`). Unconstrained at the DB so the threshold + scale can be retuned in app code.
- New helper `src/lib/board/email-importance.ts`: per-message Gemini 3 Flash call that returns `{ score: 1-10, reason: <short phrase> }`. Rubric weighs sender relationship, action verbs, calendar/deadline mentions, and marketing markers. Failures default to score 5 (admit) and a `console.warn` log; never silently drop on infrastructure error.
- Gmail sync now scores each fetched message in parallel via `Promise.allSettled`. Score < 4 is dropped before the upsert; score >= 4 is upserted with `importance` set.
- `?show_filtered=1` query param on `/board` re-runs the Gmail sync without dropping low-score messages. Filtered messages land with a `[filtered:N]` title prefix so they're visually distinguishable when spot-checking the rubric. Deliberately a debug affordance — no UI button.
- Rubric verified on five canonical fixtures against the dev project: personal action request → 10, calendar invite (required) → 8, newsletter → 4, marketing promo → 1, CC chain → 4. No prompt iteration needed.
- Cleared known issue #6 (Gmail firehose).

### R3b — Task decomposition — ✅ Complete (2026-05-19)

- New `tasks.parent_id uuid null references public.tasks(id) on delete cascade` plus a partial index `idx_tasks_parent_id` on the column where it's non-null (migration `20260519030000_r3b_tasks_parent_id.sql`).
- Hover-revealed "Break it down" icon button on each TaskCard, hidden when the task already has a parent (R3b is a two-level tree — children don't decompose further).
- New `DecomposeDialog` opens, runs `decomposeTask(taskId)` server action, and renders the proposed 2-5 children with per-row title/description/column editing plus a checkbox. User clicks "Create N sub-tasks" to insert; cancel does nothing.
- `decomposeTask` runs a Gemini 3 Flash call with the Bash work / Claude work / Boss Check classification rubric (mechanical vs judgment vs draft-and-approve). Returns proposals; does not insert. `createDecomposedChildren` is a separate action that does the actual insert with `parent_id` set on each row.
- Child `source_id` follows `{parent.source_id ?? parent.id}/{kebab-slug}` so the parent-child relationship is visible at a glance, e.g. `PMP-65/draft-pricing-tiers` or `<uuid>/check-calendar`.
- `TaskDialog` shows a faded `↑ parent: <title>` line above the title when the task being viewed is a child. Fetched lazily via `getParentSummary(parentId)` server action.
- Rubric verified on three fixtures against dev: "ship the new pricing flow" → 4 children with sensible Bash/Claude/Boss Check split; "respond to Q3 marketing roundtable invite" → 3-stage check/draft/review; "fix the dashboard latency regression" → analysis (Claude) / decision (Bash) / draft PR (Boss Check). No prompt iteration needed.

**Possible R3 stretch items not pulled in** (deferred to a future round):
- Connector retry / backoff for transient 429s and 5xxs.
- Per-task "remind me" timers backed by Vercel Cron + a `due_date`-driven trigger.

---

## R3.5 — UX redesign + custom columns + owner — ✅ Complete (2026-05-19)

A design + refactor pass between R3 and R4. Reshapes the surface, the schema, and the agent interaction model. Ten deliverables, pre-decided scope, no feature creep.

### Schema

- **`tasks.status` is gone.** Replaced by a user-managed `public.columns` table (`id`, `user_id`, `name`, `position`, `icon`, `accent_color`, `is_default`) and `tasks.column_id uuid not null references columns(id)`. Five starter columns are seeded per user: Inbox / Today / Active / Review / Done. Migrations: `20260519040000_r3_5_columns_and_owner.sql` (additive — new tables, new task columns), `20260519050000_r3_5_seed_columns_and_migrate_tasks.sql` (seed + back-fill), `20260519060000_r3_5_drop_status_column.sql` (destructive drop).
- **First-class owner.** `tasks.owner` is `'bash' | 'claude'`. The "Claude work" / "Bash work" split that R1 baked into `status` is gone; both kinds of work live in the Active column and the owner field disambiguates. Migration mapping: 'Bash work' → Active+bash, 'Claude work' → Active+claude, 'Boss Check' → Review+claude+needs_review=true.
- **New supporting tables**: `task_events` (timeline + audit), `recurrences` (recurring task templates, R3.5 schema only — UI ships in R3.5c), `agent_events` (external + internal activity feed), `pending_emails` (score-4-to-7 triage queue).
- **New task fields**: `owner`, `needs_review`, `tags text[]`, `snoozed_until`. `pending_emails` also has `snoozed_until`.

### Surfaces

- **Homepage at `/`.** `/board` is now a redirect. The three-panel layout: left = brief + timeline (22% width), middle = board (56%), right = agent activity + context (22%). 40px header on top, 40px command bar on bottom.
- **Brief panel is deterministic.** No LLM call. Attention bars (calendar imminent / overdue tasks / urgent emails / needs review / emails to triage / unsnoozed items) fire only when their triggers fire. Day-update card shows next calendar event + "N on plate · M urgent · K in inbox" stats. Replaces the R2.5 `BriefDrawer`. The `public.briefs` table stays in place but the cron no longer writes to it.
- **Timeline panel.** Vertical time-axis from 9:00 to 21:00 (auto-extends). Renders calendar events + task events (created / moved / completed / deleted) from `public.task_events`.
- **Custom columns.** "+ add column" inline form at the end of the row, column header "..." menu for rename / accent color / delete (delete prompts for a destination column when tasks would be orphaned). Drag-and-drop reorders columns. Cards have an owner icon (Bashir = user, Claude = bolt, plus 5% purple bg tint on claude-owned cards) and up to 2 tag chips.
- **Command bar.** Persistent at the bottom, 40px tall, ⌘K focus. Prefixes `task:` / `add:` / `capture:` / `todo:` short-circuit to a direct Inbox insert (no LLM). Other input streams chat through `/api/chat` into a popover above the bar. Drawer chat is deleted.
- **Right-panel agent activity feed.** Reads `public.agent_events`, refreshes every 30s. Click a row to expand its payload. External callers POST to `/api/agent-events` with `Authorization: Bearer $AGENT_EVENTS_TOKEN`.
- **Email triage modal.** R3a's binary admit/drop becomes a 3-tier route: score 8-10 auto-task to Inbox (existing path, narrower band), score 4-7 → `public.pending_emails`, score < 4 drops. TriageModal lists pending rows with Make-task / Dismiss / Snooze / Open-in-Gmail actions (arrow keys + T/D/S/O hotkeys).
- **Snooze + unsnooze.** `tasks.snoozed_until` and `pending_emails.snoozed_until` hide rows from views. Nightly cron `/api/cron/unsnooze` at 20:05 UTC (00:05 Dubai) clears expired snoozes.
- **Visual language.** Dark-only. Background `#0a0a0c`, panel `#141418`, card `#1a1a1f`. Accent `#5e8aff` (active/selected, not urgency). Urgent `#e24b4a`, amber `#f5a23a`, success `#5fc96b`. Owner tints: bash gray, claude muted purple. Tight padding (8px panel / 6px card), 11-13px type, two font weights. No glow, no gradients, no glass.

### Deferred to R3.5c (small follow-up round)

The original R3.5 spec listed three smaller items that didn't ship in this pass and roll into R3.5c:

- **Filter & sort controls** in the board header — source / owner / tag dropdowns plus an in-column sort selector. Filter state persisted to localStorage per user.
- **Recurring tasks UI.** Schema for `public.recurrences` shipped; the TaskDialog repeats picker and the hourly `/api/cron/recurrences` route did not.
- **Right-panel chat history** — a "show chat history" affordance in the context section that loads recent `chat_messages`.

Nothing about R3.5 blocks these; they were trimmed for scope.

---

## R3.6 — Bootstrap lifeofbash substrate — 🔜 Planned, not started

The substrate split. Before R4 builds an execution layer, lifeofbash gets created as its own repo — Bashir's personal-operating-system folder, the long-lived markdown store of life data (people, projects, routines, playbooks, memory, decisions, inbox). bash-os (this repo) is the web *view* onto that substrate; the R4 daemon will be one *executor*. The substrate lives outside this repo so it outlives any specific view or executor.

- *Where it lives:* `lebashir/lifeofbash` (private), cloned to `~/lifeofbash/`. Personal GitHub, not Tabby — portable across employers.
- *What ships in R3.6:* folder skeleton + root CLAUDE.md + README + per-folder CLAUDE.md files + templates (people, projects, routines, playbooks) + memory stubs (`style.md`, `task-patterns.md`, `decisions.md`) + `.gitignore` + `docs/cc-prompts/` archive convention inherited from this repo.
- *What does NOT ship in R3.6:* real content (no real people, no real project entries, no memory entries). Real content lands in subsequent CC sessions inside lifeofbash with Bashir curating. R3.6 is the empty house — every room framed, no furniture.
- *Daemon, MCP server, sync scripts:* deferred. R3.6 leaves room for them (the `tools/` folder + its CLAUDE.md describe the daemon's eventual home at `~/lifeofbash/tools/daemon/`) but the bootstrap doesn't build them.
- *Prompt:* `docs/cc-prompts/r3-6-bootstrap-lifeofbash.md` (this repo). Self-contained, runnable. Once executed inside the new lifeofbash repo, future planning for the substrate moves into lifeofbash's own `docs/cc-prompts/`. From R3.6 onward, planning for the substrate happens in lifeofbash; planning for the web view happens here.

---

## Pillar 3 (lifeofbash connection) — ingestion moved local — ✅ Complete (2026-05-26)

Not a numbered round — the bash-os side of the lifeofbash "connection epic." The decision (Architecture 2): lifeofbash holds the filtering taste/standards and runs ingestion locally; bash-os becomes a thin view + store. This round's bash-os-side work:

- *In-app sync removed.* The entire in-app connector engine — `email-importance` scorer, the gmail/calendar/slack/jira sync libs, the `syncAll` orchestrator, the `syncGmail`/`syncCalendar` shims, and the `/api/cron/daily-brief` morning cron — was deleted. It was already orphaned (SyncButton went in R3.5; the cron was removed in Slice A; nothing in the UI called the server actions). Gmail + Calendar are now scored and pushed in by external lifeofbash local jobs over PostgREST.
- *Triage moved to `staged_emails` (Slice A + B).* New `staged_emails` table carries the scorer's full guess (band/reason/title/tags + `decision`). `TriageModal` retargeted from the dropped `pending_emails` to it, with **soft-delete**: promote/dismiss/snooze stamp `decision`/`snoozed_until` so the verdict survives. `task_events.task_id` became `ON DELETE SET NULL` and the delete handlers stamp `source`/`source_id`, so a deleted ADMIT task is captured as an "over-admit" signal. A lifeofbash `sync-decisions` job reads these verdicts back into a committed `decisions.jsonl` training log.
- *Migrations:* `20260526120000` (staged_emails), `20260526130000` (FK SET NULL + snooze), `20260526140000` (drop `pending_emails`). The only remaining cron is `/api/cron/unsnooze`.
- *Kept:* the Google connect/status UI (`connectors.ts`, `connector-status.ts`, the account pills) — though it no longer feeds any sync (lifeofbash uses its own local credentials), so it's a candidate for a later trim.

---

## R4 — Local Claude Code daemon executes Claude-owned tasks — 🔜 Planned, not started

- *Why it matters:* R3.5 made `owner='claude'` a first-class field but nothing happens automatically when a task is assigned to Claude. R4 turns that field into a real execution trigger — Bashir marks a task `owner='claude'`, the daemon picks it up, Claude Code runs the task in the right working directory, the output lands in Review for Bashir to approve.
- *Rough shape:* the executor is a long-running daemon on Bashir's laptop, living inside the lifeofbash substrate at `~/lifeofbash/tools/daemon/` (not a separate repo — substrate carries its own automation so a single `git clone` brings everything across laptops). It polls the bash-os API every 30s for `owner='claude'` tasks in pickable state, resolves each task's working directory via the substrate (tag → project reference file → `working_dir`), launches Claude Code headless there with a task-derived prompt and the bash-os MCP server configured. The CC session posts progress events to `/api/agent-events` as work happens. On successful exit the daemon moves the task to Review with `needs_review=true`, populates `tasks.output`, and writes an archive note back into the relevant `~/lifeofbash/projects/.../archive/` folder. Bashir's "Approve" → Done; "Reject with feedback" → back to Active with the feedback appended.
- *Out of scope:* self-selection (R5), autonomous task creation (R6), autonomous decomposition (R7), continuous mode (R8).
- *Cross-cutting constraint:* R4 has to bake in the five design considerations from `docs/ARCHITECTURE.md` → "Autonomous agent loop architecture (planned)" — trust boundary (`requires_review`), cost budgets, decision auditability, stop conditions, review-queue backpressure. Even though R4 only implements the daemon execution slice, the slice has to respect them so R5-R8 can layer on without retrofitting.
- *Prompt:* see `docs/cc-prompts/r4-pattern-b-daemon.md` (DRAFT — flesh out with Bashir before running).

---

## R5 — Claude self-evaluates the Inbox — 🔮 Sketched

- *Why it matters:* R4 still requires Bashir to manually mark `owner='claude'` on each task he wants delegated. R5 lets Claude pick on its own from the Inbox, against a policy file Bashir maintains.
- *Rough shape:* the daemon extends beyond `owner='claude'` to scanning the Inbox column. For each Inbox item it runs an LLM judgment call ("should I take this?") against a per-project `claude_policy.yaml` defining rules like "research = always, outreach = never, code edits to Doxi = yes, edits to bash-os = never". On yes: set `owner='claude'`, move to Today, proceed like R4. On no: leave the task for Bashir. Captures the decision in a new `tasks.decision_reason text` column (migration lands when R5 starts).

---

## R6 — Claude adds tasks autonomously — 🔮 Sketched

- *Why it matters:* During execution Claude often surfaces a follow-up that's its own piece of work. Today it can only mention the follow-up in its output for Bashir to manually capture. R6 lets Claude call the existing `createTask` path on its own, with a captured `decision_reason`.
- *Rough shape:* mid-execution, when Claude identifies a separate piece of work, it calls the same `createTask` server action the chat command bar uses. New rows get an "added by claude" marker (could reuse `owner='claude'` + the `decision_reason` from R5) and inherit the parent's tags + project. Same trust rules — irreversible follow-ups (`requires_review=true`) are routed to Review on creation, not on completion.
- *Prerequisite:* the AI Gateway swap (`docs/KNOWN_ISSUES.md` #2) should land before R6 so per-token cost dashboards exist for cost-budget enforcement. R4 starts that pressure; R6 makes it mandatory.

---

## R7 — Claude decomposes autonomously — 🔮 Sketched

- *Why it matters:* R3b's "Break it down" tool is human-triggered. R7 lets Claude call decompose on itself when a task feels too big mid-execution, following the same propose-then-confirm contract.
- *Rough shape:* the existing `decomposeTask` path runs unchanged; the new piece is the daemon deciding when to invoke it. Children land with `parent_id` set and follow the same trust + budget rules as any Claude-created task. Tree depth capped at R3b's two-level limit unless R7 explicitly lifts it (decision deferred to when R7 starts).

---

## R8 — Continuous autonomous loop with human checkpoints — 🔮 Sketched

- *Why it matters:* R4-R7 are episodic — daemon picks one task, finishes, picks the next. R8 weaves them into a continuous mode where the daemon stays warm, Claude works concurrently with Bashir, both add/move/complete tasks, Bashir reviews periodically.
- *Rough shape:* "quiet mode" / "active mode" toggles on the daemon. Quiet = polling stops, the queue accumulates, no new starts; active = warm worker pool, multiple tasks in flight, brief panel surfaces in-flight counts. Personal-life domains (bills, anniversaries, registrations, car renewals) fall out naturally from R8 + R3.5c's recurring tasks — the daemon picks recurring-task instances the same way it picks any other Claude-owned task. **Not a separate round.**

---

## Permanently dropped

- **ClickUp connector.** Bash OS *replaces* ClickUp for Bashir's personal use. Building a connector for the tool you're moving away from is self-defeating. Never building this. If you see a future-me prompt that says "let's add ClickUp", stop and re-read this section.
