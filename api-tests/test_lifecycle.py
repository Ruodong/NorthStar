"""Tests for /api/masters/applications/{app_id}/lifecycle.

Spec: .specify/features/lifecycle-change/spec.md

Data assumptions: A000298 (Sales Portal big brother) has many Change/New
entries across FY2526 projects — it's picked because its presence is
stable across sync cycles. See the spec for how the fixture app was
chosen. A000301 (PCAP) is the "no lifecycle entries" control.
"""
from __future__ import annotations

import pytest


pytestmark = pytest.mark.asyncio


async def test_lifecycle_returns_dated_entries_sorted(api):
    """AC-1 + AC-4: entries sorted DESC by go_live_date, NULLs last."""
    r = await api.get("/api/masters/applications/A000298/lifecycle")
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    data = body["data"]
    assert data["app_id"] == "A000298"
    entries = data["entries"]
    assert isinstance(entries, list)
    assert len(entries) > 0, "A000298 should have at least one lifecycle entry"

    # Schema shape
    for e in entries:
        assert set(e.keys()) == {
            "project_id", "project_name", "go_live_date",
            "fiscal_year", "status", "change_description",
        }
        assert e["status"] in ("Change", "New", "Sunset")

    # Sort: dated DESC then NULLs last
    dated = [e for e in entries if e["go_live_date"]]
    undated = [e for e in entries if not e["go_live_date"]]
    assert entries == dated + undated, "undated entries must come after dated ones"
    # Dated subset is monotonically non-increasing by string (ISO dates compare OK)
    for a, b in zip(dated, dated[1:]):
        assert a["go_live_date"] >= b["go_live_date"]


async def test_lifecycle_dedupes_per_project(api):
    """AC-2: one entry per (project_id, status), even when an app appears
    in multiple diagrams of the same project.
    """
    r = await api.get("/api/masters/applications/A000298/lifecycle")
    assert r.status_code == 200
    entries = r.json()["data"]["entries"]
    keys = [(e["project_id"], e["status"]) for e in entries]
    assert len(keys) == len(set(keys)), (
        f"duplicate (project_id, status) in response: "
        f"{[k for k in keys if keys.count(k) > 1]}"
    )


async def test_lifecycle_empty_entries_not_404(api):
    """AC-3: a valid app with no Change/New/Sunset → 200 + empty list, NOT 404."""
    # A000301 = PCAP. Verified by hand during feature scoping: no major-app entries.
    r = await api.get("/api/masters/applications/A000301/lifecycle")
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    assert body["data"]["app_id"] == "A000301"
    assert body["data"]["entries"] == []


async def test_lifecycle_404_on_unknown_app(api):
    """AC-5: unknown app_id → 404, not 200+empty."""
    r = await api.get("/api/masters/applications/Z999999NOTANAPP/lifecycle")
    assert r.status_code == 404


async def test_lifecycle_excludes_keep_status(api, pg):
    """EC-6: Keep-status rows must never surface as lifecycle entries.

    Pick any app that has *only* Keep entries in confluence_diagram_app
    and confirm its lifecycle endpoint returns [].
    """
    with pg.cursor() as cur:
        cur.execute(
            """
            SELECT COALESCE(cda.resolved_app_id, cda.standard_id) AS app_id
            FROM northstar.confluence_diagram_app cda
            JOIN northstar.ref_application ra
              ON ra.app_id = COALESCE(cda.resolved_app_id, cda.standard_id)
            WHERE COALESCE(cda.resolved_app_id, cda.standard_id) ~ '^A\\d'
            GROUP BY COALESCE(cda.resolved_app_id, cda.standard_id)
            HAVING bool_and(cda.application_status = 'Keep')
            LIMIT 1
            """
        )
        row = cur.fetchone()
    if row is None:
        pytest.skip("No Keep-only app in current dataset; EC-6 not reproducible")
    app_id = row["app_id"]

    r = await api.get(f"/api/masters/applications/{app_id}/lifecycle")
    assert r.status_code == 200
    entries = r.json()["data"]["entries"]
    assert entries == [], (
        f"{app_id} has only Keep rows in confluence_diagram_app "
        f"but lifecycle returned {len(entries)} entries"
    )
