# Dev notes

Things that apply to `bash-os-dev` (ref `xuqpifhojipuzqrowadt`,
Sydney) but NOT to `bash-os` production (ref `vbooingflkmzxcqnbvxr`,
Singapore). Edit when dev-only state changes.

---

## Dev fixtures

Synthetic rows that live exclusively on `bash-os-dev`. Inserted during
R3.5 phase 3 to exercise the brief-panel attention-bar triggers
during UI iteration. **These rows do NOT exist on prod.** Recreate
them if you wipe dev; clean them up when you're done iterating.

Each row carries an `r35-test-` prefix on its identifying field so
they're trivially greppable and trivially deletable.

| Row | Where | Identifying field | Why it exists |
|---|---|---|---|
| Calendar event due in 10 min | `public.tasks` | `source_id = 'r35-test-calendar-imminent'` | Fires the `calendar-imminent` brief attention bar (red, ≤15 min window). |
| Overdue task | `public.tasks` | `source_id = 'r35-test-overdue'` | Fires the `tasks-overdue` bar (red). |
| Urgent gmail task (importance=10) | `public.tasks` | `source_id = 'r35-test-urgent-email'` | Fires the `emails-urgent` bar (red, importance ≥ 9). |
| Needs-review task, owner=claude | `public.tasks` | `source_id = 'r35-test-needs-review'` | Fires the `needs-review` bar (amber, `needs_review=true`). Also demonstrates the claude-owner tint on a card. |
| Staged triage email | `public.staged_emails` | `source_id = 'r35-test-staged-1'` (set `decision='pending'`, `band='TRIAGE'`, a `score`) | Fires the `emails-triage` bar (amber) and gives `TriageModal` a row to render. (Was `pending_emails` before pillar 3 dropped that table.) |

### Cleanup SQL

Drop into the Supabase SQL editor (with the dev project selected) when
you no longer want them surfacing:

```sql
delete from public.tasks where source_id like 'r35-test-%';
delete from public.staged_emails where source_id like 'r35-test-%';
```

### Why we don't ship them to prod

Attention bars on prod should fire because Bashir's real state
triggered them — not because a fixture is sitting there pretending
something is overdue. The bars also dispatch CustomEvents and toasts
on click, which would be visually noisy on a real board.

### Re-seeding

If `bash-os-dev` gets wiped (or you start a fresh dev project), the
inserts are simple enough to script. See R3.5 phase 3's verification
block in git history (commit `406f1b5`, the curl-based seed
commands).
