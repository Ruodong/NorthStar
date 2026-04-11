"""Integration tests for confluence-root-project-id feature.

Spec: .specify/features/confluence-root-project-id/spec.md § 4 AC-1..AC-5.
Runs against the live PG + backend on 71. Assumes:
 1. migration 010_root_project_id.sql has been applied
 2. scripts/backfill_root_project_id.py has been run
 3. backend has been rebuilt to pick up the grouping-key change
"""
from __future__ import annotations

import pytest


pytestmark = pytest.mark.root_project_id


# ---------------------------------------------------------------------------
# AC-1: column exists
# ---------------------------------------------------------------------------

def test_root_project_id_column_exists(pg):
    """Spec AC-1 / FR-1. Migration 010 must be applied."""
    with pg.cursor() as cur:
        cur.execute(
            """
            SELECT column_name, data_type
            FROM information_schema.columns
            WHERE table_schema = 'northstar'
              AND table_name   = 'confluence_page'
              AND column_name  = 'root_project_id'
            """
        )
        row = cur.fetchone()
    assert row is not None, (
        "confluence_page.root_project_id column missing — "
        "run backend/sql/010_root_project_id.sql"
    )
    assert row["data_type"] == "character varying", (
        f"expected VARCHAR, got {row['data_type']}"
    )


# ---------------------------------------------------------------------------
# AC-2: depth=1 pages are their own root
# ---------------------------------------------------------------------------

def test_depth_1_pages_are_self_root(pg):
    """Spec AC-2 / FR-2. Every depth=1 page with a non-null project_id must
    have root_project_id equal to its own project_id."""
    with pg.cursor() as cur:
        cur.execute(
            """
            SELECT count(*) AS n
            FROM northstar.confluence_page
            WHERE depth = 1
              AND project_id IS NOT NULL
              AND (root_project_id IS NULL OR root_project_id <> project_id)
            """
        )
        bad = cur.fetchone()["n"]
    assert bad == 0, (
        f"{bad} depth=1 pages have root_project_id != project_id; "
        "rerun scripts/backfill_root_project_id.py"
    )


# ---------------------------------------------------------------------------
# AC-3: LI2500067 tree: all 7 pages fold under LI2500067
# ---------------------------------------------------------------------------

LI2500067_TREE_PAGES = {
    "535970589",  # depth=1  LI2500067-FY2526 AIO AIOps Project
    "529550429",  # depth=2  FY2526-063 - Robbie IT Service Agent
    "534307453",  # depth=2  FY2526 AIOps - Alert Handling Agent
    "529551044",  # depth=3  Robbie IT Service Agent Solution Design
    "529551365",  # depth=3  Robbie IT Service Agent Technical Achitecture
    "534307561",  # depth=3  Alert Handling Agent-Solution Arch
    "534307598",  # depth=3  Alert Handling Agent-Tech Arch
}


def test_li2500067_tree_all_root_li2500067(pg):
    """Spec AC-3 / FR-3. All 7 pages in the pilot LI2500067 subtree must have
    root_project_id = 'LI2500067', including the Robbie branch whose own
    project_id is FY2526-063 (a sub-initiative code)."""
    with pg.cursor() as cur:
        cur.execute(
            """
            SELECT page_id, project_id, root_project_id, depth, title
            FROM northstar.confluence_page
            WHERE page_id = ANY(%s)
            ORDER BY depth, page_id
            """,
            (list(LI2500067_TREE_PAGES),),
        )
        rows = cur.fetchall()

    found = {r["page_id"] for r in rows}
    missing = LI2500067_TREE_PAGES - found
    assert not missing, (
        f"pilot tree pages missing from confluence_page: {missing}; "
        "rerun scripts/scan_confluence.py --fy FY2526"
    )

    wrong = [
        r for r in rows if r["root_project_id"] != "LI2500067"
    ]
    assert not wrong, (
        "pages in the LI2500067 subtree with wrong root_project_id:\n"
        + "\n".join(
            f"  {r['page_id']} depth={r['depth']} proj={r['project_id']!r} "
            f"root={r['root_project_id']!r}  title={r['title'][:50]!r}"
            for r in wrong
        )
    )


# ---------------------------------------------------------------------------
# AC-4: admin list groups the whole subtree under LI2500067
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_admin_groups_subtree_under_root(api):
    """Spec AC-4 / FR-6. Admin list for q=LI2500067 in FY2526 must return all
    rows under project_id='LI2500067' — no FY2526-063 split-off row."""
    r = await api.get(
        "/api/admin/confluence/pages",
        params={
            "fiscal_year": "FY2526",
            "q": "LI2500067",
            "limit": 50,
            "include_deep": "true",
        },
    )
    assert r.status_code == 200, r.text
    rows = r.json()["data"]["rows"]

    # Filter to rows actually touching the pilot tree (have a pilot page_id
    # somewhere in their group_page_ids OR they themselves are a pilot primary).
    touching = []
    for row in rows:
        group = set(row.get("group_page_ids") or [])
        if row.get("page_id") in LI2500067_TREE_PAGES or group & LI2500067_TREE_PAGES:
            touching.append(row)

    assert touching, (
        "expected at least one admin row covering the LI2500067 pilot tree; "
        "got zero — is backfill_root_project_id.py applied?"
    )

    bad = [row for row in touching if row.get("project_id") != "LI2500067"]
    assert not bad, (
        "pilot tree admin rows with non-LI2500067 project_id "
        "(sub-initiative still splitting):\n"
        + "\n".join(
            f"  page_id={r.get('page_id')} project_id={r.get('project_id')!r} "
            f"app_id={r.get('app_id')!r}"
            for r in bad
        )
    )


# ---------------------------------------------------------------------------
# AC-5: sub-initiative id is preserved on the confluence_page row itself
# ---------------------------------------------------------------------------

def test_sub_initiative_id_preserved_on_row(pg):
    """Spec AC-5 / FR-7. We must not clobber FY2526-063 on page 529550429 —
    the sub-initiative identity stays on the row; only grouping uses the
    root_project_id fold-up."""
    with pg.cursor() as cur:
        cur.execute(
            """
            SELECT page_id, project_id, root_project_id
            FROM northstar.confluence_page
            WHERE page_id = '529550429'
            """
        )
        row = cur.fetchone()
    assert row is not None, (
        "pilot sub-initiative page 529550429 missing — rerun scan"
    )
    assert row["project_id"] == "FY2526-063", (
        f"sub-initiative id lost: expected FY2526-063, got {row['project_id']!r}"
    )
    assert row["root_project_id"] == "LI2500067", (
        f"root_project_id wrong for sub-initiative page: "
        f"expected LI2500067, got {row['root_project_id']!r}"
    )
