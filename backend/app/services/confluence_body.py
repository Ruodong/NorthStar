"""Confluence page body parser — extracts structured questionnaire data.

Confluence project pages in the ARD space store Q&A as HTML tables inside
the body (Confluence storage format is HTML + `ac:*` Confluence macros).
The typical pattern is:

    <h1>Section</h1>
    <h2>Subsection</h2>
    <table>
      <tr><th>Key 1</th><td>Value 1</td></tr>
      <tr><th>Key 2</th><td>Value 2</td></tr>
    </table>

Plus `<ac:structured-macro ac:name="expand">` macros wrapping collapsible
sub-content, and `<ac:structured-macro ac:name="details">` macros wrapping
the page header metadata table.

This module produces three outputs:
    - text_content: plain-text extraction of the full page (for search)
    - sections: list of {heading, level, rows:[{key, value}]} for structured view
    - expand_panels: list of {title, content_text} for collapsible sections
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from bs4 import BeautifulSoup, NavigableString, Tag


@dataclass
class Section:
    heading: str
    level: int  # 1..6 (h1-h6)
    rows: list[dict[str, str]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {"heading": self.heading, "level": self.level, "rows": self.rows}


@dataclass
class ExpandPanel:
    title: str
    content_text: str

    def to_dict(self) -> dict[str, Any]:
        return {"title": self.title, "content_text": self.content_text}


def _cell_text(cell: Tag) -> str:
    """Clean text from a table cell — strip whitespace and collapse newlines."""
    if cell is None:
        return ""
    text = cell.get_text(" ", strip=True)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _extract_rows_from_table(table: Tag) -> list[dict[str, str]]:
    """Convert a 2-column-ish <table> into {key, value} rows.

    Uses the first <th> OR first <td> as key and the remaining cells as value.
    Skips header-only rows (all <th>) and rows with no cells.
    """
    rows: list[dict[str, str]] = []
    for tr in table.find_all("tr", recursive=True):
        cells = tr.find_all(["th", "td"], recursive=False)
        if not cells:
            continue
        # Header-only row (like "Item | Input") — skip
        all_th = all(c.name == "th" for c in cells)
        if all_th and len(cells) >= 2:
            continue
        if len(cells) == 1:
            # Single-cell row — treat as free text under empty key
            text = _cell_text(cells[0])
            if text:
                rows.append({"key": "", "value": text})
            continue
        # 2+ cells: first is key, rest joined as value
        key = _cell_text(cells[0])
        value = " | ".join(_cell_text(c) for c in cells[1:] if _cell_text(c))
        if key or value:
            rows.append({"key": key, "value": value})
    return rows


def _current_heading(headings_stack: list[tuple[int, str]]) -> tuple[int, str]:
    """Return the most specific heading pair (level, text) from the stack."""
    if not headings_stack:
        return (0, "")
    return headings_stack[-1]


# ---------------------------------------------------------------------------
# HTML sanitizer — turn Confluence storage format into browser-renderable HTML
# ---------------------------------------------------------------------------

# Macros whose rich-text-body should be rendered as a styled callout.
_PANEL_MACROS = {
    "info": ("#e8f0ff", "#4073c2"),
    "note": ("#fff4e0", "#b26a00"),
    "warning": ("#ffefef", "#c53030"),
    "tip": ("#e7f7ee", "#2f855a"),
    "panel": ("#f4f5f7", "#6b7280"),
    "aura-panel": ("#fff8e1", "#b68201"),
    "details": ("#f8f9fb", "#3b4556"),
}


def _strip_namespaces_in_name(name: str | None) -> str:
    """Return the local name of a namespaced tag (ac:foo → foo)."""
    if not name:
        return ""
    return name.split(":", 1)[-1]


def sanitize_storage_html(html: str) -> str:
    """Convert Confluence storage-format HTML into plain HTML a browser can render.

    Transformations:
      - <ac:parameter> dropped entirely (they hold macro config like JSON)
      - <ac:rich-text-body> unwrapped (keep children)
      - <ac:structured-macro ac:name="X">:
          info / note / warning / tip / panel / aura-panel / details → styled <div>
          expand → <details><summary>title</summary><body/></details>
          code → <pre><code>
          toc / attachments / children / drawio / <ac:image> → placeholder chip
          anything else → unwrapped, rich-text-body children kept
      - <ri:attachment> and <ac:image> references → alt-text placeholder
    """
    if not html:
        return ""
    soup = BeautifulSoup(html, "html.parser")

    # 1. Drop every <ac:parameter> — these carry JSON / style config.
    for p in list(soup.find_all(lambda t: t.name and t.name.endswith("parameter"))):
        p.decompose()

    # 2. Unwrap <ac:rich-text-body> — keep its children in place.
    for rt in list(soup.find_all(lambda t: t.name and t.name.endswith("rich-text-body"))):
        rt.unwrap()

    # 3. Walk every structured macro and replace with something renderable.
    for macro in list(
        soup.find_all(lambda t: t.name and t.name.endswith("structured-macro"))
    ):
        name = (macro.get("ac:name") or macro.get("ac_name") or "").lower()

        # Code block
        if name == "code":
            pre = soup.new_tag("pre")
            code = soup.new_tag("code")
            code.string = macro.get_text("\n", strip=False)
            pre.append(code)
            pre["style"] = (
                "background:#f4f5f7;border:1px solid #dfe1e6;padding:10px;"
                "border-radius:3px;font-family:monospace;font-size:12px;overflow:auto;"
            )
            macro.replace_with(pre)
            continue

        # Expand macro → <details>
        if name == "expand":
            details = soup.new_tag("details")
            details["style"] = (
                "margin:12px 0;padding:10px 14px;border:1px solid #dfe1e6;"
                "border-radius:3px;background:#fafbfc;"
            )
            # find title-like parameter before it was decomposed (already gone);
            # fall back to generic label
            summary = soup.new_tag("summary")
            summary.string = "Expand"
            summary["style"] = "cursor:pointer;font-weight:500;color:#172b4d;"
            details.append(summary)
            for child in list(macro.children):
                details.append(child)
            macro.replace_with(details)
            continue

        # Panel-style macros → styled <div>
        if name in _PANEL_MACROS:
            bg, border = _PANEL_MACROS[name]
            wrapper = soup.new_tag("div")
            wrapper["style"] = (
                f"background:{bg};border-left:4px solid {border};"
                "padding:10px 14px;margin:10px 0;border-radius:3px;"
            )
            for child in list(macro.children):
                wrapper.append(child)
            macro.replace_with(wrapper)
            continue

        # Non-renderable macros: show a placeholder chip.
        if name in {"toc", "attachments", "children", "drawio", "drawio-macro",
                    "easy-images", "include", "excerpt-include",
                    "ui-tabs", "ui-tab", "jira", "pageproperties", "profile",
                    "anchor", "status"}:
            chip = soup.new_tag("span")
            chip.string = f"[{name or 'macro'}]"
            chip["style"] = (
                "display:inline-block;padding:2px 8px;background:#f4f5f7;"
                "border:1px solid #dfe1e6;border-radius:10px;font-size:11px;"
                "color:#6b7280;font-family:monospace;margin:2px;"
            )
            macro.replace_with(chip)
            continue

        # Unknown macro — just unwrap so its rich-text-body children survive.
        macro.unwrap()

    # 4. Replace <ac:image ri:attachment> with a placeholder (we don't expose
    # those raw binary streams through this endpoint — the admin attachment
    # preview endpoint handles that separately).
    for img_macro in list(soup.find_all(lambda t: t.name and t.name.endswith("image"))):
        att = img_macro.find(lambda t: t.name and t.name.endswith("attachment"))
        filename = (att.get("ri:filename") or att.get("ri_filename") or "image") if att else "image"
        placeholder = soup.new_tag("span")
        placeholder.string = f"🖼 {filename}"
        placeholder["style"] = (
            "display:inline-block;padding:3px 8px;background:#e8f0ff;"
            "border:1px solid #c2d5f5;border-radius:3px;font-size:11px;"
            "color:#4073c2;font-family:monospace;margin:2px;"
        )
        img_macro.replace_with(placeholder)

    # 5. Any remaining ac:* or ri:* leaf elements: unwrap.
    for stray in list(soup.find_all(lambda t: t.name and (":" in (t.name or "") or t.name.startswith(("ac", "ri"))))):
        try:
            stray.unwrap()
        except Exception:  # noqa: BLE001
            stray.decompose()

    # 6. <ac:placeholder> and <ac:task-list> etc. — drop anything still left
    # that has an ac-/ri- prefix in the raw string form.
    return str(soup)


def parse_body(html: str) -> dict[str, Any]:
    """Parse Confluence storage-format HTML into structured content.

    Returns:
        {
          "text": <plain text for search>,
          "sections": [ {heading, level, rows:[{key,value}]} ],
          "expand_panels": [ {title, content_text} ],
          "stats": { "tables": N, "headings": N, "macros": {name: count} },
        }
    """
    if not html:
        return {"text": "", "sections": [], "expand_panels": [], "stats": {}}

    # Confluence uses ac: and ri: namespaces; BS4 handles them fine with
    # the html.parser backend. Strip script/style first to avoid noise.
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style"]):
        tag.decompose()

    # --- Pass 1: expand_panels (collect, then replace with their content
    # in-place so section walking still sees the text but doesn't double-count).
    expand_panels: list[ExpandPanel] = []
    for macro in soup.find_all(
        lambda t: t.name and t.name.endswith("structured-macro") and t.get("ac:name") == "expand"
    ):
        title_tag = macro.find(lambda t: t.name and t.name.endswith("parameter") and t.get("ac:name") == "title")
        title = _cell_text(title_tag) if title_tag else "(expand)"
        body = macro.find(lambda t: t.name and t.name.endswith("rich-text-body"))
        body_text = _cell_text(body) if body else ""
        expand_panels.append(ExpandPanel(title=title, content_text=body_text))

    # --- Pass 2: walk DOM in document order, tracking headings and extracting tables.
    sections: list[Section] = []
    current_section: Section | None = None
    headings_stack: list[tuple[int, str]] = []  # stack of (level, title)
    tables_seen = 0
    headings_seen = 0

    def ensure_section_for(level: int, heading: str) -> Section:
        nonlocal current_section
        current_section = Section(heading=heading, level=level)
        sections.append(current_section)
        return current_section

    # Use descendants iteration so nested tables inside rich-text-body are picked up.
    for el in soup.find_all(
        ["h1", "h2", "h3", "h4", "h5", "h6", "table"]
    ):
        if el.name.startswith("h") and el.name[1:].isdigit():
            level = int(el.name[1:])
            text = _cell_text(el)
            if not text:
                continue
            headings_seen += 1
            # Pop stack to this level
            while headings_stack and headings_stack[-1][0] >= level:
                headings_stack.pop()
            headings_stack.append((level, text))
            ensure_section_for(level, text)
        elif el.name == "table":
            tables_seen += 1
            rows = _extract_rows_from_table(el)
            if not rows:
                continue
            if current_section is None:
                # Tables before any heading — put them under "Metadata"
                ensure_section_for(0, "Metadata")
            current_section.rows.extend(rows)

    # Drop empty sections (heading without any content)
    sections = [s for s in sections if s.rows]

    # --- Pass 3: plain text extraction for search
    text_content = soup.get_text(" ", strip=True)
    text_content = re.sub(r"\s+", " ", text_content).strip()

    # Collect macro stats
    macros: dict[str, int] = {}
    for macro in soup.find_all(lambda t: t.name and t.name.endswith("structured-macro")):
        name = macro.get("ac:name", "unknown")
        macros[name] = macros.get(name, 0) + 1

    return {
        "text": text_content,
        "sections": [s.to_dict() for s in sections],
        "expand_panels": [p.to_dict() for p in expand_panels],
        "stats": {
            "tables": tables_seen,
            "headings": headings_seen,
            "macros": macros,
            "chars": len(html),
        },
    }
