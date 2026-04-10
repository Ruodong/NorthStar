#!/usr/bin/env python3
"""Load Neo4j from Confluence-scanned drawio files + PG master data.

This is the "real" graph loader — it replaces load_neo4j_from_pg.py as the
primary source because the scanner has 38+ real drawio files from the
Lenovo ARD space while EGM's cached data was only 28.

Data flow:
    confluence_attachment (file_kind='drawio', local file on disk)
      ↓ drawio_parser
    applications + interactions (with cell-level linkage)
      ↓
    cross-reference with:
      - ref_application  (CMDB canonical name + status)
      - confluence_page  (questionnaire-derived project metadata)
      - ref_project      (MSPO master — PM/Lead display names)
      ↓
    Neo4j MERGE:
      (Project)-[:INCLUDES]->(Application)-[:INTEGRATES_WITH]->(Application)

Every Application uses CMDB standard_id as the MERGE key when available
(so the same app appearing in multiple project diagrams collapses to a
single node), else a deterministic hash scoped per diagram.

Every Project gets enriched with:
  - MSPO: project_name, status, go_live_date
  - Confluence questionnaire: q_pm, q_it_lead, q_dt_lead, page_url, fiscal_year
  - (optional) resolved PM/Lead display names via ref_employee

Usage (from ~/NorthStar on 71):
    set -a && source .env && set +a
    .venv-ingest/bin/python scripts/load_neo4j_from_confluence.py [--wipe]
"""
from __future__ import annotations

import argparse
import hashlib
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path as _P

# Make backend/app importable so we can reuse drawio_parser verbatim.
sys.path.insert(0, str(_P(__file__).resolve().parent.parent / "backend"))

import psycopg
from psycopg.rows import dict_row
from neo4j import GraphDatabase

from app.services.drawio_parser import parse_drawio_xml  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s - %(message)s",
)
logger = logging.getLogger("load-neo4j-confluence")

ROOT = _P(__file__).resolve().parent.parent
ATTACHMENT_ROOT = ROOT / "data" / "attachments"


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


def derive_app_id(std_id: str | None, name: str, diagram_scope: str, cmdb_hit: bool) -> str:
    if std_id and cmdb_hit:
        return std_id
    seed = f"{name}|{diagram_scope}"
    return "X" + hashlib.sha256(seed.encode("utf-8")).hexdigest()[:12]


def load_attachment_file(local_path_rel: str) -> str | None:
    """Resolve a stored relative path to the local attachments dir."""
    if not local_path_rel:
        return None
    # Stored as data/attachments/<id><ext> relative to repo root.
    # Also handle cases where only the filename was stored.
    candidates = [
        ROOT / local_path_rel,
        ATTACHMENT_ROOT / _P(local_path_rel).name,
    ]
    for c in candidates:
        if c.exists():
            try:
                return c.read_text(encoding="utf-8", errors="ignore")
            except Exception as exc:  # noqa: BLE001
                logger.warning("read failed %s: %s", c, exc)
                return None
    logger.warning("attachment not found on disk: %s", local_path_rel)
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--wipe", action="store_true", help="DETACH DELETE all nodes first")
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

    # Preload CMDB for canonical app resolution
    with src.cursor() as cur:
        cur.execute("SELECT app_id, name, status FROM northstar.ref_application")
        cmdb = {r["app_id"]: r for r in cur.fetchall()}
    logger.info("loaded CMDB: %d applications", len(cmdb))

    # Preload employee map for itcode → name (optional enrichment)
    with src.cursor() as cur:
        cur.execute(
            "SELECT itcode, name, email, tier_1_org FROM northstar.ref_employee WHERE name IS NOT NULL"
        )
        employees = {r["itcode"]: r for r in cur.fetchall()}
    logger.info("loaded employees: %d", len(employees))

    # Join drawio attachments to their Confluence page metadata +
    # (optional) MSPO master. Only include pages that have a project_id
    # (either from the title or from the questionnaire) — otherwise we can't
    # reliably group apps under a project.
    with src.cursor() as cur:
        cur.execute(
            """
            SELECT
                a.attachment_id,
                a.title              AS file_title,
                a.local_path,
                a.media_type,
                p.page_id,
                p.title              AS page_title,
                p.fiscal_year,
                p.page_url,
                COALESCE(p.q_project_id, p.project_id) AS project_id,
                p.q_project_name,
                p.q_pm,
                p.q_it_lead,
                p.q_dt_lead,
                mp.project_name      AS mspo_name,
                mp.status            AS mspo_status,
                mp.pm                AS mspo_pm,
                mp.it_lead           AS mspo_it_lead,
                mp.dt_lead           AS mspo_dt_lead,
                mp.start_date        AS mspo_start_date,
                mp.go_live_date      AS mspo_go_live_date
            FROM northstar.confluence_attachment a
            JOIN northstar.confluence_page p ON p.page_id = a.page_id
            LEFT JOIN northstar.ref_project mp
                   ON mp.project_id = COALESCE(p.q_project_id, p.project_id)
            WHERE a.file_kind = 'drawio'
              AND a.local_path IS NOT NULL
              AND a.title NOT LIKE 'drawio-backup%'
              AND a.title NOT LIKE '~%'
              AND a.title NOT LIKE '%.png'
              AND COALESCE(p.q_project_id, p.project_id) IS NOT NULL
            ORDER BY p.fiscal_year DESC, p.title, a.title
            """
        )
        rows = cur.fetchall()
    logger.info("candidate drawio files: %d", len(rows))

    stats = {
        "files_total": len(rows),
        "files_parsed": 0,
        "files_skipped_empty": 0,
        "files_parse_error": 0,
        "projects_merged": 0,
        "applications_merged": 0,
        "integrations_merged": 0,
        "cmdb_hits": 0,
    }
    seen_projects: set[str] = set()

    try:
        with driver.session() as ns:
            if args.wipe:
                logger.info("wiping Neo4j...")
                ns.run("MATCH (n) DETACH DELETE n")

            for r in rows:
                project_id = r["project_id"].strip()
                if not project_id:
                    continue

                xml = load_attachment_file(r["local_path"])
                if not xml:
                    stats["files_skipped_empty"] += 1
                    continue
                try:
                    parsed = parse_drawio_xml(xml, "App_Arch")
                except Exception as exc:  # noqa: BLE001
                    logger.warning(
                        "parse failed %s (%s): %s", r["attachment_id"], r["file_title"], exc
                    )
                    stats["files_parse_error"] += 1
                    continue
                apps = parsed.get("applications", [])
                inters = parsed.get("interactions", [])
                if not apps:
                    stats["files_skipped_empty"] += 1
                    continue
                stats["files_parsed"] += 1

                # Resolve PM/Lead display names via ref_employee
                def resolve(itcode: str | None) -> tuple[str, str]:
                    if not itcode:
                        return "", ""
                    emp = employees.get(itcode)
                    if emp:
                        return itcode, emp.get("name") or ""
                    return itcode, ""

                pm_code, pm_name = resolve(r["q_pm"])
                it_code, it_name = resolve(r["q_it_lead"])
                dt_code, dt_name = resolve(r["q_dt_lead"])

                # MSPO values are already display names — use them if present,
                # else fall back to questionnaire itcode → employee display name.
                project_name = r["q_project_name"] or r["mspo_name"] or r["page_title"]

                # MERGE Project node (once per project, not per file)
                if project_id not in seen_projects:
                    seen_projects.add(project_id)
                    ns.run(
                        """
                        MERGE (p:Project {project_id: $project_id})
                        SET p.name = $name,
                            p.fiscal_year = $fiscal_year,
                            p.page_url = $page_url,
                            p.page_id = $page_id,
                            p.pm = coalesce($pm_name, $pm_code),
                            p.pm_itcode = $pm_code,
                            p.it_lead = coalesce($it_name, $it_code),
                            p.it_lead_itcode = $it_code,
                            p.dt_lead = coalesce($dt_name, $dt_code),
                            p.dt_lead_itcode = $dt_code,
                            p.mspo_status = coalesce($mspo_status, ''),
                            p.mspo_pm = coalesce($mspo_pm, ''),
                            p.mspo_it_lead = coalesce($mspo_it_lead, ''),
                            p.mspo_dt_lead = coalesce($mspo_dt_lead, ''),
                            p.go_live_date = coalesce($go_live, ''),
                            p.start_date = coalesce($start_date, ''),
                            p.source = 'Confluence',
                            p.last_updated = $now
                        """,
                        project_id=project_id,
                        name=(project_name or project_id)[:200],
                        fiscal_year=r["fiscal_year"] or "",
                        page_url=r["page_url"] or "",
                        page_id=r["page_id"] or "",
                        pm_code=pm_code, pm_name=pm_name or None,
                        it_code=it_code, it_name=it_name or None,
                        dt_code=dt_code, dt_name=dt_name or None,
                        mspo_status=r.get("mspo_status"),
                        mspo_pm=r.get("mspo_pm"),
                        mspo_it_lead=r.get("mspo_it_lead"),
                        mspo_dt_lead=r.get("mspo_dt_lead"),
                        go_live=r.get("mspo_go_live_date"),
                        start_date=r.get("mspo_start_date"),
                        now=now_iso(),
                    )
                    stats["projects_merged"] += 1

                # App cell_id → canonical app_id map (scoped to this diagram)
                diagram_scope = f"{project_id}:{r['attachment_id']}"
                app_id_by_cell: dict[str, str] = {}
                for app in apps:
                    raw_std = (app.get("standard_id") or "").strip()
                    cmdb_hit = bool(raw_std and raw_std in cmdb)
                    if cmdb_hit:
                        stats["cmdb_hits"] += 1

                    app_name = app.get("app_name") or ""
                    app_id = derive_app_id(raw_std, app_name, diagram_scope, cmdb_hit)
                    cell_id = app.get("cell_id") or ""
                    if cell_id:
                        app_id_by_cell[cell_id] = app_id

                    canonical_name = cmdb[raw_std]["name"] if cmdb_hit else app_name
                    canonical_status = (
                        cmdb[raw_std]["status"]
                        if cmdb_hit
                        else (app.get("application_status") or "Unknown")
                    )
                    description = app.get("functions") or ""

                    ns.run(
                        """
                        MERGE (a:Application {app_id: $app_id})
                        ON CREATE SET
                            a.name = $name,
                            a.status = $status,
                            a.description = $description,
                            a.source_project_id = $project_id,
                            a.source_fiscal_year = $fiscal_year,
                            a.cmdb_linked = $cmdb_hit,
                            a.last_updated = $now
                        ON MATCH SET
                            a.name = CASE WHEN $cmdb_hit THEN $name ELSE coalesce(a.name, $name) END,
                            a.status = CASE WHEN $cmdb_hit THEN $status ELSE coalesce(a.status, $status) END,
                            a.description = coalesce(a.description, $description),
                            a.cmdb_linked = a.cmdb_linked OR $cmdb_hit,
                            a.last_updated = $now
                        WITH a
                        MATCH (p:Project {project_id: $project_id})
                        MERGE (p)-[:INCLUDES]->(a)
                        """,
                        app_id=app_id,
                        name=(canonical_name or app_id)[:200],
                        status=canonical_status,
                        description=description[:500] if description else "",
                        project_id=project_id,
                        fiscal_year=r["fiscal_year"] or "",
                        cmdb_hit=cmdb_hit,
                        now=now_iso(),
                    )
                    stats["applications_merged"] += 1

                for inter in inters:
                    src_cell = inter.get("source_id")
                    tgt_cell = inter.get("target_id")
                    src_app_id = app_id_by_cell.get(src_cell)
                    tgt_app_id = app_id_by_cell.get(tgt_cell)
                    if not src_app_id or not tgt_app_id:
                        continue
                    ns.run(
                        """
                        MATCH (a:Application {app_id: $src}), (b:Application {app_id: $tgt})
                        MERGE (a)-[r:INTEGRATES_WITH {interaction_type: $itype, business_object: $bobj}]->(b)
                        SET r.status = $status,
                            r.direction = $direction,
                            r.protocol = $protocol
                        """,
                        src=src_app_id,
                        tgt=tgt_app_id,
                        itype=(inter.get("interaction_type") or "")[:50],
                        bobj=(inter.get("business_object") or "")[:100],
                        status=inter.get("interaction_status") or "Keep",
                        direction=inter.get("direction") or "outbound",
                        protocol=(inter.get("label") or "")[:200],
                    )
                    stats["integrations_merged"] += 1

                if stats["files_parsed"] % 5 == 0:
                    logger.info(
                        "  %d/%d files processed | projects=%d apps=%d inters=%d",
                        stats["files_parsed"],
                        stats["files_total"],
                        stats["projects_merged"],
                        stats["applications_merged"],
                        stats["integrations_merged"],
                    )
    finally:
        src.close()
        driver.close()

    logger.info("DONE")
    for k, v in stats.items():
        logger.info("  %-25s %d", k, v)
    return 0


if __name__ == "__main__":
    sys.exit(main())
