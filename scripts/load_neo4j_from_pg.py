#!/usr/bin/env python3
"""Load Neo4j graph from NorthStar Postgres master data.

Post-ontology-fix version (2026-04-10). Key differences from the earlier
script (now replaced):

- Application nodes NO LONGER carry source_project_id / source_fiscal_year.
  Project-to-Application ownership is expressed via (:Project)-[:INVESTS_IN]->
  (:Application) edges, with fiscal_year and review_status as edge properties.
  A single App can now have multiple investment edges from different projects
  in different fiscal years.
- New :Diagram and :ConfluencePage node types. Provenance (EGM vs Confluence
  vs both) is tracked via a source_systems array on :Diagram.
- Tech_Arch diagrams are included (not just App_Arch). Non-drawio tech arch
  attachments (image/pdf) become :Diagram nodes with has_graph_data=false —
  no INTEGRATES_WITH edges from them, but :Application still has DESCRIBED_BY
  links to them.
- Manual aliases (northstar.manual_app_aliases) are applied in
  derive_app_id(): after computing the diagram-scoped X-id, we check the
  alias table and collapse to the canonical id if one exists.

Pipeline:
    northstar.manual_app_aliases        (alias map, loaded once into memory)
    northstar.ref_application           (CMDB canonical app master)
    northstar.ref_diagram               (EGM architecture diagrams + raw XML)
    northstar.ref_request               (project metadata per review request)
    northstar.confluence_page           (Confluence page mirror)
    northstar.confluence_attachment     (Confluence attachment mirror)
  → Neo4j: :Project :Application :Diagram :ConfluencePage
           + INVESTS_IN + INTEGRATES_WITH + HAS_DIAGRAM + DESCRIBED_BY
           + HAS_CONFLUENCE_PAGE + HAS_REVIEW_PAGE

Usage (from ~/NorthStar on 71):
    set -a && source .env && set +a
    .venv-ingest/bin/python scripts/load_neo4j_from_pg.py [--wipe]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import re
import sys
import unicodedata
import uuid
from datetime import datetime, timezone
from pathlib import Path as _P
from typing import Any, Optional

# Make backend/app importable so we can reuse drawio_parser and name_normalize verbatim
sys.path.insert(0, str(_P(__file__).resolve().parent.parent / "backend"))

import psycopg
from psycopg.rows import dict_row
from neo4j import GraphDatabase

from app.services.drawio_parser import parse_drawio_xml  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s - %(message)s",
)
logger = logging.getLogger("load-neo4j")


# -----------------------------------------------------------------------------
# DB connection helpers
# -----------------------------------------------------------------------------
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


# -----------------------------------------------------------------------------
# App id derivation
# -----------------------------------------------------------------------------
def derive_app_id(
    std_id: str | None,
    name: str,
    diagram_id: str,
    cmdb_hit: bool,
    alias_map: dict[str, str],
) -> str:
    """Resolve a canonical app_id with the fuzzy-alias override.

    1. CMDB hit → use the standard_id directly. All projects that reference
       the same CMDB app collapse into one node.
    2. Non-CMDB → start with a diagram-scoped hash (safe default, no auto
       merging). Then check manual_app_aliases: if a human has confirmed that
       this X-id should merge into another, follow the mapping.
    """
    if std_id and cmdb_hit:
        return std_id
    seed = f"{name}|{diagram_id}"
    x_id = "X" + hashlib.sha256(seed.encode("utf-8")).hexdigest()[:12]
    return alias_map.get(x_id, x_id)


def fy_from_date(date_str: str | None) -> str:
    """Convert YYYY-MM-DD to FY label (Lenovo FY: Apr-Mar)."""
    if not date_str or len(date_str) < 7:
        return ""
    try:
        year = int(date_str[:4])
        month = int(date_str[5:7])
    except ValueError:
        return ""
    fy_start = year if month >= 4 else year - 1
    yy1 = fy_start % 100
    yy2 = (fy_start + 1) % 100
    return f"FY{yy1:02d}{yy2:02d}"


# -----------------------------------------------------------------------------
# Diagram identity key — used to merge EGM-parsed and Confluence-attachment
# records that describe the same physical diagram file.
# -----------------------------------------------------------------------------
_FILENAME_EXT_RE = re.compile(r"\.(drawio|xml|png|jpg|jpeg|gif|pdf)$", re.IGNORECASE)
_FILENAME_NORM_RE = re.compile(r"[\s\-_]+")


def diagram_identity_key(file_name: str | None, project_id: str | None) -> str:
    """Soft-match key: normalize file_name strip extension, combine with project.

    Two diagrams from different sources (EGM + Confluence) with the same
    file_name under the same project are assumed to be the same file.
    """
    if not file_name:
        return ""
    base = unicodedata.normalize("NFKC", file_name).lower()
    base = _FILENAME_EXT_RE.sub("", base)
    base = _FILENAME_NORM_RE.sub("", base)
    return f"{(project_id or '').strip()}:{base}"


# -----------------------------------------------------------------------------
# Alias map loader
# -----------------------------------------------------------------------------
def load_alias_map(pg: psycopg.Connection) -> dict[str, str]:
    """Read northstar.manual_app_aliases into a flat dict."""
    alias_map: dict[str, str] = {}
    try:
        with pg.cursor() as cur:
            cur.execute(
                "SELECT alias_id, canonical_id FROM northstar.manual_app_aliases"
            )
            for row in cur.fetchall():
                alias_map[row["alias_id"]] = row["canonical_id"]
    except psycopg.errors.UndefinedTable:
        logger.warning(
            "manual_app_aliases table missing — run SQL migration 003_ontology_fix.sql"
        )
        pg.rollback()
    logger.info("loaded alias map: %d entries", len(alias_map))
    return alias_map


# -----------------------------------------------------------------------------
# Main loader
# -----------------------------------------------------------------------------
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

    # loader_run_id tags applications_history + ingestion_diffs rows written
    # during this invocation, so we can correlate diffs to their originating run.
    loader_run_id = str(uuid.uuid4())
    logger.info("loader_run_id = %s", loader_run_id)

    stats: dict[str, int] = {
        "alias_map_size": 0,
        "diagrams_seen": 0,
        "diagrams_merged": 0,
        "diagrams_from_confluence_only": 0,
        "diagrams_egm_and_confluence": 0,
        "applications_merged": 0,
        "integrations_merged": 0,
        "described_by_edges": 0,
        "cmdb_hits": 0,
        "alias_applied": 0,
        "confluence_pages_merged": 0,
        "has_conf_page_edges": 0,
        "has_review_page_edges": 0,
        "skipped_no_request": 0,
        "history_snapshots_written": 0,
        "diffs_emitted": 0,
    }
    # Unique-count tracking (sets) so multi-diagram projects aren't counted N times
    projects_touched: set[str] = set()

    # ---- alias map
    alias_map = load_alias_map(src)
    stats["alias_map_size"] = len(alias_map)

    # ---- CMDB application master
    with src.cursor() as cur:
        cur.execute("SELECT app_id, name, status FROM northstar.ref_application")
        cmdb = {r["app_id"]: r for r in cur.fetchall()}
    logger.info("loaded CMDB: %d applications", len(cmdb))

    # ---- EGM diagrams (App_Arch + Tech_Arch) joined with request/project metadata
    with src.cursor() as cur:
        cur.execute(
            """
            SELECT d.id AS diagram_id, d.diagram_type, d.file_name, d.drawio_xml,
                   r.id AS request_id, r.project_id,
                   COALESCE(r.project_name, r.title) AS project_name,
                   r.project_pm, r.project_pm_itcode,
                   r.project_dt_lead, r.project_dt_lead_itcode,
                   r.project_it_lead, r.project_it_lead_itcode,
                   r.project_start_date, r.project_status, r.status AS review_status
            FROM northstar.ref_diagram d
            LEFT JOIN northstar.ref_request r ON d.request_id = r.id
            WHERE d.diagram_type IN ('App_Arch', 'Tech_Arch')
            """
        )
        egm_diagrams = cur.fetchall()
    logger.info("loaded EGM diagrams: %d (App_Arch + Tech_Arch)", len(egm_diagrams))

    # ---- Confluence attachments that look like architecture diagrams
    # We JOIN confluence_attachment → confluence_page to get the project_id
    # (either from q_project_id or project_id column).
    try:
        with src.cursor() as cur:
            cur.execute(
                """
                SELECT
                    att.attachment_id,
                    att.page_id,
                    att.title,
                    att.file_kind,
                    att.media_type,
                    att.file_size,
                    att.version,
                    att.download_path,
                    att.local_path,
                    COALESCE(p.q_project_id, p.project_id) AS project_id,
                    p.fiscal_year,
                    p.page_type,
                    p.q_app_id
                FROM northstar.confluence_attachment att
                JOIN northstar.confluence_page p ON att.page_id = p.page_id
                WHERE att.file_kind IN ('drawio', 'image', 'pdf')
                """
            )
            conf_attachments = cur.fetchall()
        logger.info("loaded Confluence attachments: %d (drawio/image/pdf)", len(conf_attachments))
    except psycopg.errors.UndefinedTable:
        logger.warning("confluence_* tables missing — skipping Confluence diagram merge")
        src.rollback()
        conf_attachments = []

    # ---- Confluence pages (both application and project types)
    try:
        with src.cursor() as cur:
            cur.execute(
                """
                SELECT page_id, fiscal_year, title, project_id, page_url,
                       q_project_id, q_app_id, page_type
                FROM northstar.confluence_page
                WHERE page_type IN ('application', 'project')
                """
            )
            conf_pages = cur.fetchall()
        logger.info("loaded Confluence pages: %d (application + project)", len(conf_pages))
    except psycopg.errors.UndefinedTable:
        conf_pages = []
        src.rollback()

    # -------------------------------------------------------------------------
    # Build the unified :Diagram map by identity_key
    # -------------------------------------------------------------------------
    # Each entry: identity_key → {
    #     'diagram_id': str,       # stable id (EGM UUID, or CA-<attachment_id>)
    #     'diagram_type': 'App_Arch'|'Tech_Arch'|'Unknown',
    #     'file_kind': 'drawio'|'image'|'pdf',
    #     'file_name': str,
    #     'project_id': str,
    #     'source_systems': list[str],
    #     'egm_diagram_id': Optional[str],
    #     'egm_record': Optional[dict],         # the EGM row (for parsing drawio_xml)
    #     'confluence_attachment_id': Optional[str],
    #     'confluence_page_id': Optional[str],
    #     'download_path': Optional[str],
    #     'local_path': Optional[str],
    #     'has_graph_data': bool,               # True if drawio we can parse
    # }
    unified: dict[str, dict[str, Any]] = {}

    # First pass — seed from EGM diagrams
    for diag in egm_diagrams:
        project_id = (diag.get("project_id") or "").strip()
        if not project_id and diag.get("request_id"):
            project_id = f"REQ-{str(diag['request_id'])[:8]}"
        key = diagram_identity_key(diag.get("file_name"), project_id)
        if not key:
            # Fall back to the EGM UUID itself as unique key
            key = f"egm-uuid:{diag['diagram_id']}"
        unified[key] = {
            "diagram_id": str(diag["diagram_id"]),
            "diagram_type": diag.get("diagram_type") or "Unknown",
            "file_kind": "drawio",  # EGM only stores drawio
            "file_name": diag.get("file_name") or "",
            "project_id": project_id,
            "source_systems": ["egm"],
            "egm_diagram_id": str(diag["diagram_id"]),
            "egm_record": diag,
            "confluence_attachment_id": None,
            "confluence_page_id": None,
            "download_path": None,
            "local_path": None,
            "has_graph_data": bool(diag.get("drawio_xml")),
        }

    # Second pass — merge in Confluence attachments
    for att in conf_attachments:
        key = diagram_identity_key(att.get("title"), att.get("project_id"))
        if not key:
            key = f"ca-only:{att['attachment_id']}"
        file_kind = att.get("file_kind") or "other"
        if key in unified:
            # Merge into existing EGM entry
            entry = unified[key]
            if "confluence" not in entry["source_systems"]:
                entry["source_systems"].append("confluence")
                stats["diagrams_egm_and_confluence"] += 1
            entry["confluence_attachment_id"] = att["attachment_id"]
            entry["confluence_page_id"] = att["page_id"]
            entry["download_path"] = att.get("download_path")
            entry["local_path"] = att.get("local_path")
            # EGM-sourced drawio wins on file_kind; otherwise take Confluence's
            if not entry.get("file_kind"):
                entry["file_kind"] = file_kind
        else:
            # Confluence-only entry (likely a Tech_Arch image/pdf, or a drawio
            # we haven't parsed via EGM)
            unified[key] = {
                "diagram_id": f"CA-{att['attachment_id']}",
                "diagram_type": "Tech_Arch" if file_kind in ("image", "pdf") else "Unknown",
                "file_kind": file_kind,
                "file_name": att.get("title") or "",
                "project_id": att.get("project_id") or "",
                "source_systems": ["confluence"],
                "egm_diagram_id": None,
                "egm_record": None,
                "confluence_attachment_id": att["attachment_id"],
                "confluence_page_id": att["page_id"],
                "download_path": att.get("download_path"),
                "local_path": att.get("local_path"),
                # has_graph_data is True only if it's drawio AND we parse it
                # somewhere. Confluence-only drawio files are not currently
                # parsed (drawio_xml lives in ref_diagram only), so False.
                "has_graph_data": False,
            }
            stats["diagrams_from_confluence_only"] += 1

    logger.info("unified diagram count: %d", len(unified))

    # -------------------------------------------------------------------------
    # Write to Neo4j
    # -------------------------------------------------------------------------
    try:
        with driver.session() as ns:
            if args.wipe:
                logger.info("wiping Neo4j...")
                ns.run("MATCH (n) DETACH DELETE n")

            # ========== Project + Diagram + Application + integrations ==========
            for entry in unified.values():
                stats["diagrams_seen"] += 1
                project_id = entry["project_id"]
                diagram_id = entry["diagram_id"]

                if not project_id:
                    # Skip orphans — we need a project to anchor the diagram
                    continue

                # Resolve project metadata: prefer the EGM record if present;
                # otherwise synthesize minimal Project with just project_id
                if entry["egm_record"] is not None:
                    diag = entry["egm_record"]
                    project_name = (diag.get("project_name") or project_id)[:200]
                    fy = fy_from_date(diag.get("project_start_date"))
                    pm = diag.get("project_pm") or ""
                    pm_itcode = diag.get("project_pm_itcode") or ""
                    it_lead = diag.get("project_it_lead") or ""
                    it_lead_itcode = diag.get("project_it_lead_itcode") or ""
                    dt_lead = diag.get("project_dt_lead") or ""
                    dt_lead_itcode = diag.get("project_dt_lead_itcode") or ""
                    review_status = (
                        diag.get("review_status") or diag.get("project_status") or ""
                    )
                else:
                    project_name = project_id
                    fy = ""
                    pm = pm_itcode = it_lead = it_lead_itcode = ""
                    dt_lead = dt_lead_itcode = review_status = ""

                # MERGE Project
                ns.run(
                    """
                    MERGE (p:Project {project_id: $project_id})
                    SET p.name = coalesce(p.name, $name),
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
                    pm=pm,
                    pm_itcode=pm_itcode,
                    it_lead=it_lead,
                    it_lead_itcode=it_lead_itcode,
                    dt_lead=dt_lead,
                    dt_lead_itcode=dt_lead_itcode,
                    review_status=review_status,
                    now=now_iso(),
                )
                projects_touched.add(project_id)

                # MERGE Diagram (unified: one node whether it came from EGM,
                # Confluence, or both)
                ns.run(
                    """
                    MERGE (d:Diagram {diagram_id: $diagram_id})
                    SET d.diagram_type = $diagram_type,
                        d.file_kind = $file_kind,
                        d.file_name = $file_name,
                        d.source_systems = $source_systems,
                        d.egm_diagram_id = $egm_diagram_id,
                        d.confluence_attachment_id = $confluence_attachment_id,
                        d.confluence_page_id = $confluence_page_id,
                        d.download_path = $download_path,
                        d.local_path = $local_path,
                        d.has_graph_data = $has_graph_data,
                        d.last_updated = $now
                    WITH d
                    MATCH (p:Project {project_id: $project_id})
                    MERGE (p)-[:HAS_DIAGRAM]->(d)
                    """,
                    diagram_id=diagram_id,
                    diagram_type=entry["diagram_type"],
                    file_kind=entry["file_kind"],
                    file_name=entry["file_name"],
                    source_systems=entry["source_systems"],
                    egm_diagram_id=entry["egm_diagram_id"],
                    confluence_attachment_id=entry["confluence_attachment_id"],
                    confluence_page_id=entry["confluence_page_id"],
                    download_path=entry["download_path"],
                    local_path=entry["local_path"],
                    has_graph_data=entry["has_graph_data"],
                    project_id=project_id,
                    now=now_iso(),
                )
                stats["diagrams_merged"] += 1

                # Only EGM App_Arch diagrams with drawio_xml produce Application
                # nodes + INTEGRATES_WITH edges. Image/PDF tech arch attachments
                # have no parseable graph data — they're referenced later via
                # DESCRIBED_BY only when an app is already linked by other means.
                if not entry["has_graph_data"] or entry["egm_record"] is None:
                    continue
                if entry["diagram_type"] != "App_Arch":
                    # Tech_Arch drawio could theoretically be parsed by the same
                    # drawio_parser — but the EGM parser targets App_Arch. Skip.
                    continue

                raw_xml = entry["egm_record"].get("drawio_xml")
                if not raw_xml:
                    continue
                try:
                    parsed = parse_drawio_xml(raw_xml, "App_Arch")
                except Exception as exc:  # noqa: BLE001
                    logger.warning("parse failed for diagram %s: %s", diagram_id, exc)
                    continue
                apps = parsed.get("applications", [])
                inters = parsed.get("interactions", [])

                app_id_by_cell: dict[str, str] = {}
                # Parsing uses the EGM UUID as the diagram scope for hash id derivation
                # (stable across re-runs)
                egm_diag_id = entry["egm_diagram_id"] or diagram_id

                for a in apps:
                    raw_std = (a.get("standard_id") or "").strip()
                    cmdb_hit = bool(raw_std and raw_std in cmdb)
                    if cmdb_hit:
                        stats["cmdb_hits"] += 1

                    app_name = a.get("app_name") or ""
                    pre_alias_id = derive_app_id(raw_std, app_name, egm_diag_id, cmdb_hit, {})
                    app_id = derive_app_id(raw_std, app_name, egm_diag_id, cmdb_hit, alias_map)
                    if app_id != pre_alias_id and not cmdb_hit:
                        stats["alias_applied"] += 1

                    cell_id = a.get("cell_id") or ""
                    if cell_id:
                        app_id_by_cell[cell_id] = app_id

                    canonical_name = cmdb[raw_std]["name"] if cmdb_hit else app_name
                    canonical_status = (
                        cmdb[raw_std]["status"]
                        if cmdb_hit
                        else (a.get("application_status") or "Unknown")
                    )
                    description = a.get("functions") or ""

                    # MERGE Application (NO source_project_id / source_fiscal_year)
                    ns.run(
                        """
                        MERGE (a:Application {app_id: $app_id})
                        ON CREATE SET
                            a.name = $name,
                            a.status = $status,
                            a.description = $description,
                            a.cmdb_linked = $cmdb_hit,
                            a.last_updated = $now
                        ON MATCH SET
                            a.name = CASE WHEN $cmdb_hit THEN $name ELSE coalesce(a.name, $name) END,
                            a.status = CASE WHEN $cmdb_hit THEN $status ELSE coalesce(a.status, $status) END,
                            a.cmdb_linked = a.cmdb_linked OR $cmdb_hit,
                            a.last_updated = $now
                        """,
                        app_id=app_id,
                        name=canonical_name,
                        status=canonical_status,
                        description=description,
                        cmdb_hit=cmdb_hit,
                        now=now_iso(),
                    )
                    stats["applications_merged"] += 1

                    # INVESTS_IN edge: project → application
                    # One edge per (project, app) pair. fiscal_year + review_status live on the edge.
                    ns.run(
                        """
                        MATCH (p:Project {project_id: $project_id})
                        MATCH (a:Application {app_id: $app_id})
                        MERGE (p)-[r:INVESTS_IN]->(a)
                        SET r.fiscal_year = coalesce($fy, r.fiscal_year, ''),
                            r.review_status = coalesce($review_status, r.review_status, ''),
                            r.source_diagram_id = $diagram_id,
                            r.last_seen_at = $now
                        """,
                        project_id=project_id,
                        app_id=app_id,
                        fy=fy,
                        review_status=review_status,
                        diagram_id=diagram_id,
                        now=now_iso(),
                    )

                    # DESCRIBED_BY edge: application → diagram
                    ns.run(
                        """
                        MATCH (a:Application {app_id: $app_id})
                        MATCH (d:Diagram {diagram_id: $diagram_id})
                        MERGE (a)-[:DESCRIBED_BY]->(d)
                        """,
                        app_id=app_id,
                        diagram_id=diagram_id,
                    )
                    stats["described_by_edges"] += 1

                # INTEGRATES_WITH edges from the parsed interactions
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
                        itype=inter.get("interaction_type") or "",
                        bobj=inter.get("business_object") or "",
                        status=inter.get("interaction_status") or "Keep",
                        direction=inter.get("direction") or "outbound",
                        protocol=inter.get("label") or "",
                    )
                    stats["integrations_merged"] += 1

            # ========== Confluence pages ==========
            # :ConfluencePage nodes + HAS_CONFLUENCE_PAGE / HAS_REVIEW_PAGE edges
            for page in conf_pages:
                page_type = page.get("page_type") or "other"
                ns.run(
                    """
                    MERGE (c:ConfluencePage {page_id: $page_id})
                    SET c.title = $title,
                        c.page_type = $page_type,
                        c.page_url = $page_url,
                        c.fiscal_year = $fiscal_year,
                        c.last_updated = $now
                    """,
                    page_id=page["page_id"],
                    title=page.get("title") or "",
                    page_type=page_type,
                    page_url=page.get("page_url") or "",
                    fiscal_year=page.get("fiscal_year") or "",
                    now=now_iso(),
                )
                stats["confluence_pages_merged"] += 1

                if page_type == "application":
                    app_id = page.get("q_app_id")
                    if app_id:
                        ns.run(
                            """
                            MATCH (c:ConfluencePage {page_id: $page_id})
                            MATCH (a:Application {app_id: $app_id})
                            MERGE (a)-[:HAS_CONFLUENCE_PAGE]->(c)
                            """,
                            page_id=page["page_id"],
                            app_id=app_id,
                        )
                        stats["has_conf_page_edges"] += 1
                elif page_type == "project":
                    pid = page.get("q_project_id") or page.get("project_id")
                    if pid:
                        ns.run(
                            """
                            MATCH (c:ConfluencePage {page_id: $page_id})
                            MATCH (p:Project {project_id: $project_id})
                            MERGE (p)-[:HAS_REVIEW_PAGE]->(c)
                            """,
                            page_id=page["page_id"],
                            project_id=pid,
                        )
                        stats["has_review_page_edges"] += 1

            # ================================================================
            # Post-load: applications_history snapshots + ingestion_diffs
            # ================================================================
            # Read every current Application node out of Neo4j, compute a
            # content_hash, and compare to the latest row in applications_history
            # for that app_id. Emit diffs + insert snapshots into Postgres.
            #
            # This runs once per loader invocation, AFTER all Neo4j writes, so
            # we're observing the steady-state graph (not partial).
            logger.info("computing applications_history + diffs...")
            write_history_and_diffs(ns, src, loader_run_id, stats)

        stats["projects_merged"] = len(projects_touched)
    finally:
        src.close()
        driver.close()

    logger.info("DONE")
    for k, v in stats.items():
        logger.info("  %-30s %d", k, v)
    return 0


# -----------------------------------------------------------------------------
# applications_history + ingestion_diffs writer
# -----------------------------------------------------------------------------
def _app_content_hash(name: str, status: str, description: str, cmdb_linked: bool) -> str:
    """Deterministic hash of the fields that define 'app content changed'."""
    canonical = f"{name or ''}|{status or ''}|{description or ''}|{'1' if cmdb_linked else '0'}"
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def write_history_and_diffs(
    neo4j_session: Any,
    pg: psycopg.Connection,
    loader_run_id: str,
    stats: dict[str, int],
) -> None:
    """Write applications_history snapshots and emit ingestion_diffs events.

    Idempotent per run: we compare the current Neo4j state to the latest row
    in applications_history. Only inserts a history row when content_hash
    changes. Emits diff events for new apps and changed fields.

    If the SQL tables are missing (e.g. migration 004 not yet applied on a
    pre-existing volume), we log a warning and skip this stage without failing.
    """
    # Probe for table existence first — if missing, skip gracefully
    try:
        with pg.cursor() as cur:
            cur.execute(
                "SELECT to_regclass('northstar.applications_history') AS t1, "
                "       to_regclass('northstar.ingestion_diffs') AS t2"
            )
            row = cur.fetchone()
            if not row or row["t1"] is None or row["t2"] is None:
                logger.warning(
                    "applications_history / ingestion_diffs tables missing — "
                    "skipping history stage. Restart backend to apply migrations."
                )
                pg.rollback()
                return
    except Exception as exc:  # noqa: BLE001
        logger.warning("history table probe failed: %s", exc)
        pg.rollback()
        return

    # Fetch current state from Neo4j
    current: list[dict[str, Any]] = list(neo4j_session.run(
        """
        MATCH (a:Application)
        RETURN a.app_id AS app_id,
               coalesce(a.name, '') AS name,
               coalesce(a.status, '') AS status,
               coalesce(a.description, '') AS description,
               coalesce(a.cmdb_linked, false) AS cmdb_linked
        """
    ))
    logger.info("history stage: %d applications in Neo4j", len(current))

    try:
        with pg.cursor() as cur:
            for rec in current:
                app_id = rec["app_id"]
                name = rec["name"]
                status = rec["status"]
                description = rec["description"]
                cmdb_linked = bool(rec["cmdb_linked"])
                new_hash = _app_content_hash(name, status, description, cmdb_linked)

                # Fetch latest history row for this app
                cur.execute(
                    """
                    SELECT id, name, status, description, cmdb_linked, content_hash
                    FROM northstar.applications_history
                    WHERE app_id = %s
                    ORDER BY snapshot_at DESC
                    LIMIT 1
                    """,
                    (app_id,),
                )
                prev = cur.fetchone()

                # Case 1: brand new app
                if prev is None:
                    cur.execute(
                        """
                        INSERT INTO northstar.applications_history
                            (app_id, loader_run_id, name, status, description, cmdb_linked, content_hash)
                        VALUES (%s, %s, %s, %s, %s, %s, %s)
                        """,
                        (app_id, loader_run_id, name, status, description, cmdb_linked, new_hash),
                    )
                    stats["history_snapshots_written"] += 1
                    cur.execute(
                        """
                        INSERT INTO northstar.ingestion_diffs
                            (loader_run_id, diff_type, entity_type, entity_id, entity_name, new_value)
                        VALUES (%s, 'app_added', 'application', %s, %s, %s)
                        """,
                        (
                            loader_run_id,
                            app_id,
                            name,
                            json.dumps(
                                {"name": name, "status": status, "cmdb_linked": cmdb_linked},
                                ensure_ascii=False,
                            ),
                        ),
                    )
                    stats["diffs_emitted"] += 1
                    continue

                # Case 2: unchanged — skip
                if prev["content_hash"] == new_hash:
                    continue

                # Case 3: changed — write snapshot + individual diff events
                cur.execute(
                    """
                    INSERT INTO northstar.applications_history
                        (app_id, loader_run_id, name, status, description, cmdb_linked, content_hash)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    """,
                    (app_id, loader_run_id, name, status, description, cmdb_linked, new_hash),
                )
                stats["history_snapshots_written"] += 1

                if (prev["status"] or "") != status:
                    cur.execute(
                        """
                        INSERT INTO northstar.ingestion_diffs
                            (loader_run_id, diff_type, entity_type, entity_id, entity_name,
                             old_value, new_value)
                        VALUES (%s, 'app_status_changed', 'application', %s, %s, %s, %s)
                        """,
                        (
                            loader_run_id,
                            app_id,
                            name,
                            json.dumps({"status": prev["status"]}, ensure_ascii=False),
                            json.dumps({"status": status}, ensure_ascii=False),
                        ),
                    )
                    stats["diffs_emitted"] += 1

                if (prev["description"] or "") != description:
                    cur.execute(
                        """
                        INSERT INTO northstar.ingestion_diffs
                            (loader_run_id, diff_type, entity_type, entity_id, entity_name,
                             old_value, new_value)
                        VALUES (%s, 'app_description_changed', 'application', %s, %s, %s, %s)
                        """,
                        (
                            loader_run_id,
                            app_id,
                            name,
                            json.dumps(
                                {"description": (prev["description"] or "")[:200]},
                                ensure_ascii=False,
                            ),
                            json.dumps({"description": description[:200]}, ensure_ascii=False),
                        ),
                    )
                    stats["diffs_emitted"] += 1

                if (prev["name"] or "") != name:
                    cur.execute(
                        """
                        INSERT INTO northstar.ingestion_diffs
                            (loader_run_id, diff_type, entity_type, entity_id, entity_name,
                             old_value, new_value)
                        VALUES (%s, 'app_name_changed', 'application', %s, %s, %s, %s)
                        """,
                        (
                            loader_run_id,
                            app_id,
                            name,
                            json.dumps({"name": prev["name"]}, ensure_ascii=False),
                            json.dumps({"name": name}, ensure_ascii=False),
                        ),
                    )
                    stats["diffs_emitted"] += 1

        pg.commit()
    except Exception as exc:  # noqa: BLE001
        logger.error("history/diffs stage failed: %s", exc)
        pg.rollback()


if __name__ == "__main__":
    sys.exit(main())
