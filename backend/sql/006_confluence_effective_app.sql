-- 006_confluence_effective_app.sql — add effective_app_id to confluence_page
-- Spec: .specify/features/confluence-child-pages/spec.md § FR-9 (rollup pattern)
--
-- A page's "effective app id" is:
--   1) its own q_app_id if set
--   2) otherwise the nearest ancestor's effective_app_id (walking parent_id)
--
-- This lets drawios on content-less leaf pages like "<Project>-应用架构图"
-- roll up to the parent's (project_id, app_id) group in the admin list.
-- Idempotent; safe to re-apply.

SET search_path TO northstar, public;

ALTER TABLE northstar.confluence_page
    ADD COLUMN IF NOT EXISTS effective_app_id VARCHAR;

CREATE INDEX IF NOT EXISTS idx_cfl_page_effective_app
    ON northstar.confluence_page (effective_app_id);

-- Backfill via recursive CTE: walk each page's parent chain until we find
-- a q_app_id. Then UPDATE effective_app_id to that value. Safe to re-run.
WITH RECURSIVE walk AS (
    -- Seed: every page, pointing at itself
    SELECT page_id AS seed_id,
           page_id AS cur_id,
           q_app_id,
           parent_id,
           0       AS hops
    FROM northstar.confluence_page

    UNION ALL

    -- Step: walk up one level, but only if we haven't found an app id yet
    SELECT w.seed_id,
           p.page_id,
           p.q_app_id,
           p.parent_id,
           w.hops + 1
    FROM walk w
    JOIN northstar.confluence_page p ON p.page_id = w.parent_id
    WHERE w.q_app_id IS NULL
      AND w.hops < 5                              -- cap: no deep chains
),
resolved AS (
    -- First non-null q_app_id we hit on the way up wins
    SELECT seed_id, q_app_id
    FROM (
        SELECT seed_id, q_app_id,
               ROW_NUMBER() OVER (
                   PARTITION BY seed_id
                   ORDER BY CASE WHEN q_app_id IS NOT NULL THEN 0 ELSE 1 END, hops
               ) AS rn
        FROM walk
        WHERE q_app_id IS NOT NULL
    ) r
    WHERE rn = 1
)
UPDATE northstar.confluence_page cp
SET effective_app_id = r.q_app_id
FROM resolved r
WHERE cp.page_id = r.seed_id
  AND (cp.effective_app_id IS DISTINCT FROM r.q_app_id);
