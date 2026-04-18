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

from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import BaseModel

from app.models.schemas import ApiResponse
from app.services import pg_client
from app.services.design_generator import generate_as_is_xml

router = APIRouter(prefix="/api/design", tags=["design"])


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
@router.get("/templates")
async def list_templates() -> ApiResponse:
    """List available drawio templates.

    Sources:
      1. ref_architecture_template_source if present (architect-curated)
      2. Otherwise: confluence_attachment where file_kind='drawio' and
         (title ILIKE '%template%' OR title ILIKE '%模板%')

    Each row is enriched with page context so architects can tell similar
    "Application Architecture Template" entries apart by their source page.
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

    # We already have a /api/admin/confluence/attachments/{id}/raw endpoint
    # that reads the file. For the generator we need to read the XML content
    # directly from the filesystem.
    path = row.get("local_path") or row.get("download_path")
    if not path:
        raise HTTPException(status_code=404, detail="template file not available")

    try:
        with open(path, "rb") as f:
            content = f.read()
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="template file missing on disk")

    return Response(content=content, media_type="application/xml")


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
            path = tpl_row.get("local_path") or tpl_row.get("download_path")
            if path:
                try:
                    with open(path, "r", encoding="utf-8") as f:
                        template_xml = f.read()
                except Exception:
                    template_xml = None

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
            path = tpl_row.get("local_path") or tpl_row.get("download_path")
            if path:
                try:
                    with open(path, "r", encoding="utf-8") as f:
                        template_xml = f.read()
                except Exception:
                    template_xml = None

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
