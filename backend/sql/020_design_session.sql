-- 020_design_session.sql
--
-- Architecture Design module — persistent design sessions.
--
-- An architect creates a "design" = a drawio canvas bootstrapped from real
-- CMDB + integration_catalog data. They pick a template, pick applications
-- (optionally by business capability), pick relevant interfaces, and the
-- system generates an as-is drawio XML. The architect then edits the XML
-- in a draw.io embed to reach the to-be architecture.
--
-- Three tables:
--   design_session   — top-level design metadata + drawio XML
--   design_app       — apps included in the design (scope)
--   design_interface — interfaces included in the design (edges)
--
-- Idempotent. Additive only.

SET search_path TO northstar, public;

-- ──────────────────────────────────────────────────────────────────
-- design_session: one row per design
-- ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS design_session (
    design_id             BIGSERIAL PRIMARY KEY,
    name                  TEXT NOT NULL,
    description           TEXT,
    fiscal_year           TEXT,

    -- Optional link to an MSPO project; design can exist standalone
    project_id            TEXT,

    -- Which template was used to bootstrap (by Confluence attachment id).
    -- NULL = blank canvas.
    template_attachment_id BIGINT,

    -- Owner (itcode). Hardcoded for MVP; SSO integration later.
    owner_itcode          TEXT,

    status                TEXT NOT NULL DEFAULT 'draft',
    -- draft | in_review | approved | archived

    -- Canvas state:
    --   as_is_snapshot_xml = the XML produced at initial generation.
    --     Used as baseline for diff. Never modified.
    --   drawio_xml         = current canvas state as architect edited.
    as_is_snapshot_xml    TEXT,
    drawio_xml            TEXT,

    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT design_session_status_chk
        CHECK (status IN ('draft', 'in_review', 'approved', 'archived'))
);

CREATE INDEX IF NOT EXISTS idx_design_session_owner
    ON design_session (owner_itcode)
    WHERE owner_itcode IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_design_session_project
    ON design_session (project_id)
    WHERE project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_design_session_status
    ON design_session (status);


-- ──────────────────────────────────────────────────────────────────
-- design_app: applications included in a design's scope
-- ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS design_app (
    design_id        BIGINT NOT NULL,

    -- app_id can be a CMDB A-id OR an architect-supplied virtual id for
    -- a not-yet-registered new app (role='external' case).
    app_id           TEXT NOT NULL,

    -- Role in the design:
    --   primary    — the app this design centers on
    --   related    — one-hop neighbor brought in for context
    --   external   — virtual app not in CMDB (architect-added)
    role             TEXT NOT NULL DEFAULT 'primary',

    -- Planned status relative to the design target state:
    --   keep   — no changes planned
    --   change — existing app, changes planned
    --   new    — net-new application
    --   sunset — planned to retire
    planned_status   TEXT NOT NULL DEFAULT 'keep',

    -- Optional capability tag — which BC slot this app fills.
    -- NULL when not selected via capability or untagged.
    bc_id            TEXT,

    -- Architect annotation
    notes            TEXT,

    added_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (design_id, app_id),
    CONSTRAINT design_app_role_chk
        CHECK (role IN ('primary', 'related', 'external')),
    CONSTRAINT design_app_status_chk
        CHECK (planned_status IN ('keep', 'change', 'new', 'sunset')),
    CONSTRAINT design_app_session_fk
        FOREIGN KEY (design_id) REFERENCES design_session(design_id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_design_app_app
    ON design_app (app_id);


-- ──────────────────────────────────────────────────────────────────
-- design_interface: integration edges in the design
-- ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS design_interface (
    design_iface_id  BIGSERIAL PRIMARY KEY,
    design_id        BIGINT NOT NULL,

    -- FK to integration_interface.interface_id when the edge is imported
    -- from the catalog. NULL for architect-added new interfaces.
    interface_id     BIGINT,

    from_app         TEXT NOT NULL,
    to_app           TEXT NOT NULL,

    platform         TEXT,
    interface_name   TEXT,

    -- planned_status: keep | change | new | sunset
    planned_status   TEXT NOT NULL DEFAULT 'keep',

    -- Architect notes / additional metadata
    metadata_json    JSONB,

    added_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT design_iface_status_chk
        CHECK (planned_status IN ('keep', 'change', 'new', 'sunset')),
    CONSTRAINT design_iface_session_fk
        FOREIGN KEY (design_id) REFERENCES design_session(design_id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_design_iface_design
    ON design_interface (design_id);

CREATE INDEX IF NOT EXISTS idx_design_iface_endpoints
    ON design_interface (design_id, from_app, to_app);

CREATE INDEX IF NOT EXISTS idx_design_iface_ref
    ON design_interface (interface_id)
    WHERE interface_id IS NOT NULL;


-- ──────────────────────────────────────────────────────────────────
-- Keep updated_at fresh on design_session
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION northstar.design_session_touch_updated_at()
    RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'design_session_touch_tr'
    ) THEN
        CREATE TRIGGER design_session_touch_tr
            BEFORE UPDATE ON northstar.design_session
            FOR EACH ROW
            EXECUTE FUNCTION northstar.design_session_touch_updated_at();
    END IF;
END $$;


COMMENT ON TABLE design_session IS
    'Architecture design sessions. Each row = one design artifact, with '
    'initial AS-IS drawio snapshot + current editable XML.';

COMMENT ON TABLE design_app IS
    'Applications in a design scope. CMDB-linked (A-id) or architect-added '
    '(external virtual id). Role tags primary vs related vs external.';

COMMENT ON TABLE design_interface IS
    'Integration edges in a design. References integration_interface for '
    'edges from the catalog; interface_id IS NULL means architect-added.';
