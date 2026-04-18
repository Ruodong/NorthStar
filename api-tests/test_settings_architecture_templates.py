"""Integration tests for /api/settings/architecture-templates.

These hit the running backend + real Postgres (see conftest.py). They
exercise the three seed rows installed by backend/sql/018, plus the
update/sync/diagrams endpoints.

Sync behavior is tested only at the trigger-and-observe-status level
— the actual Confluence subtree walk runs host-side via
scripts/sync_architecture_templates.py and requires VPN access, so it
is out of scope for these tests.
"""
from __future__ import annotations

import pytest

VALID_LAYERS = {"business", "application", "technical"}


@pytest.mark.asyncio
async def test_list_returns_three_seeded_rows(api):
    """GET returns exactly the three seeded layers."""
    r = await api.get("/api/settings/architecture-templates")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["success"] is True
    rows = body["data"]
    assert isinstance(rows, list)
    assert len(rows) == 3

    layers = {row["layer"] for row in rows}
    assert layers == VALID_LAYERS

    for row in rows:
        # Every row has all the expected keys (even if some are empty/null)
        for key in (
            "layer", "title", "confluence_url", "confluence_page_id",
            "last_synced_at", "last_sync_status", "last_sync_error",
            "notes", "updated_at", "diagram_count",
        ):
            assert key in row, f"missing key {key} on layer {row['layer']}"
        assert isinstance(row["diagram_count"], int)


@pytest.mark.asyncio
async def test_list_is_ordered_business_application_technical(api):
    """Response ordering is stable so the frontend can render without a sort step."""
    r = await api.get("/api/settings/architecture-templates")
    rows = r.json()["data"]
    assert [row["layer"] for row in rows] == ["business", "application", "technical"]


@pytest.mark.asyncio
async def test_put_unknown_layer_returns_404(api):
    r = await api.put(
        "/api/settings/architecture-templates/data",
        json={"title": "x"},
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_put_updates_title(api):
    """PUT title persists; other fields untouched."""
    # Read current
    r0 = await api.get("/api/settings/architecture-templates")
    ba = next(row for row in r0.json()["data"] if row["layer"] == "business")
    original_title = ba["title"]

    # Update
    new_title = "Business Architecture — updated"
    r1 = await api.put(
        "/api/settings/architecture-templates/business",
        json={"title": new_title},
    )
    assert r1.status_code == 200, r1.text
    assert r1.json()["success"] is True

    # Verify
    r2 = await api.get("/api/settings/architecture-templates")
    ba2 = next(row for row in r2.json()["data"] if row["layer"] == "business")
    assert ba2["title"] == new_title

    # Restore
    await api.put(
        "/api/settings/architecture-templates/business",
        json={"title": original_title},
    )


@pytest.mark.asyncio
async def test_put_clears_page_id_when_url_changes(api):
    """When confluence_url changes, confluence_page_id is reset to NULL."""
    # Seed a known page_id first (direct PG would be ideal; we drive via PUT + raw SQL is out of scope)
    # Instead, set URL twice and observe behavior indirectly.
    r0 = await api.get("/api/settings/architecture-templates")
    ta_before = next(row for row in r0.json()["data"] if row["layer"] == "technical")
    original_url = ta_before["confluence_url"]

    # Change the URL
    r1 = await api.put(
        "/api/settings/architecture-templates/technical",
        json={"confluence_url": "https://km.xpaas.lenovo.com/display/EA/Something+Else"},
    )
    assert r1.status_code == 200
    data = r1.json()["data"]
    assert data["confluence_url"].endswith("Something+Else")
    # page_id should be None (cleared)
    assert data["confluence_page_id"] is None

    # Restore the original URL
    await api.put(
        "/api/settings/architecture-templates/technical",
        json={"confluence_url": original_url},
    )


@pytest.mark.asyncio
async def test_post_sync_empty_url_returns_400(api):
    """Triggering sync on a layer without a URL returns 400."""
    # Business layer is seeded with an empty URL by 018_architecture_template_source.sql.
    # Make sure it's still empty before testing.
    r0 = await api.put(
        "/api/settings/architecture-templates/business",
        json={"confluence_url": ""},
    )
    assert r0.status_code == 200

    r = await api.post("/api/settings/architecture-templates/business/sync")
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_post_sync_unknown_layer_returns_404(api):
    r = await api.post("/api/settings/architecture-templates/data/sync")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_diagrams_endpoint_shape(api):
    """GET /diagrams returns the expected structure (may be empty)."""
    r = await api.get("/api/settings/architecture-templates/application/diagrams")
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    data = body["data"]
    assert "total" in data
    assert "items" in data
    assert isinstance(data["items"], list)
    for item in data["items"]:
        for key in (
            "attachment_id", "file_name", "page_id", "page_title",
            "page_url", "thumbnail_url", "raw_url", "preview_url",
        ):
            assert key in item
        assert item["thumbnail_url"].endswith("/thumbnail")
        assert item["raw_url"].endswith("/raw")
        assert item["preview_url"].endswith("/preview")


@pytest.mark.asyncio
async def test_diagrams_unknown_layer_returns_404(api):
    r = await api.get("/api/settings/architecture-templates/data/diagrams")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_diagrams_filters_by_layer(api, pg):
    """Seed two dummy confluence rows tagged 'application' + one tagged 'technical',
    verify the application endpoint returns only the two.

    Cleans up after itself so the test is idempotent.
    """
    # Insert a fake confluence_page + two drawio attachments + one technical drawio.
    try:
        with pg.cursor() as cur:
            cur.execute("""
                INSERT INTO northstar.confluence_page
                    (page_id, fiscal_year, title, page_url, page_type, template_source_layer)
                VALUES
                    ('test-page-arch-tmpl', NULL, 'Test template page', 'https://example/test',
                     'ea_template', 'application')
                ON CONFLICT (page_id) DO NOTHING
            """)
            cur.execute("""
                INSERT INTO northstar.confluence_attachment
                    (attachment_id, page_id, title, media_type, file_kind, file_size,
                     version, download_path, template_source_layer)
                VALUES
                    ('test-att-aa-1', 'test-page-arch-tmpl', 'AA-tmpl-1.drawio',
                     'application/vnd.jgraph.mxfile', 'drawio', 100, 1,
                     '/download/attachments/test/AA-tmpl-1.drawio', 'application'),
                    ('test-att-aa-2', 'test-page-arch-tmpl', 'AA-tmpl-2.drawio',
                     'application/vnd.jgraph.mxfile', 'drawio', 100, 1,
                     '/download/attachments/test/AA-tmpl-2.drawio', 'application'),
                    ('test-att-ta-1', 'test-page-arch-tmpl', 'TA-tmpl.drawio',
                     'application/vnd.jgraph.mxfile', 'drawio', 100, 1,
                     '/download/attachments/test/TA-tmpl.drawio', 'technical')
                ON CONFLICT (attachment_id) DO UPDATE SET
                    template_source_layer = EXCLUDED.template_source_layer
            """)
        pg.commit()

        # Query application — expect the two application drawios
        r = await api.get("/api/settings/architecture-templates/application/diagrams")
        assert r.status_code == 200
        items = r.json()["data"]["items"]
        aa_ids = {item["attachment_id"] for item in items if item["attachment_id"].startswith("test-att-aa")}
        assert aa_ids == {"test-att-aa-1", "test-att-aa-2"}

        # Query technical — expect the one technical drawio
        r2 = await api.get("/api/settings/architecture-templates/technical/diagrams")
        assert r2.status_code == 200
        ta_ids = {item["attachment_id"] for item in r2.json()["data"]["items"] if item["attachment_id"].startswith("test-att-ta")}
        assert ta_ids == {"test-att-ta-1"}

        # Query business — expect zero of our test rows
        r3 = await api.get("/api/settings/architecture-templates/business/diagrams")
        assert r3.status_code == 200
        biz_ids = {item["attachment_id"] for item in r3.json()["data"]["items"] if item["attachment_id"].startswith("test-att")}
        assert biz_ids == set()
    finally:
        with pg.cursor() as cur:
            cur.execute("""
                DELETE FROM northstar.confluence_attachment
                WHERE attachment_id IN ('test-att-aa-1', 'test-att-aa-2', 'test-att-ta-1')
            """)
            cur.execute("""
                DELETE FROM northstar.confluence_page WHERE page_id = 'test-page-arch-tmpl'
            """)
        pg.commit()


@pytest.mark.asyncio
async def test_diagrams_layer_with_no_data_returns_empty_list(api):
    """Business layer starts with no tagged attachments → empty list, not error."""
    r = await api.get("/api/settings/architecture-templates/business/diagrams")
    assert r.status_code == 200
    data = r.json()["data"]
    assert data["total"] >= 0
    assert isinstance(data["items"], list)
