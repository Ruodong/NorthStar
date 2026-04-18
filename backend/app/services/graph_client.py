"""Apache AGE graph client — drop-in replacement for neo4j_client.py.

AGE (Apache Graph Extension) is a Postgres extension that embeds openCypher
support into standard SQL. This module keeps the same public surface as
neo4j_client.py — `connect()`, `close()`, `ensure_schema()`, `run_query()`,
`run_write()` — so callers (routers, services) change only their import
statement when switching from Neo4j.

How it works:
    1. A dedicated asyncpg pool is created (separate from pg_client's pool
       to isolate session state — we `LOAD 'age'` on every new connection).
    2. Each Cypher call is wrapped in a SQL statement of the form
           SELECT * FROM ag_catalog.cypher(
               'ns_graph',
               $$ <cypher> $$,
               $1::ag_catalog.agtype       -- JSON params
           ) AS (col1 ag_catalog.agtype, col2 ag_catalog.agtype, ...)
       where the `AS (...)` column list is auto-derived from the Cypher's
       RETURN clause (see _extract_return_columns).
    3. Results come back as `agtype` text, which we parse into native Python
       types — vertex/edge dicts flatten to their properties dict so the
       caller sees the same shape as Neo4j driver's record.data().

Why separate pool: `LOAD 'age'` is a session-level setting that persists on
the connection. Running it on connections shared with pg_client would be
harmless (it's a no-op after first load), but the init hook cleanly ensures
every connection in THIS pool has AGE ready.

Spec: .specify/features/age-migration/spec.md  §FR-CLT-1 .. FR-CLT-6
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any, Optional

import asyncpg

from app.config import settings

logger = logging.getLogger(__name__)

GRAPH_NAME = "ns_graph"

_pool: Optional[asyncpg.Pool] = None


# ---------------------------------------------------------------------------
# Connection lifecycle
# ---------------------------------------------------------------------------

async def _init_age_connection(conn: asyncpg.Connection) -> None:
    """Run once per pool connection — prepare the session for AGE Cypher calls.

    - `LOAD 'age'` loads the extension's shared library into this session
      (idempotent, fast no-op if already loaded).
    - `SET search_path` puts `ag_catalog` ahead of user/public so the AGE
      operators (`->`, `->>`, `#>`, etc. on agtype) resolve without schema
      qualification. Function calls we still schema-qualify explicitly
      (`ag_catalog.cypher`, `ag_catalog.agtype`) for clarity.
    """
    await conn.execute("LOAD 'age'")
    await conn.execute('SET search_path = ag_catalog, "$user", public')


async def connect() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        logger.info("Connecting AGE graph client to Postgres (graph=%s)", GRAPH_NAME)
        _pool = await asyncpg.create_pool(
            dsn=settings.postgres_dsn,
            min_size=1,
            max_size=5,
            command_timeout=30,
            init=_init_age_connection,
        )
    return _pool


async def close() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


# ---------------------------------------------------------------------------
# Schema bootstrap — label tables + property indexes
# ---------------------------------------------------------------------------

_NODE_LABELS = ("Application", "Project", "Diagram", "ConfluencePage")
_EDGE_TYPES = (
    "INVESTS_IN",
    "INTEGRATES_WITH",
    "HAS_DIAGRAM",
    "DESCRIBED_BY",
    "HAS_CONFLUENCE_PAGE",
    "HAS_REVIEW_PAGE",
)

# Replaces the 4 Neo4j CREATE CONSTRAINT statements from neo4j_client.py.
# AGE has no Cypher-level unique constraint, so we enforce uniqueness via a
# PG expression index on the property's text projection.
_UNIQUE_INDEXES: tuple[tuple[str, str, str], ...] = (
    # (index_name, label, property)
    ("app_id_uniq", "Application", "app_id"),
    ("project_id_uniq", "Project", "project_id"),
    ("diagram_id_uniq", "Diagram", "diagram_id"),
    ("page_id_uniq", "ConfluencePage", "page_id"),
)

# Replaces Neo4j's CREATE INDEX statements for common filter columns.
_FILTER_INDEXES: tuple[tuple[str, str, str], ...] = (
    ("app_status_idx", "Application", "status"),
    ("app_cmdb_linked_idx", "Application", "cmdb_linked"),
    ("project_fy_idx", "Project", "fiscal_year"),
    ("diagram_type_idx", "Diagram", "diagram_type"),
    ("invests_in_fy_idx", "INVESTS_IN", "fiscal_year"),
)


async def ensure_schema() -> None:
    """Create vertex/edge labels and property indexes (idempotent).

    This runs the AGE equivalent of neo4j_client.SCHEMA_STATEMENTS. It is safe
    to call on every backend startup:
      - `create_vlabel` / `create_elabel` raise `duplicate_table` if called on
        an existing label, so we catch and ignore that specific error.
      - `CREATE [UNIQUE] INDEX IF NOT EXISTS` is natively idempotent.
    """
    pool = await connect()
    async with pool.acquire() as conn:
        # 1. Vertex + edge labels
        for label in _NODE_LABELS:
            try:
                await conn.execute(
                    f"SELECT ag_catalog.create_vlabel('{GRAPH_NAME}', '{label}')"
                )
            except asyncpg.exceptions.DuplicateTableError:
                pass  # label already exists — expected on re-runs
            except Exception as exc:  # noqa: BLE001
                # Some AGE versions raise a generic error with "already exists"
                # in the message rather than DuplicateTableError. Swallow those.
                if "already exists" not in str(exc).lower():
                    logger.warning("create_vlabel(%s) failed: %s", label, exc)
        for etype in _EDGE_TYPES:
            try:
                await conn.execute(
                    f"SELECT ag_catalog.create_elabel('{GRAPH_NAME}', '{etype}')"
                )
            except asyncpg.exceptions.DuplicateTableError:
                pass
            except Exception as exc:  # noqa: BLE001
                if "already exists" not in str(exc).lower():
                    logger.warning("create_elabel(%s) failed: %s", etype, exc)

        # 2. Uniqueness + filter indexes on the auto-created label tables
        for idx_name, label, prop in _UNIQUE_INDEXES:
            await conn.execute(
                f'CREATE UNIQUE INDEX IF NOT EXISTS {idx_name} '
                f'ON {GRAPH_NAME}."{label}" '
                f'(((properties -> \'"{prop}"\'::ag_catalog.agtype)::text))'
            )
        for idx_name, label, prop in _FILTER_INDEXES:
            await conn.execute(
                f'CREATE INDEX IF NOT EXISTS {idx_name} '
                f'ON {GRAPH_NAME}."{label}" '
                f'(((properties -> \'"{prop}"\'::ag_catalog.agtype)::text))'
            )


# ---------------------------------------------------------------------------
# Cypher execution — the hot path
# ---------------------------------------------------------------------------

async def run_query(
    cypher: str, params: Optional[dict[str, Any]] = None
) -> list[dict[str, Any]]:
    """Execute a read-only Cypher query, return list of dicts keyed by RETURN aliases.

    Matches neo4j_client.run_query's contract exactly: each dict in the result
    list corresponds to one row, with keys derived from the Cypher RETURN clause.
    """
    columns = _extract_return_columns(cypher)
    sql, args = _build_sql(cypher, params, columns)

    pool = await connect()
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, *args)

    if not columns:
        # Pure-write query that somehow got run via run_query — no rows expected.
        return []

    return [
        {col: _parse_agtype(row[col]) for col in columns}
        for row in rows
    ]


async def run_write(
    cypher: str, params: Optional[dict[str, Any]] = None
) -> None:
    """Execute a write Cypher query. Swallows returned rows.

    If the Cypher has no RETURN clause, AGE still requires at least one
    declared column in the `AS (...)` list. In that case we append a dummy
    RETURN of a constant so the SQL wrapper is valid.
    """
    columns = _extract_return_columns(cypher)
    if not columns:
        # Append a no-op RETURN so AGE accepts the wrapper's AS (...) clause.
        # The constant is discarded; this is purely a syntactic requirement.
        cypher = cypher.rstrip().rstrip(";") + "\nRETURN 0 AS _ignored"
        columns = ["_ignored"]

    sql, args = _build_sql(cypher, params, columns)

    pool = await connect()
    async with pool.acquire() as conn:
        await conn.execute(sql, *args)


# ---------------------------------------------------------------------------
# SQL assembly — wrap a Cypher string in AGE's cypher() function call
# ---------------------------------------------------------------------------

def _build_sql(
    cypher: str,
    params: Optional[dict[str, Any]],
    columns: list[str],
) -> tuple[str, list[Any]]:
    """Construct the SQL wrapper + positional args for a Cypher query.

    AGE's cypher() accepts the params as a single agtype value. We pass
    JSON-serialised dict and cast to agtype in the SQL.

    The column declarations in `AS (...)` must match the number of Cypher
    RETURN expressions. Each is declared as ag_catalog.agtype.
    """
    # Column declaration — names sanitised (only [a-zA-Z0-9_]).
    col_decl = ", ".join(
        f'"{_safe_ident(c)}" ag_catalog.agtype' for c in columns
    )
    # When columns is empty (no RETURN, e.g., pure MATCH ... DELETE), AGE
    # still requires the AS clause — provide a placeholder column.
    if not col_decl:
        col_decl = '"v" ag_catalog.agtype'

    # Escape $$ pairs inside user Cypher (rare, but possible in string
    # literals) by choosing an unused tag.
    tag = _unused_dollar_tag(cypher)

    if params:
        sql = (
            f"SELECT * FROM ag_catalog.cypher("
            f"'{GRAPH_NAME}', "
            f"${tag}${cypher}${tag}$, "
            f"$1::ag_catalog.agtype"
            f") AS ({col_decl})"
        )
        args: list[Any] = [json.dumps(params, default=_json_default)]
    else:
        sql = (
            f"SELECT * FROM ag_catalog.cypher("
            f"'{GRAPH_NAME}', "
            f"${tag}${cypher}${tag}$"
            f") AS ({col_decl})"
        )
        args = []
    return sql, args


def _json_default(obj: Any) -> Any:
    """JSON fallback for non-primitive params (e.g., datetime, Decimal).

    AGE accepts ints/floats/strings/bools/null/arrays/objects via agtype. Any
    unsupported Python value is stringified as a last resort.
    """
    return str(obj)


_IDENT_RE = re.compile(r"[^A-Za-z0-9_]")


def _safe_ident(name: str) -> str:
    """Sanitise a string for use as a SQL column identifier.

    We still double-quote in the SQL, but defensively remove chars that
    would close the quoting.
    """
    cleaned = _IDENT_RE.sub("_", name)
    return cleaned or "col"


def _unused_dollar_tag(text: str) -> str:
    """Find a $<tag>$ sequence not already present in text, for safe quoting."""
    candidates = ["ns", "nscy", "nsage", "nsq", "ns1", "ns2"]
    for tag in candidates:
        if f"${tag}$" not in text:
            return tag
    # Ultra-defensive fallback.
    i = 0
    while True:
        tag = f"nsx{i}"
        if f"${tag}$" not in text:
            return tag
        i += 1


# ---------------------------------------------------------------------------
# RETURN clause parser — auto-derive the SQL column list
# ---------------------------------------------------------------------------

_TAIL_RE = re.compile(
    r"\b(order\s+by|limit|skip|union)\b", re.IGNORECASE
)
_AS_RE = re.compile(
    r"\bas\s+([A-Za-z_][A-Za-z0-9_]*)\s*$", re.IGNORECASE
)
_SIMPLE_IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_COMMENT_RE = re.compile(r"//[^\n]*")


def _extract_return_columns(cypher: str) -> list[str]:
    """Parse RETURN clause → list of column names for the SQL AS (...) list.

    Handles the subset of Cypher used in NorthStar:
      - `RETURN a, b AS alias, count(c) AS total`
      - `RETURN a.app_id AS app_id, coalesce(x, '') AS s`
      - `RETURN collect({k: v, ...}) AS xs`
      - `RETURN a` (single unaliased node)

    Returns [] if no RETURN clause present (caller treats as write).
    """
    text = _COMMENT_RE.sub("", cypher)

    # Find the LAST top-level RETURN. We scan for the keyword at word
    # boundaries; Cypher doesn't allow RETURN inside string literals in our
    # codebase's queries, so a simple find works.
    idx = _find_last_keyword(text, "return")
    if idx < 0:
        return []

    tail = text[idx + len("return"):]

    # Truncate at any clause that terminates the RETURN list.
    m = _TAIL_RE.search(tail)
    if m:
        # Check the match isn't inside a bracket (e.g., list(... ORDER BY...))
        # For our codebase, ORDER BY / LIMIT / SKIP appear only at top level
        # of RETURN, so simple regex suffices.
        tail = tail[: m.start()]

    parts = _split_top_level_commas(tail)

    columns: list[str] = []
    for i, part in enumerate(parts):
        expr = part.strip()
        if not expr:
            continue
        alias = _extract_alias(expr)
        if alias:
            columns.append(alias)
        elif _SIMPLE_IDENT_RE.match(expr):
            # Unaliased simple variable — use it directly (Neo4j does the same).
            columns.append(expr)
        elif "." in expr and _SIMPLE_IDENT_RE.match(expr.split(".")[-1] or ""):
            # `a.name` → column key "a.name" in Neo4j. We normalize to the
            # last segment because "a.name" with a dot wouldn't be a valid
            # SQL identifier, and PG callers don't rely on this shape.
            columns.append(expr.split(".")[-1])
        else:
            columns.append(f"col{i}")
    return columns


def _find_last_keyword(text: str, keyword: str) -> int:
    """Last index of a keyword (case-insensitive, word-bounded), ignoring strings."""
    lower = text.lower()
    i = len(text) - len(keyword)
    while i >= 0:
        idx = lower.rfind(keyword, 0, i + len(keyword) + 1)
        if idx < 0:
            return -1
        # Check word boundaries
        before_ok = idx == 0 or not text[idx - 1].isalnum() and text[idx - 1] != "_"
        after = idx + len(keyword)
        after_ok = after >= len(text) or (not text[after].isalnum() and text[after] != "_")
        if before_ok and after_ok and not _is_inside_string(text, idx):
            return idx
        i = idx - 1
    return -1


def _is_inside_string(text: str, pos: int) -> bool:
    """True if `pos` falls inside a single- or double-quoted string."""
    in_single = False
    in_double = False
    i = 0
    while i < pos:
        c = text[i]
        if c == "'" and not in_double:
            # Handle escaped quote
            if i + 1 < len(text) and text[i + 1] == "'" and in_single:
                i += 2
                continue
            in_single = not in_single
        elif c == '"' and not in_single:
            in_double = not in_double
        elif c == "\\" and (in_single or in_double):
            i += 2
            continue
        i += 1
    return in_single or in_double


def _split_top_level_commas(text: str) -> list[str]:
    """Split `text` on commas not nested inside (), [], {}, or string literals."""
    parts: list[str] = []
    depth = 0
    start = 0
    i = 0
    in_str: Optional[str] = None
    while i < len(text):
        c = text[i]
        if in_str:
            if c == "\\":
                i += 2
                continue
            if c == in_str:
                in_str = None
            i += 1
            continue
        if c in ("'", '"'):
            in_str = c
        elif c in "([{":
            depth += 1
        elif c in ")]}":
            depth -= 1
        elif c == "," and depth == 0:
            parts.append(text[start:i])
            start = i + 1
        i += 1
    parts.append(text[start:])
    return parts


def _extract_alias(expr: str) -> Optional[str]:
    """Extract the `AS <alias>` at the end of an expression, if present."""
    # Operate on the expression with parenthesised/bracketed groups collapsed
    # to avoid matching an inner `AS` inside a subexpression.
    collapsed = _collapse_brackets(expr)
    m = _AS_RE.search(collapsed)
    return m.group(1) if m else None


def _collapse_brackets(expr: str) -> str:
    """Replace bracketed/parenthesised groups with a placeholder of equal length.

    This lets a regex anchored at end-of-string find the tail `AS <alias>`
    without tripping over `AS` keywords that appear inside function calls or
    list comprehensions (e.g., `[x IN y | x AS z]`).
    """
    out = []
    depth = 0
    in_str: Optional[str] = None
    for c in expr:
        if in_str:
            out.append(c if depth == 0 else "X")
            if c == in_str:
                in_str = None
            continue
        if c in ("'", '"'):
            in_str = c
            out.append(c if depth == 0 else "X")
            continue
        if c in "([{":
            depth += 1
            out.append("X")
        elif c in ")]}":
            depth -= 1
            out.append("X")
        else:
            out.append("X" if depth > 0 else c)
    return "".join(out)


# ---------------------------------------------------------------------------
# agtype decoding
# ---------------------------------------------------------------------------

# AGE text-serialises graph elements with suffixes: `{...}::vertex`, `{...}::edge`, `{...}::path`.
# Strip these before JSON-parsing. The regex matches only when immediately
# after a closing brace/bracket, preventing false positives inside string values.
_AGTYPE_SUFFIX_RE = re.compile(r"(?<=[\]}])::(?:vertex|edge|path)\b")


def _parse_agtype(value: Any) -> Any:
    """Convert an agtype text value (as returned by asyncpg) to a Python native.

    Graph-element dicts (vertex/edge) are flattened to their `properties` dict
    so downstream code sees the same shape as Neo4j driver's record.data().
    """
    if value is None:
        return None
    if not isinstance(value, str):
        # Older asyncpg + AGE combos may pre-decode; pass through.
        return _flatten_graph_elements(value)

    cleaned = _AGTYPE_SUFFIX_RE.sub("", value)
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        # Not a JSON scalar — return raw text (e.g., a Cypher-level string
        # already unquoted).
        return cleaned
    return _flatten_graph_elements(parsed)


def _flatten_graph_elements(val: Any) -> Any:
    """Recursively reduce AGE vertex/edge dicts to their properties dict.

    Vertex shape: {"id": int, "label": str, "properties": {...}}
    Edge shape:   {"id": int, "label": str, "start_id": int, "end_id": int, "properties": {...}}

    Caller-facing shape: just the inner properties dict, matching Neo4j
    driver's dict(node) behaviour. Callers that need label/id can extend
    this later; none do today.
    """
    if isinstance(val, dict):
        keys = set(val.keys())
        if (
            "properties" in keys
            and "label" in keys
            and "id" in keys
            and keys <= {"id", "label", "properties", "start_id", "end_id"}
        ):
            return _flatten_graph_elements(val.get("properties") or {})
        return {k: _flatten_graph_elements(v) for k, v in val.items()}
    if isinstance(val, list):
        return [_flatten_graph_elements(x) for x in val]
    return val
