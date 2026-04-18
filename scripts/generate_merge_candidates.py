#!/usr/bin/env python3
"""Generate fuzzy merge candidates for non-CMDB applications.

Reads :Application nodes from Neo4j where cmdb_linked=false, computes a
normalized name signature for each, groups by norm_key, and writes groups
with >= 2 members to northstar.pending_app_merge for human review via
/admin/aliases.

Also refreshes northstar.app_normalized_name so the review UI can show the
current signature for any app_id.

Idempotent: reruns upsert normalized names and insert new pending groups.
It will NOT re-propose a group where all candidate_ids are identical to a
still-pending row.

Usage:
    set -a && source .env && set +a
    .venv-ingest/bin/python scripts/generate_merge_candidates.py [--min-candidates 2]
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
from collections import defaultdict
from pathlib import Path as _P

sys.path.insert(0, str(_P(__file__).resolve().parent.parent / "backend"))

import psycopg
from psycopg.rows import dict_row
from neo4j import GraphDatabase

from app.services.name_normalize import normalize_name  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s - %(message)s",
)
logger = logging.getLogger("merge-candidates")


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
    ap.add_argument("--min-candidates", type=int, default=2,
                    help="Minimum candidates per norm_key to propose (default: 2)")
    ap.add_argument("--neo4j-uri", default=os.environ.get("NEO4J_URI_HOST", "bolt://localhost:7687"))
    ap.add_argument("--neo4j-user", default=os.environ.get("NEO4J_USER", "neo4j"))
    ap.add_argument("--neo4j-password", default=os.environ.get("NEO4J_PASSWORD", "northstar_dev"))
    args = ap.parse_args()

    driver = GraphDatabase.driver(args.neo4j_uri, auth=(args.neo4j_user, args.neo4j_password))
    driver.verify_connectivity()
    logger.info("Neo4j connected at %s", args.neo4j_uri)

    pg = psycopg.connect(pg_dsn(), row_factory=dict_row)

    # -------------------------------------------------------------------------
    # Fetch non-CMDB apps + their investing projects from Neo4j
    # -------------------------------------------------------------------------
    cypher = """
    MATCH (a:Application)
    WHERE coalesce(a.cmdb_linked, false) = false
    OPTIONAL MATCH (p:Project)-[:INVESTS_IN]->(a)
    RETURN a.app_id AS app_id,
           a.name AS name,
           collect(DISTINCT p.project_id) AS projects
    """
    with driver.session() as ns:
        rows = list(ns.run(cypher))
    logger.info("non-CMDB applications: %d", len(rows))

    # -------------------------------------------------------------------------
    # Upsert app_normalized_name, group by norm_key
    # -------------------------------------------------------------------------
    by_norm: dict[str, list[dict]] = defaultdict(list)

    try:
        with pg.cursor() as cur:
            for r in rows:
                app_id = r["app_id"]
                raw_name = r["name"] or ""
                norm_key = normalize_name(raw_name)
                if not norm_key:
                    continue
                # Upsert into app_normalized_name
                cur.execute(
                    """
                    INSERT INTO northstar.app_normalized_name
                        (app_id, raw_name, norm_key, last_seen_at)
                    VALUES (%s, %s, %s, NOW())
                    ON CONFLICT (app_id) DO UPDATE SET
                        raw_name = EXCLUDED.raw_name,
                        norm_key = EXCLUDED.norm_key,
                        last_seen_at = NOW()
                    """,
                    (app_id, raw_name, norm_key),
                )
                by_norm[norm_key].append({
                    "app_id": app_id,
                    "raw_name": raw_name,
                    "projects": [p for p in (r["projects"] or []) if p],
                })

            # Load existing pending (undecided) rows so we don't duplicate proposals
            cur.execute(
                """
                SELECT norm_key, candidate_ids
                FROM northstar.pending_app_merge
                WHERE decision IS NULL
                """
            )
            existing_pending: dict[str, set[frozenset]] = defaultdict(set)
            for row in cur.fetchall():
                existing_pending[row["norm_key"]].add(frozenset(row["candidate_ids"]))

            # Insert new candidate groups
            proposed = 0
            skipped_duplicates = 0
            for norm_key, members in sorted(by_norm.items()):
                if len(members) < args.min_candidates:
                    continue
                candidate_ids = sorted({m["app_id"] for m in members})
                if frozenset(candidate_ids) in existing_pending[norm_key]:
                    skipped_duplicates += 1
                    continue
                raw_names = sorted({m["raw_name"] for m in members})
                projects = sorted({p for m in members for p in m["projects"]})
                cur.execute(
                    """
                    INSERT INTO northstar.pending_app_merge
                        (norm_key, candidate_ids, raw_names, projects)
                    VALUES (%s, %s, %s, %s)
                    """,
                    (norm_key, candidate_ids, raw_names, projects),
                )
                proposed += 1

        pg.commit()
        logger.info("proposed: %d new candidate groups", proposed)
        logger.info("skipped (duplicate of pending): %d", skipped_duplicates)
    finally:
        pg.close()
        driver.close()

    return 0


if __name__ == "__main__":
    sys.exit(main())
