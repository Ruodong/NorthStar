-- 018_architecture_template_source.sql
-- Phase 1 of the architecture-template-settings feature.
--
-- Adds:
--   1. ref_architecture_template_source — one row per architecture layer
--      (business / application / technical) holding the Confluence URL of the
--      EA template directory page + sync status.
--   2. template_source_layer columns on confluence_page + confluence_attachment
--      so the sync script can tag every page/attachment it discovers with the
--      layer it belongs to. Queried from the Settings page diagrams grid.
--   3. Relaxes confluence_page.fiscal_year to nullable (EA template pages have
--      no fiscal year).
--
-- Seeds three rows — AA and TA pre-populated with the directory URLs supplied
-- by the user; BA left blank.
--
-- All statements idempotent per CLAUDE.md § Schema Evolution.

SET search_path TO northstar, public;

-- ── ref_architecture_template_source ────────────────────────────

CREATE TABLE IF NOT EXISTS ref_architecture_template_source (
    layer                VARCHAR PRIMARY KEY
        CHECK (layer IN ('business', 'application', 'technical')),
    title                VARCHAR      NOT NULL DEFAULT '',
    confluence_url       VARCHAR      NOT NULL DEFAULT '',
    confluence_page_id   VARCHAR,
    last_synced_at       TIMESTAMPTZ,
    last_sync_status     VARCHAR,
    last_sync_error      TEXT,
    notes                TEXT,
    updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Seed — uses ON CONFLICT DO NOTHING so reruns don't stomp user edits.
INSERT INTO ref_architecture_template_source (layer, title, confluence_url) VALUES
    ('business',    '',                      ''),
    ('application', 'AA Document Templates', 'https://km.xpaas.lenovo.com/display/EA/AA%3A+Document+Templates'),
    ('technical',   'TA Document Templates', 'https://km.xpaas.lenovo.com/display/EA/TA%3A+Document+Templates')
ON CONFLICT (layer) DO NOTHING;

-- ── confluence_page changes ─────────────────────────────────────

-- Relax fiscal_year to nullable — EA template pages don't belong to a FY.
-- ALTER COLUMN DROP NOT NULL is idempotent when the column is already nullable.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'northstar'
          AND table_name   = 'confluence_page'
          AND column_name  = 'fiscal_year'
          AND is_nullable  = 'NO'
    ) THEN
        ALTER TABLE northstar.confluence_page
            ALTER COLUMN fiscal_year DROP NOT NULL;
    END IF;
END
$$;

ALTER TABLE northstar.confluence_page
    ADD COLUMN IF NOT EXISTS template_source_layer VARCHAR;

CREATE INDEX IF NOT EXISTS idx_cfl_page_template_layer
    ON northstar.confluence_page (template_source_layer)
    WHERE template_source_layer IS NOT NULL;

-- ── confluence_attachment changes ───────────────────────────────

ALTER TABLE northstar.confluence_attachment
    ADD COLUMN IF NOT EXISTS template_source_layer VARCHAR;

CREATE INDEX IF NOT EXISTS idx_cfl_att_template_layer
    ON northstar.confluence_attachment (template_source_layer)
    WHERE template_source_layer IS NOT NULL;

COMMENT ON COLUMN northstar.confluence_page.template_source_layer IS
    'If set, the architecture layer (business/application/technical) that this '
    'EA template page belongs to. NULL for regular project review pages.';

COMMENT ON COLUMN northstar.confluence_attachment.template_source_layer IS
    'Mirrors confluence_page.template_source_layer so the Settings page can '
    'filter drawio attachments by layer without an extra join.';
