# EA Knowledge Layer

## Context

The EA Confluence Space (key `EA`, ~2841 pages) contains Standards, Guidelines, Reference Architectures, and Templates that Lenovo architects must follow. This content is currently disconnected from NorthStar. Architects manually search Confluence to find applicable standards — an O(minutes) task that NorthStar should compress to O(seconds).

**Goal:** Make EA knowledge searchable and contextually linked within NorthStar.

## Functional Requirements

### FR-1: EA Document Metadata Store
- New PG table `ref_ea_document` stores metadata from EA Confluence space
- Fields: page_id (PK), title, domain, doc_type, page_url, excerpt (500 chars), labels[], last_modified, last_modifier
- Domain codes: `ai`, `aa`, `ta`, `da`, `dpp`, `governance`
- Doc types: `standard`, `guideline`, `reference_arch`, `template`
- No full body content — NorthStar links out to Confluence

### FR-2: Sync Script
- `scripts/sync_ea_documents.py` walks EA space tree via Confluence REST API
- Scans fixed page hierarchy: domain parents → category children → document leaves
- Uses existing CONFLUENCE_BASE_URL + CONFLUENCE_TOKEN env vars
- Upserts into ref_ea_document (ON CONFLICT page_id DO UPDATE)
- Runs weekly as Stage 4 of weekly_sync.sh (non-fatal)

### FR-3: Unified Search Integration
- Search API (`GET /api/search`) returns EA documents as third result group
- Same tsvector + pg_trgm scoring pattern as apps/projects
- Response adds `ea_documents: [{page_id, title, domain, doc_type, page_url, excerpt, score}]`
- CommandPalette shows EA docs with domain+type badges; clicking opens Confluence in new tab

### FR-4: Contextual App Linking
- App Detail page Overview tab shows "EA Standards & Guidelines" panel
- `GET /api/ea-documents/for-app/{app_id}` returns relevant EA docs based on FTS of app name + description + classification against doc title + excerpt
- Results grouped: Standards > Guidelines > Reference Arch
- Panel hidden if no matches

### FR-5: Project Templates Linking
- Project Detail page shows "EA Templates" panel
- `GET /api/ea-documents/templates` returns all template-type documents
- Direct links to Confluence EA Review templates and Solution templates

### FR-6: Standalone Browse Page
- `/standards` page with domain filter pills (All|AI|AA|TA|DA|DPP|Gov) and type filter pills
- Text search across EA documents
- Result cards: title, badges, excerpt, last_modified, Confluence link
- `GET /api/ea-documents?domain=&doc_type=&q=&limit=50&offset=0`

## Non-Functional Requirements

- Search P99 < 100ms (table has ~100 rows with GIN indexes)
- Sync script completes in < 2 minutes for ~100 pages
- All Confluence links open in new tab (`target="_blank"`)
- Follows existing design system (Orbital Ops dark theme, amber accent)

## Acceptance Criteria

- [ ] `ref_ea_document` table created via idempotent migration 016
- [ ] `sync_ea_documents.py` populates ~90-100 rows from EA space
- [ ] `GET /api/search?q=kubernetes` returns `ea_documents` array
- [ ] `GET /api/ea-documents?domain=ta` returns only TA docs
- [ ] `GET /api/ea-documents/for-app/A003530` returns contextual results
- [ ] Cmd+K palette shows EA doc results with Confluence links
- [ ] App Detail Overview tab shows applicable EA standards
- [ ] Project Detail page shows EA templates
- [ ] `/standards` page renders with filters working
- [ ] "Standards" link visible in main nav
- [ ] Weekly sync includes EA document sync as non-fatal stage
- [ ] api-tests/test_ea_documents.py passes

## Edge Cases

- EA space structure changes → sync logs warnings for unknown categories, doesn't crash
- App has no matching standards → panel hidden (not "0 results" state)
- Confluence unreachable during sync → script logs error, exits non-zero, weekly_sync continues
- Empty excerpt (page has no body) → excerpt = NULL, still searchable by title

## Affected Files

| File | Change |
|------|--------|
| `backend/sql/016_ea_documents.sql` | NEW: migration |
| `scripts/sync_ea_documents.py` | NEW: sync script |
| `backend/app/routers/ea_documents.py` | NEW: router |
| `backend/app/main.py` | EDIT: register router |
| `backend/app/routers/search.py` | EDIT: add EA doc search |
| `frontend/src/components/CommandPalette.tsx` | EDIT: add EA doc results |
| `frontend/src/app/apps/[app_id]/page.tsx` | EDIT: add EA Standards panel |
| `frontend/src/app/admin/projects/[project_id]/page.tsx` | EDIT: add EA Templates panel |
| `frontend/src/app/standards/page.tsx` | NEW: browse page |
| `frontend/src/app/layout.tsx` | EDIT: nav link |
| `scripts/weekly_sync.sh` | EDIT: add stage 4 |
| `api-tests/test_ea_documents.py` | NEW: tests |
| `scripts/test-map.json` | EDIT: add mappings |

## Test Coverage

- `test_ea_documents.py`: list, filter by domain, filter by type, for-app, templates, search integration
- Existing `test_search.py` should not break (backward compatible response)

## Out of Scope

- Full body content rendering in NorthStar
- ADR integration (already exists)
- AI-powered semantic matching (start with keyword FTS)
- Confluence webhook for real-time sync (weekly cron is sufficient)
