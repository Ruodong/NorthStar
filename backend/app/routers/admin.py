"""Admin API — /api/admin/*

Exposes Confluence raw-data inventory and serves downloaded attachments
from the local filesystem (populated by scripts/scan_confluence.py).
"""
from __future__ import annotations

import mimetypes
import os
import re
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

from app.models.schemas import ApiResponse
from app.services import pg_client

router = APIRouter(prefix="/api/admin", tags=["admin"])

# Attachment detail-view sort buckets. Architects want the two canonical
# architecture diagrams (application architecture + technical architecture)
# pinned to the top of the list — in that order — with everything else
# below sorted by recency. Detection is based on the attachment's own
# title, the descendant page it came from (source_page_title), and the
# intermediary "via" page for referenced diagrams.
_APP_ARCH_RE = re.compile(
    # Covers the common naming conventions Lenovo architects use for the
    # "Application Architecture" child page, in both English and Chinese.
    # Solution Design is treated as App Arch because Lenovo project wizards
    # label high-level solution documents as "<Project> Solution Design"
    # (same content, different wording). Matched against attachment title
    # AND source_page_title so the bucketing survives the child-page
    # aggregation pathway.
    #
    # English side uses `a\w*ch` as a loose stem so typos like "Achitecture"
    # / "Archtecture" / "Architecure" (all seen in real Confluence pages)
    # still match without a hand-curated typo list.
    r"应用架构|应用方案|解决方案|"
    r"application\s*(?:a\w*ch|design)|"
    r"solution\s*(?:a\w*ch|design)|"
    r"app\s*a\w*ch",
    re.IGNORECASE,
)
_TECH_ARCH_RE = re.compile(
    r"技术架构|技术方案|"
    # Architect typos in the wild: "Technical Achitecture" (missing r),
    # "Technical Archtecture" (missing i), "Technical Architecure"
    # (missing t). Match any word starting with 'a' and containing 'ch' —
    # this catches all three without a hand-curated typo list.
    r"technical\s*(?:a\w*ch|design)|"
    r"tech\s*(?:a\w*ch|design)",
    re.IGNORECASE,
)


def _arch_bucket(row: dict) -> int:
    """0 = 应用架构, 1 = 技术架构, 2 = everything else."""
    haystack = " ".join(
        s for s in (
            row.get("title"),
            row.get("source_page_title"),
            row.get("via_page_title"),
        ) if s
    )
    if _APP_ARCH_RE.search(haystack):
        return 0
    if _TECH_ARCH_RE.search(haystack):
        return 1
    return 2


def _attachment_sort_key(row: dict) -> tuple:
    """Sort: arch bucket → drawio-before-image inside arch buckets →
    recency (version DESC, then synced_at DESC) → stable title tiebreak.

    `synced_at` is the first-insert time written by scan_confluence.py
    (scanner only refreshes `last_seen`, not `synced_at`), so a newly
    uploaded drawio gets a fresh synced_at and floats above older rows.
    `version` is Confluence's own revision counter and is a stronger
    signal when an attachment is re-uploaded under the same filename.
    """
    bucket = _arch_bucket(row)
    if bucket < 2:
        # Inside an architecture bucket, keep drawio above rendered PNG so
        # the architect hits the source first, image second.
        kind_rank = 0 if (row.get("file_kind") == "drawio") else 1
    else:
        # "Rest" bucket: purely by recency, no file-kind preference.
        kind_rank = 0
    version_neg = -(row.get("version") or 0)
    synced_at = row.get("synced_at")
    synced_neg = -synced_at.timestamp() if synced_at else 0.0
    return (bucket, kind_rank, version_neg, synced_neg, row.get("title") or "")

# Container path where the attachments volume is mounted (docker-compose
# mounts the host data/ dir into /app_data).
ATTACHMENT_ROOT = Path(os.environ.get("ATTACHMENT_ROOT", "/app_data"))


# Backup / tmp attachment noise pattern — shared by summary and list endpoints.
# These rows are draw.io editor auto-save artifacts, not real architecture
# files. scripts/cleanup_backup_attachments.py removes them from PG; newer
# scans skip them at INSERT time. This WHERE is a defensive filter so the
# admin KPI is correct even when the cleanup has not been run yet on an older
# deployment.
_BACKUP_TITLE_WHERE = (
    "title LIKE 'drawio-backup%' OR title LIKE '~%'"
)


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
    # Exclude backup/tmp noise. 96% of all drawio attachments are editor
    # auto-save snapshots; we never want to show them in the admin KPI.
    attach_kinds = await pg_client.fetch(
        f"""
        SELECT file_kind, count(*) AS n
        FROM northstar.confluence_attachment
        WHERE NOT ({_BACKUP_TITLE_WHERE})
        GROUP BY file_kind
        ORDER BY n DESC
        """
    )
    # Separately surface the backup count so the UI can show "N hidden" context
    attach_kinds_backup = await pg_client.fetch(
        f"""
        SELECT file_kind, count(*) AS n
        FROM northstar.confluence_attachment
        WHERE {_BACKUP_TITLE_WHERE}
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
        f"""
        SELECT
          (SELECT count(*) FROM northstar.confluence_page) AS total_pages,
          (SELECT count(*) FROM northstar.confluence_attachment
             WHERE NOT ({_BACKUP_TITLE_WHERE})) AS total_attachments,
          (SELECT count(*) FROM northstar.confluence_attachment
             WHERE {_BACKUP_TITLE_WHERE}) AS total_backup_attachments,
          (SELECT count(*) FROM northstar.confluence_attachment
             WHERE local_path IS NOT NULL
               AND NOT ({_BACKUP_TITLE_WHERE})) AS downloaded,
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
            "by_kind_backup": [dict(r) for r in attach_kinds_backup],
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
    group_by_app: bool = Query(
        True,
        description=(
            "When true (default), collapse all confluence_page rows sharing the "
            "same (project_id, q_app_id) into a single row. The page with the "
            "lowest depth becomes the 'primary' and attachment/drawio counts are "
            "summed across the group. Pass false for the old one-row-per-page view."
        ),
    ),
    include_deep: bool = Query(
        False,
        description=(
            "When false (default), only show pages that are direct children of "
            "their project (depth <= 2 in our scan: depth 0 = FY parent, 1 = "
            "project page, 2 = project child). This matches the Confluence "
            "tree view a user sees. When true, also include depth 3+ "
            "grandchild pages whose titles get promoted to independent app "
            "rows via Pattern E (hint rollup) — useful for architects who "
            "want full depth visibility."
        ),
    ),
    hide_empty: bool = Query(
        True,
        description=(
            "When true (default), hide project-folder pages that have NO "
            "Confluence content anywhere: zero own attachments, zero drawio "
            "macro embeds, and zero attachments on their direct child pages. "
            "These rows — typically FY2526-xxx project stubs with only a "
            "title — are noise in the raw data view. Pass false to see "
            "every scanned page including empty stubs."
        ),
    ),
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
            f"(p.title ILIKE ${len(args)} "
            f"OR p.project_id ILIKE ${len(args)} "
            f"OR p.root_project_id ILIKE ${len(args)} "
            f"OR p.q_app_id ILIKE ${len(args)} "
            f"OR p.effective_app_id ILIKE ${len(args)} "
            f"OR p.app_hint ILIKE ${len(args)})"
        )
    if has_drawio:
        where.append(
            "EXISTS (SELECT 1 FROM northstar.confluence_attachment a "
            "WHERE a.page_id = p.page_id AND a.file_kind = 'drawio' "
            "AND a.title NOT LIKE 'drawio-backup%' AND a.title NOT LIKE '~%')"
        )
    if not include_deep:
        # Default view aligns with the Confluence tree a user would see:
        # keep depth 0-2 and rows where depth is unknown (legacy scans).
        # Pattern E promoted grandchildren (depth 3+) are hidden unless the
        # user explicitly flips the toggle. See diagnostic on LI2400444:
        # 18 direct children in Confluence vs 32 rows in our admin list
        # because 14 depth-3 Solution/Technical Design pages got rolled up.
        where.append("(p.depth IS NULL OR p.depth <= 2)")

    if hide_empty:
        # Hide project-folder pages that have NO Confluence content anywhere:
        # no own attachments, no drawio macro embeds, no attachments on any
        # direct child page. "FY2526-125 CoC PBI Data Refresh" style stubs
        # that only have a title are noise in the raw data view.
        where.append(
            """(
                EXISTS (
                    SELECT 1 FROM northstar.confluence_attachment a
                    WHERE a.page_id = p.page_id
                      AND a.title NOT LIKE 'drawio-backup%'
                      AND a.title NOT LIKE '~%'
                )
                OR EXISTS (
                    SELECT 1 FROM northstar.drawio_reference dr
                    WHERE dr.inclusion_page_id = p.page_id
                )
                OR EXISTS (
                    SELECT 1 FROM northstar.confluence_attachment a2
                    JOIN northstar.confluence_page cp2
                         ON cp2.page_id = a2.page_id
                    WHERE cp2.parent_id = p.page_id
                      AND a2.title NOT LIKE 'drawio-backup%'
                      AND a2.title NOT LIKE '~%'
                )
            )"""
        )

    # Hide synthetic drawio_source pages from the admin list by default —
    # these were pulled by scripts/backfill_drawio_sources.py purely to
    # resolve inc-drawio / templateUrl references and aren't real project
    # review pages. They don't live under the FY tree, so they'd show up
    # as orphan rows cluttering the list.
    where.append(
        "(p.page_type IS NULL OR p.page_type != 'drawio_source')"
    )
    where_clause = ("WHERE " + " AND ".join(where)) if where else ""

    # When include_deep=false, direct children without any app signal must
    # each be their own row (matching the Confluence tree), not collapsed
    # into a single "NA" bucket. So we use page_id as the fallback group
    # key instead of the literal 'NA'. When include_deep=true, old grouping
    # is preserved so depth-3 hint-only rows behave as before.
    na_fallback_sql = "'PAGE:' || e.page_id" if not include_deep else "'NA'"

    if not group_by_app:
        # Legacy flat view: one row per confluence_page.
        args.extend([limit, offset])
        rows = await pg_client.fetch(
            f"""
            SELECT p.page_id, p.fiscal_year, p.title, p.page_url, p.page_type,
                   p.project_id,
                   COALESCE(rp.project_name, p.q_project_name) AS project_name,
                   CASE
                     WHEN rp.project_name IS NOT NULL THEN 'mspo'
                     WHEN p.q_project_name IS NOT NULL THEN 'questionnaire'
                     ELSE 'none'
                   END AS project_name_source,
                   p.q_app_id      AS app_id,
                   p.app_hint      AS app_hint,
                   ra.name         AS app_name,
                   CASE WHEN ra.name IS NOT NULL THEN 'cmdb' ELSE 'none' END AS app_name_source,
                   (rp.project_id IS NOT NULL) AS project_in_mspo,
                   (ra.app_id IS NOT NULL)     AS app_in_cmdb,
                   p.q_pm, p.q_it_lead, p.q_dt_lead,
                   -- Flat view: own attachments + referenced drawios
                   ((SELECT count(*) FROM northstar.confluence_attachment a
                       WHERE a.page_id = p.page_id)
                    + COALESCE((SELECT count(*) FROM northstar.drawio_reference dr
                                JOIN northstar.confluence_attachment sa
                                  ON sa.page_id = dr.source_page_id
                                 AND sa.file_kind = 'drawio'
                                 AND sa.title NOT LIKE 'drawio-backup%'
                                 AND sa.title NOT LIKE '~%'
                                 AND (dr.diagram_name = '' OR sa.title = dr.diagram_name
                                      OR sa.title = dr.diagram_name || '.drawio')
                                WHERE dr.inclusion_page_id = p.page_id), 0)
                   ) AS attachment_count,
                   ((SELECT count(*) FROM northstar.confluence_attachment a
                       WHERE a.page_id = p.page_id AND a.file_kind = 'drawio'
                         AND a.title NOT LIKE 'drawio-backup%' AND a.title NOT LIKE '~%')
                    + COALESCE((SELECT count(*) FROM northstar.drawio_reference dr
                                JOIN northstar.confluence_attachment sa
                                  ON sa.page_id = dr.source_page_id
                                 AND sa.file_kind = 'drawio'
                                 AND sa.title NOT LIKE 'drawio-backup%'
                                 AND sa.title NOT LIKE '~%'
                                 AND (dr.diagram_name = '' OR sa.title = dr.diagram_name
                                      OR sa.title = dr.diagram_name || '.drawio')
                                WHERE dr.inclusion_page_id = p.page_id), 0)
                   ) AS drawio_count,
                   1 AS group_size,
                   ARRAY[p.page_id] AS group_page_ids
            FROM northstar.confluence_page p
            LEFT JOIN northstar.ref_project rp ON rp.project_id = p.project_id
            LEFT JOIN northstar.ref_application ra ON ra.app_id = p.q_app_id
            {where_clause}
            -- Same adjacency rule as the grouped query so switching views
            -- keeps ordering stable for the user.
            ORDER BY p.fiscal_year DESC,
                     p.project_id ASC NULLS LAST,
                     p.title ASC,
                     COALESCE(p.q_app_id, '') ASC
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
                "grouped": False,
            }
        )

    # --- Grouped view (default) ---------------------------------------------
    # A "group" is all pages that share (project_id, q_app_id). Rows without a
    # project_id form singleton groups keyed by page_id. Rows without a q_app_id
    # group only by project_id (i.e., project-level folder pages with no app
    # stay as their own row). Within a group, the "primary" page = lowest depth
    # (NULLS LAST), tiebreak by page_id. Display the primary's title and sum
    # attachment/drawio counts across the whole group.
    args.extend([limit, offset])
    rows = await pg_client.fetch(
        f"""
        WITH base AS (
            SELECT p.page_id, p.fiscal_year, p.title, p.page_url, p.page_type,
                   p.project_id, p.q_app_id,
                   p.effective_app_id, p.app_hint, p.effective_app_hint,
                   -- Confluence tree root fold-up: sub-initiative pages (e.g.
                   -- FY2526-063 under LI2500067) group under their depth-1
                   -- ancestor's project id instead of splitting off.
                   -- See .specify/features/confluence-root-project-id/spec.md
                   COALESCE(p.root_project_id, p.project_id) AS group_project_id,
                   p.root_project_id,
                   p.depth, p.parent_id,
                   p.q_project_name, p.q_pm, p.q_it_lead, p.q_dt_lead,
                   -- Own attachments on this page
                   (SELECT count(*) FROM northstar.confluence_attachment a
                      WHERE a.page_id = p.page_id) AS own_attachment_count,
                   (SELECT count(*) FROM northstar.confluence_attachment a
                      WHERE a.page_id = p.page_id AND a.file_kind = 'drawio'
                        AND a.title NOT LIKE 'drawio-backup%' AND a.title NOT LIKE '~%') AS own_drawio_count,
                   -- Drawio attachments reachable through drawio_reference
                   -- links. Some pages (Robbie, Facility+, GAMS, LBP MA KM,
                   -- LSC, LI2400338, LI2400343…) embed diagrams via the
                   -- inc-drawio or templateUrl macros — the actual drawio
                   -- lives on a SOURCE page scanned out-of-band. This
                   -- subquery pulls those in so the admin list matches
                   -- what a Confluence user sees.
                   --
                   -- Two parts:
                   --   1. Refs directly owned by this page (its own macro)
                   --   2. Refs on ANY descendant page (so a depth-2 folder
                   --      reflects drawios embedded on its depth-3 children
                   --      even though those children are filtered out in
                   --      the default include_deep=false view). Descendant
                   --      lookup uses parent_id direct-child match — good
                   --      enough for 1-2 hops which is what we have.
                   (SELECT count(*) FROM northstar.drawio_reference dr
                      JOIN northstar.confluence_attachment sa
                        ON sa.page_id = dr.source_page_id
                       AND sa.file_kind = 'drawio'
                       AND sa.title NOT LIKE 'drawio-backup%'
                       AND sa.title NOT LIKE '~%'
                       AND (dr.diagram_name = '' OR sa.title = dr.diagram_name
                            OR sa.title = dr.diagram_name || '.drawio')
                      WHERE dr.inclusion_page_id = p.page_id
                         OR dr.inclusion_page_id IN (
                             SELECT child.page_id FROM northstar.confluence_page child
                             WHERE child.parent_id = p.page_id
                         )
                   ) AS ref_drawio_count
            FROM northstar.confluence_page p
            {where_clause}
        ),
        -- Combined attachment and drawio counts: own + referenced.
        -- We surface them as attachment_count/drawio_count so downstream
        -- grouping/aggregation code stays unchanged.
        base_with_refs AS (
            SELECT b.*,
                   (b.own_attachment_count + b.ref_drawio_count) AS attachment_count,
                   (b.own_drawio_count + b.ref_drawio_count) AS drawio_count
            FROM base b
        ),
        -- Pattern D: explode each base row by its linked apps. A page with
        -- no links in confluence_page_app_link appears exactly once (link_app_id
        -- = NULL). A page with N links appears N times, once per app. The
        -- LEFT JOIN makes that happen for free.
        exploded AS (
            SELECT b.*,
                   l.app_id AS link_app_id
            FROM base_with_refs b
            LEFT JOIN northstar.confluence_page_app_link l ON l.page_id = b.page_id
        ),
        -- Effective grouping key per exploded row: link_app_id > effective_app_id
        -- > [hint] > NA. The same physical page_id may end up in multiple
        -- partitions, which is what Pattern D wants.
        keyed AS (
            SELECT e.*,
                   -- Group by the Confluence tree root (depth=1 ancestor's
                   -- project_id) so sub-initiative pages fold up correctly.
                   COALESCE(e.group_project_id, 'PG:' || e.page_id) AS g_project,
                   COALESCE(
                     e.link_app_id,
                     e.effective_app_id,
                     'HINT:' || COALESCE(e.app_hint, e.effective_app_hint),
                     {na_fallback_sql}
                   ) AS g_app
            FROM exploded e
        ),
        grouped AS (
            SELECT *,
                   ROW_NUMBER() OVER (
                       PARTITION BY g_project, g_app
                       ORDER BY depth NULLS LAST, page_id
                   ) AS rn,
                   COUNT(*) OVER (
                       PARTITION BY g_project, g_app
                   ) AS group_size,
                   SUM(attachment_count) OVER (
                       PARTITION BY g_project, g_app
                   ) AS group_att,
                   SUM(drawio_count) OVER (
                       PARTITION BY g_project, g_app
                   ) AS group_dr,
                   ARRAY_AGG(page_id) OVER (
                       PARTITION BY g_project, g_app
                   ) AS group_pages
            FROM keyed
        )
        SELECT g.page_id, g.fiscal_year, g.title, g.page_url, g.page_type,
               -- project_id returned to the client IS the tree root, so
               -- sub-initiative pages (e.g. FY2526-063 under LI2500067)
               -- display under their LI2500067 parent in the admin list.
               -- The original sub-initiative id is still available to clients
               -- as `sub_project_id` for future UI pills.
               g.group_project_id AS project_id,
               CASE
                 WHEN g.project_id <> g.group_project_id
                   THEN g.project_id
                 ELSE NULL
               END AS sub_project_id,
               COALESCE(rp.project_name, g.q_project_name) AS project_name,
               CASE
                 WHEN rp.project_name IS NOT NULL THEN 'mspo'
                 WHEN g.q_project_name IS NOT NULL THEN 'questionnaire'
                 ELSE 'none'
               END AS project_name_source,
               -- app_id precedence: exploded link > effective > [hint] > NULL.
               -- Use effective_app_hint (ancestor-inherited) as a fallback so
               -- descendant pages whose own app_hint is NULL still render
               -- under the parent's [hint] tag.
               CASE
                 WHEN g.link_app_id IS NOT NULL THEN g.link_app_id
                 WHEN COALESCE(g.effective_app_id, g.q_app_id) IS NOT NULL
                   THEN COALESCE(g.effective_app_id, g.q_app_id)
                 WHEN COALESCE(g.app_hint, g.effective_app_hint) IS NOT NULL
                   THEN '[' || COALESCE(g.app_hint, g.effective_app_hint) || ']'
                 ELSE NULL
               END AS app_id,
               COALESCE(g.app_hint, g.effective_app_hint) AS app_hint,
               ra.name                                    AS app_name,
               CASE
                 WHEN ra.name IS NOT NULL THEN 'cmdb'
                 WHEN COALESCE(g.app_hint, g.effective_app_hint) IS NOT NULL
                      AND g.link_app_id IS NULL THEN 'hint_unresolved'
                 ELSE 'none'
               END AS app_name_source,
               (rp.project_id IS NOT NULL) AS project_in_mspo,
               (ra.app_id IS NOT NULL)     AS app_in_cmdb,
               g.q_pm, g.q_it_lead, g.q_dt_lead,
               g.group_att::int  AS attachment_count,
               g.group_dr::int   AS drawio_count,
               g.group_size::int AS group_size,
               g.group_pages     AS group_page_ids
        FROM grouped g
        -- JOIN ref_project on the group root so the project name comes from
        -- the real top-level project (LI2500067), not a sub-initiative id
        -- that happens to be in a child page title (FY2526-063).
        LEFT JOIN northstar.ref_project rp    ON rp.project_id = g.group_project_id
        LEFT JOIN northstar.ref_application ra
               ON ra.app_id = COALESCE(g.link_app_id, g.effective_app_id, g.q_app_id)
        WHERE g.rn = 1
        -- Ontology fix (2026-04-10): sort so that all rows sharing the same
        -- group_project_id are strictly adjacent, with orphan rows sinking
        -- to the tail of each FY bucket. Secondary sorts by title, then
        -- app_id so the order is stable and pagination-friendly. The
        -- frontend relies on this adjacency for rowspan-style group folding.
        ORDER BY g.fiscal_year DESC,
                 g.group_project_id ASC NULLS LAST,
                 g.title ASC,
                 COALESCE(
                     g.link_app_id,
                     g.effective_app_id,
                     g.q_app_id,
                     ''
                 ) ASC
        LIMIT ${len(args) - 1} OFFSET ${len(args)}
        """,
        *args,
    )
    total_na_fallback_sql = (
        "'PAGE:' || p.page_id" if not include_deep else "'NA'"
    )
    total = await pg_client.fetchval(
        f"""
        SELECT count(*) FROM (
            SELECT DISTINCT
                   COALESCE(
                     p.root_project_id,
                     p.project_id,
                     'PG:' || p.page_id
                   ) AS g_project,
                   COALESCE(
                     l.app_id,
                     p.effective_app_id,
                     'HINT:' || COALESCE(p.app_hint, p.effective_app_hint),
                     {total_na_fallback_sql}
                   ) AS g_app
            FROM northstar.confluence_page p
            LEFT JOIN northstar.confluence_page_app_link l ON l.page_id = p.page_id
            {where_clause}
        ) sub
        """,
        *args[:-2],
    )
    return ApiResponse(
        data={
            "total": total,
            "rows": [dict(r) for r in rows],
            "grouped": True,
        }
    )


@router.get("/confluence/pages/{page_id}")
async def get_page(page_id: str) -> ApiResponse:
    # Exclude body_html from the default detail payload — it can be huge.
    # Use /confluence/pages/{id}/body to fetch raw HTML when needed.
    page = await pg_client.fetchrow(
        """
        SELECT p.page_id, p.fiscal_year, p.title, p.project_id, p.page_url,
               p.parent_id, p.depth,
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

    # Own attachments (physically on this page)
    own_rows = await pg_client.fetch(
        """
        SELECT attachment_id, title, media_type, file_kind, file_size, version,
               download_path, local_path, synced_at,
               'own' AS source_kind,
               NULL::text AS source_page_id,
               NULL::text AS source_page_title,
               NULL::text AS diagram_name
        FROM northstar.confluence_attachment
        WHERE page_id = $1
          AND title NOT LIKE 'drawio-backup%'
          AND title NOT LIKE '~%'
        """,
        page_id,
    )

    # Descendant attachments — walk parent_id chain downward from this page
    # (recursive) and gather attachments from every descendant page. Tagged
    # with the descendant's title so the UI can show "From child <title>".
    # Only includes non-backup/non-tmp attachments.
    descendant_rows = await pg_client.fetch(
        """
        WITH RECURSIVE subtree AS (
            SELECT page_id, title, 1 AS lvl
            FROM northstar.confluence_page
            WHERE parent_id = $1
            UNION ALL
            SELECT c.page_id, c.title, s.lvl + 1
            FROM northstar.confluence_page c
            JOIN subtree s ON c.parent_id = s.page_id
            WHERE s.lvl < 5
        )
        SELECT a.attachment_id, a.title, a.media_type, a.file_kind, a.file_size, a.version,
               a.download_path, a.local_path, a.synced_at,
               'descendant' AS source_kind,
               s.page_id    AS source_page_id,
               s.title      AS source_page_title,
               NULL::text   AS diagram_name
        FROM subtree s
        JOIN northstar.confluence_attachment a ON a.page_id = s.page_id
        WHERE a.title NOT LIKE 'drawio-backup%'
          AND a.title NOT LIKE '~%'
        """,
        page_id,
    )

    # Referenced drawios — inc-drawio / templateUrl pointing to another page.
    # Walk the refs owned by this page AND any direct-child page so a folder
    # row reflects diagrams embedded on its architecture children.
    referenced_rows = await pg_client.fetch(
        """
        WITH incl AS (
            -- This page and its direct children (parent_id = this page)
            SELECT page_id, title FROM northstar.confluence_page WHERE page_id = $1
            UNION
            SELECT page_id, title FROM northstar.confluence_page WHERE parent_id = $1
        )
        SELECT sa.attachment_id, sa.title, sa.media_type, sa.file_kind, sa.file_size, sa.version,
               sa.download_path, sa.local_path, sa.synced_at,
               'referenced' AS source_kind,
               sp.page_id   AS source_page_id,
               sp.title     AS source_page_title,
               dr.diagram_name,
               incl.page_id AS via_page_id,
               incl.title   AS via_page_title,
               dr.macro_kind
        FROM incl
        JOIN northstar.drawio_reference dr ON dr.inclusion_page_id = incl.page_id
        JOIN northstar.confluence_page sp ON sp.page_id = dr.source_page_id
        JOIN northstar.confluence_attachment sa
          ON sa.page_id = dr.source_page_id
         AND sa.file_kind = 'drawio'
         AND sa.title NOT LIKE 'drawio-backup%'
         AND sa.title NOT LIKE '~%'
         AND (dr.diagram_name = '' OR sa.title = dr.diagram_name
              OR sa.title = dr.diagram_name || '.drawio')
        """,
        page_id,
    )

    # De-dupe: same attachment can appear as descendant + referenced. Prefer
    # 'referenced' source_kind since it carries diagram_name + macro_kind
    # context, which is more informative on the UI.
    seen: dict[str, dict] = {}
    PRIORITY = {"referenced": 0, "descendant": 1, "own": 2}
    for row in list(own_rows) + list(descendant_rows) + list(referenced_rows):
        r = dict(row)
        key = r["attachment_id"]
        existing = seen.get(key)
        if existing is None or PRIORITY[r["source_kind"]] < PRIORITY[existing["source_kind"]]:
            seen[key] = r
    unified = list(seen.values())
    # Architecture-aware sort (see _attachment_sort_key): 应用架构 bucket
    # first, 技术架构 bucket second, everything else by recency DESC.
    unified.sort(key=_attachment_sort_key)

    # Build a child tree for the Hierarchy tab (direct children only — the
    # client can follow the page_id link to go deeper). Include their own
    # attachment/drawio counts (own + ref-direct) so the tree is scannable.
    children = await pg_client.fetch(
        """
        SELECT c.page_id, c.title, c.depth, c.page_url, c.page_type,
               (SELECT count(*) FROM northstar.confluence_attachment a
                  WHERE a.page_id = c.page_id
                    AND a.title NOT LIKE 'drawio-backup%'
                    AND a.title NOT LIKE '~%') AS own_attachments,
               (SELECT count(*) FROM northstar.confluence_attachment a
                  WHERE a.page_id = c.page_id AND a.file_kind = 'drawio'
                    AND a.title NOT LIKE 'drawio-backup%'
                    AND a.title NOT LIKE '~%') AS own_drawio,
               (SELECT count(*) FROM northstar.drawio_reference dr
                  JOIN northstar.confluence_attachment sa
                    ON sa.page_id = dr.source_page_id
                   AND sa.file_kind = 'drawio'
                   AND sa.title NOT LIKE 'drawio-backup%'
                   AND sa.title NOT LIKE '~%'
                   AND (dr.diagram_name = '' OR sa.title = dr.diagram_name
                        OR sa.title = dr.diagram_name || '.drawio')
                  WHERE dr.inclusion_page_id = c.page_id) AS ref_drawio
        FROM northstar.confluence_page c
        WHERE c.parent_id = $1
        ORDER BY c.title
        """,
        page_id,
    )

    # Parent page (if any) for breadcrumb
    parent = None
    if page_dict.get("parent_id"):
        parent = await pg_client.fetchrow(
            """
            SELECT page_id, title, depth
            FROM northstar.confluence_page
            WHERE page_id = $1
            """,
            page_dict["parent_id"],
        )

    return ApiResponse(
        data={
            "page": page_dict,
            # Legacy field name kept for backward compat — points at all
            # attachments (own + descendant + referenced) with source tags
            "attachments": [dict(r) for r in unified],
            "parent": dict(parent) if parent else None,
            "children": [dict(c) for c in children],
        }
    )


@router.get("/confluence/pages/{page_id}/extracted")
async def get_page_extracted(page_id: str) -> ApiResponse:
    """Return drawio parser output for every drawio attachment on this page
    and its descendant pages.

    Spec: confluence-drawio-extract § 7. Reads from the confluence_diagram_app
    + confluence_diagram_interaction tables populated by
    scripts/parse_confluence_drawios.py.

    Response shape:
        {
            "apps": [{
                attachment_id, attachment_title, source_page_id,
                source_page_title, source_kind ('own'|'descendant'),
                cell_id, app_name, standard_id, id_is_standard,
                application_status, functions, cmdb_name (or null if not in
                CMDB — the frontend will fall back to app_name)
            }],
            "interactions": [{
                attachment_id, attachment_title, source_page_id,
                source_page_title, edge_cell_id, source_cell_id, target_cell_id,
                interaction_type, direction, interaction_status, business_object
            }],
            "by_attachment": [{
                attachment_id, attachment_title, source_page_title,
                source_kind, app_count, app_with_std_id_count, interaction_count
            }]
        }
    """
    # Verify the page exists before we go hunting for extractions.
    exists = await pg_client.fetchval(
        "SELECT 1 FROM northstar.confluence_page WHERE page_id = $1",
        page_id,
    )
    if exists is None:
        raise HTTPException(status_code=404, detail=f"Page {page_id} not found")

    apps = await pg_client.fetch(
        """
        WITH RECURSIVE subtree AS (
            SELECT page_id, title, 0 AS lvl
            FROM northstar.confluence_page
            WHERE page_id = $1
            UNION ALL
            SELECT c.page_id, c.title, s.lvl + 1
            FROM northstar.confluence_page c
            JOIN subtree s ON c.parent_id = s.page_id
            WHERE s.lvl < 5
        )
        SELECT
            cda.attachment_id,
            att.title AS attachment_title,
            s.page_id AS source_page_id,
            s.title   AS source_page_title,
            CASE WHEN s.lvl = 0 THEN 'own' ELSE 'descendant' END AS source_kind,
            cda.cell_id,
            cda.app_name,
            cda.standard_id,
            cda.id_is_standard,
            cda.application_status,
            cda.functions,
            cda.fill_color,
            -- Name-id reconciliation fields (spec: drawio-name-id-reconciliation)
            cda.resolved_app_id,
            cda.match_type,
            cda.name_similarity,
            -- CMDB name looked up by the DRAWIO's original std_id — used by the
            -- UI to render "CMDB: ECC" context when the drawio mis-IDed a cell
            ra_by_id.name AS cmdb_name_for_drawio_id,
            -- CMDB name looked up by the RESOLVED id (could be same as
            -- cmdb_name_for_drawio_id if match_type=direct, or different if
            -- auto_corrected / fuzzy_by_name)
            ra_by_resolved.name AS cmdb_name_for_resolved,
            -- Back-compat: cmdb_name = the resolved cmdb_name if we have one,
            -- otherwise the drawio-id lookup. Existing UI code that only
            -- reads this field still works.
            COALESCE(ra_by_resolved.name, ra_by_id.name) AS cmdb_name
        FROM subtree s
        JOIN northstar.confluence_attachment att ON att.page_id = s.page_id
        JOIN northstar.confluence_diagram_app cda ON cda.attachment_id = att.attachment_id
        LEFT JOIN northstar.ref_application ra_by_id
               ON ra_by_id.app_id = cda.standard_id
        LEFT JOIN northstar.ref_application ra_by_resolved
               ON ra_by_resolved.app_id = cda.resolved_app_id
        WHERE att.file_kind = 'drawio'
          AND att.title NOT LIKE 'drawio-backup%'
          AND att.title NOT LIKE '~%'
        ORDER BY
            s.lvl,
            att.title,
            -- Standard-id apps first, then alphabetic by app_name
            CASE WHEN cda.standard_id IS NOT NULL THEN 0 ELSE 1 END,
            cda.app_name
        """,
        page_id,
    )

    interactions = await pg_client.fetch(
        """
        WITH RECURSIVE subtree AS (
            SELECT page_id, title, 0 AS lvl
            FROM northstar.confluence_page
            WHERE page_id = $1
            UNION ALL
            SELECT c.page_id, c.title, s.lvl + 1
            FROM northstar.confluence_page c
            JOIN subtree s ON c.parent_id = s.page_id
            WHERE s.lvl < 5
        )
        SELECT
            cdi.attachment_id,
            att.title AS attachment_title,
            s.page_id AS source_page_id,
            s.title   AS source_page_title,
            CASE WHEN s.lvl = 0 THEN 'own' ELSE 'descendant' END AS source_kind,
            cdi.edge_cell_id,
            cdi.source_cell_id,
            cdi.target_cell_id,
            cdi.interaction_type,
            cdi.direction,
            cdi.interaction_status,
            cdi.business_object,
            -- Resolve endpoint app_name + standard_id via the app table.
            -- Also surface the CMDB canonical name for the resolved app
            -- (post-reconciliation) so the UI can render names — not raw
            -- A-ids — in the From/To columns. Priority:
            --   1) CMDB name of the resolved app (auto-corrected id)
            --   2) CMDB name of the drawio's own std_id
            --   3) The raw drawio label (app_name)
            src_app.app_name        AS source_app_name,
            src_app.standard_id     AS source_standard_id,
            src_app.resolved_app_id AS source_resolved_id,
            src_app.match_type      AS source_match_type,
            src_cmdb_res.name       AS source_cmdb_name_resolved,
            src_cmdb_orig.name      AS source_cmdb_name_orig,
            tgt_app.app_name        AS target_app_name,
            tgt_app.standard_id     AS target_standard_id,
            tgt_app.resolved_app_id AS target_resolved_id,
            tgt_app.match_type      AS target_match_type,
            tgt_cmdb_res.name       AS target_cmdb_name_resolved,
            tgt_cmdb_orig.name      AS target_cmdb_name_orig
        FROM subtree s
        JOIN northstar.confluence_attachment att ON att.page_id = s.page_id
        JOIN northstar.confluence_diagram_interaction cdi
          ON cdi.attachment_id = att.attachment_id
        LEFT JOIN northstar.confluence_diagram_app src_app
          ON src_app.attachment_id = cdi.attachment_id
         AND src_app.cell_id = cdi.source_cell_id
        LEFT JOIN northstar.confluence_diagram_app tgt_app
          ON tgt_app.attachment_id = cdi.attachment_id
         AND tgt_app.cell_id = cdi.target_cell_id
        LEFT JOIN northstar.ref_application src_cmdb_res
          ON src_cmdb_res.app_id = src_app.resolved_app_id
        LEFT JOIN northstar.ref_application src_cmdb_orig
          ON src_cmdb_orig.app_id = src_app.standard_id
        LEFT JOIN northstar.ref_application tgt_cmdb_res
          ON tgt_cmdb_res.app_id = tgt_app.resolved_app_id
        LEFT JOIN northstar.ref_application tgt_cmdb_orig
          ON tgt_cmdb_orig.app_id = tgt_app.standard_id
        WHERE att.file_kind = 'drawio'
          AND att.title NOT LIKE 'drawio-backup%'
          AND att.title NOT LIKE '~%'
        ORDER BY s.lvl, att.title, cdi.edge_cell_id
        """,
        page_id,
    )

    by_attachment = await pg_client.fetch(
        """
        WITH RECURSIVE subtree AS (
            SELECT page_id, title, 0 AS lvl
            FROM northstar.confluence_page
            WHERE page_id = $1
            UNION ALL
            SELECT c.page_id, c.title, s.lvl + 1
            FROM northstar.confluence_page c
            JOIN subtree s ON c.parent_id = s.page_id
            WHERE s.lvl < 5
        )
        SELECT
            att.attachment_id,
            att.title AS attachment_title,
            s.title   AS source_page_title,
            CASE WHEN s.lvl = 0 THEN 'own' ELSE 'descendant' END AS source_kind,
            (SELECT count(*) FROM northstar.confluence_diagram_app cda
               WHERE cda.attachment_id = att.attachment_id) AS app_count,
            (SELECT count(*) FROM northstar.confluence_diagram_app cda
               WHERE cda.attachment_id = att.attachment_id
                 AND cda.standard_id IS NOT NULL) AS app_with_std_id_count,
            (SELECT count(*) FROM northstar.confluence_diagram_interaction cdi
               WHERE cdi.attachment_id = att.attachment_id) AS interaction_count
        FROM subtree s
        JOIN northstar.confluence_attachment att ON att.page_id = s.page_id
        WHERE att.file_kind = 'drawio'
          AND att.title NOT LIKE 'drawio-backup%'
          AND att.title NOT LIKE '~%'
          AND EXISTS (
              SELECT 1 FROM northstar.confluence_diagram_app cda
              WHERE cda.attachment_id = att.attachment_id
          )
        ORDER BY s.lvl, att.title
        """,
        page_id,
    )

    # Major applications rollup (spec: confluence-major-apps § 5).
    # Aggregates across the whole subtree, dedupes by effective app_id,
    # sorts by Change > New > Sunset > occurrence_count > cmdb name.
    major_apps = await pg_client.fetch(
        """
        WITH RECURSIVE subtree AS (
            SELECT page_id, title, 0 AS lvl
            FROM northstar.confluence_page
            WHERE page_id = $1
            UNION ALL
            SELECT c.page_id, c.title, s.lvl + 1
            FROM northstar.confluence_page c
            JOIN subtree s ON c.parent_id = s.page_id
            WHERE s.lvl < 5
        ),
        raw_majors AS (
            SELECT
                COALESCE(cda.resolved_app_id, cda.standard_id) AS app_id,
                cda.app_name AS drawio_name,
                cda.application_status,
                att.attachment_id,
                att.title AS attachment_title,
                s.title   AS source_page_title
            FROM subtree s
            JOIN northstar.confluence_attachment att ON att.page_id = s.page_id
            JOIN northstar.confluence_diagram_app cda
              ON cda.attachment_id = att.attachment_id
            WHERE cda.application_status IN ('New', 'Change', 'Sunset')
              AND COALESCE(cda.resolved_app_id, cda.standard_id) IS NOT NULL
              AND att.file_kind = 'drawio'
              AND att.title NOT LIKE 'drawio-backup%'
              AND att.title NOT LIKE '~%'
        ),
        collapsed AS (
            -- Collapse all rows for the same effective app_id into one,
            -- keeping the strongest status (Change > New > Sunset) and
            -- the drawio_name that came with that strongest status.
            SELECT
                app_id,
                (ARRAY_AGG(application_status ORDER BY
                    CASE application_status
                        WHEN 'Change' THEN 0
                        WHEN 'New'    THEN 1
                        WHEN 'Sunset' THEN 2
                        ELSE 3
                    END
                ))[1] AS application_status,
                (ARRAY_AGG(drawio_name ORDER BY
                    CASE application_status
                        WHEN 'Change' THEN 0
                        WHEN 'New'    THEN 1
                        WHEN 'Sunset' THEN 2
                        ELSE 3
                    END
                ))[1] AS drawio_name,
                COUNT(*)::int AS occurrence_count,
                ARRAY_AGG(DISTINCT attachment_title) AS attachment_titles
            FROM raw_majors
            GROUP BY app_id
        )
        SELECT
            c.app_id,
            c.drawio_name,
            c.application_status,
            c.occurrence_count,
            c.attachment_titles,
            ra.name AS cmdb_name
        FROM collapsed c
        LEFT JOIN northstar.ref_application ra ON ra.app_id = c.app_id
        ORDER BY
            CASE c.application_status
                WHEN 'Change' THEN 0
                WHEN 'New'    THEN 1
                WHEN 'Sunset' THEN 2
                ELSE 3
            END,
            c.occurrence_count DESC,
            CASE WHEN ra.name IS NOT NULL THEN 0 ELSE 1 END,
            ra.name,
            c.app_id
        """,
        page_id,
    )

    return ApiResponse(
        data={
            "apps": [dict(r) for r in apps],
            "interactions": [dict(r) for r in interactions],
            "by_attachment": [dict(r) for r in by_attachment],
            "major_apps": [dict(r) for r in major_apps],
        }
    )


@router.get("/confluence/pages/{page_id}/body")
async def get_page_body(page_id: str, raw: bool = False) -> ApiResponse:
    """Return the Confluence HTML body for a page (for iframe preview).

    By default the body is sanitized — Confluence storage format uses custom
    `<ac:*>` macro tags that browsers render as raw text (leaking JSON config
    and parameter values). The sanitizer strips parameters, unwraps
    rich-text-body, turns panel/info/note/expand macros into styled divs,
    and drops non-renderable macros like drawio/toc/attachments.

    Pass ?raw=1 to get the untouched storage format (for debugging).
    """
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

    html = row["body_html"]
    if not raw:
        try:
            from app.services.confluence_body import sanitize_storage_html
            html = sanitize_storage_html(html)
        except Exception as exc:  # noqa: BLE001
            # If sanitization blows up, fall back to raw. Log the error.
            import logging
            logging.getLogger(__name__).warning(
                "sanitize_storage_html failed for page %s: %s", page_id, exc
            )
            html = row["body_html"]
    return ApiResponse(data={"html": html, "size_chars": row["body_size_chars"]})


@router.get("/applications/{app_id}/overview")
async def application_overview(app_id: str) -> ApiResponse:
    """Unified CMDB application detail.

    CMDB itself is minimal (5 columns, short_description all null), so we
    enrich with everything else we know about this app_id:
      - CMDB master row
      - Confluence application page(s) matching q_app_id
      - All attachments on those pages
      - Neo4j Project nodes that INCLUDES the app (from any drawio)
      - Neo4j Integrations in/out of the app
      - Count of drawio cells referencing this standard_id (from ref_diagram_app)
    """
    import json as _json

    # 1) CMDB master row (full 22 cols from EAM) + resolved owner display names
    cmdb = await pg_client.fetchrow(
        """
        SELECT
            a.app_id, a.name, a.app_full_name, a.short_description, a.status,
            a.u_service_area, a.app_classification, a.app_ownership,
            a.app_solution_type, a.portfolio_mgt,
            a.owned_by,          e_o.name  AS owned_by_name,
            a.app_it_owner,      e_it.name AS app_it_owner_name,
            a.app_dt_owner,      e_dt.name AS app_dt_owner_name,
            a.app_operation_owner, e_op.name AS app_operation_owner_name,
            a.app_owner_tower, a.app_owner_domain,
            a.app_operation_owner_tower, a.app_operation_owner_domain,
            a.patch_level, a.decommissioned_at, a.source_system, a.synced_at
        FROM northstar.ref_application a
        LEFT JOIN northstar.ref_employee e_o  ON e_o.itcode  = a.owned_by
        LEFT JOIN northstar.ref_employee e_it ON e_it.itcode = a.app_it_owner
        LEFT JOIN northstar.ref_employee e_dt ON e_dt.itcode = a.app_dt_owner
        LEFT JOIN northstar.ref_employee e_op ON e_op.itcode = a.app_operation_owner
        WHERE a.app_id = $1
        """,
        app_id,
    )
    if cmdb is None:
        raise HTTPException(status_code=404, detail=f"{app_id} not found in CMDB")

    # 1b) TCO / financial data
    tco = await pg_client.fetchrow(
        """
        SELECT app_id, application_classification,
               stamp_k, budget_k, actual_k,
               allocation_stamp_k, allocation_actual_k
        FROM northstar.ref_application_tco
        WHERE app_id = $1
        """,
        app_id,
    )

    # 2) Confluence pages with this A-id in title
    pages = await pg_client.fetch(
        """
        SELECT page_id, fiscal_year, title, page_url, body_size_chars,
               q_pm, q_it_lead, q_dt_lead,
               body_questionnaire
        FROM northstar.confluence_page
        WHERE q_app_id = $1
        ORDER BY fiscal_year DESC, title
        """,
        app_id,
    )
    page_ids = [p["page_id"] for p in pages]

    # Parse questionnaire sections per page (for inline rendering)
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

    # 3) Attachments across those pages
    attachments: list[dict] = []
    if page_ids:
        rows = await pg_client.fetch(
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
              END, title
            """,
            page_ids,
        )
        attachments = [dict(r) for r in rows]

    # 4) Neo4j: projects that INCLUDE this app + integrations
    from app.services import neo4j_client as _n
    projects = await _n.run_query(
        """
        MATCH (p:Project)-[:INCLUDES]->(a:Application {app_id: $id})
        RETURN p.project_id AS project_id, p.name AS name,
               p.fiscal_year AS fiscal_year, p.page_type AS page_type,
               p.pm AS pm, p.it_lead AS it_lead, p.dt_lead AS dt_lead
        ORDER BY p.fiscal_year DESC, p.project_id
        """,
        {"id": app_id},
    )
    outbound = await _n.run_query(
        """
        MATCH (a:Application {app_id: $id})-[r:INTEGRATES_WITH]->(b:Application)
        RETURN b.app_id AS target_app_id, b.name AS target_name, b.status AS target_status,
               r.interaction_type AS interaction_type, r.business_object AS business_object,
               r.status AS status
        ORDER BY b.name
        """,
        {"id": app_id},
    )
    inbound = await _n.run_query(
        """
        MATCH (b:Application)-[r:INTEGRATES_WITH]->(a:Application {app_id: $id})
        RETURN b.app_id AS source_app_id, b.name AS source_name, b.status AS source_status,
               r.interaction_type AS interaction_type, r.business_object AS business_object,
               r.status AS status
        ORDER BY b.name
        """,
        {"id": app_id},
    )

    # 5) Appearances in EGM-parsed diagrams (ref_diagram_app)
    diagram_hits = await pg_client.fetch(
        """
        SELECT d.id AS diagram_id, d.file_name, d.diagram_type,
               r.project_id, r.project_name, r.project_pm
        FROM northstar.ref_diagram_app da
        JOIN northstar.ref_diagram d ON d.id = da.diagram_id
        LEFT JOIN northstar.ref_request r ON r.id = d.request_id
        WHERE da.standard_id = $1
        ORDER BY d.create_at DESC
        """,
        app_id,
    )

    # Convert Postgres Decimal to float for JSON serialization
    from decimal import Decimal as _Decimal

    def _clean(row: dict | None) -> dict | None:
        if row is None:
            return None
        out: dict = {}
        for k, v in row.items():
            if isinstance(v, _Decimal):
                out[k] = float(v)
            else:
                out[k] = v
        return out

    return ApiResponse(
        data={
            "app_id": app_id,
            "cmdb": dict(cmdb),
            "tco": _clean(dict(tco)) if tco else None,
            "confluence_pages": page_dicts,
            "attachments": attachments,
            "graph": {
                "projects": projects,
                "outbound": outbound,
                "inbound": inbound,
            },
            "egm_diagram_hits": [dict(r) for r in diagram_hits],
        }
    )


@router.get("/projects/{project_id}/overview")
async def project_overview(project_id: str) -> ApiResponse:
    """Unified project view joining every source keyed on project_id.

    Returns ref_project (MSPO master) + confluence_page (with questionnaire) +
    confluence attachments + Neo4j-derived applications and integrations for
    the project. Used by the admin UI to give one-stop visibility into a
    specific project.
    """
    import json as _json

    # 1) MSPO master — full EAM project row
    mspo = await pg_client.fetchrow(
        "SELECT * FROM northstar.ref_project WHERE project_id = $1",
        project_id,
    )

    # 1b) Project summary (rich business context)
    summary = await pg_client.fetchrow(
        "SELECT * FROM northstar.ref_project_summary WHERE project_id = $1",
        project_id,
    )

    # 1c) Team members (resolved via ref_employee for tier org)
    team = await pg_client.fetch(
        """
        SELECT tm.itcode, tm.name, tm.worker_type, tm.manager_itcode,
               e.tier_1_org, e.tier_2_org, e.job_role
        FROM northstar.ref_project_team_member tm
        LEFT JOIN northstar.ref_employee e ON e.itcode = tm.itcode
        WHERE tm.project_id = $1
        ORDER BY tm.itcode
        """,
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

    # Clean Decimal → float for JSON
    from decimal import Decimal as _D2

    def _clean2(row):
        if row is None:
            return None
        out: dict = {}
        for k, v in row.items():
            out[k] = float(v) if isinstance(v, _D2) else v
        return out

    return ApiResponse(
        data={
            "project_id": project_id,
            "mspo": _clean2(dict(mspo)) if mspo else None,
            "summary": _clean2(dict(summary)) if summary else None,
            "team": [dict(t) for t in team],
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
