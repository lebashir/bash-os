# R3.5c — DRAFT — flesh out before running

The three items trimmed from the R3.5 spec when it shipped. Tracked in
`docs/KNOWN_ISSUES.md` (#10, #11, #12) and listed in `docs/ROUNDS.md`
under "Deferred to R3.5c".

## Scope

Three deliverables, pre-decided. No expansion.

1. **Filter & sort on the board header.**
   - Filter controls in `<BoardPanel />` header row:
     - Source dropdown: all / gmail / calendar / jira / manual.
     - Owner dropdown: all / bash / claude.
     - Tag pills: applied tags shown as removable chips.
   - Sort dropdown (in-column order): manual / priority / due date /
     created. Default manual (drag position).
   - Filters AND together. Persist filter + sort state in
     `localStorage` per user, keyed on user id.
   - Tags-by-typing still applies — no separate tag CRUD UI.

2. **Recurring tasks UI + cron.**
   - The schema (`public.recurrences` with `template_task_id`,
     `cadence`, `cron_expression`, `next_fire_at`, `last_fired_at`,
     `active`) shipped in R3.5 phase 1. Today it's decorative — no
     writer wires it up.
   - Add a `<RepeatsPicker />` to the TaskDialog. Cadence options:
     none / daily / weekly / monthly / annually. Picking a non-none
     value upserts into `public.recurrences` on save.
   - Add `/api/cron/recurrences` route. Hourly cron (`vercel.json`
     `0 * * * *`). Pulls active recurrences where `next_fire_at <=
     now()`, materializes a new task from the template, bumps
     `next_fire_at` per the cadence.
   - Inherit owner + priority + tags from the template. Land the new
     task in Inbox by default (template column may be Done if the
     template was completed earlier; don't re-create into Done).

3. **Right-panel chat history pane.**
   - The right panel's "context" section (below agent activity) is
     currently a placeholder. Replace with a "show chat history"
     affordance.
   - Loads the last 20 chat_messages via `listChatUIMessages()` (the
     existing helper in `src/app/board/command-actions.ts`).
   - Renders messages with role label + timestamp. No scroll-to-load
     for older history — 20 is fine.
   - **Bonus: bring back the "Remember" button** (KNOWN_ISSUES #12 —
     `commitToMemory` exists but no UI calls it). One Remember button
     per user message in the history pane. Calls `commitToMemory(
     content, ['from-chat'])`.

## Constraints

- Iterate against `bash-os-dev`. Apply any schema-touching work to dev
  first; prod only after explicit approval. Recurring tasks don't
  need schema changes — recurrences is already shipped.
- No scope expansion. If you think of an adjacent improvement
  (notifications, multi-instance recurrence rules, advanced sort
  modes), surface it as a question and add to `docs/KNOWN_ISSUES.md`
  if accepted.
- Ship-first: no tests, no CI, no new dependencies unless a deliverable
  genuinely requires one (none should).
- Visual language: dark, dense, monochrome. Reuse the R3.5 palette
  tokens (see `src/app/globals.css`).
- Maintain the hard rules in AGENTS.md, especially the
  task_events-on-mutation rule (recurring tasks creating a new row
  must insert a `task_events` 'created' row tagged `source='recurrence'`).

## Definition of done

- Filters + sort actually filter and sort the board, state survives a
  refresh, controls don't show up in the keyboard tab order in a way
  that breaks ⌘K command-bar focus.
- Recurring task: pick "daily" on a new task in dev → curl the
  hourly cron endpoint manually with `CRON_SECRET` → a new task
  appears in Inbox with the same title + tags + owner.
- Chat history pane: open right panel context, see last N chat
  messages, click "Remember" on one user message, confirm the row
  lands in `public.memories`.
- AGENTS.md, ARCHITECTURE.md, KNOWN_ISSUES.md updated (clear #10,
  #11, #12).
