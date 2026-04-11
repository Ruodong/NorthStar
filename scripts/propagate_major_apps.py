#!/usr/bin/env python3
"""Propagate "Major Applications" from drawio extraction to page_app_link.

Spec: .specify/features/confluence-major-apps/spec.md

For every confluence_page, walks its descendant subtree (depth ≤ 5),
finds every drawio-extracted app whose application_status is New/Change/
Sunset, and inserts one `(page_id, app_id, 'major_app')` row per unique
major app into confluence_page_app_link. The existing admin list query
(Pattern D explode) picks these up automatically, so project-folder
pages like EA250197 now surface their real project app (e.g. A002964
Lenovo Campus Recruitment) in the APP ID / NAME columns.

Idempotent via ON CONFLICT DO NOTHING — re-running on unchanged data
inserts zero new rows.

Usage (on 71):
    set -a && source .env && set +a
    .venv-ingest/bin/python scripts/propagate_major_apps.py [--dry-run]
"""
from __future__ import annotations

import argparse
import logging
import os
import sys

import psycopg
from psycopg.rows import dict_row

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s - %(message)s")
logger = logging.getLogger("propagate-major-apps")

MAJOR_STATUSES = ("New", "Change", "Sunset")
MAX_DEPTH = 5


def pg_dsn() -> str:
    return (
        f"host={os.environ.get('NORTHSTAR_PG_HOST', 'localhost')} "
        f"port={os.environ.get('NORTHSTAR_PG_PORT', '5434')} "
        f"dbname={os.environ.get('NORTHSTAR_PG_DB', 'northstar')} "
        f"user={os.environ.get('NORTHSTAR_PG_USER', 'northstar')} "
        f"password={os.environ.get('POSTGRES_PASSWORD', 'northstar_dev')}"
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true",
                    help="Compute and show, but do not write to page_app_link.")
    ap.add_argument("--page-id", help="Only propagate for this one page (debug)")
    args = ap.parse_args()

    conn = psycopg.connect(pg_dsn(), row_factory=dict_row)
    conn.autocommit = False

    stats = {
        "pages_seen": 0,
        "pages_with_majors": 0,
        "major_app_pairs_considered": 0,
        "link_rows_inserted": 0,
        "link_rows_already_present": 0,
    }

    try:
        # Pre-delete any previous propagation if the page target is scoped
        # so retries stay clean.
        if args.page_id and not args.dry_run:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    DELETE FROM northstar.confluence_page_app_link
                    WHERE source = 'major_app' AND page_id = %s
                    """,
                    (args.page_id,),
                )
                logger.info("  cleared existing major_app links for %s (%d rows)",
                            args.page_id, cur.rowcount)

        # Load (page_id, parent_id, q_app_id) for all pages so we can walk
        # the parent chain for the second-pass inheritance.
        with conn.cursor() as cur:
            if args.page_id:
                cur.execute(
                    """
                    SELECT page_id, parent_id, q_app_id
                    FROM northstar.confluence_page
                    WHERE page_id = %s
                    """,
                    (args.page_id,),
                )
            else:
                cur.execute(
                    """
                    SELECT page_id, parent_id, q_app_id
                    FROM northstar.confluence_page
                    """
                )
            page_rows = cur.fetchall()
        parent_of = {r["page_id"]: r["parent_id"] for r in page_rows}
        q_app_of  = {r["page_id"]: r["q_app_id"] for r in page_rows}
        pages = [r["page_id"] for r in page_rows]
        logger.info("loaded %d confluence_page rows", len(pages))

        # ==== FIRST PASS ====
        # Per-page subtree walk (unchanged semantics): each page collects
        # every major app found in its own subtree up to MAX_DEPTH.
        page_own_majors: dict[str, list[str]] = {}

        with conn.cursor() as query_cur, conn.cursor() as wcur:
            for i, page_id in enumerate(pages, 1):
                stats["pages_seen"] += 1
                query_cur.execute(
                    """
                    WITH RECURSIVE subtree AS (
                        SELECT page_id, 0 AS lvl
                        FROM northstar.confluence_page
                        WHERE page_id = %(root)s
                        UNION ALL
                        SELECT c.page_id, s.lvl + 1
                        FROM northstar.confluence_page c
                        JOIN subtree s ON c.parent_id = s.page_id
                        WHERE s.lvl < %(max_depth)s
                    )
                    SELECT DISTINCT
                        COALESCE(cda.resolved_app_id, cda.standard_id) AS app_id
                    FROM subtree s
                    JOIN northstar.confluence_attachment att
                         ON att.page_id = s.page_id
                    JOIN northstar.confluence_diagram_app cda
                         ON cda.attachment_id = att.attachment_id
                    WHERE cda.application_status = ANY(%(statuses)s)
                      AND COALESCE(cda.resolved_app_id, cda.standard_id) IS NOT NULL
                      AND att.file_kind = 'drawio'
                      AND att.title NOT LIKE 'drawio-backup%%'
                      AND att.title NOT LIKE '~%%'
                    """,
                    {"root": page_id,
                     "max_depth": MAX_DEPTH,
                     "statuses": list(MAJOR_STATUSES)},
                )
                majors = [r["app_id"] for r in query_cur.fetchall()]
                page_own_majors[page_id] = majors
                if not majors:
                    continue
                stats["pages_with_majors"] += 1
                stats["major_app_pairs_considered"] += len(majors)

                if args.dry_run:
                    if stats["pages_with_majors"] <= 10:
                        logger.info("  dry %s → %d majors %s",
                                    page_id, len(majors), majors[:5])
                    continue

                for app_id in majors:
                    wcur.execute(
                        """
                        INSERT INTO northstar.confluence_page_app_link
                            (page_id, app_id, source)
                        VALUES (%s, %s, 'major_app')
                        ON CONFLICT (page_id, app_id) DO NOTHING
                        """,
                        (page_id, app_id),
                    )
                    if wcur.rowcount == 1:
                        stats["link_rows_inserted"] += 1
                    else:
                        stats["link_rows_already_present"] += 1

                if i % 200 == 0:
                    conn.commit()
                    logger.info("  progress: %d/%d  inserted=%d", i, len(pages),
                                stats["link_rows_inserted"])

            # ==== SECOND PASS: ancestor inheritance ====
            # For any page with NO own majors AND no q_app_id (meaning it's
            # not a standalone app page), walk up the parent chain until
            # we find a parent that has majors. Copy those links down so
            # the empty leaf joins its parent's group instead of falling
            # into the NA bucket as a ghost row. Stops at the first ancestor
            # with a q_app_id (that ancestor owns its own identity — don't
            # inherit across an app-identity boundary, which prevents
            # LI2500120-style cross-contamination between sub-app folders).
            stats.setdefault("pages_inherited_from_ancestor", 0)
            stats.setdefault("inherited_link_rows_inserted", 0)
            for page_id in pages:
                if page_own_majors.get(page_id):
                    continue
                if q_app_of.get(page_id):
                    # Page owns its own identity → do not inherit
                    continue
                # Walk up until we find majors or hit an identity boundary
                current = parent_of.get(page_id)
                inherited: list[str] = []
                while current:
                    if q_app_of.get(current):
                        # Ancestor owns an identity; its own majors are
                        # OK to inherit (they belong to the same logical
                        # app group as this orphan leaf), so we take them
                        # and then stop walking up.
                        inherited = page_own_majors.get(current) or []
                        break
                    parent_majors = page_own_majors.get(current) or []
                    if parent_majors:
                        inherited = parent_majors
                        break
                    current = parent_of.get(current)
                if not inherited:
                    continue
                stats["pages_inherited_from_ancestor"] += 1

                if args.dry_run:
                    if stats["pages_inherited_from_ancestor"] <= 10:
                        logger.info("  dry inherit %s ← %s → %d majors",
                                    page_id, current, len(inherited))
                    continue

                for app_id in inherited:
                    wcur.execute(
                        """
                        INSERT INTO northstar.confluence_page_app_link
                            (page_id, app_id, source)
                        VALUES (%s, %s, 'major_app')
                        ON CONFLICT (page_id, app_id) DO NOTHING
                        """,
                        (page_id, app_id),
                    )
                    if wcur.rowcount == 1:
                        stats["inherited_link_rows_inserted"] += 1

        if not args.dry_run:
            conn.commit()
    finally:
        conn.close()

    logger.info("DONE:")
    for k, v in stats.items():
        logger.info("  %-28s %d", k, v)
    return 0


if __name__ == "__main__":
    sys.exit(main())
