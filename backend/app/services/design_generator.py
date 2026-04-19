"""Architecture Design — AS-IS drawio XML generator.

Given a chosen drawio template, a list of apps (role + planned_status),
and a list of interfaces, produce a new drawio XML where:

  1. The template's **Legend band** at the top is preserved byte-for-byte
     as a style reference / pattern key. Detection is heuristic:
       a) a cell labeled /legend|illustrative/i inside a group → use the
          group's bbox
       b) the topmost cluster of vertex cells (if in the top 35% of the
          graph bbox AND ≥ 3 cells) → use its padded bbox
       c) nothing → warn, proceed with no protected region
  2. Every cell OUTSIDE the Legend region (vertex OR edge) is deleted.
     Template body is NOT reused; the old slot-substitution algorithm is
     gone.
  3. The user's apps + interfaces are drawn into the cleared area as a
     hub-and-spoke graph:
       - Major app(s) at the canvas center (additional majors stack
         horizontally above the central one).
       - Surround apps arranged on a circle around the Major cluster.
       - Interface edges fan out from Major to Surround.
  4. Compression round-trip is unchanged — a compressed template
     produces compressed output at the same level.

See `.specify/features/design-hub-spoke-generator/spec.md` for the full
contract.
"""
from __future__ import annotations

import base64
import math
import re
import urllib.parse
import uuid
import zlib
from typing import Optional
from xml.etree import ElementTree as ET


# Colors by planned_status (CMDB app lifecycle).
_APP_STATUS_STYLE: dict[str, str] = {
    "keep":   "fillColor=#dae8fc;strokeColor=#6c8ebf;",
    "change": "fillColor=#fff2cc;strokeColor=#d6b656;",
    "new":    "fillColor=#d5e8d4;strokeColor=#82b366;",
    "sunset": "fillColor=#f8cecc;strokeColor=#b85450;",
}

# Surround Applications — apps referenced by interfaces but not chosen by
# the architect in the Apps panel. Rendered as muted grey boxes with a
# dashed border so they read as context, not focus.
_SURROUND_STYLE: str = "fillColor=#eef0f4;strokeColor=#9aa4b8;dashed=1;"

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

_LEGEND_LABEL_RE = re.compile(r"legend|illustrative", re.IGNORECASE)
_LEGEND_TOP_FRACTION = 0.35
_LEGEND_CLUSTER_GAP = 60.0
_LEGEND_PADDING = 20.0

# Hub-and-spoke canvas geometry.
_CANVAS_MIN_WIDTH = 1400
_CANVAS_MIN_HEIGHT = 900
_CANVAS_LEFT_MARGIN = 40
_CANVAS_TOP_GAP = 80         # gap below the Legend band

_MAJOR_BOX_W, _MAJOR_BOX_H = 260, 120
_SURROUND_BOX_W, _SURROUND_BOX_H = 180, 80
_MAJOR_STACK_GAP = 20         # gap between stacked major boxes
_SURROUND_RING_MIN_R = 320

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


# ── small helpers ─────────────────────────────────────────────────


def _new_cell_id() -> str:
    return "ns-" + uuid.uuid4().hex[:10]


def _app_label(app: dict) -> str:
    """Build the raw-HTML cell label for a plain mxCell.

    ET.set("value", …) will XML-escape < and > on serialization — do NOT
    pre-escape here, otherwise drawio shows literal `&lt;b&gt;`.
    """
    app_id = app.get("app_id") or ""
    name = app.get("name") or app.get("app_name") or ""
    desc = app.get("short_description") or ""
    role_note = {
        "keep":   "",
        "change": "CHANGE: ",
        "new":    "NEW: ",
        "sunset": "SUNSET: ",
    }.get(app.get("planned_status", "keep"), "")
    lines = [f"ID: {app_id}"] if app_id else []
    if name:
        lines.append(f"<b>{role_note}{name}</b>")
    if desc:
        lines.append(desc[:120])
    return "<br>".join(lines) or (name or app_id)


def _app_style(planned_status: str, role: str = "major") -> str:
    """Style string for a freshly drawn app box.

    Surround boxes always render muted/dashed (context, not focus);
    Major boxes pick color from planned_status.
    """
    if role == "surround":
        base = _SURROUND_STYLE
    else:
        base = _APP_STATUS_STYLE.get(planned_status, _APP_STATUS_STYLE["keep"])
    return (
        "rounded=1;whiteSpace=wrap;html=1;"
        + base
        + "align=center;verticalAlign=middle;fontSize=12;"
    )


def _edge_style(platform: str, planned_status: str) -> str:
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


# ── pako compression: drawio diagram content ─────────────────────
# drawio on Confluence stores the <mxGraphModel> as:
#     base64( deflate_raw( urllib.quote( xml ) ) )


def _extract_graph_model(diagram_el: ET.Element) -> tuple[bool, Optional[ET.Element]]:
    """Return (was_compressed, mxGraphModel element or None)."""
    for child in diagram_el:
        if child.tag == "mxGraphModel":
            return False, child

    text = (diagram_el.text or "").strip()
    if not text:
        return False, None
    try:
        raw = base64.b64decode(text)
        inflated = zlib.decompress(raw, -15)
        decoded = urllib.parse.unquote(inflated.decode("latin-1"))
        return True, ET.fromstring(decoded)
    except Exception:
        return False, None


def _set_graph_model(
    diagram_el: ET.Element,
    was_compressed: bool,
    graph_model: ET.Element,
) -> None:
    diagram_el.text = None
    for child in list(diagram_el):
        diagram_el.remove(child)

    if was_compressed:
        xml_str = ET.tostring(graph_model, encoding="unicode")
        encoded = urllib.parse.quote(xml_str, safe="").encode("latin-1")
        compressor = zlib.compressobj(9, zlib.DEFLATED, -15)
        compressed = compressor.compress(encoded) + compressor.flush()
        diagram_el.text = base64.b64encode(compressed).decode("ascii")
    else:
        diagram_el.append(graph_model)


# ── cell geometry helpers ─────────────────────────────────────────


def _cell_position(cell: ET.Element) -> tuple[float, float]:
    geom = cell.find("mxGeometry")
    if geom is None:
        return 0.0, 0.0
    try:
        return float(geom.get("x") or "0"), float(geom.get("y") or "0")
    except (TypeError, ValueError):
        return 0.0, 0.0


def _cell_size(cell: ET.Element) -> tuple[float, float]:
    geom = cell.find("mxGeometry")
    if geom is None:
        return 0.0, 0.0
    try:
        return float(geom.get("width") or "0"), float(geom.get("height") or "0")
    except (TypeError, ValueError):
        return 0.0, 0.0


def _cell_bbox(cell: ET.Element) -> Optional[tuple[float, float, float, float]]:
    """Return (xmin, ymin, xmax, ymax) for a vertex cell, or None for edges."""
    if cell.get("vertex") != "1":
        return None
    x, y = _cell_position(cell)
    w, h = _cell_size(cell)
    if w <= 0 and h <= 0:
        return None
    return (x, y, x + w, y + h)


def _iter_vertex_cells(graph_root: ET.Element) -> list[ET.Element]:
    """Return every vertex mxCell (skipping the id=0/1 sentinels).

    Walks both direct children and cells wrapped in <object> / <UserObject>
    envelopes (Confluence templates often use these for C4 labels).
    """
    cells: list[ET.Element] = []
    # Direct mxCell children of root
    for cell in graph_root.iter("mxCell"):
        if cell.get("id") in ("0", "1"):
            continue
        if cell.get("vertex") == "1":
            cells.append(cell)
    return cells


def _iter_edge_cells(graph_root: ET.Element) -> list[ET.Element]:
    return [c for c in graph_root.iter("mxCell") if c.get("edge") == "1"]


# ── Legend region detection ──────────────────────────────────────


def _detect_legend_region(
    graph_root: ET.Element,
) -> Optional[tuple[float, float, float, float]]:
    """Return the Legend bbox (xmin, ymin, xmax, ymax) or None.

    Two strategies, first-match wins:

    1. Explicit marker — a vertex cell whose value matches
       /legend|illustrative/i. Use the union bbox of all cells inside
       the same parent group (same ``parent`` attribute).
    2. Top-band cluster — group vertex cells by y-position, clusters
       separated by > _LEGEND_CLUSTER_GAP px. If the topmost cluster
       sits within the top _LEGEND_TOP_FRACTION of the graph bbox AND
       has ≥ 3 cells, use its padded bbox.

    Otherwise return None.
    """
    vertex_cells = _iter_vertex_cells(graph_root)
    vertex_bboxes: list[tuple[ET.Element, tuple[float, float, float, float]]] = []
    for c in vertex_cells:
        bb = _cell_bbox(c)
        if bb:
            vertex_bboxes.append((c, bb))
    if not vertex_bboxes:
        return None

    # Strategy 1 — explicit marker
    marker_cell: Optional[ET.Element] = None
    for c, _ in vertex_bboxes:
        v = (c.get("value") or "").strip()
        if not v:
            # Also check enclosing <object>'s c4Name / label attrs
            continue
        if _LEGEND_LABEL_RE.search(v):
            marker_cell = c
            break
    if marker_cell is not None:
        parent = marker_cell.get("parent")
        if parent and parent not in ("0", "1"):
            sibling_bbs = [
                bb for c, bb in vertex_bboxes if c.get("parent") == parent
            ]
            if sibling_bbs:
                xmin = min(b[0] for b in sibling_bbs) - _LEGEND_PADDING
                ymin = min(b[1] for b in sibling_bbs) - _LEGEND_PADDING
                xmax = max(b[2] for b in sibling_bbs) + _LEGEND_PADDING
                ymax = max(b[3] for b in sibling_bbs) + _LEGEND_PADDING
                return (xmin, ymin, xmax, ymax)

    # Strategy 2 — top-band cluster
    # Overall graph bbox
    all_bbs = [bb for _, bb in vertex_bboxes]
    gmin_y = min(b[1] for b in all_bbs)
    gmax_y = max(b[3] for b in all_bbs)
    total_h = gmax_y - gmin_y
    if total_h <= 0:
        return None

    # Sort cells by y (top edge), cluster by gap > _LEGEND_CLUSTER_GAP
    sorted_cells = sorted(vertex_bboxes, key=lambda cb: cb[1][1])
    clusters: list[list[tuple[ET.Element, tuple[float, float, float, float]]]] = [[]]
    last_y: Optional[float] = None
    for c, bb in sorted_cells:
        y = bb[1]
        if last_y is None:
            clusters[-1].append((c, bb))
        elif y - last_y > _LEGEND_CLUSTER_GAP:
            clusters.append([(c, bb)])
        else:
            clusters[-1].append((c, bb))
        # "last_y" tracks the bottom edge of the cluster so tall cells
        # don't split into their own cluster
        last_y = max(bb[3], last_y if last_y is not None else bb[3])

    if not clusters or not clusters[0]:
        return None
    top_cluster = clusters[0]
    if len(top_cluster) < 3:
        return None
    top_cluster_ymax = max(bb[3] for _, bb in top_cluster)
    # Top cluster must sit within the top _LEGEND_TOP_FRACTION of the bbox
    if (top_cluster_ymax - gmin_y) / total_h > _LEGEND_TOP_FRACTION:
        return None

    xmin = min(bb[0] for _, bb in top_cluster) - _LEGEND_PADDING
    ymin = min(bb[1] for _, bb in top_cluster) - _LEGEND_PADDING
    xmax = max(bb[2] for _, bb in top_cluster) + _LEGEND_PADDING
    ymax = top_cluster_ymax + _LEGEND_PADDING
    return (xmin, ymin, xmax, ymax)


def _inside_region(
    bbox: Optional[tuple[float, float, float, float]],
    region: tuple[float, float, float, float],
) -> bool:
    """Return True if cell bbox is fully OR partially inside the region.

    Straddling cells count as inside (safer than chopping).
    """
    if bbox is None:
        return False
    cx0, cy0, cx1, cy1 = bbox
    rx0, ry0, rx1, ry1 = region
    # overlap if NOT completely disjoint
    return not (cx1 < rx0 or cx0 > rx1 or cy1 < ry0 or cy0 > ry1)


def _strip_non_legend_cells(
    graph_root: ET.Element,
    legend_region: Optional[tuple[float, float, float, float]],
) -> None:
    """Delete every vertex AND edge cell that lives outside the Legend
    region. Sentinels (id=0, id=1) are preserved.

    If `legend_region` is None, delete all non-sentinel cells.
    """
    # Collect ids of vertex cells we're keeping, so edges between kept
    # cells can be kept too.
    kept_vertex_ids: set[str] = set()
    to_remove: list[ET.Element] = []

    # Build parent→child map so we can remove cleanly
    for child in list(graph_root):
        # child can be <mxCell> (direct) or <object> / <UserObject> wrapping one
        tag = child.tag
        if tag == "mxCell":
            cell = child
        else:
            cell = child.find("mxCell")
            if cell is None:
                # weird wrapper, keep it
                continue

        cid = cell.get("id")
        if cid in ("0", "1"):
            continue

        if cell.get("vertex") == "1":
            bb = _cell_bbox(cell)
            if legend_region and _inside_region(bb, legend_region):
                if cid:
                    kept_vertex_ids.add(cid)
            else:
                to_remove.append(child)
        elif cell.get("edge") == "1":
            # Second pass handles edges (need to know kept_vertex_ids
            # first). Tag for now and skip.
            continue
        else:
            # non-vertex, non-edge, non-sentinel: preserve (e.g. groups)
            pass

    # Second pass for edges — keep only if BOTH endpoints kept
    for child in list(graph_root):
        tag = child.tag
        cell = child if tag == "mxCell" else child.find("mxCell")
        if cell is None:
            continue
        if cell.get("edge") != "1":
            continue
        src = cell.get("source")
        tgt = cell.get("target")
        if src in kept_vertex_ids and tgt in kept_vertex_ids:
            continue
        to_remove.append(child)

    for el in to_remove:
        graph_root.remove(el)


# ── hub-and-spoke layout ─────────────────────────────────────────


def _dedupe_apps(apps: list[dict]) -> list[dict]:
    """Drop duplicate app_ids (first-win). Apps without app_id are kept."""
    seen: set[str] = set()
    out: list[dict] = []
    for a in apps:
        aid = a.get("app_id")
        if aid:
            if aid in seen:
                continue
            seen.add(aid)
        out.append(a)
    return out


def _split_apps_by_role(apps: list[dict]) -> tuple[list[dict], list[dict]]:
    """Return (majors, surrounds). Majors = role in {major, primary}.

    If there are no majors, promote the first surround to major so the
    hub has a center.
    """
    majors: list[dict] = []
    surrounds: list[dict] = []
    for a in apps:
        role = a.get("role") or "major"
        if role in ("major", "primary"):
            majors.append(a)
        else:
            surrounds.append(a)
    if not majors and surrounds:
        majors.append(surrounds.pop(0))
    return majors, surrounds


def _compute_canvas_bounds(
    legend_region: Optional[tuple[float, float, float, float]],
) -> tuple[float, float, float, float]:
    """Return (xmin, ymin, xmax, ymax) of the hub-spoke canvas."""
    if legend_region is None:
        xmin = float(_CANVAS_LEFT_MARGIN)
        ymin = float(_CANVAS_LEFT_MARGIN)
    else:
        xmin = legend_region[0]
        ymin = legend_region[3] + _CANVAS_TOP_GAP
    width = max(_CANVAS_MIN_WIDTH, (legend_region[2] - legend_region[0]) if legend_region else _CANVAS_MIN_WIDTH)
    xmax = xmin + width
    ymax = ymin + _CANVAS_MIN_HEIGHT
    return (xmin, ymin, xmax, ymax)


def _place_major_cluster(
    graph_root: ET.Element,
    majors: list[dict],
    canvas: tuple[float, float, float, float],
) -> tuple[dict[str, str], tuple[float, float]]:
    """Draw the major app boxes vertically stacked around canvas center.

    First major (index 0) is the CENTRAL major — placed exactly at canvas
    center. Additional majors stack above it in reading order.

    Returns (app_id_to_cell_id, center_of_central_major).
    """
    cxmin, cymin, cxmax, cymax = canvas
    ccx = (cxmin + cxmax) / 2
    ccy = (cymin + cymax) / 2

    app_to_cell_id: dict[str, str] = {}
    # Central major at index 0; extras stack ABOVE it
    n_extras = len(majors) - 1
    total_extras_h = n_extras * (_MAJOR_BOX_H + _MAJOR_STACK_GAP)
    # Top of extras block — so central major stays at ccy
    top_y = ccy - _MAJOR_BOX_H / 2 - total_extras_h

    for i, app in enumerate(majors):
        if i == 0:
            x = ccx - _MAJOR_BOX_W / 2
            y = ccy - _MAJOR_BOX_H / 2
        else:
            x = ccx - _MAJOR_BOX_W / 2
            # Extras go ABOVE the central — index 1 is topmost, index n-1
            # just above the central.
            y = top_y + (i - 1) * (_MAJOR_BOX_H + _MAJOR_STACK_GAP)

        cell_id = _emit_app_cell(
            graph_root, app, x, y,
            _MAJOR_BOX_W, _MAJOR_BOX_H, role="major",
        )
        if app.get("app_id"):
            app_to_cell_id[app["app_id"]] = cell_id

    return app_to_cell_id, (ccx, ccy)


def _place_surround_ring(
    graph_root: ET.Element,
    surrounds: list[dict],
    hub_center: tuple[float, float],
) -> dict[str, str]:
    """Arrange surround apps on a circle around the hub center."""
    if not surrounds:
        return {}
    n = len(surrounds)
    hub_cx, hub_cy = hub_center

    # Radius sized so boxes don't collide. Box diagonal ≈ 200; require
    # arc-length between box centers ≥ diag + margin.
    box_diag = math.hypot(_SURROUND_BOX_W, _SURROUND_BOX_H)
    arc_needed = (box_diag + 40) * n
    radius_from_circumference = max(arc_needed / (2 * math.pi), 0)
    radius = max(_SURROUND_RING_MIN_R, int(radius_from_circumference))

    # First surround at 12 o'clock, going clockwise
    app_to_cell_id: dict[str, str] = {}
    for i, app in enumerate(surrounds):
        theta = -math.pi / 2 + 2 * math.pi * i / n
        cx = hub_cx + radius * math.cos(theta)
        cy = hub_cy + radius * math.sin(theta)
        x = cx - _SURROUND_BOX_W / 2
        y = cy - _SURROUND_BOX_H / 2
        cell_id = _emit_app_cell(
            graph_root, app, x, y,
            _SURROUND_BOX_W, _SURROUND_BOX_H, role="surround",
        )
        if app.get("app_id"):
            app_to_cell_id[app["app_id"]] = cell_id
    return app_to_cell_id


def _emit_app_cell(
    graph_root: ET.Element,
    app: dict,
    x: float, y: float, w: float, h: float,
    role: str,
) -> str:
    """Create a new vertex mxCell + geometry and return its id."""
    cell_id = _new_cell_id()
    cell = ET.SubElement(graph_root, "mxCell")
    cell.set("id", cell_id)
    cell.set("value", _app_label(app))
    cell.set("style", _app_style(app.get("planned_status", "keep"), role=role))
    cell.set("vertex", "1")
    cell.set("parent", "1")

    geom = ET.SubElement(cell, "mxGeometry")
    geom.set("x", f"{x:.1f}")
    geom.set("y", f"{y:.1f}")
    geom.set("width", str(int(w)))
    geom.set("height", str(int(h)))
    geom.set("as", "geometry")
    return cell_id


def _emit_edges(
    graph_root: ET.Element,
    interfaces: list[dict],
    app_to_cell_id: dict[str, str],
) -> int:
    """Create one edge cell per interface where both endpoints landed on
    the canvas. Returns the number of edges emitted.
    """
    emitted = 0
    for iface in interfaces:
        src_id = app_to_cell_id.get(iface.get("from_app"))
        tgt_id = app_to_cell_id.get(iface.get("to_app"))
        if not src_id or not tgt_id:
            continue
        if src_id == tgt_id:
            continue  # no self-loops (same app id on both ends)

        platform = iface.get("platform") or ""
        iface_name = iface.get("interface_name") or ""
        planned = iface.get("planned_status", "change")

        edge = ET.SubElement(graph_root, "mxCell")
        edge.set("id", _new_cell_id())
        edge.set("style", _edge_style(platform, planned))
        edge.set("edge", "1")
        edge.set("parent", "1")
        edge.set("source", src_id)
        edge.set("target", tgt_id)
        if iface_name or platform:
            label = f"{platform}: {iface_name}" if platform else iface_name
            edge.set("value", label[:60])

        geom = ET.SubElement(edge, "mxGeometry")
        geom.set("relative", "1")
        geom.set("as", "geometry")
        emitted += 1
    return emitted


# ── main entry ────────────────────────────────────────────────────


def _find_graph_root_in_mxfile(mxfile_root: ET.Element) -> Optional[ET.Element]:
    """Return the first <diagram> element in a <mxfile>, or None."""
    for diagram in mxfile_root.iter("diagram"):
        return diagram
    return None


def generate_as_is_xml(
    template_xml: Optional[str],
    apps: list[dict],
    interfaces: list[dict],
) -> str:
    """Generate the AS-IS drawio XML for a new design.

    Contract:
      - Legend band at the top of the template is preserved byte-for-byte.
      - Everything else in the template is cleared.
      - A fresh hub-and-spoke layout is drawn beneath the Legend: first
        major at canvas center, extra majors stacked above, surrounds on
        a circle around the hub, interfaces as edges fanning out.

    Idempotent modulo cell UUIDs.
    """
    xml_text = template_xml if (template_xml and template_xml.strip()) else _BLANK_DRAWIO_XML

    try:
        tree_root = ET.fromstring(xml_text)
    except ET.ParseError:
        tree_root = ET.fromstring(_BLANK_DRAWIO_XML)

    diagram = _find_graph_root_in_mxfile(tree_root)
    if diagram is None:
        tree_root = ET.fromstring(_BLANK_DRAWIO_XML)
        diagram = _find_graph_root_in_mxfile(tree_root)
    assert diagram is not None

    was_compressed, graph_model = _extract_graph_model(diagram)
    if graph_model is None:
        tree_root = ET.fromstring(_BLANK_DRAWIO_XML)
        diagram = _find_graph_root_in_mxfile(tree_root)
        assert diagram is not None
        was_compressed, graph_model = _extract_graph_model(diagram)
        assert graph_model is not None

    graph_root = graph_model.find("root")
    if graph_root is None:
        graph_root = ET.SubElement(graph_model, "root")
        ET.SubElement(graph_root, "mxCell", id="0")
        ET.SubElement(graph_root, "mxCell", id="1", parent="0")

    # Step 1: detect Legend, strip everything else
    legend_region = _detect_legend_region(graph_root)
    _strip_non_legend_cells(graph_root, legend_region)

    # Step 2: nothing to draw? return the stripped template as-is
    apps = _dedupe_apps(apps or [])
    if not apps:
        _set_graph_model(diagram, was_compressed, graph_model)
        xml_bytes = ET.tostring(tree_root, encoding="utf-8", xml_declaration=False)
        return xml_bytes.decode("utf-8")

    # Step 3: hub-and-spoke layout
    canvas = _compute_canvas_bounds(legend_region)
    majors, surrounds = _split_apps_by_role(apps)

    major_map, hub_center = _place_major_cluster(graph_root, majors, canvas)
    surround_map = _place_surround_ring(graph_root, surrounds, hub_center)

    app_to_cell_id: dict[str, str] = {}
    app_to_cell_id.update(major_map)
    app_to_cell_id.update(surround_map)

    # Step 4: edges
    _emit_edges(graph_root, interfaces or [], app_to_cell_id)

    # Step 5: repack
    _set_graph_model(diagram, was_compressed, graph_model)
    xml_bytes = ET.tostring(tree_root, encoding="utf-8", xml_declaration=False)
    return xml_bytes.decode("utf-8")
