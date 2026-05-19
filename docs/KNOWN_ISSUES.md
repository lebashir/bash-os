# Known issues

Live wonkiness, deferred fixes, and "don't waste time on this" notes. Short and blunt on purpose. Add a line; don't pad.

---

## 1. Chat model pinned to `gemini-3-flash-preview`

- **Where:** `src/lib/gemini/client.ts` → `CHAT_MODEL_ID`
- **Why:** Vercel AI Gateway exposes plain `google/gemini-3-flash` (non-preview), but the direct Google Generative Language API only ships the preview alias at our current access tier. We're on the direct API right now.
- **Status:** verified working on production. Initial verification went through the cron endpoint (`6375b6f`, daily-brief route returned the brief with no error on 2026-05-19). As of 2026-05-19 the chat path is also verified live through the R3.5 command bar — Bashir exercised it at user level on `bash-os.vercel.app` after the R3.5 deploy.
- **Fix path:** when AI Gateway is wired up (see #2), change the model string to `'google/gemini-3-flash'` (no SDK change beyond that).

## 2. AI Gateway swap — do before R6

- One-line model-string change in `src/lib/gemini/client.ts` would route through Vercel AI Gateway. Unlocks observability, multi-provider routing, and the non-preview Gemini 3 Flash ID.
- Bashir explicitly deferred this on 2026-05-19 ("too late for that tonight"). Picking it back up requires creating `AI_GATEWAY_API_KEY` in the Vercel dashboard.
- Per-token cost is identical — Gateway BYOK uses your existing Google key, no markup. Not a cost question.
- **Bumped from "deferred" to "do before R6":** R4-R8 introduce autonomous task execution by a local Claude Code daemon. Cost-budget enforcement (one of the design considerations in `docs/ARCHITECTURE.md` → "Autonomous agent loop architecture (planned)") needs per-model cost dashboards, which the Gateway provides. R6 is when autonomous task *creation* lands — that's the latest the Gateway should be in place.

## 3. OAuth refresh tokens are stored in plaintext columns

- `connector_tokens.access_token` and `connector_tokens.refresh_token` are plain `text`. Protection is RLS row-level + Supabase's disk-level encryption-at-rest.
- Anything with the service-role key reads them in cleartext. For a single-user personal tool this is acceptable.
- If Bash OS ever goes multi-user, this needs Supabase Vault or pgcrypto with a project secret.

## 4. Slack connector blocked at install time

- Code shipped at `src/lib/board/slack-sync.ts`. Silently no-ops when `SLACK_USER_TOKEN` is unset.
- Bashir can't create Slack apps at Tabby (not a workspace admin) and Slack killed legacy user PATs in 2020. There's no clean path to a working token.
- If admin status ever changes: create a workspace app with `im:history`, `im:read`, `users:read` user scopes, install to workspace, copy the `xoxp-…` user token into env. Connector activates with zero code change.

## 5. ClickUp permanently dropped

- Bash OS *replaces* ClickUp for Bashir's personal use. Don't build a connector for the tool we're moving off of.
- This is not a "todo later" — it's a "never". If a future round prompt says "let's add ClickUp", stop and re-read this entry.

## 6. Gmail importance threshold is hard-coded — RESOLVED in R3a, refined in R3.5

- R3a (2026-05-19) added per-message scoring with `IMPORTANCE_THRESHOLD = 4` for admit/drop.
- R3.5 (2026-05-19) split the admit band: 8-10 auto-task to Inbox, 4-7 → triage queue (`public.pending_emails`) surfaced as a brief attention bar + `TriageModal`. See `docs/ARCHITECTURE.md` → "Email triage flow".
- The `show_filtered=1` query param still re-runs sync without the floor for rubric debugging.

## 7. No connector rate-limit handling

- Gmail, Calendar, and Jira fetches go out without backoff. A 429 or 5xx surfaces as a sync error and the per-account `error` field. The user retries by hitting Sync again.
- Hasn't been a problem at single-user scale. Worth revisiting if the morning cron ever fans out across multiple users.

## 8. Tabby corporate TLS blocks local Supabase

- Local `supabase start` is functionally unusable on the Tabby network — see `docs/ARCHITECTURE.md` → "The Tabby network TLS issue".
- Cloud Supabase is the dev environment. Don't suggest local-stack debugging.

## 9. No tests, no CI

- Deliberate skip from R1 carried through R2. Single user, no team, ship-first.
- Not a debt entry — it's a design choice. Don't add Vitest/Playwright/Husky without an explicit ask.

## 10. Recurring tasks schema is live but the UI / cron isn't — R3.5c

- `public.recurrences` was created in R3.5 phase 1 but neither the TaskDialog `RepeatsPicker` nor the hourly `/api/cron/recurrences` route shipped in R3.5. Listed in `docs/ROUNDS.md` under "Deferred to R3.5c".
- Inserting a row directly into `public.recurrences` does nothing today — without the cron firing, `next_fire_at` is decorative. Don't rely on it.

## 11. Board filter / sort and chat-history right-panel — R3.5c

- Both listed in the original R3.5 spec; trimmed to ship R3.5 cleanly. Board renders all tasks unfiltered, in `position` order within each column. Right-panel context section shows a placeholder where the chat-history affordance was supposed to land.
- Pick up in R3.5c alongside recurring tasks.

## 12. "Remember" affordance dropped in R3.5 — regression

- The R2 chat drawer had a "Remember" button on each user message that called `commitToMemory(content, ['from-chat'])` (`src/app/board/memories.ts`). R3.5 deleted the drawer (`ChatLauncher.tsx`) and the command bar popover that replaced it never re-added the button.
- `commitToMemory` itself is intact — only the UI hook is missing. New memories can't be written from the UI today.
- Per-turn semantic retrieval (read path) is unaffected; it runs every chat turn regardless.
- **Pick up alongside R3.5c chat-history pane** (#11). Same surface: the right-panel context section is the natural home for both "show chat history" and "remember this message".

## 13. `public.briefs` is an orphaned table — deprecated-table cleanup candidate

- R2.5 created `public.briefs` to hold LLM-generated daily briefs (one row per user per day). R3.5 made the brief panel deterministic (reads live state every render) and stopped writing to the table from the morning cron.
- Today: no writer, no reader. The `listRecentBriefs()` action in `src/app/board/brief-actions.ts` is also orphaned (no caller).
- **Don't drop it.** ARCHITECTURE.md ("Briefs vs tasks" + "Brief panel architecture") notes the table is preserved for a possible future hybrid mode (LLM-generated headline overlaid on the deterministic panel). If that mode never lands, drop the table + the orphan action in a future cleanup migration.
