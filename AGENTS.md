<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Bash OS — agent orientation

A personal life-OS web app: kanban board + connectors + chat assistant + memory layer. Single user (Bashir). Repo lives at `github.com/lebashir/bash-os`, deploys to `bash-os.vercel.app`.

## Read these first before doing anything substantive

- `README.md` — current stack, feature map, env vars, deploy flow.
- `docs/ROUNDS.md` — what's shipped vs planned, round-by-round. Current round status at the bottom.
- `docs/ARCHITECTURE.md` — non-obvious decisions (token storage truth, RAG flow, the Tabby TLS workaround, etc.).
- `docs/KNOWN_ISSUES.md` — live wonkiness and "don't waste time on this" notes.

## Working norms

- **Solo developer.** No team, no PR review, no code review process. Don't write "the team should…" or suggest review steps.
- **Ship-first.** Don't refactor working code, don't modernize dependencies, don't pull work from later rounds without explicit ask. If you have a pitch, surface it as a question — don't just do it.
- **No tests, no CI, no Husky/Storybook/lint-staged.** Deliberate, not an oversight from R1+R2. Don't add them without an explicit ask.
- **No emojis** in code or docs unless explicitly requested.
- **Ask before non-trivial changes.** Especially: schema changes, dependency upgrades, refactors, new infrastructure.
- **Autonomy on routine state changes is pre-authorized.** `supabase db push`, `.env.local` edits, `git push`, `vercel env` updates, `gh` actions on this repo — just do them. Still pause on truly destructive moves (drop table/db, force-push main, deleting unmerged work, revoking OAuth creds, deleting emails).

## Hard rules (silent breakage if violated)

- **Columns are user-managed via the `public.columns` table.** Don't hardcode column names anywhere in app logic — query the table by id. Sync paths and chat tools resolve "well-known" columns (Inbox / Today / Active / Review / Done) via `resolveColumnId(supabase, userId, name)` in `src/lib/board/columns.ts`, which falls back to the user's lowest-position column if the named one doesn't exist.
- **Internal task mutations must insert a row into `public.task_events`.** Every code path that calls `tasks.insert / update / delete` (server actions, chat tools, sync paths, decomposition) writes a matching event so the timeline panel stays accurate.
- **All DB access goes through Supabase clients in `src/lib/supabase`.** Server: `createClient()` (cookie-bound auth) or `createAdminClient()` (service-role, server-only routes). No direct `pg`, no raw `fetch` to the REST API.
- **RLS gates everything on `auth.uid() = user_id`.** Don't introduce a code path that uses the service-role key for user-data reads in a user-facing surface. Service-role is for cron, admin, and the `/api/agent-events` ingestion endpoint only.
- **Local Supabase via Docker is BROKEN on the Tabby work network** (corporate TLS interception). Dev runs against cloud Supabase directly. Don't suggest "spin up local supabase" as a debugging step.
- **OAuth refresh tokens must not leak.** No logging of `connector_tokens` rows, no echoing tokens into error messages, no client-side exposure. They live in DB columns (plaintext, RLS-protected, see ARCHITECTURE.md) and must stay there.
- **Next 16 middleware lives in `proxy.ts`**, not `middleware.ts`. Next 16 renamed the convention.
- **There are two Supabase projects.** `.env.local` points at `bash-os-dev` (ref `xuqpifhojipuzqrowadt`) for local iteration. Vercel env vars point at `bash-os` (ref `vbooingflkmzxcqnbvxr`) for production. Never apply schema changes to prod before dev. Never iterate LLM prompts (chat system prompt, decomposition prompt) against prod. See `docs/ARCHITECTURE.md` → "Dev / prod Supabase split" for the `supabase link` / `supabase db push` workflow.
- **`public.briefs` exists but is unused by the cron.** R2.5 created it; R3.5 made the brief panel deterministic and stopped writing to it. The table stays in place for a possible future hybrid mode (LLM headline overlay). Don't read or write it from new code without an explicit ask.
- **`AGENT_EVENTS_TOKEN` is a project-wide shared secret.** Anything that POSTs to `/api/agent-events` needs it. Don't ship it client-side, don't log it. Generated separately for dev (`.env.local`) and prod (`vercel env`).

## Conventions

- TypeScript strict. Prefer `unknown` + narrowing over `any`.
- Server actions live next to the page that uses them (`src/app/<route>/actions.ts`), or split when a single file gets large (e.g. `chat-actions.ts`, `sync-all.ts`).
- API route handlers under `src/app/api/<name>/route.ts`. The chat streaming route is at `/api/chat`.
- shadcn/ui components in `src/components/ui/`; feature-specific in `src/components/board/` (legacy) and `src/components/home/` (R3.5 homepage layout).
- Tailwind utility classes inline; no custom CSS beyond shadcn-generated globals.
- Toasts via `sonner`, not the deprecated shadcn `toast`.

## Current round

R1, R2, R2.5, R3 (R3a + R3b), and R3.5 (UX redesign + custom columns + owner + command bar + agent activity + email triage) are complete. A small follow-up round **R3.5c** holds the trimmed items: board filter/sort, recurring tasks UI + cron, right-panel chat history. Next strategic round is R4 (autonomous Claude-owned tasks). See `docs/ROUNDS.md` for the active plan — if a session starts and there's no explicit ask, that file is the answer to "what's next".
