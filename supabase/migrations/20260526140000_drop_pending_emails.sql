-- Pillar 3 cleanup — drop the dormant pending_emails table.
--
-- pending_emails was the R3.5 in-app triage queue (score 4-7 Gmail). Pillar 3
-- moved ingestion local: lifeofbash scores Gmail and writes the TRIAGE/DROP band
-- to staged_emails (verdicts sync back to decisions.jsonl). The in-app Gmail sync
-- that wrote pending_emails has been removed, so the table is dead. Its RLS
-- policies and indexes drop with it.
drop table if exists public.pending_emails;
