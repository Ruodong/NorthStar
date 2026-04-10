#!/usr/bin/env python3
"""Load Neo4j graph from NorthStar Postgres master data.

Pipeline:
    ref_diagram_app  + ref_diagram → ref_request → ref_project
    ref_diagram_interaction
    ref_application (for CMDB canonical name/status)
  → Neo4j Application + Project + INTEGRATES_WITH + INCLUDES

This gives you a real graph populated from EGM's already-parsed 297 apps +
241 interactions across 28 diagrams, without running any drawio parsing.

Strategy:
- For each diagram: look up governance_request → get project_id + denormalized
  project metadata (pm, leads, start date, etc.)
- For each diagram_app: derive canonical app_id
    * if standard_id + CMDB lookup → use CMDB app_id + CMDB name + CMDB status
    * else deterministic hash of (name + diagram_id)
- MERGE Project and Application nodes
- MERGE INCLUDES edges project→app
- MERGE INTEGRATES_WITH edges source_app→target_app (resolved via per-diagram
  app_id mapping, because ref_diagram_interaction stores internal cell IDs)

Usage (from ~/NorthStar on 71):
    set -a && source .env && set +a
    .venv-ingest/bin/python scripts/load_neo4j_from_pg.py [--wipe]
"""
from __future__ import annotations

import argparse
import hashlib
import logging
import os
import sys
from datetime import datetime, timezone

import psycopg
from psycopg.rows import dict_row
from neo4j import GraphDatabase

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s - %(message)s",
)
logger = logging.getLogger("load-neo4j")


def pg_dsn() -> str:
    return (
        f"host={os.environ.get('NORTHSTAR_PG_HOST', 'localhost')} "
        f"port={os.environ.get('NORTHSTAR_PG_PORT', '5434')} "
        f"dbname={os.environ.get('NORTHSTAR_PG_DB', 'northstar')} "
        f"user={os.environ.get('NORTHSTAR_PG_USER', 'northstar')} "
        f"password={os.environ.get('POSTGRES_PASSWORD', 'northstar_dev')}"
    )


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def derive_app_id(std_id: str | None, name: str, diagram_id: str, cmdb_hit: bool) -> str:
    """Resolve a canonical app_id.

    If the draw.io cell had a valid standard ID AND it matches the CMDB, we
    use it directly — all diagrams that reference the same standard app
    collapse into one Neo4j node. Otherwise, fall back to a deterministic
    hash scoped to the diagram so unrelated apps with the same name don't
    accidentally merge.
    """
    if std_id and cmdb_hit:
        return std_id
    seed = f"{name}|{diagram_id}"
    return "X" + hashlib.sha256(seed.encode("utf-8")).hexdigest()[:12]


def fy_from_date(date_str: str | None) -> str:
    """Convert a YYYY-MM-DD string to FY label (Lenovo FY: Apr-Mar)."""
    if not date_str or len(date_str) < 7:
        return ""
    try:
        year = int(date_str[:4])
        month = int(date_str[5:7])
    except ValueError:
        return ""
    # Apr (4) onwards belongs to new FY
    fy_start = year if month >= 4 else year - 1
    yy1 = fy_start % 100
    yy2 = (fy_start + 1) % 100
    return f"FY{yy1:02d}{yy2:02d}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--wipe", action="store_true", help="Delete all Neo4j nodes before loading")
    ap.add_argument(
        "--neo4j-uri",
        default=os.environ.get("NEO4J_URI_HOST", "bolt://localhost:7687"),
    )
    ap.add_argument("--neo4j-user", default=os.environ.get("NEO4J_USER", "neo4j"))
    ap.add_argument("--neo4j-password", default=os.environ.get("NEO4J_PASSWORD", "northstar_dev"))
    args = ap.parse_args()

    driver = GraphDatabase.driver(args.neo4j_uri, auth=(args.neo4j_user, args.neo4j_password))
    driver.verify_connectivity()
    logger.info("Neo4j connected at %s", args.neo4j_uri)

    src = psycopg.connect(pg_dsn(), row_factory=dict_row)

    stats = {
        "diagrams_seen": 0,
        "projects_merged": 0,
        "applications_merged": 0,
        "integrations_merged": 0,
        "cmdb_hits": 0,
        "skipped_no_request": 0,
    }

    # Load CMDB application_ids into memory for fast canonical check
    with src.cursor() as cur:
        cur.execute("SELECT app_id, name, status FROM northstar.ref_application")
        cmdb = {r["app_id"]: r for r in cur.fetchall()}
    logger.info("loaded CMDB: %d applications", len(cmdb))

    # Diagrams with their request + project metadata
    with src.cursor() as cur:
        cur.execute(
            """
            SELECT d.id AS diagram_id, d.diagram_type, d.file_name,
                   r.id AS request_id, r.project_id,
                   COALESCE(r.project_name, r.title) AS project_name,
                   r.project_pm, r.project_pm_itcode,
                   r.project_dt_lead, r.project_dt_lead_itcode,
                   r.project_it_lead, r.project_it_lead_itcode,
                   r.project_start_date, r.project_status, r.status AS review_status
            FROM northstar.ref_diagram d
            LEFT JOIN northstar.ref_request r ON d.request_id = r.id
            WHERE d.diagram_type = 'App_Arch'
            """
        )
        diagrams = cur.fetchall()
    logger.info("loaded diagrams: %d App_Arch", len(diagrams))

    try:
        with driver.session() as ns:
            if args.wipe:
                logger.info("wiping Neo4j...")
                ns.run("MATCH (n) DETACH DELETE n")

            for diag in diagrams:
                stats["diagrams_seen"] += 1
                diagram_id = str(diag["diagram_id"])
                request_id = diag.get("request_id")
                if not request_id:
                    stats["skipped_no_request"] += 1
                    continue

                # Use project_id if present, else fall back to request id as pseudo-project
                project_id = (diag.get("project_id") or "").strip()
                if not project_id:
                    project_id = f"REQ-{str(request_id)[:8]}"
                project_name = (diag.get("project_name") or project_id)[:200]
                fy = fy_from_date(diag.get("project_start_date"))

                # MERGE Project
                ns.run(
                    """
                    MERGE (p:Project {project_id: $project_id})
                    SET p.name = $name,
                        p.fiscal_year = coalesce(p.fiscal_year, $fy),
                        p.pm = coalesce($pm, ''),
                        p.pm_itcode = coalesce($pm_itcode, ''),
                        p.it_lead = coalesce($it_lead, ''),
                        p.it_lead_itcode = coalesce($it_lead_itcode, ''),
                        p.dt_lead = coalesce($dt_lead, ''),
                        p.dt_lead_itcode = coalesce($dt_lead_itcode, ''),
                        p.review_status = coalesce($review_status, ''),
                        p.source = 'EGM',
                        p.last_updated = $now
                    """,
                    project_id=project_id,
                    name=project_name,
                    fy=fy,
                    pm=diag.get("project_pm") or "",
                    pm_itcode=diag.get("project_pm_itcode") or "",
                    it_lead=diag.get("project_it_lead") or "",
                    it_lead_itcode=diag.get("project_it_lead_itcode") or "",
                    dt_lead=diag.get("project_dt_lead") or "",
                    dt_lead_itcode=diag.get("project_dt_lead_itcode") or "",
                    review_status=diag.get("review_status") or diag.get("project_status") or "",
                    now=now_iso(),
                )
                stats["projects_merged"] += 1

                # Load this diagram's apps
                with src.cursor() as cur:
                    cur.execute(
                        """
                        SELECT id, app_id AS cell_id, app_name, standard_id, id_is_standard,
                               application_status, functions
                        FROM northstar.ref_diagram_app
                        WHERE diagram_id = %s
                        """,
                        (diagram_id,),
                    )
                    apps = cur.fetchall()

                app_id_by_cell: dict[str, str] = {}
                for a in apps:
                    raw_std = (a.get("standard_id") or "").strip()
                    cmdb_hit = bool(raw_std and raw_std in cmdb)
                    if cmdb_hit:
                        stats["cmdb_hits"] += 1

                    app_id = derive_app_id(raw_std, a["app_name"], diagram_id, cmdb_hit)
                    cell_id = a.get("cell_id") or ""
                    if cell_id:
                        app_id_by_cell[cell_id] = app_id

                    canonical_name = cmdb[raw_std]["name"] if cmdb_hit else a["app_name"]
                    canonical_status = (
                        cmdb[raw_std]["status"]
                        if cmdb_hit
                        else (a.get("application_status") or "Unknown")
                    )
                    funcs = a.get("functions") or []
                    description = ", ".join(funcs) if funcs else ""

                    ns.run(
                        """
                        MERGE (a:Application {app_id: $app_id})
                        ON CREATE SET
                            a.name = $name,
                            a.status = $status,
                            a.description = $description,
                            a.source_project_id = $project_id,
                            a.source_fiscal_year = $fy,
                            a.cmdb_linked = $cmdb_hit,
                            a.last_updated = $now
                        ON MATCH SET
                            a.name = CASE WHEN $cmdb_hit THEN $name ELSE coalesce(a.name, $name) END,
                            a.status = CASE WHEN $cmdb_hit THEN $status ELSE coalesce(a.status, $status) END,
                            a.cmdb_linked = a.cmdb_linked OR $cmdb_hit,
                            a.last_updated = $now
                        WITH a
                        MATCH (p:Project {project_id: $project_id})
                        MERGE (p)-[:INCLUDES]->(a)
                        """,
                        app_id=app_id,
                        name=canonical_name,
                        status=canonical_status,
                        description=description,
                        project_id=project_id,
                        fy=fy,
                        cmdb_hit=cmdb_hit,
                        now=now_iso(),
                    )
                    stats["applications_merged"] += 1

                # Integrations for this diagram
                with src.cursor() as cur:
                    cur.execute(
                        """
                        SELECT source_app_id, target_app_id, interaction_type,
                               direction, business_object, interface_status
                        FROM northstar.ref_diagram_interaction
                        WHERE diagram_id = %s
                        """,
                        (diagram_id,),
                    )
                    inters = cur.fetchall()

                for inter in inters:
                    src_cell = inter.get("source_app_id")
                    tgt_cell = inter.get("target_app_id")
                    src_app_id = app_id_by_cell.get(src_cell)
                    tgt_app_id = app_id_by_cell.get(tgt_cell)
                    if not src_app_id or not tgt_app_id:
                        continue
                    ns.run(
                        """
                        MATCH (a:Application {app_id: $src}), (b:Application {app_id: $tgt})
                        MERGE (a)-[r:INTEGRATES_WITH {interaction_type: $itype, business_object: $bobj}]->(b)
                        SET r.status = $status,
                            r.direction = $direction
                        """,
                        src=src_app_id,
                        tgt=tgt_app_id,
                        itype=inter.get("interaction_type") or "",
                        bobj=inter.get("business_object") or "",
                        status=inter.get("interface_status") or "Keep",
                        direction=inter.get("direction") or "outbound",
                    )
                    stats["integrations_merged"] += 1

    finally:
        src.close()
        driver.close()

    logger.info("DONE")
    for k, v in stats.items():
        logger.info("  %-25s %d", k, v)
    return 0


if __name__ == "__main__":
    sys.exit(main())
