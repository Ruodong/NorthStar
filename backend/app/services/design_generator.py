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
import logging
import math
import re
import urllib.parse
import uuid
import zlib
from typing import Optional
from xml.etree import ElementTree as ET

logger = logging.getLogger(__name__)


# Colors by planned_status (CMDB app lifecycle).
_APP_STATUS_STYLE: dict[str, str] = {
    "keep":   "fillColor=#dae8fc;strokeColor=#6c8ebf;",
    "change": "fillColor=#fff2cc;strokeColor=#d6b656;",
    "new":    "fillColor=#d5e8d4;strokeColor=#82b366;",
    "sunset": "fillColor=#f8cecc;strokeColor=#b85450;",
}

# Surround Applications — apps referenced by interfaces but not chosen by
# the architect in the Apps panel. Per the architect's Legend ("Existing"
# = keep = blue), surround boxes use the keep color so the architect can
# read them as "already present, context for the major change."

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

_LEGEND_LABEL_RE = re.compile(
    # English: legend / illustrative / key / reference
    # Chinese: 图例 (legend), 示例 (example/illustration), 说明 (description/key)
    r"legend|illustrative|图例|示例|说明|图示",
    re.IGNORECASE,
)
# Stricter Legend marker — we prefer a cell whose text is *just* "Legend"
# (or the Chinese equivalent) over broader hits like "Illustrative" or
# "System description". When both exist in the same template, the
# narrower one identifies the actual Legend box's interior, while
# "Illustrative" is usually a separate sticky outside it.
_LEGEND_STRICT_RE = re.compile(r"\b(legend|图例)\b", re.IGNORECASE)
_LEGEND_TOP_FRACTION = 0.40   # top 40% of graph bbox
_LEGEND_CLUSTER_GAP = 60.0    # cluster split threshold
_LEGEND_PADDING = 20.0

# Hub-and-spoke canvas geometry.
_CANVAS_MIN_WIDTH = 1400
_CANVAS_MIN_HEIGHT = 900
_CANVAS_LEFT_MARGIN = 40
_CANVAS_TOP_GAP = 80         # gap below the Legend band

_MAJOR_BOX_W = 260
_SURROUND_BOX_W = 200
_MAJOR_STACK_GAP = 20         # gap between stacked major boxes
_COLUMN_GAP_X = 120           # horizontal gap from Major center-edge to Surround column
_ROW_GAP_Y = 18               # vertical gap between stacked Surround boxes
_BLOCK_H_MIN = 55             # minimum renderable box height
_BLOCK_H_MAX = 120            # cap — even with 1 surround, boxes shouldn't be huge

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
    """Build the raw-HTML cell label: ID and Name only.

    The architect asked for a minimum-ink box — just the CMDB ID and the
    app name (bold). No description, no role prefix, no status tag. The
    Legend carries the color semantics.

    ET.set("value", …) will XML-escape < and > on serialization — do NOT
    pre-escape here, otherwise drawio shows literal `&lt;b&gt;`.
    """
    app_id = app.get("app_id") or ""
    name = app.get("name") or app.get("app_name") or ""
    lines: list[str] = []
    if app_id:
        lines.append(f"ID: {app_id}")
    if name:
        lines.append(f"<b>{name}</b>")
    return "<br>".join(lines) or (name or app_id)


def _app_style(planned_status: str, role: str = "major") -> str:
    """Style string for a freshly drawn app box.

    Color mapping per the architect's Legend:
      - Major → "Modify" (change / yellow) by default. Only explicit
        `new` or `sunset` deviate. `keep` is treated as Modify because
        the wizard's default for `planned_status` is `keep` for every
        app-in-scope, and a hub-and-spoke design IS a change on the
        Major — so `keep` on a Major is almost always just the wizard
        default leaking through, not an architect intent. Architects
        who truly want a blue Major can mark the app as Surround.
      - Surround → "Existing" (keep / blue), regardless of status. The
        Major's own planned_status is what the design is *about*;
        surround boxes are stable context, so we don't flag them with
        new/sunset/change colors even if the underlying app carries
        those.
    """
    if role == "surround":
        base = _APP_STATUS_STYLE["keep"]
    else:
        # Only 'new' / 'sunset' override the Major's default Modify color.
        if planned_status in ("new", "sunset"):
            base = _APP_STATUS_STYLE[planned_status]
        else:
            base = _APP_STATUS_STYLE["change"]
    return (
        "rounded=1;whiteSpace=wrap;html=1;"
        + base
        + "align=center;verticalAlign=middle;fontSize=12;"
    )


def _edge_style(platform: str, planned_status: str) -> str:
    """Edge style: orthogonal routing, Modify-yellow by default.

    Interfaces that make it into a design are by definition part of the
    change — they've been explicitly picked from the catalog and carried
    into this architecture. So every edge renders with the Legend's
    'Modify / Changed Interface' color (#d6b656) unless planned_status
    is explicitly `new` (green dashed) or `sunset` (red dotted).

    Routing is always `orthogonalEdgeStyle` (90° turns). drawio routes
    straight through when source and target align, so horizontally-
    aligned Major ↔ Surround pairs render as a single straight line with
    no bends.

    The `platform` parameter is preserved in the signature for
    back-compat but no longer affects color.
    """
    _ = platform  # intentionally unused
    # Soft orthogonal routing: rounded corners, auto-avoid bends when
    # source/target align (drawio handles this natively via
    # orthogonalEdgeStyle). arcSize tunes the corner radius.
    # Label placement:
    #   verticalAlign=bottom  → label text sits ABOVE the line, not on it
    #   labelBackgroundColor  → white halo so the text stays readable
    #                           when the line passes through other cells
    base = (
        "edgeStyle=orthogonalEdgeStyle;"
        "rounded=1;arcSize=12;"
        "orthogonalLoop=1;jettySize=auto;"
        "endArrow=classic;html=1;"
        "strokeColor=#d6b656;strokeWidth=2;"
        "fontSize=10;fontColor=#333;"
        "verticalAlign=bottom;align=center;"
        "labelBackgroundColor=#ffffff;"
    )
    if planned_status == "new":
        base += "strokeColor=#82b366;dashPattern=8 4;"  # Green, dashed = New
    elif planned_status == "sunset":
        base += "strokeColor=#b85450;dashPattern=2 2;"  # Red, dotted = Sunset
    # planned_status in ("keep", "change", or unset) keeps the Modify yellow
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


_HTML_TAG_RE = re.compile(r"<[^>]+>")


def _clean_text(s: str) -> str:
    """Strip HTML tags and collapse whitespace."""
    return " ".join(_HTML_TAG_RE.sub(" ", s).split())


def _collect_marker_texts(graph_root: ET.Element) -> list[tuple[ET.Element, str]]:
    """Return (cell, cleaned-text) for every vertex cell plus every
    <object>/<UserObject> wrapper. Wrappers' attrs (label, c4Name,
    c4Description) carry the visible label when the inner ``mxCell`` has
    an empty value.
    """
    out: list[tuple[ET.Element, str]] = []
    seen_cells: set[int] = set()
    for obj in graph_root.iter():
        if obj.tag in ("object", "UserObject"):
            inner = obj.find("mxCell")
            if inner is None or inner.get("vertex") != "1":
                continue
            text_parts: list[str] = []
            for attr in ("label", "c4Name", "c4Description"):
                v = obj.get(attr)
                if v:
                    text_parts.append(v)
            v = (inner.get("value") or "").strip()
            if v:
                text_parts.append(v)
            text = _clean_text(" ".join(text_parts))
            if text:
                out.append((inner, text))
                seen_cells.add(id(inner))
    for cell in graph_root.iter("mxCell"):
        if cell.get("id") in ("0", "1"):
            continue
        if cell.get("vertex") != "1":
            continue
        if id(cell) in seen_cells:
            continue
        v = (cell.get("value") or "").strip()
        if not v:
            continue
        text = _clean_text(v)
        if text:
            out.append((cell, text))
    return out


def _bbox_contains(outer: tuple[float, float, float, float],
                   inner: tuple[float, float, float, float]) -> bool:
    """True if ``outer`` geometrically contains ``inner`` (edges may touch)."""
    return (outer[0] <= inner[0] and outer[1] <= inner[1]
            and outer[2] >= inner[2] and outer[3] >= inner[3])


def _bbox_area(bb: tuple[float, float, float, float]) -> float:
    return max(0.0, bb[2] - bb[0]) * max(0.0, bb[3] - bb[1])


def _smallest_enclosing_bbox(
    target: tuple[float, float, float, float],
    candidates: list[tuple[ET.Element, tuple[float, float, float, float]]],
    exclude: Optional[ET.Element] = None,
) -> Optional[tuple[float, float, float, float]]:
    """Return the bbox of the smallest-area vertex that geometrically
    CONTAINS target (and is strictly bigger than target). None if none.
    """
    best: Optional[tuple[float, float, float, float]] = None
    best_area = float("inf")
    target_area = _bbox_area(target)
    for c, bb in candidates:
        if exclude is not None and c is exclude:
            continue
        if not _bbox_contains(bb, target):
            continue
        area = _bbox_area(bb)
        if area <= target_area:
            continue  # same bbox or smaller — doesn't count as "container"
        if area < best_area:
            best = bb
            best_area = area
    return best


def _detect_legend_region(
    graph_root: ET.Element,
) -> Optional[tuple[float, float, float, float]]:
    """Return the Legend bbox (xmin, ymin, xmax, ymax) or None.

    Detection strategies, first-match wins:

    1. **Explicit marker** — any cell whose visible text (value, or its
       wrapping ``<object>``'s ``label``/``c4Name``/``c4Description``)
       matches /legend|illustrative/i. To find the *container* (the box
       that encloses the marker and all its contents):

         a. The marker's drawio ``parent`` (if non-sentinel). Use the
            parent cell's bbox unioned with all children sharing that
            parent.
         b. The smallest vertex cell that geometrically CONTAINS the
            marker's bbox. Everything inside that bbox is Legend.
         c. The marker cell's own bbox (last resort — the marker IS the
            Legend).

    2. **Top-band cluster** — group vertex cells by y-position, clusters
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

    # Strategy 1 — explicit marker. Prefer the strict "Legend" / "图例"
    # marker first; that text usually lives inside the Legend's inner
    # box. Fall back to the broader regex (which also matches
    # "Illustrative" / "说明") only if no strict hit exists. This means
    # a template with both an "Illustrative" sticky and a "Legend" box
    # will correctly collapse onto the Legend box, and the Illustrative
    # sticky gets cleared with the rest of the template body.
    marker_cell: Optional[ET.Element] = None
    marker_bbox: Optional[tuple[float, float, float, float]] = None
    marker_texts = list(_collect_marker_texts(graph_root))
    for cell, text in marker_texts:
        if _LEGEND_STRICT_RE.search(text):
            marker_cell = cell
            marker_bbox = _cell_bbox(cell)
            if marker_bbox is not None:
                break
    if marker_cell is None:
        for cell, text in marker_texts:
            if _LEGEND_LABEL_RE.search(text):
                marker_cell = cell
                marker_bbox = _cell_bbox(cell)
                if marker_bbox is not None:
                    break
    if marker_cell is not None and marker_bbox is not None:
        # (a) Explicit drawio parent — use the parent cell's own bbox.
        # drawio groups carry their own geometry (union of children +
        # padding); children use RELATIVE coords and can't be safely
        # unioned into absolute space from here.
        parent = marker_cell.get("parent")
        if parent and parent not in ("0", "1"):
            for c, bb in vertex_bboxes:
                if c.get("id") == parent:
                    return (
                        bb[0] - _LEGEND_PADDING,
                        bb[1] - _LEGEND_PADDING,
                        bb[2] + _LEGEND_PADDING,
                        bb[3] + _LEGEND_PADDING,
                    )
            # Parent id doesn't resolve to a vertex — fall through.

        # (b) Geometric enclosure — find the smallest vertex containing
        #     the marker. This picks up "the outer rectangle that has
        #     the Legend text inside it" even when there's no parent link.
        container_bb = _smallest_enclosing_bbox(
            marker_bbox, vertex_bboxes, exclude=marker_cell,
        )
        if container_bb is not None:
            return (
                container_bb[0] - _LEGEND_PADDING,
                container_bb[1] - _LEGEND_PADDING,
                container_bb[2] + _LEGEND_PADDING,
                container_bb[3] + _LEGEND_PADDING,
            )

        # (c) Marker-only. The Legend text IS the legend (e.g. a lone
        #     "Illustrative" sticky with nothing containing it). Treat
        #     the marker cell as a protected 1-cell region and let
        #     Strategy 2 try to augment via the top-band heuristic.
        # → fall through to Strategy 2

    # Strategy 2 — top-band cluster
    # Overall graph bbox
    all_bbs = [bb for _, bb in vertex_bboxes]
    gmin_y = min(b[1] for b in all_bbs)
    gmax_y = max(b[3] for b in all_bbs)
    total_h = gmax_y - gmin_y
    if total_h <= 0:
        return None

    # Sort cells by y-TOP edge. Cluster by gap between consecutive tops.
    # IMPORTANT: we intentionally do NOT use the max-bottom seen so far to
    # define "last y" — in real EA templates a tall background container
    # spanning both Legend and body regions would collapse the whole graph
    # into a single cluster. Top-to-top gap is a property of *where cells
    # start*, not how big they are, so an oversized container doesn't
    # contaminate the clustering.
    sorted_cells = sorted(vertex_bboxes, key=lambda cb: cb[1][1])
    clusters: list[list[tuple[ET.Element, tuple[float, float, float, float]]]] = [[]]
    last_top: Optional[float] = None
    for c, bb in sorted_cells:
        y_top = bb[1]
        if last_top is None or (y_top - last_top) <= _LEGEND_CLUSTER_GAP:
            clusters[-1].append((c, bb))
        else:
            clusters.append([(c, bb)])
        last_top = y_top

    if not clusters or not clusters[0]:
        return None
    top_cluster = clusters[0]
    if len(top_cluster) < 3:
        return None

    # Cap the Legend region's bottom at the NEXT cluster's top-edge minus
    # a small margin. Without this, a tall container in the top cluster
    # (bbox extending into body territory) would pull the region down and
    # wrongly protect body cells.
    top_cluster_ymax = max(bb[3] for _, bb in top_cluster)
    if len(clusters) >= 2 and clusters[1]:
        next_cluster_ymin = min(bb[1] for _, bb in clusters[1])
        top_cluster_ymax = min(top_cluster_ymax, next_cluster_ymin - 5)

    # Top cluster must sit within the top _LEGEND_TOP_FRACTION of the bbox
    if (top_cluster_ymax - gmin_y) / total_h > _LEGEND_TOP_FRACTION:
        return None

    xmin = min(bb[0] for _, bb in top_cluster) - _LEGEND_PADDING
    ymin = min(bb[1] for _, bb in top_cluster) - _LEGEND_PADDING
    xmax = max(bb[2] for _, bb in top_cluster) + _LEGEND_PADDING
    ymax = top_cluster_ymax + _LEGEND_PADDING
    return (xmin, ymin, xmax, ymax)


_BODY_OVERHANG_TOLERANCE = 40.0


def _inside_region(
    bbox: Optional[tuple[float, float, float, float]],
    region: tuple[float, float, float, float],
) -> bool:
    """Return True if cell bbox is inside (or minor-straddle of) the region.

    Strict rule: a cell's bottom edge must not extend more than
    _BODY_OVERHANG_TOLERANCE px BELOW the region's bottom. This excludes
    tall 'body container' cells that happen to start inside the Legend
    band but extend through the whole canvas — without this rule, the
    transitive parent-chain propagation would drag every descendant of
    that container back into the kept set.

    Minor top overhang is allowed so cells touching the Legend's top
    padding (like a Legend-box title sitting slightly above) still count.
    """
    if bbox is None:
        return False
    cx0, cy0, cx1, cy1 = bbox
    rx0, ry0, rx1, ry1 = region
    # Reject cells extending significantly below the region — typical of
    # body containers that accidentally straddle the Legend.
    if (cy1 - ry1) > _BODY_OVERHANG_TOLERANCE:
        return False
    # overlap if NOT completely disjoint
    return not (cx1 < rx0 or cx0 > rx1 or cy1 < ry0 or cy0 > ry1)


def _strip_non_legend_cells(
    graph_root: ET.Element,
    legend_region: Optional[tuple[float, float, float, float]],
) -> None:
    """Preserve ALL cells whose parent chain lands inside the Legend
    region, plus edges connecting them, plus child labels of those edges.
    Everything else is deleted. Sentinels (id=0, id=1) are never touched.

    Propagation is transitive:
      1. Vertex whose bbox overlaps the Legend region → kept.
      2. Any cell whose drawio parent is kept → kept (children of kept
         groups stay with them).
      3. Edge whose source AND target are both kept → kept.
      4. Any cell whose parent is a kept edge → kept (edge labels like
         the Legend's "Exist Interface" / "Changed Interface" captions).
      5. Iterate 2–4 until stable.

    If `legend_region` is None, delete every non-sentinel cell.
    """
    # Build index over direct children of graph_root. Each child is
    # either <mxCell> or <object>/<UserObject> wrapping an <mxCell>.
    # Track three separate lists so we can strip untagged cells too:
    # some real templates contain <mxCell> elements with no `id` attr
    # (a drawio export oddity). Those would slip past an id-based
    # strip and leak template body rectangles into the output.
    all_children: list[tuple[ET.Element, ET.Element, Optional[str]]] = []
    id_to_cell: dict[str, ET.Element] = {}
    parent_of: dict[str, str] = {}
    for child in list(graph_root):
        if child.tag == "mxCell":
            cell = child
        else:
            cell = child.find("mxCell")
            if cell is None:
                continue
        cid = cell.get("id")
        all_children.append((child, cell, cid))
        if cid and cid not in ("0", "1"):
            id_to_cell[cid] = cell
            pid = cell.get("parent")
            if pid:
                parent_of[cid] = pid

    # Strip everything when there's no Legend to protect.
    if legend_region is None:
        for wrapper, _cell, cid in all_children:
            if cid in ("0", "1"):
                continue
            graph_root.remove(wrapper)
        return

    # Seed: ONLY root-level vertex cells whose bbox overlaps the region.
    # Nested cells (parent != "1" / "0") use drawio-relative coords, so
    # their bbox is in parent-local space and can't be compared to the
    # absolute Legend region. They inherit kept-ness via the parent chain
    # in the propagation step below.
    kept: set[str] = set()
    for cid, cell in id_to_cell.items():
        if cell.get("vertex") != "1":
            continue
        parent = cell.get("parent") or ""
        if parent not in ("", "1", "0"):
            continue
        bb = _cell_bbox(cell)
        if _inside_region(bb, legend_region):
            kept.add(cid)

    # Propagate kept via parent-chain + edge-endpoint rules until stable.
    while True:
        grew = False
        # Any cell whose parent is kept is also kept (children of groups
        # AND edge labels whose parent edge is kept).
        for cid, pid in parent_of.items():
            if cid not in kept and pid in kept:
                kept.add(cid)
                grew = True
        # Any edge whose both endpoints are kept is also kept.
        for cid, cell in id_to_cell.items():
            if cid in kept:
                continue
            if cell.get("edge") != "1":
                continue
            src = cell.get("source")
            tgt = cell.get("target")
            # Orphan edges (no source/target) or edges touching a kept
            # vertex on both sides qualify.
            if src and tgt and src in kept and tgt in kept:
                kept.add(cid)
                grew = True
        if not grew:
            break

    # Remove cells not in kept. Untagged cells (no id) are always
    # stripped — they can never be referenced by an edge source/target,
    # can never be a parent in the chain, and can never carry a Legend
    # marker that would make them semantically important.
    for wrapper, _cell, cid in all_children:
        if cid in ("0", "1"):
            continue
        if not cid or cid not in kept:
            graph_root.remove(wrapper)


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
    """Return (majors, surrounds).

    Multiple Majors are supported — they stack vertically in the middle
    column, each rendered with the full Modify color. This is how an
    architect expresses "these two apps are both central to the change
    I'm making." Surround apps flank the Major cluster in left/right
    columns.

    If no Major/Primary is supplied, the first app is promoted to Major
    so the hub has a center.
    """
    majors: list[dict] = []
    others: list[dict] = []
    for a in apps:
        role = a.get("role") or "major"
        if role in ("major", "primary"):
            majors.append(a)
        else:
            others.append(a)

    if not majors and others:
        majors.append(others.pop(0))
    return majors, others


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


def _compute_block_height(
    n_surrounds: int,
    canvas_height: float,
) -> float:
    """Pick a common block height for Major + Surround so everything reads
    at roughly the same vertical size on the page.

    Height is driven by the LARGER of the two surround columns (left/right)
    so that column fits within the canvas height. Clamped to
    [_BLOCK_H_MIN, _BLOCK_H_MAX].
    """
    if n_surrounds <= 0:
        return _BLOCK_H_MAX
    per_side = max(1, math.ceil(n_surrounds / 2))
    usable = canvas_height - _ROW_GAP_Y * (per_side - 1)
    h = usable / per_side
    return max(_BLOCK_H_MIN, min(_BLOCK_H_MAX, h))


def _place_major_cluster(
    graph_root: ET.Element,
    majors: list[dict],
    hub_cx: float,
    cluster_top_y: float,
    block_h: float,
) -> tuple[dict[str, str], dict[str, dict], tuple[float, float]]:
    """Stack Major app boxes vertically, centered horizontally on `hub_cx`.

    Returns (app_to_cell_id, app_to_info, cluster_center). The
    app_to_info dict carries {col, cx, cy} for each placed app so the
    edge emitter can pick the right left/right/top/bottom anchor.
    """
    app_to_cell_id: dict[str, str] = {}
    app_to_info: dict[str, dict] = {}
    x = hub_cx - _MAJOR_BOX_W / 2

    for i, app in enumerate(majors):
        y = cluster_top_y + i * (block_h + _MAJOR_STACK_GAP)
        cell_id = _emit_app_cell(
            graph_root, app, x, y,
            _MAJOR_BOX_W, block_h, role="major",
        )
        aid = app.get("app_id")
        if aid:
            app_to_cell_id[aid] = cell_id
            app_to_info[aid] = {
                "col": "center",
                "cx": hub_cx,
                "cy": y + block_h / 2,
            }

    cluster_h = len(majors) * block_h + max(0, len(majors) - 1) * _MAJOR_STACK_GAP
    cluster_cy = cluster_top_y + cluster_h / 2
    return app_to_cell_id, app_to_info, (hub_cx, cluster_cy)


def _place_surround_columns(
    graph_root: ET.Element,
    surrounds: list[dict],
    hub_cx: float,
    cluster_top_y: float,
    major_count: int,
    block_h: float,
) -> tuple[dict[str, str], dict[str, dict]]:
    """Arrange Surround apps in two vertical columns flanking the Major.

    - Left column: even-indexed surrounds (0, 2, 4, …)
    - Right column: odd-indexed surrounds (1, 3, 5, …)
    - Each column's TOP is pinned to `cluster_top_y`, same as the Major
      cluster. So the first row reads as: [LeftS0] [Major0] [RightS0].
      When a column is LONGER than the Major stack, the extra surrounds
      fill downward. When SHORTER, the column is vertically centered
      within the Major stack's height so it doesn't look lopsided.
    - Box height = block_h (matches the Major) so all blocks read the
      same visual size.
    - Column x offset: Major's right edge + _COLUMN_GAP_X for right
      column; mirror for left.
    """
    if not surrounds:
        return {}, {}

    left: list[dict] = []
    right: list[dict] = []
    for i, app in enumerate(surrounds):
        (left if i % 2 == 0 else right).append(app)

    left_x = hub_cx - _MAJOR_BOX_W / 2 - _COLUMN_GAP_X - _SURROUND_BOX_W
    right_x = hub_cx + _MAJOR_BOX_W / 2 + _COLUMN_GAP_X

    def _col_top_y(n_in_col: int) -> float:
        """Pin column top at cluster_top_y. If column is shorter than the
        Major stack, center it within the Major stack's height so the
        mid-row row's middle aligns with the Major cluster middle."""
        col_h = n_in_col * block_h + max(0, n_in_col - 1) * _ROW_GAP_Y
        major_h = major_count * block_h + max(0, major_count - 1) * _MAJOR_STACK_GAP
        if col_h < major_h:
            return cluster_top_y + (major_h - col_h) / 2
        return cluster_top_y

    app_to_cell_id: dict[str, str] = {}
    app_to_info: dict[str, dict] = {}
    for col_apps, col_x, col_name in ((left, left_x, "left"), (right, right_x, "right")):
        top_y = _col_top_y(len(col_apps))
        for idx, app in enumerate(col_apps):
            y = top_y + idx * (block_h + _ROW_GAP_Y)
            cell_id = _emit_app_cell(
                graph_root, app, col_x, y,
                _SURROUND_BOX_W, block_h, role="surround",
            )
            aid = app.get("app_id")
            if aid:
                app_to_cell_id[aid] = cell_id
                app_to_info[aid] = {
                    "col": col_name,
                    "cx": col_x + _SURROUND_BOX_W / 2,
                    "cy": y + block_h / 2,
                }
    return app_to_cell_id, app_to_info


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
    # Role-based default when the caller omitted planned_status:
    # Major → Modify (the design is about it, so it's "changing"),
    # Surround → Existing (stable context).
    default_status = "change" if role != "surround" else "keep"
    cell.set("style", _app_style(app.get("planned_status") or default_status, role=role))
    cell.set("vertex", "1")
    cell.set("parent", "1")

    geom = ET.SubElement(cell, "mxGeometry")
    geom.set("x", f"{x:.1f}")
    geom.set("y", f"{y:.1f}")
    geom.set("width", str(int(w)))
    geom.set("height", str(int(h)))
    geom.set("as", "geometry")
    return cell_id


_COL_ORDER = {"left": 0, "center": 1, "right": 2}


def _anchor_style(src_info: dict, tgt_info: dict) -> str:
    """Return the exit*/entry* style fragment that forces the edge to
    connect on the LEFT/RIGHT side when the two apps live in different
    columns, or TOP/BOTTOM when they share a column.

    This prevents drawio's default routing from taking a shortcut
    through a neighbouring app box (e.g. routing SOC-ROW → KPAAS via
    SOC-ROW's bottom edge, which would cross LSC 2.0).
    """
    src_col = src_info.get("col")
    tgt_col = tgt_info.get("col")
    src_cy = src_info.get("cy", 0.0)
    tgt_cy = tgt_info.get("cy", 0.0)

    if src_col == tgt_col:
        # Same column → vertical connection. Exit from BOTTOM of the
        # upper cell, enter at TOP of the lower cell (or mirror).
        if tgt_cy > src_cy:
            return (
                "exitX=0.5;exitY=1;exitDx=0;exitDy=0;"
                "entryX=0.5;entryY=0;entryDx=0;entryDy=0;"
            )
        return (
            "exitX=0.5;exitY=0;exitDx=0;exitDy=0;"
            "entryX=0.5;entryY=1;entryDx=0;entryDy=0;"
        )

    # Different columns → horizontal connection. Exit from the SIDE of
    # the source that faces the target, enter on the opposite side.
    if _COL_ORDER.get(tgt_col, 1) > _COL_ORDER.get(src_col, 1):
        # target is to the RIGHT of source
        return (
            "exitX=1;exitY=0.5;exitDx=0;exitDy=0;"
            "entryX=0;entryY=0.5;entryDx=0;entryDy=0;"
        )
    # target is to the LEFT of source
    return (
        "exitX=0;exitY=0.5;exitDx=0;exitDy=0;"
        "entryX=1;entryY=0.5;entryDx=0;entryDy=0;"
    )


def _emit_edges(
    graph_root: ET.Element,
    interfaces: list[dict],
    app_to_cell_id: dict[str, str],
    app_to_info: Optional[dict[str, dict]] = None,
) -> int:
    """Create one edge cell per interface where both endpoints landed on
    the canvas. Returns the number of edges emitted.
    """
    app_to_info = app_to_info or {}
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

        # Anchor hint: force left/right-side connection for cross-column
        # edges, top/bottom for same-column edges.
        anchor = ""
        src_info = app_to_info.get(iface.get("from_app"))
        tgt_info = app_to_info.get(iface.get("to_app"))
        if src_info and tgt_info:
            anchor = _anchor_style(src_info, tgt_info)

        edge = ET.SubElement(graph_root, "mxCell")
        edge.set("id", _new_cell_id())
        edge.set("style", _edge_style(platform, planned) + anchor)
        edge.set("edge", "1")
        edge.set("parent", "1")
        edge.set("source", src_id)
        edge.set("target", tgt_id)
        # Edge label is interface_name only — platform/integration-tier
        # is intentionally omitted so the picture stays business-readable.
        if iface_name:
            edge.set("value", iface_name[:60])

        geom = ET.SubElement(edge, "mxGeometry")
        geom.set("relative", "1")
        geom.set("as", "geometry")
        # Lift the label ~12px above the line midpoint so long names
        # don't cut through the Major/Surround boxes the edge connects.
        # Combined with verticalAlign=bottom in the style, this puts the
        # text cleanly above the arrow.
        if iface_name:
            offset = ET.SubElement(geom, "mxPoint")
            offset.set("x", "0")
            offset.set("y", "-12")
            offset.set("as", "offset")
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
    if legend_region is None:
        # Flag this loudly — a template that shipped a Legend but whose
        # Legend we failed to detect means we'll clear the entire canvas
        # below (including the Legend), which is the bug the architect
        # was seeing. Surfaces in uvicorn logs on 71.
        vertex_count = sum(
            1 for c in graph_root.iter("mxCell")
            if c.get("vertex") == "1" and c.get("id") not in ("0", "1")
        )
        logger.warning(
            "design_generator: no Legend detected in template (%d vertex cells). "
            "Add a cell containing 'Legend' / 'Illustrative' / '图例' inside the "
            "region you want preserved, or rely on the top-band heuristic "
            "(top 40%% cluster of >=3 vertex cells separated by a 60px gap).",
            vertex_count,
        )
    else:
        logger.info(
            "design_generator: Legend region detected at (%.0f, %.0f, %.0f, %.0f)",
            *legend_region,
        )
    _strip_non_legend_cells(graph_root, legend_region)

    # Step 2: nothing to draw? return the stripped template as-is
    apps = _dedupe_apps(apps or [])
    if not apps:
        _set_graph_model(diagram, was_compressed, graph_model)
        xml_bytes = ET.tostring(tree_root, encoding="utf-8", xml_declaration=False)
        return xml_bytes.decode("utf-8")

    # Step 3: hub-and-spoke layout
    majors, surrounds = _split_apps_by_role(apps)
    canvas = _compute_canvas_bounds(legend_region)
    canvas_h = canvas[3] - canvas[1]
    block_h = _compute_block_height(len(surrounds), canvas_h)

    # Horizontal: Major cluster midline = Legend box midline (the
    # architect's mental model is "Major sits under the Legend's
    # example column, centered"). Falls back to canvas center when the
    # template has no Legend.
    if legend_region is not None:
        hub_cx = (legend_region[0] + legend_region[2]) / 2
    else:
        hub_cx = (canvas[0] + canvas[2]) / 2

    # Vertical: pin the Major cluster's TOP near the top of the usable
    # canvas so it connects to the Users-entry bracket just below the
    # Legend. Surround columns start at the same top.
    cluster_top_y = canvas[1]

    major_map, major_info, _hub_center = _place_major_cluster(
        graph_root, majors, hub_cx, cluster_top_y, block_h,
    )
    surround_map, surround_info = _place_surround_columns(
        graph_root, surrounds, hub_cx, cluster_top_y,
        major_count=len(majors), block_h=block_h,
    )

    app_to_cell_id: dict[str, str] = {}
    app_to_cell_id.update(major_map)
    app_to_cell_id.update(surround_map)
    app_to_info: dict[str, dict] = {}
    app_to_info.update(major_info)
    app_to_info.update(surround_info)

    # Step 4: edges
    _emit_edges(graph_root, interfaces or [], app_to_cell_id, app_to_info)

    # Step 5: repack
    _set_graph_model(diagram, was_compressed, graph_model)
    xml_bytes = ET.tostring(tree_root, encoding="utf-8", xml_declaration=False)
    return xml_bytes.decode("utf-8")
