"""NorthStar FastAPI entry point."""
from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import (
    admin,
    aliases,
    analytics,
    business_capabilities,
    design,
    ea_documents,
    graph,
    ingestion,
    masters,
    search,
    settings as settings_router,
    whats_new,
)
from app.services import neo4j_client, pg_client

# SQL migrations directory — all *.sql files here are executed in alphabetical
# order on backend startup. Migrations must be idempotent (CREATE TABLE IF NOT
# EXISTS, ALTER TABLE ... ADD COLUMN IF NOT EXISTS, etc.) because they run on
# every container start, not just fresh volumes.
SQL_DIR = Path(__file__).resolve().parent.parent / "sql"


async def ensure_sql_migrations() -> None:
    """Apply all backend/sql/*.sql files on startup. Idempotent by convention.

    After the flat SQL files run, also ensure the Alembic version-tracking
    table (`northstar.alembic_version`) exists and is stamped at the
    baseline `001_baseline`. This is the bridge from "flat-SQL-only" to
    Alembic-managed schema — see backend/alembic/versions/001_baseline.py.
    New migrations from `002_*` onwards run via `alembic upgrade head`
    (NOT auto-applied at startup; deliberately gated through env-sync).
    """
    if not SQL_DIR.is_dir():
        logger.warning("SQL migrations dir not found: %s", SQL_DIR)
        return
    files = sorted(SQL_DIR.glob("*.sql"))
    for f in files:
        try:
            sql = f.read_text(encoding="utf-8")
            await pg_client.execute_script(sql)
            logger.info("applied SQL migration: %s", f.name)
        except Exception as exc:  # noqa: BLE001
            logger.error("SQL migration %s failed: %s", f.name, exc)

    # Alembic baseline stamp — idempotent. Creates table if missing,
    # inserts '001_baseline' if no row, leaves it alone if anything is set.
    try:
        await pg_client.execute_script(
            """
            CREATE TABLE IF NOT EXISTS northstar.alembic_version (
                version_num VARCHAR(32) PRIMARY KEY
            );
            INSERT INTO northstar.alembic_version (version_num)
            SELECT '001_baseline'
            WHERE NOT EXISTS (SELECT 1 FROM northstar.alembic_version);
            """
        )
        logger.info("alembic_version stamped (baseline=001_baseline if absent)")
    except Exception as exc:  # noqa: BLE001
        logger.error("alembic_version bootstrap failed: %s", exc)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s - %(message)s")
logger = logging.getLogger(__name__)


def _purge_stale_preview_tmp() -> None:
    """Delete orphaned `.pdf.tmp` files left behind when the backend
    was killed mid-conversion. Spec: office-preview EC-7.

    If the directory doesn't exist yet (first-boot, or running outside
    a container that mounted the cache volume) this is a silent no-op.
    """
    from pathlib import Path as _Path
    cache_root = _Path(os.environ.get("PREVIEW_CACHE_ROOT", "/app_cache/preview"))
    if not cache_root.is_dir():
        return
    removed = 0
    for tmp in cache_root.glob("*.pdf.tmp"):
        try:
            tmp.unlink()
            removed += 1
        except OSError as exc:
            logger.warning("could not remove stale preview tmp %s: %s", tmp, exc)
    if removed:
        logger.info("purged %d stale preview .pdf.tmp files", removed)


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        await pg_client.connect()
        logger.info("Postgres pool ready")
        await ensure_sql_migrations()
    except Exception as exc:  # noqa: BLE001
        logger.error("Postgres bootstrap failed: %s", exc)
    try:
        await neo4j_client.connect()
        await neo4j_client.ensure_schema()
        logger.info("Neo4j ready; schema constraints/indexes ensured")
    except Exception as exc:  # noqa: BLE001
        logger.error("Neo4j bootstrap failed: %s", exc)
    try:
        _purge_stale_preview_tmp()
    except Exception as exc:  # noqa: BLE001
        logger.error("preview tmp cleanup failed: %s", exc)
    yield
    await neo4j_client.close()
    await pg_client.close()


app = FastAPI(title="NorthStar API", version="0.1.0", lifespan=lifespan)

origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins or ["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(graph.router)
app.include_router(analytics.router)
app.include_router(ingestion.router)
app.include_router(masters.router)
app.include_router(admin.router)
app.include_router(aliases.router)
app.include_router(business_capabilities.router)
app.include_router(whats_new.router)
app.include_router(search.router)
app.include_router(ea_documents.router)
app.include_router(settings_router.router)
app.include_router(design.router)


@app.get("/")
async def root() -> dict:
    return {"service": "northstar-backend", "version": "0.1.0"}


@app.get("/health")
async def health() -> dict:
    try:
        await neo4j_client.run_query("RETURN 1 AS ok")
        return {"status": "ok", "neo4j": "up"}
    except Exception as exc:  # noqa: BLE001
        return {"status": "degraded", "neo4j": f"down: {exc}"}
