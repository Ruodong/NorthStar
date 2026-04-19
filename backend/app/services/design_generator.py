"""Architecture Design — AS-IS drawio XML generator.

Given a selected template XML + list of apps + list of interfaces, produce
a new drawio XML that:
  1. Preserves the template's legend, notes, and overall layout conventions.
  2. Fills template placeholder cells (`ID: A000001`-style markers) with real
     CMDB app data. Colors each cell by planned_status (Keep/Change/New/Sunset).
  3. Adds extra app cells to the right for apps beyond the template slots.
  4. Adds edges for each selected interface, styled by platform.
  5. Returns drawio XML ready to load into the draw.io embed.

The architect then edits this canvas; the result is saved back via the
/api/design/{id}/drawio PUT endpoint.
"""
from __future__ import annotations

import copy
import re
import uuid
from typing import Any, Optional
from xml.etree import ElementTree as ET


# Placeholder detector: match cells whose value contains an `A\d{5,6}`
# CMDB id, with or without an `ID:` prefix. Older EA templates use the
# prefixed form ("ID: A000001"), newer ones drop the prefix. \b anchors
# the id so we don't pick up random trailing digits inside words.
_PLACEHOLDER_APP_ID_RE = re.compile(
    r"(?:ID:\s*)?\b(A\d{5,6})\b", re.IGNORECASE
)


# Colors by planned_status (CMDB app lifecycle)
_APP_STATUS_STYLE: dict[str, str] = {
    "keep":   "fillColor=#dae8fc;strokeColor=#6c8ebf;",
    "change": "fillColor=#fff2cc;strokeColor=#d6b656;",
    "new":    "fillColor=#d5e8d4;strokeColor=#82b366;",
    "sunset": "fillColor=#f8cecc;strokeColor=#b85450;",
}

# Platform colors for edges
_PLATFORM_EDGE_COLOR: dict[str, str] = {
    "APIH":                "#6ba6e8",
    "KPaaS":               "#5fc58a",
    "WSO2":                "#f6a623",
    "Talend":              "#e8716b",
    "PO":                  "#a8b0c0",
    "Data Service":        "#e8b458",
    "Axway":               "#9aa4b8",
    "Axway MFT":           "#9aa4b8",
    "Goanywhere-job":      "#6b7488",
    "Goanywhere-web user": "#6b7488",
}


# Minimal blank canvas for when no template is chosen
_BLANK_DRAWIO_XML = """<mxfile host="northstar" type="design" version="24.0.0">
  <diagram name="Page-1" id="page1">
    <mxGraphModel dx="1400" dy="900" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1600" pageHeight="1100" math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>"""


def _new_cell_id() -> str:
    """Short unique id for new mxCells."""
    return "ns-" + uuid.uuid4().hex[:10]


# NOTE: we used to have an _escape_text() that pre-escaped cell values to
# HTML entities. That was a bug — ElementTree escapes XML-special chars
# when serializing attributes, so the double-pass produced literal
# `&amp;lt;b&amp;gt;` in the output and drawio rendered the tag text.
# Just pass raw HTML (e.g. "<b>x</b><br>y") to .set("value", ...) and let
# ET handle XML-level escaping.


def _find_placeholder_cells(root: ET.Element) -> list[ET.Element]:
    """Find mxCell elements whose value contains an ID: A???? placeholder."""
    placeholders: list[ET.Element] = []
    for cell in root.iter("mxCell"):
        value = cell.get("value") or ""
        # The drawio XML escapes < as &lt;, so unescape then search
        unescaped = (
            value.replace("&lt;", "<")
                 .replace("&gt;", ">")
                 .replace("&amp;", "&")
                 .replace("&#39;", "'")
                 .replace("&quot;", '"')
        )
        if _PLACEHOLDER_APP_ID_RE.search(unescaped):
            placeholders.append(cell)
    return placeholders


def _app_label(app: dict) -> str:
    """Build the cell label for an app. Matches the template's format:
    `ID: <app_id><br><b><app_name></b>` when available.

    Returns raw HTML; ElementTree.set("value", ...) escapes it correctly
    when the drawio file is serialized.
    """
    app_id = app.get("app_id") or ""
    name = app.get("name") or app.get("app_name") or ""
    desc = app.get("short_description") or ""
    role_note = {
        "keep": "",
        "change": "CHANGE: ",
        "new": "NEW: ",
        "sunset": "SUNSET: ",
    }.get(app.get("planned_status", "keep"), "")
    lines = [f"ID: {app_id}"]
    if name:
        lines.append(f"<b>{role_note}{name}</b>")
    if desc:
        lines.append(desc[:120])
    return "<br>".join(lines)


def _app_style(planned_status: str, is_external: bool = False) -> str:
    """Style string for an application cell."""
    base = _APP_STATUS_STYLE.get(planned_status, _APP_STATUS_STYLE["keep"])
    shape = "rounded=1;whiteSpace=wrap;html=1;" + base
    if is_external:
        shape += "dashed=1;"
    return shape + "align=center;verticalAlign=middle;fontSize=12;"


def _edge_style(platform: str, planned_status: str) -> str:
    """Style string for an edge (integration interface)."""
    color = _PLATFORM_EDGE_COLOR.get(platform, "#666666")
    base = (
        f"endArrow=classic;html=1;strokeColor={color};"
        f"strokeWidth=1.5;fontSize=10;fontColor=#666;"
    )
    if planned_status == "new":
        base += "dashPattern=8 4;strokeWidth=2;"
    elif planned_status == "sunset":
        base += "dashPattern=2 2;strokeColor=#b85450;"
    elif planned_status == "change":
        base += "strokeWidth=2.5;"
    return base


def _find_graph_root(mxfile_root: ET.Element) -> Optional[ET.Element]:
    """Find the <root> element inside <mxGraphModel> (where cells live)."""
    for diagram in mxfile_root.iter("diagram"):
        for model in diagram.iter("mxGraphModel"):
            for root in model.iter("root"):
                return root
    return None


def generate_as_is_xml(
    template_xml: Optional[str],
    apps: list[dict],
    interfaces: list[dict],
) -> str:
    """Generate AS-IS drawio XML.

    Args:
      template_xml: raw drawio XML from a chosen template, or None for blank.
      apps: list of dicts with keys: app_id, name, short_description,
            planned_status, role (primary|related|external).
      interfaces: list of dicts with keys: from_app, to_app, platform,
                  interface_name, planned_status.

    Returns:
      drawio XML string.
    """
    xml_text = template_xml if (template_xml and template_xml.strip()) else _BLANK_DRAWIO_XML

    try:
        tree_root = ET.fromstring(xml_text)
    except ET.ParseError:
        # Corrupt template — fall back to blank canvas
        tree_root = ET.fromstring(_BLANK_DRAWIO_XML)

    graph_root = _find_graph_root(tree_root)
    if graph_root is None:
        # Template has no mxGraphModel root — rebuild minimal structure
        tree_root = ET.fromstring(_BLANK_DRAWIO_XML)
        graph_root = _find_graph_root(tree_root)
    assert graph_root is not None

    # Map app_id → cell_id we assigned (for later edge wiring)
    app_to_cell_id: dict[str, str] = {}

    # ── Step 1: Fill placeholder cells ──────────────────────────────
    placeholders = _find_placeholder_cells(graph_root)
    remaining_apps = list(apps)

    for ph_cell in placeholders:
        if not remaining_apps:
            break
        app = remaining_apps.pop(0)
        ph_cell.set("value", _app_label(app))
        ph_cell.set(
            "style",
            _app_style(
                app.get("planned_status", "keep"),
                app.get("role") == "external",
            ),
        )
        # Remember the cell id so edges can target it
        cell_id = ph_cell.get("id") or _new_cell_id()
        ph_cell.set("id", cell_id)
        app_to_cell_id[app["app_id"]] = cell_id

    # ── Step 2: Add extra cells for apps beyond template slots ─────
    # Lay them out in a grid to the right of whatever the template has.
    # Simple pattern: column of 2 per row, starting at x=50, y=50 on a new area.
    # Since we don't know the template's bounding box, just add below everything.
    GRID_START_X = 50
    GRID_START_Y = 800
    CELL_W, CELL_H = 180, 70
    COLS = 6
    for i, app in enumerate(remaining_apps):
        cell_id = _new_cell_id()
        row = i // COLS
        col = i % COLS
        x = GRID_START_X + col * (CELL_W + 30)
        y = GRID_START_Y + row * (CELL_H + 30)

        cell = ET.SubElement(graph_root, "mxCell")
        cell.set("id", cell_id)
        cell.set("value", _app_label(app))
        cell.set("style", _app_style(
            app.get("planned_status", "keep"),
            app.get("role") == "external",
        ))
        cell.set("vertex", "1")
        cell.set("parent", "1")

        geom = ET.SubElement(cell, "mxGeometry")
        geom.set("x", str(x))
        geom.set("y", str(y))
        geom.set("width", str(CELL_W))
        geom.set("height", str(CELL_H))
        geom.set("as", "geometry")

        app_to_cell_id[app["app_id"]] = cell_id

    # ── Step 3: Add edges for interfaces ────────────────────────────
    for iface in interfaces:
        src_id = app_to_cell_id.get(iface.get("from_app"))
        tgt_id = app_to_cell_id.get(iface.get("to_app"))
        if not src_id or not tgt_id:
            continue  # skip edges with missing endpoints

        platform = iface.get("platform") or ""
        iface_name = iface.get("interface_name") or ""
        planned = iface.get("planned_status", "keep")

        edge = ET.SubElement(graph_root, "mxCell")
        edge.set("id", _new_cell_id())
        edge.set("style", _edge_style(platform, planned))
        edge.set("edge", "1")
        edge.set("parent", "1")
        edge.set("source", src_id)
        edge.set("target", tgt_id)
        if iface_name or platform:
            label = f"{platform}: {iface_name}" if platform else iface_name
            # Raw string — ET handles XML escaping on serialize.
            edge.set("value", label[:60])

        geom = ET.SubElement(edge, "mxGeometry")
        geom.set("relative", "1")
        geom.set("as", "geometry")

    # Serialize
    # ElementTree doesn't preserve some attrs well; accept the output.
    xml_bytes = ET.tostring(tree_root, encoding="utf-8", xml_declaration=False)
    return xml_bytes.decode("utf-8")
