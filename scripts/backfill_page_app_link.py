#!/usr/bin/env python3
"""Backfill confluence_page_app_link from existing confluence_page rows.

Spec: .specify/features/confluence-multi-app-page/spec.md

Idempotent: running twice is a no-op thanks to ON CONFLICT DO NOTHING.

Usage (from ~/NorthStar on 71):
    set -a && source .env && set +a
    .venv-ingest/bin/python scripts/backfill_page_app_link.py [--dry-run]
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

sys.path.insert(0, str(Path(__file__).resolve().parent))
from title_parser import extract_app_ids_multi

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s - %(message)s")
logger = logging.getLogger("backfill-page-app-link")


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
                    help="Print what would be inserted; do not write.")
    args = ap.parse_args()

    conn = psycopg.connect(pg_dsn(), row_factory=dict_row)
    conn.autocommit = False

    stats = {"pages_scanned": 0, "links_inserted": 0, "multi_app_pages": 0}

    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT page_id, title, q_app_id, effective_app_id
                FROM northstar.confluence_page
                """
            )
            rows = cur.fetchall()
        logger.info("loaded %d confluence_page rows", len(rows))

        with conn.cursor() as wcur:
            for row in rows:
                stats["pages_scanned"] += 1
                page_id = row["page_id"]

                # Collect all app ids that should be linked to this page
                app_ids: list[str] = []

                multi = extract_app_ids_multi(row["title"])
                app_ids.extend(multi)

                if row["q_app_id"] and row["q_app_id"] not in app_ids:
                    app_ids.append(row["q_app_id"])

                if row["effective_app_id"] and row["effective_app_id"] not in app_ids:
                    app_ids.append(row["effective_app_id"])

                if not app_ids:
                    continue

                if len(multi) >= 2:
                    stats["multi_app_pages"] += 1

                if args.dry_run:
                    if stats["pages_scanned"] <= 20:
                        logger.info("  dry %s %s -> %s", page_id, row["title"][:50], app_ids)
                    stats["links_inserted"] += len(app_ids)
                    continue

                for a_id in app_ids:
                    wcur.execute(
                        """
                        INSERT INTO northstar.confluence_page_app_link
                            (page_id, app_id, source)
                        VALUES (%s, %s, 'title_extract')
                        ON CONFLICT (page_id, app_id) DO NOTHING
                        """,
                        (page_id, a_id),
                    )
                    stats["links_inserted"] += 1

        if not args.dry_run:
            conn.commit()
    finally:
        conn.close()

    logger.info("DONE:")
    for k, v in stats.items():
        logger.info("  %-20s %d", k, v)
    return 0


if __name__ == "__main__":
    sys.exit(main())
