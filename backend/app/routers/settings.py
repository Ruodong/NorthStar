"""Settings — /api/settings/*

Phase 1: Architecture Template Settings.

Three rows in northstar.ref_architecture_template_source, keyed by
`layer` ∈ {business, application, technical}. Each row stores the
Confluence URL of the EA-authored template directory page plus sync
status. See .specify/features/architecture-template-settings/spec.md.
"""
from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path
from typing import Any

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query

from app.models.schemas import (
    ApiResponse,
    ArchitectureTemplateDiagram,
    ArchitectureTemplateDiagramList,
    ArchitectureTemplateSource,
    ArchitectureTemplateSourceUpdate,
)
from app.services import pg_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/settings", tags=["settings"])

VALID_LAYERS = {"business", "application", "technical"}

# Script lives under scripts/. Inside the backend container the scripts
# dir is bind-mounted at /app/scripts (NORTHSTAR_SCRIPT_ROOT env var).
# Host-side (pytest / local) we walk up from this file to find the repo
# root and use ./scripts.
_BACKEND_DIR = Path(__file__).resolve().parents[2]   # backend/
_REPO_ROOT = _BACKEND_DIR.parent                      # repo root
_SCRIPT_ROOT = Path(
    os.environ.get("NORTHSTAR_SCRIPT_ROOT") or (_REPO_ROOT / "scripts")
)
_SYNC_SCRIPT = _SCRIPT_ROOT / "sync_architecture_templates.py"


# ── Helpers ──────────────────────────────────────────────────────


def _row_to_source(row: Any, diagram_count: int = 0) -> ArchitectureTemplateSource:
    return ArchitectureTemplateSource(
        layer=row["layer"],
        title=row.get("title") or "",
        confluence_url=row.get("confluence_url") or "",
        confluence_page_id=row.get("confluence_page_id"),
        last_synced_at=row.get("last_synced_at"),
        last_sync_status=row.get("last_sync_status"),
        last_sync_error=row.get("last_sync_error"),
        notes=row.get("notes"),
        updated_at=row.get("updated_at"),
        diagram_count=diagram_count,
    )


def _require_layer(layer: str) -> None:
    if layer not in VALID_LAYERS:
        raise HTTPException(
            status_code=404,
            detail=f"unknown layer '{layer}' (expected one of {sorted(VALID_LAYERS)})",
        )


def _attachment_urls(attachment_id: str) -> dict[str, str]:
    base = f"/api/admin/confluence/attachments/{attachment_id}"
    return {
        "thumbnail_url": f"{base}/thumbnail",
        "raw_url": f"{base}/raw",
        "preview_url": f"{base}/preview",
    }


async def _run_sync_script(layer: str) -> None:
    """Background: invoke the host-side sync script for a single layer.

    The script is idempotent. stdout/stderr go to the backend log. Exit
    code 0 → 'ok'; anything else → 'error'. The script itself writes back
    the final `last_sync_status` + `last_sync_error` values.
    """
    if not _SYNC_SCRIPT.is_file():
        logger.error("sync script not found at %s", _SYNC_SCRIPT)
        await pg_client.execute_script(
            "UPDATE northstar.ref_architecture_template_source "
            f"SET last_sync_status='error', "
            f"last_sync_error='sync script not deployed', "
            f"updated_at=NOW() "
            f"WHERE layer={_pg_str(layer)}"
        )
        return

    # Use asyncio subprocess so this async BackgroundTask does not block
    # the event loop while the sync runs (may take 60-120s over VPN).
    # Previously used subprocess.run which pegged one Starlette worker
    # for the full sync duration (codex review finding P2, 2026-04-18).
    try:
        proc = await asyncio.create_subprocess_exec(
            "python3", str(_SYNC_SCRIPT), "--layer", layer,
            cwd=str(_REPO_ROOT),
            env={**os.environ},
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout_b, stderr_b = await asyncio.wait_for(proc.communicate(), timeout=600)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            raise
        stdout = stdout_b.decode("utf-8", errors="replace")
        stderr = stderr_b.decode("utf-8", errors="replace")
        logger.info(
            "sync_architecture_templates --layer %s exited %d\n--- stdout ---\n%s\n--- stderr ---\n%s",
            layer, proc.returncode, stdout[-2000:], stderr[-2000:],
        )
    except asyncio.TimeoutError:
        logger.error("sync script timeout for layer %s", layer)
        await pg_client.execute_script(
            "UPDATE northstar.ref_architecture_template_source "
            f"SET last_sync_status='error', "
            f"last_sync_error='timeout (> 600s)', "
            f"updated_at=NOW() "
            f"WHERE layer={_pg_str(layer)}"
        )
    except Exception as exc:
        logger.exception("sync script failed for layer %s: %s", layer, exc)
        safe = str(exc).replace("'", "''")[:500]
        await pg_client.execute_script(
            "UPDATE northstar.ref_architecture_template_source "
            f"SET last_sync_status='error', "
            f"last_sync_error='{safe}', "
            f"updated_at=NOW() "
            f"WHERE layer={_pg_str(layer)}"
        )


def _pg_str(s: str) -> str:
    """Inline a literal string for execute_script (no params supported).

    Only used for known-safe internal values — layer names from VALID_LAYERS.
    """
    if s not in VALID_LAYERS:
        raise ValueError(f"refusing to inline unvalidated string: {s!r}")
    return f"'{s}'"


# ── Endpoints ────────────────────────────────────────────────────


@router.get("/architecture-templates")
async def list_architecture_templates() -> ApiResponse:
    """Return all three template source rows with diagram counts."""
    sql = """
    SELECT
        s.layer,
        s.title,
        s.confluence_url,
        s.confluence_page_id,
        s.last_synced_at,
        s.last_sync_status,
        s.last_sync_error,
        s.notes,
        s.updated_at,
        COALESCE(cnt.diagram_count, 0) AS diagram_count
    FROM northstar.ref_architecture_template_source s
    LEFT JOIN LATERAL (
        SELECT COUNT(*) AS diagram_count
        FROM northstar.confluence_attachment a
        WHERE a.template_source_layer = s.layer
          AND a.file_kind = 'drawio'
    ) cnt ON TRUE
    ORDER BY
        CASE s.layer
            WHEN 'business'    THEN 0
            WHEN 'application' THEN 1
            WHEN 'technical'   THEN 2
            ELSE 9
        END
    """
    rows = await pg_client.fetch(sql)
    items = [
        _row_to_source(r, diagram_count=r["diagram_count"]) for r in rows
    ]
    return ApiResponse(data=items)


@router.put("/architecture-templates/{layer}")
async def update_architecture_template(
    layer: str,
    update: ArchitectureTemplateSourceUpdate,
) -> ApiResponse:
    """Update title / confluence_url / notes on a single layer row.

    If confluence_url changes, clears confluence_page_id so the next sync
    re-resolves. Does not change last_sync_status.
    """
    _require_layer(layer)

    # Determine if URL is changing (so we can reset confluence_page_id).
    prev = await pg_client.fetchrow(
        "SELECT confluence_url FROM northstar.ref_architecture_template_source "
        "WHERE layer = $1",
        layer,
    )
    if prev is None:
        raise HTTPException(status_code=404, detail=f"row for layer '{layer}' missing")

    sets: list[str] = []
    args: list[Any] = []
    idx = 1

    if update.title is not None:
        sets.append(f"title = ${idx}")
        args.append(update.title)
        idx += 1
    if update.confluence_url is not None:
        sets.append(f"confluence_url = ${idx}")
        args.append(update.confluence_url)
        idx += 1
        if update.confluence_url != (prev["confluence_url"] or ""):
            sets.append("confluence_page_id = NULL")
    if update.notes is not None:
        sets.append(f"notes = ${idx}")
        args.append(update.notes)
        idx += 1

    if not sets:
        # No-op update — still return the current row.
        row = await pg_client.fetchrow(
            "SELECT * FROM northstar.ref_architecture_template_source WHERE layer = $1",
            layer,
        )
        return ApiResponse(data=_row_to_source(row))

    sets.append("updated_at = NOW()")
    args.append(layer)
    update_sql = (
        "UPDATE northstar.ref_architecture_template_source "
        f"SET {', '.join(sets)} "
        f"WHERE layer = ${idx} "
        "RETURNING *"
    )
    row = await pg_client.fetchrow(update_sql, *args)
    return ApiResponse(data=_row_to_source(row))


@router.post("/architecture-templates/{layer}/sync", status_code=202)
async def sync_architecture_template(
    layer: str, background: BackgroundTasks,
) -> ApiResponse:
    """Kick off a background sync. Returns 202 immediately.

    Returns 400 if the layer has no configured Confluence URL.
    """
    _require_layer(layer)

    row = await pg_client.fetchrow(
        "SELECT confluence_url FROM northstar.ref_architecture_template_source "
        "WHERE layer = $1",
        layer,
    )
    if row is None:
        raise HTTPException(status_code=404, detail=f"row for layer '{layer}' missing")
    if not (row["confluence_url"] or "").strip():
        raise HTTPException(status_code=400, detail="confluence_url not set")

    # Flip to syncing BEFORE returning.
    await pg_client.execute_script(
        "UPDATE northstar.ref_architecture_template_source "
        f"SET last_sync_status='syncing', last_sync_error=NULL, updated_at=NOW() "
        f"WHERE layer={_pg_str(layer)}"
    )

    background.add_task(_run_sync_script, layer)
    return ApiResponse(data={"layer": layer, "status": "syncing"})


@router.get("/architecture-templates/{layer}/diagrams")
async def list_architecture_template_diagrams(
    layer: str,
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> ApiResponse:
    """List drawio attachments tagged with this architecture layer."""
    _require_layer(layer)

    count_sql = """
    SELECT COUNT(*)
    FROM northstar.confluence_attachment a
    WHERE a.template_source_layer = $1
      AND a.file_kind = 'drawio'
    """
    total = await pg_client.fetchval(count_sql, layer) or 0

    items_sql = """
    SELECT a.attachment_id,
           a.title       AS file_name,
           a.media_type,
           a.file_size,
           a.synced_at,
           COALESCE(a.template_active, true) AS active,
           p.page_id,
           p.title       AS page_title,
           p.page_url    AS page_url
    FROM northstar.confluence_attachment a
    LEFT JOIN northstar.confluence_page p ON p.page_id = a.page_id
    WHERE a.template_source_layer = $1
      AND a.file_kind = 'drawio'
    ORDER BY COALESCE(a.template_active, true) DESC, p.title NULLS LAST, a.title
    LIMIT $2 OFFSET $3
    """
    rows = await pg_client.fetch(items_sql, layer, limit, offset)

    items = [
        ArchitectureTemplateDiagram(
            attachment_id=r["attachment_id"],
            file_name=r["file_name"] or "",
            media_type=r["media_type"] or "",
            file_size=r["file_size"],
            page_id=r["page_id"] or "",
            page_title=r["page_title"] or "",
            page_url=r["page_url"] or "",
            synced_at=r["synced_at"],
            active=r["active"],
            **_attachment_urls(r["attachment_id"]),
        )
        for r in rows
    ]
    payload = ArchitectureTemplateDiagramList(total=total, items=items)
    return ApiResponse(data=payload)


@router.patch("/architecture-templates/diagrams/{attachment_id}/active")
async def toggle_template_active(attachment_id: str, active: bool = Query(...)) -> ApiResponse:
    """Toggle template_active for a specific diagram attachment."""
    await pg_client.execute(
        """
        UPDATE northstar.confluence_attachment
        SET template_active = $2
        WHERE attachment_id = $1 AND template_source_layer IS NOT NULL
        """,
        attachment_id,
        active,
    )
    return ApiResponse(data={"attachment_id": attachment_id, "active": active})
