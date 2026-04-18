-- 019_integration_interface.sql
--
-- Integration catalog master table — unified schema across 10 platforms
-- (WSO2, PO, Talend, Axway, Axway MFT, Goanywhere-job, Goanywhere-web user,
--  Data Service, APIH, KPaaS).
--
-- Data source: data/integration_catalog.xlsx (IT Operations Platform export)
-- Loader: scripts/load_integration_catalog.py
--
-- Schema philosophy: max-union. Every useful column from any platform is
-- represented as a typed column. Rare or truly platform-specific fields
-- park in raw_fields JSONB so no data is lost on ingest.
--
-- This replaces the drawio-extracted confluence_diagram_interaction as the
-- authoritative source of (:Application)-[:INTEGRATES_WITH]->(:Application)
-- edges. confluence_diagram_interaction is archived — see 019b + ops runbook.
--
-- Idempotent. Additive only.

SET search_path TO northstar, public;

CREATE TABLE IF NOT EXISTS integration_interface (
    interface_id            BIGSERIAL PRIMARY KEY,

    -- Identity + provenance
    integration_platform    TEXT NOT NULL,          -- WSO2 | PO | Talend | Axway | Axway MFT | ...
    interface_name          TEXT,                   -- the primary identifier per row
    source_row_hash         TEXT NOT NULL,          -- sha256 of canonicalized row; idempotency key
    source_row_num          INTEGER,                -- original Excel row number (for trace)

    -- Source / Target application linkage
    source_cmdb_id          TEXT,                   -- A-id
    target_cmdb_id          TEXT,
    source_app_name         TEXT,
    target_app_name         TEXT,
    source_account_name     TEXT,                   -- APIH/KPaaS Pub/Sub Account Name
    target_account_name     TEXT,

    -- Endpoints & network
    source_endpoint         TEXT,
    target_endpoint         TEXT,
    source_version          TEXT,
    target_version          TEXT,
    source_dc               TEXT,
    target_dc               TEXT,

    -- Application + connection type (protocol family)
    source_application_type TEXT,                   -- Self-Developed | Package Software | Cloud Application
    target_application_type TEXT,
    source_connection_type  TEXT,                   -- API | File | SOAP | Table | Email | Kafka | ...
    target_connection_type  TEXT,
    source_authentication   TEXT,                   -- Oauth 2.0 | certificate | Basic
    target_authentication   TEXT,

    -- Ownership & contacts
    interface_owner         TEXT,
    source_owner            TEXT,
    target_owner            TEXT,
    s_team_publicmail       TEXT,
    t_team_publicmail       TEXT,
    s_application_linemanager TEXT,
    t_application_linemanager TEXT,
    developer               TEXT,

    -- Operational
    frequency               TEXT,                   -- realtime | 定时 | event-driven
    schedule                TEXT,                   -- cron string
    status                  TEXT,                   -- MTP | SUNSET | init
    business_area           TEXT,
    interface_description   TEXT,
    location                TEXT,                   -- AWS Earth | Hohhot | ...

    -- API / topic specifics (WSO2 / APIH / KPaaS)
    api_name                TEXT,                   -- APIH Pub API Name
    topic_name              TEXT,                   -- KPaaS Pub Topic Name
    instance                TEXT,                   -- APIH/KPaaS Instance (cluster)
    api_postman_url         TEXT,
    api_spec                TEXT,
    api_payload_size        TEXT,
    source_payload_size     TEXT,
    target_payload_size     TEXT,

    -- File / mapping / code specifics
    data_mapping_file       TEXT,                   -- WSO2/PO/Goanywhere mapping file path
    base                    TEXT,                   -- Axway/Goanywhere base path
    git_project             TEXT,
    version                 TEXT,

    -- Misc metadata
    tag                     TEXT,

    -- Everything else (platform-specific oddities)
    raw_fields              JSONB,

    ingested_at             TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT integration_interface_uniq UNIQUE (integration_platform, source_row_hash)
);

-- Lookups by app
CREATE INDEX IF NOT EXISTS idx_intint_src_cmdb
    ON integration_interface (source_cmdb_id)
    WHERE source_cmdb_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_intint_tgt_cmdb
    ON integration_interface (target_cmdb_id)
    WHERE target_cmdb_id IS NOT NULL;

-- Lookups by platform / status
CREATE INDEX IF NOT EXISTS idx_intint_platform
    ON integration_interface (integration_platform);
CREATE INDEX IF NOT EXISTS idx_intint_status
    ON integration_interface (status);

-- Name-based fuzzy matching (pg_trgm)
-- Operator class unqualified so it resolves via search_path regardless of
-- whether pg_trgm lives in public or northstar.
CREATE INDEX IF NOT EXISTS idx_intint_src_name_trgm
    ON integration_interface USING gin (source_app_name gin_trgm_ops)
    WHERE source_app_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_intint_tgt_name_trgm
    ON integration_interface USING gin (target_app_name gin_trgm_ops)
    WHERE target_app_name IS NOT NULL;

-- Interface name lookup (architect searches for a specific interface)
CREATE INDEX IF NOT EXISTS idx_intint_name
    ON integration_interface (interface_name)
    WHERE interface_name IS NOT NULL;

COMMENT ON TABLE integration_interface IS
    'Unified integration interface catalog. Rows are per-interface records '
    'from 10 integration platforms (WSO2/PO/Talend/Axway/Axway MFT/'
    'Goanywhere-job/Goanywhere-web user/Data Service/APIH/KPaaS). '
    'Replaces drawio-extracted confluence_diagram_interaction as authoritative '
    'source of application integration edges.';

COMMENT ON COLUMN integration_interface.source_row_hash IS
    'sha256 of canonicalized row content (all non-null fields, sorted). '
    'Idempotency key for re-ingest.';

COMMENT ON COLUMN integration_interface.raw_fields IS
    'Platform-specific fields not mapped to typed columns. '
    'Key examples: source_trace_field, target_trace_field, '
    'source_application_inbound_sample, performance_report, '
    'return_code_description, PO Server地址.';
