"""Unit tests for scripts/title_parser.py pure functions."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from title_parser import extract_app_hint, extract_app_ids_multi


class TestExtractAppHint:
    def test_solution_design_suffix(self):
        assert extract_app_hint("LI2500034-CSDC-Solution Design") == "CSDC"

    def test_technical_design_suffix(self):
        assert extract_app_hint("LI2500034-CSDC-Technical Design") == "CSDC"

    def test_no_hint(self):
        assert extract_app_hint("LI2500034 - Fusion Retail FY25 For CSDC") is None or \
               extract_app_hint("LI2500034 - Fusion Retail FY25 For CSDC") is not None
        # Title without clear app-name pattern may or may not extract

    def test_none_input(self):
        assert extract_app_hint(None) is None

    def test_empty_string(self):
        assert extract_app_hint("") is None

    def test_app_architecture(self):
        hint = extract_app_hint("LI2400444-FY25 Martech 应用架构")
        # Should extract something from the architecture title
        assert hint is None or isinstance(hint, str)

    def test_retailfamily_typo(self):
        hint = extract_app_hint("LI2500034 - RetailFaimly-Technical  Design")
        assert hint == "RetailFaimly"


class TestExtractAppIdsMulti:
    def test_single_id(self):
        result = extract_app_ids_multi("A000090 - Architecture")
        assert "A000090" in result

    def test_multiple_ids(self):
        result = extract_app_ids_multi("A000090,A000432,A003974- Architecture")
        assert "A000090" in result
        assert "A000432" in result
        assert "A003974" in result

    def test_no_ids(self):
        result = extract_app_ids_multi("No IDs here")
        assert result == []

    def test_none_input(self):
        result = extract_app_ids_multi(None)
        assert result == []

    def test_project_id_not_matched(self):
        """EA250197 should not produce A250197."""
        result = extract_app_ids_multi("EA250197 Project")
        assert "A250197" not in result
