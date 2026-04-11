-- 008_page_app_link.sql — many-to-many link between confluence pages and apps
-- Spec: .specify/features/confluence-multi-app-page/spec.md
--
-- Backfill happens via scripts/backfill_page_app_link.py, not in SQL,
-- because the regex rules live in Python (scripts/title_parser.py).
-- Idempotent.

SET search_path TO northstar, public;

CREATE TABLE IF NOT EXISTS northstar.confluence_page_app_link (
    page_id     VARCHAR NOT NULL,
    app_id      VARCHAR NOT NULL,
    source      VARCHAR NOT NULL,
    created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (page_id, app_id)
);

CREATE INDEX IF NOT EXISTS idx_cfl_page_app_link_app
    ON northstar.confluence_page_app_link (app_id);

CREATE INDEX IF NOT EXISTS idx_cfl_page_app_link_source
    ON northstar.confluence_page_app_link (source);
