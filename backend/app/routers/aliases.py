"""App alias management — /api/admin/aliases/*

Exposes the northstar.pending_app_merge review workflow and manages
northstar.manual_app_aliases. Used by the /admin/aliases review UI.

Flow:
    1. scripts/generate_merge_candidates.py writes candidate groups to
       pending_app_merge (decision IS NULL).
    2. GET /api/admin/aliases/pending lists them.
    3. POST /api/admin/aliases/pending/{id}/decide accepts or rejects.
    4. On accept, rows are inserted into manual_app_aliases, which the
       loader reads on its next run to collapse X-ids.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from app.models.schemas import ApiResponse, MergeDecisionRequest
from app.services import pg_client

router = APIRouter(prefix="/api/admin/aliases", tags=["aliases"])


@router.get("/pending")
async def list_pending(
    include_decided: bool = Query(False),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> ApiResponse:
    """List pending merge candidates from northstar.pending_app_merge."""
    where = "" if include_decided else "WHERE decision IS NULL"
    rows = await pg_client.fetch(
        f"""
        SELECT id, norm_key, candidate_ids, raw_names, projects,
               created_at, reviewed_at, decision, decided_by,
               canonical_id, note
        FROM northstar.pending_app_merge
        {where}
        ORDER BY created_at DESC
        LIMIT $1 OFFSET $2
        """,
        limit,
        offset,
    )
    return ApiResponse(data=[dict(r) for r in rows])


@router.get("/pending/{merge_id}")
async def get_pending(merge_id: int) -> ApiResponse:
    row = await pg_client.fetchrow(
        """
        SELECT id, norm_key, candidate_ids, raw_names, projects,
               created_at, reviewed_at, decision, decided_by,
               canonical_id, note
        FROM northstar.pending_app_merge
        WHERE id = $1
        """,
        merge_id,
    )
    if row is None:
        raise HTTPException(status_code=404, detail=f"pending merge {merge_id} not found")
    return ApiResponse(data=dict(row))


@router.post("/pending/{merge_id}/decide")
async def decide(merge_id: int, body: MergeDecisionRequest) -> ApiResponse:
    """Record a human decision on a candidate group.

    decision='merge':
        - requires canonical_id which MUST be one of candidate_ids
        - writes (alias_id, canonical_id) rows to manual_app_aliases for every
          non-canonical candidate
        - marks pending_app_merge row as decided
    decision='keep_separate':
        - only marks the pending row; no aliases written
    """
    if body.decision not in ("merge", "keep_separate"):
        raise HTTPException(status_code=400, detail="decision must be 'merge' or 'keep_separate'")

    row = await pg_client.fetchrow(
        "SELECT id, candidate_ids, decision FROM northstar.pending_app_merge WHERE id = $1",
        merge_id,
    )
    if row is None:
        raise HTTPException(status_code=404, detail=f"pending merge {merge_id} not found")
    if row["decision"] is not None:
        raise HTTPException(status_code=409, detail="merge already decided")

    candidate_ids: list[str] = list(row["candidate_ids"])

    if body.decision == "merge":
        if not body.canonical_id:
            raise HTTPException(status_code=400, detail="canonical_id is required for merge")
        if body.canonical_id not in candidate_ids:
            raise HTTPException(
                status_code=400,
                detail=f"canonical_id {body.canonical_id} not in candidate_ids {candidate_ids}",
            )

    # Transactional: update pending + insert aliases atomically
    pool = await pg_client.connect()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                """
                UPDATE northstar.pending_app_merge
                SET decision = $1,
                    canonical_id = $2,
                    decided_by = $3,
                    note = $4,
                    reviewed_at = NOW()
                WHERE id = $5
                """,
                body.decision,
                body.canonical_id,
                body.decided_by,
                body.note,
                merge_id,
            )
            aliases_written = 0
            if body.decision == "merge":
                for alias_id in candidate_ids:
                    if alias_id == body.canonical_id:
                        continue
                    await conn.execute(
                        """
                        INSERT INTO northstar.manual_app_aliases
                            (alias_id, canonical_id, decided_by, source_merge_id, note)
                        VALUES ($1, $2, $3, $4, $5)
                        ON CONFLICT (alias_id) DO UPDATE SET
                            canonical_id = EXCLUDED.canonical_id,
                            decided_at = NOW(),
                            decided_by = EXCLUDED.decided_by,
                            source_merge_id = EXCLUDED.source_merge_id,
                            note = EXCLUDED.note
                        """,
                        alias_id,
                        body.canonical_id,
                        body.decided_by,
                        merge_id,
                        body.note,
                    )
                    aliases_written += 1

    return ApiResponse(
        data={
            "merge_id": merge_id,
            "decision": body.decision,
            "aliases_written": aliases_written,
            "note": "Re-run load_age_from_pg.py to apply aliases to the graph",
        }
    )


@router.get("/manual")
async def list_manual_aliases(
    canonical_id: Optional[str] = None,
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
) -> ApiResponse:
    """List already-confirmed aliases in northstar.manual_app_aliases."""
    if canonical_id:
        rows = await pg_client.fetch(
            """
            SELECT alias_id, canonical_id, decided_at, decided_by, source_merge_id, note
            FROM northstar.manual_app_aliases
            WHERE canonical_id = $1
            ORDER BY decided_at DESC
            LIMIT $2 OFFSET $3
            """,
            canonical_id,
            limit,
            offset,
        )
    else:
        rows = await pg_client.fetch(
            """
            SELECT alias_id, canonical_id, decided_at, decided_by, source_merge_id, note
            FROM northstar.manual_app_aliases
            ORDER BY decided_at DESC
            LIMIT $1 OFFSET $2
            """,
            limit,
            offset,
        )
    return ApiResponse(data=[dict(r) for r in rows])


@router.delete("/manual/{alias_id}")
async def delete_manual_alias(alias_id: str) -> ApiResponse:
    """Remove an alias mapping (reverts the merge on next loader run)."""
    pool = await pg_client.connect()
    async with pool.acquire() as conn:
        result = await conn.execute(
            "DELETE FROM northstar.manual_app_aliases WHERE alias_id = $1",
            alias_id,
        )
    return ApiResponse(
        data={
            "alias_id": alias_id,
            "deleted": result.endswith("1"),
            "note": "Re-run load_age_from_pg.py to revert the merge in the graph",
        }
    )
