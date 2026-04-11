-- 010_root_project_id.sql — confluence tree root project id
-- Spec: .specify/features/confluence-root-project-id/spec.md
--
-- Adds a persistent column that holds the depth=1 ancestor's project_id for
-- every page, so admin grouping / search / analytics can operate on the real
-- Confluence tree root without mis-attributing sub-initiative pages
-- (e.g. FY2526-063 under LI2500067) to their own fake top-level project row.
-- Idempotent.

SET search_path TO northstar, public;

ALTER TABLE northstar.confluence_page
    ADD COLUMN IF NOT EXISTS root_project_id VARCHAR;

CREATE INDEX IF NOT EXISTS idx_cfl_page_root_project
    ON northstar.confluence_page (root_project_id);
