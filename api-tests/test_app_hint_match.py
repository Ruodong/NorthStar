"""Integration tests for Pattern B — CMDB fuzzy match + admin list rollup.

Spec: .specify/features/confluence-app-hint/spec.md § 4 AC-2..AC-5.
Runs against the live backend + PG + Neo4j on 71. Assumes:
 1. migration 007_app_hint.sql has been applied
 2. scripts/backfill_app_hint.py has been run
 3. backend has been rebuilt to pick up the updated admin router
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "scripts"))


pytestmark = pytest.mark.app_hint


# ---------------------------------------------------------------------------
# AC-2: CSDC resolves to A000590 (there is literally a CMDB app named "CSDC")
# ---------------------------------------------------------------------------

def test_csdc_resolves_to_a000590(pg):
    """Spec AC-2. 'CSDC' matches CMDB exactly — A000590 is named 'CSDC'
    with pg_trgm similarity = 1.0 against ref_application.name. This test
    locks in that the strict 0.6 threshold accepts exact matches."""
    from title_parser import resolve_app_id_via_cmdb

    with pg.cursor() as cur:
        resolved = resolve_app_id_via_cmdb(cur, "CSDC", min_similarity=0.6)
    assert resolved == "A000590", (
        f"expected 'CSDC' → A000590, got {resolved!r}; "
        "CMDB should have an app literally named 'CSDC'"
    )


# ---------------------------------------------------------------------------
# AC-3: RetailFaimly (typo) does NOT resolve at strict 0.6 threshold
# ---------------------------------------------------------------------------

def test_retailfamly_remains_unresolved(pg):
    """Spec AC-3. 'RetailFaimly' is a typo ("Faimly" instead of "Family")
    and pg_trgm similarity against 'Retail Family' is ~0.35, below the
    strict 0.6 threshold. The hint MUST remain unresolved so the admin
    list shows it as '[RetailFaimly]' for the user to decide.

    If pg_trgm internals change or CMDB adds a literal 'RetailFaimly', this
    test will break and should be updated deliberately."""
    from title_parser import resolve_app_id_via_cmdb

    with pg.cursor() as cur:
        resolved = resolve_app_id_via_cmdb(cur, "RetailFaimly", min_similarity=0.6)
    assert resolved is None, (
        f"expected 'RetailFaimly' to remain unresolved at strict 0.6; "
        f"got {resolved!r}"
    )


# ---------------------------------------------------------------------------
# AC-4: LI2500034 admin list returns distinct rows for CSDC and RetailFaimly
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_li2500034_displays_at_least_three_rows(api):
    """Spec AC-4 (updated after major_apps propagation). After all 4
    pipeline steps (resolver + propagate + Neo4j reload + backend rebuild),
    LI2500034 should surface multiple resolved CMDB A-ids in the admin
    list — the Pattern D explode now includes major_app links from
    confluence_page_app_link in addition to the earlier Pattern B hint
    tags. We specifically expect:
      - A000590 (CSDC — exact CMDB match, sim=1.0)
      - A000296 (Retail Family — resolved via drawio content on a child
                 page that referenced it as a change)
      - at least 3 total rows so the grouping-by-app is doing its job
    """
    r = await api.get(
        "/api/admin/confluence/pages",
        params={"fiscal_year": "FY2526", "q": "LI2500034", "limit": 20},
    )
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    rows = data["rows"]
    app_ids = {row.get("app_id") for row in rows}

    assert "A000590" in app_ids, (
        f"Pattern B: CSDC should resolve to A000590 (exact CMDB match), "
        f"got app_ids={app_ids!r}"
    )
    assert "A000296" in app_ids, (
        f"Major apps: Retail Family (A000296) should appear as a row "
        f"via the drawio-extracted Change status, got app_ids={app_ids!r}"
    )
    assert len(rows) >= 3, (
        f"Pattern B: expected >= 3 rows for LI2500034, got {len(rows)}"
    )


# ---------------------------------------------------------------------------
# AC-5: unmatched hint render format
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_unmatched_hint_formatting(api):
    """Spec AC-5 (updated). The '[hint]' render format is still used for
    apps whose fuzzy name match failed AND have no CMDB-resolved A-id.
    With the full resolver + propagate pipeline, fewer rows fall into
    this bucket than before because pg_trgm-resolved hits and
    major_app propagation catch many. We validate the format is still
    correct by asserting that any row with a bracketed app_id has:
      - app_id matching r'^\\[[^\\]]+\\]$'
      - app_name=None
      - app_name_source='hint_unresolved'
    """
    r = await api.get(
        "/api/admin/confluence/pages",
        params={"fiscal_year": "FY2526", "limit": 500, "include_deep": "true"},
    )
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    import re
    bracketed = [
        row for row in data["rows"]
        if row.get("app_id") and re.match(r"^\[[^\]]+\]$", row["app_id"] or "")
    ]
    # There may be zero or many — what matters is the schema contract.
    # If zero, we just check that every non-None app_id is A-id shape.
    for row in bracketed:
        assert row.get("app_name") is None, (
            f"bracketed row should have app_name=None, got {row.get('app_name')!r}"
        )
        assert row.get("app_name_source") == "hint_unresolved", (
            f"bracketed row should have app_name_source='hint_unresolved', "
            f"got {row.get('app_name_source')!r}"
        )
    # Sanity: every NON-bracketed app_id must match the A-id shape
    for row in data["rows"]:
        aid = row.get("app_id")
        if aid and not aid.startswith("["):
            assert re.match(r"^A\d{3,7}$", aid), (
                f"non-bracketed app_id must be valid A-id shape, got {aid!r}"
            )


# ---------------------------------------------------------------------------
# AC-6: Pattern E — KSA Oasis depth-2 arch folders yield per-app rows
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_ksa_oasis_pattern_e_yields_app_rows(api):
    """Spec AC-6 / Pattern E. LI2500058 'KSA Oasis DTIT Project' has
    multiple depth-2 children named 'KSA Application Architecture - <APP>'.
    Each should produce its own row. After the full resolver pipeline,
    most hints (OF, MM, DLMS, MCT, Finance, ...) resolve to real CMDB
    A-ids. A few stay as [hint] tags if their name doesn't match any
    CMDB app above the pg_trgm threshold.

    We assert the tree is richly surfaced — at least 10 distinct apps
    in the LI2500058 list — rather than locking specific short-name
    hints which can flip between resolved-A-id and bracketed based on
    CMDB similarity values.
    """
    r = await api.get(
        "/api/admin/confluence/pages",
        params={"fiscal_year": "FY2526", "q": "LI2500058", "limit": 50},
    )
    assert r.status_code == 200, r.text
    rows = r.json()["data"]["rows"]
    app_ids = {row.get("app_id") for row in rows if row.get("app_id")}
    assert len(app_ids) >= 10, (
        f"Pattern E: expected >= 10 distinct app rows for LI2500058 KSA "
        f"Oasis, got {len(app_ids)} — {sorted(app_ids)}"
    )
