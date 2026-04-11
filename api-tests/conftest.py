"""Shared pytest fixtures for NorthStar api-tests.

Tests exercise the running backend (http://localhost:8001 by default)
against the real Postgres + Neo4j containers. No mocks. Run from the
host that has docker compose up, typically 71:

    ssh northstar-server
    cd ~/NorthStar
    set -a && source .env && set +a
    .venv-tests/bin/python -m pytest api-tests/ -v

Environment overrides:
    NORTHSTAR_API_URL         default http://localhost:8001
    NORTHSTAR_PG_DSN          default host=localhost port=5434 ...
    NORTHSTAR_NEO4J_URI       default bolt://localhost:7687
    NORTHSTAR_NEO4J_PASSWORD  default northstar_dev
"""
from __future__ import annotations

import os
from typing import AsyncIterator, Iterator

import httpx
import psycopg
import pytest
import pytest_asyncio
from neo4j import GraphDatabase
from psycopg.rows import dict_row


# -----------------------------------------------------------------------------
# Environment / config
# -----------------------------------------------------------------------------

API_URL = os.environ.get("NORTHSTAR_API_URL", "http://localhost:8001")
PG_DSN = os.environ.get(
    "NORTHSTAR_PG_DSN",
    "host={} port={} dbname={} user={} password={}".format(
        os.environ.get("NORTHSTAR_PG_HOST", "localhost"),
        os.environ.get("NORTHSTAR_PG_PORT", "5434"),
        os.environ.get("NORTHSTAR_PG_DB", "northstar"),
        os.environ.get("NORTHSTAR_PG_USER", "northstar"),
        os.environ.get("POSTGRES_PASSWORD", "northstar_dev"),
    ),
)
NEO4J_URI = os.environ.get("NORTHSTAR_NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER = os.environ.get("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.environ.get("NEO4J_PASSWORD", "northstar_dev")


# -----------------------------------------------------------------------------
# HTTP client
# -----------------------------------------------------------------------------

@pytest_asyncio.fixture
async def api() -> AsyncIterator[httpx.AsyncClient]:
    """Function-scoped async HTTP client pointed at the running backend.

    Function scope keeps the httpx client bound to the current event loop,
    avoiding the pytest-asyncio <0.24 "Event loop is closed" trap when a
    session-scoped client is reused across tests that each spin their own loop.
    """
    async with httpx.AsyncClient(base_url=API_URL, timeout=15.0) as client:
        yield client


# -----------------------------------------------------------------------------
# Postgres (sync, for out-of-band state assertions)
# -----------------------------------------------------------------------------

@pytest.fixture(scope="session")
def pg() -> Iterator[psycopg.Connection]:
    """Session-scoped sync connection. Tests should only read, not write."""
    conn = psycopg.connect(PG_DSN, row_factory=dict_row)
    try:
        yield conn
    finally:
        conn.close()


# -----------------------------------------------------------------------------
# Neo4j (sync, for Cypher assertions alongside HTTP API tests)
# -----------------------------------------------------------------------------

@pytest.fixture(scope="session")
def neo4j_driver():
    driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))
    driver.verify_connectivity()
    try:
        yield driver
    finally:
        driver.close()


@pytest.fixture
def cypher(neo4j_driver):
    """Convenience fixture: run a read-only Cypher query and return list[dict]."""
    def _run(q: str, **params):
        with neo4j_driver.session() as s:
            result = s.run(q, **params)
            return [dict(r) for r in result]
    return _run


# -----------------------------------------------------------------------------
# Markers
# -----------------------------------------------------------------------------
def pytest_configure(config):
    config.addinivalue_line("markers", "ontology: tests for the ontology-fix feature")
    config.addinivalue_line("markers", "smoke: fast smoke tests that should always pass")
    config.addinivalue_line("markers", "slow: tests that take more than a few seconds")
