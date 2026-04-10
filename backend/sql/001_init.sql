-- NorthStar Postgres schema — master data mirrored from EGM + NorthStar own tables.
-- This file runs automatically on first startup of the northstar-postgres container.

CREATE SCHEMA IF NOT EXISTS northstar;
SET search_path TO northstar, public;

-- =============================================================================
-- Master data (seeded from EGM)
-- =============================================================================

-- Application master (copied from egm.cmdb_application, 3168 rows)
CREATE TABLE IF NOT EXISTS ref_application (
    app_id              VARCHAR PRIMARY KEY,
    name                VARCHAR NOT NULL,
    short_description   TEXT,
    status              VARCHAR DEFAULT 'Active',
    synced_at           TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ref_app_name ON ref_application (name);
CREATE INDEX IF NOT EXISTS idx_ref_app_status ON ref_application (status);

-- Employee master (copied from egm.employee_info, 79k rows)
CREATE TABLE IF NOT EXISTS ref_employee (
    itcode          VARCHAR(255) PRIMARY KEY,
    name            VARCHAR,
    email           VARCHAR,
    job_role        VARCHAR,
    worker_type     VARCHAR,
    country         VARCHAR,
    tier_1_org      VARCHAR,
    tier_2_org      VARCHAR,
    manager_itcode  VARCHAR,
    manager_name    VARCHAR,
    synced_at       TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ref_emp_name ON ref_employee (name);
CREATE INDEX IF NOT EXISTS idx_ref_emp_tier1 ON ref_employee (tier_1_org);
CREATE INDEX IF NOT EXISTS idx_ref_emp_manager ON ref_employee (manager_itcode);

-- Project master (copied from egm.project, 2356 rows — MSPO data)
CREATE TABLE IF NOT EXISTS ref_project (
    project_id      VARCHAR PRIMARY KEY,
    project_name    VARCHAR,
    type            VARCHAR,
    status          VARCHAR,
    pm              VARCHAR,
    pm_itcode       VARCHAR,
    dt_lead         VARCHAR,
    dt_lead_itcode  VARCHAR,
    it_lead         VARCHAR,
    it_lead_itcode  VARCHAR,
    start_date      VARCHAR,
    go_live_date    VARCHAR,
    end_date        VARCHAR,
    ai_related      VARCHAR,
    source          VARCHAR,
    synced_at       TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ref_proj_status ON ref_project (status);
CREATE INDEX IF NOT EXISTS idx_ref_proj_pm_itcode ON ref_project (pm_itcode);

-- EGM parsed diagram apps (copied from egm.architecture_diagram_application, 297 rows)
CREATE TABLE IF NOT EXISTS ref_diagram_app (
    id                  UUID PRIMARY KEY,
    diagram_id          UUID NOT NULL,
    app_id              VARCHAR,        -- cell-level ID
    app_name            VARCHAR NOT NULL,
    id_is_standard      BOOLEAN DEFAULT FALSE,
    standard_id         VARCHAR DEFAULT '',
    functions           TEXT[],
    application_status  VARCHAR,
    synced_at           TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ref_diagram_app_diagram ON ref_diagram_app (diagram_id);
CREATE INDEX IF NOT EXISTS idx_ref_diagram_app_std ON ref_diagram_app (standard_id);

-- EGM parsed interactions (copied from egm.architecture_diagram_interaction, 241 rows)
CREATE TABLE IF NOT EXISTS ref_diagram_interaction (
    id                  UUID PRIMARY KEY,
    diagram_id          UUID NOT NULL,
    source_app_id       VARCHAR,
    target_app_id       VARCHAR,
    interaction_type    VARCHAR,
    direction           VARCHAR,
    source_function     VARCHAR DEFAULT '',
    target_function     VARCHAR DEFAULT '',
    interface_status    VARCHAR,
    business_object     VARCHAR DEFAULT '',
    synced_at           TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ref_diagram_int_diagram ON ref_diagram_interaction (diagram_id);
CREATE INDEX IF NOT EXISTS idx_ref_diagram_int_src ON ref_diagram_interaction (source_app_id);
CREATE INDEX IF NOT EXISTS idx_ref_diagram_int_tgt ON ref_diagram_interaction (target_app_id);

-- EGM architecture_diagram meta (so we can trace diagram_id → request/project)
CREATE TABLE IF NOT EXISTS ref_diagram (
    id              UUID PRIMARY KEY,
    request_id      UUID NOT NULL,
    diagram_type    VARCHAR NOT NULL,
    file_name       VARCHAR,
    create_at       TIMESTAMP,
    synced_at       TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ref_diagram_request ON ref_diagram (request_id);

-- =============================================================================
-- Sync audit
-- =============================================================================
CREATE TABLE IF NOT EXISTS sync_run (
    id          SERIAL PRIMARY KEY,
    source      VARCHAR NOT NULL,      -- e.g. 'egm-postgres'
    table_name  VARCHAR NOT NULL,
    rows_copied INT DEFAULT 0,
    started_at  TIMESTAMP DEFAULT NOW(),
    finished_at TIMESTAMP,
    status      VARCHAR DEFAULT 'running',
    error       TEXT
);
