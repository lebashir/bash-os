# Bash OS — project primer

A 1-page orientation for a new agent or a future-Bashir landing in
this repo cold. Read this first. README is the technical reference;
PROJECT is the "why does this exist and where am I."

## What Bash OS is

Bash OS is a shared work surface for **two actors: Bashir and his
local Claude agents.** Both can add tasks, move them between columns,
mark them done, and review each other's output. Some actions —
anything irreversible (send an email, push code, post to Slack,
make a purchase) — require Bashir's review before they ship,
gated by the Review column.

The long-term vision is a continuous autonomous loop: Claude operates
alongside Bashir, picking work matching a per-project policy,
executing in the background, surfacing output for human checkpoint
on the irreversible parts. Today only the surface (kanban + brief +
timeline + activity feed + command bar + chat) is shipped. The
execution loop is staged across R4-R8.

## Current round status

- **R1, R2, R2.5, R3 (R3a + R3b), R3.5** are complete.
- **R3.5c** holds the trimmed R3.5 follow-up: board filter/sort,
  recurring tasks UI + hourly cron, right-panel chat history pane
  (with the missing "Remember" button revived).
- **R4 — Local Claude Code daemon executes Claude-owned tasks.**
  Pattern B: the daemon runs on Bashir's laptop, polls bash-os,
  launches CC headless on each `owner='claude'` task, returns
  results to the Review column.
- **R5 — Claude self-evaluates the Inbox.** Daemon extends to
  scanning Inbox against a per-project `claude_policy.yaml`.
- **R6 — Claude adds tasks autonomously.** During execution, calls
  the existing `createTask` path with a `decision_reason`.
- **R7 — Claude decomposes autonomously.** Same pattern, calling
  decompose mid-execution when a task feels too big.
- **R8 — Continuous autonomous loop with human checkpoints.** All
  of R4-R7 woven together, quiet/active modes, personal-life
  domains fall out naturally with R3.5c's recurring tasks.

## Working pattern

- **Solo developer** (Bashir). No team, no PR review, no CI.
  Ship-first.
- **No tests** by deliberate choice. Don't add Vitest / Playwright /
  Husky without an explicit ask.
- **Dev / prod Supabase split.** `.env.local` points at
  `bash-os-dev` (ref `xuqpifhojipuzqrowadt`, Sydney). Vercel env
  vars point at `bash-os` (ref `vbooingflkmzxcqnbvxr`, Singapore).
  Migrations: dev first, prod second, after explicit approval.
- **All substantive implementation goes through Claude Code**,
  driven by prompts archived in `docs/cc-prompts/` — one file per
  round. Save the prompt before running it.

## Where to start

1. **`AGENTS.md`** — hard rules and working norms. Read it first
   every session.
2. **`docs/ROUNDS.md`** — what's shipped, what's planned (R4-R8 in
   detail at the bottom).
3. **`docs/ARCHITECTURE.md`** — non-obvious decisions. The
   **"Autonomous agent loop architecture (planned)"** section
   defines the five design considerations (trust boundary, cost
   budgets, decision auditability, stop conditions, review queue
   backpressure) that R4-R8 must respect.
4. **`docs/KNOWN_ISSUES.md`** — live wonkiness, deferred fixes,
   things tagged "don't waste time on this."
5. **`docs/cc-prompts/`** — prompts that built the current state
   and DRAFT prompts for upcoming rounds.
6. **`README.md`** — technical reference (stack, env vars,
   migrations, connectors, cron, deploy).
7. The codebase. Server actions live next to the page that uses
   them (`src/app/*/`); shared libs under `src/lib/`; UI under
   `src/components/home/` (R3.5 homepage) and
   `src/components/ui/` (shadcn primitives).

## Locations

- Production: <https://bash-os.vercel.app>
- Repo: <https://github.com/lebashir/bash-os>
