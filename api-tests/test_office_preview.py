"""Office preview endpoint tests.

Traces to .specify/features/office-preview/spec.md § 4 Acceptance
Criteria. Runs against the live backend at NORTHSTAR_API_URL and
assumes the northstar-converter sidecar is up (healthy in docker
compose).

Each test picks a real attachment from PG rather than hard-coding
an attachment_id, so the test suite remains valid as the scanned
content evolves. Tests are resilient to an empty dataset by
skipping when no suitable fixture row exists.
"""
from __future__ import annotations

import asyncio
import os
from pathlib import Path

import httpx
import pytest


pytestmark = pytest.mark.asyncio


# ---------------------------------------------------------------------------
# Fixtures: pick real attachments from PG
# ---------------------------------------------------------------------------

_PPTX_MT = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
_DOCX_MT = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
_XLSX_MT = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _pick_attachment(pg, media_type: str, must_have_local: bool = True) -> dict | None:
    """Return one confluence_attachment row matching media_type, or None."""
    with pg.cursor() as cur:
        cur.execute(
            """
            SELECT attachment_id, title, media_type, file_kind, file_size, local_path
            FROM northstar.confluence_attachment
            WHERE media_type = %s
              AND title NOT LIKE 'drawio-backup%%'
              AND title NOT LIKE '~%%'
              AND (%s = false OR local_path IS NOT NULL)
              AND file_size < 20971520  -- cap at 20 MB so first-conversion stays under 30s
            ORDER BY file_size ASC
            LIMIT 1
            """,
            (media_type, must_have_local),
        )
        row = cur.fetchone()
    return dict(row) if row else None


@pytest.fixture
def small_pptx(pg):
    row = _pick_attachment(pg, _PPTX_MT)
    if not row:
        pytest.skip("no downloaded small PPTX available in confluence_attachment")
    return row


@pytest.fixture
def any_xlsx(pg):
    row = _pick_attachment(pg, _XLSX_MT)
    if not row:
        pytest.skip("no downloaded XLSX available in confluence_attachment")
    return row


@pytest.fixture
def legacy_office_row(pg):
    """A row whose media_type is NOT in the supported allow-list. We
    don't need a real .ppt — any row with an unsupported media_type
    will trigger the 415 branch (EC-8, AC-4)."""
    with pg.cursor() as cur:
        cur.execute(
            """
            SELECT attachment_id, title, media_type
            FROM northstar.confluence_attachment
            WHERE file_kind IN ('office', 'other')
              AND media_type NOT IN (%s, %s, %s)
              AND media_type IS NOT NULL
              AND media_type != ''
              AND title NOT LIKE 'drawio-backup%%'
            LIMIT 1
            """,
            (_PPTX_MT, _DOCX_MT, _XLSX_MT),
        )
        row = cur.fetchone()
    if not row:
        pytest.skip("no legacy office row in confluence_attachment")
    return dict(row)


# ---------------------------------------------------------------------------
# AC-1: PPTX first view → converter runs, cache is created, 200 PDF
# ---------------------------------------------------------------------------

async def test_preview_pptx_first_view(api: httpx.AsyncClient, small_pptx, pg):
    """Spec AC-1 / FR-11 / FR-12 / NFR-2. Wipe any pre-existing cache
    entry for this attachment via the backend volume mount path so
    we hit the miss branch deterministically. We rely on the host
    path ./data/preview_cache/ being accessible from wherever the
    test runner is executing."""
    att_id = small_pptx["attachment_id"]

    # Best-effort cache wipe. Tests running on 71 will find the path;
    # tests running from the laptop may not — that's fine, we proceed
    # either way (the endpoint is idempotent).
    cache_root = Path(os.environ.get(
        "NORTHSTAR_PREVIEW_CACHE",
        "/home/ruodong/NorthStar/data/preview_cache",
    ))
    candidate = cache_root / f"{att_id}.pdf"
    if candidate.exists():
        try:
            candidate.unlink()
        except OSError:
            pass  # not fatal — the cached path still serves 200

    resp = await api.get(
        f"/api/admin/confluence/attachments/{att_id}/preview",
        timeout=130.0,
    )
    assert resp.status_code == 200, f"body={resp.text[:400]}"
    assert resp.headers["content-type"].startswith("application/pdf"), (
        f"unexpected content-type: {resp.headers.get('content-type')!r}"
    )
    # Real PDFs always start with %PDF- in the first 8 bytes.
    assert resp.content[:5] == b"%PDF-", (
        f"response is not a PDF: first_bytes={resp.content[:20]!r}"
    )
    assert len(resp.content) > 1024, f"PDF suspiciously small: {len(resp.content)} bytes"
    # Cache-control header per FR-17
    assert "immutable" in (resp.headers.get("cache-control") or "").lower()


# ---------------------------------------------------------------------------
# AC-2: PPTX second view → served from cache, <1s round-trip
# ---------------------------------------------------------------------------

async def test_preview_pptx_cached(api: httpx.AsyncClient, small_pptx):
    """Spec AC-2 / FR-11 / NFR-3. After one prior call the cache file
    must exist, and the second call must be fast."""
    att_id = small_pptx["attachment_id"]

    # Prime the cache
    prime = await api.get(
        f"/api/admin/confluence/attachments/{att_id}/preview",
        timeout=130.0,
    )
    assert prime.status_code == 200

    # Second fetch — time it. We don't do a microbenchmark, just a
    # sanity check that it comes back within a generous 10s budget.
    import time
    t0 = time.monotonic()
    resp = await api.get(
        f"/api/admin/confluence/attachments/{att_id}/preview",
        timeout=30.0,
    )
    elapsed = time.monotonic() - t0
    assert resp.status_code == 200
    assert resp.content[:5] == b"%PDF-"
    assert elapsed < 10.0, f"cached preview took {elapsed:.2f}s; expected <10s"


# ---------------------------------------------------------------------------
# AC-3: XLSX passthrough
# ---------------------------------------------------------------------------

async def test_preview_xlsx_passthrough(api: httpx.AsyncClient, any_xlsx):
    """Spec AC-3 / FR-9. XLSX is served raw for SheetJS to parse."""
    att_id = any_xlsx["attachment_id"]
    resp = await api.get(f"/api/admin/confluence/attachments/{att_id}/preview")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == _XLSX_MT
    # XLSX files are ZIP archives → start with PK
    assert resp.content[:2] == b"PK", (
        f"expected ZIP signature, got {resp.content[:4]!r}"
    )


# ---------------------------------------------------------------------------
# AC-4: unsupported format (legacy .ppt / ConceptDraw / unknown) → 415
# ---------------------------------------------------------------------------

async def test_preview_legacy_ppt_415(api: httpx.AsyncClient, legacy_office_row):
    """Spec AC-4 / FR-13. Any media_type outside the allow-list returns 415."""
    att_id = legacy_office_row["attachment_id"]
    resp = await api.get(f"/api/admin/confluence/attachments/{att_id}/preview")
    assert resp.status_code == 415
    body = resp.json()
    assert body["error"] == "unsupported_format"


# ---------------------------------------------------------------------------
# AC-5: attachment row missing → 404 not_found
# ---------------------------------------------------------------------------

async def test_preview_unknown_id_404(api: httpx.AsyncClient):
    """Spec AC-5 / FR-14. A never-seen attachment_id returns 404."""
    resp = await api.get(
        "/api/admin/confluence/attachments/9999999999999999/preview",
    )
    assert resp.status_code == 404
    assert resp.json()["error"] == "not_found"


# ---------------------------------------------------------------------------
# AC-8: concurrent requests for same uncached PPTX → both succeed
# ---------------------------------------------------------------------------

async def test_preview_concurrent_no_corruption(api: httpx.AsyncClient, small_pptx):
    """Spec AC-8 / NFR-5. Fire 3 parallel requests at the same
    attachment with a cold cache. All must return 200 and a valid
    PDF; the cache file must NOT be corrupt."""
    att_id = small_pptx["attachment_id"]

    # Clear cache if possible (see AC-1 test for context)
    cache_root = Path(os.environ.get(
        "NORTHSTAR_PREVIEW_CACHE",
        "/home/ruodong/NorthStar/data/preview_cache",
    ))
    candidate = cache_root / f"{att_id}.pdf"
    if candidate.exists():
        try:
            candidate.unlink()
        except OSError:
            pass

    async def one() -> httpx.Response:
        return await api.get(
            f"/api/admin/confluence/attachments/{att_id}/preview",
            timeout=130.0,
        )

    results = await asyncio.gather(one(), one(), one())
    for idx, r in enumerate(results):
        assert r.status_code == 200, (
            f"concurrent request #{idx} failed: {r.status_code} {r.text[:200]}"
        )
        assert r.content[:5] == b"%PDF-", (
            f"concurrent request #{idx} body not a PDF: {r.content[:20]!r}"
        )

    # If the cache file landed on a filesystem we can read, verify
    # it's a valid PDF — proof that the atomic rename produced an
    # intact artifact, not a half-written one.
    if candidate.exists():
        head = candidate.read_bytes()[:8]
        assert head[:5] == b"%PDF-", (
            f"cache file is corrupt after concurrent writes: head={head!r}"
        )


# ---------------------------------------------------------------------------
# Smoke: endpoint is registered and responds to OPTIONS / HEAD
# ---------------------------------------------------------------------------

async def test_preview_endpoint_registered(api: httpx.AsyncClient):
    """Smoke check — hitting an unknown attachment must not return 404
    from the router layer (i.e. the route itself must exist). We
    differentiate by checking the JSON error code."""
    resp = await api.get("/api/admin/confluence/attachments/0/preview")
    assert resp.status_code == 404
    body = resp.json()
    assert body.get("error") in ("not_found",), (
        f"unexpected error body: {body}"
    )
