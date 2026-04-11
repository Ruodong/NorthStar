-- 012_confluence_diagram_app_resolve.sql — name-id reconciliation columns
-- Spec: .specify/features/drawio-name-id-reconciliation/spec.md
--
-- Adds the output columns of scripts/resolve_confluence_drawio_apps.py:
--   resolved_app_id    — final A-id after name validation (may differ from
--                        the architect-typed standard_id)
--   match_type         — classification of how the row was resolved
--                        (direct, typo_tolerated, auto_corrected,
--                         auto_corrected_missing_id, fuzzy_by_name,
--                         mismatch_unresolved, no_cmdb)
--   name_similarity    — pg_trgm similarity [0,1] between the drawio name
--                        and the resolved app's CMDB name
-- Idempotent, additive only.

SET search_path TO northstar, public;

ALTER TABLE northstar.confluence_diagram_app
    ADD COLUMN IF NOT EXISTS resolved_app_id  VARCHAR,
    ADD COLUMN IF NOT EXISTS match_type       VARCHAR,
    ADD COLUMN IF NOT EXISTS name_similarity  REAL;

CREATE INDEX IF NOT EXISTS idx_cda_resolved_app
    ON northstar.confluence_diagram_app (resolved_app_id)
    WHERE resolved_app_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cda_match_type
    ON northstar.confluence_diagram_app (match_type);
