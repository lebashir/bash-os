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

- **The 7 status values in `tasks.status` are CHECK-constrained.** Changing them requires a migration. Exact current values, verbatim:
  ```
  things to think about
  on the menu
  todays plate
  Bash work
  Claude work
  Boss Check
  DIgested.
  ```
- **All DB access goes through Supabase clients in `src/lib/supabase`.** Server: `createClient()` (cookie-bound auth) or `createAdminClient()` (service-role, server-only routes). No direct `pg`, no raw `fetch` to the REST API.
- **RLS gates everything on `auth.uid() = user_id`.** Don't introduce a code path that uses the service-role key for user-data reads in a user-facing surface. Service-role is for cron and admin paths only.
- **Local Supabase via Docker is BROKEN on the Tabby work network** (corporate TLS interception). Dev runs against cloud Supabase directly. Don't suggest "spin up local supabase" as a debugging step.
- **OAuth refresh tokens must not leak.** No logging of `connector_tokens` rows, no echoing tokens into error messages, no client-side exposure. They live in DB columns (plaintext, RLS-protected, see ARCHITECTURE.md) and must stay there.
- **Next 16 middleware lives in `proxy.ts`**, not `middleware.ts`. Next 16 renamed the convention.

## Conventions

- TypeScript strict. Prefer `unknown` + narrowing over `any`.
- Server actions live next to the page that uses them (`src/app/<route>/actions.ts`), or split when a single file gets large (e.g. `chat-actions.ts`, `sync-all.ts`).
- API route handlers under `src/app/api/<name>/route.ts`. The chat streaming route is at `/api/chat`.
- shadcn/ui components in `src/components/ui/`; feature-specific in `src/components/board/`.
- Tailwind utility classes inline; no custom CSS beyond shadcn-generated globals.
- Toasts via `sonner`, not the deprecated shadcn `toast`.

## Current round

R1 (bootstrap kanban) and R2 (connectors + brief + chat + memory + streaming) are complete. Next planned is R3 (email importance filtering + decomposition). See `docs/ROUNDS.md` for the active plan — if a session starts and there's no explicit ask, that file is the answer to "what's next".
