"""PR 3 step 3a acceptance test.

Traces to .specify/features/app-detail-redesign/plan.md §13 PR 3 §3a:
backend adds ``capability_count`` to the ``/api/graph/nodes/{app_id}``
response so the frontend ``AnswerBlock`` KPI row can show the count
without a second HTTP call.

The tests assert:
1. The field is always present on a 200 response (even when 0).
2. The value is a non-negative int.
3. The value MATCHES ``total_count`` returned by
   ``/api/apps/{app_id}/business-capabilities`` — the two endpoints must
   not diverge.

All tests target the live backend on 71 (no DB mocking).
"""
from __future__ import annotations

import pytest


# Anchor app: OLMS — the reference app the UI team designs against, and
# a confirmed CMDB-linked app with >=1 business capability binding.
APP_ANCHOR = "A002856"


@pytest.mark.asyncio
async def test_graph_node_response_has_capability_count(api):
    """FR: every 200 response from /api/graph/nodes/{app_id} includes the
    ``capability_count`` top-level field."""
    r = await api.get(f"/api/graph/nodes/{APP_ANCHOR}")
    assert r.status_code == 200
    j = r.json()
    assert j["success"] is True
    data = j["data"]
    assert "capability_count" in data, (
        f"Top-level 'capability_count' missing from graph node response; "
        f"keys={sorted(data.keys())}"
    )
    assert isinstance(data["capability_count"], int)
    assert data["capability_count"] >= 0


@pytest.mark.asyncio
async def test_capability_count_matches_business_capabilities_total(api):
    """FR: capability_count equals business-capabilities total_count.

    Both counts come from the same PG join
    (ref_app_business_capability JOIN ref_business_capability). Drift
    between them would confuse architects seeing one number in the KPI
    row and a different number in the Capabilities tab.
    """
    graph = await api.get(f"/api/graph/nodes/{APP_ANCHOR}")
    bc = await api.get(f"/api/apps/{APP_ANCHOR}/business-capabilities")
    assert graph.status_code == 200
    assert bc.status_code == 200
    graph_count = graph.json()["data"]["capability_count"]
    bc_total = bc.json()["data"]["total_count"]
    assert graph_count == bc_total, (
        f"KPI count drift: /api/graph/nodes/{APP_ANCHOR}.capability_count="
        f"{graph_count} vs /api/apps/{APP_ANCHOR}/business-capabilities."
        f"total_count={bc_total}"
    )


@pytest.mark.asyncio
async def test_capability_count_zero_for_unmapped_app(api):
    """FR: apps with no business-capability links return 0, not missing.

    Picks an app id that is extremely unlikely to have any capability
    mappings (random X-prefixed graph-only id, or a deep CMDB tail).
    If this test starts failing, the picked id became mapped — switch to
    another.
    """
    # A000004 — confirmed unmapped via `SELECT app_id FROM ref_application
    # WHERE app_id NOT IN (SELECT app_id FROM ref_app_business_capability)
    # AND status = 'Active'` as of 2026-04-19. If the BC mapping ever
    # grows to cover this app, pick another from that query.
    APP_UNMAPPED = "A000004"
    r = await api.get(f"/api/graph/nodes/{APP_UNMAPPED}")
    if r.status_code == 404:
        pytest.skip(f"App {APP_UNMAPPED} not in graph; pick another anchor")
    assert r.status_code == 200
    data = r.json()["data"]
    assert data["capability_count"] == 0
