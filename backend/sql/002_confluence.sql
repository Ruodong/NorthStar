-- Confluence raw data tables — populated by scripts/scan_confluence.py
-- Runs via the host venv (needs VPN access). Writes to NorthStar postgres.

SET search_path TO northstar, public;

-- Mirror of each Confluence page discovered under an FY parent.
-- Pages come in two types — see page_type column:
--   'project'     — normal LI/RD/TECHLED/FY-numbered project review page
--   'application' — A<id> review page (architecture for a single CMDB app)
--   'other'       — template, index, FAQ, orphan
CREATE TABLE IF NOT EXISTS confluence_page (
    page_id         VARCHAR PRIMARY KEY,         -- Confluence content id
    fiscal_year     VARCHAR NOT NULL,
    title           VARCHAR NOT NULL,
    project_id      VARCHAR,                     -- LI\d+ / RD\d+ extracted from title
    page_url        VARCHAR NOT NULL,            -- full https://... URL
    body_html       TEXT,                        -- raw Confluence storage format
    body_text       TEXT,                        -- plain text for search
    body_questionnaire JSONB,                    -- parsed Q&A structure
    body_size_chars INT,
    q_project_id    VARCHAR,                     -- from questionnaire Metadata section
    q_project_name  VARCHAR,
    q_pm            VARCHAR,
    q_it_lead       VARCHAR,
    q_dt_lead       VARCHAR,
    q_app_id        VARCHAR,                     -- A\d+ extracted from title (CMDB id)
    page_type       VARCHAR,                     -- project | application | other
    last_seen       TIMESTAMP DEFAULT NOW(),
    synced_at       TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cfl_page_fy ON confluence_page (fiscal_year);
CREATE INDEX IF NOT EXISTS idx_cfl_page_project ON confluence_page (project_id);
CREATE INDEX IF NOT EXISTS idx_cfl_page_qproj ON confluence_page (q_project_id);
CREATE INDEX IF NOT EXISTS idx_cfl_page_qappid ON confluence_page (q_app_id);
CREATE INDEX IF NOT EXISTS idx_cfl_page_type ON confluence_page (page_type);

-- Every attachment on every scanned page. file_kind is a coarse category
-- used by the frontend to decide how to preview (drawio/image/pdf/office/other).
CREATE TABLE IF NOT EXISTS confluence_attachment (
    attachment_id   VARCHAR PRIMARY KEY,
    page_id         VARCHAR NOT NULL REFERENCES confluence_page(page_id) ON DELETE CASCADE,
    title           VARCHAR NOT NULL,
    media_type      VARCHAR NOT NULL,
    file_kind       VARCHAR NOT NULL,            -- drawio|image|pdf|office|xml|other
    file_size       BIGINT,
    version         INT,
    download_path   VARCHAR NOT NULL,            -- /download/attachments/.../file?version=...
    local_path      VARCHAR,                     -- path on disk under data/attachments
    last_seen       TIMESTAMP DEFAULT NOW(),
    synced_at       TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cfl_att_page ON confluence_attachment (page_id);
CREATE INDEX IF NOT EXISTS idx_cfl_att_kind ON confluence_attachment (file_kind);
