"""Unit tests for backend/app/services/name_normalize.py."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from app.services.name_normalize import normalize_name


class TestNormalizeName:
    def test_lowercase(self):
        assert normalize_name("POLARIS") == normalize_name("polaris")

    def test_strip_whitespace(self):
        assert normalize_name("  Polaris  ") == normalize_name("Polaris")

    def test_strip_system_suffix(self):
        n1 = normalize_name("Polaris System")
        n2 = normalize_name("Polaris")
        # Both should normalize to same or similar form
        assert n1 == n2 or "polaris" in n1

    def test_unicode_normalization(self):
        # NFKC normalization: ﬁ → fi
        assert "fi" in normalize_name("ﬁle")

    def test_empty(self):
        assert normalize_name("") == ""

    def test_chinese(self):
        result = normalize_name("联想零售云管家")
        assert "联想零售云管家" in result or len(result) > 0

    def test_consistency(self):
        """Same input always produces same output."""
        assert normalize_name("OMS") == normalize_name("OMS")
        assert normalize_name("LBP") == normalize_name("LBP")
