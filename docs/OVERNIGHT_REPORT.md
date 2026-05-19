# R3.5 overnight report — 2026-05-19

One-shot. Delete this file after reading.

## Phases

| # | Phase | Status |
|---|---|---|
| 1 | Schema + data migration | ✅ |
| 2 | Layout shell at `/` | ✅ |
| 3 | Brief panel rebuild | ✅ |
| 4 | Timeline panel | ✅ |
| 5 | Custom columns + kanban features | ✅ partial — see 5c below |
| 6 | Owner UX | ✅ (folded into 5) |
| 7 | Command bar | ✅ |
| 8 | Agent activity endpoint + feed | ✅ |
| 9 | Email triage + snooze | ✅ |
| 10 | Visual sweep + docs | ✅ |
| 5c | Filter & sort, recurring tasks UI + cron, right-panel chat history | ⏸ deferred — listed in `docs/KNOWN_ISSUES.md` + `docs/ROUNDS.md` |

## Schema migration verification

Applied to **dev** (`bash-os-dev`, ref `xuqpifhojipuzqrowadt`) and **prod** (`bash-os`, ref `vbooingflkmzxcqnbvxr`) on 2026-05-19. Approved at Checkpoint 1.

### Dev (17 tasks)
- by column: Active=12, Today=5
- by owner: bash=17
- needs_review=true: 0
- null column_id: 0
- `tasks.status` column: confirmed dropped

### Prod (23 tasks)
- by column: Inbox=5, Today=6, Active=12
- by owner: bash=23
- needs_review=true: 0
- null column_id: 0
- `tasks.status` column: confirmed dropped

Both projects had no `Claude work` or `Boss Check` rows at migration time, so the (owner='claude') and (needs_review=true) mappings stayed dormant — but the SQL covers them. Five starter columns (Inbox / Today / Active / Review / Done) seeded for the user on each project with the exact icons + accent colors from the spec.

## Synthetic data on dev

During Phase 3 brief-panel verification I inserted five test rows on `bash-os-dev` to exercise the attention bars:

- 1 calendar event due in 10 min (source_id `r35-test-calendar-imminent`)
- 1 overdue task (source_id `r35-test-overdue`)
- 1 urgent gmail task with `importance=10` (source_id `r35-test-urgent-email`)
- 1 needs_review task with `owner='claude'` (source_id `r35-test-needs-review`)
- 1 pending_emails row (`gmail_message_id` = `r35-test-pending-1`)

Safe to leave in place for ongoing UI verification. To remove:

```sql
delete from public.tasks where source_id like 'r35-test-%';
delete from public.pending_emails where gmail_message_id like 'r35-test-%';
```

## Prompt iteration

None. R3.5 only touches one LLM call — the decomposition prompt in `src/app/board/decompose-actions.ts` — and the change was structural (the LLM still classifies into "Bash work" / "Claude work" / "Boss Check" kinds; app code maps each to a (column_id, owner, needs_review) tuple at insert time). The R3a importance scorer's prompt and rubric are unchanged.

## Tokens

- `AGENT_EVENTS_TOKEN` generated for both environments:
  - dev: written to `.env.local`
  - prod: set via `vercel env add AGENT_EVENTS_TOKEN production`
- Endpoint smoke-tested against dev: 401 on missing/bad bearer, 200 + persisted DB row on valid call.

## Crons

- `/api/cron/daily-brief` (existing) — 05:30 UTC. Now only syncs Gmail + Calendar and writes an `agent_events` "morning sync" row per user. Brief generation removed (deterministic panel).
- `/api/cron/unsnooze` (new) — 20:05 UTC. Clears expired `snoozed_until` on tasks + pending_emails.

Both are declared in `vercel.json`. Both verify `Authorization: Bearer $CRON_SECRET`.

## First thing to verify in the morning

1. Open `https://bash-os.vercel.app/`. The three-panel + command bar shell should render. Header shows connector pills + account menu.
2. Drag a card between columns. The timeline panel should pick up a "moved" entry for it.
3. Add a column via the "+" at the end of the row. Rename it. Delete it (prompted for destination).
4. Type `task: pick up dry cleaning` in the command bar. Should land in Inbox without an LLM call.
5. Type `what's on my plate today?` in the command bar. Should stream a response in the popover above the bar.
6. Right-panel feed should show today's `chat`-source events from step 5.
7. Trigger the morning cron manually if you want to confirm: `curl -H "Authorization: Bearer $CRON_SECRET" https://bash-os.vercel.app/api/cron/daily-brief`. The right-panel feed should then show a `cron / morning sync` event.

## What's NOT shipped that the original spec listed

- Filter & sort controls on the board header (+ localStorage persistence)
- Recurring tasks: `RepeatsPicker` in TaskDialog and the hourly `/api/cron/recurrences` route (the `public.recurrences` schema *did* ship)
- "Show chat history" affordance in the right-panel context section

Tag picker on the TaskDialog *did* ship (with chip display on cards).

All deferred items are tracked in `docs/KNOWN_ISSUES.md` and `docs/ROUNDS.md` under the **R3.5c** sub-round.

## Stop

R4 is not started. Per the spec.
