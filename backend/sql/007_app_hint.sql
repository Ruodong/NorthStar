-- 007_app_hint.sql — add app_hint column to confluence_page
-- Spec: .specify/features/confluence-app-hint/spec.md
--
-- Backfill happens via scripts/backfill_app_hint.py, not in SQL, because
-- the regex rules live in Python (scripts/title_parser.py) and must stay
-- in sync with the scanner. This file only adds the column + indexes.
-- Idempotent.

SET search_path TO northstar, public;

ALTER TABLE northstar.confluence_page
    ADD COLUMN IF NOT EXISTS app_hint VARCHAR;

CREATE INDEX IF NOT EXISTS idx_cfl_page_app_hint
    ON northstar.confluence_page (app_hint);

-- Ensure pg_trgm is available for resolve_app_id_via_cmdb.
-- Install into `public` — see 005_search_indexes.sql for rationale
-- (shared-DB deployments may already have pg_trgm in public).
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

-- Trigram index on ref_application names speeds up the fuzzy match used
-- by backfill_app_hint.py and scan_confluence.py.
CREATE INDEX IF NOT EXISTS idx_ref_app_name_trgm
    ON northstar.ref_application USING gin (name gin_trgm_ops);

-- ref_application has no short_name column; it has app_full_name instead.
CREATE INDEX IF NOT EXISTS idx_ref_app_full_name_trgm
    ON northstar.ref_application USING gin (app_full_name gin_trgm_ops);
