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
        "effective_hint_inherited": 0,
        "no_change": 0,
    }

    try:
        # Load every page ordered by depth (NULLs first — pre-migration rows,
        # then 1, 2, 3 — so we can do a single-pass ancestor walk in memory.
        # We keep track of each page's resolved effective_app_id AND its
        # effective_app_hint so depth=N rows can inherit from their parent's
        # freshly-computed values.
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT page_id, title, q_app_id, parent_id, depth,
                       app_hint, effective_app_id, effective_app_hint
                FROM northstar.confluence_page
                ORDER BY COALESCE(depth, 0), page_id
                """
            )
            rows = cur.fetchall()
        logger.info("loaded %d confluence_page rows", len(rows))

        # parent_state[page_id] = (effective_app_id, effective_app_hint)
        # for descendants to inherit.
        parent_state: dict[str, tuple[str | None, str | None]] = {}

        with conn.cursor() as resolve_cur:
            cache = ResolveCache(resolve_cur)

            with conn.cursor() as wcur:
                for row in rows:
                    stats["scanned"] += 1
                    page_id = row["page_id"]
                    old_hint = row["app_hint"]
                    old_eff  = row["effective_app_id"]
                    old_eff_hint = row["effective_app_hint"]

                    new_hint = extract_app_hint(row["title"])

                    # effective_app_id precedence (rebuilt from scratch):
                    #   1) own q_app_id
                    #   2) hint-resolved CMDB A-id
                    #   3) inherited from parent (walked in depth order)
                    if row["q_app_id"]:
                        new_eff = row["q_app_id"]
                    else:
                        hint_resolved = cache.get(new_hint) if new_hint else None
                        if hint_resolved:
                            new_eff = hint_resolved
                        elif row["parent_id"] and row["parent_id"] in parent_state:
                            new_eff = parent_state[row["parent_id"]][0]
                        else:
                            new_eff = None

                    # effective_app_hint precedence:
                    #   1) own app_hint (whatever it is, resolved or not)
                    #   2) inherited from parent's effective_app_hint
                    # This lets "[OF]" propagate from the depth-2 parent down
                    # to its "00 Order Fulfillment" child so they group together.
                    if new_hint:
                        new_eff_hint = new_hint
                    elif row["parent_id"] and row["parent_id"] in parent_state:
                        new_eff_hint = parent_state[row["parent_id"]][1]
                    else:
                        new_eff_hint = None

                    # Record for descendants
                    parent_state[page_id] = (new_eff, new_eff_hint)

                    if (
                        new_hint == old_hint
                        and new_eff == old_eff
                        and new_eff_hint == old_eff_hint
                    ):
                        stats["no_change"] += 1
                        continue

                    if new_hint != old_hint:
                        if new_hint and not old_hint:
                            stats["hint_set"] += 1
                        elif old_hint and not new_hint:
                            stats["hint_cleared"] += 1
                        else:
                            stats["hint_set"] += 1
                    if new_eff != old_eff:
                        if new_eff and not old_eff:
                            stats["effective_resolved"] += 1
                        elif old_eff and not new_eff:
                            stats["effective_cleared"] += 1
                    if (
                        new_eff_hint and not old_eff_hint and not new_hint
                    ):
                        # Only count rows where the effective hint was
                        # inherited from an ancestor (own hint is None).
                        stats["effective_hint_inherited"] += 1

                    if args.dry_run:
                        if stats["scanned"] <= 30:
                            logger.info(
                                "  dry %s  hint %r→%r  eff %r→%r  efh %r→%r  (%s)",
                                page_id, old_hint, new_hint, old_eff, new_eff,
                                old_eff_hint, new_eff_hint,
                                row["title"][:60],
                            )
                        continue

                    wcur.execute(
                        """
                        UPDATE northstar.confluence_page
                        SET app_hint = %s,
                            effective_app_id = %s,
                            effective_app_hint = %s
                        WHERE page_id = %s
                        """,
                        (new_hint, new_eff, new_eff_hint, page_id),
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
