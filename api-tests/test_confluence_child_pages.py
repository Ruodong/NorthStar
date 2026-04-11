"""Confluence child-pages scanner tests.

Traces to .specify/features/confluence-child-pages/spec.md § 4.
Runs against the live PG on 71; assumes scripts/scan_confluence.py has
been run at least once since the 004 migration.
"""
from __future__ import annotations

import pytest


pytestmark = pytest.mark.confluence_children


# ---------------------------------------------------------------------------
# AC-1: parent_id / depth columns exist
# ---------------------------------------------------------------------------

def test_confluence_page_has_parent_columns(pg):
    """Spec AC-1 / FR-2 / FR-3. Migration 004 must be applied."""
    with pg.cursor() as cur:
        cur.execute(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'northstar'
              AND table_name   = 'confluence_page'
              AND column_name IN ('parent_id', 'depth')
            """
        )
        cols = {row["column_name"] for row in cur.fetchall()}
    missing = {"parent_id", "depth"} - cols
    assert not missing, (
        f"confluence_page is missing columns {missing} — run backend/sql/004_confluence_parent.sql"
    )


# ---------------------------------------------------------------------------
# AC-2: architecture pages are scanned
# ---------------------------------------------------------------------------

def test_architecture_pages_are_scanned(pg):
    """Spec AC-2. After recursive scan, "* Application Architecture" and
    "* Technical Architecture" pages must be present in confluence_page."""
    with pg.cursor() as cur:
        cur.execute(
            """
            SELECT count(*) AS n
            FROM northstar.confluence_page
            WHERE fiscal_year = 'FY2526'
              AND (title ILIKE '% Application Architecture'
                   OR title ILIKE '% Technical Architecture')
            """
        )
        n = cur.fetchone()["n"]
    assert n >= 20, (
        f"expected at least 20 architecture subpages for FY2526, found {n}; "
        "did scan_confluence.py recursive walk run?"
    )


# ---------------------------------------------------------------------------
# AC-3: the AMS-Operation smoke parent has both children with drawios
# ---------------------------------------------------------------------------

def test_ams_operation_children_scanned(pg):
    """Spec AC-3. Known-good parent pageId=490795919 has two child pages
    each carrying a drawio attachment. Locks in the fix for this exact case."""
    expected_children = {"490795920", "490795924"}
    with pg.cursor() as cur:
        cur.execute(
            """
            SELECT page_id, parent_id, title
            FROM northstar.confluence_page
            WHERE page_id = ANY(%s)
            """,
            (list(expected_children),),
        )
        found = {row["page_id"]: row for row in cur.fetchall()}

    missing = expected_children - found.keys()
    assert not missing, (
        f"AMS-Operation children not scanned: {missing}; "
        "rerun scripts/scan_confluence.py --fy FY2526"
    )
    for pid, row in found.items():
        assert row["parent_id"] == "490795919", (
            f"page {pid} parent_id={row['parent_id']!r}, expected 490795919"
        )

    with pg.cursor() as cur:
        cur.execute(
            """
            SELECT page_id, count(*) AS n
            FROM northstar.confluence_attachment
            WHERE page_id = ANY(%s)
              AND file_kind = 'drawio'
            GROUP BY page_id
            """,
            (list(expected_children),),
        )
        drawios = {row["page_id"]: row["n"] for row in cur.fetchall()}

    for pid in expected_children:
        n = drawios.get(pid, 0)
        assert n >= 1, (
            f"page {pid} has no drawio attachments; expected at least 1"
        )


# ---------------------------------------------------------------------------
# AC-4: parent tree is consistent
# ---------------------------------------------------------------------------

def test_confluence_page_parent_tree_is_consistent(pg):
    """Spec AC-4. Every non-null parent_id must point to an existing page
    OR be a known FY-root page (depth=1 rows' parent is the FY parent which
    we do not persist in confluence_page — they are Confluence pages, but
    they only exist as labels like "FY2526 Projects" and carry no content).
    """
    with pg.cursor() as cur:
        cur.execute(
            """
            SELECT c.page_id, c.parent_id, c.depth
            FROM northstar.confluence_page c
            LEFT JOIN northstar.confluence_page p ON c.parent_id = p.page_id
            WHERE c.parent_id IS NOT NULL
              AND c.depth >= 2        -- skip depth=1 (root-of-FY) rows
              AND p.page_id IS NULL
            LIMIT 10
            """
        )
        orphans = cur.fetchall()
    assert not orphans, (
        f"found {len(orphans)} orphan pages at depth >= 2 "
        f"(parent_id not in table): "
        f"{[(r['page_id'], r['parent_id'], r['depth']) for r in orphans]}"
    )


# ---------------------------------------------------------------------------
# AC-5: drawio coverage ratio improved
# ---------------------------------------------------------------------------

def test_drawio_coverage_ratio_improved(pg):
    """Spec AC-5. For FY2526, the ratio of project pages (or their children)
    that have at least one drawio must rise significantly above the 12% baseline.

    We measure coverage as: "project pages that either have a drawio directly
    OR have at least one descendant page with a drawio".
    """
    with pg.cursor() as cur:
        cur.execute(
            """
            WITH project_pages AS (
                SELECT page_id
                FROM northstar.confluence_page
                WHERE fiscal_year = 'FY2526'
                  AND page_type = 'project'
            ),
            with_drawio AS (
                SELECT DISTINCT pp.page_id
                FROM project_pages pp
                LEFT JOIN northstar.confluence_page child
                       ON child.parent_id = pp.page_id
                WHERE EXISTS (
                    SELECT 1 FROM northstar.confluence_attachment ca
                    WHERE ca.file_kind = 'drawio'
                      AND (ca.page_id = pp.page_id OR ca.page_id = child.page_id)
                )
            )
            SELECT
              (SELECT count(*) FROM project_pages) AS total,
              (SELECT count(*) FROM with_drawio)   AS covered
            """
        )
        row = cur.fetchone()
    total = row["total"]
    covered = row["covered"]
    if total == 0:
        pytest.skip("no FY2526 project pages yet")
    ratio = covered / total
    assert ratio >= 0.40, (
        f"FY2526 drawio coverage {covered}/{total} = {ratio:.1%}, "
        "expected >= 40% after recursive scan"
    )
