"""Unit tests for backend/app/services/design_generator.py.

These are pure-Python tests — no DB, no HTTP. They import the generator
and exercise `generate_as_is_xml` + the helpers directly. Kept in
api-tests/ because that's where the project's test harness already lives.

Coverage matches `.specify/features/design-hub-spoke-generator/spec.md`
§Acceptance Criteria and §Test Coverage.
"""
from __future__ import annotations

import math
import re
import sys
from pathlib import Path
from xml.etree import ElementTree as ET

import pytest

# api-tests/ is pytest's rootdir, so `backend` isn't on sys.path. Inject
# the repo root so we can import the generator as a normal module.
_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from backend.app.services.design_generator import (  # noqa: E402
    _detect_legend_region,
    _strip_non_legend_cells,
    generate_as_is_xml,
)


# ── fixture builders ─────────────────────────────────────────────


def _mk_cell(cell_id: str, x: float, y: float, w: float = 120, h: float = 60, value: str = "", style: str = "rounded=1;") -> str:
    return (
        f'<mxCell id="{cell_id}" value="{value}" style="{style}" vertex="1" parent="1">'
        f'<mxGeometry x="{x}" y="{y}" width="{w}" height="{h}" as="geometry"/>'
        f'</mxCell>'
    )


def _wrap_template(cells_xml: str) -> str:
    return f"""<mxfile host="test" type="design" version="24.0.0">
  <diagram name="Page-1" id="p1">
    <mxGraphModel dx="1400" dy="900" grid="1" pageWidth="1600" pageHeight="1100">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        {cells_xml}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>"""


def _ea_style_template() -> str:
    """Approximates an EA template: 4 legend cards on a top row, plus a
    template body with placeholder central system + surrounds."""
    # Legend row: 4 cards at y=40
    legend = "\n".join([
        _mk_cell("L1", x=40,  y=40, w=140, h=90, value="ID: A000547 / LSCS"),
        _mk_cell("L2", x=200, y=40, w=140, h=90, value="ID: A000550 / D365 Sales"),
        _mk_cell("L3", x=360, y=40, w=140, h=90, value="ID: A000334 / SDMS"),
        _mk_cell("L4", x=520, y=40, w=140, h=90, value="ID: A001823 / LeOps-iMonitoring"),
    ])
    # Template body: central system + two role boxes + two surround apps at y>=400
    body = "\n".join([
        _mk_cell("B1", x=400, y=400, w=200, h=100, value="XXXXXX System Name"),
        _mk_cell("B2", x=200, y=600, w=160, h=70, value="CPM"),
        _mk_cell("B3", x=640, y=600, w=160, h=70, value="LBP-I"),
    ])
    return _wrap_template(legend + "\n" + body)


def _parse_graph_root(xml_text: str) -> ET.Element:
    root = ET.fromstring(xml_text)
    gr = None
    for gm in root.iter("mxGraphModel"):
        gr = gm.find("root")
        break
    assert gr is not None
    return gr


# ── _detect_legend_region ─────────────────────────────────────────


def test_detect_legend_on_ea_template():
    graph_root = _parse_graph_root(_ea_style_template())
    region = _detect_legend_region(graph_root)
    assert region is not None
    xmin, ymin, xmax, ymax = region
    # Legend cards span x=40..660, y=40..130 (padded ±20)
    assert xmin <= 40 and xmax >= 660
    assert ymin <= 40 and 110 < ymax < 200, f"Legend ymax {ymax} should not extend into the body (which starts at y=400)"


def test_detect_legend_none_for_blank():
    graph_root = _parse_graph_root(_wrap_template(""))
    assert _detect_legend_region(graph_root) is None


def test_detect_legend_none_when_too_few_cells():
    # Two cells in top-band shouldn't trigger; need ≥ 3
    cells = _mk_cell("A", 40, 40) + _mk_cell("B", 200, 40)
    graph_root = _parse_graph_root(_wrap_template(cells))
    assert _detect_legend_region(graph_root) is None


def test_detect_legend_marker_with_parent_group():
    """A cell labeled 'Legend' whose drawio parent is a group uses the
    group's bbox + all sibling children, regardless of where on the
    canvas it lives."""
    cells = (
        # The group container itself (big rectangle)
        '<mxCell id="leg_grp" value="" style="group" vertex="1" parent="1">'
        '<mxGeometry x="800" y="700" width="400" height="200" as="geometry"/>'
        '</mxCell>'
        # The "Legend" label, child of the group
        + '<mxCell id="leg_label" value="&lt;b&gt;Legend&lt;/b&gt;" '
          'style="text;" vertex="1" parent="leg_grp">'
          '<mxGeometry x="10" y="10" width="80" height="20" as="geometry"/>'
          '</mxCell>'
        # A card inside the group
        + '<mxCell id="leg_card" value="Example A" style="rounded=1;" '
          'vertex="1" parent="leg_grp">'
          '<mxGeometry x="10" y="40" width="120" height="80" as="geometry"/>'
          '</mxCell>'
        # Unrelated body cell far away — should NOT be in the region
        + _mk_cell("body", x=100, y=100, w=200, h=80, value="Body")
    )
    graph_root = _parse_graph_root(_wrap_template(cells))
    region = _detect_legend_region(graph_root)
    assert region is not None
    xmin, ymin, xmax, ymax = region
    # Legend region should cover the group (800..1200, 700..900)
    assert xmin <= 800 and xmax >= 1200
    assert ymin <= 700 and ymax >= 900
    # Must NOT cover the body cell at (100,100)
    assert not (xmin <= 100 <= xmax and ymin <= 100 <= ymax), \
        "Legend region must not wrap the unrelated body cell"


def test_detect_legend_marker_with_geometric_container():
    """A 'Legend' text cell with no explicit parent group falls through
    to geometric-containment detection: the smallest vertex bbox that
    contains the marker becomes the Legend region."""
    cells = (
        # Big outer rectangle, no children via parent attr
        _mk_cell("outer", x=100, y=100, w=500, h=300, value="", style="rounded=0;")
        # A "Legend" sticky inside the outer rectangle (bbox-wise)
        + _mk_cell("sticky", x=120, y=120, w=100, h=30, value="Legend", style="text;")
        # Another card inside the outer rectangle — should be protected too
        + _mk_cell("card", x=250, y=150, w=120, h=80, value="Example")
        # Body cell, well outside, at (800, 800)
        + _mk_cell("body", x=800, y=800, w=200, h=80, value="Body")
    )
    graph_root = _parse_graph_root(_wrap_template(cells))
    region = _detect_legend_region(graph_root)
    assert region is not None
    xmin, ymin, xmax, ymax = region
    # Region must contain the full outer rect (100..600, 100..400)
    assert xmin <= 100 and xmax >= 600
    assert ymin <= 100 and ymax >= 400
    # Must NOT cover the body cell at (800,800)
    assert xmax < 800 or ymax < 800


def test_marker_box_and_contents_protected_during_generate():
    """End-to-end: a box with 'Legend' text + its inner objects survive
    generate_as_is_xml; the body cell does not."""
    tpl = _wrap_template(
        _mk_cell("outer", x=100, y=100, w=500, h=300, value="", style="rounded=0;")
        + _mk_cell("sticky", x=120, y=120, w=100, h=30, value="Legend")
        + _mk_cell("inner1", x=250, y=150, w=120, h=80, value="IceA")
        + _mk_cell("inner2", x=400, y=150, w=120, h=80, value="IceB")
        + _mk_cell("body", x=800, y=800, w=200, h=80, value="Body")
    )
    out = generate_as_is_xml(
        tpl, [_app("M1", "Major", role="major")], [],
    )
    graph_root = _parse_graph_root(out)
    ids = {c.get("id") for c in graph_root.iter("mxCell")}
    assert {"outer", "sticky", "inner1", "inner2"} <= ids, \
        "all cells inside the Legend box must be preserved"
    assert "body" not in ids, "cell outside the Legend box must be cleared"


def test_detect_legend_top_band_needs_body_below():
    """The top-band heuristic only fires when there's non-legend content
    below it. A template whose ONLY cells are legend-row cells returns
    None — because nothing below means nothing to contrast against."""
    legend_only = (
        _mk_cell("LT", x=20, y=20, w=100, h=30, value="Legend", style="text;")
        + _mk_cell("LC1", x=20, y=60, w=120, h=80, value="A000547")
        + _mk_cell("LC2", x=160, y=60, w=120, h=80, value="A000550")
    )
    assert _detect_legend_region(_parse_graph_root(_wrap_template(legend_only))) is None

    # Now add a body cell well below; top-band heuristic should fire.
    with_body = legend_only + _mk_cell("B1", x=100, y=500, w=200, h=100, value="Body")
    assert _detect_legend_region(_parse_graph_root(_wrap_template(with_body))) is not None


# ── _strip_non_legend_cells ───────────────────────────────────────


def test_strip_keeps_legend_and_removes_body():
    graph_root = _parse_graph_root(_ea_style_template())
    region = _detect_legend_region(graph_root)
    assert region is not None
    _strip_non_legend_cells(graph_root, region)

    ids = {c.get("id") for c in graph_root.iter("mxCell")}
    assert {"0", "1", "L1", "L2", "L3", "L4"} <= ids
    assert "B1" not in ids and "B2" not in ids and "B3" not in ids


def test_strip_with_no_legend_removes_everything_non_sentinel():
    graph_root = _parse_graph_root(_ea_style_template())
    _strip_non_legend_cells(graph_root, None)
    ids = {c.get("id") for c in graph_root.iter("mxCell")}
    assert ids == {"0", "1"}


# ── generate_as_is_xml end-to-end ────────────────────────────────


def _app(app_id: str, name: str, role: str = "surround", status: str = "keep") -> dict:
    return {"app_id": app_id, "name": name, "role": role, "planned_status": status}


def _iface(src: str, tgt: str, platform: str = "APIH") -> dict:
    return {
        "from_app": src, "to_app": tgt,
        "platform": platform, "interface_name": "test",
        "planned_status": "change",
    }


def test_legend_preserved_byte_for_byte():
    """Every Legend cell's (x, y, value, style) equals input."""
    tpl = _ea_style_template()
    src_graph = _parse_graph_root(tpl)
    src_legend = {
        c.get("id"): (
            c.get("value"),
            c.get("style"),
            c.find("mxGeometry").get("x") if c.find("mxGeometry") is not None else None,
            c.find("mxGeometry").get("y") if c.find("mxGeometry") is not None else None,
        )
        for c in src_graph.iter("mxCell")
        if c.get("id") in ("L1", "L2", "L3", "L4")
    }

    out = generate_as_is_xml(tpl, [_app("A1", "Major", role="major")], [])
    out_graph = _parse_graph_root(out)
    out_legend = {
        c.get("id"): (
            c.get("value"),
            c.get("style"),
            c.find("mxGeometry").get("x") if c.find("mxGeometry") is not None else None,
            c.find("mxGeometry").get("y") if c.find("mxGeometry") is not None else None,
        )
        for c in out_graph.iter("mxCell")
        if c.get("id") in ("L1", "L2", "L3", "L4")
    }
    assert src_legend == out_legend, "Legend cells must be byte-for-byte preserved"


def test_hub_and_spoke_one_major_three_surrounds():
    tpl = _ea_style_template()
    apps = [
        _app("M1", "Major", role="major", status="change"),
        _app("S1", "SurroundA", role="surround"),
        _app("S2", "SurroundB", role="surround"),
        _app("S3", "SurroundC", role="surround"),
    ]
    out = generate_as_is_xml(tpl, apps, [])
    graph_root = _parse_graph_root(out)

    # 4 new app cells + 4 legend cells + 2 sentinels
    vertex_cells = [c for c in graph_root.iter("mxCell") if c.get("vertex") == "1"]
    new_cells = [c for c in vertex_cells if c.get("id") not in ("L1", "L2", "L3", "L4")]
    assert len(new_cells) == 4

    # Find cell by value
    def _cell_by_app(app_id: str) -> ET.Element:
        for c in new_cells:
            if f"ID: {app_id}" in (c.get("value") or ""):
                return c
        raise AssertionError(f"no cell for {app_id}")

    major = _cell_by_app("M1")
    s1 = _cell_by_app("S1")
    s2 = _cell_by_app("S2")
    s3 = _cell_by_app("S3")

    def _center(c: ET.Element) -> tuple[float, float]:
        g = c.find("mxGeometry")
        assert g is not None
        x = float(g.get("x") or "0"); y = float(g.get("y") or "0")
        w = float(g.get("width") or "0"); h = float(g.get("height") or "0")
        return (x + w / 2, y + h / 2)

    mcx, _mcy = _center(major)
    # Surrounds are split into left (even indexes: S1, S3) and right (odd: S2).
    # All left surrounds must be LEFT of the major center; all right on the RIGHT.
    assert _center(s1)[0] < mcx, "S1 (index 0, even) should be in the left column"
    assert _center(s3)[0] < mcx, "S3 (index 2, even) should be in the left column"
    assert _center(s2)[0] > mcx, "S2 (index 1, odd) should be in the right column"
    # All surrounds in the same column share the same x (same column left-edge)
    assert abs(_center(s1)[0] - _center(s3)[0]) < 0.1, "left-column surrounds share x"


def test_single_major_no_surrounds_no_edges():
    tpl = _ea_style_template()
    out = generate_as_is_xml(tpl, [_app("M1", "Alone", role="major")], [])
    graph_root = _parse_graph_root(out)
    edges = [c for c in graph_root.iter("mxCell") if c.get("edge") == "1"]
    assert edges == []
    new_vertex = [
        c for c in graph_root.iter("mxCell")
        if c.get("vertex") == "1" and c.get("id") not in ("L1", "L2", "L3", "L4")
    ]
    assert len(new_vertex) == 1


def test_interfaces_produce_edges():
    tpl = _ea_style_template()
    apps = [
        _app("M1", "Major", role="major"),
        _app("S1", "Alpha", role="surround"),
    ]
    ifaces = [_iface("M1", "S1", platform="APIH")]
    out = generate_as_is_xml(tpl, apps, ifaces)
    graph_root = _parse_graph_root(out)

    edges = [c for c in graph_root.iter("mxCell") if c.get("edge") == "1"]
    assert len(edges) == 1
    # Both endpoints must point at existing vertex ids
    vertex_ids = {c.get("id") for c in graph_root.iter("mxCell") if c.get("vertex") == "1"}
    assert edges[0].get("source") in vertex_ids
    assert edges[0].get("target") in vertex_ids


def test_app_label_contains_only_id_and_name():
    """Label must be ID + Name in bold. No description, no status prefix."""
    tpl = _ea_style_template()
    app = {
        "app_id": "M1", "name": "Major App", "role": "major",
        "planned_status": "change",
        "short_description": "This description MUST NOT appear on the box",
    }
    out = generate_as_is_xml(tpl, [app], [])
    graph_root = _parse_graph_root(out)
    major = next(
        c for c in graph_root.iter("mxCell")
        if c.get("vertex") == "1" and c.get("id") not in ("L1", "L2", "L3", "L4")
    )
    value = major.get("value") or ""
    assert "ID: M1" in value
    assert "<b>Major App</b>" in value
    assert "description" not in value.lower()
    assert "CHANGE:" not in value, "no status-prefix tag in label"


def test_major_default_color_is_modify():
    """Major with no planned_status set defaults to Modify (change/yellow)."""
    tpl = _ea_style_template()
    app = {"app_id": "M1", "name": "X", "role": "major"}  # no planned_status
    out = generate_as_is_xml(tpl, [app], [])
    graph_root = _parse_graph_root(out)
    major = next(
        c for c in graph_root.iter("mxCell")
        if c.get("vertex") == "1" and c.get("id") not in ("L1", "L2", "L3", "L4")
    )
    style = major.get("style") or ""
    assert "fillColor=#fff2cc" in style, f"expected Modify (yellow), got {style}"
    assert "strokeColor=#d6b656" in style


def test_major_with_explicit_keep_still_renders_modify():
    """Wizard defaults planned_status='keep' for every app-in-scope. A
    Major (the focus of the design) must NOT inherit the keep-blue from
    that default — it should stay yellow/Modify. Only explicit new or
    sunset overrides the Major's color."""
    tpl = _ea_style_template()
    app = {"app_id": "M1", "name": "X", "role": "major", "planned_status": "keep"}
    out = generate_as_is_xml(tpl, [app], [])
    graph_root = _parse_graph_root(out)
    major = next(
        c for c in graph_root.iter("mxCell")
        if c.get("vertex") == "1" and c.get("id") not in ("L1", "L2", "L3", "L4")
    )
    style = major.get("style") or ""
    assert "fillColor=#fff2cc" in style, (
        f"Major with planned_status='keep' must still be Modify/yellow, got {style}"
    )


def test_major_explicit_new_is_green():
    tpl = _ea_style_template()
    app = {"app_id": "M1", "name": "X", "role": "major", "planned_status": "new"}
    out = generate_as_is_xml(tpl, [app], [])
    graph_root = _parse_graph_root(out)
    major = next(
        c for c in graph_root.iter("mxCell")
        if c.get("vertex") == "1" and c.get("id") not in ("L1", "L2", "L3", "L4")
    )
    assert "fillColor=#d5e8d4" in (major.get("style") or "")


def test_major_explicit_sunset_is_red():
    tpl = _ea_style_template()
    app = {"app_id": "M1", "name": "X", "role": "major", "planned_status": "sunset"}
    out = generate_as_is_xml(tpl, [app], [])
    graph_root = _parse_graph_root(out)
    major = next(
        c for c in graph_root.iter("mxCell")
        if c.get("vertex") == "1" and c.get("id") not in ("L1", "L2", "L3", "L4")
    )
    assert "fillColor=#f8cecc" in (major.get("style") or "")


def test_surround_uses_existing_color_not_grey_dashed():
    """Surround always renders in Existing (keep/blue), never dashed grey."""
    tpl = _ea_style_template()
    apps = [
        _app("M1", "Major", role="major"),
        _app("S1", "Side", role="surround", status="new"),  # explicit 'new' ignored for surround
    ]
    out = generate_as_is_xml(tpl, apps, [])
    graph_root = _parse_graph_root(out)
    new_cells = [
        c for c in graph_root.iter("mxCell")
        if c.get("vertex") == "1" and c.get("id") not in ("L1", "L2", "L3", "L4")
    ]
    surround = next(c for c in new_cells if "ID: S1" in (c.get("value") or ""))
    style = surround.get("style") or ""
    assert "fillColor=#dae8fc" in style, f"Existing (blue), got {style}"
    assert "strokeColor=#6c8ebf" in style
    assert "dashed=1" not in style


def test_edge_label_is_interface_name_only():
    """Edge value is interface_name; platform prefix is NOT added."""
    tpl = _ea_style_template()
    apps = [_app("M1", "Major", role="major"), _app("S1", "S", role="surround")]
    ifaces = [{
        "from_app": "M1", "to_app": "S1",
        "platform": "APIH", "interface_name": "Submit Order",
        "planned_status": "change",
    }]
    out = generate_as_is_xml(tpl, apps, ifaces)
    graph_root = _parse_graph_root(out)
    edge = next(c for c in graph_root.iter("mxCell") if c.get("edge") == "1")
    assert edge.get("value") == "Submit Order"
    assert "APIH" not in (edge.get("value") or "")


def test_edge_with_no_interface_name_has_no_label():
    """If interface_name is empty, the edge is unlabeled (no 'APIH:' fallback)."""
    tpl = _ea_style_template()
    apps = [_app("M1", "Major", role="major"), _app("S1", "S", role="surround")]
    ifaces = [{
        "from_app": "M1", "to_app": "S1",
        "platform": "APIH", "interface_name": "",
        "planned_status": "change",
    }]
    out = generate_as_is_xml(tpl, apps, ifaces)
    graph_root = _parse_graph_root(out)
    edge = next(c for c in graph_root.iter("mxCell") if c.get("edge") == "1")
    assert edge.get("value") in (None, "")


def test_orphan_interface_dropped():
    """Interface referencing an app not in the apps list produces no edge."""
    tpl = _ea_style_template()
    apps = [_app("M1", "Major", role="major")]
    ifaces = [_iface("M1", "GHOST", platform="APIH")]
    out = generate_as_is_xml(tpl, apps, ifaces)
    graph_root = _parse_graph_root(out)
    edges = [c for c in graph_root.iter("mxCell") if c.get("edge") == "1"]
    assert edges == []


def test_no_apps_returns_legend_only():
    tpl = _ea_style_template()
    out = generate_as_is_xml(tpl, [], [])
    graph_root = _parse_graph_root(out)
    vertex_cells = [c for c in graph_root.iter("mxCell") if c.get("vertex") == "1"]
    ids = {c.get("id") for c in vertex_cells}
    assert ids == {"L1", "L2", "L3", "L4"}, "Legend stays, body gone, no new apps"


def test_promotes_surround_when_no_major():
    """If only surrounds are supplied, the first is promoted to center."""
    tpl = _ea_style_template()
    apps = [
        _app("S1", "Would be major", role="surround"),
        _app("S2", "Still surround", role="surround"),
    ]
    out = generate_as_is_xml(tpl, apps, [])
    graph_root = _parse_graph_root(out)
    new_vertex = [
        c for c in graph_root.iter("mxCell")
        if c.get("vertex") == "1" and c.get("id") not in ("L1", "L2", "L3", "L4")
    ]
    assert len(new_vertex) == 2


def test_multiple_primaries_all_render_as_majors():
    """All apps tagged primary/major render as Majors (yellow), stacked
    vertically in the middle column. Related/surround apps go to the
    side columns."""
    tpl = _ea_style_template()
    apps = [
        {"app_id": "M1", "name": "First primary", "role": "primary"},
        {"app_id": "M2", "name": "Second primary", "role": "primary"},
        {"app_id": "R1", "name": "Related app", "role": "related"},
    ]
    out = generate_as_is_xml(tpl, apps, [])
    graph_root = _parse_graph_root(out)
    new_cells = [
        c for c in graph_root.iter("mxCell")
        if c.get("vertex") == "1" and c.get("id") not in ("L1", "L2", "L3", "L4")
    ]

    def _cell(app_id: str) -> ET.Element:
        for c in new_cells:
            if f"ID: {app_id}" in (c.get("value") or ""):
                return c
        raise AssertionError(f"no cell for {app_id}")

    def _style(c: ET.Element) -> str:
        return c.get("style") or ""

    def _center(c: ET.Element) -> tuple[float, float]:
        g = c.find("mxGeometry")
        x = float(g.get("x")); y = float(g.get("y"))
        w = float(g.get("width")); h = float(g.get("height"))
        return (x + w / 2, y + h / 2)

    # Both primaries are Major (yellow), the related is Surround (blue)
    assert "fillColor=#fff2cc" in _style(_cell("M1")), "M1 should be Major/yellow"
    assert "fillColor=#fff2cc" in _style(_cell("M2")), "M2 should also be Major/yellow"
    assert "fillColor=#dae8fc" in _style(_cell("R1")), "R1 should be Surround/blue"

    # Both Majors stack vertically on the same x (center column)
    cx_m1, cy_m1 = _center(_cell("M1"))
    cx_m2, cy_m2 = _center(_cell("M2"))
    assert abs(cx_m1 - cx_m2) < 0.1, "both majors share the x-midline"
    assert cy_m1 != cy_m2, "majors stack vertically (different y)"


def test_edge_style_is_modify_yellow_orthogonal():
    """Edges default to the Legend's 'Modify / Changed Interface' color
    (#d6b656, yellow) with orthogonal routing. Platform (APIH / KPaaS /
    WSO2) is ignored."""
    tpl = _ea_style_template()
    apps = [_app("M1", "Major", role="major"), _app("S1", "S", role="surround")]
    for platform in ("APIH", "KPaaS", "WSO2", "SomethingUnknown"):
        iface = {
            "from_app": "M1", "to_app": "S1",
            "platform": platform, "interface_name": "x",
            "planned_status": "change",
        }
        out = generate_as_is_xml(tpl, apps, [iface])
        graph_root = _parse_graph_root(out)
        edge = next(c for c in graph_root.iter("mxCell") if c.get("edge") == "1")
        style = edge.get("style") or ""
        assert "strokeColor=#d6b656" in style, f"{platform}: expected Modify yellow, got {style}"
        assert "edgeStyle=orthogonalEdgeStyle" in style, f"{platform}: orthogonal routing missing"
        # No platform-specific colors bleed through
        assert "#6ba6e8" not in style  # APIH blue
        assert "#5fc58a" not in style  # KPaaS green


def test_edge_has_rounded_orthogonal_style():
    """Soft folds: orthogonal routing with rounded=1 + arcSize."""
    tpl = _ea_style_template()
    apps = [_app("M1", "Major", role="major"), _app("S1", "S", role="surround")]
    iface = {"from_app": "M1", "to_app": "S1", "platform": "",
             "interface_name": "x", "planned_status": "change"}
    out = generate_as_is_xml(tpl, apps, [iface])
    edge = next(c for c in _parse_graph_root(out).iter("mxCell") if c.get("edge") == "1")
    style = edge.get("style") or ""
    assert "edgeStyle=orthogonalEdgeStyle" in style
    assert "rounded=1" in style, "edge should use rounded corners"


def test_legend_edge_labels_preserved():
    """Edges between Legend vertices AND their child labels (e.g. 'Exist
    Interface' text positioned on an edge) must survive the strip."""
    # Build a template where the Legend contains:
    #   two vertex boxes (ex1, ex2) connected by an edge
    #   the edge has a child label cell ("Interface Kind")
    #   a body cell below
    cells = (
        _mk_cell("ex1", x=100, y=60, w=100, h=40, value="Example A")
        + _mk_cell("ex2", x=400, y=60, w=100, h=40, value="Example B")
        + _mk_cell("marker", x=20, y=10, w=80, h=20, value="Legend")
        # Edge between ex1 and ex2
        + '<mxCell id="e1" style="endArrow=classic;" edge="1" parent="1" source="ex1" target="ex2">'
          '<mxGeometry relative="1" as="geometry"/>'
          '</mxCell>'
        # Label on the edge (child of e1)
        + '<mxCell id="elabel" value="Interface Kind" vertex="1" parent="e1" connectable="0">'
          '<mxGeometry x="0.5" relative="1" as="geometry"/>'
          '</mxCell>'
        # A body cell well below the Legend
        + _mk_cell("body1", x=200, y=500, w=200, h=80, value="Body")
    )
    tpl = _wrap_template(cells)
    out = generate_as_is_xml(tpl, [_app("M1", "Hub", role="major")], [])
    graph_root = _parse_graph_root(out)
    ids = {c.get("id") for c in graph_root.iter("mxCell")}
    # Legend cells kept
    for cid in ("ex1", "ex2", "marker", "e1", "elabel"):
        assert cid in ids, f"Legend cell {cid} must be preserved"
    # Body cell cleared
    assert "body1" not in ids


def test_major_aligned_with_legend_horizontal_center():
    """Major cluster's x-midline lines up with the Legend box's x-midline."""
    # Build a Legend off-center (far-right of the canvas)
    cells = (
        _mk_cell("L1", x=500, y=40, w=140, h=60, value="L1")
        + _mk_cell("L2", x=660, y=40, w=140, h=60, value="L2")
        + _mk_cell("L3", x=820, y=40, w=140, h=60, value="L3")
        + _mk_cell("body", x=100, y=400, w=200, h=80, value="Body")
    )
    tpl = _wrap_template(cells)
    out = generate_as_is_xml(tpl, [_app("M1", "Hub", role="major")], [])
    graph_root = _parse_graph_root(out)
    major = next(
        c for c in graph_root.iter("mxCell")
        if c.get("vertex") == "1" and "ID: M1" in (c.get("value") or "")
    )
    g = major.find("mxGeometry")
    major_cx = float(g.get("x")) + float(g.get("width")) / 2
    # Legend region spans (L1.xmin = 500-20pad = 480) to (L3.xmax = 960+20 = 980),
    # so Legend x-center = 730. Major x-center should match (±1 for float).
    legend_xmin = 480  # 500 - _LEGEND_PADDING (20)
    legend_xmax = 980  # 960 + 20
    legend_xcenter = (legend_xmin + legend_xmax) / 2
    assert abs(major_cx - legend_xcenter) < 1.5, (
        f"Major x-center {major_cx} should match Legend x-center {legend_xcenter}"
    )


def test_tall_container_spanning_legend_and_body_is_not_kept():
    """A cell that starts inside the Legend band but extends far below
    it is a body container, not a Legend member. It must be stripped
    and its children must NOT transitively survive via parent chain."""
    # Legend band at top + an "Illustrative" sticky outside the Legend
    # + a tall body container whose TOP is inside the Legend band and
    # whose BOTTOM extends deep into the body + a child of that
    # container.
    cells = (
        # Illustrative sticky — well ABOVE the Legend frame so it falls
        # OUTSIDE the region after detection + padding (mirroring the
        # real EA template where Illustrative is y=-250 and Legend frame
        # starts at y=-190, separated by a 60px gap).
        _mk_cell("illus", x=10, y=0, w=120, h=30, value="Illustrative")
        # Legend box marker (inside the Legend)
        + _mk_cell("legend_label", x=600, y=120, w=80, h=20, value="Legend")
        # Example cards inside the Legend
        + _mk_cell("L1", x=100, y=160, w=100, h=60, value="Ex1")
        + _mk_cell("L2", x=260, y=160, w=100, h=60, value="Ex2")
        + _mk_cell("L3", x=420, y=160, w=100, h=60, value="Ex3")
        + _mk_cell("L4", x=580, y=160, w=100, h=60, value="Ex4")
        + _mk_cell("L5", x=740, y=160, w=100, h=60, value="Ex5")
        # A big Legend frame ENCLOSING the 5 cards + the label
        + _mk_cell("legend_frame", x=80, y=110, w=800, h=130, value="", style="rounded=0;")
        # Tall body container: top sits in the Legend band (y=180) but
        # extends to y=600 (body area). Must be stripped by body-overhang.
        + _mk_cell("body_container", x=100, y=180, w=800, h=420, value="", style="rounded=0;")
        # Child of the body container — must NOT be transitively kept
        + '<mxCell id="body_child" value="Users" style="text;" vertex="1" parent="body_container">'
        + '<mxGeometry x="10" y="250" width="80" height="30" as="geometry"/>'
        + '</mxCell>'
    )
    tpl = _wrap_template(cells)
    out = generate_as_is_xml(tpl, [_app("M1", "Hub", role="major")], [])
    graph_root = _parse_graph_root(out)
    ids = {c.get("id") for c in graph_root.iter("mxCell")}
    # Legend-proper cells survive
    assert "legend_frame" in ids
    assert "legend_label" in ids
    for c in ("L1", "L2", "L3", "L4", "L5"):
        assert c in ids, f"Legend example card {c} must survive"
    # Illustrative (outside the Legend frame AND outside the Legend region)
    # and the body container + its child must all be stripped.
    assert "illus" not in ids, "Illustrative sticky above Legend must be stripped"
    assert "body_container" not in ids, "tall body container must be stripped"
    assert "body_child" not in ids, "children of stripped body container must NOT survive"


def test_major_top_pinned_near_canvas_top():
    """Major's top edge should sit near canvas.ymin (= Legend.ymax + gap),
    not float at canvas center."""
    tpl = _ea_style_template()
    out = generate_as_is_xml(tpl, [_app("M1", "Hub", role="major")], [])
    graph_root = _parse_graph_root(out)
    major = next(
        c for c in graph_root.iter("mxCell")
        if c.get("vertex") == "1" and "ID: M1" in (c.get("value") or "")
    )
    g = major.find("mxGeometry")
    major_y = float(g.get("y"))
    # EA fixture's Legend ends at y=150 (130 + 20 padding). canvas_top =
    # 150 + 80 (_CANVAS_TOP_GAP) = 230. Major top should be right there.
    assert 225 <= major_y <= 240, f"Major top {major_y} should be near 230"


def test_edge_new_is_green_dashed():
    tpl = _ea_style_template()
    apps = [_app("M1", "Major", role="major"), _app("S1", "S", role="surround")]
    iface = {"from_app": "M1", "to_app": "S1", "platform": "APIH",
             "interface_name": "x", "planned_status": "new"}
    out = generate_as_is_xml(tpl, apps, [iface])
    edge = next(c for c in _parse_graph_root(out).iter("mxCell") if c.get("edge") == "1")
    style = edge.get("style") or ""
    assert "strokeColor=#82b366" in style, f"new iface should be green, got {style}"
    assert "dashPattern=" in style


def test_edge_sunset_is_red_dotted():
    tpl = _ea_style_template()
    apps = [_app("M1", "Major", role="major"), _app("S1", "S", role="surround")]
    iface = {"from_app": "M1", "to_app": "S1", "platform": "APIH",
             "interface_name": "x", "planned_status": "sunset"}
    out = generate_as_is_xml(tpl, apps, [iface])
    edge = next(c for c in _parse_graph_root(out).iter("mxCell") if c.get("edge") == "1")
    style = edge.get("style") or ""
    assert "strokeColor=#b85450" in style, f"sunset iface should be red, got {style}"
    assert "dashPattern=" in style


def test_surrounds_split_into_left_and_right_columns():
    """6 surrounds = 3 left + 3 right, each column at a fixed x."""
    tpl = _ea_style_template()
    apps = [_app("M1", "Hub", role="major")]
    for i in range(6):
        apps.append(_app(f"S{i}", f"Surround{i}", role="surround"))
    out = generate_as_is_xml(tpl, apps, [])
    graph_root = _parse_graph_root(out)

    new = [
        c for c in graph_root.iter("mxCell")
        if c.get("vertex") == "1" and c.get("id") not in ("L1", "L2", "L3", "L4")
    ]

    def _cx(c):
        g = c.find("mxGeometry")
        return float(g.get("x")) + float(g.get("width")) / 2

    major_cx = _cx(next(c for c in new if "ID: M1" in (c.get("value") or "")))

    left_xs = []
    right_xs = []
    for i in range(6):
        c = next(cc for cc in new if f"ID: S{i}" in (cc.get("value") or ""))
        cx = _cx(c)
        (left_xs if cx < major_cx else right_xs).append(cx)

    assert len(left_xs) == 3 and len(right_xs) == 3
    # All cells in one column share an x
    assert max(left_xs) - min(left_xs) < 0.1
    assert max(right_xs) - min(right_xs) < 0.1


def test_box_height_scales_down_as_surround_count_grows():
    """With many surrounds, boxes get shorter so the column fits."""
    tpl = _ea_style_template()

    def _heights(n_surround: int) -> list[float]:
        apps = [_app("M1", "Hub", role="major")]
        for i in range(n_surround):
            apps.append(_app(f"S{i}", f"X", role="surround"))
        out = generate_as_is_xml(tpl, apps, [])
        gr = _parse_graph_root(out)
        return [
            float(c.find("mxGeometry").get("height"))
            for c in gr.iter("mxCell")
            if c.get("vertex") == "1" and c.get("id") not in ("L1", "L2", "L3", "L4")
        ]

    h_small = _heights(2)[0]    # 1 per side → clamped to MAX
    h_big = _heights(20)[0]     # 10 per side → shrinks below MAX
    assert h_big < h_small, f"expected shorter blocks when many surrounds, got {h_small} vs {h_big}"
    # All blocks in one run share the same height (Major matches Surround)
    hs = _heights(4)
    assert max(hs) - min(hs) < 0.1, f"all blocks should share height: {hs}"


def test_dedupes_apps():
    tpl = _ea_style_template()
    apps = [
        _app("M1", "Major", role="major"),
        _app("M1", "Dup", role="major"),
        _app("S1", "S", role="surround"),
        _app("S1", "Sdup", role="surround"),
    ]
    out = generate_as_is_xml(tpl, apps, [])
    graph_root = _parse_graph_root(out)
    new_vertex = [
        c for c in graph_root.iter("mxCell")
        if c.get("vertex") == "1" and c.get("id") not in ("L1", "L2", "L3", "L4")
    ]
    assert len(new_vertex) == 2, "duplicates dropped (first-win)"


def test_idempotent_modulo_uuid():
    tpl = _ea_style_template()
    apps = [
        _app("M1", "Major", role="major"),
        _app("S1", "A", role="surround"),
        _app("S2", "B", role="surround"),
    ]
    out1 = generate_as_is_xml(tpl, apps, [_iface("M1", "S1")])
    out2 = generate_as_is_xml(tpl, apps, [_iface("M1", "S1")])
    # Strip UUID cell ids ("ns-xxxxxxxxxx") before comparing
    norm = lambda x: re.sub(r'"ns-[0-9a-f]{10}"', '"ns-XXX"', x)
    # Also source/target refs carry those uuids
    norm2 = lambda x: re.sub(r'(source|target)="ns-[0-9a-f]{10}"', r'\1="ns-XXX"', norm(x))
    assert norm2(out1) == norm2(out2)
