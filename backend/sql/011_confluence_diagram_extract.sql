-- 011_confluence_diagram_extract.sql — persistent store for drawio parser output
-- Spec: .specify/features/confluence-drawio-extract/spec.md
--
-- Why two new tables instead of reusing ref_diagram_app?
--   ref_diagram_app is an EGM mirror (UUID-keyed on EGM's architecture_diagram
--   id, 297 rows as of 2026-04-11). Mixing our Confluence extraction with
--   EGM mirror data would muddy provenance. Parallel tables keep both sides
--   cleanly re-runnable from their respective sources.
--
-- Idempotent. Additive only.

SET search_path TO northstar, public;

-- -----------------------------------------------------------------------------
-- Applications extracted from one drawio file
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS northstar.confluence_diagram_app (
    attachment_id      VARCHAR NOT NULL,
    cell_id            VARCHAR NOT NULL,
    app_name           VARCHAR NOT NULL,
    id_is_standard     BOOLEAN NOT NULL DEFAULT false,
    standard_id        VARCHAR,
    application_status VARCHAR,
    functions          TEXT,
    fill_color         VARCHAR,
    first_seen_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    last_seen_at       TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (attachment_id, cell_id)
);

CREATE INDEX IF NOT EXISTS idx_cfl_diagram_app_std
    ON northstar.confluence_diagram_app (standard_id)
    WHERE standard_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cfl_diagram_app_attachment
    ON northstar.confluence_diagram_app (attachment_id);

-- -----------------------------------------------------------------------------
-- Interactions (directed edges) extracted from one drawio file
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS northstar.confluence_diagram_interaction (
    attachment_id      VARCHAR NOT NULL,
    edge_cell_id       VARCHAR NOT NULL,
    source_cell_id     VARCHAR,
    target_cell_id     VARCHAR,
    interaction_type   VARCHAR,
    direction          VARCHAR,
    interaction_status VARCHAR,
    business_object    TEXT,
    first_seen_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    last_seen_at       TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (attachment_id, edge_cell_id)
);

CREATE INDEX IF NOT EXISTS idx_cfl_diagram_int_attachment
    ON northstar.confluence_diagram_interaction (attachment_id);

CREATE INDEX IF NOT EXISTS idx_cfl_diagram_int_src
    ON northstar.confluence_diagram_interaction (source_cell_id);

CREATE INDEX IF NOT EXISTS idx_cfl_diagram_int_tgt
    ON northstar.confluence_diagram_interaction (target_cell_id);
