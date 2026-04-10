"""Postgres async connection pool for NorthStar master data."""
from __future__ import annotations

import logging
from typing import Any, Optional

import asyncpg

from app.config import settings

logger = logging.getLogger(__name__)

_pool: Optional[asyncpg.Pool] = None


async def connect() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        logger.info("Connecting to Postgres")
        _pool = await asyncpg.create_pool(
            dsn=settings.postgres_dsn,
            min_size=1,
            max_size=10,
            command_timeout=30,
        )
    return _pool


async def close() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


async def fetch(sql: str, *args: Any) -> list[asyncpg.Record]:
    pool = await connect()
    async with pool.acquire() as conn:
        return await conn.fetch(sql, *args)


async def fetchrow(sql: str, *args: Any) -> Optional[asyncpg.Record]:
    pool = await connect()
    async with pool.acquire() as conn:
        return await conn.fetchrow(sql, *args)


async def fetchval(sql: str, *args: Any) -> Any:
    pool = await connect()
    async with pool.acquire() as conn:
        return await conn.fetchval(sql, *args)
