"""NorthStar FastAPI entry point."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import admin, aliases, analytics, graph, ingestion, masters, whats_new
from app.services import neo4j_client, pg_client

# SQL migrations directory — all *.sql files here are executed in alphabetical
# order on backend startup. Migrations must be idempotent (CREATE TABLE IF NOT
# EXISTS, ALTER TABLE ... ADD COLUMN IF NOT EXISTS, etc.) because they run on
# every container start, not just fresh volumes.
SQL_DIR = Path(__file__).resolve().parent.parent / "sql"


async def ensure_sql_migrations() -> None:
    """Apply all backend/sql/*.sql files on startup. Idempotent by convention."""
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
            # Log and continue — don't block startup on a single bad migration.
            # Idempotent CREATE/ALTER IF NOT EXISTS should never raise in practice.
            logger.error("SQL migration %s failed: %s", f.name, exc)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s - %(message)s")
logger = logging.getLogger(__name__)


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
app.include_router(whats_new.router)


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
