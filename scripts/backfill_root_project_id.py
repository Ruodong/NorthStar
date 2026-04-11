#!/usr/bin/env python3
"""Backfill confluence_page.root_project_id from existing rows.

Spec: .specify/features/confluence-root-project-id/spec.md

Algorithm (single pass, O(n) in rows):
  1. Load every row ordered by depth ASC (NULLs last → treated as depth=1 seeds).
  2. For each row, resolve root_project_id:
       - depth=1 (or NULL/0) → own project_id
       - depth>=2          → parent's already-computed root_project_id,
                             falling back to own project_id if the parent chain
                             is broken.
  3. UPDATE only when the new value differs from the stored one.

Idempotent: re-running is a no-op on rows whose root_project_id already matches.

Usage (from ~/NorthStar on 71):
    set -a && source .env && set +a
    .venv-ingest/bin/python scripts/backfill_root_project_id.py [--dry-run]
"""
from __future__ import annotations

import argparse
import logging
import os
import sys

import psycopg
from psycopg.rows import dict_row

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s - %(message)s")
logger = logging.getLogger("backfill-root-project-id")


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
                    help="Print what would change; do not write.")
    args = ap.parse_args()

    conn = psycopg.connect(pg_dsn(), row_factory=dict_row)
    conn.autocommit = False

    stats = {
        "scanned": 0,
        "set_from_self": 0,     # depth=1 seeds (own project_id)
        "set_from_parent": 0,   # depth>=2 inherited
        "broken_chain": 0,      # parent not in table → fallback to own
        "no_change": 0,
        "updated": 0,
    }

    try:
        # Load every row, ordered so parents come before children.
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT page_id, project_id, parent_id, depth, root_project_id
                FROM northstar.confluence_page
                ORDER BY COALESCE(depth, 0), page_id
                """
            )
            rows = cur.fetchall()
        logger.info("loaded %d confluence_page rows", len(rows))

        # resolved[page_id] = the root_project_id we computed for this row
        resolved: dict[str, str | None] = {}

        with conn.cursor() as wcur:
            for row in rows:
                stats["scanned"] += 1
                page_id  = row["page_id"]
                own_pid  = row["project_id"]
                parent   = row["parent_id"]
                depth    = row["depth"]
                old_root = row["root_project_id"]

                # depth=1 (or legacy NULL) pages are their own root
                if depth is None or depth <= 1:
                    new_root = own_pid
                    stats["set_from_self"] += 1
                else:
                    if parent and parent in resolved:
                        new_root = resolved[parent]
                        # Parent may not have had a project_id of its own; in
                        # that case we still fall back to our own so the row
                        # isn't orphaned into NULL-bucket.
                        if new_root is None:
                            new_root = own_pid
                            stats["set_from_self"] += 1
                        else:
                            stats["set_from_parent"] += 1
                    else:
                        new_root = own_pid
                        stats["broken_chain"] += 1

                resolved[page_id] = new_root

                if new_root == old_root:
                    stats["no_change"] += 1
                    continue

                if args.dry_run:
                    if stats["updated"] < 20:
                        logger.info(
                            "  dry %s  depth=%s  own=%r  root %r→%r",
                            page_id, depth, own_pid, old_root, new_root,
                        )
                    stats["updated"] += 1
                    continue

                wcur.execute(
                    """
                    UPDATE northstar.confluence_page
                    SET root_project_id = %s
                    WHERE page_id = %s
                    """,
                    (new_root, page_id),
                )
                stats["updated"] += 1

        if not args.dry_run:
            conn.commit()
    finally:
        conn.close()

    logger.info("DONE:")
    for k, v in stats.items():
        logger.info("  %-18s %d", k, v)
    return 0


if __name__ == "__main__":
    sys.exit(main())
