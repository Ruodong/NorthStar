"""EA Knowledge Layer — /api/ea-documents

Browse, filter, and contextually match EA Standards, Guidelines, Reference
Architectures, and Templates synced from the Confluence EA space.
"""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Query

from app.models.schemas import ApiResponse
from app.services import pg_client

router = APIRouter(prefix="/api/ea-documents", tags=["ea-documents"])

DOMAIN_LABELS: dict[str, str] = {
    "ai":         "GenAI Architecture",
    "aa":         "Application Architecture",
    "ta":         "Technical Architecture",
    "da":         "Data Architecture",
    "dpp":        "Data & Privacy Protection",
    "governance": "Governance",
}


@router.get("")
async def list_ea_documents(
    domain: Optional[str] = Query(None, description="Filter by domain code"),
    doc_type: Optional[str] = Query(None, description="Filter by doc type"),
    q: Optional[str] = Query(None, description="Text search"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> ApiResponse:
    """Browse EA documents with optional filters."""
    conditions: list[str] = []
    args: list[Any] = []
    idx = 1

    if domain:
        conditions.append(f"domain = ${idx}")
        args.append(domain)
        idx += 1

    if doc_type:
        conditions.append(f"doc_type = ${idx}")
        args.append(doc_type)
        idx += 1

    if q and len(q.strip()) >= 2:
        q_clean = q.strip()
        conditions.append(f"""(
            lower(coalesce(title, '') || ' ' || coalesce(excerpt, ''))
                ILIKE '%' || lower(${idx}) || '%'
            OR to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(excerpt, ''))
                @@ plainto_tsquery('simple', ${idx})
        )""")
        args.append(q_clean)
        idx += 1

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    # Total count
    count_sql = f"SELECT count(*) FROM northstar.ref_ea_document {where}"
    total = await pg_client.fetchval(count_sql, *args)

    # Documents
    docs_sql = f"""
    SELECT page_id, title, domain, doc_type, parent_section,
           page_url, excerpt, last_modified, last_modifier
    FROM northstar.ref_ea_document
    {where}
    ORDER BY
        CASE doc_type
            WHEN 'standard' THEN 0
            WHEN 'guideline' THEN 1
            WHEN 'reference_arch' THEN 2
            ELSE 3
        END,
        domain, title
    LIMIT ${idx} OFFSET ${idx + 1}
    """
    rows = await pg_client.fetch(docs_sql, *args, limit, offset)
    documents = [dict(r) for r in rows]

    # Domain counts (unfiltered by domain, but respects q and doc_type)
    domain_conditions = [c for c in conditions if "domain" not in c]
    domain_args = [a for i, a in enumerate(args) if "domain" not in conditions[i]] if conditions else []
    domain_where = f"WHERE {' AND '.join(domain_conditions)}" if domain_conditions else ""
    domain_sql = f"""
    SELECT domain, count(*) AS count
    FROM northstar.ref_ea_document
    {domain_where}
    GROUP BY domain
    ORDER BY domain
    """
    domain_rows = await pg_client.fetch(domain_sql, *domain_args)
    domains = [
        {"code": r["domain"], "label": DOMAIN_LABELS.get(r["domain"], r["domain"]), "count": r["count"]}
        for r in domain_rows
    ]

    return ApiResponse(data={
        "documents": documents,
        "total": total,
        "domains": domains,
    })


@router.get("/templates")
async def list_templates() -> ApiResponse:
    """All EA template documents (for project detail page)."""
    sql = """
    SELECT page_id, title, domain, doc_type, parent_section,
           page_url, excerpt, last_modified, last_modifier
    FROM northstar.ref_ea_document
    WHERE doc_type = 'template'
    ORDER BY domain, title
    """
    rows = await pg_client.fetch(sql)
    return ApiResponse(data=[dict(r) for r in rows])


@router.get("/for-app/{app_id}")
async def ea_documents_for_app(app_id: str) -> ApiResponse:
    """Contextual EA documents relevant to a given application.

    Builds a search query from the app's name, description, classification,
    and service area, then FTS-matches against EA document titles and excerpts.
    Standards are prioritized over guidelines.
    """
    # Look up app metadata
    app_row = await pg_client.fetchrow("""
        SELECT name, short_description, app_classification,
               u_service_area, app_solution_type
        FROM northstar.ref_application
        WHERE app_id = $1
    """, app_id)

    if not app_row:
        return ApiResponse(data=[])

    # Build search terms from app metadata
    parts = [
        app_row.get("name") or "",
        app_row.get("short_description") or "",
        app_row.get("app_classification") or "",
        app_row.get("u_service_area") or "",
        app_row.get("app_solution_type") or "",
    ]
    search_text = " ".join(p for p in parts if p).strip()
    if not search_text:
        return ApiResponse(data=[])

    sql = """
    SELECT page_id, title, domain, doc_type, page_url, excerpt,
           ts_rank(
               to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(excerpt, '')),
               plainto_tsquery('simple', $1)
           ) AS score
    FROM northstar.ref_ea_document
    WHERE to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(excerpt, ''))
          @@ plainto_tsquery('simple', $1)
    ORDER BY
        CASE doc_type
            WHEN 'standard' THEN 0
            WHEN 'guideline' THEN 1
            WHEN 'reference_arch' THEN 2
            ELSE 3
        END,
        score DESC
    LIMIT $2
    """
    rows = await pg_client.fetch(sql, search_text, 10)
    return ApiResponse(data=[dict(r) for r in rows])
