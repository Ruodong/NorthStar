# Questionnaire Page Link Extraction

| Field   | Value                     |
|---------|---------------------------|
| Author  | Ruodong Yang              |
| Date    | 2026-04-12                |
| Status  | In progress               |

---

## 0. Impact Assessment

| Axis | Value |
|---|---|
| Level | **L2** |
| Risk | **Low** — additive, uses existing `drawio_reference` table with new `macro_kind='page_link'` |
| Downstream | `/api/admin/confluence/pages/{id}` attachments, `/extracted` endpoint, parse pipeline |
| Rollback | `DELETE FROM drawio_reference WHERE macro_kind = 'page_link'` |

---

## 1. Context

Confluence project pages contain a "Scope of Change" questionnaire table where
architects link to their architecture design pages in the "Your Pages" column.
These links follow the pattern:

```
<a href="https://km.xpaas.lenovo.com/pages/viewpage.action?pageId=305694148">
  LI2400034 - LI2400051 -EaaS To-be Application Architecture - FY2425
</a>
```

The linked pages hold the actual drawio attachments with architecture diagrams.
This is a third reference pattern alongside the existing `inc-drawio` and
`templateUrl` macro patterns already tracked in `drawio_reference`.

**Scale**: 997 / 2,769 pages (36%) contain `viewpage.action?pageId=` links.
76 unique target page IDs: 26 already scanned, 50 not yet scanned. Of the
26 scanned targets, 15+ have drawio attachments.

## 2. Functional Requirements

- **FR-1** `scripts/scan_confluence.py` MUST extract `pageId=NNN` links from
  `body_html` during the page scan pass and insert them into `drawio_reference`
  with `macro_kind = 'page_link'`.

- **FR-2** Only Confluence internal links are extracted (matching
  `viewpage.action?pageId=` or `/pages/viewpage.action?pageId=`). SharePoint,
  mailto, and other external links are ignored.

- **FR-3** Self-links (where the referenced pageId equals the current page's
  own page_id) are excluded — they add no information.

- **FR-4** Links to pages within the same subtree (parent/child/sibling) are
  still recorded — the drawio_reference table is the single source of truth
  for cross-page references regardless of tree position.

- **FR-5** The existing admin UI (Attachments tab, Extracted tab) already
  consumes `drawio_reference` via the `all_sources` CTE. No frontend changes
  are needed — pages linked via `page_link` will automatically appear with
  `source_kind = 'referenced'` once their `drawio_reference` rows exist.

- **FR-6** For the 50 not-yet-scanned target pages: the existing
  `scripts/backfill_drawio_sources.py` already handles fetching source pages
  that appear in `drawio_reference` but are missing from `confluence_page`.
  No new backfill logic needed — just run the backfill after scan.

## 3. Non-Functional Requirements

- **NFR-1** Link extraction must be idempotent — re-scanning a page updates
  `last_seen_at` but does not create duplicate rows (PK constraint handles this).
- **NFR-2** Extraction adds < 1ms per page (regex over body_html, no API calls).

## 4. Acceptance Criteria

- **AC-1** After a full scan, `drawio_reference` contains rows with
  `macro_kind = 'page_link'` for page 413188917 (EaaS Deal Onboarding
  Migration) linking to pageIds 305694148, 342214629, 41893856.
- **AC-2** The existing Attachments tab / Extracted tab on page 413188917
  shows drawio attachments from the linked pages (once those pages are
  scanned and their attachments downloaded).
- **AC-3** `SELECT count(*) FROM drawio_reference WHERE macro_kind = 'page_link'`
  returns > 0 after scan.

## 5. Implementation

Add a `_parse_page_links()` function to `scan_confluence.py` alongside the
existing `_parse_drawio_refs()`. Call it from the same place in `process_page()`
where drawio refs are parsed. Insert results into `drawio_reference` using
the same upsert pattern.

```python
_PAGE_LINK_RE = re.compile(r'pageId=(\d+)')

def _parse_page_links(inclusion_page_id: str, body_html: str) -> list[dict]:
    refs = []
    seen = set()
    for m in _PAGE_LINK_RE.finditer(body_html or ""):
        target = m.group(1)
        if target == inclusion_page_id or target in seen:
            continue
        seen.add(target)
        refs.append({
            "inclusion_page_id": inclusion_page_id,
            "source_page_id": target,
            "macro_kind": "page_link",
            "diagram_name": "",
            "template_filename": None,
        })
    return refs
```

## 6. Affected files

- `scripts/scan_confluence.py` (modified) — add `_parse_page_links()`, call from `process_page()`
- `.specify/features/questionnaire-page-links/spec.md` (new) — this file

## 7. Out of scope

- SharePoint links (e.g. `.pptx` on `lenovobeijing.sharepoint.com`) — different auth, different storage
- Fetching not-yet-scanned target pages inline during scan — handled by existing `backfill_drawio_sources.py`
- Differentiating questionnaire links from body links — all `pageId=` links are treated equally
