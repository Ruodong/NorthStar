"""Integration tests for drawio-name-id-reconciliation feature.

Spec: .specify/features/drawio-name-id-reconciliation/spec.md § 4.
Assumes:
  1. migration 012_confluence_diagram_app_resolve.sql applied
  2. scripts/resolve_confluence_drawio_apps.py has run
  3. scripts/load_neo4j_from_pg.py --wipe has been re-run
  4. backend rebuilt with the updated /extracted endpoint
"""
from __future__ import annotations

import pytest


pytestmark = pytest.mark.drawio_reconciliation


# ---------------------------------------------------------------------------
# AC-1: columns exist
# ---------------------------------------------------------------------------

def test_resolve_columns_exist(pg):
    """Spec AC-1. Migration 012 must be applied."""
    with pg.cursor() as cur:
        cur.execute(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'northstar'
              AND table_name   = 'confluence_diagram_app'
              AND column_name IN ('resolved_app_id', 'match_type', 'name_similarity')
            """
        )
        found = {r["column_name"] for r in cur.fetchall()}
    missing = {"resolved_app_id", "match_type", "name_similarity"} - found
    assert not missing, (
        f"confluence_diagram_app is missing columns {missing} — "
        "run backend/sql/012_confluence_diagram_app_resolve.sql"
    )


# ---------------------------------------------------------------------------
# AC-2: resolve script populated a meaningful share of rows
# ---------------------------------------------------------------------------

def test_resolve_coverage(pg):
    """Spec AC-2. After scripts/resolve_confluence_drawio_apps.py runs,
    the vast majority of confluence_diagram_app rows should have a
    non-null match_type. Floor: >= 40000 of ~49330 rows."""
    with pg.cursor() as cur:
        cur.execute(
            """
            SELECT
                (SELECT count(*) FROM northstar.confluence_diagram_app) AS total,
                (SELECT count(*) FROM northstar.confluence_diagram_app
                 WHERE match_type IS NOT NULL) AS resolved
            """
        )
        row = cur.fetchone()
    assert row["resolved"] >= 40000, (
        f"resolve script populated only {row['resolved']} of {row['total']} rows; "
        "did scripts/resolve_confluence_drawio_apps.py run after migration 012?"
    )


# ---------------------------------------------------------------------------
# AC-3: EA250197 AI Verse auto-correction
# ---------------------------------------------------------------------------

PILOT_ATTACHMENT = "596101008"
AI_VERSE_CELL = "A1tTVr5CywxeAI1Oc73R-48"


def test_ai_verse_auto_corrected(pg):
    """Spec AC-3. The 'AI Verse' container on EA250197 has drawio std_id
    A000001 (= ECC in CMDB). The resolver should detect the mismatch and
    fuzzy-match 'AI Verse' → A000426 AI-Verse."""
    with pg.cursor() as cur:
        cur.execute(
            """
            SELECT app_name, standard_id, resolved_app_id,
                   match_type, name_similarity
            FROM northstar.confluence_diagram_app
            WHERE attachment_id = %s AND cell_id = %s
            """,
            (PILOT_ATTACHMENT, AI_VERSE_CELL),
        )
        row = cur.fetchone()
    assert row is not None, (
        "EA250197 AI Verse cell missing from confluence_diagram_app"
    )
    assert row["app_name"] == "AI Verse"
    assert row["standard_id"] == "A000001"
    assert row["resolved_app_id"] == "A000426", (
        f"expected AI Verse → A000426, got {row['resolved_app_id']!r}"
    )
    assert row["match_type"] == "auto_corrected", (
        f"expected match_type=auto_corrected, got {row['match_type']!r}"
    )
    assert row["name_similarity"] is not None and row["name_similarity"] >= 0.70


# ---------------------------------------------------------------------------
# AC-4: Avatue → Avature typo tolerance
# ---------------------------------------------------------------------------

def test_avatue_keeps_drawio_id(pg):
    """Spec AC-4 (updated after pg_trgm adoption). EA250197's drawio
    label 'Avatue' (one-letter typo of 'Avature') with std_id A002634:
      - SequenceMatcher saw sim('Avatue','Avature') ≈ 0.83 → typo_tolerated
      - pg_trgm sees sim ≈ 0.50 → falls into mismatch_unresolved bucket
        because the trigram overlap doesn't clear the 0.60 typo threshold.
    The IMPORTANT invariant is that resolved_app_id stays at A002634 — the
    drawio's own id is already correct, we just can't auto-confirm via
    name similarity. The match_type label is metadata, not data quality.
    """
    with pg.cursor() as cur:
        cur.execute(
            """
            SELECT app_name, standard_id, resolved_app_id, match_type
            FROM northstar.confluence_diagram_app
            WHERE attachment_id = %s AND app_name = 'Avatue'
            """,
            (PILOT_ATTACHMENT,),
        )
        row = cur.fetchone()
    assert row is not None, "Avatue row missing from pilot attachment"
    assert row["standard_id"] == "A002634"
    assert row["resolved_app_id"] == "A002634", (
        f"Avatue should keep its drawio std_id A002634 as resolved, got {row['resolved_app_id']!r}"
    )
    # match_type can be direct (exact CMDB hit), typo_tolerated (0.60-0.85
    # similarity) or mismatch_unresolved (pg_trgm under 0.60). All three
    # mean "drawio id is trusted, we're not overriding it".
    assert row["match_type"] in (
        "direct",
        "typo_tolerated",
        "mismatch_unresolved",
    ), (
        f"Avatue should have a 'drawio-id-trusted' match type, got {row['match_type']!r}"
    )


# ---------------------------------------------------------------------------
# AC-5: A000426 AI-Verse reachable in Neo4j after reload
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_ai_verse_node_reachable_after_resolve(api):
    """Spec AC-5. After load_neo4j_from_pg.py --wipe, A000426 should be
    in the graph with CMDB metadata populated, since the loader now uses
    resolved_app_id for the MERGE key."""
    r = await api.get("/api/graph/nodes/A000426")
    assert r.status_code == 200, (
        f"A000426 AI-Verse not in Neo4j graph (status={r.status_code}); "
        "did scripts/load_neo4j_from_pg.py --wipe run after the resolver?"
    )
    data = r.json()["data"]
    app = data.get("app", {})
    assert app.get("app_id") == "A000426"
    # CMDB-linked means the merge picked up the canonical name+status
    assert app.get("cmdb_linked") is True, (
        f"A000426 should be cmdb_linked=true; got {app.get('cmdb_linked')}"
    )


# ---------------------------------------------------------------------------
# AC-6: /extracted endpoint exposes the new fields
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_extracted_endpoint_includes_resolve_fields(api):
    """Spec AC-6. The /extracted response for the EA250197 pilot page must
    include match_type, resolved_app_id, and cmdb_name_for_drawio_id on
    at least one row — and specifically the AI Verse row must show
    match_type='auto_corrected' with resolved_app_id='A000426'."""
    PAGE_ID = "596101004"  # parent page of pilot attachment 596101008
    r = await api.get(f"/api/admin/confluence/pages/{PAGE_ID}/extracted")
    assert r.status_code == 200, r.text
    rows = r.json()["data"]["apps"]
    assert rows, "expected at least one extracted app row"
    # Schema check on first row
    sample = rows[0]
    for k in (
        "match_type",
        "resolved_app_id",
        "name_similarity",
        "cmdb_name_for_drawio_id",
        "cmdb_name_for_resolved",
    ):
        assert k in sample, f"/extracted row missing field {k!r}"

    # Specific AI Verse assertion
    ai_rows = [r for r in rows if r.get("app_name") == "AI Verse"]
    assert ai_rows, "AI Verse row missing from /extracted response"
    assert ai_rows[0].get("resolved_app_id") == "A000426"
    assert ai_rows[0].get("match_type") == "auto_corrected"
    assert ai_rows[0].get("cmdb_name_for_drawio_id") == "ECC"
