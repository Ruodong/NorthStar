"""Architecture Design — AS-IS drawio XML generator.

Given a chosen drawio template, a list of apps (role + planned_status),
and a list of interfaces, produce a new drawio XML that:

  1. Unpacks the template's compressed <diagram> content (pako format:
     base64 → raw-deflate → url-decoded mxGraphModel). Confluence stores
     drawio diagrams compressed; raw ET can't see the <mxCell> nodes
     otherwise.
  2. Locates every substitutable "app slot" inside the template using
     three stacking strategies:
       a) <object c4Name="…" c4Type="Software System|Container|…">
       b) <mxCell value="…A\\d{5,6}…"> — legacy EGM exports
       c) <mxCell style="rounded=1;fillColor=#…;"> of app-box size —
          heuristic fallback for templates that don't use either marker
  3. Substitutes user-selected apps into those slots in (y, x) reading
     order, preferring primary (major) apps first, then related, then
     external. Each substituted cell is recolored by planned_status
     (change → yellow, new → green, sunset → red, keep → blue).
  4. Adds new cells for any overflow apps below the template.
  5. Adds edges for every selected interface, styled by platform and
     planned_status.
  6. Re-compresses the <diagram> content back into pako format when the
     original was compressed.

The architect then edits this canvas inside the drawio embed; the
result is saved via PUT /api/design/{id}/drawio.
"""
from __future__ import annotations

import base64
import re
import urllib.parse
import uuid
import zlib
from typing import Optional
from xml.etree import ElementTree as ET


# Legacy EGM placeholder detector — "ID: A123456" or bare "A123456".
_PLACEHOLDER_APP_ID_RE = re.compile(
    r"(?:ID:\s*)?\b(A\d{5,6})\b", re.IGNORECASE
)


# Colors by planned_status (CMDB app lifecycle).
_APP_STATUS_STYLE: dict[str, str] = {
    "keep":   "fillColor=#dae8fc;strokeColor=#6c8ebf;",
    "change": "fillColor=#fff2cc;strokeColor=#d6b656;",
    "new":    "fillColor=#d5e8d4;strokeColor=#82b366;",
    "sunset": "fillColor=#f8cecc;strokeColor=#b85450;",
}

# c4Type relabel so the reader can see each box's role at a glance.
_C4_TYPE_BY_STATUS: dict[str, str] = {
    "change": "Major Application",
    "new":    "New Application",
    "sunset": "Sunset Application",
    "keep":   "Existing Application",
}

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


def _app_style(planned_status: str, is_external: bool = False) -> str:
    base = _APP_STATUS_STYLE.get(planned_status, _APP_STATUS_STYLE["keep"])
    shape = "rounded=1;whiteSpace=wrap;html=1;" + base
    if is_external:
        shape += "dashed=1;"
    return shape + "align=center;verticalAlign=middle;fontSize=12;"


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


def _recolor_cell_style(cell: ET.Element, planned_status: str) -> None:
    """Overwrite fillColor / strokeColor in the cell's style, keep rest."""
    old = cell.get("style", "") or ""
    color = _APP_STATUS_STYLE.get(planned_status, _APP_STATUS_STYLE["keep"])
    # Strip existing fill/stroke, then append the new ones.
    kept = [
        p for p in old.split(";")
        if p and not p.lower().startswith(("fillcolor=", "strokecolor="))
    ]
    kept.append(color.rstrip(";"))
    cell.set("style", ";".join(kept) + ";")


# ── pako compression: drawio diagram content ─────────────────────
# drawio on Confluence stores the <mxGraphModel> as:
#     base64( deflate_raw( urllib.quote( xml ) ) )
# Re-encoding uses the same recipe. If the original is already plain
# XML (some self-hosted exports), we leave it uncompressed on write.


def _extract_graph_model(diagram_el: ET.Element) -> tuple[bool, Optional[ET.Element]]:
    """Return (was_compressed, mxGraphModel element or None)."""
    # Case 1: uncompressed — child <mxGraphModel> present.
    for child in diagram_el:
        if child.tag == "mxGraphModel":
            return False, child

    # Case 2: compressed — text content is pako blob.
    text = (diagram_el.text or "").strip()
    if not text:
        return False, None
    try:
        raw = base64.b64decode(text)
        inflated = zlib.decompress(raw, -15)  # -15 = raw deflate, no header
        decoded = urllib.parse.unquote(inflated.decode("latin-1"))
        return True, ET.fromstring(decoded)
    except Exception:
        return False, None


def _set_graph_model(
    diagram_el: ET.Element,
    was_compressed: bool,
    graph_model: ET.Element,
) -> None:
    """Write graph_model back into diagram_el, preserving compression."""
    # Drop existing content.
    diagram_el.text = None
    for child in list(diagram_el):
        diagram_el.remove(child)

    if was_compressed:
        xml_str = ET.tostring(graph_model, encoding="unicode")
        encoded = urllib.parse.quote(xml_str, safe="").encode("latin-1")
        # Raw deflate: use compressobj with wbits=-15 to skip zlib header.
        compressor = zlib.compressobj(9, zlib.DEFLATED, -15)
        compressed = compressor.compress(encoded) + compressor.flush()
        diagram_el.text = base64.b64encode(compressed).decode("ascii")
    else:
        diagram_el.append(graph_model)


# ── slot detection ────────────────────────────────────────────────


def _slot_from_object(obj: ET.Element) -> Optional[dict]:
    """If this <object> is a C4-style app wrapper, return a slot dict."""
    c4_type = (obj.get("c4Type") or "").lower()
    if not c4_type:
        return None
    if not any(t in c4_type for t in (
        "software system", "container", "application", "person", "service",
    )):
        return None
    mxcell = obj.find("mxCell")
    if mxcell is None or mxcell.get("vertex") != "1":
        return None
    x, y = _cell_position(mxcell)
    return {"kind": "c4_object", "element": obj, "cell": mxcell, "x": x, "y": y}


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


def _find_app_slots(graph_root: ET.Element) -> list[dict]:
    """Discover app slots (things we can fill with a user app).

    Templates are classified by the MOST SPECIFIC marker they expose;
    we then use ONLY that strategy's slots. Mixing strategies inside a
    single template picks up helper / legend cells and fills them
    before the intended placeholders — the user sees random boxes
    change instead of the central app slots.

    Priority:
      1. <object c4Type="Software System|Container|…"> — C4 templates
      2. <mxCell value="…A\\d{5,6}…"> — legacy EGM exports
      3. <mxCell style="rounded=1;fillColor=#…;"> of app-box size
         — heuristic fallback for plain drawio templates

    Sorted by (y, x) for deterministic reading order.
    """
    c4_slots: list[dict] = []
    for obj in graph_root.iter("object"):
        slot = _slot_from_object(obj)
        if slot:
            c4_slots.append(slot)
    if c4_slots:
        c4_slots.sort(key=lambda s: (s["y"], s["x"]))
        return c4_slots

    cmdb_slots: list[dict] = []
    generic_slots: list[dict] = []
    for cell in graph_root.iter("mxCell"):
        if cell.get("edge") == "1" or cell.get("vertex") != "1":
            continue
        value = (cell.get("value") or "").strip()
        style_l = (cell.get("style") or "").lower()

        if value:
            unescaped = (
                value.replace("&lt;", "<")
                     .replace("&gt;", ">")
                     .replace("&amp;", "&")
            )
            if _PLACEHOLDER_APP_ID_RE.search(unescaped):
                x, y = _cell_position(cell)
                cmdb_slots.append({
                    "kind": "cmdb_cell", "element": cell, "cell": cell,
                    "x": x, "y": y,
                })
                continue

        if "rounded=1" in style_l and "fillcolor=" in style_l:
            w, h = _cell_size(cell)
            if 80 <= w <= 280 and 35 <= h <= 160:
                x, y = _cell_position(cell)
                generic_slots.append({
                    "kind": "generic_rounded", "element": cell, "cell": cell,
                    "x": x, "y": y,
                })

    if cmdb_slots:
        cmdb_slots.sort(key=lambda s: (s["y"], s["x"]))
        return cmdb_slots
    generic_slots.sort(key=lambda s: (s["y"], s["x"]))
    return generic_slots


# ── slot substitution ────────────────────────────────────────────


def _substitute_slot(slot: dict, app: dict) -> str:
    """Write `app` into `slot`. Returns the mxCell id used (for edge wiring)."""
    cell = slot["cell"]
    kind = slot["kind"]
    planned = app.get("planned_status", "change")

    if kind == "c4_object":
        obj = slot["element"]
        # C4 templates use a label template of the form:
        #   "<b>%c4Name%</b><div>[%c4Type%]</div><br><div>%c4Description%</div>"
        # with placeholders="1" — we just overwrite the three attrs and
        # drawio re-renders the label.
        if app.get("name") or app.get("app_id"):
            obj.set("c4Name", app.get("name") or app.get("app_id") or "")
        obj.set(
            "c4Description",
            (app.get("short_description") or "")[:140],
        )
        obj.set(
            "c4Type",
            _C4_TYPE_BY_STATUS.get(planned, "Application"),
        )
        # Some C4 templates put the app_id in an attribute we can write too.
        if app.get("app_id"):
            obj.set("c4Id", app["app_id"])
        # Remove the object-level label placeholder cache if present so
        # drawio re-interprets %c4Name%.
        if obj.get("label"):
            # keep existing label template — it uses % substitution vars
            pass
    else:
        # Plain mxCell — rewrite the value. We don't preserve the old
        # template literal; the user's app name is what matters.
        cell.set("value", _app_label(app))

    # Recolor the mxCell for every slot kind (C4 cell is the child of object).
    _recolor_cell_style(cell, planned)
    # Mark external apps with a dashed border regardless of kind.
    if app.get("role") == "external":
        style = cell.get("style") or ""
        if "dashed=1" not in style:
            cell.set("style", style + ("" if style.endswith(";") else ";") + "dashed=1;")

    cid = cell.get("id") or _new_cell_id()
    cell.set("id", cid)
    return cid


# ── main entry ────────────────────────────────────────────────────


def _role_priority(app: dict) -> int:
    """Order for filling template slots: primary first, then related, then external."""
    return {"primary": 0, "related": 1, "external": 2}.get(app.get("role", "primary"), 3)


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

    See module docstring for the algorithm. Idempotent: running twice
    against the same inputs produces byte-identical output modulo cell
    ids (those use uuid for newly-added cells).
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
        # Template had no usable content — start with a blank canvas.
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

    # ── Step 1: discover slots and fill in role order ──────────────
    slots = _find_app_slots(graph_root)
    ordered_apps = sorted(apps, key=_role_priority)

    app_to_cell_id: dict[str, str] = {}
    apps_iter = iter(ordered_apps)

    for slot in slots:
        try:
            app = next(apps_iter)
        except StopIteration:
            break
        cell_id = _substitute_slot(slot, app)
        if app.get("app_id"):
            app_to_cell_id[app["app_id"]] = cell_id

    overflow_apps = list(apps_iter)

    # ── Step 2: add overflow apps as a grid below the template ────
    GRID_START_X = 50
    GRID_START_Y = 1800   # below typical template footprint
    CELL_W, CELL_H = 180, 70
    COLS = 6
    for i, app in enumerate(overflow_apps):
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

        if app.get("app_id"):
            app_to_cell_id[app["app_id"]] = cell_id

    # ── Step 3: edges for user-selected interfaces ────────────────
    for iface in interfaces:
        src_id = app_to_cell_id.get(iface.get("from_app"))
        tgt_id = app_to_cell_id.get(iface.get("to_app"))
        if not src_id or not tgt_id:
            continue  # both endpoints must have been placed

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

    # ── Step 4: repack diagram (re-compress if template was compressed) ─
    _set_graph_model(diagram, was_compressed, graph_model)
    xml_bytes = ET.tostring(tree_root, encoding="utf-8", xml_declaration=False)
    return xml_bytes.decode("utf-8")
