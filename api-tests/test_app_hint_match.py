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
# AC-2: RetailFaimly -> A000296 Retail Family via pg_trgm
# ---------------------------------------------------------------------------

def test_retailfamly_resolves_to_cmdb(pg):
    """Spec AC-2. The hint 'RetailFaimly' (note typo in source) must
    fuzzy-match CMDB's 'Retail Family' (A000296) at similarity >= 0.6.

    This test asserts via the DB after backfill — the API test below
    separately asserts the user-visible rollup.
    """
    from title_parser import resolve_app_id_via_cmdb

    with pg.cursor() as cur:
        resolved = resolve_app_id_via_cmdb(cur, "RetailFaimly", min_similarity=0.6)
    assert resolved == "A000296", (
        f"expected 'RetailFaimly' → A000296, got {resolved!r}; "
        "either the pg_trgm threshold is wrong or CMDB is missing A000296"
    )


# ---------------------------------------------------------------------------
# AC-3: CSDC does NOT match any CMDB app at >= 0.6
# ---------------------------------------------------------------------------

def test_csdc_remains_unresolved(pg):
    """Spec AC-3. 'CSDC' is a free-text team code, not a CMDB app name.
    Strict threshold (0.6) must NOT resolve it to any A-id."""
    from title_parser import resolve_app_id_via_cmdb

    with pg.cursor() as cur:
        resolved = resolve_app_id_via_cmdb(cur, "CSDC", min_similarity=0.6)
    assert resolved is None, (
        f"expected 'CSDC' to remain unresolved; got {resolved!r}. "
        "If CMDB gained an app named 'CSDC', loosen or update this test."
    )


# ---------------------------------------------------------------------------
# AC-4: LI2500034 admin list returns >= 3 rows (project + CSDC + RetailFaimly)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_li2500034_displays_at_least_three_rows(api):
    """Spec AC-4. After backfill, LI2500034 in FY2526 must show at least
    three rows:
       - one with app_id = A000296 (Retail Family) — resolved via hint
       - one with app_id = '[CSDC]' — unresolved hint
       - one with app_id = None — project-folder page
    """
    r = await api.get(
        "/api/admin/confluence/pages",
        params={"fiscal_year": "FY2526", "q": "LI2500034", "limit": 20},
    )
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    rows = data["rows"]
    app_ids = {row.get("app_id") for row in rows}

    assert "A000296" in app_ids, (
        f"Pattern B: RetailFaimly should roll up to A000296, "
        f"but got app_ids={app_ids!r}"
    )
    assert "[CSDC]" in app_ids, (
        f"Pattern B: CSDC should show as unresolved [CSDC] tag, "
        f"but got app_ids={app_ids!r}"
    )
    assert len(rows) >= 3, (
        f"Pattern B: expected >= 3 rows for LI2500034, got {len(rows)}"
    )


# ---------------------------------------------------------------------------
# AC-5: unmatched hint render format
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_unmatched_hint_formatting(api):
    """Spec AC-5. For the unresolved CSDC row, app_id must be the literal
    '[CSDC]' and app_name must be null."""
    r = await api.get(
        "/api/admin/confluence/pages",
        params={"fiscal_year": "FY2526", "q": "CSDC", "limit": 20},
    )
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    csdc_rows = [
        row for row in data["rows"] if row.get("app_id") == "[CSDC]"
    ]
    assert csdc_rows, (
        f"expected at least one row with app_id='[CSDC]', "
        f"got app_ids={[r.get('app_id') for r in data['rows']]}"
    )
    row = csdc_rows[0]
    assert row.get("app_name") is None, (
        f"unresolved hint row should have app_name=None, got {row.get('app_name')!r}"
    )
    assert row.get("app_hint") == "CSDC", (
        f"unresolved hint row should expose app_hint='CSDC', got {row.get('app_hint')!r}"
    )
    assert row.get("app_name_source") == "hint_unresolved", (
        f"unresolved hint row should have app_name_source='hint_unresolved', "
        f"got {row.get('app_name_source')!r}"
    )
