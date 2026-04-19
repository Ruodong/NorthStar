"""Integration tests for /api/design/standard-templates.

FR-7 of architecture-template-settings/spec.md: the Design wizard
template picker must honor the `template_active` toggle maintained on
the Settings page. A diagram marked inactive must disappear from the
picker; flipping it back must re-surface it.

These tests hit the running backend + real Postgres (see conftest.py).
"""
from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_standard_templates_honors_template_active(api, pg):
    """Toggle template_active on a fixture attachment, verify it
    disappears from /api/design/standard-templates, and reappears when
    flipped back."""
    # Use the 'business' layer — spec says it starts unconfigured, so
    # we're free to repoint its confluence_page_id at a test page.
    with pg.cursor() as cur:
        cur.execute(
            "SELECT confluence_page_id FROM northstar.ref_architecture_template_source WHERE layer='business'"
        )
        original_page_id = cur.fetchone()["confluence_page_id"]

    try:
        with pg.cursor() as cur:
            # 1. Test page (registered as the BA layer's source)
            cur.execute(
                """
                INSERT INTO northstar.confluence_page
                    (page_id, fiscal_year, title, page_url, page_type, template_source_layer)
                VALUES
                    ('test-design-tmpl-page', NULL, 'Test BA template page',
                     'https://example/test-design-tmpl', 'ea_template', 'business')
                ON CONFLICT (page_id) DO UPDATE SET
                    page_type = EXCLUDED.page_type,
                    template_source_layer = EXCLUDED.template_source_layer
                """
            )
            # 2. Point the BA layer at our test page
            cur.execute(
                """
                UPDATE northstar.ref_architecture_template_source
                SET confluence_page_id = 'test-design-tmpl-page'
                WHERE layer = 'business'
                """
            )
            # 3. Three attachments: active, inactive, NULL (default visible)
            cur.execute(
                """
                INSERT INTO northstar.confluence_attachment
                    (attachment_id, page_id, title, media_type, file_kind, file_size,
                     version, download_path, template_source_layer, template_active)
                VALUES
                    ('test-design-tmpl-active',   'test-design-tmpl-page', 'BA-active.drawio',
                     'application/vnd.jgraph.mxfile', 'drawio', 100, 1,
                     '/download/attachments/test/BA-active.drawio', 'business', TRUE),
                    ('test-design-tmpl-inactive', 'test-design-tmpl-page', 'BA-inactive.drawio',
                     'application/vnd.jgraph.mxfile', 'drawio', 100, 1,
                     '/download/attachments/test/BA-inactive.drawio', 'business', FALSE),
                    ('test-design-tmpl-null',     'test-design-tmpl-page', 'BA-null.drawio',
                     'application/vnd.jgraph.mxfile', 'drawio', 100, 1,
                     '/download/attachments/test/BA-null.drawio', 'business', NULL)
                ON CONFLICT (attachment_id) DO UPDATE SET
                    page_id = EXCLUDED.page_id,
                    template_source_layer = EXCLUDED.template_source_layer,
                    template_active = EXCLUDED.template_active
                """
            )
        pg.commit()

        # --- Assertion 1: inactive is excluded, active + NULL are present ---
        r = await api.get("/api/design/standard-templates")
        assert r.status_code == 200, r.text
        ids = {t["attachment_id"] for t in r.json()["data"]["templates"]}
        assert "test-design-tmpl-active" in ids, "active diagram should be visible"
        assert "test-design-tmpl-null" in ids, "NULL template_active should default to visible"
        assert "test-design-tmpl-inactive" not in ids, (
            "template_active=FALSE must not appear in the Design wizard picker"
        )

        # --- Assertion 2: flipping inactive → active resurfaces it ---
        patch = await api.patch(
            "/api/settings/architecture-templates/diagrams/test-design-tmpl-inactive/active",
            params={"active": "true"},
        )
        assert patch.status_code == 200, patch.text

        r2 = await api.get("/api/design/standard-templates")
        assert r2.status_code == 200
        ids2 = {t["attachment_id"] for t in r2.json()["data"]["templates"]}
        assert "test-design-tmpl-inactive" in ids2, (
            "flipping template_active back to true must re-surface the diagram"
        )
    finally:
        with pg.cursor() as cur:
            cur.execute(
                """
                DELETE FROM northstar.confluence_attachment
                WHERE attachment_id IN (
                    'test-design-tmpl-active',
                    'test-design-tmpl-inactive',
                    'test-design-tmpl-null'
                )
                """
            )
            cur.execute(
                "DELETE FROM northstar.confluence_page WHERE page_id = 'test-design-tmpl-page'"
            )
            # Restore the BA layer's original confluence_page_id
            cur.execute(
                """
                UPDATE northstar.ref_architecture_template_source
                SET confluence_page_id = %s
                WHERE layer = 'business'
                """,
                (original_page_id,),
            )
        pg.commit()
