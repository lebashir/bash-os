# Overnight log — 2026-05-19 → 2026-05-20

Running log of decisions, failures, and "for morning-me" notes. Append-only during the session. OVERNIGHT_REPORT.md is the polished summary at the end.

## R3a — shipped (commit 14367fd)

- Migration `20260519020000_r3a_tasks_importance.sql` applied to dev (xuqpifhojipuzqrowadt) then prod (vbooingflkmzxcqnbvxr). Single column add: `tasks.importance smallint null`. No constraint — threshold is an app-code knob.
- Scoring rubric validated against five fixtures in one round (no iteration needed): personal action 10, calendar invite 8, newsletter 4, marketing 1, CC chain 4.
- One nuance worth flagging: scoring uses `generateObject` with a Zod schema, not free-text + parse. The AI SDK v6 `generateObject` API is the right shape here but means a schema mismatch returns an error rather than partial JSON, which is why failures are caught and default to score=5 ("admit on failure" semantics). The cost is ~1 second per message — for the 20-message Gmail cap, ~20s of latency added to a sync. Acceptable since sync is manual + nightly.
- Test approach: a one-off `scripts/test-importance.mts` exercised the scorer directly with hard-coded fixtures rather than going through the OAuth → Gmail dance. Cleaner and didn't require a live Gmail inbox. Removed the script before commit.
- `show_filtered=1` path is wired but only smoke-tested via curl (200 → 307 redirect when unauthenticated). Not exercised against a real Gmail account; if it misbehaves in the morning, the failure mode is "duplicate filtered rows on the board" — not destructive, just messy.

## R3b — shipped (commit c50ec6c)

- Migration `20260519030000_r3b_tasks_parent_id.sql` applied to dev (xuqpifhojipuzqrowadt) then prod (vbooingflkmzxcqnbvxr). Adds `parent_id uuid` with self-FK and ON DELETE CASCADE, plus a partial index where parent_id is non-null.
- Decomposition rubric tested against three fixtures: "ship the new pricing flow" → 4 children with Bash/Claude/Boss Check split; "respond to Q3 marketing roundtable invite" → 3 children (check calendar / draft / review); "fix the dashboard latency regression" → 3 children (log analysis Claude / strategy Bash / draft PR Boss Check). Classifications were sensible across all three — no prompt iteration needed.
- UI: hover-revealed `Split` icon on TaskCard top-right, hidden when `parent_id` is set (R3b two-level constraint). Click opens DecomposeDialog with loading state → editable proposed children → "Create N sub-tasks" button. TaskDialog shows a faded `↑ parent: <title>` line when viewing a child.
- One nuance: the decompose button click handler stops both `onMouseDown` and `onPointerDown` because @dnd-kit's PointerSensor listens on the latter. Without that, clicking the button initiates a drag on the card.
- Children render as normal cards on the board with no nesting UI — the parent_id relationship is purely queryable (via SQL or the TaskDialog parent line). Deliberately simple for R3b; nesting UI would expand scope.
- Not exercised end-to-end through the browser (would require OAuth + a real task to click on). The server actions, typecheck, and Gemini call all pass; the UI components compile cleanly. Morning verification: open chat, send a message, then go to /board, click Break it down on a vague task, see what comes back.

## R5b — skipped, AI_GATEWAY_API_KEY not set

- `.env.local` does not contain `AI_GATEWAY_API_KEY`. Per spec, R5b is skipped and morning-me needs to:
  1. Vercel dashboard → AI → Keys → create a key, copy it.
  2. Add it to `.env.local` and `vercel env add AI_GATEWAY_API_KEY production`.
  3. Change `CHAT_MODEL_ID` in `src/lib/gemini/client.ts` from `gemini-3-flash-preview` to `google/gemini-3-flash`.
  4. Smoke test chat + cron brief locally and in prod, then commit `feat: R5b AI Gateway swap`.
- The chat and brief still route through the direct Google Generative Language API on `gemini-3-flash-preview` — same as before this session.

