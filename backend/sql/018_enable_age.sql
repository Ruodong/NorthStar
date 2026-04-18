-- 018_enable_age.sql
-- Install the Apache AGE extension and create the `ns_graph` graph used by
-- NorthStar's graph layer. This is the PR 1 step of the Neo4j -> AGE
-- migration; the Neo4j container keeps running until PR 3 cutover.
--
-- Why `ns_graph` and not `northstar`:
--   AGE's create_graph() creates a schema with the graph name. The
--   `northstar` schema is already occupied by relational master-data tables
--   (ref_application, confluence_page, etc., from 001_init.sql). Using a
--   distinct name avoids any collision.
--
-- The extension is created in its own `ag_catalog` schema (AGE default),
-- which is why we do NOT use `WITH SCHEMA public` here — unlike pg_trgm,
-- AGE has a hard-coded requirement to live in `ag_catalog`.
--
-- Spec: .specify/features/age-migration/spec.md  §FR-INF-3 .. FR-INF-5
-- Arch: .specify/features/age-migration/arch.md
-- Idempotent. Additive only.

-- Note: no `SET search_path` here because AGE functions are schema-qualified
-- explicitly (`ag_catalog.create_graph`), and this migration must NOT touch
-- the northstar schema.

CREATE EXTENSION IF NOT EXISTS age;

-- create_graph() is not idempotent in current AGE releases: it raises
-- `graph "<name>" already exists`. Wrap in a DO block that checks the
-- ag_catalog.ag_graph metadata first.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM ag_catalog.ag_graph WHERE name = 'ns_graph'
    ) THEN
        PERFORM ag_catalog.create_graph('ns_graph');
    END IF;
END $$;
