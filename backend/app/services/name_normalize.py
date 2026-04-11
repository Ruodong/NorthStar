"""Normalized name computation for fuzzy app matching.

Used by:
- scripts/generate_merge_candidates.py — to compute norm_keys and propose
  merges for human review
- /admin/aliases — to show humans the common signature of candidates

NOT used by the loader directly. The loader applies manual_app_aliases (a
flat alias_id → canonical_id map), not norm_keys. Humans do the translation
between the two.

Normalization rules (conservative, favoring false-negatives over false-positives):
    1. NFKC normalize (collapses full-width/half-width CJK)
    2. Lowercase
    3. Strip common generic suffixes that add no identifying value
       (system, platform, service, 系统, 平台, 服务, application, app, 工具)
       — applied repeatedly until no more match
    4. Remove all whitespace and common punctuation
"""
from __future__ import annotations

import re
import unicodedata

# Suffixes stripped repeatedly. Longest match first so "sub-system" becomes
# "sub" not "sub-" etc.
_STRIP_SUFFIXES: tuple[str, ...] = (
    "应用系统",
    "服务平台",
    "管理系统",
    "系统",
    "平台",
    "服务",
    "工具",
    "应用",
    "platform",
    "services",
    "service",
    "system",
    "application",
    "app",
    "tool",
)

_PUNCT_RE = re.compile(r"[\s\-_\.,;:()/\[\]{}'\"<>`~!@#$%^&*+=|\\?]+")


def normalize_name(name: str) -> str:
    """Return a normalized signature for fuzzy matching.

    >>> normalize_name("订单系统")
    '订单'
    >>> normalize_name("Order System")
    'order'
    >>> normalize_name("  Order-Management_Platform  ")
    'ordermanagement'
    >>> normalize_name("")
    ''
    >>> normalize_name(None)  # type: ignore[arg-type]
    ''
    """
    if not name:
        return ""
    s = unicodedata.normalize("NFKC", str(name)).strip().lower()

    # Strip generic suffixes repeatedly
    changed = True
    while changed:
        changed = False
        for suf in _STRIP_SUFFIXES:
            if s.endswith(suf) and len(s) > len(suf):
                s = s[: -len(suf)].strip()
                changed = True
                break

    # Collapse whitespace + punctuation
    s = _PUNCT_RE.sub("", s)
    return s
