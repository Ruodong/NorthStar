"""Unified search — /api/search

Powers the Cmd+K command palette. Queries ref_application and ref_project in
parallel using tsvector + pg_trgm for fuzzy matching, ranks results, and
returns them grouped by entity type.

Design:
- Minimum query length: 2 characters (fewer = noise)
- Uses ILIKE prefilter to benefit from trigram GIN index, then ts_rank for
  full-text relevance, then similarity() for typo tolerance
- Final score = greatest(ts_rank, similarity * 0.5, exact-id-boost)
- Returns max 10 apps + 5 projects so the palette stays scannable
"""
from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, Query

from app.models.schemas import ApiResponse
from app.services import pg_client

router = APIRouter(prefix="/api/search", tags=["search"])

MIN_QUERY_LEN = 2
APP_LIMIT = 10
PROJECT_LIMIT = 5
EA_DOC_LIMIT = 5


async def _search_applications(q: str, limit: int) -> list[dict[str, Any]]:
    """Search CMDB apps via FTS + trigram."""
    sql = """
    WITH prefilter AS (
        SELECT
            app_id, name, app_full_name, status, app_classification,
            to_tsvector('simple',
                coalesce(app_id, '') || ' ' ||
                coalesce(name, '') || ' ' ||
                coalesce(app_full_name, '') || ' ' ||
                coalesce(short_description, '')
            ) AS doc_tsv,
            lower(coalesce(app_id, '') || ' ' ||
                  coalesce(name, '') || ' ' ||
                  coalesce(app_full_name, '')) AS doc_lower
        FROM northstar.ref_application
        WHERE
            lower(coalesce(app_id, '') || ' ' ||
                  coalesce(name, '') || ' ' ||
                  coalesce(app_full_name, '')) ILIKE '%' || lower($1) || '%'
            OR to_tsvector('simple',
                coalesce(app_id, '') || ' ' ||
                coalesce(name, '') || ' ' ||
                coalesce(app_full_name, '') || ' ' ||
                coalesce(short_description, '')
            ) @@ plainto_tsquery('simple', $1)
    )
    SELECT
        app_id,
        name,
        app_full_name,
        status,
        app_classification,
        GREATEST(
            ts_rank(doc_tsv, plainto_tsquery('simple', $1)),
            similarity(doc_lower, lower($1)) * 0.5,
            CASE WHEN lower(app_id) = lower($1) THEN 1.0 ELSE 0 END
        ) AS score
    FROM prefilter
    ORDER BY score DESC, app_id ASC
    LIMIT $2
    """
    rows = await pg_client.fetch(sql, q, limit)
    return [dict(r) for r in rows]


async def _search_ea_documents(q: str, limit: int) -> list[dict[str, Any]]:
    """Search EA standards/guidelines via FTS + trigram."""
    sql = """
    WITH prefilter AS (
        SELECT
            page_id, title, domain, doc_type, page_url, excerpt,
            to_tsvector('simple',
                coalesce(title, '') || ' ' ||
                coalesce(excerpt, '')
            ) AS doc_tsv,
            lower(coalesce(title, '')) AS doc_lower
        FROM northstar.ref_ea_document
        WHERE
            lower(coalesce(title, '') || ' ' || coalesce(excerpt, ''))
                ILIKE '%' || lower($1) || '%'
            OR to_tsvector('simple',
                coalesce(title, '') || ' ' ||
                coalesce(excerpt, '')
            ) @@ plainto_tsquery('simple', $1)
    )
    SELECT
        page_id, title, domain, doc_type, page_url, excerpt,
        GREATEST(
            ts_rank(doc_tsv, plainto_tsquery('simple', $1)),
            similarity(doc_lower, lower($1)) * 0.5
        ) AS score
    FROM prefilter
    ORDER BY score DESC, title ASC
    LIMIT $2
    """
    rows = await pg_client.fetch(sql, q, limit)
    return [dict(r) for r in rows]


async def _search_projects(q: str, limit: int) -> list[dict[str, Any]]:
    """Search MSPO projects via FTS + trigram."""
    sql = """
    WITH prefilter AS (
        SELECT
            project_id, project_name, status, pm, it_lead, dt_lead, start_date,
            to_tsvector('simple',
                coalesce(project_id, '') || ' ' ||
                coalesce(project_name, '') || ' ' ||
                coalesce(pm, '') || ' ' ||
                coalesce(it_lead, '') || ' ' ||
                coalesce(dt_lead, '')
            ) AS doc_tsv,
            lower(coalesce(project_id, '') || ' ' ||
                  coalesce(project_name, '')) AS doc_lower
        FROM northstar.ref_project
        WHERE
            lower(coalesce(project_id, '') || ' ' ||
                  coalesce(project_name, '')) ILIKE '%' || lower($1) || '%'
            OR to_tsvector('simple',
                coalesce(project_id, '') || ' ' ||
                coalesce(project_name, '') || ' ' ||
                coalesce(pm, '') || ' ' ||
                coalesce(it_lead, '') || ' ' ||
                coalesce(dt_lead, '')
            ) @@ plainto_tsquery('simple', $1)
    )
    SELECT
        project_id,
        project_name,
        status,
        pm,
        it_lead,
        dt_lead,
        start_date,
        GREATEST(
            ts_rank(doc_tsv, plainto_tsquery('simple', $1)),
            similarity(doc_lower, lower($1)) * 0.5,
            CASE WHEN lower(project_id) = lower($1) THEN 1.0 ELSE 0 END
        ) AS score
    FROM prefilter
    ORDER BY score DESC, project_id DESC
    LIMIT $2
    """
    rows = await pg_client.fetch(sql, q, limit)
    return [dict(r) for r in rows]


@router.get("")
async def search(
    q: str = Query("", description="Search query, min 2 characters"),
    app_limit: int = Query(APP_LIMIT, ge=1, le=50),
    project_limit: int = Query(PROJECT_LIMIT, ge=1, le=20),
    ea_doc_limit: int = Query(EA_DOC_LIMIT, ge=1, le=20),
) -> ApiResponse:
    """Unified search across applications and projects.

    Returns a grouped payload so the frontend palette can render sections
    directly without sorting or bucketing client-side.
    """
    q = (q or "").strip()
    if len(q) < MIN_QUERY_LEN:
        return ApiResponse(
            data={
                "query": q,
                "applications": [],
                "projects": [],
                "ea_documents": [],
                "note": f"query too short (min {MIN_QUERY_LEN} characters)",
            }
        )

    try:
        apps, projects, ea_docs = await asyncio.gather(
            _search_applications(q, app_limit),
            _search_projects(q, project_limit),
            _search_ea_documents(q, ea_doc_limit),
        )
    except Exception as exc:  # noqa: BLE001
        # Fallback: if pg_trgm extension is missing or indexes don't exist
        # yet (e.g. migration 005 hasn't run), return a graceful error rather
        # than crashing the whole palette.
        return ApiResponse(
            success=False,
            error=f"search failed: {exc}",
        )

    return ApiResponse(
        data={
            "query": q,
            "applications": apps,
            "projects": projects,
            "ea_documents": ea_docs,
        }
    )
