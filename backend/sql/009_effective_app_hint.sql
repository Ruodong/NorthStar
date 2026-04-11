-- 009_effective_app_hint.sql — propagate unresolved app_hint down the tree
-- Spec: .specify/features/confluence-app-hint/spec.md § FR-10
--
-- When a parent page has app_hint='OF' but no CMDB match, its descendants
-- should inherit 'OF' as an "effective hint" so the admin list groups them
-- under the same [OF] row. Previously only effective_app_id inherited.
-- Idempotent.

SET search_path TO northstar, public;

ALTER TABLE northstar.confluence_page
    ADD COLUMN IF NOT EXISTS effective_app_hint VARCHAR;

CREATE INDEX IF NOT EXISTS idx_cfl_page_effective_app_hint
    ON northstar.confluence_page (effective_app_hint);
