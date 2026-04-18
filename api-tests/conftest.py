"""Shared pytest fixtures for NorthStar api-tests.

Tests exercise the running backend (http://localhost:8001 by default)
against the real Postgres container (which includes the AGE graph
extension). No mocks. Run from the host that has docker compose up,
typically 71:

    ssh northstar-server
    cd ~/NorthStar
    set -a && source .env && set +a
    .venv-tests/bin/python -m pytest api-tests/ -v

Environment overrides:
    NORTHSTAR_API_URL    default http://localhost:8001
    NORTHSTAR_PG_DSN     default host=localhost port=5434 ...
"""
from __future__ import annotations

import json
import os
import re
from typing import Any, AsyncIterator, Iterator

import httpx
import psycopg
import pytest
import pytest_asyncio
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
# Graph (Apache AGE via psycopg, for Cypher assertions alongside HTTP API tests)
# -----------------------------------------------------------------------------

_GRAPH = "ns_graph"

# Minimal inline versions of the helpers in graph_client.py so conftest stays
# dependency-free (api-tests can't import from backend/). Keep these two in
# sync with backend/app/services/graph_client.py if that evolves.

_TAIL_RE = re.compile(r"\b(order\s+by|limit|skip|union)\b", re.IGNORECASE)
_AS_RE = re.compile(r"\bas\s+([A-Za-z_][A-Za-z0-9_]*)\s*$", re.IGNORECASE)
_SIMPLE_IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_AGTYPE_SUFFIX_RE = re.compile(r"(?<=[\]}])::(?:vertex|edge|path)\b")


def _extract_cols(cypher: str) -> list[str]:
    idx = cypher.lower().rfind("return")
    if idx < 0:
        return []
    tail = cypher[idx + 6:]
    m = _TAIL_RE.search(tail)
    if m:
        tail = tail[: m.start()]
    # Split on top-level commas (respecting parens/brackets/braces).
    parts: list[str] = []
    depth = 0
    start = 0
    for i, c in enumerate(tail):
        if c in "([{":
            depth += 1
        elif c in ")]}":
            depth -= 1
        elif c == "," and depth == 0:
            parts.append(tail[start:i])
            start = i + 1
    parts.append(tail[start:])
    cols: list[str] = []
    for i, p in enumerate(parts):
        p = p.strip()
        if not p:
            continue
        m2 = _AS_RE.search(p)
        if m2:
            cols.append(m2.group(1))
        elif _SIMPLE_IDENT_RE.match(p):
            cols.append(p)
        elif "." in p:
            cols.append(p.split(".")[-1])
        else:
            cols.append(f"col{i}")
    return cols


def _parse_agtype(val: Any) -> Any:
    if val is None:
        return None
    if not isinstance(val, str):
        return val
    cleaned = _AGTYPE_SUFFIX_RE.sub("", val)
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        return cleaned
    return _flatten(parsed)


def _flatten(v: Any) -> Any:
    if isinstance(v, dict):
        ks = set(v.keys())
        if "properties" in ks and "label" in ks and "id" in ks:
            return _flatten(v.get("properties") or {})
        return {k: _flatten(vv) for k, vv in v.items()}
    if isinstance(v, list):
        return [_flatten(x) for x in v]
    return v


@pytest.fixture(scope="session")
def graph_conn() -> Iterator[psycopg.Connection]:
    """Session-scoped psycopg connection to the AGE-enabled Postgres."""
    conn = psycopg.connect(PG_DSN, row_factory=dict_row, autocommit=True)
    with conn.cursor() as cur:
        cur.execute("LOAD 'age'")
        cur.execute('SET search_path = ag_catalog, "$user", public')
    try:
        yield conn
    finally:
        conn.close()


@pytest.fixture
def cypher(graph_conn):
    """Convenience fixture: run a read-only Cypher query and return list[dict].

    Signature preserved from the old Neo4j driver fixture — callers pass kwargs
    for Cypher `$params`, receive a list of dicts keyed by RETURN aliases.
    """
    def _run(q: str, **params):
        cols = _extract_cols(q)
        if not cols:
            return []
        col_decl = ", ".join(f'"{c}" ag_catalog.agtype' for c in cols)
        if params:
            sql = (
                f"SELECT * FROM ag_catalog.cypher('{_GRAPH}', $ns${q}$ns$, "
                f"%s::ag_catalog.agtype) AS ({col_decl})"
            )
            args: tuple = (json.dumps(params, default=str),)
        else:
            sql = (
                f"SELECT * FROM ag_catalog.cypher('{_GRAPH}', $ns${q}$ns$) "
                f"AS ({col_decl})"
            )
            args = ()
        with graph_conn.cursor() as cur:
            cur.execute(sql, args)
            rows = cur.fetchall()
        return [
            {c: _parse_agtype(row[c]) for c in cols}
            for row in rows
        ]
    return _run


# -----------------------------------------------------------------------------
# Markers
# -----------------------------------------------------------------------------
def pytest_configure(config):
    config.addinivalue_line("markers", "ontology: tests for the ontology-fix feature")
    config.addinivalue_line("markers", "smoke: fast smoke tests that should always pass")
    config.addinivalue_line("markers", "slow: tests that take more than a few seconds")
    config.addinivalue_line("markers", "age: tests for the Apache AGE graph extension setup")
    config.addinivalue_line("markers", "deployment: tests for the deployment endpoint")
