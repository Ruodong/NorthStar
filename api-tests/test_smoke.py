"""Smoke tests — must always pass. If these fail, something is broken
globally (backend down, PG down, Neo4j down). They run fast and give
a 1-second pulse check.
"""
from __future__ import annotations

import pytest


pytestmark = pytest.mark.smoke


@pytest.mark.asyncio
async def test_backend_health(api):
    r = await api.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body.get("status") == "ok"
    assert body.get("neo4j") == "up"


@pytest.mark.asyncio
async def test_backend_root(api):
    r = await api.get("/")
    assert r.status_code == 200
    body = r.json()
    assert body["service"] == "northstar-backend"


def test_pg_connected(pg):
    with pg.cursor() as cur:
        cur.execute("SELECT 1 AS ok")
        row = cur.fetchone()
    assert row["ok"] == 1


def test_pg_schema_exists(pg):
    with pg.cursor() as cur:
        cur.execute(
            "SELECT count(*) AS n FROM information_schema.tables "
            "WHERE table_schema = 'northstar'"
        )
        n = cur.fetchone()["n"]
    assert n > 0, "northstar schema has no tables"


def test_neo4j_connected(cypher):
    rows = cypher("RETURN 1 AS ok")
    assert rows[0]["ok"] == 1


def test_masters_summary_endpoint(api):
    import httpx
    # Use sync httpx here to keep this test simple
    r = httpx.get("http://localhost:8001/api/masters/summary", timeout=10)
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    assert "applications" in body["data"]
