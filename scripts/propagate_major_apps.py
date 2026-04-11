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

        with conn.cursor() as cur:
            if args.page_id:
                cur.execute(
                    "SELECT page_id FROM northstar.confluence_page WHERE page_id = %s",
                    (args.page_id,),
                )
            else:
                cur.execute("SELECT page_id FROM northstar.confluence_page")
            pages = [r["page_id"] for r in cur.fetchall()]
        logger.info("loaded %d confluence_page rows", len(pages))

        # Use a single cursor for the per-page walk — the subquery below is
        # cheap (indexed on parent_id + attachment_id + standard_id).
        with conn.cursor() as query_cur, conn.cursor() as wcur:
            for i, page_id in enumerate(pages, 1):
                stats["pages_seen"] += 1
                # Find all unique major app ids in this page's subtree.
                # We use the effective id (COALESCE resolved, standard) so
                # reconciled apps collapse onto the corrected A-id.
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
                    # psycopg rowcount is 1 on insert, 0 on conflict
                    if wcur.rowcount == 1:
                        stats["link_rows_inserted"] += 1
                    else:
                        stats["link_rows_already_present"] += 1

                if i % 200 == 0:
                    conn.commit()
                    logger.info("  progress: %d/%d  inserted=%d", i, len(pages),
                                stats["link_rows_inserted"])

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
