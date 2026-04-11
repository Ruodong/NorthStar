#!/usr/bin/env python3
"""Reconcile drawio-extracted app_name ↔ standard_id against CMDB.

Spec: .specify/features/drawio-name-id-reconciliation/spec.md

Uses PostgreSQL's pg_trgm extension (already enabled via migration 007)
with GIN indexes on ref_application.name / app_full_name. This pushes
the fuzzy matching into the database where GIN accelerates similarity
queries by ~100x vs Python-side SequenceMatcher on 49k × 4k candidates.

Thresholds (Q1=A locked with user 2026-04-11):
    DIRECT_MIN_SIM   = 0.85  → direct
    TYPO_MIN_SIM     = 0.60  → typo_tolerated
    REVERSE_MIN_SIM  = 0.70  → auto_corrected / fuzzy_by_name

Usage (on 71):
    set -a && source .env && set +a
    .venv-ingest/bin/python scripts/resolve_confluence_drawio_apps.py [--dry-run]
"""
from __future__ import annotations

import argparse
import logging
import os
import sys

import psycopg
from psycopg.rows import dict_row

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s - %(message)s")
logger = logging.getLogger("resolve-confluence-drawio-apps")

DIRECT_MIN_SIM = 0.85
TYPO_MIN_SIM   = 0.60
REVERSE_MIN_SIM = 0.70


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
                    help="Print preview; do not write.")
    ap.add_argument("--batch-size", type=int, default=2000,
                    help="Commit every N rows (default 2000)")
    args = ap.parse_args()

    conn = psycopg.connect(pg_dsn(), row_factory=dict_row)
    conn.autocommit = False

    stats = {"scanned": 0, "updated": 0, "no_change": 0}
    tally = {
        "direct": 0,
        "typo_tolerated": 0,
        "auto_corrected": 0,
        "auto_corrected_missing_id": 0,
        "fuzzy_by_name": 0,
        "mismatch_unresolved": 0,
        "no_cmdb": 0,
    }

    try:
        # Tune pg_trgm similarity threshold for the session so the `%`
        # operator returns even modestly-similar candidates (we'll still
        # check the numeric similarity ourselves against our own buckets).
        with conn.cursor() as cur:
            cur.execute("SET pg_trgm.similarity_threshold = 0.3")

        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT attachment_id, cell_id, app_name, standard_id,
                       resolved_app_id, match_type, name_similarity
                FROM northstar.confluence_diagram_app
                """
            )
            rows = cur.fetchall()
        logger.info("loaded %d confluence_diagram_app rows", len(rows))

        with conn.cursor() as lookup_cur, conn.cursor() as wcur:
            for idx, row in enumerate(rows, 1):
                stats["scanned"] += 1
                drawio_name = (row["app_name"] or "").strip()
                drawio_std_id = (row["standard_id"] or "").strip() or None

                resolved: str | None = None
                match_type = "no_cmdb"
                sim = 0.0

                if not drawio_name and not drawio_std_id:
                    match_type, sim = "no_cmdb", 0.0
                elif not drawio_std_id:
                    # Pure fuzzy-by-name
                    lookup_cur.execute(
                        """
                        SELECT app_id,
                               GREATEST(
                                 similarity(lower(name),       lower(%(n)s)),
                                 similarity(lower(coalesce(app_full_name,'')), lower(%(n)s))
                               ) AS sim
                        FROM northstar.ref_application
                        WHERE (lower(name) %% lower(%(n)s)
                               OR lower(coalesce(app_full_name,'')) %% lower(%(n)s))
                          AND GREATEST(
                                  similarity(lower(name), lower(%(n)s)),
                                  similarity(lower(coalesce(app_full_name,'')), lower(%(n)s))
                              ) >= %(thr)s
                        ORDER BY sim DESC,
                                 CASE status
                                     WHEN 'Active'         THEN 0
                                     WHEN 'Planned'        THEN 1
                                     WHEN 'Decommissioned' THEN 2
                                     ELSE 3
                                 END,
                                 app_id
                        LIMIT 1
                        """,
                        {"n": drawio_name, "thr": REVERSE_MIN_SIM},
                    )
                    hit = lookup_cur.fetchone()
                    if hit:
                        resolved = hit["app_id"]
                        sim = float(hit["sim"])
                        match_type = "fuzzy_by_name"
                    else:
                        match_type, sim = "no_cmdb", 0.0
                else:
                    # drawio_std_id present — first look it up in CMDB
                    lookup_cur.execute(
                        """
                        SELECT app_id, name, app_full_name,
                               GREATEST(
                                 similarity(lower(coalesce(name,'')),          lower(%(n)s)),
                                 similarity(lower(coalesce(app_full_name,'')), lower(%(n)s))
                               ) AS sim
                        FROM northstar.ref_application
                        WHERE app_id = %(std)s
                        """,
                        {"std": drawio_std_id, "n": drawio_name},
                    )
                    cmdb_rec = lookup_cur.fetchone()

                    if cmdb_rec is None:
                        # std_id not in CMDB — try pure fuzzy on name
                        lookup_cur.execute(
                            """
                            SELECT app_id,
                                   GREATEST(
                                     similarity(lower(name),       lower(%(n)s)),
                                     similarity(lower(coalesce(app_full_name,'')), lower(%(n)s))
                                   ) AS sim
                            FROM northstar.ref_application
                            WHERE (lower(name) %% lower(%(n)s)
                                   OR lower(coalesce(app_full_name,'')) %% lower(%(n)s))
                              AND GREATEST(
                                      similarity(lower(name), lower(%(n)s)),
                                      similarity(lower(coalesce(app_full_name,'')), lower(%(n)s))
                                  ) >= %(thr)s
                            ORDER BY sim DESC,
                                     CASE status
                                         WHEN 'Active'         THEN 0
                                         WHEN 'Planned'        THEN 1
                                         WHEN 'Decommissioned' THEN 2
                                         ELSE 3
                                     END,
                                     app_id
                            LIMIT 1
                            """,
                            {"n": drawio_name, "thr": REVERSE_MIN_SIM},
                        )
                        hit = lookup_cur.fetchone()
                        if hit:
                            resolved = hit["app_id"]
                            sim = float(hit["sim"])
                            match_type = "auto_corrected_missing_id"
                        else:
                            resolved = drawio_std_id
                            match_type, sim = "no_cmdb", 0.0
                    else:
                        sim = float(cmdb_rec["sim"] or 0)
                        if sim >= DIRECT_MIN_SIM:
                            resolved = drawio_std_id
                            match_type = "direct"
                        elif sim >= TYPO_MIN_SIM:
                            resolved = drawio_std_id
                            match_type = "typo_tolerated"
                        else:
                            # Names disagree — reverse fuzzy
                            lookup_cur.execute(
                                """
                                SELECT app_id,
                                       GREATEST(
                                         similarity(lower(name),       lower(%(n)s)),
                                         similarity(lower(coalesce(app_full_name,'')), lower(%(n)s))
                                       ) AS sim
                                FROM northstar.ref_application
                                WHERE app_id <> %(std)s
                                  AND (lower(name) %% lower(%(n)s)
                                       OR lower(coalesce(app_full_name,'')) %% lower(%(n)s))
                                  AND GREATEST(
                                          similarity(lower(name), lower(%(n)s)),
                                          similarity(lower(coalesce(app_full_name,'')), lower(%(n)s))
                                      ) >= %(thr)s
                                ORDER BY sim DESC,
                                         CASE status
                                             WHEN 'Active'         THEN 0
                                             WHEN 'Planned'        THEN 1
                                             WHEN 'Decommissioned' THEN 2
                                             ELSE 3
                                         END,
                                         app_id
                                LIMIT 1
                                """,
                                {"n": drawio_name, "std": drawio_std_id,
                                 "thr": REVERSE_MIN_SIM},
                            )
                            hit = lookup_cur.fetchone()
                            if hit:
                                resolved = hit["app_id"]
                                sim = float(hit["sim"])
                                match_type = "auto_corrected"
                            else:
                                resolved = drawio_std_id
                                match_type = "mismatch_unresolved"

                tally[match_type] = tally.get(match_type, 0) + 1
                sim_rounded = round(sim, 4)

                # Skip if nothing changed
                old_resolved = row["resolved_app_id"]
                old_match = row["match_type"]
                old_sim = (
                    round(row["name_similarity"], 4)
                    if row["name_similarity"] is not None else None
                )
                if (
                    old_resolved == resolved
                    and old_match == match_type
                    and old_sim == sim_rounded
                ):
                    stats["no_change"] += 1
                    continue

                if args.dry_run:
                    stats["updated"] += 1
                    if stats["updated"] < 20:
                        logger.info(
                            "  dry name=%r std=%r → %r / %s / %.3f",
                            drawio_name, drawio_std_id,
                            resolved, match_type, sim_rounded,
                        )
                    continue

                wcur.execute(
                    """
                    UPDATE northstar.confluence_diagram_app
                    SET resolved_app_id = %s,
                        match_type      = %s,
                        name_similarity = %s
                    WHERE attachment_id = %s AND cell_id = %s
                    """,
                    (resolved, match_type, sim_rounded,
                     row["attachment_id"], row["cell_id"]),
                )
                stats["updated"] += 1

                if idx % args.batch_size == 0:
                    conn.commit()
                    logger.info("  progress: %d/%d  updated=%d  no_change=%d",
                                idx, len(rows), stats["updated"], stats["no_change"])

        if not args.dry_run:
            conn.commit()
    finally:
        conn.close()

    logger.info("DONE:")
    for k, v in stats.items():
        logger.info("  %-14s %d", k, v)
    logger.info("match_type breakdown:")
    for k, v in sorted(tally.items(), key=lambda kv: -kv[1]):
        pct = 100.0 * v / max(stats["scanned"], 1)
        logger.info("  %-28s %5d  (%5.1f%%)", k, v, pct)
    return 0


if __name__ == "__main__":
    sys.exit(main())
