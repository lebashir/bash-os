# R3.5 — design + refactor pass

> **Reconstructed prompt.** This archive started after R3.5 shipped, so
> the text below was rebuilt from the commits and the docs it produced
> (see git log between `41ff880` "R3.5 phase 1 migrations" and
> `d1bdb9a` "R3.5 docs"). Verbatim fidelity not guaranteed, but the
> scope, the pre-decided design knobs, and the phase sequencing are
> all faithful — they're the same constraints the implementation
> respected.

This is R3.5 — the design + refactor pass. It changes how Bash OS LOOKS,
how the schema MODELS columns and ownership, and how the agent
INTERACTS with the user. Scope is strict and pre-decided. Do not expand
it.

Before you do anything, read AGENTS.md and the three docs it points at
(docs/ROUNDS.md, docs/ARCHITECTURE.md, docs/KNOWN_ISSUES.md). The hard
rules in AGENTS.md apply — especially the dev/prod Supabase split and
the "ask before non-trivial changes" rule (which is suspended only for
the pre-decided scope below).

## What you're building, exact

Ten deliverables:

1. **Schema: user-managed columns + owner field.** Replace the 7-status
   CHECK constraint with a `columns` table and `tasks.column_id` FK.
   Add `tasks.owner` enum. Migrate existing tasks. Seed 5 starter
   columns per user.
2. **New full-view homepage at `/`.** Three-panel layout + bottom
   command bar + header with connector pills. Replaces `/board` as the
   primary surface; `/board` redirects to `/`.
3. **Brief panel rebuild.** Pure deterministic (no LLM), with dynamic
   attention bars stacked on top and a persistent day-update body.
   Replaces the R2.5 brief drawer.
4. **Timeline panel.** Vertical time-axis calendar below the brief in
   the left panel. Shows calendar events + task events (created,
   completed, moved).
5. **Command bar at bottom of screen.** Chat moves out of the drawer
   into a persistent bottom bar with ⌘K shortcut. The six existing
   chat tools still work. Streaming response shows in a popover above
   the bar.
6. **Kanban: filter & sort, tags, recurring tasks, custom column
   management.** Filter/sort in board header. Tags as `tags text[]` on
   tasks. Recurring tasks via `public.recurrences`. Custom columns via
   inline add/rename/delete/reorder.
7. **Owner UX.** First-class `owner` field (`bash` | `claude`).
   Visible icon on every card. Subtle background tint on Claude-owned
   cards.
8. **Agent activity endpoint + right panel feed.** POST
   `/api/agent-events` authenticated by `AGENT_EVENTS_TOKEN`. Right
   panel top section renders the recent feed.
9. **Email triage as a modal.** R3a's auto-task-above-threshold
   changes: only score 8-10 emails auto-task. Score 4-7 go to a
   triage queue surfaced as a bar in the brief; clicking opens a
   modal. Below 4 still drops silently.
10. **Visual language pass.** Dark, dense, monochrome with subtle
    accent. Apply to every surface. No glow, no grid backgrounds, no
    cosplay branding.

Anything outside this list is out of scope. No R4 work (autonomous
execution). No tests. No CI. No new dependencies unless one of the
above genuinely requires it.

## Pre-made decisions (not relitigated)

**Schema additions:**
- `public.columns` (id, user_id, name, position, icon, accent_color,
  is_default). Unique on `(user_id, position)` (DEFERRABLE) and on
  `(user_id, name)`.
- `tasks.column_id uuid references columns(id) on delete restrict`.
- `tasks.owner text check (owner in ('bash', 'claude')) default 'bash'`.
- `tasks.needs_review bool default false`.
- `tasks.tags text[] default '{}'`.
- `tasks.snoozed_until timestamptz`.
- `public.recurrences` (template + cadence + next_fire_at + active).
- `public.agent_events` (source / project / action / target / payload /
  created_at).
- `public.task_events` (event_type in created/completed/moved/updated/
  deleted/importance_set + metadata jsonb).
- `public.pending_emails` (subject / sender / snippet / score +
  snoozed_until).

**Starter columns seeded per user, in order:**
1. Inbox — `ti-inbox`, `#7a7a80`, position 0
2. Today — `ti-target`, `#5e8aff`, position 1
3. Active — `ti-player-play`, `#5e8aff`, position 2
4. Review — `ti-eye`, `#f5a23a`, position 3
5. Done — `ti-check`, `#5a5a60`, position 4

**Migration mapping (one-shot, runs during the schema migration):**
- 'things to think about' → Inbox, owner = bash
- 'on the menu' → Inbox, owner = bash
- 'todays plate' → Today, owner = bash
- 'Bash work' → Active, owner = bash
- 'Claude work' → Active, owner = claude
- 'Boss Check' → Review, owner = claude, needs_review = true
- 'DIgested.' → Done, owner = bash

**Layout (full-view homepage at `/`):**
- Header (40px): logo + "bash os" lowercase + connector pills (gmail /
  calendar / jira / slack each with a 6px status dot) + account menu.
- Body: three panels — left 22% (brief on top + timeline below),
  middle 56% (board), right 22% (agent activity + context).
- Footer (40px): command bar.

**Visual language:**
- Dark-only. Background `#0a0a0c`, panel `#141418`, card `#1a1a1f`.
- Borders `#1f1f24` (subtle) / `#2a2a30` (visible).
- Text `#e5e5ea` / `#8a8a90` / `#5a5a60`.
- Accent `#5e8aff` (active/selected — NOT urgency).
- Semantic urgent `#e24b4a`, amber `#f5a23a`, success `#5fc96b`.
- Owner tints: bash `#8a8a90`, claude `#a584ff` + 5% bg overlay.
- Sentence case everywhere. Tight padding (8/6px). 11-13px type.

**Brief panel attention bars** (six triggers, priority order):
1. Calendar event ≤15 min — red — jump to event.
2. Overdue tasks — red — open modal.
3. Urgent unread emails (importance ≥ 9 on board) — red — filter
   board.
4. Tasks needing review (needs_review=true) — amber — filter to
   Review column.
5. Emails to triage (pending_emails count > 0) — amber — open
   TriageModal.
6. Items just unsnoozed (last 24h) — blue — open list.

**Command bar prefixes** (short-circuit, no LLM): `task:`, `add:`,
`capture:`, `todo:` → insert into Inbox with owner=bash.

**Email triage tiers** (R3a refinement):
- 8-10 → auto-task to Inbox, source='gmail', importance set.
- 4-7 → insert into pending_emails.
- <4 → drop (unless `?show_filtered=1` is set).

## Sequenced phases with checkpoints

10 phases. Each phase ends with a CHECKPOINT: commit, push, optionally
write a one-line status to `docs/OVERNIGHT_LOG.md` if running
unattended.

1. Schema + data migration (three migrations, applied dev → prod
   after explicit approval at Checkpoint 1).
2. Layout shell at `/` (three-panel + command bar placeholder,
   redirect `/board` → `/`).
3. Brief panel rebuild (deterministic `getBriefState` action +
   `<BriefPanel />` client).
4. Timeline panel (`task_events` writer threads through every
   mutating server action; `getTimelineEvents` reader).
5. Kanban refactor (column actions + `<BoardPanel />` with drag-and-
   drop within and between columns + column CRUD + reorder + tags +
   filter/sort + recurring).
6. Owner UX (icon + tint + dialog field + chat tool arg + prompt
   update).
7. Command bar (persistent bar + ⌘K + prefix short-circuit + chat
   popover; delete the chat drawer).
8. Agent activity (POST `/api/agent-events` + right-panel feed +
   internal event writes from cron + chat + sync paths +
   `AGENT_EVENTS_TOKEN`).
9. Email triage modal + snooze + nightly unsnooze cron.
10. Visual sweep + docs (palette across every surface; ROUNDS.md
    R3.5 section; ARCHITECTURE.md new sections; KNOWN_ISSUES.md
    cleanup; AGENTS.md hard rules updated; README.md rewrite of
    architecture overview).

## Autonomous decision rules (overnight if applicable)

- `bash-os-dev` for iteration; prod only at checkpoint moments after
  dev verification.
- If a phase fails twice in a row, log + skip (if independent) or
  stop (if dependent).
- One commit per phase minimum (Phase 1 may need multiple).
- No prod migration without a verified dev migration.
- No scope expansion. Log adjacent ideas to OVERNIGHT_LOG.md.

## Final checkpoint

At the end: write `docs/OVERNIGHT_REPORT.md` (one-shot, delete after
reading) capturing phases completed vs blocked, migration counts,
prompt iteration notes, and the first thing to verify in the morning.
Stop. Do not start R4.
