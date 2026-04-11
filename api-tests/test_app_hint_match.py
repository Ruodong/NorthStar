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
    """Spec AC-4. After backfill, LI2500034 in FY2526 must show at least
    three rows:
       - one with app_id = 'A000590' (CSDC — resolved exactly)
       - one with app_id = '[RetailFaimly]' (typo, unresolved)
       - one or more project-folder rows with app_id = None
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
    assert "[RetailFaimly]" in app_ids, (
        f"Pattern B: RetailFaimly should show as unresolved [RetailFaimly] "
        f"tag, got app_ids={app_ids!r}"
    )
    assert len(rows) >= 3, (
        f"Pattern B: expected >= 3 rows for LI2500034, got {len(rows)}"
    )


# ---------------------------------------------------------------------------
# AC-5: unmatched hint render format
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_unmatched_hint_formatting(api):
    """Spec AC-5. For the unresolved RetailFaimly row, app_id must be the
    literal '[RetailFaimly]' and app_name must be null."""
    r = await api.get(
        "/api/admin/confluence/pages",
        params={"fiscal_year": "FY2526", "q": "RetailFaimly", "limit": 20},
    )
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    unresolved = [
        row for row in data["rows"] if row.get("app_id") == "[RetailFaimly]"
    ]
    assert unresolved, (
        f"expected at least one row with app_id='[RetailFaimly]', "
        f"got app_ids={[r.get('app_id') for r in data['rows']]}"
    )
    row = unresolved[0]
    assert row.get("app_name") is None, (
        f"unresolved hint row should have app_name=None, got {row.get('app_name')!r}"
    )
    assert row.get("app_hint") == "RetailFaimly", (
        f"unresolved hint row should expose app_hint='RetailFaimly', "
        f"got {row.get('app_hint')!r}"
    )
    assert row.get("app_name_source") == "hint_unresolved", (
        f"unresolved hint row should have app_name_source='hint_unresolved', "
        f"got {row.get('app_name_source')!r}"
    )


# ---------------------------------------------------------------------------
# AC-6: Pattern E — KSA Oasis depth-2 arch folders yield per-app rows
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_ksa_oasis_pattern_e_yields_app_rows(api):
    """Spec AC-6 / Pattern E. LI2500058 'KSA Oasis DTIT Project' has
    multiple depth-2 children named 'KSA Application Architecture - <APP>'.
    Each should produce its own row, with the app name extracted as the
    hint after the 'Application Architecture - ' separator."""
    r = await api.get(
        "/api/admin/confluence/pages",
        params={"fiscal_year": "FY2526", "q": "LI2500058", "limit": 50},
    )
    assert r.status_code == 200, r.text
    rows = r.json()["data"]["rows"]
    app_ids = {row.get("app_id") for row in rows}

    # Known short-name app hints for KSA Oasis. They may or may not resolve
    # to CMDB A-ids — what we assert is that each appears in SOME form
    # (either '[OF]' or a resolved A-id, but NOT merged into one NULL row).
    expected_hints = {"OF", "DLMS", "MCT", "MM"}
    seen = set()
    for hint in expected_hints:
        if any(
            aid == f"[{hint}]" or (
                aid and aid.startswith("A") and hint.lower() in (
                    (row.get("app_name") or "").lower()
                )
            )
            for row, aid in zip(rows, (row.get("app_id") for row in rows))
        ):
            seen.add(hint)

    assert seen == expected_hints, (
        f"Pattern E: expected at least {expected_hints} to appear as rows "
        f"(resolved or as [hint]); got seen={seen}, "
        f"app_ids={sorted(x for x in app_ids if x)}"
    )
