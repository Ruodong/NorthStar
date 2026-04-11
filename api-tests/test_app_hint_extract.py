"""Unit tests for scripts/title_parser.extract_app_hint.

Spec: .specify/features/confluence-app-hint/spec.md § 4 AC-1.
Pure-function tests — no DB, no Confluence, no backend.
"""
from __future__ import annotations

import sys
from pathlib import Path

# Make scripts/ importable
REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from title_parser import (  # noqa: E402  (path fixup above)
    extract_app_hint,
    extract_app_ids_multi,
)


# ---------------------------------------------------------------------------
# AC-1 table
# ---------------------------------------------------------------------------

EXTRACTOR_CASES = [
    # Pattern B target strings (LI2500034 pilot)
    ("LI2500034-CSDC-Solution Design", "CSDC"),
    ("LI2500034 - CSDC - Technical Design", "CSDC"),
    ("LI2500034 - RetailFaimly- Solution Design", "RetailFaimly"),
    ("LI2500034 - RetailFaimly-Technical  Design", "RetailFaimly"),
    # Free-form English, no project id prefix
    ("GSC Content Extractor Application Architecture", "GSC Content Extractor"),
    ("MTY IFP Technical Architecture", "MTY IFP"),
    ("HR Recruiter Automation Assistant Application Architecture",
     "HR Recruiter Automation Assistant"),
    ("EA Assistent Technical Architecture", "EA Assistent"),
    # LI prefix + free-form app hint + suffix
    ("LI2500157 - Procurement Compliance Agent Solution Design",
     "Procurement Compliance Agent"),
    ("LI2500071 - SSC US X-DOC Project - Solution Design", "SSC US X-DOC Project"),
    # Pages that should yield None
    ("LI2500009 - Solution Design", None),
    ("Copy of LI2300097 - Solution Design", None),
    ("Copy of LI2300097 - Technical Design", None),
    ("LI2500034 - Fusion Retail FY25 For CSDC", "Fusion Retail FY25 For CSDC"),
    # Chinese suffixes
    ("建店Java版本-应用架构图", "建店Java版本"),
    ("建店Java版本-技术架构图", "建店Java版本"),
    ("A000296-RetailFaimly-集成架构图-V2-BIA-730",
     "A000296-RetailFaimly-集成架构图-V2-BIA-730"),  # trailing noise prevents clean strip
    # Edge: empty / nonsense
    ("", None),
    (None, None),
    ("LI", None),  # too short after strip
]


def test_extractor_table():
    """Spec AC-1. Walk every row of the extractor table."""
    failures = []
    for title, expected in EXTRACTOR_CASES:
        actual = extract_app_hint(title)
        if actual != expected:
            failures.append((title, expected, actual))
    assert not failures, (
        "extract_app_hint mismatches:\n"
        + "\n".join(
            f"  {t!r:60}  expected {e!r:30}  got {a!r}"
            for t, e, a in failures
        )
    )


def test_extractor_is_stable():
    """Running twice yields the same answer — guards against state leaks."""
    for title, _expected in EXTRACTOR_CASES:
        assert extract_app_hint(title) == extract_app_hint(title)


# ---------------------------------------------------------------------------
# Pattern D multi-app extractor (bonus — same module)
# ---------------------------------------------------------------------------

MULTI_ID_CASES = [
    ("A000328-BPP Architecture - zhouqiang9", ["A000328"]),
    ("A000090,A000432,A003974- Architecture", ["A000090", "A000432", "A003974"]),
    ("A000090, A000432, A003974 - Application Solution",
     ["A000090", "A000432", "A003974"]),
    # De-dupe
    ("A000205 A000205 x", ["A000205"]),
    # No match
    ("Pure text title with no ids", []),
    (None, []),
    ("", []),
]


def test_extract_app_ids_multi():
    for title, expected in MULTI_ID_CASES:
        actual = extract_app_ids_multi(title)
        assert actual == expected, f"{title!r}: expected {expected}, got {actual}"
