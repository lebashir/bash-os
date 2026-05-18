# Known issues

Live wonkiness, deferred fixes, and "don't waste time on this" notes. Short and blunt on purpose. Add a line; don't pad.

---

## 1. Chat model pinned to `gemini-3-flash-preview`

- **Where:** `src/lib/gemini/client.ts` → `CHAT_MODEL_ID`
- **Why:** Vercel AI Gateway exposes plain `google/gemini-3-flash` (non-preview), but the direct Google Generative Language API only ships the preview alias at our current access tier. We're on the direct API right now.
- **Status:** verified working on production via the cron endpoint (`6375b6f`, daily-brief route returned the brief with no error on 2026-05-19). Chat UI flow not yet visually verified by Bashir. (R2.5 renamed the response field from `briefTaskId` to `briefId` when briefs moved to their own table.)
- **Fix path:** when AI Gateway is wired up, change the model string to `'google/gemini-3-flash'` (no SDK change beyond that).

## 2. AI Gateway swap deferred

- One-line model-string change in `src/lib/gemini/client.ts` would route through Vercel AI Gateway. Unlocks observability, multi-provider routing, and the non-preview Gemini 3 Flash ID.
- Bashir explicitly deferred this on 2026-05-19 ("too late for that tonight"). Picking it back up requires creating `AI_GATEWAY_API_KEY` in the Vercel dashboard.
- Per-token cost is identical — Gateway BYOK uses your existing Google key, no markup. Not a cost question, just a "haven't done it yet" question.

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

## 6. Gmail importance threshold is hard-coded — RESOLVED in R3a

- Resolved by R3a (2026-05-19). Gmail sync now scores each unread message via Gemini 3 Flash and drops anything below `IMPORTANCE_THRESHOLD = 4`. See `docs/ARCHITECTURE.md` → "Email importance scoring".
- Tunable in code only — no UI knob yet. If the rubric over- or under-filters, edit the threshold in `src/lib/board/email-importance.ts` and/or the system prompt in the same file. `/board?show_filtered=1` re-runs sync without the filter for spot-checking.

## 7. No connector rate-limit handling

- Gmail, Calendar, and Jira fetches go out without backoff. A 429 or 5xx surfaces as a sync error and the per-account `error` field. The user retries by hitting Sync again.
- Hasn't been a problem at single-user scale. Worth revisiting if the morning cron ever fans out across multiple users.

## 8. Tabby corporate TLS blocks local Supabase

- Local `supabase start` is functionally unusable on the Tabby network — see `docs/ARCHITECTURE.md` → "The Tabby network TLS issue".
- Cloud Supabase is the dev environment. Don't suggest local-stack debugging.

## 9. No tests, no CI

- Deliberate skip from R1 carried through R2. Single user, no team, ship-first.
- Not a debt entry — it's a design choice. Don't add Vitest/Playwright/Husky without an explicit ask.
