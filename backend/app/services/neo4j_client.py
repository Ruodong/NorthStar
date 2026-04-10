"""Neo4j async driver wrapper with lifecycle + schema bootstrap."""
from __future__ import annotations

import logging
from typing import Any, Optional

from neo4j import AsyncDriver, AsyncGraphDatabase

from app.config import settings

logger = logging.getLogger(__name__)

_driver: Optional[AsyncDriver] = None


SCHEMA_STATEMENTS: list[str] = [
    "CREATE CONSTRAINT app_id_unique IF NOT EXISTS FOR (a:Application) REQUIRE a.app_id IS UNIQUE",
    "CREATE CONSTRAINT project_id_unique IF NOT EXISTS FOR (p:Project) REQUIRE p.project_id IS UNIQUE",
    "CREATE INDEX app_status_idx IF NOT EXISTS FOR (a:Application) ON (a.status)",
    "CREATE INDEX app_fy_idx IF NOT EXISTS FOR (a:Application) ON (a.source_fiscal_year)",
]


async def connect() -> AsyncDriver:
    global _driver
    if _driver is None:
        logger.info("Connecting to Neo4j at %s", settings.neo4j_uri)
        _driver = AsyncGraphDatabase.driver(
            settings.neo4j_uri,
            auth=(settings.neo4j_user, settings.neo4j_password),
        )
        await _driver.verify_connectivity()
    return _driver


async def close() -> None:
    global _driver
    if _driver is not None:
        await _driver.close()
        _driver = None


async def ensure_schema() -> None:
    driver = await connect()
    async with driver.session() as session:
        for stmt in SCHEMA_STATEMENTS:
            try:
                await session.run(stmt)
            except Exception as exc:  # noqa: BLE001
                logger.warning("Schema statement failed (%s): %s", stmt, exc)


async def run_query(cypher: str, params: Optional[dict[str, Any]] = None) -> list[dict[str, Any]]:
    driver = await connect()
    async with driver.session() as session:
        result = await session.run(cypher, params or {})
        records = [record.data() async for record in result]
    return records


async def run_write(cypher: str, params: Optional[dict[str, Any]] = None) -> None:
    driver = await connect()
    async with driver.session() as session:
        await session.run(cypher, params or {})
