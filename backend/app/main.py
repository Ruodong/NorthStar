"""NorthStar FastAPI entry point."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import admin, analytics, graph, ingestion, masters
from app.services import neo4j_client, pg_client

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s - %(message)s")
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        await neo4j_client.connect()
        await neo4j_client.ensure_schema()
        logger.info("Neo4j ready; schema constraints/indexes ensured")
    except Exception as exc:  # noqa: BLE001
        logger.error("Neo4j bootstrap failed: %s", exc)
    try:
        await pg_client.connect()
        logger.info("Postgres pool ready")
    except Exception as exc:  # noqa: BLE001
        logger.error("Postgres bootstrap failed: %s", exc)
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
