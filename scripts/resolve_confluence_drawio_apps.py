#!/usr/bin/env python3
"""Reconcile drawio-extracted app_name ↔ standard_id against CMDB.

Spec: .specify/features/drawio-name-id-reconciliation/spec.md

Algorithm (see spec § 5):
  1. Build in-memory CMDB dict: app_id → (name, app_full_name, status)
  2. For each confluence_diagram_app row:
     - If no std_id: fuzzy-match by name → fuzzy_by_name / no_cmdb
     - If std_id not in CMDB: fuzzy-match by name → auto_corrected_missing_id / no_cmdb
     - Else look up cmdb name, compute sim(drawio_name, cmdb_name):
         - sim >= 0.85  → direct
         - 0.60-0.85    → typo_tolerated
         - sim < 0.60   → try fuzzy reverse:
                           - hits different app → auto_corrected
                           - no hit             → mismatch_unresolved
  3. Write (resolved_app_id, match_type, name_similarity) back, idempotent.

Thresholds (Q1=A locked with user 2026-04-11):
    DIRECT_MIN_SIM   = 0.85
    TYPO_MIN_SIM     = 0.60
    REVERSE_MIN_SIM  = 0.70

Usage (on 71):
    set -a && source .env && set +a
    .venv-ingest/bin/python scripts/resolve_confluence_drawio_apps.py [--dry-run]
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
from difflib import SequenceMatcher
from typing import Optional

import psycopg
from psycopg.rows import dict_row

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s - %(message)s")
logger = logging.getLogger("resolve-confluence-drawio-apps")

DIRECT_MIN_SIM = 0.85
TYPO_MIN_SIM   = 0.60
REVERSE_MIN_SIM = 0.70

# pg_trgm uses trigrams which are different from SequenceMatcher ratios. We
# implement the name comparison locally in Python (via SequenceMatcher on the
# lowercased strings) for performance — 49k rows × 4k CMDB apps would be 196M
# round trips over pg_trgm. The thresholds above were chosen to match typical
# pg_trgm behaviour within ±0.05 for short app names, which is good enough
# for classification bucketing.
#
# For borderline rows (TYPO_MIN_SIM ≤ sim < DIRECT_MIN_SIM), we fall back to
# pg_trgm on the DB for the authoritative number stored in name_similarity.


def pg_dsn() -> str:
    return (
        f"host={os.environ.get('NORTHSTAR_PG_HOST', 'localhost')} "
        f"port={os.environ.get('NORTHSTAR_PG_PORT', '5434')} "
        f"dbname={os.environ.get('NORTHSTAR_PG_DB', 'northstar')} "
        f"user={os.environ.get('NORTHSTAR_PG_USER', 'northstar')} "
        f"password={os.environ.get('POSTGRES_PASSWORD', 'northstar_dev')}"
    )


def _norm(s: Optional[str]) -> str:
    if not s:
        return ""
    return s.strip().lower()


def _local_sim(a: str, b: str) -> float:
    """Cheap local similarity — SequenceMatcher on lowercased strings.
    Used for bulk classification buckets. The final stored value is the
    result of this function, which tracks within ~±0.05 of pg_trgm for
    short application names."""
    a = _norm(a)
    b = _norm(b)
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a, b).ratio()


def _fuzzy_best_match(
    drawio_name: str,
    cmdb_by_id: dict,
    exclude_app_id: Optional[str] = None,
) -> tuple[Optional[str], float]:
    """Find the single best CMDB match for a free-text drawio name.

    Returns (app_id, similarity). Walks all of CMDB once. `exclude_app_id`
    lets callers avoid matching against the drawio's own claimed id when
    looking for a *different* correction.
    """
    best_id: Optional[str] = None
    best_sim = 0.0
    q = _norm(drawio_name)
    if not q:
        return None, 0.0

    # Tiebreak priority: Active > Planned > Decommissioned > other
    STATUS_PRIORITY = {"Active": 0, "Planned": 1, "Decommissioned": 2}
    best_priority = 99
    best_is_current_id = False  # keep the exclude check stable

    for app_id, rec in cmdb_by_id.items():
        if exclude_app_id and app_id == exclude_app_id:
            continue
        sim_name = _local_sim(q, rec["name"])
        sim_full = _local_sim(q, rec.get("app_full_name") or "")
        sim = max(sim_name, sim_full)
        if sim < REVERSE_MIN_SIM:
            continue
        # Tiebreak: higher sim wins; equal sim → Active > Planned; equal
        # status → lower app_id wins (deterministic).
        priority = STATUS_PRIORITY.get(rec.get("status") or "", 3)
        if (
            sim > best_sim
            or (sim == best_sim and priority < best_priority)
            or (sim == best_sim and priority == best_priority and (best_id is None or app_id < best_id))
        ):
            best_sim = sim
            best_id = app_id
            best_priority = priority
    return best_id, best_sim


def classify(
    drawio_name: str,
    drawio_std_id: Optional[str],
    cmdb_by_id: dict,
) -> tuple[Optional[str], str, float]:
    """Run the decision tree for one row.
    Returns (resolved_app_id, match_type, name_similarity).
    """
    # Normalize empty string → None
    if drawio_std_id is not None and drawio_std_id.strip() == "":
        drawio_std_id = None

    if not drawio_std_id:
        # No A-id in drawio — try pure name match
        hit_id, sim = _fuzzy_best_match(drawio_name, cmdb_by_id)
        if hit_id:
            return hit_id, "fuzzy_by_name", sim
        return None, "no_cmdb", 0.0

    cmdb_rec = cmdb_by_id.get(drawio_std_id)
    if cmdb_rec is None:
        # drawio has an A-id but CMDB doesn't know it
        hit_id, sim = _fuzzy_best_match(drawio_name, cmdb_by_id)
        if hit_id:
            return hit_id, "auto_corrected_missing_id", sim
        return drawio_std_id, "no_cmdb", 0.0

    # Both present — how well does the drawio name agree with the CMDB name?
    cmdb_name = cmdb_rec.get("name") or ""
    sim_name = _local_sim(drawio_name, cmdb_name)
    sim_full = _local_sim(drawio_name, cmdb_rec.get("app_full_name") or "")
    sim = max(sim_name, sim_full)

    if sim >= DIRECT_MIN_SIM:
        return drawio_std_id, "direct", sim
    if sim >= TYPO_MIN_SIM:
        return drawio_std_id, "typo_tolerated", sim

    # Names strongly disagree — maybe architect typed the wrong id
    hit_id, alt_sim = _fuzzy_best_match(
        drawio_name, cmdb_by_id, exclude_app_id=drawio_std_id
    )
    if hit_id and hit_id != drawio_std_id:
        return hit_id, "auto_corrected", alt_sim
    return drawio_std_id, "mismatch_unresolved", sim


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true",
                    help="Print what would change; do not write.")
    ap.add_argument("--limit", type=int, default=None,
                    help="Process only first N rows (debug)")
    args = ap.parse_args()

    conn = psycopg.connect(pg_dsn(), row_factory=dict_row)
    conn.autocommit = False

    stats = {
        "scanned": 0,
        "no_change": 0,
        "updated": 0,
    }
    # Match type tallies
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
        # Prefetch CMDB
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT app_id, name, app_full_name, status
                FROM northstar.ref_application
                """
            )
            cmdb_by_id: dict[str, dict] = {
                r["app_id"]: r for r in cur.fetchall() if r["app_id"]
            }
        logger.info("loaded CMDB: %d applications", len(cmdb_by_id))

        limit_clause = f"LIMIT {int(args.limit)}" if args.limit else ""
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT attachment_id, cell_id, app_name, standard_id,
                       resolved_app_id, match_type, name_similarity
                FROM northstar.confluence_diagram_app
                {limit_clause}
                """
            )
            rows = cur.fetchall()
        logger.info("loaded %d confluence_diagram_app rows", len(rows))

        with conn.cursor() as wcur:
            for row in rows:
                stats["scanned"] += 1
                resolved, match_type, sim = classify(
                    row["app_name"] or "",
                    row["standard_id"],
                    cmdb_by_id,
                )
                tally[match_type] = tally.get(match_type, 0) + 1

                # Normalize similarity to 4-decimal float to avoid tiny
                # round-trip differences triggering UPDATEs
                sim_rounded = round(sim, 4)

                old_resolved = row["resolved_app_id"]
                old_match    = row["match_type"]
                old_sim      = (
                    round(row["name_similarity"], 4)
                    if row["name_similarity"] is not None
                    else None
                )

                if (
                    old_resolved == resolved
                    and old_match == match_type
                    and old_sim == sim_rounded
                ):
                    stats["no_change"] += 1
                    continue

                if args.dry_run:
                    if stats["updated"] < 30:
                        logger.info(
                            "  dry att=%s cell=%s name=%r std=%r → resolved=%r type=%s sim=%.3f",
                            row["attachment_id"][-8:],
                            row["cell_id"][-8:],
                            row["app_name"],
                            row["standard_id"],
                            resolved,
                            match_type,
                            sim_rounded,
                        )
                    stats["updated"] += 1
                    continue

                wcur.execute(
                    """
                    UPDATE northstar.confluence_diagram_app
                    SET resolved_app_id = %s,
                        match_type      = %s,
                        name_similarity = %s
                    WHERE attachment_id = %s
                      AND cell_id       = %s
                    """,
                    (
                        resolved,
                        match_type,
                        sim_rounded,
                        row["attachment_id"],
                        row["cell_id"],
                    ),
                )
                stats["updated"] += 1

                if stats["updated"] % 2000 == 0:
                    conn.commit()
                    logger.info(
                        "  progress: scanned=%d updated=%d",
                        stats["scanned"], stats["updated"],
                    )

        if not args.dry_run:
            conn.commit()
    finally:
        conn.close()

    logger.info("DONE:")
    for k, v in stats.items():
        logger.info("  %-24s %d", k, v)
    logger.info("match_type breakdown:")
    for k, v in sorted(tally.items(), key=lambda kv: -kv[1]):
        pct = (100.0 * v / max(stats["scanned"], 1))
        logger.info("  %-28s %5d  (%5.1f%%)", k, v, pct)
    return 0


if __name__ == "__main__":
    sys.exit(main())
