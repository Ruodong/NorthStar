"""Title parsing helpers for Confluence pages.

Shared between scripts/scan_confluence.py, scripts/backfill_app_hint.py,
and api-tests/test_app_hint_extract.py. Keep this module pure — no DB
access except in `resolve_app_id_via_cmdb` which takes an explicit cursor.

Spec: .specify/features/confluence-app-hint/spec.md
"""
from __future__ import annotations

import re
from functools import lru_cache
from typing import Optional


# ---------------------------------------------------------------------------
# extract_app_hint — free-text application name from a page title
# ---------------------------------------------------------------------------

_PREFIX_COPY_OF     = re.compile(r"^Copy of\s+", re.IGNORECASE)
_PREFIX_PROJECT_ID  = re.compile(
    r"^(LI\d{6,7}|RD\d{6,11}|TECHLED-\d+|FY\d{4}-\d+|EA\d{6})"
    r"[\s\-:：]+",
)
_SUFFIX_EN_ARCH     = re.compile(
    r"\s*[\-:：]?\s*(Application|Technical|Solution|Integration|Integrated)"
    r"\s+(Design|Architecture)\s*$",
    re.IGNORECASE,
)
_SUFFIX_ZH_ARCH     = re.compile(
    r"\s*[\-:：]?\s*(应用|技术|集成|解决方案|数据)"
    r"(架构|设计|架构图|设计图|架构设计)\s*$",
)


def extract_app_hint(title: Optional[str]) -> Optional[str]:
    """Extract a free-text application name hint from a Confluence page title.

    Returns the middle segment after stripping project id prefix and
    arch/design suffix, or None if nothing useful remains.

    Examples (see spec AC-1):
        "LI2500034-CSDC-Solution Design"                   -> "CSDC"
        "LI2500034 - RetailFaimly- Solution Design"        -> "RetailFaimly"
        "GSC Content Extractor Application Architecture"   -> "GSC Content Extractor"
        "建店Java版本-应用架构图"                          -> "建店Java版本"
        "LI2500009 - Solution Design"                      -> None
    """
    if not title:
        return None
    t = title.strip()
    t = _PREFIX_COPY_OF.sub("", t)
    t = _PREFIX_PROJECT_ID.sub("", t)
    t = _SUFFIX_EN_ARCH.sub("", t)
    t = _SUFFIX_ZH_ARCH.sub("", t)
    t = t.strip(" -:：\t")
    if not t or len(t) < 2:
        return None
    return t


# ---------------------------------------------------------------------------
# resolve_app_id_via_cmdb — pg_trgm fuzzy match hint -> ref_application.app_id
# ---------------------------------------------------------------------------

DEFAULT_MIN_SIMILARITY = 0.6


def resolve_app_id_via_cmdb(
    cur,
    hint: Optional[str],
    min_similarity: float = DEFAULT_MIN_SIMILARITY,
) -> Optional[str]:
    """Given a free-text hint, find the best CMDB match via pg_trgm similarity.

    Returns the matched app_id if the best hit scores >= min_similarity,
    else None. Uses the given psycopg cursor (caller manages the connection).
    Queries `northstar.ref_application` across name + app_full_name.

    The caller is expected to wrap bulk calls via the `ResolveCache` below
    to avoid one round-trip per duplicate hint.
    """
    if not hint or len(hint) < 2:
        return None
    cur.execute(
        """
        SELECT app_id,
               GREATEST(
                 COALESCE(similarity(name, %(h)s), 0),
                 COALESCE(similarity(app_full_name, %(h)s), 0)
               ) AS sim
        FROM northstar.ref_application
        WHERE name %% %(h)s OR app_full_name %% %(h)s
        ORDER BY sim DESC
        LIMIT 1
        """,
        {"h": hint},
    )
    row = cur.fetchone()
    if not row:
        return None
    # psycopg row could be dict (dict_row) or tuple — support both
    sim = row["sim"] if isinstance(row, dict) else row[1]
    app_id = row["app_id"] if isinstance(row, dict) else row[0]
    if sim is None or sim < min_similarity:
        return None
    return app_id


class ResolveCache:
    """Small wrapper so repeated hints only cost one DB round-trip.

    Usage:
        cache = ResolveCache(cur)
        cache.get("CSDC")         # first call: SELECT
        cache.get("CSDC")         # second: memoized
    """

    def __init__(self, cur, min_similarity: float = DEFAULT_MIN_SIMILARITY):
        self._cur = cur
        self._min = min_similarity
        self._hits: dict[str, Optional[str]] = {}

    def get(self, hint: Optional[str]) -> Optional[str]:
        if not hint:
            return None
        if hint in self._hits:
            return self._hits[hint]
        resolved = resolve_app_id_via_cmdb(self._cur, hint, self._min)
        self._hits[hint] = resolved
        return resolved


# ---------------------------------------------------------------------------
# extract_app_ids_multi — Pattern D: comma-separated A-ids in one title
# ---------------------------------------------------------------------------

_MULTI_APP_ID = re.compile(r"A\d{5,7}")


def extract_app_ids_multi(title: Optional[str]) -> list[str]:
    """Find ALL occurrences of A\\d{5,7} in a title.

    Used for Pattern D where a page title like
    "A000090,A000432,A003974- Architecture" covers multiple apps in one page.
    Returns them in title order, de-duplicated.
    """
    if not title:
        return []
    seen: set[str] = set()
    out: list[str] = []
    for m in _MULTI_APP_ID.finditer(title):
        aid = m.group(0)
        if aid not in seen:
            seen.add(aid)
            out.append(aid)
    return out
