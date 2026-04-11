#!/usr/bin/env python3
"""Backfill confluence_page.app_hint + effective_app_id for existing rows.

Spec: .specify/features/confluence-app-hint/spec.md

Idempotent: running twice is a no-op on rows whose hint + resolution
haven't changed. Safe to re-run after CMDB updates.

Usage (from ~/NorthStar on 71):
    set -a && source .env && set +a
    .venv-ingest/bin/python scripts/backfill_app_hint.py [--dry-run]
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
from title_parser import ResolveCache, extract_app_hint

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s - %(message)s")
logger = logging.getLogger("backfill-app-hint")


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
        "hint_set": 0,
        "hint_cleared": 0,
        "effective_resolved": 0,
        "effective_cleared": 0,
        "no_change": 0,
    }

    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT page_id, title, q_app_id, app_hint, effective_app_id
                FROM northstar.confluence_page
                """
            )
            rows = cur.fetchall()
        logger.info("loaded %d confluence_page rows", len(rows))

        # One cache per run, shared across all rows.
        with conn.cursor() as resolve_cur:
            cache = ResolveCache(resolve_cur)

            with conn.cursor() as wcur:
                for row in rows:
                    stats["scanned"] += 1
                    page_id = row["page_id"]
                    old_hint = row["app_hint"]
                    old_eff  = row["effective_app_id"]

                    new_hint = extract_app_hint(row["title"])

                    # effective_app_id rule:
                    # own q_app_id wins; else hint-resolved CMDB id; else None
                    # (The ancestor-walk rule from Pattern A is handled by
                    # migration 006's recursive CTE + scanner; we preserve
                    # effective_app_id when row["q_app_id"] is NULL but the
                    # existing effective_app_id is NOT the hint resolution.)
                    if row["q_app_id"]:
                        new_eff = row["q_app_id"]
                    else:
                        # Prefer existing ancestor-derived effective_app_id
                        # unless hint resolves to something different.
                        hint_resolved = cache.get(new_hint) if new_hint else None
                        if hint_resolved:
                            new_eff = hint_resolved
                        else:
                            # Keep whatever Pattern A backfilled (may be None)
                            new_eff = old_eff

                    if new_hint == old_hint and new_eff == old_eff:
                        stats["no_change"] += 1
                        continue

                    if new_hint != old_hint:
                        if new_hint and not old_hint:
                            stats["hint_set"] += 1
                        elif old_hint and not new_hint:
                            stats["hint_cleared"] += 1
                        else:
                            stats["hint_set"] += 1  # changed value

                    if new_eff != old_eff:
                        if new_eff and not old_eff:
                            stats["effective_resolved"] += 1
                        elif old_eff and not new_eff:
                            stats["effective_cleared"] += 1

                    if args.dry_run:
                        if stats["scanned"] <= 30:
                            logger.info(
                                "  dry %s  hint %r→%r  eff %r→%r  (%s)",
                                page_id, old_hint, new_hint, old_eff, new_eff,
                                row["title"][:60],
                            )
                        continue

                    wcur.execute(
                        """
                        UPDATE northstar.confluence_page
                        SET app_hint = %s,
                            effective_app_id = %s
                        WHERE page_id = %s
                        """,
                        (new_hint, new_eff, page_id),
                    )

        if not args.dry_run:
            conn.commit()
    finally:
        conn.close()

    logger.info("DONE:")
    for k, v in stats.items():
        logger.info("  %-22s %d", k, v)
    return 0


if __name__ == "__main__":
    sys.exit(main())
