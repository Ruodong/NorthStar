# API & Data Reference — Architecture Template Settings

## Database

### New: `northstar.ref_architecture_template_source`

| Column | Type | Notes |
|---|---|---|
| `layer` | `VARCHAR PRIMARY KEY` | Enum-like: `'business' \| 'application' \| 'technical'` |
| `title` | `VARCHAR` | Human-readable title shown in the UI |
| `confluence_url` | `VARCHAR` | Full Confluence URL pasted by the user; may be empty |
| `confluence_page_id` | `VARCHAR` | Resolved during sync from URL |
| `last_synced_at` | `TIMESTAMPTZ` | NULL until the first successful sync |
| `last_sync_status` | `VARCHAR` | `NULL \| 'syncing' \| 'ok' \| 'error'` |
| `last_sync_error` | `TEXT` | Populated when status is `'error'` |
| `notes` | `TEXT` | Free-form architect notes |
| `updated_at` | `TIMESTAMPTZ DEFAULT NOW()` | Bumped on every write |

### Altered: `northstar.confluence_page`
- `fiscal_year`: `NOT NULL` → nullable. EA template pages have no fiscal year.
- **ADD** `template_source_layer VARCHAR NULL`. Populated by the sync script.
- **ADD** value `'ea_template'` to the `page_type` vocabulary (column already `VARCHAR`, no DDL needed).
- **ADD** index `idx_cfl_page_template_layer ON (template_source_layer) WHERE template_source_layer IS NOT NULL`.

### Altered: `northstar.confluence_attachment`
- **ADD** `template_source_layer VARCHAR NULL`. Populated by the sync script.
- **ADD** index `idx_cfl_att_template_layer ON (template_source_layer) WHERE template_source_layer IS NOT NULL`.

### Seed Rows

```sql
INSERT INTO northstar.ref_architecture_template_source
    (layer, title, confluence_url)
VALUES
    ('business',    '',                        ''),
    ('application', 'AA Document Templates',   'https://km.xpaas.lenovo.com/display/EA/AA%3A+Document+Templates'),
    ('technical',   'TA Document Templates',   'https://km.xpaas.lenovo.com/display/EA/TA%3A+Document+Templates')
ON CONFLICT (layer) DO NOTHING;
```

## REST Endpoints

All endpoints return `ApiResponse[T]` with snake_case JSON keys.

### `GET /api/settings/architecture-templates`

List all three rows with diagram counts.

**Response** `data`:
```json
[
  {
    "layer": "business",
    "title": "",
    "confluence_url": "",
    "confluence_page_id": null,
    "last_synced_at": null,
    "last_sync_status": null,
    "last_sync_error": null,
    "notes": null,
    "updated_at": "2026-04-18T12:00:00Z",
    "diagram_count": 0
  },
  { "layer": "application", ... "diagram_count": 14 },
  { "layer": "technical",   ... "diagram_count": 22 }
]
```

### `PUT /api/settings/architecture-templates/{layer}`

Update one row. `layer` must be one of `business|application|technical`, else **404**.

**Request**:
```json
{ "title": "AA Document Templates", "confluence_url": "https://...", "notes": null }
```

**Behavior**: Only supplied fields update (others unchanged). Sets `updated_at = NOW()`. Clears `confluence_page_id` if `confluence_url` changed (forcing resolution on next sync).

**Response** `data`: the updated row (same shape as GET item, without `diagram_count`).

### `POST /api/settings/architecture-templates/{layer}/sync`

Fire-and-forget sync. Returns **202** immediately.

**Behavior**:
- Sets `last_sync_status='syncing'`, `last_sync_error=NULL` before returning.
- Schedules `scripts/sync_architecture_templates.py --layer <layer>` as a FastAPI `BackgroundTask`. The background task invokes the script via `subprocess.run`, pipes stdout/stderr to the backend log, and on completion updates `last_sync_status` to `ok` or `error` based on exit code.
- If `confluence_url` is empty, returns **400** with error `"confluence_url not set"` (no status flip).

**Response** `data`: `{ "layer": "application", "status": "syncing" }`.

### `GET /api/settings/architecture-templates/{layer}/diagrams`

List drawio attachments under this layer's subtree.

**Query params**:
- `limit` — default 200, max 500
- `offset` — default 0

**SQL shape**:
```sql
SELECT a.attachment_id, a.title AS file_name, a.media_type, a.file_size,
       a.synced_at, p.page_id, p.title AS page_title, p.page_url
FROM northstar.confluence_attachment a
JOIN northstar.confluence_page p USING (page_id)
WHERE a.template_source_layer = $1
  AND a.file_kind = 'drawio'
ORDER BY p.title, a.title
LIMIT $2 OFFSET $3
```

**Response** `data`:
```json
{
  "total": 14,
  "items": [
    {
      "attachment_id": "att1234567",
      "file_name": "AA-Template-v2.drawio",
      "page_id": "110595434",
      "page_title": "Current Application Architecture Assessment Template(by Domain/Business Value Chain)",
      "page_url": "https://km.xpaas.lenovo.com/display/EA/...",
      "thumbnail_url": "/api/admin/confluence/attachments/att1234567/thumbnail",
      "raw_url": "/api/admin/confluence/attachments/att1234567/raw",
      "preview_url": "/api/admin/confluence/attachments/att1234567/preview",
      "synced_at": "2026-04-18T12:04:33Z"
    }
  ]
}
```

## Sync Script Contract

`scripts/sync_architecture_templates.py`:

```
Usage:
  .venv-ingest/bin/python scripts/sync_architecture_templates.py [--layer <layer>] [--dry-run]

Exit codes:
  0 — all requested layers succeeded (or were no-op due to empty URL)
  1 — at least one layer failed; stderr contains per-layer error rows
```

**Per-layer pseudocode**:

```
row = SELECT * FROM ref_architecture_template_source WHERE layer=?
if not row.confluence_url: mark 'ok' (no-op); continue
set last_sync_status='syncing'
try:
    page_id = resolve_url_to_page_id(row.confluence_url)
    UPDATE ref_architecture_template_source SET confluence_page_id=page_id
    visited = {}
    queue = [page_id]
    while queue:
        pid = queue.pop(0)
        if pid in visited: continue
        visited.add(pid)
        page = fetch_page_detail(pid)
        upsert confluence_page (page_id, title, page_url, fiscal_year=NULL,
                                page_type='ea_template', template_source_layer=layer)
        attachments = fetch_attachments(pid)
        for att in attachments:
            if att.file_kind in {'drawio','image'}:
                upsert confluence_attachment (..., template_source_layer=layer)
                download_file(att.download_path, local_path)
        for child in list_children(pid):
            queue.append(child.id)
    UPDATE ref_architecture_template_source
       SET last_synced_at=NOW(), last_sync_status='ok', last_sync_error=NULL
except Exception as e:
    UPDATE ref_architecture_template_source
       SET last_sync_status='error', last_sync_error=str(e)[:500]
    raise
```

## Reused Endpoints

- `GET /api/admin/confluence/attachments/{attachment_id}/raw` — serves the drawio XML bytes
- `GET /api/admin/confluence/attachments/{attachment_id}/thumbnail` — small webp thumbnail
- `GET /api/admin/confluence/attachments/{attachment_id}/preview` — rendered PNG preview

No changes to these routes; Settings page links through to them by attachment_id.
