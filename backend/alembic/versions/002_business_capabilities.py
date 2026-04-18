"""business capabilities tables

Revision ID: 002_business_capabilities
Revises: 001_baseline
Create Date: 2026-04-18
"""
from alembic import op

revision = "002_business_capabilities"
down_revision = "001_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("SET search_path TO northstar, public;")
    op.execute("""
        CREATE TABLE IF NOT EXISTS northstar.ref_business_capability (
            id                    BIGINT      PRIMARY KEY,
            data_version          VARCHAR(32) NOT NULL DEFAULT '',
            bc_id                 VARCHAR(64) NOT NULL,
            parent_bc_id          VARCHAR(64) NOT NULL DEFAULT 'root',
            bc_name               TEXT        NOT NULL,
            bc_name_cn            TEXT,
            level                 SMALLINT    NOT NULL,
            alias                 TEXT,
            bc_description        TEXT,
            biz_group             TEXT,
            geo                   TEXT,
            biz_owner             TEXT,
            biz_team              TEXT,
            dt_owner              TEXT,
            dt_team               TEXT,
            lv1_domain            TEXT        NOT NULL DEFAULT '',
            lv2_sub_domain        TEXT,
            lv3_capability_group  TEXT,
            remark                TEXT,
            source_created_at     TIMESTAMPTZ,
            synced_at             TIMESTAMPTZ NOT NULL DEFAULT now()
        );
    """)
    op.execute("""
        CREATE TABLE IF NOT EXISTS northstar.ref_app_business_capability (
            id                 UUID        PRIMARY KEY,
            app_id             VARCHAR(64) NOT NULL,
            bcpf_master_id     BIGINT      NOT NULL,
            bc_id              VARCHAR(64),
            data_version       VARCHAR(32),
            source_create_by   TEXT,
            source_update_by   TEXT,
            source_created_at  TIMESTAMPTZ,
            source_updated_at  TIMESTAMPTZ,
            synced_at          TIMESTAMPTZ NOT NULL DEFAULT now()
        );
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_ref_bc_bc_id
            ON northstar.ref_business_capability (bc_id);
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_ref_bc_level_domain
            ON northstar.ref_business_capability (level, lv1_domain);
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_ref_app_bc_app_id
            ON northstar.ref_app_business_capability (app_id);
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_ref_app_bc_bcpf_id
            ON northstar.ref_app_business_capability (bcpf_master_id);
    """)


def downgrade() -> None:
    op.execute("SET search_path TO northstar, public;")
    op.execute("DROP TABLE IF EXISTS northstar.ref_app_business_capability;")
    op.execute("DROP TABLE IF EXISTS northstar.ref_business_capability;")
