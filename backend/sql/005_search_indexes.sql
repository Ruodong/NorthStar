-- NorthStar search indexes
-- ------------------------
-- Enables Postgres full-text + trigram fuzzy search across master data
-- tables so that the /api/search endpoint (Cmd+K) can answer in <100ms.
--
-- Search surface:
--   * ref_application  — CMDB app master (~3168 rows)
--   * ref_project      — MSPO project master (~2356 rows)
--
-- We create two indexes per table:
--   1. GIN on tsvector (full-text, handles multi-word English queries)
--   2. GIN on gin_trgm_ops (trigram, handles typos & partial strings in both
--      English and Chinese since pg_trgm operates on arbitrary chars)
--
-- Both indexes are expression-based so no new columns are needed and the
-- search stays in sync with the source tables automatically (ALTER not needed
-- when sync_from_egm.py UPSERTs).
--
-- Idempotent — safe to re-run. Each CREATE INDEX uses IF NOT EXISTS.

SET search_path TO northstar, public;

-- Required extensions (no-op if already installed)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- =============================================================================
-- ref_application search indexes
-- =============================================================================

-- Full-text (English). We search across the concatenation of identifying
-- fields. coalesce() keeps NULLs from breaking to_tsvector.
CREATE INDEX IF NOT EXISTS idx_ref_app_fts
    ON ref_application
    USING GIN (
        to_tsvector('simple',
            coalesce(app_id, '') || ' ' ||
            coalesce(name, '') || ' ' ||
            coalesce(app_full_name, '') || ' ' ||
            coalesce(short_description, '')
        )
    );

-- Trigram on concatenated searchable text for fuzzy / partial match.
-- We use a lowercased concatenation so ILIKE / similarity both work.
CREATE INDEX IF NOT EXISTS idx_ref_app_trgm
    ON ref_application
    USING GIN (
        (
            lower(coalesce(app_id, '') || ' ' ||
                  coalesce(name, '') || ' ' ||
                  coalesce(app_full_name, ''))
        ) gin_trgm_ops
    );

-- =============================================================================
-- ref_project search indexes
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_ref_proj_fts
    ON ref_project
    USING GIN (
        to_tsvector('simple',
            coalesce(project_id, '') || ' ' ||
            coalesce(project_name, '') || ' ' ||
            coalesce(pm, '') || ' ' ||
            coalesce(it_lead, '') || ' ' ||
            coalesce(dt_lead, '')
        )
    );

CREATE INDEX IF NOT EXISTS idx_ref_proj_trgm
    ON ref_project
    USING GIN (
        (
            lower(coalesce(project_id, '') || ' ' ||
                  coalesce(project_name, ''))
        ) gin_trgm_ops
    );
