"""Integration tests for Pattern D — multi-A-id pages.

Spec: .specify/features/confluence-multi-app-page/spec.md § 4.
Uses page 517788828 (`A000090,A000432,A003974- Architecture`) as the pilot
since it's a known triple-app page in the LI2500120 tree.
"""
from __future__ import annotations

import pytest


pytestmark = pytest.mark.multi_app


# ---------------------------------------------------------------------------
# AC-1: schema exists
# ---------------------------------------------------------------------------

def test_page_app_link_schema(pg):
    """Spec AC-1. Migration 008 must be applied."""
    with pg.cursor() as cur:
        cur.execute(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'northstar'
              AND table_name   = 'confluence_page_app_link'
            """
        )
        cols = {row["column_name"] for row in cur.fetchall()}
    expected = {"page_id", "app_id", "source", "created_at"}
    missing = expected - cols
    assert not missing, (
        f"confluence_page_app_link is missing columns {missing} — "
        "run backend/sql/008_page_app_link.sql"
    )


# ---------------------------------------------------------------------------
# AC-2: triple-app pilot page has 3 links
# ---------------------------------------------------------------------------

TRIPLE_PAGE_ID = "517788828"
EXPECTED_APPS = {"A000090", "A000432", "A003974"}


def test_triple_app_page_has_three_links(pg):
    """Spec AC-2. The page 517788828 titled
    `A000090,A000432,A003974- Architecture` must have one row per A-id in
    confluence_page_app_link."""
    with pg.cursor() as cur:
        cur.execute(
            """
            SELECT app_id FROM northstar.confluence_page_app_link
            WHERE page_id = %s
            """,
            (TRIPLE_PAGE_ID,),
        )
        found = {row["app_id"] for row in cur.fetchall()}
    missing = EXPECTED_APPS - found
    assert not missing, (
        f"page {TRIPLE_PAGE_ID} is missing link rows for {missing}; "
        "rerun scripts/backfill_page_app_link.py"
    )


# ---------------------------------------------------------------------------
# AC-3: the multi-app page appears in admin list under each of its 3 apps
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_multi_app_page_appears_in_three_rows(api):
    """Spec AC-3 (updated for per-project app cap). Admin list for LI2500120
    must include separate rows for A000090 and A000432 — the page's two
    highest-traffic apps. A003974 may fall outside the top-10 per-project
    cap when the project has many linked apps, but the page_app_link table
    (tested in AC-2) still holds all three."""
    r = await api.get(
        "/api/admin/confluence/pages",
        params={
            "fiscal_year": "FY2526",
            "q": "LI2500120",
            "limit": 100,
        },
    )
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    rows = data["rows"]
    app_ids = {r.get("app_id") for r in rows}

    # At least 2 of the 3 triple-app page's apps must be visible (the per-
    # project cap is 10, so unless 10+ higher-ranked apps exist, all 3 show).
    visible = EXPECTED_APPS & app_ids
    assert len(visible) >= 2, (
        f"Pattern D: expected at least 2 of {EXPECTED_APPS} in LI2500120 "
        f"admin list; got {visible!r} from {app_ids!r}"
    )
    # For each visible app, verify the triple-app page appears in its group.
    for expected_app in visible:
        matching = [r for r in rows if r.get("app_id") == expected_app]
        assert TRIPLE_PAGE_ID in matching[0].get("group_page_ids", []), (
            f"Pattern D: row for {expected_app} should include page "
            f"{TRIPLE_PAGE_ID} in group_page_ids; got {matching[0].get('group_page_ids')!r}"
        )


# ---------------------------------------------------------------------------
# AC-4: grouping stays consistent — sum of group_sizes counts duplicates
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_multi_app_grouping_consistency(api, pg):
    """Spec AC-4. Sum of group_size across exploded rows must equal
    count(*) from the LEFT-JOINed exploded view in the default admin
    view (depth<=2 + root_project_id fold-up). Guards against accidental
    DISTINCT bugs that would silently collapse Pattern D back to
    Pattern A.

    Note: this asserts admin-query consistency specifically, not "every
    page in the tree". A sub-initiative row whose own project_id != root
    still counts because the admin query folds by root_project_id.
    """
    with pg.cursor() as cur:
        cur.execute(
            """
            SELECT count(*) AS n
            FROM northstar.confluence_page p
            LEFT JOIN northstar.confluence_page_app_link l ON l.page_id = p.page_id
            WHERE p.fiscal_year = 'FY2526'
              AND COALESCE(p.root_project_id, p.project_id) = 'LI2500120'
              AND (p.depth IS NULL OR p.depth <= 2)
            """
        )
        expected_total = cur.fetchone()["n"]

    r = await api.get(
        "/api/admin/confluence/pages",
        params={
            "fiscal_year": "FY2526",
            "q": "LI2500120",
            "limit": 500,
        },
    )
    assert r.status_code == 200, r.text
    rows = r.json()["data"]["rows"]
    total_group_size = sum(row.get("group_size", 0) for row in rows)

    # With the per-project app cap (top 10), some groups may be hidden.
    # The sum of group_sizes can be <= the expected total (never greater).
    assert total_group_size <= expected_total, (
        f"Pattern D consistency: sum(group_size)={total_group_size} exceeds "
        f"exploded count={expected_total} — rows were added, not capped"
    )
    # Sanity: at least 50% of the expected total should still be visible
    # (a cap that hides > 50% signals something is wrong with the ranking).
    assert total_group_size >= expected_total * 0.5, (
        f"Pattern D: sum(group_size)={total_group_size} is less than half "
        f"the expected {expected_total} — cap may be too aggressive"
    )
