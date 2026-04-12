"""image-vision-extract Phase 0 + Phase 1 PoC tests.

Traces to .specify/features/image-vision-extract/spec.md § 4
Acceptance Criteria. Runs against the live backend on 71, which
assumes migration 013 has been applied and mark_vision_candidates.py
has been run at least once.

Most tests are Phase 0 (state-level assertions on the PG columns
we added) plus Phase 1 negative-path tests (415/404/503/smoke). We
intentionally keep the happy-path vision-extract call behind a
`@pytest.mark.slow` marker because it requires live LLM access
(settings.llm_enabled=true), which isn't guaranteed on every CI.
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import httpx
import pytest


pytestmark = pytest.mark.asyncio


# ---------------------------------------------------------------------------
# Phase 0: migration 013 columns and mark_vision_candidates.py script
# ---------------------------------------------------------------------------

def test_confluence_attachment_has_vision_columns(pg):
    """AC-1 prerequisite. Migration 013 must be applied."""
    with pg.cursor() as cur:
        cur.execute(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'northstar'
              AND table_name = 'confluence_attachment'
              AND column_name IN ('derived_source', 'derived_source_att', 'vision_candidate')
            """
        )
        cols = {row["column_name"] for row in cur.fetchall()}
    missing = {"derived_source", "derived_source_att", "vision_candidate"} - cols
    assert not missing, (
        f"confluence_attachment missing columns {missing} — "
        "run backend/sql/013_image_vision_candidate.sql"
    )


def test_mark_candidates_finds_drawio_derived_pngs(pg):
    """AC-1. After running the host script, at least some PNGs in
    FY2425/FY2526 should be marked derived_source='drawio' because
    the scanner collected many "drawio + drawio.png" pairs."""
    with pg.cursor() as cur:
        cur.execute(
            """
            SELECT COUNT(*) AS n
            FROM northstar.confluence_attachment
            WHERE derived_source = 'drawio'
            """
        )
        n = cur.fetchone()["n"]
    # This test will skip on a fresh DB where mark_vision_candidates
    # hasn't been run yet, rather than fail loudly.
    if n == 0:
        pytest.skip(
            "no drawio-derived rows yet — run scripts/mark_vision_candidates.py "
            "on the host with .venv-ingest first"
        )
    assert n > 0


def test_mark_candidates_finds_vision_candidates(pg):
    """AC-1. There should be at least one real vision candidate
    (png/jpeg that is NOT a drawio export, on a FY2425/FY2526 page)."""
    with pg.cursor() as cur:
        cur.execute(
            """
            SELECT COUNT(*) AS n
            FROM northstar.confluence_attachment ca
            JOIN northstar.confluence_page cp ON cp.page_id = ca.page_id
            WHERE ca.vision_candidate = TRUE
            """
        )
        n = cur.fetchone()["n"]
    if n == 0:
        pytest.skip(
            "no vision candidates yet — run scripts/mark_vision_candidates.py "
            "on the host with .venv-ingest first"
        )
    assert n > 0


def test_mark_candidates_derived_has_source_reference(pg):
    """AC-1. Every derived_source='drawio' row must have a
    non-null derived_source_att pointing at a real drawio row."""
    with pg.cursor() as cur:
        cur.execute(
            """
            SELECT ca.attachment_id, ca.derived_source_att
            FROM northstar.confluence_attachment ca
            WHERE ca.derived_source = 'drawio'
            LIMIT 20
            """
        )
        rows = cur.fetchall()
    if not rows:
        pytest.skip("no derived rows to check")
    for r in rows:
        assert r["derived_source_att"], (
            f"derived row {r['attachment_id']} has NULL derived_source_att"
        )
    # And the referenced drawio must exist
    att_ids = [r["derived_source_att"] for r in rows]
    with pg.cursor() as cur:
        cur.execute(
            """
            SELECT attachment_id, file_kind
            FROM northstar.confluence_attachment
            WHERE attachment_id = ANY(%s)
            """,
            (att_ids,),
        )
        found = {r["attachment_id"]: r["file_kind"] for r in cur.fetchall()}
    for aid in att_ids:
        assert aid in found, f"derived_source_att {aid} does not exist in confluence_attachment"
        assert found[aid] == "drawio", f"derived_source_att {aid} is not a drawio file"


# ---------------------------------------------------------------------------
# Phase 1: /vision-queue endpoint
# ---------------------------------------------------------------------------

async def test_vision_queue_endpoint(api: httpx.AsyncClient):
    """FR-6. Queue endpoint returns paginated rows."""
    resp = await api.get("/api/admin/confluence/vision-queue?limit=10")
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    data = body["data"]
    assert "rows" in data
    assert "total" in data
    if data["total"] == 0:
        pytest.skip("no candidates — mark_vision_candidates not yet run")
    assert len(data["rows"]) <= 10
    # Each row must carry enough context for the UI to render
    row0 = data["rows"][0]
    for required_field in ("attachment_id", "title", "page_id", "page_title", "fiscal_year", "file_size"):
        assert required_field in row0, f"vision-queue row missing {required_field}"


# ---------------------------------------------------------------------------
# Phase 1: /vision-extract endpoint — negative paths (don't need LLM)
# ---------------------------------------------------------------------------

async def test_vision_extract_unknown_id_404(api: httpx.AsyncClient):
    """AC equivalent of FR-8. Unknown attachment_id returns 404 not_found."""
    resp = await api.get(
        "/api/admin/confluence/attachments/9999999999999999/vision-extract",
    )
    assert resp.status_code == 404
    assert resp.json()["error"] == "not_found"


async def test_vision_extract_unsupported_format_415(api: httpx.AsyncClient, pg):
    """AC-4. An SVG (or any non-PNG/JPEG media_type) returns 415."""
    with pg.cursor() as cur:
        cur.execute(
            """
            SELECT attachment_id
            FROM northstar.confluence_attachment
            WHERE media_type = 'image/svg+xml' AND local_path IS NOT NULL
            LIMIT 1
            """
        )
        row = cur.fetchone()
    if not row:
        pytest.skip("no SVG attachment available for 415 test")
    resp = await api.get(
        f"/api/admin/confluence/attachments/{row['attachment_id']}/vision-extract",
    )
    assert resp.status_code == 415
    assert resp.json()["error"] == "unsupported_format"


async def test_vision_extract_file_missing_404(api: httpx.AsyncClient, pg):
    """AC-5. A row with local_path IS NULL returns 404 file_missing."""
    with pg.cursor() as cur:
        cur.execute(
            """
            SELECT attachment_id
            FROM northstar.confluence_attachment
            WHERE media_type IN ('image/png', 'image/jpeg')
              AND local_path IS NULL
            LIMIT 1
            """
        )
        row = cur.fetchone()
    if not row:
        pytest.skip("no PNG/JPEG attachment with local_path IS NULL")
    resp = await api.get(
        f"/api/admin/confluence/attachments/{row['attachment_id']}/vision-extract",
    )
    assert resp.status_code == 404
    assert resp.json()["error"] == "file_missing"


# ---------------------------------------------------------------------------
# Phase 1: happy-path vision extract (requires live LLM). Marked slow
# so contributors can opt out: pytest -m "not slow".
# ---------------------------------------------------------------------------

@pytest.mark.slow
async def test_vision_extract_happy_path(api: httpx.AsyncClient, pg):
    """AC-3. Given a real candidate PNG, the endpoint returns 200
    with the full schema + non-zero token counts. Skipped if LLM
    is not configured (503 llm_disabled is a sign to skip, not fail)."""
    with pg.cursor() as cur:
        cur.execute(
            """
            SELECT attachment_id, title
            FROM northstar.confluence_attachment
            WHERE media_type = 'image/png'
              AND vision_candidate = TRUE
              AND local_path IS NOT NULL
              AND file_size BETWEEN 50000 AND 2000000
            ORDER BY file_size ASC
            LIMIT 1
            """
        )
        row = cur.fetchone()
    if not row:
        pytest.skip("no small candidate PNG available")

    resp = await api.get(
        f"/api/admin/confluence/attachments/{row['attachment_id']}/vision-extract",
        timeout=130.0,
    )
    if resp.status_code == 503 and resp.json().get("error") == "llm_disabled":
        pytest.skip("LLM_ENABLED is false on this backend — expected on CI")
    assert resp.status_code == 200, f"unexpected status {resp.status_code}: {resp.text[:500]}"
    data = resp.json()
    # Schema sanity checks
    assert "diagram_type" in data
    assert data["diagram_type"] in ("app_arch", "tech_arch", "unknown")
    assert "applications" in data and isinstance(data["applications"], list)
    assert "interactions" in data and isinstance(data["interactions"], list)
    assert "tech_components" in data and isinstance(data["tech_components"], list)
    assert "meta" in data
    assert data["meta"]["total_tokens"] > 0
    assert data["meta"]["wall_ms"] > 0
    assert data["meta"]["model"]  # non-empty


# ---------------------------------------------------------------------------
# Unit test for the stem-matching helper (runs in-process, no DB)
# ---------------------------------------------------------------------------

def test_stem_matching_helper():
    """Critical dedup correctness: the same stem with different
    extensions must match regardless of case/whitespace. Imports
    the script function directly rather than running the binary."""
    repo_root = Path(__file__).resolve().parent.parent
    sys.path.insert(0, str(repo_root / "scripts"))
    try:
        from mark_vision_candidates import _stem_for_match  # type: ignore
    finally:
        sys.path.pop(0)

    # Exact match
    assert _stem_for_match("ADM TECH架构.png", "image") == _stem_for_match("ADM TECH架构.drawio", "drawio")
    # Case insensitive
    assert _stem_for_match("AWSP.PNG", "image") == _stem_for_match("awsp.drawio", "drawio")
    # Whitespace collapse
    assert _stem_for_match("app  arch.png", "image") == _stem_for_match("app arch.drawio", "drawio")
    # Do NOT collapse hyphens (semantic separator in Lenovo titles)
    assert _stem_for_match("adm-v1.png", "image") != _stem_for_match("adm-v2.drawio", "drawio")
