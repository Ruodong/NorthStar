"""Architecture Design API — /api/design/*

Endpoints:

  GET    /api/design                              List all designs
  POST   /api/design                              Create new design + generate AS-IS XML
  GET    /api/design/{id}                         Get design metadata + apps + interfaces
  PUT    /api/design/{id}                         Update design metadata
  DELETE /api/design/{id}                         Delete design
  GET    /api/design/{id}/drawio                  Get current drawio XML (raw)
  PUT    /api/design/{id}/drawio                  Save edited drawio XML
  POST   /api/design/{id}/regenerate              Regenerate AS-IS from live PG data
  GET    /api/design/{id}/diff                    Compute as-is vs current diff

  GET    /api/design/templates                    List available drawio templates
  GET    /api/design/templates/{attachment_id}    Raw template XML (drawio)
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import BaseModel

from app.models.schemas import ApiResponse
from app.services import pg_client
from app.services.design_generator import generate_as_is_xml

router = APIRouter(prefix="/api/design", tags=["design"])

# Attachment volume mount. Inside the backend container this is /app_data
# (see docker-compose.yml); the DB stores repo-relative or absolute paths
# written by the host-side sync scripts. Match admin.py's resolver: take
# the basename of the stored path and join with ATTACHMENT_ROOT. This
# fixes "design create/regenerate falls back to blank canvas" because the
# old code opened the stored path as-is, which fails in the container.
_ATTACHMENT_ROOT = Path(os.environ.get("ATTACHMENT_ROOT", "/app_data"))


def _resolve_attachment_file(local_path: Optional[str]) -> Optional[Path]:
    """Return the on-disk path for an attachment, or None if not cached.

    `download_path` is intentionally NOT a fallback — it is a Confluence
    relative URL, not a local file, so opening it always fails. If the
    attachment hasn't been synced yet, callers should return 404 / None
    and tell the user to click Sync Now.
    """
    if not local_path:
        return None
    p = _ATTACHMENT_ROOT / Path(local_path).name
    return p if p.is_file() else None


# ──────────────────────────────────────────────────────────────────
# Request schemas
# ──────────────────────────────────────────────────────────────────
class AppScope(BaseModel):
    app_id: str
    role: str = "primary"         # primary | related | external
    planned_status: str = "keep"  # keep | change | new | sunset
    bc_id: Optional[str] = None
    notes: Optional[str] = None


class InterfaceScope(BaseModel):
    interface_id: Optional[int] = None
    from_app: str
    to_app: str
    platform: Optional[str] = None
    interface_name: Optional[str] = None
    planned_status: str = "keep"


class DesignCreate(BaseModel):
    name: str
    description: Optional[str] = None
    fiscal_year: Optional[str] = None
    project_id: Optional[str] = None
    template_attachment_id: Optional[int] = None
    owner_itcode: Optional[str] = None
    apps: list[AppScope] = []
    interfaces: list[InterfaceScope] = []


class DesignUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    fiscal_year: Optional[str] = None
    project_id: Optional[str] = None
    status: Optional[str] = None


# ──────────────────────────────────────────────────────────────────
# Templates (drawio files in confluence_attachment that look like templates)
# ──────────────────────────────────────────────────────────────────
@router.get("/standard-templates")
async def list_standard_templates() -> ApiResponse:
    """Standard templates — only those explicitly registered in Settings.

    Returns drawio attachments whose page (or any descendant page) is
    configured in ref_architecture_template_source. No fallback — if
    Settings has no pages configured OR the configured pages have no
    drawio attachments scanned yet, the list is empty.

    An architect registers template source pages via the Settings page
    (/settings), then a sync picks up drawios there.
    """
    rows = await pg_client.fetch(
        """
        WITH RECURSIVE descendants AS (
            -- Seed: pages directly registered in Settings
            SELECT cp.page_id, cp.title, cp.parent_id, t.layer AS layer
            FROM northstar.ref_architecture_template_source t
            JOIN northstar.confluence_page cp
              ON cp.page_id = t.confluence_page_id
            WHERE t.confluence_page_id IS NOT NULL
            UNION ALL
            -- Recurse into child pages (templates may live on sub-pages)
            SELECT cp.page_id, cp.title, cp.parent_id, d.layer
            FROM northstar.confluence_page cp
            JOIN descendants d ON cp.parent_id = d.page_id
        )
        SELECT
            a.attachment_id,
            a.title,
            a.file_kind,
            cp.title       AS page_title,
            cp.fiscal_year,
            cp.page_id::text AS page_id,
            d.layer        AS layer
        FROM descendants d
        JOIN northstar.confluence_page cp ON cp.page_id = d.page_id
        JOIN northstar.confluence_attachment a ON a.page_id = cp.page_id
        WHERE a.file_kind IN ('drawio', 'drawio_xml')
        ORDER BY d.layer, a.title
        LIMIT 200
        """
    )
    templates = [dict(r) for r in rows]
    for t in templates:
        t["display_name"] = t["title"]
    return ApiResponse(data={"total": len(templates), "templates": templates})


@router.get("/project-solutions")
async def list_project_solutions(
    app_ids: str = Query("", description="Comma-separated app IDs to filter by"),
) -> ApiResponse:
    """Project solutions — real architecture diagrams from project ARD pages
    where at least one of the scope app_ids is referenced.

    Groups results by project + fiscal_year. Each group lists the drawio
    attachments available as potential starting points, plus which of the
    scope apps appear in those diagrams.
    """
    ids = [i.strip() for i in app_ids.split(",") if i.strip()]
    if not ids:
        return ApiResponse(data={"total_projects": 0, "projects": []})

    rows = await pg_client.fetch(
        """
        SELECT DISTINCT
            COALESCE(cp.root_project_id, cp.project_id) AS project_id,
            rp.project_name,
            cp.fiscal_year,
            cp.page_id::text   AS page_id,
            cp.title           AS page_title,
            a.attachment_id,
            a.title            AS attachment_title,
            a.file_kind,
            (SELECT array_agg(DISTINCT COALESCE(cda.resolved_app_id, cda.standard_id))
             FROM northstar.confluence_diagram_app cda
             WHERE cda.attachment_id = a.attachment_id
               AND COALESCE(cda.resolved_app_id, cda.standard_id) = ANY($1::text[])
            ) AS referenced_scope_apps
        FROM northstar.confluence_diagram_app cda
        JOIN northstar.confluence_attachment a ON a.attachment_id = cda.attachment_id
        JOIN northstar.confluence_page cp ON cp.page_id = a.page_id
        LEFT JOIN northstar.ref_project rp
            ON rp.project_id = COALESCE(cp.root_project_id, cp.project_id)
        WHERE COALESCE(cda.resolved_app_id, cda.standard_id) = ANY($1::text[])
          AND a.file_kind IN ('drawio', 'drawio_xml')
          AND COALESCE(cp.root_project_id, cp.project_id) IS NOT NULL
        ORDER BY cp.fiscal_year DESC NULLS LAST, project_id
        LIMIT 200
        """,
        ids,
    )

    # Group by (project_id, fiscal_year)
    from collections import defaultdict
    groups: dict[tuple, dict] = {}
    for r in rows:
        key = (r["project_id"], r["fiscal_year"])
        g = groups.setdefault(key, {
            "project_id": r["project_id"],
            "project_name": r["project_name"],
            "fiscal_year": r["fiscal_year"],
            "referenced_scope_apps": set(),
            "diagrams": [],
        })
        if r.get("referenced_scope_apps"):
            g["referenced_scope_apps"].update(r["referenced_scope_apps"])
        g["diagrams"].append({
            "attachment_id": r["attachment_id"],
            "title": r["attachment_title"],
            "file_kind": r["file_kind"],
            "page_id": r["page_id"],
            "page_title": r["page_title"],
        })

    projects = []
    for g in groups.values():
        g["referenced_scope_apps"] = sorted(g["referenced_scope_apps"])
        projects.append(g)
    # Sort by number of scope apps referenced DESC (most relevant first),
    # then by fiscal_year DESC
    projects.sort(key=lambda p: (
        -len(p["referenced_scope_apps"]),
        p.get("fiscal_year") or "",
    ), reverse=False)
    # (actually we want the above line to sort with fy descending, so flip)
    projects.sort(key=lambda p: (
        -len(p["referenced_scope_apps"]),
        -(int(p["fiscal_year"][2:6]) if p.get("fiscal_year") and p["fiscal_year"].startswith("FY") else 0),
    ))

    return ApiResponse(data={
        "total_projects": len(projects),
        "projects": projects,
    })


@router.get("/templates")
async def list_templates_legacy() -> ApiResponse:
    """Legacy endpoint — now returns the same as /standard-templates.

    Kept for backward compatibility with early builds of the wizard.
    """
    templates: list[dict] = []

    # Try curated source first
    try:
        curated = await pg_client.fetch(
            """
            SELECT
                t.attachment_id,
                a.title,
                a.file_kind,
                t.description,
                t.tags,
                cp.title       AS page_title,
                cp.fiscal_year AS fiscal_year,
                cp.page_id::text AS page_id,
                cp.project_id
            FROM northstar.ref_architecture_template_source t
            JOIN northstar.confluence_attachment a
              ON a.attachment_id = t.attachment_id
            LEFT JOIN northstar.confluence_page cp
              ON cp.page_id = a.page_id
            WHERE a.file_kind IN ('drawio', 'drawio_xml')
            ORDER BY t.updated_at DESC NULLS LAST, a.title
            """
        )
        templates.extend([dict(r) for r in curated])
    except Exception:
        # Table doesn't exist yet — fall through
        pass

    # Fall back: any drawio with "template" in title
    if not templates:
        try:
            matches = await pg_client.fetch(
                """
                SELECT
                    a.attachment_id,
                    a.title,
                    a.file_kind,
                    NULL AS description,
                    NULL AS tags,
                    cp.title       AS page_title,
                    cp.fiscal_year AS fiscal_year,
                    cp.page_id::text AS page_id,
                    cp.project_id
                FROM northstar.confluence_attachment a
                LEFT JOIN northstar.confluence_page cp
                  ON cp.page_id = a.page_id
                WHERE a.file_kind IN ('drawio', 'drawio_xml')
                  AND (a.title ILIKE '%template%' OR a.title ILIKE '%模板%')
                ORDER BY a.title, cp.fiscal_year DESC NULLS LAST
                LIMIT 200
                """
            )
            templates.extend([dict(r) for r in matches])
        except Exception:
            pass

    # Build a "display_name" that disambiguates duplicates by appending
    # the source page / FY / project_id when titles collide.
    from collections import defaultdict as _dd
    by_title = _dd(list)
    for t in templates:
        by_title[t.get("title") or ""].append(t)

    for title, group in by_title.items():
        if len(group) == 1:
            group[0]["display_name"] = title
        else:
            # Multiple templates share this title — add context
            for t in group:
                ctx_parts = []
                if t.get("fiscal_year"):
                    ctx_parts.append(t["fiscal_year"])
                if t.get("project_id"):
                    ctx_parts.append(t["project_id"])
                elif t.get("page_title"):
                    page_title = t["page_title"]
                    if page_title and page_title != title:
                        # Trim overly long page titles
                        ctx_parts.append(
                            page_title[:40] + "…" if len(page_title) > 40 else page_title
                        )
                ctx = " · ".join(ctx_parts) if ctx_parts else f"#{t['attachment_id']}"
                t["display_name"] = f"{title} — {ctx}"

    return ApiResponse(data={
        "total": len(templates),
        "templates": templates,
    })


@router.get("/templates/{attachment_id}")
async def get_template_xml(attachment_id: int) -> Response:
    """Return the raw drawio XML of a template by attachment id."""
    # confluence_attachment.attachment_id is VARCHAR; cast int → str for DB
    row = await pg_client.fetchrow(
        """
        SELECT title, file_kind, local_path, download_path
        FROM northstar.confluence_attachment
        WHERE attachment_id = $1
        """,
        str(attachment_id),
    )
    if row is None:
        raise HTTPException(status_code=404, detail="template not found")

    # Resolve via the mounted attachment dir (see _resolve_attachment_file).
    resolved = _resolve_attachment_file(row.get("local_path"))
    if resolved is None:
        raise HTTPException(
            status_code=404,
            detail="template file not cached — click Sync Now on /settings first",
        )
    content = resolved.read_bytes()
    return Response(content=content, media_type="application/xml")


# ──────────────────────────────────────────────────────────────────
# Catalog interfaces — fetch edges between apps in scope
# ──────────────────────────────────────────────────────────────────
@router.get("/catalog-interfaces")
async def list_catalog_interfaces(
    app_ids: str = Query("", description="Comma-separated app IDs in scope"),
    include_sunset: bool = False,
) -> ApiResponse:
    """All integration_interface rows where both endpoints are in scope.

    Direct PG query — scoped to (source_cmdb_id IN scope AND target_cmdb_id
    IN scope). Returns interfaces in either direction and gives per-app
    coverage stats so the UI can explain empty results.
    """
    ids = [i.strip() for i in app_ids.split(",") if i.strip()]
    if not ids:
        return ApiResponse(data={
            "total": 0, "interfaces": [], "per_app_coverage": {},
        })

    # Per-app totals (catalog presence, regardless of scope)
    coverage_rows = await pg_client.fetch(
        """
        SELECT a.app_id,
               count(*) FILTER (
                   WHERE i.source_cmdb_id = a.app_id OR i.target_cmdb_id = a.app_id
               ) AS total_catalog,
               count(*) FILTER (
                   WHERE (i.source_cmdb_id = a.app_id OR i.target_cmdb_id = a.app_id)
                     AND (i.source_cmdb_id = ANY($1::text[])
                          AND i.target_cmdb_id = ANY($1::text[]))
               ) AS in_scope_connected
        FROM unnest($1::text[]) AS a(app_id)
        LEFT JOIN northstar.integration_interface i
          ON i.source_cmdb_id = a.app_id OR i.target_cmdb_id = a.app_id
        GROUP BY a.app_id
        """,
        ids,
    )
    coverage = {r["app_id"]: dict(r) for r in coverage_rows}

    # Actual edges between scope apps. Qualify `status` as `i.status` since
    # the joined ref_application tables also have a status column (ambiguous).
    status_filter = "" if include_sunset else "AND (i.status IS NULL OR upper(i.status) != 'SUNSET')"
    rows = await pg_client.fetch(
        f"""
        SELECT
            i.interface_id,
            i.integration_platform,
            i.interface_name,
            i.source_cmdb_id,
            i.target_cmdb_id,
            COALESCE(ra_src.name, i.source_app_name) AS source_app_name,
            COALESCE(ra_tgt.name, i.target_app_name) AS target_app_name,
            i.status,
            i.business_area,
            i.interface_description
        FROM northstar.integration_interface i
        LEFT JOIN northstar.ref_application ra_src ON ra_src.app_id = i.source_cmdb_id
        LEFT JOIN northstar.ref_application ra_tgt ON ra_tgt.app_id = i.target_cmdb_id
        WHERE i.source_cmdb_id = ANY($1::text[])
          AND i.target_cmdb_id = ANY($1::text[])
          AND i.source_cmdb_id <> i.target_cmdb_id
          {status_filter}
        ORDER BY i.integration_platform, i.interface_name, i.interface_id
        """,
        ids,
    )

    return ApiResponse(data={
        "total": len(rows),
        "scope_app_ids": ids,
        "interfaces": [dict(r) for r in rows],
        "per_app_coverage": coverage,
    })


# ──────────────────────────────────────────────────────────────────
# Design CRUD
# ──────────────────────────────────────────────────────────────────
@router.get("")
async def list_designs(
    project_id: Optional[str] = None,
    owner_itcode: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = Query(50, ge=1, le=500),
) -> ApiResponse:
    """List designs with optional filters."""
    where = []
    args: list = []
    if project_id:
        args.append(project_id)
        where.append(f"project_id = ${len(args)}")
    if owner_itcode:
        args.append(owner_itcode)
        where.append(f"owner_itcode = ${len(args)}")
    if status:
        args.append(status)
        where.append(f"status = ${len(args)}")
    where_clause = ("WHERE " + " AND ".join(where)) if where else ""
    args.append(limit)
    rows = await pg_client.fetch(
        f"""
        SELECT
            design_id, name, description, fiscal_year, project_id,
            template_attachment_id, owner_itcode, status,
            (SELECT count(*) FROM northstar.design_app da
             WHERE da.design_id = s.design_id) AS app_count,
            (SELECT count(*) FROM northstar.design_interface di
             WHERE di.design_id = s.design_id) AS iface_count,
            created_at, updated_at
        FROM northstar.design_session s
        {where_clause}
        ORDER BY s.updated_at DESC
        LIMIT ${len(args)}
        """,
        *args,
    )
    return ApiResponse(data={
        "total": len(rows),
        "rows": [dict(r) for r in rows],
    })


@router.post("")
async def create_design(payload: DesignCreate) -> ApiResponse:
    """Create a new design session and generate the initial AS-IS drawio XML.

    Pipeline:
      1. Insert design_session row (empty XML placeholder)
      2. Insert design_app rows for each app in scope
      3. Insert design_interface rows for each interface
      4. Fetch template XML if template_attachment_id is provided
      5. Fetch full app details (CMDB name, description) for labels
      6. Generate AS-IS drawio XML
      7. Save as both as_is_snapshot_xml and drawio_xml
    """
    # 1. Insert session
    session_row = await pg_client.fetchrow(
        """
        INSERT INTO northstar.design_session (
            name, description, fiscal_year, project_id,
            template_attachment_id, owner_itcode
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING design_id
        """,
        payload.name, payload.description, payload.fiscal_year,
        payload.project_id, payload.template_attachment_id,
        payload.owner_itcode,
    )
    design_id = session_row["design_id"]

    # 2. Insert apps
    for app in payload.apps:
        await pg_client.execute(
            """
            INSERT INTO northstar.design_app (
                design_id, app_id, role, planned_status, bc_id, notes
            )
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (design_id, app_id) DO NOTHING
            """,
            design_id, app.app_id, app.role, app.planned_status,
            app.bc_id, app.notes,
        )

    # 3. Insert interfaces
    for iface in payload.interfaces:
        await pg_client.execute(
            """
            INSERT INTO northstar.design_interface (
                design_id, interface_id, from_app, to_app,
                platform, interface_name, planned_status
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            """,
            design_id, iface.interface_id, iface.from_app, iface.to_app,
            iface.platform, iface.interface_name, iface.planned_status,
        )

    # 4. Fetch template XML if provided. confluence_attachment.attachment_id
    # is VARCHAR, so cast the int from the payload.
    template_xml = None
    if payload.template_attachment_id:
        tpl_row = await pg_client.fetchrow(
            """
            SELECT local_path, download_path
            FROM northstar.confluence_attachment
            WHERE attachment_id = $1
            """,
            str(payload.template_attachment_id),
        )
        if tpl_row:
            resolved = _resolve_attachment_file(tpl_row.get("local_path"))
            if resolved is not None:
                template_xml = resolved.read_text(encoding="utf-8")

    # 5. Fetch app display details for non-external apps
    app_ids = [a.app_id for a in payload.apps if a.role != "external"]
    app_details: dict[str, dict] = {}
    if app_ids:
        app_rows = await pg_client.fetch(
            """
            SELECT app_id, name, short_description, status
            FROM northstar.ref_application
            WHERE app_id = ANY($1::text[])
            """,
            app_ids,
        )
        app_details = {r["app_id"]: dict(r) for r in app_rows}

    # Build app list for generator
    gen_apps = []
    for a in payload.apps:
        d = app_details.get(a.app_id, {})
        gen_apps.append({
            "app_id": a.app_id,
            "name": d.get("name") or a.app_id,
            "short_description": d.get("short_description"),
            "planned_status": a.planned_status,
            "role": a.role,
        })

    gen_ifaces = [
        {
            "from_app": i.from_app,
            "to_app": i.to_app,
            "platform": i.platform,
            "interface_name": i.interface_name,
            "planned_status": i.planned_status,
        }
        for i in payload.interfaces
    ]

    # 6. Generate AS-IS XML
    xml_out = generate_as_is_xml(template_xml, gen_apps, gen_ifaces)

    # 7. Save both snapshots
    await pg_client.execute(
        """
        UPDATE northstar.design_session
        SET as_is_snapshot_xml = $1,
            drawio_xml = $1
        WHERE design_id = $2
        """,
        xml_out, design_id,
    )

    return ApiResponse(data={"design_id": design_id})


@router.get("/{design_id}")
async def get_design(design_id: int) -> ApiResponse:
    """Return design metadata + apps + interfaces (no XML here — use /drawio)."""
    session = await pg_client.fetchrow(
        """
        SELECT
            design_id, name, description, fiscal_year, project_id,
            template_attachment_id, owner_itcode, status,
            created_at, updated_at,
            (as_is_snapshot_xml IS NOT NULL) AS has_as_is,
            (drawio_xml IS NOT NULL) AS has_current
        FROM northstar.design_session
        WHERE design_id = $1
        """,
        design_id,
    )
    if session is None:
        raise HTTPException(status_code=404, detail="design not found")

    apps = await pg_client.fetch(
        """
        SELECT da.app_id, da.role, da.planned_status, da.bc_id, da.notes,
               ra.name, ra.status AS cmdb_status, ra.app_ownership,
               ra.u_service_area
        FROM northstar.design_app da
        LEFT JOIN northstar.ref_application ra ON ra.app_id = da.app_id
        WHERE da.design_id = $1
        ORDER BY
            CASE da.role WHEN 'primary' THEN 1 WHEN 'related' THEN 2 ELSE 3 END,
            da.app_id
        """,
        design_id,
    )
    ifaces = await pg_client.fetch(
        """
        SELECT design_iface_id, interface_id, from_app, to_app,
               platform, interface_name, planned_status, metadata_json, added_at
        FROM northstar.design_interface
        WHERE design_id = $1
        ORDER BY platform, interface_name
        """,
        design_id,
    )

    return ApiResponse(data={
        "design": dict(session),
        "apps": [dict(a) for a in apps],
        "interfaces": [dict(i) for i in ifaces],
    })


@router.put("/{design_id}")
async def update_design(design_id: int, payload: DesignUpdate) -> ApiResponse:
    """Update design metadata (name, description, status, etc.)."""
    exists = await pg_client.fetchval(
        "SELECT 1 FROM northstar.design_session WHERE design_id = $1",
        design_id,
    )
    if exists is None:
        raise HTTPException(status_code=404, detail="design not found")

    sets = []
    args: list = []
    if payload.name is not None:
        args.append(payload.name)
        sets.append(f"name = ${len(args)}")
    if payload.description is not None:
        args.append(payload.description)
        sets.append(f"description = ${len(args)}")
    if payload.fiscal_year is not None:
        args.append(payload.fiscal_year)
        sets.append(f"fiscal_year = ${len(args)}")
    if payload.project_id is not None:
        args.append(payload.project_id)
        sets.append(f"project_id = ${len(args)}")
    if payload.status is not None:
        args.append(payload.status)
        sets.append(f"status = ${len(args)}")
    if not sets:
        return ApiResponse(data={"updated": False})
    args.append(design_id)
    await pg_client.execute(
        f"UPDATE northstar.design_session SET {', '.join(sets)} WHERE design_id = ${len(args)}",
        *args,
    )
    return ApiResponse(data={"updated": True})


@router.delete("/{design_id}")
async def delete_design(design_id: int) -> ApiResponse:
    """Delete a design and its app/interface rows (cascade)."""
    result = await pg_client.execute(
        "DELETE FROM northstar.design_session WHERE design_id = $1",
        design_id,
    )
    return ApiResponse(data={"deleted": True})


# ──────────────────────────────────────────────────────────────────
# drawio XML endpoints
# ──────────────────────────────────────────────────────────────────
@router.get("/{design_id}/drawio")
async def get_design_drawio(design_id: int) -> Response:
    """Return the current drawio XML."""
    row = await pg_client.fetchrow(
        "SELECT drawio_xml FROM northstar.design_session WHERE design_id = $1",
        design_id,
    )
    if row is None:
        raise HTTPException(status_code=404, detail="design not found")
    xml = row["drawio_xml"] or ""
    return Response(content=xml, media_type="application/xml")


class DrawioSave(BaseModel):
    drawio_xml: str


@router.put("/{design_id}/drawio")
async def save_design_drawio(design_id: int, payload: DrawioSave) -> ApiResponse:
    """Save the architect's edited drawio XML."""
    exists = await pg_client.fetchval(
        "SELECT 1 FROM northstar.design_session WHERE design_id = $1",
        design_id,
    )
    if exists is None:
        raise HTTPException(status_code=404, detail="design not found")
    await pg_client.execute(
        """
        UPDATE northstar.design_session
        SET drawio_xml = $1
        WHERE design_id = $2
        """,
        payload.drawio_xml, design_id,
    )
    return ApiResponse(data={"saved": True, "length": len(payload.drawio_xml)})


@router.post("/{design_id}/regenerate")
async def regenerate_as_is(design_id: int) -> ApiResponse:
    """Rebuild the AS-IS XML from current apps/interfaces (and optionally pull
    fresh data from integration_interface if architect hasn't locked the
    scope). Overwrites both as_is_snapshot_xml and drawio_xml.
    """
    session = await pg_client.fetchrow(
        """
        SELECT template_attachment_id FROM northstar.design_session
        WHERE design_id = $1
        """,
        design_id,
    )
    if session is None:
        raise HTTPException(status_code=404, detail="design not found")

    apps = await pg_client.fetch(
        """
        SELECT da.app_id, da.role, da.planned_status,
               ra.name, ra.short_description
        FROM northstar.design_app da
        LEFT JOIN northstar.ref_application ra ON ra.app_id = da.app_id
        WHERE da.design_id = $1
        """,
        design_id,
    )
    ifaces = await pg_client.fetch(
        """
        SELECT from_app, to_app, platform, interface_name, planned_status
        FROM northstar.design_interface
        WHERE design_id = $1
        """,
        design_id,
    )

    template_xml = None
    tpl_id = session.get("template_attachment_id")
    if tpl_id:
        tpl_row = await pg_client.fetchrow(
            """
            SELECT local_path, download_path
            FROM northstar.confluence_attachment
            WHERE attachment_id = $1
            """,
            str(tpl_id),
        )
        if tpl_row:
            resolved = _resolve_attachment_file(tpl_row.get("local_path"))
            if resolved is not None:
                template_xml = resolved.read_text(encoding="utf-8")

    gen_apps = [
        {
            "app_id": a["app_id"],
            "name": a.get("name") or a["app_id"],
            "short_description": a.get("short_description"),
            "planned_status": a.get("planned_status", "keep"),
            "role": a.get("role", "primary"),
        }
        for a in apps
    ]
    gen_ifaces = [dict(i) for i in ifaces]

    xml_out = generate_as_is_xml(template_xml, gen_apps, gen_ifaces)

    await pg_client.execute(
        """
        UPDATE northstar.design_session
        SET as_is_snapshot_xml = $1, drawio_xml = $1
        WHERE design_id = $2
        """,
        xml_out, design_id,
    )
    return ApiResponse(data={"regenerated": True, "xml_length": len(xml_out)})
