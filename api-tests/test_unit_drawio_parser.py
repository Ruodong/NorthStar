"""Unit tests for backend/app/services/drawio_parser.py pure functions.

These tests run WITHOUT database or network — they test the parser's
internal helpers directly with synthetic inputs.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

# Add backend to path so we can import the parser
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from app.services.drawio_parser import (
    _parse_style,
    _get_fill_color,
    _get_stroke_color,
    _fill_to_status,
    _stroke_to_status,
    _is_legend,
    _clean_html,
    _extract_standard_id,
    _extract_app_name,
    decompress_drawio_content,
)


# ---------------------------------------------------------------------------
# _parse_style
# ---------------------------------------------------------------------------

class TestParseStyle:
    def test_basic(self):
        result = _parse_style("fillColor=#f8cecc;strokeColor=#b85450;rounded=1")
        assert result["fillColor"] == "#f8cecc"
        assert result["strokeColor"] == "#b85450"
        assert result["rounded"] == "1"

    def test_empty(self):
        assert _parse_style("") == {}

    def test_trailing_semicolon(self):
        result = _parse_style("fillColor=#dae8fc;")
        assert result["fillColor"] == "#dae8fc"

    def test_no_value(self):
        result = _parse_style("rounded;whiteSpace=wrap")
        assert result.get("rounded") == ""
        assert result["whiteSpace"] == "wrap"


# ---------------------------------------------------------------------------
# _get_fill_color / _get_stroke_color
# ---------------------------------------------------------------------------

class TestGetColors:
    def test_fill_color(self):
        assert _get_fill_color("fillColor=#f8cecc;rounded=1") == "#f8cecc"

    def test_fill_color_none(self):
        assert _get_fill_color("rounded=1;strokeColor=#000") is None

    def test_fill_color_explicit_none(self):
        assert _get_fill_color("fillColor=none") in (None, "none")

    def test_stroke_color(self):
        assert _get_stroke_color("strokeColor=#b85450") == "#b85450"


# ---------------------------------------------------------------------------
# _fill_to_status
# ---------------------------------------------------------------------------

class TestFillToStatus:
    def test_keep_blue(self):
        assert _fill_to_status("#dae8fc") == "Keep"

    def test_change_pink(self):
        assert _fill_to_status("#f8cecc") == "Change"

    def test_new_green(self):
        assert _fill_to_status("#d5e8d4") == "New"

    def test_sunset_grey(self):
        assert _fill_to_status("#e1d5e7") == "Sunset"

    def test_unknown_color(self):
        assert _fill_to_status("#123456") == "Unknown"

    def test_none(self):
        assert _fill_to_status(None) == "Unknown"

    def test_dynamic_map(self):
        custom = {"#ff0000": "Custom"}
        assert _fill_to_status("#ff0000", custom) == "Custom"


# ---------------------------------------------------------------------------
# _stroke_to_status
# ---------------------------------------------------------------------------

class TestStrokeToStatus:
    def test_exist_black(self):
        assert _stroke_to_status("#000000") == "Exist"

    def test_changed_blue(self):
        assert _stroke_to_status("#0000ff") == "Changed"

    def test_new_red(self):
        assert _stroke_to_status("#ff0000") == "New"

    def test_none(self):
        assert _stroke_to_status(None) == "Unknown"


# ---------------------------------------------------------------------------
# _is_legend
# ---------------------------------------------------------------------------

class TestIsLegend:
    def test_legend_keyword(self):
        assert _is_legend("Legend") is True

    def test_template_text(self):
        assert _is_legend("ID: A000001 System description and purpose") is True

    def test_normal_app(self):
        assert _is_legend("A000575 Polaris") is False

    def test_empty(self):
        assert _is_legend("") is False


# ---------------------------------------------------------------------------
# _clean_html
# ---------------------------------------------------------------------------

class TestCleanHtml:
    def test_strip_tags(self):
        assert _clean_html("<b>Hello</b>") == "Hello"

    def test_br_to_newline(self):
        result = _clean_html("Line1<br>Line2")
        assert "Line1" in result and "Line2" in result

    def test_entities(self):
        assert "&amp;" not in _clean_html("A &amp; B")

    def test_plain_text(self):
        assert _clean_html("plain text") == "plain text"

    def test_nested_tags(self):
        assert _clean_html("<div><span>text</span></div>") == "text"


# ---------------------------------------------------------------------------
# _extract_standard_id
# ---------------------------------------------------------------------------

class TestExtractStandardId:
    def test_six_digit(self):
        assert _extract_standard_id("A000575 Polaris") == "A000575"

    def test_seven_digit(self):
        assert _extract_standard_id("A0001234 Something") == "A0001234"

    def test_five_digit(self):
        assert _extract_standard_id("A00057 Short") == "A00057"

    def test_no_id(self):
        assert _extract_standard_id("No standard ID here") is None

    def test_id_prefix(self):
        assert _extract_standard_id("ID: A000575") == "A000575"

    def test_embedded_in_project_id(self):
        """EA250197 should NOT match — negative lookbehind."""
        result = _extract_standard_id("EA250197")
        assert result is None or result != "A250197"


# ---------------------------------------------------------------------------
# _extract_app_name
# ---------------------------------------------------------------------------

class TestExtractAppName:
    def test_strip_id_prefix(self):
        result = _extract_app_name("A000575 Polaris", "A000575")
        assert result == "Polaris"

    def test_strip_id_colon(self):
        result = _extract_app_name("A000575: Polaris System", "A000575")
        assert "Polaris" in result

    def test_no_id(self):
        result = _extract_app_name("Polaris System", None)
        assert result == "Polaris System"

    def test_empty(self):
        result = _extract_app_name("", None)
        assert result == ""


# ---------------------------------------------------------------------------
# decompress_drawio_content
# ---------------------------------------------------------------------------

class TestDecompress:
    def test_plain_xml_passthrough(self):
        xml = '<mxfile><diagram><mxGraphModel></mxGraphModel></diagram></mxfile>'
        result = decompress_drawio_content(xml)
        assert "<mxfile>" in result or "<mxGraphModel>" in result

    def test_empty_string(self):
        with pytest.raises(Exception):
            decompress_drawio_content("")
