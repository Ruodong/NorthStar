"""Alembic environment configuration for NorthStar.

DSN sourcing (in priority order):
  1. DATABASE_URL env var  — explicit override, used by env-sync to point at
     the shared 195 DB without touching .env (see env-sync SKILL.md).
  2. POSTGRES_DSN env var  — same value backend reads (set in compose).
  3. settings.postgres_dsn  — last-resort default.

Schema is always `northstar` (NorthStar's only schema). The version table
also lives there so a single `alembic_version` table tracks the schema head
on every deployment of NorthStar.
"""
import os
import sys
from logging.config import fileConfig
from pathlib import Path

import sqlalchemy
from alembic import context
from sqlalchemy import create_engine

# Make the `app` package importable for the fallback DSN read.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)


def _resolve_dsn() -> str:
    dsn = os.environ.get("DATABASE_URL") or os.environ.get("POSTGRES_DSN")
    if dsn:
        # asyncpg → sync driver swap (Alembic uses sync SQLAlchemy)
        return dsn.replace("postgresql+asyncpg://", "postgresql://")
    # Last-resort: import settings
    from app.config import settings  # type: ignore
    return settings.postgres_dsn.replace("postgresql+asyncpg://", "postgresql://")


SCHEMA = "northstar"
DB_URL = _resolve_dsn()


def run_migrations_offline() -> None:
    """Generate SQL without DB connection."""
    context.configure(
        url=DB_URL,
        target_metadata=None,
        literal_binds=True,
        version_table="alembic_version",
        version_table_schema=SCHEMA,
        include_schemas=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Connect to DB and apply migrations.

    SET search_path is issued INSIDE begin_transaction() to share the same
    transaction as the migration DDL — same trick EGM uses to avoid the
    SQLAlchemy 2.0 autobegin gotcha that silently rolls back DDL.
    """
    engine = create_engine(DB_URL)
    with engine.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=None,
            version_table="alembic_version",
            version_table_schema=SCHEMA,
            include_schemas=True,
        )
        with context.begin_transaction():
            connection.execute(sqlalchemy.text(f"SET search_path TO {SCHEMA}"))
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
