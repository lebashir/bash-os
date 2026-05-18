# Bash OS

A personal life-OS for one person (Bashir). Round 1 is a local-first kanban board backed by Supabase: seven columns capture everything from raw ideas (`things to think about`) through delegated work (`Bash work`, `Claude work`, `Boss Check`) to closed-out items (`DIgested.`). Cards carry priority, due date, and a free-form source ID. Future rounds add connectors (Gmail, Calendar, Slack, Jira/ClickUp), a memory layer, a daily brief, and scheduled jobs — none of that is built yet.

## Stack

- **Next.js 16** (App Router, TypeScript, Turbopack, Tailwind 4)
- **shadcn/ui** on Radix primitives
- **@dnd-kit** for drag-and-drop
- **Supabase** (Postgres + Auth + pgvector) — local Docker stack for dev, cloud project for production
- **Google OAuth** via Supabase Auth
- **pnpm** for package management
- Hosting target: **Vercel** free tier (not yet deployed)

## Prerequisites

- Node 20+
- pnpm
- Docker (only needed for local Supabase; cloud-only dev works without it)
- Supabase CLI (`brew install supabase`)
- A Google Cloud project with an OAuth client (Web application type)

## Local development

The fast path is **cloud-only dev** — point `.env.local` at your cloud Supabase project and skip Docker entirely. The Docker stack is documented below for offline work, but Google OAuth needs outbound TLS from inside the GoTrue container, which fails in environments with corporate TLS interception.

### Cloud-only (recommended)

```bash
pnpm install
cp .env.example .env.local
# Edit .env.local — fill in your cloud Supabase project URL and anon/publishable key.
pnpm dev
```

Then open http://localhost:3000 (or whatever port Next picks) and sign in with Google.

### Local Supabase stack

```bash
pnpm install
supabase start --exclude edge-runtime,logflare,vector
# Copy the printed Project URL and publishable key into .env.local.
pnpm dev
```

`edge-runtime`, `logflare`, and `vector` are excluded because the edge runtime pulls Deno modules from `deno.land` on startup, which fails behind any TLS interception. You don't need them for R1.

For local Google OAuth to work, the GoTrue container also needs to reach `accounts.google.com` over TLS — same trust-store problem. If that doesn't work in your network, either point `.env.local` at your cloud project (above) or enable email magic links in `supabase/config.toml` and use Mailpit at http://127.0.0.1:54324.

## Database migrations

```bash
# Create a new migration
supabase migration new <descriptive_name>

# Apply locally (destructive — wipes local DB and re-runs every migration)
supabase db reset

# Apply to cloud (after `supabase link --project-ref <ref>`)
supabase db push
```

The initial migration (`supabase/migrations/<timestamp>_init.sql`) creates:

- `public.tasks` — kanban cards with the seven hard-coded status values, optional priority/due date/source ID, a `position` integer for ordering within a column, and an `updated_at` trigger.
- `public.memories` — reserved for Round 2; a `content` + `vector(1536)` + `tags` table for later embedding-based recall. Empty in R1.

Both tables have RLS enabled with separate `select`/`insert`/`update`/`delete` policies, all gated by `auth.uid() = user_id` and scoped to the `authenticated` role.

The seven status values are matched verbatim by a CHECK constraint:

```
things to think about
on the menu
todays plate
Bash work
Claude work
Boss Check
DIgested.
```

## Git identity setup

The repo lives under a personal GitHub account (`lebashir/bash-os`). On the work machine, the `gh`/git credential store is the work account, which has been added as a collaborator on the personal repo — that way `git push` works without account switching.

Commit authorship is pinned at the **repo level** to the personal identity via `.git/config`:

```
git config --local user.name "Bashir"
git config --local user.email "<personal email>"
```

This only affects this repo; other repos on the machine keep their own settings. Verify with `git config --local --get user.email` before committing.

## Deploying to Vercel

1. Import the repo at https://vercel.com under the personal account.
2. Framework preset auto-detects Next.js.
3. Set the same env vars from `.env.example`:
   - `NEXT_PUBLIC_SUPABASE_URL` — cloud project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` — cloud project publishable/anon key
4. After the first deploy, copy the Vercel production URL and:
   - In the Supabase dashboard: **Authentication → URL Configuration** → set Site URL to the Vercel domain, add `https://<domain>/**` to Redirect URLs.
   - In Google Cloud Console: add `https://<domain>/auth/callback` and `https://<ref>.supabase.co/auth/v1/callback` (if not already there) to the OAuth client's Authorized redirect URIs.

## Round 1 scope

**In:** Google sign-in, 7-column kanban, drag-and-drop with persisted ordering, full CRUD via shadcn dialog, cloud Supabase with RLS.

**Out (explicit non-goals — coming later rounds):**
- LLM calls of any kind
- External connectors (Gmail, Google Calendar, Slack, Jira, ClickUp, etc.)
- Scheduled jobs / daily brief
- Memory chat or embedding-based recall (table exists but unused)
- Multi-user / sharing / collaboration
- Mobile-optimized layout (works on mobile, not tuned for it)
