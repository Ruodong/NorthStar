-- 004_confluence_parent.sql — add parent_id + depth to confluence_page
-- Spec: .specify/features/confluence-child-pages/spec.md
-- Idempotent; safe to re-apply.

SET search_path TO northstar, public;

ALTER TABLE northstar.confluence_page
    ADD COLUMN IF NOT EXISTS parent_id VARCHAR,
    ADD COLUMN IF NOT EXISTS depth     INT;

CREATE INDEX IF NOT EXISTS idx_cfl_page_parent ON northstar.confluence_page (parent_id);
CREATE INDEX IF NOT EXISTS idx_cfl_page_depth  ON northstar.confluence_page (depth);
