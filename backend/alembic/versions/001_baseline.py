"""baseline — pre-Alembic flat SQL migrations 001..018

This Alembic revision is intentionally a no-op. Everything up to and
including `backend/sql/018_enable_age.sql` is the baseline state of the
schema, applied at backend startup by `ensure_sql_migrations()` from the
flat SQL files (additive + idempotent, see CLAUDE.md § Schema Evolution).

What this file gives us going forward:
  - `northstar.alembic_version` table is created with revision = 001_baseline
  - New schema changes go through Alembic from `002_*` onwards
  - env-sync can ask `alembic current` to compare local DB head vs 195's
    head without inspecting backend logs or guessing from filenames

Revision ID: 001_baseline
Revises: (none — this IS the baseline)
"""

revision = "001_baseline"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    """No-op. Baseline is established by `ensure_sql_migrations()` running
    the existing flat SQL files at backend startup."""
    pass


def downgrade() -> None:
    """No downgrade for the baseline — would mean wiping the entire schema."""
    pass
