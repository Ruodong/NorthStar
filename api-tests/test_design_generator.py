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

    mcx, mcy = _center(major)
    for i, surround in enumerate([s1, s2, s3]):
        sx, sy = _center(surround)
        # Surround must be at angle -90 + 120*i degrees from hub
        expected_theta = -math.pi / 2 + 2 * math.pi * i / 3
        actual_theta = math.atan2(sy - mcy, sx - mcx)
        diff = abs(actual_theta - expected_theta)
        assert diff < 0.02, f"surround {i} angle {math.degrees(actual_theta):.1f} != expected {math.degrees(expected_theta):.1f}"


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
