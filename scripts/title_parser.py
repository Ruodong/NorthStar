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

# Pattern E: "<anything> Application Architecture - <APP_NAME>" (or Technical /
# Solution etc). The arch keyword is a mid-title SEPARATOR, and the app name
# is the trailing segment. Captures the tail as the hint.
_MID_EN_ARCH_SEP    = re.compile(
    r"^.+?\s+(Application|Technical|Solution|Integration|Integrated)"
    r"\s+(Architecture|Design)\s*[\-:：]\s*(?P<tail>.+?)\s*$",
    re.IGNORECASE,
)


def extract_app_hint(title: Optional[str]) -> Optional[str]:
    """Extract a free-text application name hint from a Confluence page title.

    IMPORTANT: the extractor ONLY returns a hint when it sees evidence that
    the page is actually an architecture/design leaf page. Three patterns
    are recognized:

    1. Arch/design suffix at the END (Pattern B):
         "LI2500034-CSDC-Solution Design"              -> "CSDC"
         "GSC Content Extractor Application Architecture" -> "GSC Content Extractor"
         "建店Java版本-应用架构图"                     -> "建店Java版本"

    2. Arch/design phrase as mid-title SEPARATOR (Pattern E):
         "KSA Application Architecture - OF"           -> "OF"
         "KSA Application Architecture - LeMES-MBG"    -> "LeMES-MBG"

    3. No suffix and no mid-title separator → None (e.g. section titles like
       "00 Order Fulfillment", project folders like "KSA Oasis DTIT Project").
    """
    if not title:
        return None
    t = title.strip()
    t = _PREFIX_COPY_OF.sub("", t)
    t = _PREFIX_PROJECT_ID.sub("", t)

    # Rule 2: mid-title "<...> Application Architecture - <APP>" — the tail
    # after the separator is the hint. Run this BEFORE the suffix check so
    # titles like "KSA Application Architecture - OF" (which would also
    # partially match the suffix regex on "Architecture" at the end) fall
    # into this branch first.
    m = _MID_EN_ARCH_SEP.match(t)
    if m:
        tail = m.group("tail").strip(" -:：\t")
        if tail and len(tail) >= 2:
            return tail
        return None

    # Rule 1: trailing arch/design suffix
    t_after_en, en_matches = _SUFFIX_EN_ARCH.subn("", t)
    t_after_zh, zh_matches = _SUFFIX_ZH_ARCH.subn("", t_after_en)
    if en_matches == 0 and zh_matches == 0:
        return None

    t = t_after_zh.strip(" -:：&\t")
    if not t or len(t) < 2:
        return None

    # Combined titles like "KSA Application Architecture & Technical Design"
    # leave "Application Architecture" residue after stripping one suffix.
    # Reject if the residue still contains an arch/design keyword — it's not
    # a clean app name, it's an umbrella title.
    if re.search(
        r"\b(Application|Technical|Solution|Integration|Integrated)\b"
        r".*\b(Architecture|Design)\b",
        t,
        re.IGNORECASE,
    ):
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

# Negative lookbehind for a letter so we don't match "A250197" inside
# "EA250197" (the EA-prefixed project id convention). Negative lookahead
# for a trailing digit so "A0000901" doesn't split into A000090 / 1.
# Must be preceded by start-of-string or a non-letter character.
_MULTI_APP_ID = re.compile(r"(?<![A-Za-z])A\d{5,7}(?!\d)")


def extract_app_ids_multi(title: Optional[str]) -> list[str]:
    """Find ALL non-substring occurrences of A\\d{5,7} in a title.

    Used for Pattern D where a page title like
    "A000090,A000432,A003974- Architecture" covers multiple apps in one page.
    Returns them in title order, de-duplicated.

    Rejects A-ids that are substrings of other identifiers:
      - "EA250197-FY2526-..." does NOT yield A250197 (preceded by E)
      - "A000090,A000432" yields ['A000090', 'A000432']        (comma OK)
      - "A0000901" does NOT yield A000090                       (trailing digit)
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
