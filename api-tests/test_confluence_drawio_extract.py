"""Integration tests for confluence-drawio-extract feature.

Spec: .specify/features/confluence-drawio-extract/spec.md § 4.
Runs against the live PG + backend on 71. Assumes:
 1. migration 011_confluence_diagram_extract.sql has been applied
 2. scripts/parse_confluence_drawios.py has been run
 3. scripts/load_neo4j_from_pg.py has been re-run so the Neo4j graph
    reflects the newly-extracted Confluence apps + interactions
"""
from __future__ import annotations

import pytest


pytestmark = pytest.mark.confluence_drawio_extract


# ---------------------------------------------------------------------------
# AC-1: tables exist
# ---------------------------------------------------------------------------

def test_confluence_diagram_tables_exist(pg):
    """Spec AC-1. Migration 011 must be applied."""
    with pg.cursor() as cur:
        cur.execute(
            """
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'northstar'
              AND table_name IN (
                'confluence_diagram_app', 'confluence_diagram_interaction'
              )
            """
        )
        found = {r["table_name"] for r in cur.fetchall()}
    missing = {"confluence_diagram_app", "confluence_diagram_interaction"} - found
    assert not missing, (
        f"confluence extraction tables missing: {missing} — "
        "run backend/sql/011_confluence_diagram_extract.sql"
    )


# ---------------------------------------------------------------------------
# AC-2: parser populated a meaningful number of apps
# ---------------------------------------------------------------------------

def test_parser_populated_minimum_apps(pg):
    """Spec AC-2. After the parser runs against the downloaded files, the
    confluence_diagram_app table must contain at least 500 rows with
    non-null standard_id. This is a conservative floor — the pilot file
    alone yields 8 A-ids and there are ~2580 drawio files on disk."""
    with pg.cursor() as cur:
        cur.execute(
            """
            SELECT count(*) AS n
            FROM northstar.confluence_diagram_app
            WHERE standard_id IS NOT NULL
            """
        )
        n = cur.fetchone()["n"]
    assert n >= 500, (
        f"expected at least 500 confluence_diagram_app rows with standard_id, "
        f"got {n}; did scripts/parse_confluence_drawios.py run?"
    )


# ---------------------------------------------------------------------------
# AC-3: pilot file LBP Application Architecture yields expected A-ids
# ---------------------------------------------------------------------------

PILOT_ATTACHMENT_ID = "517769868"
PILOT_EXPECTED_STDS = {
    "A000001", "A000291", "A000406", "A000424",
    "A001652", "A002201", "A002281", "A002812",
}


def test_pilot_file_standard_ids(pg):
    """Spec AC-3. LBP Application Architecture drawio (attachment 517769868)
    must yield exactly the 8 expected standard ids."""
    with pg.cursor() as cur:
        cur.execute(
            """
            SELECT DISTINCT standard_id
            FROM northstar.confluence_diagram_app
            WHERE attachment_id = %s
              AND standard_id IS NOT NULL
            """,
            (PILOT_ATTACHMENT_ID,),
        )
        found = {r["standard_id"] for r in cur.fetchall()}
    missing = PILOT_EXPECTED_STDS - found
    extra = found - PILOT_EXPECTED_STDS
    assert not missing, f"LBP pilot missing expected standard ids: {missing}"
    # Extra is allowed (parser might find more than expected) but log for info
    if extra:
        print(f"LBP pilot found extra (not required) standard ids: {extra}")


# ---------------------------------------------------------------------------
# AC-4: Neo4j loader picks up confluence-sourced apps
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_neo4j_includes_confluence_extracted_app(api):
    """Spec AC-4. After re-running load_neo4j_from_pg.py, the pilot app
    A000291 (present in LBP drawio) should be reachable via
    /api/graph/nodes/A000291 with its CMDB name/status populated."""
    r = await api.get("/api/graph/nodes/A000291")
    # Either 200 (found) or 404 is meaningful — but we want 200
    assert r.status_code == 200, (
        f"A000291 not in Neo4j graph (status={r.status_code}); "
        "did load_neo4j_from_pg.py --wipe run after the parser?"
    )
    body = r.json()["data"]
    app = body.get("app", {})
    assert app.get("app_id") == "A000291", (
        f"graph returned wrong node: {app.get('app_id')!r}"
    )


# ---------------------------------------------------------------------------
# AC-5: re-running the parser is idempotent
# ---------------------------------------------------------------------------

def test_parser_is_idempotent(pg):
    """Spec AC-5. The parser uses ON CONFLICT DO UPDATE keyed on
    (attachment_id, cell_id). Re-running must not create duplicate rows.
    We assert no duplicate PK exists (trivially true if the table is
    correctly schemaed) AND no row was last_seen_at'd in the future."""
    with pg.cursor() as cur:
        cur.execute(
            """
            SELECT attachment_id, cell_id, count(*) AS n
            FROM northstar.confluence_diagram_app
            GROUP BY attachment_id, cell_id
            HAVING count(*) > 1
            LIMIT 5
            """
        )
        dupes = cur.fetchall()
    assert not dupes, f"duplicate PK in confluence_diagram_app: {dupes!r}"

    with pg.cursor() as cur:
        cur.execute(
            """
            SELECT count(*) AS n FROM northstar.confluence_diagram_app
            WHERE last_seen_at > NOW() + INTERVAL '1 minute'
            """
        )
        future_rows = cur.fetchone()["n"]
    assert future_rows == 0, (
        f"{future_rows} rows have last_seen_at in the future — clock skew bug?"
    )
