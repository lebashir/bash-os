# R3.6 — Bootstrap lifeofbash

Initialize `~/lifeofbash/` as a fresh git repo containing the substrate
skeleton — the long-lived personal-operating-system folder that holds
Bashir's life data and is the source of truth for everything the bash-os
web app shows.

> **Where this prompt runs.** This prompt is archived here in
> `lebashir/bash-os`, but it executes inside the freshly-created
> `lebashir/lifeofbash` repo. Before running, copy this file into
> `~/lifeofbash/docs/cc-prompts/r3-6-bootstrap-lifeofbash.md` so the
> bootstrap is captured in lifeofbash's own prompt archive from day
> one. CC should be invoked with `cwd=~/lifeofbash`.

## Why this exists

Tools come and go. Notion changes pricing. Slack disappears. Vercel
projects migrate. Employers change. What stays is the data — the people
who matter, the projects in flight, the way Bashir thinks, the decisions
he's made. That substrate needs a home that outlives any specific view
or executor.

The bash-os web app is one view (the dashboard). The local CC daemon
(R4 onward) is one executor. lifeofbash is the substrate underneath
both — markdown files in a private git repo on Bashir's personal
GitHub. As long as he can read text and run `git clone`, it exists.

This bootstrap creates the empty house — every room framed, no
furniture. Furniture (real people, real projects, real memory) gets
filled in by subsequent CC sessions inside lifeofbash, one folder at a
time.

## Context for any Claude session reading this

- The user is Bashir Habib. Based in Dubai (GMT+4). Currently works at
  Tabby (`bachir.habib@tabby.ai`). Has personal projects on the side —
  `bash-os` (this companion web app, deployed at bash-os.vercel.app)
  and `tally` on personal accounts; `doxi` is Tabby IP.
- Companion repo `lebashir/bash-os` is the kanban + chat + brief web
  view onto this substrate. It already exists. Its `AGENTS.md`,
  `docs/PROJECT.md`, `docs/ROUNDS.md`, and `docs/ARCHITECTURE.md`
  explain its current state.
- A local daemon under `tools/daemon/` will land in R4. It polls
  bash-os for `owner='claude'` tasks, opens CC headless in the matching
  project's working directory, and writes archive notes back into this
  substrate when work completes. Not built yet — referenced here so
  the folder structure leaves room for it.

## Hard conventions (apply to every file this prompt creates)

- All content is markdown (`.md`).
- Every content file has YAML frontmatter at the top with at minimum
  `created: YYYY-MM-DD`. Other typed fields per the folder's CLAUDE.md.
- Dates are ISO 8601 (`2026-05-19`). Never `19/05/26` or `May 19`.
- No emojis in any committed file. Anywhere. This matches the bash-os
  convention.
- No secrets, no phone numbers, no home addresses, no government IDs.
  `.gitignore` covers `.env` etc. as a backstop — humans (and Claude)
  should also be careful at write time.
- Files are kebab-case (`weekly-review.md`, `jane-doe.md`). Folders
  are kebab-case too (`task-patterns/` if ever sub-organized).

## Folder layout to create

```
~/lifeofbash/
  CLAUDE.md
  README.md
  .gitignore
  docs/
    cc-prompts/
      README.md
      r3-6-bootstrap-lifeofbash.md       (this file, copied in beforehand)
  people/
    CLAUDE.md
    _template.md
    family/.gitkeep
    friends/.gitkeep
    colleagues/.gitkeep
  projects/
    CLAUDE.md
    _template.md
    work/.gitkeep
    personal/.gitkeep
  routines/
    CLAUDE.md
    _template.md
  playbooks/
    CLAUDE.md
    _template.md
  memory/
    CLAUDE.md
    style.md
    task-patterns.md
    decisions.md
  inbox/
    CLAUDE.md
  tools/
    CLAUDE.md
    README.md
```

## File contents

Write each file below with the exact content shown. Use the file path
as the heading; the content is the fenced block beneath it.

> **Note on nested code fences.** Several files (the per-folder
> CLAUDE.md files) contain markdown code blocks inside them showing
> YAML frontmatter examples. To prevent those inner fences from
> closing the outer fence in this prompt, they're shown escaped as
> `\`\`\`yaml ... \`\`\``. When writing the file's actual content,
> strip the leading backslash on each escaped fence — the on-disk
> file should contain real triple-backticks, not backslash-backtick
> sequences.

### `CLAUDE.md` (root)

```markdown
# lifeofbash — agent orientation

This is the substrate. Bashir's personal-operating-system: the
long-lived store of life data — people, projects, routines, playbooks,
memory, decisions. Companion projects (the bash-os web app, the local
CC daemon) operate against this folder. This is the source of truth;
they are views and executors.

## What lives where

- `people/` — humans who matter. One markdown file per person under
  `family/`, `friends/`, or `colleagues/`. Frontmatter holds typed
  fields (birthday, relationship, last check-in); body holds free-text
  context.
- `projects/` — projects that are active or archived, grouped under
  `work/` or `personal/`. Each project either gets its own folder
  (with a `README.md` and an `archive/`) or a single reference file
  (a markdown stub pointing at the actual code repo's working
  directory). Default to the reference-file pattern; promote to a
  folder only when there's enough lifeofbash-specific content to
  justify it.
- `routines/` — recurring patterns: morning, weekly review, quarterly
  check-in. Templates for the rhythm Bashir wants to live by.
- `playbooks/` — cross-cutting how-tos that aren't tied to a single
  project: how to write emails, how to prep for meetings, how to do
  deep work.
- `memory/` — what Claude has learned about Bashir over time.
  `style.md` (voice, preferences), `task-patterns.md` (similar tasks
  handled similar ways), `decisions.md` (past decisions and
  rationale). Living documents — any Claude session writes here at
  the end of a completed task when something new and durable was
  noticed.
- `inbox/` — unfiled captures. Dated markdown files
  (`YYYY-MM-DD-<slug>.md`) for thoughts that don't have a home yet.
  Gets triaged periodically.
- `tools/` — scripts the substrate runs on itself (rebuild index,
  sync to bash-os DB, weekly digest, the CC daemon from R4 onward).
  The only place executable code lives in this repo.
- `docs/cc-prompts/` — archive of CC prompts that built and modified
  this substrate. Convention inherited from bash-os.

## Conventions

- Markdown only for content. YAML frontmatter at the top with at
  minimum `created: YYYY-MM-DD`.
- ISO 8601 dates (`2026-05-19`).
- No emojis in committed files.
- No secrets, no phone numbers, no home addresses, no government IDs.
- Files are named `kebab-case.md` unless they encode a proper name
  (`people/colleagues/jane-doe.md`).

## When in doubt

Read the closest CLAUDE.md to where you're working. Each folder has
its own short orientation file explaining what belongs there.

## Companion projects

- `lebashir/bash-os` (deployed at bash-os.vercel.app) — the kanban +
  chat web app that visualizes live state. Reads from this substrate
  via sync scripts in `tools/`; writes back via its API when the user
  mutates tasks in the UI.
- A local CC daemon (R4 onward) will live under `tools/daemon/`. It
  polls bash-os for Claude-owned tasks, opens CC sessions in the
  relevant working directories, and writes archive notes back into
  this substrate when work completes.
```

### `README.md` (root)

```markdown
# lifeofbash

Bashir's life operating system. The folder that everything else hangs
off of — people who matter, projects that are active, the patterns I
want to live by, the things Claude has learned about how I work.

The bash-os web app at bash-os.vercel.app is the dashboard view. The
local daemon (coming) is the executor. This folder is the source of
truth.

## Why this exists

Because tools come and go. Notion changes pricing. Slack disappears.
Vercel projects migrate. Companies change. Laptops break. Jobs end.
What stays is the data — the people I care about, the projects I'm
building, the way I think, the decisions I've made.

This folder is markdown in git on my personal GitHub. As long as I can
read text and run `git clone`, this exists. Future-me ten years from
now is the audience.

## How to use it

Daily use is via Cowork or Claude Code, opened inside this folder or
any sub-folder. The CLAUDE.md files orient any Claude session. Edits
land as commits.

The bash-os web app reads and indexes from here via sync scripts in
`tools/`. The daemon writes archive notes here when it completes
Claude-owned work.

## Layout

See `CLAUDE.md` for the working layout. Short version: `people/`,
`projects/`, `routines/`, `playbooks/`, `memory/`, `inbox/`, `tools/`,
`docs/cc-prompts/`.

## Privacy

Private repo. Owned by `lebashir`. Anything that leaks here leaks to
no one but me — but still: no phone numbers, no home addresses, no
passwords, no API tokens. `.env` and similar are gitignored as a
backstop.
```

### `.gitignore`

```
.DS_Store
*.log
*.swp
.env
.env.*

# Tooling
node_modules/
.vscode/
.idea/

# Local-only caches and indexes
/index.db
/index.db-*
/.cache/
/tools/dist/
/tools/node_modules/
```

### `docs/cc-prompts/README.md`

```markdown
# docs/cc-prompts/

Archive of Claude Code prompts that have built or modified lifeofbash.

## Convention

Inherited from the companion repo `lebashir/bash-os`. Substantive work
on the substrate is captured as a markdown prompt here, then run by
CC against a fresh session. The prompt is the record of how the
substrate got to its current state — useful both for auditing
decisions and for replaying the bootstrap if needed.

Naming: `r<round>-<slug>.md`. `r3-6-bootstrap-lifeofbash.md` is the
bootstrap. Subsequent rounds increment.

## Why duplicate this convention from bash-os

The two repos evolve independently. bash-os ships features for the
web view; lifeofbash grows substrate content. They reference each
other but each carries its own archive of how it got built.
```

### `people/CLAUDE.md`

```markdown
# people/

Humans who matter to Bashir. One markdown file per person, named in
kebab-case (e.g., `mom.md`, `jane-doe.md`). Filed under one of:

- `family/` — parents, siblings, immediate relatives.
- `friends/` — chosen relationships.
- `colleagues/` — work relationships, current or past. Past colleagues
  stay here too; tag them in frontmatter with `company:` and `era:`.

## Required frontmatter

\`\`\`yaml
---
name: Full Name
relationship: family | friend | colleague | mentor | other
created: YYYY-MM-DD
---
\`\`\`

## Recommended frontmatter (add what's relevant)

- `birthday: YYYY-MM-DD` (no year if unknown: `birthday: --MM-DD`)
- `last_checkin: YYYY-MM-DD`
- `checkin_frequency: daily | weekly | monthly | quarterly | yearly`
- `company: <name>` (for colleagues, especially past)
- `era: <year-range>` (for time-bounded relationships, e.g. "2018-2022")
- `interests: [list]`
- `prefers: voice | text | email | in-person`

## Body

Free-text. Anything that helps Claude understand the relationship —
background, how Bashir met them, recent context, what to know before
reaching out, what they care about, their current life situation.
Update when things change.

See `_template.md` for a starting shape.
```

### `people/_template.md`

```markdown
---
name: <Full Name>
relationship: <family|friend|colleague|mentor|other>
created: 2026-05-19
# birthday: YYYY-MM-DD
# last_checkin: YYYY-MM-DD
# checkin_frequency: <cadence>
# company: <if colleague>
# era: <year-range>
# interests: []
# prefers: <voice|text|email|in-person>
---

# <Full Name>

<Two or three sentences on how you know them and what defines the
relationship.>

## Background

<Where they're from, what they do, history with you.>

## Recent

<Latest context — what's going on in their life as of the last
update.>

## Notes

<Anything else useful when working with this person.>
```

### `projects/CLAUDE.md`

```markdown
# projects/

Projects Bashir is actively involved in, plus archived ones. Two
top-level splits:

- `work/` — projects owned by his current employer (or any past
  employer, retained as `<company>-archive/`). Code IP that belongs to
  the company.
- `personal/` — projects he owns. Personal repos, side projects,
  hobbies.

## Two patterns

A project can live here as either:

1. **A folder** with its own `README.md`, sub-folders, and `archive/`.
   Use this when the project has substrate that doesn't fit anywhere
   else — playbooks specific to it, notes, planning docs.
2. **A single reference file** (`<project-name>.md`) when the
   project's actual content lives elsewhere (a code repo on disk, an
   external service). The file has frontmatter pointing to the working
   directory and a body describing the project.

Default to pattern 2. Promote to pattern 1 only when there's enough
lifeofbash-specific content to justify a folder.

## Required frontmatter (reference files)

\`\`\`yaml
---
name: <project name>
type: code | doc | research | other
status: active | dormant | archived
owner: bashir | tabby | <other>
working_dir: <absolute path on disk, if applicable>
created: YYYY-MM-DD
---
\`\`\`

## Body (reference files)

What the project is, who it's for, current state, important context,
links to relevant external resources. Updated when state changes.

See `_template.md` for a starting shape.

## Daemon hookpoint

When the R4 daemon picks up a Claude-owned task tagged with a project
name, it reads the project's reference file (or folder's README) to
resolve the `working_dir`, opens CC headless there, and on completion
writes an archive note back into the project's `archive/` sub-folder
(creating it if the project is reference-only). That's how lifeofbash
accumulates a record of work done on external repos without those
repos needing to know about lifeofbash.
```

### `projects/_template.md`

```markdown
---
name: <project name>
type: <code|doc|research|other>
status: <active|dormant|archived>
owner: <bashir|tabby|other>
working_dir: ~/projects/<project>
created: 2026-05-19
---

# <project name>

<One paragraph: what this is, who it's for, current state.>

## Context

<Why it exists, history, anything that helps Claude do good work
here.>

## Working directory

`~/projects/<project>` — the actual code/files live there. Open Claude
Code in that directory when working on this; consult this file for
substrate-level context.

## Recent activity

<Updated periodically. Task outputs land in `archive/` for this
project once daemon execution begins (R4 onward).>
```

### `routines/CLAUDE.md`

```markdown
# routines/

Recurring rhythms Bashir wants to live by. One markdown file per
routine. Frontmatter declares the cadence; body describes the routine.

## Examples

- `morning.md` — what a good morning looks like.
- `weekly-review.md` — Sunday/Friday checkpoint.
- `monthly-checkin.md` — health, finances, relationships scan.
- `quarterly-checkin.md` — bigger horizons.

## Frontmatter

\`\`\`yaml
---
name: <routine name>
cadence: daily | weekly | monthly | quarterly | yearly
created: YYYY-MM-DD
---
\`\`\`

## Body

The actual routine — steps, prompts, what good looks like. Living
document; edit when the routine drifts.

See `_template.md`.
```

### `routines/_template.md`

```markdown
---
name: <routine name>
cadence: <daily|weekly|monthly|quarterly|yearly>
created: 2026-05-19
---

# <routine name>

<One paragraph: what this routine is for and when it fires.>

## Steps

1. <step>
2. <step>
3. <step>

## What good looks like

<Indicators that this routine is being lived well.>

## Adjustments

<Notes on what to tweak if the routine isn't landing.>
```

### `playbooks/CLAUDE.md`

```markdown
# playbooks/

Cross-cutting how-tos that aren't tied to a single project. One
markdown file per playbook. The substrate's accumulated craft.

## Examples

- `write-emails.md` — voice, structure, sign-offs.
- `prep-meetings.md` — pre-read, agenda, questions.
- `deep-work.md` — when, where, for how long, what counts.
- `give-feedback.md` — direct, kind, specific.

## Frontmatter

\`\`\`yaml
---
name: <playbook name>
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
\`\`\`

## Body

The actual playbook. Distilled to what's actionable. Update when
something works or doesn't.

See `_template.md`.
```

### `playbooks/_template.md`

```markdown
---
name: <playbook name>
created: 2026-05-19
updated: 2026-05-19
---

# <playbook name>

<One paragraph: when does this playbook apply?>

## Principles

<Core ideas. Keep short.>

## Steps / process

<The actual how-to.>

## What to avoid

<Common failure modes.>

## Source / inspiration

<If learned from somewhere, cite it. Otherwise blank.>
```

### `memory/CLAUDE.md`

```markdown
# memory/

What Claude has learned about Bashir over time. Living documents that
grow as Claude completes tasks and notices patterns.

## Files

- `style.md` — voice, writing preferences, code preferences, decision
  style. Anything that helps Claude sound and act like Bashir.
- `task-patterns.md` — recurring shapes of work. "X-style tasks I
  handle this way." Grows as similar tasks come through.
- `decisions.md` — past decisions and their rationale. Lets Claude
  audit a chain of reasoning later without re-reading transcripts.

## Convention

After every completed task, the executing Claude session reflects
briefly and updates these files when something new was learned. Most
tasks change nothing. The threshold for writing is "did I notice
something new and durable about how Bashir works?"

Entries should be dated. New patterns append; existing patterns update
their `updated:` date when reinforced.

Bashir can also edit these directly. They're the AI's understanding of
him — both parties get to write.

## What does NOT go here

- Ephemeral state ("Bashir is working on X this week"). That belongs
  in bash-os's task board.
- Single-occurrence observations dressed up as patterns. Wait until
  something happens twice before recording it as a pattern.
- Secrets or sensitive personal info. Same rules as the rest of the
  substrate.
```

### `memory/style.md`

```markdown
---
name: style
created: 2026-05-19
updated: 2026-05-19
---

# Bashir's style

Living notes on Bashir's voice, preferences, and the way he likes work
done. Update when new patterns surface — the threshold is "noticed
twice" or "explicitly stated by Bashir."

## Writing voice

(To be populated as patterns emerge.)

## Code preferences

(To be populated.)

## Decision style

(To be populated.)

## How he likes feedback

(To be populated.)
```

### `memory/task-patterns.md`

```markdown
---
name: task-patterns
created: 2026-05-19
updated: 2026-05-19
---

# Task patterns

Recurring shapes of work and how to handle them well. Each entry is a
pattern that has shown up more than once. New entries get appended;
existing entries get their `last_seen:` date refreshed when reinforced.

## Template for new entries

\`\`\`yaml
first_seen: YYYY-MM-DD
last_seen: YYYY-MM-DD
count: 1
\`\`\`

Then a short description of what the pattern looks like and how it
tends to be handled well.

(Add patterns below as they emerge.)
```

### `memory/decisions.md`

```markdown
---
name: decisions
created: 2026-05-19
updated: 2026-05-19
---

# Decisions

Past decisions and rationale. Lets Claude reconstruct reasoning
without re-reading transcripts.

## Template for new entries

\`\`\`yaml
date: YYYY-MM-DD
decision: <what was decided>
context: <what prompted it>
reasoning: <why this over alternatives>
alternatives_considered: []
status: active | superseded | reverted
\`\`\`

Then any extended commentary if needed.

(Add decisions below.)
```

### `inbox/CLAUDE.md`

```markdown
# inbox/

Unfiled captures. Things Bashir wants to remember or think about but
haven't been filed yet.

## Convention

One file per capture, named `YYYY-MM-DD-<slug>.md`. Slug is kebab-case,
short. Frontmatter optional but encouraged:

\`\`\`yaml
---
captured: YYYY-MM-DD
source: <where this came from — conversation, meeting, browse, etc.>
---
\`\`\`

Body is free-text.

## Triage

Periodically (weekly recommended), Bashir or a Claude session sweeps
the inbox. Each capture either gets filed into the right substrate
location (people, projects, playbooks, memory) or is deleted.

The inbox should not grow indefinitely. If it does, the substrate is
being treated as a write-only dumping ground, which defeats the point.
```

### `tools/CLAUDE.md`

```markdown
# tools/

Scripts the substrate runs on itself. The only place executable code
lives in this repo.

## What goes here

- Sync scripts (substrate to bash-os DB index, and vice versa for
  archive notes flowing back).
- Index rebuilders (regenerate any cache from substrate files).
- Digest generators (weekly/monthly views of substrate state).
- The CC daemon (R4 onward — `tools/daemon/`).

## What does NOT go here

- Long-form content (goes in people, projects, playbooks, memory).
- Secrets or credentials (those live in env vars or external secret
  stores, not committed).
- Anything that doesn't operate on the substrate itself.

## Language

TypeScript by default. Run via `bun` or `tsx`. Add a top-level
`package.json` here when the first tool lands.
```

### `tools/README.md`

```markdown
# tools/

Scripts that operate on lifeofbash. Each tool is a TypeScript script
(run via `bun` or `tsx`) with a one-line description at the top of its
file.

This folder is empty at bootstrap. Tools land here as they're built.

## Planned

- `sync.ts` — push substrate-derived state to bash-os (birthdays
  become recurring tasks, playbooks become memory rows). Pull archive
  notes from completed tasks back into substrate.
- `daemon/` — R4-onward: the local CC daemon that picks Claude-owned
  tasks from bash-os and dispatches CC sessions.
- `digest.ts` — generate a weekly digest of substrate state.

## Conventions

Top of every script:

\`\`\`ts
// <one-line description>
// usage: bun tools/<name>.ts [args]
\`\`\`
```

### `people/family/.gitkeep`, `people/friends/.gitkeep`, `people/colleagues/.gitkeep`, `projects/work/.gitkeep`, `projects/personal/.gitkeep`

Empty files. Just `touch` each one — git tracks the folder via the
`.gitkeep`.

## Steps for CC executing this prompt

1. Verify the cwd is `~/lifeofbash`.
2. Verify `git status` shows a clean repo. Acceptable states: a freshly
   initialized empty repo with no commits, or a repo with only an
   initial commit from `gh repo create` (a default README or LICENSE
   from GitHub). If GitHub seeded a README.md, delete it first — this
   prompt writes its own.
3. Verify `docs/cc-prompts/r3-6-bootstrap-lifeofbash.md` already
   exists at the cwd. (It should, because the user copied this prompt
   in before invoking CC.) If it's missing, stop and tell the user
   to copy it in.
4. Create the folder tree using `mkdir -p` for each folder listed in
   the layout above.
5. Write each file listed under "File contents" with its exact content.
   Use the Write tool. The `.gitkeep` files are empty — `touch` them.
6. Once all files exist, run `git add -A`, then `git status` to
   confirm everything is staged.
7. Commit with message: `bootstrap lifeofbash substrate`. Do NOT push.
   The user handles `git push -u origin main` themselves once they've
   reviewed the commit.
8. Run `find . -type f -not -path './.git/*' | sort` and print the
   output so the user can verify the structure landed correctly.

## Constraints

- This is a one-shot scaffolding pass. No iteration with the user
  inside this prompt — write every file as specified.
- No tests, no CI, no package.json yet at the lifeofbash root. The
  first tool that lands in `tools/` will introduce its own
  `tools/package.json`.
- Don't add anything beyond the listed files. No "while I'm here"
  improvements — those happen in subsequent rounds inside lifeofbash.
- Don't push to GitHub. The user's personal access to lebashir is not
  Claude's to assume — they handle the remote push manually.
- Do NOT seed real people, real projects, or real memory content.
  Templates and stubs only. Real content gets added in subsequent CC
  sessions inside lifeofbash, with Bashir in the loop.

## Definition of done

- Every folder in the expected tree exists.
- Every file listed exists with the specified content.
- One git commit on the local repo titled `bootstrap lifeofbash
  substrate`.
- No remote push has happened.
- `find . -type f -not -path './.git/*' | sort` output matches the
  expected tree.
- The user can `cd ~/lifeofbash && cat CLAUDE.md` and read a coherent
  orientation file.

## What comes next (not in this round)

- Real content seeded into `people/`, `projects/`, `playbooks/`,
  `routines/` — incremental, one folder at a time, with Bashir
  curating. Each round gets its own prompt under
  `lifeofbash/docs/cc-prompts/`.
- The MCP server in `lebashir/bash-os` exposing agent endpoints —
  separate work item on the bash-os side.
- The sync script (`tools/sync.ts`) — once both substrate and the
  bash-os MCP server have shape.
- The R4 daemon — `tools/daemon/` — built after sync proves the
  substrate-to-bash-os pathway works.
