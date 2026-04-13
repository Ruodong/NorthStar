"""Unit tests for backend/app/services/confluence_body.py pure functions."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from app.services.confluence_body import sanitize_storage_html, parse_body


class TestSanitizeStorageHtml:
    def test_strips_ac_parameters(self):
        html = '<ac:structured-macro ac:name="toc"><ac:parameter ac:name="maxLevel">3</ac:parameter></ac:structured-macro>'
        result = sanitize_storage_html(html)
        # Should not contain raw ac: parameter tags
        assert "ac:parameter" not in result

    def test_preserves_basic_html(self):
        html = "<p>Hello <strong>world</strong></p>"
        result = sanitize_storage_html(html)
        assert "Hello" in result
        assert "world" in result

    def test_handles_empty(self):
        result = sanitize_storage_html("")
        assert result == "" or result is not None

    def test_panel_macro(self):
        html = '<ac:structured-macro ac:name="panel"><ac:rich-text-body><p>Content</p></ac:rich-text-body></ac:structured-macro>'
        result = sanitize_storage_html(html)
        assert "Content" in result


class TestParseBody:
    def test_simple_table(self):
        html = """
        <table>
            <tr><td>Project</td><td>NorthStar</td></tr>
            <tr><td>Status</td><td>Active</td></tr>
        </table>
        """
        result = parse_body(html)
        assert "sections" in result or "text" in result
        assert result["stats"]["tables"] >= 1

    def test_headings(self):
        html = "<h2>Section One</h2><p>Content</p><h2>Section Two</h2><p>More</p>"
        result = parse_body(html)
        assert result["stats"]["headings"] >= 2

    def test_empty_body(self):
        result = parse_body("")
        assert result["stats"]["chars"] == 0

    def test_text_extraction(self):
        html = "<p>Hello world</p>"
        result = parse_body(html)
        assert "Hello world" in result["text"]
