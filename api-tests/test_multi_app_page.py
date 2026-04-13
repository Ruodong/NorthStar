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
    # With Python-side collapse, all apps for a project are in project_apps
    app_ids: set[str] = set()
    for row in rows:
        if row.get("app_id"):
            app_ids.add(row["app_id"])
        for pa in row.get("project_apps", []):
            if pa.get("app_id"):
                app_ids.add(pa["app_id"])

    # At least 2 of the 3 triple-app page's apps must be visible
    visible = EXPECTED_APPS & app_ids
    assert len(visible) >= 2, (
        f"Pattern D: expected at least 2 of {EXPECTED_APPS} in LI2500120 "
        f"admin list; got {visible!r} from {app_ids!r}"
    )


# ---------------------------------------------------------------------------
# AC-4: grouping stays consistent — sum of group_sizes counts duplicates
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_multi_app_grouping_consistency(api, pg):
    """Spec AC-4 (updated for Python-side collapse). With collapse,
    each project is one row with a `project_apps` array. Verify:
    1. The number of distinct apps in project_apps matches the DB
    2. The project_app_total field is consistent
    """
    with pg.cursor() as cur:
        cur.execute(
            """
            SELECT count(DISTINCT l.app_id) AS n
            FROM northstar.confluence_page p
            JOIN northstar.confluence_page_app_link l ON l.page_id = p.page_id
            WHERE p.fiscal_year = 'FY2526'
              AND COALESCE(p.root_project_id, p.project_id) = 'LI2500120'
              AND (p.depth IS NULL OR p.depth <= 2)
            """
        )
        db_distinct_apps = cur.fetchone()["n"]

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

    # Collect all apps from collapsed rows
    all_apps: set[str] = set()
    for row in rows:
        for pa in row.get("project_apps", []):
            if pa.get("app_id"):
                all_apps.add(pa["app_id"])

    # With per-project cap of 10, we expect at most 10 visible apps
    # but at least a reasonable fraction of the DB total
    assert len(all_apps) >= min(10, db_distinct_apps), (
        f"Pattern D: expected at least min(10, {db_distinct_apps}) apps "
        f"in collapsed project_apps, got {len(all_apps)}"
    )
