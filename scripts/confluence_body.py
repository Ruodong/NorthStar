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
