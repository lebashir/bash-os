# R4 — DRAFT — flesh out with Bashir before running

R4 makes Claude-owned tasks actually execute. R3.5 gave us
`tasks.owner='claude'` as a first-class field, the agent activity
feed, and a Review column with `needs_review=true`. R4 wires up the
execution path.

**This is Pattern B from tonight's planning conversation:** the
executor is a local Claude Code daemon on Bashir's laptop, not a
Vercel agent or remote worker. Vercel is the surface and the source
of truth; the local daemon is the executor.

## Architecture in one paragraph

A long-running daemon process on Bashir's laptop polls the Bash OS
API every 30s for tasks where `owner='claude'` AND the task is in a
"pickable" state (Today or Active column, not snoozed, not already
running). For each pick, the daemon launches Claude Code headless
with a task-derived prompt; the CC session writes hooks back to
`/api/agent-events` as it works. On successful exit, the daemon
moves the task to Review with `needs_review=true` and populates a
new `tasks.output` field. Bashir's Review approval → Done. Rejection
→ back to Active with feedback as a comment.

## What R4 explicitly includes

- New env: `CLAUDE_DAEMON_API_KEY` (separate from `AGENT_EVENTS_TOKEN`
  — daemon needs to pick + mutate tasks, not just write events).
- New endpoint (or sub-endpoints): the daemon needs to query "what
  should I pick next?" and "I'm done, here's the output." The exact
  shape is a design decision — could be a single `/api/claude-queue`
  with GET (poll) / POST (claim) / PATCH (complete) verbs, or
  separate routes. Sketch it in the prompt before running.
- `tasks.output text null` migration. Markdown-friendly. Rendered in
  the Review card with `whitespace-pre-wrap`.
- "Claim" semantics: the daemon picks a task and sets a runtime flag
  so a second daemon (or a duplicate poll) doesn't double-pick.
  Suggestion: add `tasks.claimed_at timestamptz null` (clears on
  success/failure) rather than a global lock.
- Daemon spec: a small Node or Bun script in a NEW repo (not
  bash-os) — let's call it `bash-os-daemon`. The daemon reads env
  vars for API base URL + token + user id + Claude Code path. It's
  the same trust boundary as a CC hook.
- Review UI: in the Review column, a card with non-null
  `tasks.output` shows the output inline and exposes "Approve" /
  "Reject with feedback" buttons.
- Approve action: move to Done (resolve "Done" column id; clear
  needs_review).
- Reject action: prompt for feedback text; move back to Active with
  a description appended ("--- Bashir feedback ---" header + text).

## What R4 explicitly excludes

- **No self-selection.** R4 only executes tasks where Bashir has
  explicitly set `owner='claude'`. Claude doesn't scan the Inbox and
  pick its own work. That's R5.
- **No autonomous task creation.** Claude's CC session can call the
  existing `createTask` tool via the chat agent path if it really
  needs to, but the daemon prompt should discourage it. Autonomous
  task creation is R6.
- **No autonomous decomposition.** Mid-execution, Claude doesn't call
  `decomposeTask` on itself. R7.
- **No continuous loop.** The daemon is a polling worker. The full
  always-on continuous mode is R8.

## Five design considerations that R4 must respect

From `docs/ARCHITECTURE.md` → "Autonomous agent loop architecture
(planned)". Even though R4 only implements a slice, the slice has to
bake these in:

1. **Trust boundary.** Every task carries a `requires_review` flag
   (separate from runtime `needs_review`). Irreversible actions —
   send email, push git, purchase, post to Slack, delete files —
   ALWAYS get `requires_review=true` at creation. The daemon NEVER
   executes a `requires_review=true` action without routing through
   Review first.
   - Add `tasks.requires_review bool default false` in R4's
     migration.
   - Trust rules live in `claude_policy.yaml` per-user or per-
     project. Add a stub `claude_policy.example.yaml` to the
     bash-os-daemon repo when R4 starts. Bashir maintains the
     real one locally.

2. **Cost budgets that can't be exceeded.** Per-day token + dollar
   budgets enforced by the daemon. Circuit breaker: budget hit → no
   new task starts (in-flight finishes) → daemon writes an
   agent_events row `action='budget pause'` so the brief panel can
   surface it. AI Gateway (KNOWN_ISSUES #2, bumped to "do before
   R6") provides the dashboards but R4 reads its budgets from
   `claude_policy.yaml` directly.

3. **Decision auditability.** R4 doesn't generate decisions yet
   (that's R5+), but the daemon's "I picked task X because it has
   owner=claude" is technically a decision. Log it via agent_events
   so an audit trail exists from day one.

4. **Stop conditions** — all configurable in `claude_policy.yaml`:
   - Per-task token budget.
   - Per-day total token budget.
   - Mandatory pause when Review queue exceeds threshold N (see #5).

5. **Review queue backpressure.** If
   `count(tasks WHERE needs_review=true) > threshold`, the daemon
   pauses new task starts. Brief panel surfaces it as a new
   attention bar trigger: "Review backlog: N items — Claude paused."
   This prevents the "47 things to approve, nothing useful happens"
   failure mode.

## Constraints

- Iterate against `bash-os-dev` for any API changes. New endpoints
  for the daemon land on `bash-os-dev` first; apply to prod after
  explicit approval.
- The daemon repo (`bash-os-daemon`) is a separate concern from this
  one. Don't dump daemon code into `bash-os`.
- Ship-first: no tests, no CI on the bash-os side. (The daemon
  itself may want a couple of integration tests around the
  pick/complete cycle, since failure modes are async + retryable.
  Decide when R4 starts.)
- No scope expansion. If autonomous selection, decomposition,
  creation, or continuous mode would help R4 — they're R5/R6/R7/R8,
  not R4.
- Migrations: dev-then-prod, two new fields on `tasks`
  (`requires_review`, `output`, `claimed_at`), possibly a new index
  for `(owner, column_id) WHERE claimed_at IS NULL`.

## Definition of done

- Bashir marks a task `owner='claude'` in the Today or Active column.
- Within 30s, the daemon picks it up, writes an agent_events
  `action='picked'` row, launches CC headless.
- CC session emits agent_events as it works (hook posts).
- On success, the task moves to Review with `needs_review=true`,
  `output` populated, and an agent_events `action='completed'` row.
- Bashir clicks Approve → task moves to Done; or clicks Reject with
  feedback → task moves back to Active with the feedback appended.
- Budget exhaustion or review-queue overflow pauses the daemon, and
  the brief panel surfaces it as an attention bar.
- ROUNDS.md R4 entry moves from 🔜 Planned to ✅ Complete.
