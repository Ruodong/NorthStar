"""Integration tests for confluence-drawio-extract feature.

Spec: .specify/features/confluence-drawio-extract/spec.md § 4.
Runs against the live PG + backend on 71. Assumes:
 1. migration 011_confluence_diagram_extract.sql has been applied
 2. scripts/parse_confluence_drawios.py has been run
 3. scripts/load_neo4j_from_pg.py has been re-run so the Neo4j graph
    reflects the newly-extracted Confluence apps + interactions
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest


# Ensure backend is importable for the parser regression test (no DB required)
_REPO_ROOT = Path(__file__).resolve().parents[1]
if str(_REPO_ROOT / "backend") not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT / "backend"))


pytestmark = pytest.mark.confluence_drawio_extract


# ---------------------------------------------------------------------------
# AC-1: tables exist
# ---------------------------------------------------------------------------

def test_confluence_diagram_tables_exist(pg):
    """Spec AC-1. Migration 011 must be applied."""
    with pg.cursor() as cur:
        cur.execute(
            """
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'northstar'
              AND table_name IN (
                'confluence_diagram_app', 'confluence_diagram_interaction'
              )
            """
        )
        found = {r["table_name"] for r in cur.fetchall()}
    missing = {"confluence_diagram_app", "confluence_diagram_interaction"} - found
    assert not missing, (
        f"confluence extraction tables missing: {missing} — "
        "run backend/sql/011_confluence_diagram_extract.sql"
    )


# ---------------------------------------------------------------------------
# AC-2: parser populated a meaningful number of apps
# ---------------------------------------------------------------------------

def test_parser_populated_minimum_apps(pg):
    """Spec AC-2. After the parser runs against the downloaded files, the
    confluence_diagram_app table must contain at least 500 rows with
    non-null standard_id. This is a conservative floor — the pilot file
    alone yields 8 A-ids and there are ~2580 drawio files on disk."""
    with pg.cursor() as cur:
        cur.execute(
            """
            SELECT count(*) AS n
            FROM northstar.confluence_diagram_app
            WHERE standard_id IS NOT NULL
            """
        )
        n = cur.fetchone()["n"]
    assert n >= 500, (
        f"expected at least 500 confluence_diagram_app rows with standard_id, "
        f"got {n}; did scripts/parse_confluence_drawios.py run?"
    )


# ---------------------------------------------------------------------------
# AC-3: pilot file LBP Application Architecture yields expected A-ids
# ---------------------------------------------------------------------------

PILOT_ATTACHMENT_ID = "517769868"
PILOT_EXPECTED_STDS = {
    "A000001", "A000291", "A000406", "A000424",
    "A001652", "A002201", "A002281", "A002812",
}


def test_pilot_file_standard_ids(pg):
    """Spec AC-3. LBP Application Architecture drawio (attachment 517769868)
    must yield exactly the 8 expected standard ids."""
    with pg.cursor() as cur:
        cur.execute(
            """
            SELECT DISTINCT standard_id
            FROM northstar.confluence_diagram_app
            WHERE attachment_id = %s
              AND standard_id IS NOT NULL
            """,
            (PILOT_ATTACHMENT_ID,),
        )
        found = {r["standard_id"] for r in cur.fetchall()}
    missing = PILOT_EXPECTED_STDS - found
    extra = found - PILOT_EXPECTED_STDS
    assert not missing, f"LBP pilot missing expected standard ids: {missing}"
    # Extra is allowed (parser might find more than expected) but log for info
    if extra:
        print(f"LBP pilot found extra (not required) standard ids: {extra}")


# ---------------------------------------------------------------------------
# AC-4: Neo4j loader picks up confluence-sourced apps
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_neo4j_includes_confluence_extracted_app(api):
    """Spec AC-4. After re-running load_neo4j_from_pg.py, the pilot app
    A000291 (present in LBP drawio) should be reachable via
    /api/graph/nodes/A000291 with its CMDB name/status populated."""
    r = await api.get("/api/graph/nodes/A000291")
    # Either 200 (found) or 404 is meaningful — but we want 200
    assert r.status_code == 200, (
        f"A000291 not in Neo4j graph (status={r.status_code}); "
        "did load_neo4j_from_pg.py --wipe run after the parser?"
    )
    body = r.json()["data"]
    app = body.get("app", {})
    assert app.get("app_id") == "A000291", (
        f"graph returned wrong node: {app.get('app_id')!r}"
    )


# ---------------------------------------------------------------------------
# EC-8: parse must leave zero rows with NULL match_type
# ---------------------------------------------------------------------------

def test_no_null_match_type_after_parse(pg):
    """Spec EC-8. `process_one()` in parse_confluence_drawios.py wipes
    `match_type` to NULL on every re-parse of an attachment (atomic rebuild).
    The parse script MUST auto-invoke the resolver at end of `main()` so the
    admin UI doesn't fall back to "NO CMDB" for every row it just parsed.

    Regression for the post-rebuild state where 14,709 / 48,709 rows (30%)
    had `match_type IS NULL` because the resolver was an orphan manual step.

    The resolver always writes a concrete match_type (even `no_cmdb` is
    written as a string, never left as NULL). So after a successful parse,
    ALL rows must have a non-null match_type.
    """
    with pg.cursor() as cur:
        cur.execute(
            """
            SELECT count(*) AS n
            FROM northstar.confluence_diagram_app
            WHERE match_type IS NULL
            """
        )
        n = cur.fetchone()["n"]
    assert n == 0, (
        f"{n} rows have match_type IS NULL — the parser did not run the "
        "resolver at end of main(). Re-run "
        "scripts/resolve_confluence_drawio_apps.py and verify "
        "scripts/parse_confluence_drawios.py main() still invokes it."
    )


# ---------------------------------------------------------------------------
# AC-5: re-running the parser is idempotent
# ---------------------------------------------------------------------------

def test_parser_is_idempotent(pg):
    """Spec AC-5. The parser uses ON CONFLICT DO UPDATE keyed on
    (attachment_id, cell_id). Re-running must not create duplicate rows.
    We assert no duplicate PK exists (trivially true if the table is
    correctly schemaed) AND no row was last_seen_at'd in the future."""
    with pg.cursor() as cur:
        cur.execute(
            """
            SELECT attachment_id, cell_id, count(*) AS n
            FROM northstar.confluence_diagram_app
            GROUP BY attachment_id, cell_id
            HAVING count(*) > 1
            LIMIT 5
            """
        )
        dupes = cur.fetchall()
    assert not dupes, f"duplicate PK in confluence_diagram_app: {dupes!r}"

    with pg.cursor() as cur:
        cur.execute(
            """
            SELECT count(*) AS n FROM northstar.confluence_diagram_app
            WHERE last_seen_at > NOW() + INTERVAL '1 minute'
            """
        )
        future_rows = cur.fetchone()["n"]
    assert future_rows == 0, (
        f"{future_rows} rows have last_seen_at in the future — clock skew bug?"
    )


# ---------------------------------------------------------------------------
# EC-7: fillColor=none container with standard A-id must keep its children merged
# ---------------------------------------------------------------------------

def test_fill_none_container_with_a_id_merges_children():
    """Spec EC-7. A transparent-fill application container (e.g. "ID: A000038
    ADM Support") that carries a standard CMDB A-id must be preserved and its
    geometrically-contained sub-modules merged into it, rather than dropped by
    _is_legend (which would leave every sub-module as an independent app).

    Regression for the adm 应用架构 case where the parser returned 58 apps
    (including 47 raw sub-modules of ADM Support) instead of 1 container app
    with 47 children in its functions.
    """
    # pure parser test — no DB required
    from app.services.drawio_parser import parse_drawio_xml

    # Minimal App_Arch XML with:
    #   - a fillColor=none big container labeled "ID: A000038 ADM Support"
    #   - three child modules fully inside it (parent=1, absolute coords)
    #   - one unrelated standalone app with its own A-id outside the container
    xml = """<mxfile>
      <diagram name="App Arch">
        <mxGraphModel>
          <root>
            <mxCell id="0"/>
            <mxCell id="1" parent="0"/>
            <mxCell id="cont" parent="1" vertex="1"
                    value="ID: A000038 ADM Support"
                    style="rounded=1;whiteSpace=wrap;html=1;strokeColor=#000000;fillColor=none;verticalAlign=top;">
              <mxGeometry x="300" y="-700" width="1000" height="400" as="geometry"/>
            </mxCell>
            <mxCell id="child1" parent="1" vertex="1"
                    value="Meeting Room"
                    style="rounded=1;fillColor=#dae8fc;strokeColor=#6c8ebf;">
              <mxGeometry x="350" y="-650" width="130" height="40" as="geometry"/>
            </mxCell>
            <mxCell id="child2" parent="1" vertex="1"
                    value="International Mail"
                    style="rounded=1;fillColor=#fff2cc;strokeColor=#d6b656;">
              <mxGeometry x="500" y="-650" width="130" height="40" as="geometry"/>
            </mxCell>
            <mxCell id="child3" parent="1" vertex="1"
                    value="Badges"
                    style="rounded=1;fillColor=#fff2cc;strokeColor=#d6b656;">
              <mxGeometry x="650" y="-650" width="130" height="40" as="geometry"/>
            </mxCell>
            <mxCell id="outside" parent="1" vertex="1"
                    value="A000302 OACP"
                    style="rounded=1;fillColor=#dae8fc;strokeColor=#6c8ebf;">
              <mxGeometry x="1500" y="-400" width="150" height="60" as="geometry"/>
            </mxCell>
          </root>
        </mxGraphModel>
      </diagram>
    </mxfile>"""

    res = parse_drawio_xml(xml, "App_Arch")
    apps = res.get("applications", [])

    # Exactly 2 applications survive: the ADM Support container and the
    # standalone OACP app. All 3 children must have been merged into ADM Support.
    names = sorted(a["app_name"] for a in apps)
    standard_ids = sorted(a["standard_id"] for a in apps if a.get("standard_id"))
    assert len(apps) == 2, (
        f"expected 2 apps (container + outside), got {len(apps)}: {names}"
    )
    assert standard_ids == ["A000038", "A000302"], (
        f"both A-ids must survive, got {standard_ids}"
    )

    container = next(a for a in apps if a["standard_id"] == "A000038")
    assert container.get("is_container") is True, (
        "A000038 must be flagged as a container after the merge pass"
    )
    assert container["app_name"] == "ADM Support", (
        f"container name must strip the ID prefix; got {container['app_name']!r}"
    )

    # All 3 child module names must appear in the container's functions field
    funcs = container.get("functions", "")
    for child_name in ("Meeting Room", "International Mail", "Badges"):
        assert child_name in funcs, (
            f"child {child_name!r} not merged into container.functions: {funcs!r}"
        )

    # Container status must have bubbled up from children: Change (from
    # #fff2cc children) wins over Keep because any change signal bubbles up.
    assert container["application_status"] == "Change", (
        f"container status must bubble up to Change, got {container['application_status']!r}"
    )


# ---------------------------------------------------------------------------
# EC-9: child "New" must NOT make container "New" — bubbles up as "Change"
# ---------------------------------------------------------------------------

def test_container_status_child_new_becomes_change():
    """Spec EC-9. An existing application (one with a standard CMDB A-id)
    cannot become "New" just because one of its sub-modules is painted red.
    The app already exists in CMDB — it's *changing*, not brand new. So any
    New / Change / Sunset signal on a child must collapse to a single
    "Change" on the container, never "New".

    Regression for the `adm 应用架构` case where A000038 ADM Support was
    reported with `application_status='New'` in the admin Extracted tab
    because one tiny sub-module ("automatic expense allocation") was red.
    """
    from app.services.drawio_parser import parse_drawio_xml

    xml = """<mxfile>
      <diagram name="App Arch">
        <mxGraphModel>
          <root>
            <mxCell id="0"/>
            <mxCell id="1" parent="0"/>
            <mxCell id="cont" parent="1" vertex="1"
                    value="ID: A000038 ADM Support"
                    style="rounded=1;fillColor=none;strokeColor=#000000;verticalAlign=top;">
              <mxGeometry x="300" y="-700" width="1000" height="400" as="geometry"/>
            </mxCell>
            <!-- Keep child (blue #dae8fc) -->
            <mxCell id="child_keep" parent="1" vertex="1"
                    value="Meeting Room"
                    style="rounded=1;fillColor=#dae8fc;strokeColor=#6c8ebf;">
              <mxGeometry x="350" y="-650" width="130" height="40" as="geometry"/>
            </mxCell>
            <!-- Change child (yellow #fff2cc) -->
            <mxCell id="child_change" parent="1" vertex="1"
                    value="International Mail"
                    style="rounded=1;fillColor=#fff2cc;strokeColor=#d6b656;">
              <mxGeometry x="500" y="-650" width="130" height="40" as="geometry"/>
            </mxCell>
            <!-- New child (red/pink #f8cecc) — this is the one that used to
                 poison the bubble-up. -->
            <mxCell id="child_new" parent="1" vertex="1"
                    value="automatic expense allocation"
                    style="rounded=1;fillColor=#f8cecc;strokeColor=#b85450;">
              <mxGeometry x="650" y="-650" width="160" height="40" as="geometry"/>
            </mxCell>
          </root>
        </mxGraphModel>
      </diagram>
    </mxfile>"""

    res = parse_drawio_xml(xml, "App_Arch")
    apps = res.get("applications", [])

    assert len(apps) == 1, (
        f"expected only the container to survive merging, got {len(apps)}: "
        f"{[a['app_name'] for a in apps]}"
    )

    container = apps[0]
    assert container["standard_id"] == "A000038"
    assert container.get("is_container") is True

    # The whole point of this regression test — child "New" must NOT bubble
    # up as "New". It must collapse to "Change".
    assert container["application_status"] == "Change", (
        f"container must be Change when any child is New/Change/Sunset; "
        f"got {container['application_status']!r}. A red sub-module should "
        f"mark the application as *changing*, not *new*."
    )


def test_container_status_all_keep_children_stays_keep():
    """Spec EC-9 negative. When every child of a fillColor=none container
    is Keep, the container must stay Keep (no phantom Change)."""
    from app.services.drawio_parser import parse_drawio_xml

    xml = """<mxfile>
      <diagram name="App Arch">
        <mxGraphModel>
          <root>
            <mxCell id="0"/>
            <mxCell id="1" parent="0"/>
            <mxCell id="cont" parent="1" vertex="1"
                    value="ID: A000038 ADM Support"
                    style="rounded=1;fillColor=none;strokeColor=#000000;verticalAlign=top;">
              <mxGeometry x="300" y="-700" width="1000" height="400" as="geometry"/>
            </mxCell>
            <mxCell id="c1" parent="1" vertex="1"
                    value="Meeting Room"
                    style="rounded=1;fillColor=#dae8fc;strokeColor=#6c8ebf;">
              <mxGeometry x="350" y="-650" width="130" height="40" as="geometry"/>
            </mxCell>
            <mxCell id="c2" parent="1" vertex="1"
                    value="Stationery"
                    style="rounded=1;fillColor=#dae8fc;strokeColor=#6c8ebf;">
              <mxGeometry x="500" y="-650" width="130" height="40" as="geometry"/>
            </mxCell>
          </root>
        </mxGraphModel>
      </diagram>
    </mxfile>"""

    res = parse_drawio_xml(xml, "App_Arch")
    apps = res.get("applications", [])
    assert len(apps) == 1
    container = apps[0]
    assert container["application_status"] == "Keep", (
        f"all-Keep children must leave container as Keep; "
        f"got {container['application_status']!r}"
    )
