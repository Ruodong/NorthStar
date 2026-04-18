"""Smoke tests for the Apache AGE extension installed by
backend/sql/018_enable_age.sql.

This is the PR 1 gate of the Neo4j -> AGE migration. Passing here means:
  1. The apache/age:PG16_latest image is running
  2. The `age` extension is installed (in ag_catalog)
  3. The `ns_graph` graph has been created (idempotent-safe)
  4. A trivial Cypher query round-trips

Spec: .specify/features/age-migration/spec.md  §AC-1, §FR-INF-3..FR-INF-5
"""
from __future__ import annotations

import pytest

pytestmark = pytest.mark.age


def test_age_extension_installed(pg):
    """FR-INF-3: CREATE EXTENSION IF NOT EXISTS age ran on startup."""
    with pg.cursor() as cur:
        cur.execute("SELECT extname FROM pg_extension WHERE extname = 'age'")
        row = cur.fetchone()
    assert row is not None, (
        "AGE extension not installed. Check that 018_enable_age.sql ran and "
        "the postgres image is apache/age:PG16_latest (not plain postgres:16)."
    )


def test_ns_graph_exists(pg):
    """FR-INF-3: ag_catalog.create_graph('ns_graph') was called."""
    with pg.cursor() as cur:
        # ag_catalog.ag_graph is AGE's graph registry. One row per graph.
        cur.execute("SELECT name FROM ag_catalog.ag_graph WHERE name = 'ns_graph'")
        row = cur.fetchone()
    assert row is not None, (
        "Graph 'ns_graph' not found. 018_enable_age.sql's DO block may have "
        "failed silently. Check backend startup logs."
    )


def test_ns_graph_schema_created(pg):
    """AGE's create_graph() sidekick: it creates a PG schema with the graph name.

    This confirms the graph is physically backed by `ns_graph` schema, which
    is where per-label vertex/edge tables will live once the loader runs.
    """
    with pg.cursor() as cur:
        cur.execute(
            "SELECT schema_name FROM information_schema.schemata "
            "WHERE schema_name = 'ns_graph'"
        )
        row = cur.fetchone()
    assert row is not None, "ns_graph schema missing — graph was not physically created"


def test_trivial_cypher_roundtrips(pg):
    """FR-INF-4: a minimal Cypher query runs end-to-end.

    On a freshly-created graph with no data, `MATCH (n) RETURN count(n)`
    should return 0. This is the thinnest possible smoke test that
    exercises the Cypher parser + AGE's SQL-wrapping entry point.
    """
    with pg.cursor() as cur:
        # AGE requires its functions be on the search_path for the cypher()
        # call to resolve. LOAD 'age' ensures the shared library is loaded
        # for this session (not persisted — purely a session-local hint).
        cur.execute("LOAD 'age'")
        cur.execute('SET search_path = ag_catalog, "$user", public')
        cur.execute(
            """
            SELECT * FROM ag_catalog.cypher(
                'ns_graph',
                $$MATCH (n) RETURN count(n) AS n$$
            ) AS (n ag_catalog.agtype)
            """
        )
        row = cur.fetchone()
    assert row is not None, "cypher() returned no rows for count()"
    # agtype comes back as text like "0" — parseable as int directly for scalars.
    # conftest's pg fixture uses dict_row, so access by column name (not index).
    # Graph may or may not have nodes by the time this test runs (depends on
    # whether the loader has run yet); we only assert the call didn't crash.
    n_text = str(row["n"])
    assert n_text.isdigit(), f"expected a numeric count in agtype, got {n_text!r}"
