#!/usr/bin/env python3
"""Host-side ingestion runner.

Why this exists: on server 71 the Docker bridge can't reach
km.xpaas.lenovo.com because the corporate Confluence sits behind a Cisco
AnyConnect tunnel (cscotun0) with a uid-1000 policy route. Backend
containers run as a different uid and time out. This script runs on the
HOST under the user's account, so it inherits the VPN route and can
reach Confluence directly. It still writes to the same Neo4j instance
that the backend container shares (bolt://localhost:7687).

Usage (from ~/NorthStar on 71):
    python3 -m venv .venv-ingest
    .venv-ingest/bin/pip install -r scripts/requirements.txt
    set -a && source .env && set +a
    .venv-ingest/bin/python scripts/ingest.py --fy FY2526 --limit 10
"""
from __future__ import annotations

import argparse
import hashlib
import logging
import os
import sys
from datetime import datetime
from pathlib import Path

# Make backend/app importable so we can reuse drawio_parser verbatim.
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from app.services.confluence import ConfluenceClient  # noqa: E402
from app.services.drawio_parser import parse_drawio_xml  # noqa: E402
from app.services.ai_evaluator import evaluate as ai_evaluate  # noqa: E402

from neo4j import GraphDatabase  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s - %(message)s",
)
logger = logging.getLogger("ingest")


def derive_app_id(app: dict, project_id: str) -> str:
    if app.get("id_is_standard") and app.get("standard_id"):
        return app["standard_id"]
    seed = f"{app.get('app_name', '')}|{project_id}"
    return "X" + hashlib.sha256(seed.encode("utf-8")).hexdigest()[:12]


def upsert_project(session, project) -> None:
    session.run(
        """
        MERGE (p:Project {project_id: $project_id})
        SET p.name = $name,
            p.fiscal_year = $fiscal_year,
            p.pm = $pm,
            p.it_lead = $it_lead,
            p.dt_lead = $dt_lead,
            p.review_status = $review_status,
            p.last_updated = $now
        """,
        project_id=project.project_id,
        name=project.name,
        fiscal_year=project.fiscal_year,
        pm=project.pm,
        it_lead=project.it_lead,
        dt_lead=project.dt_lead,
        review_status=project.review_status,
        now=datetime.utcnow().isoformat(),
    )


def upsert_application(session, app_id: str, app: dict, project) -> None:
    # Ontology-fix: fiscal_year + review_status live on the INVESTS_IN edge,
    # not on the Application node.
    session.run(
        """
        MERGE (a:Application {app_id: $app_id})
        ON CREATE SET a.cmdb_linked = false
        SET a.name = $name,
            a.status = $status,
            a.description = $description,
            a.last_updated = $now
        WITH a
        MATCH (p:Project {project_id: $project_id})
        MERGE (p)-[r:INVESTS_IN]->(a)
        SET r.fiscal_year = coalesce($fiscal_year, r.fiscal_year, ''),
            r.review_status = coalesce($review_status, r.review_status, ''),
            r.last_seen_at = $now
        """,
        app_id=app_id,
        name=app.get("app_name") or app_id,
        status=app.get("application_status") or "Keep",
        description=app.get("functions") or "",
        project_id=project.project_id,
        fiscal_year=project.fiscal_year,
        review_status=getattr(project, "review_status", "") or "",
        now=datetime.utcnow().isoformat(),
    )


def upsert_integration(session, src_id: str, tgt_id: str, inter: dict) -> None:
    session.run(
        """
        MATCH (a:Application {app_id: $src}), (b:Application {app_id: $tgt})
        MERGE (a)-[r:INTEGRATES_WITH {interaction_type: $itype, business_object: $bobj}]->(b)
        SET r.status = $status,
            r.protocol = $protocol
        """,
        src=src_id,
        tgt=tgt_id,
        itype=inter.get("interaction_type") or "",
        bobj=inter.get("business_object") or "",
        status=inter.get("interaction_status") or "Keep",
        protocol=inter.get("label") or "",
    )


def load_project(session, project) -> tuple[int, int, float]:
    """Parse all drawio xmls on a project and merge into Neo4j."""
    if not project.drawio_xmls:
        return 0, 0, 0.0

    applications: list[dict] = []
    interactions: list[dict] = []
    for xml in project.drawio_xmls:
        parsed = parse_drawio_xml(xml, "App_Arch")
        applications.extend(parsed.get("applications", []))
        interactions.extend(parsed.get("interactions", []))

    if not applications:
        return 0, 0, 0.0

    upsert_project(session, project)

    app_id_by_cell: dict[str, str] = {}
    for app in applications:
        app_id = derive_app_id(app, project.project_id)
        app_id_by_cell[app.get("cell_id", "")] = app_id
        upsert_application(session, app_id, app, project)

    loaded_inters = 0
    for inter in interactions:
        src_id = app_id_by_cell.get(inter.get("source_id"))
        tgt_id = app_id_by_cell.get(inter.get("target_id"))
        if not src_id or not tgt_id:
            continue
        upsert_integration(session, src_id, tgt_id, inter)
        loaded_inters += 1

    quality = ai_evaluate(applications, interactions)
    return len(applications), loaded_inters, float(quality.get("overall_score", 0.0))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fy", action="append", required=True, help="Fiscal year, e.g. FY2526 (repeatable)")
    ap.add_argument("--limit", type=int, default=None, help="Limit projects per fiscal year")
    ap.add_argument(
        "--neo4j-uri",
        default=os.environ.get("NEO4J_URI_HOST", "bolt://localhost:7687"),
        help="Neo4j bolt URI (default: bolt://localhost:7687)",
    )
    ap.add_argument("--neo4j-user", default=os.environ.get("NEO4J_USER", "neo4j"))
    ap.add_argument("--neo4j-password", default=os.environ.get("NEO4J_PASSWORD", "northstar_dev"))
    args = ap.parse_args()

    if not os.environ.get("CONFLUENCE_TOKEN"):
        logger.error("CONFLUENCE_TOKEN not set in env. Run: set -a && source .env && set +a")
        return 2

    driver = GraphDatabase.driver(args.neo4j_uri, auth=(args.neo4j_user, args.neo4j_password))
    driver.verify_connectivity()
    logger.info("Neo4j connected at %s", args.neo4j_uri)

    client = ConfluenceClient()
    if not client.configured:
        logger.error("Confluence client not configured (CONFLUENCE_BASE_URL / CONFLUENCE_TOKEN missing)")
        return 2

    total_apps = 0
    total_inters = 0
    total_ok = 0
    total_err = 0
    started = datetime.utcnow()

    try:
        with driver.session() as session:
            for fy in args.fy:
                fy_id = client.get_fy_parent_id(fy)
                if not fy_id:
                    logger.error("FY parent not found for %s", fy)
                    continue
                projects = client.list_project_pages(fy_id, fy, limit=args.limit)
                logger.info("FY %s: %d project pages", fy, len(projects))
                for i, project in enumerate(projects, start=1):
                    try:
                        client.enrich_metadata(project)
                        client.fetch_drawio_xmls(project)
                        if not project.drawio_xmls:
                            logger.info(
                                "[%d/%d] %s SKIP no drawio :: %s",
                                i, len(projects), project.project_id, project.name[:60],
                            )
                            continue
                        apps, inters, score = load_project(session, project)
                        total_apps += apps
                        total_inters += inters
                        total_ok += 1
                        logger.info(
                            "[%d/%d] %s OK apps=%d inters=%d q=%.0f :: %s",
                            i, len(projects), project.project_id, apps, inters, score, project.name[:60],
                        )
                    except Exception as exc:  # noqa: BLE001
                        total_err += 1
                        logger.exception("[%d/%d] %s ERROR :: %s", i, len(projects), project.project_id, exc)
    finally:
        client.close()
        driver.close()

    elapsed = (datetime.utcnow() - started).total_seconds()
    logger.info(
        "DONE in %.1fs — projects ok=%d err=%d, applications=%d, integrations=%d",
        elapsed, total_ok, total_err, total_apps, total_inters,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
