# CC prompts archive

This directory holds the prompts that drove each Bash OS round.

One file per round, in chronological order. Files are kebab-case and
prefixed with the round identifier:

- `r3-5-design-pass.md` — the prompt that built R3.5 (UX redesign +
  custom columns + owner + command bar + agent activity + email triage).
- `r3-5c-cleanup.md` — DRAFT for the trimmed R3.5c follow-up subset
  (board filter/sort, recurring tasks UI/cron, chat history pane).
- `r4-pattern-b-daemon.md` — DRAFT for R4 (local Claude Code daemon
  executes Claude-owned tasks).

## Conventions

- **Save the prompt before running it**, not after. The exact text that
  was used is the historical record; a reconstructed-after-the-fact
  prompt loses fidelity. (`r3-5-design-pass.md` here is a
  reconstruction because R3.5 predated this archive — flagged inline.)
- **DRAFT** at the top means the prompt hasn't been fleshed out
  enough to run. A `DRAFT` prompt is a sketch — a starting point for
  a future conversation between Bashir and Claude where the gaps get
  filled in.
- Constraints to repeat in every round prompt: dev-then-prod
  migration order, no scope expansion, `bash-os-dev` for iteration,
  ship-first norm (no tests/CI), pause on truly destructive moves.
- Reference `docs/ROUNDS.md` and `docs/ARCHITECTURE.md` for the
  shipped context the prompt is building on.

## Why this exists

Cowork sessions are ephemeral. Without an archive, the prompt that
shaped a round disappears once the session closes. Saving prompts
here means:

- Future-Bashir can see what was asked for vs what shipped.
- A new agent picking up mid-round can read the original intent.
- Round-on-round drift becomes visible (compare R4's prompt to
  R5's — does R5 honor the constraints R4 established?).
