"""Admin API — /api/admin/*

Exposes Confluence raw-data inventory and serves downloaded attachments
from the local filesystem (populated by scripts/scan_confluence.py).
"""
from __future__ import annotations

import mimetypes
import os
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

from app.models.schemas import ApiResponse
from app.services import pg_client

router = APIRouter(prefix="/api/admin", tags=["admin"])

# Container path where the attachments volume is mounted (docker-compose
# mounts the host data/ dir into /app_data).
ATTACHMENT_ROOT = Path(os.environ.get("ATTACHMENT_ROOT", "/app_data"))


@router.get("/confluence/summary")
async def confluence_summary() -> ApiResponse:
    pages = await pg_client.fetch(
        """
        SELECT fiscal_year, count(*) AS pages
        FROM northstar.confluence_page
        GROUP BY fiscal_year
        ORDER BY fiscal_year
        """
    )
    attach_kinds = await pg_client.fetch(
        """
        SELECT file_kind, count(*) AS n
        FROM northstar.confluence_attachment
        GROUP BY file_kind
        ORDER BY n DESC
        """
    )
    types = await pg_client.fetch(
        """
        SELECT COALESCE(page_type, 'other') AS type, count(*) AS n
        FROM northstar.confluence_page
        GROUP BY page_type
        ORDER BY n DESC
        """
    )
    totals = await pg_client.fetchrow(
        """
        SELECT
          (SELECT count(*) FROM northstar.confluence_page) AS total_pages,
          (SELECT count(*) FROM northstar.confluence_attachment) AS total_attachments,
          (SELECT count(*) FROM northstar.confluence_attachment WHERE local_path IS NOT NULL) AS downloaded,
          (SELECT count(*) FROM northstar.confluence_page p WHERE p.project_id IS NOT NULL
             AND EXISTS (SELECT 1 FROM northstar.ref_project r WHERE r.project_id = p.project_id)) AS projects_linked_mspo,
          (SELECT count(*) FROM northstar.confluence_page p WHERE p.q_app_id IS NOT NULL
             AND EXISTS (SELECT 1 FROM northstar.ref_application r WHERE r.app_id = p.q_app_id)) AS apps_linked_cmdb
        """
    )
    return ApiResponse(
        data={
            "by_fy": [dict(r) for r in pages],
            "by_kind": [dict(r) for r in attach_kinds],
            "by_type": [dict(r) for r in types],
            "totals": dict(totals) if totals else {},
        }
    )


@router.get("/confluence/pages")
async def list_pages(
    fiscal_year: Optional[str] = None,
    q: Optional[str] = None,
    page_type: Optional[str] = None,
    has_drawio: Optional[bool] = None,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> ApiResponse:
    where = []
    args: list = []
    if fiscal_year:
        args.append(fiscal_year)
        where.append(f"p.fiscal_year = ${len(args)}")
    if page_type:
        args.append(page_type)
        where.append(f"p.page_type = ${len(args)}")
    if q:
        args.append(f"%{q}%")
        where.append(
            f"(p.title ILIKE ${len(args)} OR p.project_id ILIKE ${len(args)} OR p.q_app_id ILIKE ${len(args)})"
        )
    if has_drawio:
        where.append(
            "EXISTS (SELECT 1 FROM northstar.confluence_attachment a "
            "WHERE a.page_id = p.page_id AND a.file_kind = 'drawio' "
            "AND a.title NOT LIKE 'drawio-backup%' AND a.title NOT LIKE '~%')"
        )
    where_clause = ("WHERE " + " AND ".join(where)) if where else ""
    args.extend([limit, offset])
    rows = await pg_client.fetch(
        f"""
        SELECT p.page_id, p.fiscal_year, p.title, p.page_url, p.page_type,
               p.project_id,
               rp.project_name AS project_name,
               p.q_app_id      AS app_id,
               ra.name         AS app_name,
               (rp.project_id IS NOT NULL) AS project_in_mspo,
               (ra.app_id IS NOT NULL)     AS app_in_cmdb,
               (SELECT count(*) FROM northstar.confluence_attachment a WHERE a.page_id = p.page_id) AS attachment_count,
               (SELECT count(*) FROM northstar.confluence_attachment a
                  WHERE a.page_id = p.page_id AND a.file_kind = 'drawio'
                    AND a.title NOT LIKE 'drawio-backup%' AND a.title NOT LIKE '~%') AS drawio_count
        FROM northstar.confluence_page p
        LEFT JOIN northstar.ref_project rp ON rp.project_id = p.project_id
        LEFT JOIN northstar.ref_application ra ON ra.app_id = p.q_app_id
        {where_clause}
        ORDER BY p.fiscal_year DESC, p.title
        LIMIT ${len(args) - 1} OFFSET ${len(args)}
        """,
        *args,
    )
    total = await pg_client.fetchval(
        f"SELECT count(*) FROM northstar.confluence_page p {where_clause}",
        *args[:-2],
    )
    return ApiResponse(
        data={
            "total": total,
            "rows": [dict(r) for r in rows],
        }
    )


@router.get("/confluence/pages/{page_id}")
async def get_page(page_id: str) -> ApiResponse:
    # Exclude body_html from the default detail payload — it can be huge.
    # Use /confluence/pages/{id}/body to fetch raw HTML when needed.
    page = await pg_client.fetchrow(
        """
        SELECT p.page_id, p.fiscal_year, p.title, p.project_id, p.page_url,
               p.body_text IS NOT NULL AS has_body,
               p.body_questionnaire,
               p.body_size_chars,
               p.q_project_id, p.q_project_name,
               p.q_pm,      e_pm.name AS q_pm_name,
               p.q_it_lead, e_it.name AS q_it_lead_name,
               p.q_dt_lead, e_dt.name AS q_dt_lead_name,
               p.last_seen, p.synced_at
        FROM northstar.confluence_page p
        LEFT JOIN northstar.ref_employee e_pm ON e_pm.itcode = p.q_pm
        LEFT JOIN northstar.ref_employee e_it ON e_it.itcode = p.q_it_lead
        LEFT JOIN northstar.ref_employee e_dt ON e_dt.itcode = p.q_dt_lead
        WHERE p.page_id = $1
        """,
        page_id,
    )
    if page is None:
        raise HTTPException(status_code=404, detail=f"Page {page_id} not found")

    import json as _json
    page_dict = dict(page)
    # Parse JSONB questionnaire payload for the client
    qraw = page_dict.pop("body_questionnaire", None)
    if qraw:
        try:
            page_dict["questionnaire"] = (
                qraw if isinstance(qraw, dict) else _json.loads(qraw)
            )
        except Exception:  # noqa: BLE001
            page_dict["questionnaire"] = None
    else:
        page_dict["questionnaire"] = None

    attachments = await pg_client.fetch(
        """
        SELECT attachment_id, title, media_type, file_kind, file_size, version,
               download_path, local_path
        FROM northstar.confluence_attachment
        WHERE page_id = $1
        ORDER BY
          CASE file_kind
            WHEN 'drawio' THEN 1
            WHEN 'image' THEN 2
            WHEN 'pdf' THEN 3
            WHEN 'office' THEN 4
            ELSE 5
          END,
          title
        """,
        page_id,
    )
    return ApiResponse(
        data={
            "page": page_dict,
            "attachments": [dict(a) for a in attachments],
        }
    )


@router.get("/confluence/pages/{page_id}/body")
async def get_page_body(page_id: str) -> ApiResponse:
    """Return the raw Confluence HTML body for a page (for iframe preview)."""
    row = await pg_client.fetchrow(
        "SELECT body_html, body_size_chars FROM northstar.confluence_page WHERE page_id = $1",
        page_id,
    )
    if row is None:
        raise HTTPException(status_code=404, detail=f"Page {page_id} not found")
    if not row["body_html"]:
        raise HTTPException(
            status_code=404,
            detail="body not scanned yet — re-run scripts/scan_confluence.py",
        )
    return ApiResponse(data={"html": row["body_html"], "size_chars": row["body_size_chars"]})


@router.get("/projects/{project_id}/overview")
async def project_overview(project_id: str) -> ApiResponse:
    """Unified project view joining every source keyed on project_id.

    Returns ref_project (MSPO master) + confluence_page (with questionnaire) +
    confluence attachments + Neo4j-derived applications and integrations for
    the project. Used by the admin UI to give one-stop visibility into a
    specific project.
    """
    import json as _json

    # 1) MSPO master
    mspo = await pg_client.fetchrow(
        "SELECT * FROM northstar.ref_project WHERE project_id = $1",
        project_id,
    )

    # 2) Confluence pages (match either title-extracted or questionnaire-extracted id).
    # Left-join ref_employee to resolve q_pm / q_it_lead / q_dt_lead itcodes
    # into display names so the UI can show "liujr2 (Wei Lin)" style labels.
    pages = await pg_client.fetch(
        """
        SELECT p.page_id, p.fiscal_year, p.title, p.page_url, p.body_size_chars,
               p.q_project_id, p.q_project_name,
               p.q_pm,      e_pm.name      AS q_pm_name,
               p.q_it_lead, e_it.name      AS q_it_lead_name,
               p.q_dt_lead, e_dt.name      AS q_dt_lead_name,
               p.body_questionnaire
        FROM northstar.confluence_page p
        LEFT JOIN northstar.ref_employee e_pm ON e_pm.itcode = p.q_pm
        LEFT JOIN northstar.ref_employee e_it ON e_it.itcode = p.q_it_lead
        LEFT JOIN northstar.ref_employee e_dt ON e_dt.itcode = p.q_dt_lead
        WHERE p.project_id = $1 OR p.q_project_id = $1
        ORDER BY p.fiscal_year DESC, p.title
        """,
        project_id,
    )
    page_ids = [p["page_id"] for p in pages]

    # 3) Attachments across all those pages
    attachments: list[dict] = []
    if page_ids:
        att_rows = await pg_client.fetch(
            """
            SELECT attachment_id, page_id, title, media_type, file_kind,
                   file_size, local_path
            FROM northstar.confluence_attachment
            WHERE page_id = ANY($1::text[])
              AND title NOT LIKE 'drawio-backup%'
              AND title NOT LIKE '~%'
            ORDER BY
              CASE file_kind
                WHEN 'drawio' THEN 1
                WHEN 'image' THEN 2
                WHEN 'pdf' THEN 3
                WHEN 'office' THEN 4
                ELSE 5
              END,
              title
            """,
            page_ids,
        )
        attachments = [dict(a) for a in att_rows]

    # 4) Neo4j applications + integrations for this project (read through backend Neo4j)
    from app.services import neo4j_client as _n
    apps_rows = await _n.run_query(
        """
        MATCH (p:Project {project_id: $pid})-[:INCLUDES]->(a:Application)
        RETURN a.app_id AS app_id, a.name AS name, a.status AS status,
               a.cmdb_linked AS cmdb_linked
        ORDER BY a.name
        """,
        {"pid": project_id},
    )
    edge_rows = await _n.run_query(
        """
        MATCH (p:Project {project_id: $pid})-[:INCLUDES]->(a:Application)
        MATCH (a)-[r:INTEGRATES_WITH]->(b:Application)
        WHERE (p)-[:INCLUDES]->(b)
        RETURN a.app_id AS source_app_id, b.app_id AS target_app_id,
               r.interaction_type AS interaction_type,
               r.business_object AS business_object,
               r.status AS status
        """,
        {"pid": project_id},
    )

    # Parse questionnaire JSON payload in Python
    page_dicts: list[dict] = []
    for p in pages:
        d = dict(p)
        q = d.pop("body_questionnaire", None)
        if q:
            try:
                d["questionnaire_sections"] = (
                    (q if isinstance(q, dict) else _json.loads(q)).get("sections", [])
                )
            except Exception:  # noqa: BLE001
                d["questionnaire_sections"] = None
        else:
            d["questionnaire_sections"] = None
        page_dicts.append(d)

    return ApiResponse(
        data={
            "project_id": project_id,
            "mspo": dict(mspo) if mspo else None,
            "confluence_pages": page_dicts,
            "attachments": attachments,
            "graph": {
                "applications": apps_rows,
                "integrations": edge_rows,
            },
        }
    )


@router.get("/confluence/attachments/{attachment_id}/raw")
async def serve_attachment(attachment_id: str):
    row = await pg_client.fetchrow(
        "SELECT title, media_type, local_path FROM northstar.confluence_attachment WHERE attachment_id = $1",
        attachment_id,
    )
    if row is None:
        raise HTTPException(status_code=404, detail="attachment not found")
    if not row["local_path"]:
        raise HTTPException(
            status_code=404,
            detail="attachment not downloaded yet — run scripts/scan_confluence.py",
        )
    full_path = ATTACHMENT_ROOT / Path(row["local_path"]).name
    if not full_path.exists():
        raise HTTPException(status_code=404, detail=f"file missing: {full_path}")
    media_type = row["media_type"] or mimetypes.guess_type(row["title"])[0] or "application/octet-stream"
    return FileResponse(str(full_path), media_type=media_type, filename=row["title"])
