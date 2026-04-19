"""Add template_active column to confluence_attachment.

Revision ID: 003
Revises: 002
"""
from alembic import op
import sqlalchemy as sa

revision = "003_template_active"
down_revision = "002_business_capabilities"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("SET search_path TO northstar, public;")
    op.execute("""
        ALTER TABLE northstar.confluence_attachment
        ADD COLUMN IF NOT EXISTS template_active BOOLEAN DEFAULT TRUE;
    """)
    # Auto-deactivate obvious backups/copies for template attachments
    op.execute("""
        UPDATE northstar.confluence_attachment
        SET template_active = FALSE
        WHERE template_source_layer IS NOT NULL
          AND file_kind = 'drawio'
          AND (
              title LIKE 'Copy of%'
              OR title LIKE 'Copy of Copy of%'
              OR title LIKE '~%'
              OR title LIKE 'drawio-backup%'
          );
    """)


def downgrade() -> None:
    op.execute("SET search_path TO northstar, public;")
    op.execute("ALTER TABLE northstar.confluence_attachment DROP COLUMN IF EXISTS template_active;")
