-- 014_image_vision_extract.sql
-- Phase 2: persistence tables for image-vision-extract.
-- Mirrors confluence_diagram_app / _interaction schema so the /extracted
-- endpoint can union drawio + vision results in one query.
--
-- Spec: .specify/features/image-vision-extract/spec.md (Phase 2)

SET search_path TO northstar, public;

-- Apps extracted from PNG/JPEG architecture diagrams via LLM vision.
-- cell_id is synthetic ("v_0", "v_1", ...) since images don't have cells.
CREATE TABLE IF NOT EXISTS confluence_image_extract_app (
    attachment_id   VARCHAR NOT NULL,
    cell_id         VARCHAR NOT NULL,       -- "v_0", "v_1", ...
    app_name        VARCHAR NOT NULL,
    standard_id     VARCHAR,                -- A-id if LLM detected one
    application_status VARCHAR,             -- Keep/Change/New/Sunset/Unknown
    functions       TEXT,                    -- comma-separated sub-modules
    diagram_type    VARCHAR,                -- app_arch / tech_arch / unknown
    fill_color      VARCHAR,                -- not used for vision, kept for schema compat
    first_seen_at   TIMESTAMP NOT NULL DEFAULT now(),
    last_seen_at    TIMESTAMP NOT NULL DEFAULT now(),
    -- Resolver columns (same as confluence_diagram_app)
    resolved_app_id VARCHAR,
    match_type      VARCHAR,
    name_similarity REAL,
    PRIMARY KEY (attachment_id, cell_id)
);

CREATE INDEX IF NOT EXISTS idx_ciea_attachment
    ON confluence_image_extract_app (attachment_id);
CREATE INDEX IF NOT EXISTS idx_ciea_std
    ON confluence_image_extract_app (standard_id)
    WHERE standard_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ciea_resolved
    ON confluence_image_extract_app (resolved_app_id)
    WHERE resolved_app_id IS NOT NULL;

-- Interactions (edges) extracted from PNG/JPEG architecture diagrams.
CREATE TABLE IF NOT EXISTS confluence_image_extract_interaction (
    attachment_id       VARCHAR NOT NULL,
    edge_cell_id        VARCHAR NOT NULL,   -- "ve_0", "ve_1", ...
    source_cell_id      VARCHAR,            -- matches cell_id in _app table
    target_cell_id      VARCHAR,            -- matches cell_id in _app table
    source_app_name     VARCHAR,
    target_app_name     VARCHAR,
    interaction_type    VARCHAR,            -- Command/Query/Event/Embed/...
    direction           VARCHAR,            -- left-to-right / right-to-left / bidirectional
    business_object     VARCHAR,
    interface_status    VARCHAR,            -- Exist/Changed/New
    first_seen_at       TIMESTAMP NOT NULL DEFAULT now(),
    last_seen_at        TIMESTAMP NOT NULL DEFAULT now(),
    PRIMARY KEY (attachment_id, edge_cell_id)
);

CREATE INDEX IF NOT EXISTS idx_ciei_attachment
    ON confluence_image_extract_interaction (attachment_id);
