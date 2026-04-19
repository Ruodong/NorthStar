# Design Generator — Legend Protection + Hub-and-Spoke Layout

## Context

The Design wizard's AS-IS generator (`backend/app/services/design_generator.py`, called by `POST /api/design` with `template_attachment_id`) currently walks every app-sized cell in the chosen template and overwrites the first N cells (sorted by y,x) with user-selected apps. This mishandles EA's official templates because those templates include a **Legend band** at the top — a horizontal row of example app cards (A000547, D365 Sales B2B, SDMS, LeOps-iMonitoring …) plus a key of interface arrow styles (Command / Event / Service / Content / Query / Embed). The generator treats those Legend cards as valid slots and fills them with real apps, corrupting the pattern key while the actual template body below goes untouched or only partially filled.

Additionally, the slot-substitution model forces architects to pick templates whose middle layout matches the final design's topology. In practice every AS-IS architecture NorthStar produces is a hub: one Major application surrounded by its integration partners. The template's "middle" never quite matches, so the output always needs manual cleanup.

This feature throws out slot substitution. The template becomes a **style reference only**: the Legend band at the top is preserved verbatim (as a visual key + color/arrow style dictionary), and the rest of the canvas is cleared and replaced with a fresh **hub-and-spoke** layout centered on the Major app.

## Functional Requirements

### FR-1: Legend Region Detection

Before any substitution, the generator computes a **Legend protected region** — an axis-aligned rectangle `(xmin, ymin, xmax, ymax)` in template coordinates that is preserved byte-for-byte in the output. Detection runs in this order:

1. **Explicit marker (preferred)** — if **any** cell's visible text (its `value`, or an enclosing `<object>`/`<UserObject>`'s `label` / `c4Name` / `c4Description`) matches `/legend|illustrative/i`, resolve the container of that marker in this priority:
   1. **drawio parent group** — if the marker's `parent` attribute points to a non-sentinel vertex cell, use the parent cell's own bbox. Child cells of that group (whose coords are drawio-relative) are preserved via parent-chain membership, not bbox overlap.
   2. **Geometric enclosure** — otherwise, find the smallest vertex cell whose bbox geometrically CONTAINS the marker's bbox (edges may touch). Use that vertex's bbox.
   3. **Marker alone** — if neither resolves, the marker cell's own bbox is too small to be useful on its own; fall through to Strategy 2.
2. **Top-band heuristic (fallback)** — compute the bbox of every vertex cell in the graph. Group cells by y-position (clusters separated by > 60px vertical gap). If the **topmost cluster** is within the top 35% of the total bbox height AND contains at least 3 vertex cells, treat that cluster's bbox (padded by 20px) as the Legend region.
3. **No Legend detected** — if neither rule fires, treat the whole canvas as unprotected and proceed with a blank hub-and-spoke. Log a warning so the operator can flag the template.

The region is inclusive of edges whose both endpoints are inside the region (interface-style keys in the Legend connect example cards to each other), AND of cells whose drawio parent chain lands inside the region (child cells of a protected group use relative coordinates, so their own bbox cannot be compared to the absolute region bbox directly).

### FR-2: Canvas Clearing

Every vertex cell AND edge cell whose bbox lies **outside** the Legend region is deleted from `<mxGraphModel>/<root>`. The drawio root-sentinel cells `id="0"` and `id="1"` always stay. Cells inside the Legend region are untouched.

Cells that straddle the Legend boundary (bbox partially inside, partially outside) are treated as **inside** the Legend and preserved — safer to keep a stray connector than to chop half of it off.

### FR-3: Hub-and-Spoke Layout

After clearing, the generator draws a new hub in the **largest empty rectangle below the Legend region**:

- **Canvas bounds** — `xmin = legend.xmin` (or 40 if no Legend), `ymin = legend.ymax + 80`, `xmax = max(legend.xmax, xmin + 1400)`, `ymax = ymin + 900`. Canvas is minimum 1400×900 so there's always room to fan out ~12 surround apps.
- **Major app** — the first app with role ∈ {major, primary}. Placed centered at `(canvas.cx, canvas.cy)`. Box 260×120.
- **Additional majors** (if any) — placed in a small horizontal row immediately above the central major, 20px gap between, centered.
- **Surround apps** — arranged on a single circle around the Major cluster. Radius `r = max(320, 80 + box_diag * N / π)` where N is surround count and box_diag is 200 (diagonal of a surround box). Angle for surround `i` is `-π/2 + 2π · i / N` (first surround at 12 o'clock, going clockwise). Box 180×80.
- **Interfaces** — every user-selected interface whose endpoints both landed on the canvas gets an `<mxCell edge="1">` with the existing `_edge_style(platform, planned_status)` palette. drawio auto-routes the line; we just set `source` + `target`.
- **Orphan interfaces** — edges whose endpoint app didn't make it onto the canvas (e.g., an interface referencing an app not in the apps list) are silently dropped.

Box styling continues to use the existing helpers (`_app_style` + `_recolor_cell_style`) so color semantics (change → yellow, new → green, sunset → red, keep → blue, surround → muted grey dashed) are unchanged.

### FR-4: No Slot Substitution

The old slot-discovery code (`_find_app_slots`, `_slot_from_object`, `_substitute_slot`, `_role_priority`, overflow grid) is REMOVED. The generator no longer cares about C4 `<object>` wrappers, CMDB-style `ID: Axxxxxx` placeholders, or rounded-app-sized cell heuristics. Everything outside the Legend is redrawn from apps + interfaces.

### FR-5: Compression Round-Trip Preserved

The pako compress/inflate path (`_extract_graph_model`, `_set_graph_model`) is unchanged. If the input template is compressed, the output is re-compressed at the same level so Confluence / drawio viewers see the same wire format.

## Non-Functional Requirements

- Generator is a pure function (`generate_as_is_xml(template_xml, apps, interfaces) -> str`). No DB, no Confluence calls. Idempotent modulo cell UUIDs.
- Generation time < 200ms for a template with 50 legend cells and 12 surround apps.
- Output must parse cleanly in drawio ≥ 24.0 (tested by round-tripping through `xml.etree` then re-serializing).
- No external dependencies added.
- Backward compat: the `generate_as_is_xml(...)` signature stays. Callers in `app/routers/design.py` don't change.

## Acceptance Criteria

- [ ] `_detect_legend_region()` returns the top-band cluster bbox for a template with the EA-style Illustrative banner.
- [ ] `_detect_legend_region()` returns `None` for a completely blank template.
- [ ] Any cell whose visible text matches /legend|illustrative/i triggers container resolution: the drawio parent group's bbox, or the smallest geometrically enclosing vertex, wins.
- [ ] Cells whose drawio parent chain lands inside the Legend region are preserved during `_strip_non_legend_cells`, even when their own (x, y) coords would put them outside (drawio child coords are relative).
- [ ] `generate_as_is_xml()` preserves every Legend cell byte-for-byte in `(x, y, value, style)` when a Legend is detected.
- [ ] Cells outside the Legend region are removed from the output.
- [ ] With 1 major + 3 surrounds, the output contains exactly 4 app vertex cells outside the Legend, the major is at the canvas center, and the 3 surrounds are on a circle around it (angles at -90°, 30°, 150° ± 1° tolerance).
- [ ] With 1 major + 0 surrounds, the output has the major at the canvas center and no edges.
- [ ] Interfaces between a major and a surround produce exactly one `edge="1"` cell with `source=<major_id>` and `target=<surround_id>`.
- [ ] An interface referencing an app that isn't in the apps list is dropped (no dangling edge).
- [ ] Re-running the generator with the same inputs produces XML that differs only in cell UUIDs.

## Edge Cases

- **Template has no Legend marker and no top-band cluster** — log warning, proceed with canvas starting at (40, 40). All cells outside the canvas (i.e., everything) gets cleared.
- **Major missing; only surrounds** — promote the first surround to Major (center). Rest of surrounds arranged in a circle around it.
- **No apps at all** — return the template untouched (Legend preserved, nothing added). Architect can drag cells in manually.
- **Surrounds N ≥ 20** — extend to a second outer ring (radius × 1.6) for the overflow. Cleanup.
- **Apps with the same app_id** — keep the first one; skip duplicates (silent de-dup).
- **Legend cells with edges connecting TO cells outside the Legend** — the edges are deleted (endpoint outside region).
- **Template was already run through the generator once** — previously generated cells outside the Legend get cleared; regeneration is idempotent.

## Affected Files

| File | Kind | Change |
|------|------|--------|
| `backend/app/services/design_generator.py` | EDIT | Remove slot-subst; add Legend detection + hub-spoke |
| `.specify/features/design-hub-spoke-generator/spec.md` | NEW | This spec |
| `api-tests/test_design_generator.py` | NEW | Unit tests (pure-Python, no DB) |
| `scripts/test-map.json` | EDIT | Map design_generator.py → test file |

## Test Coverage

`api-tests/test_design_generator.py`:

- `test_detect_legend_on_ea_template` — top-band cluster heuristic picks the right bbox
- `test_detect_legend_none_for_blank` — empty template returns None
- `test_legend_preserved_byte_for_byte` — every Legend cell's (x, y, value, style) equals input
- `test_outside_cells_removed` — template body cells gone from output
- `test_hub_and_spoke_one_major_three_surrounds` — positions + count of generated cells
- `test_single_major_no_surrounds` — major alone, no edges
- `test_interfaces_produce_edges` — each iface with both endpoints → one `edge="1"` cell
- `test_orphan_interface_dropped` — iface with missing endpoint produces no edge
- `test_idempotent_modulo_uuid` — two runs diff only on cell ids
- `test_compression_round_trip` — compressed template produces compressed output

## Out of Scope

- Template authoring UI in NorthStar.
- Diagram editing (still uses the existing drawio embed).
- Multi-page drawio templates (first diagram only, unchanged from current).
- Automatic surround detection from the CMDB graph (surrounds must be supplied by the caller).
- Fancy routing (orthogonal, avoid-crossings). drawio auto-routing is good enough for V1.
