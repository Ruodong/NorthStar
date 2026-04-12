# Office File In-Browser Preview

| Field   | Value                |
|---------|----------------------|
| Author  | Ruodong Yang         |
| Date    | 2026-04-11           |
| Status  | Draft                |

---

## 1. Context

Architects using the `/admin/confluence/[page_id]` detail view can currently download Office attachments (PPTX / DOCX / XLSX) but cannot preview them in the browser. Today the attachments card renders type / size / Download link and then a ~700px blank area. Every review of a PPTX architecture deck requires the architect to download, open in PowerPoint, close, download the next one, and so on — there is no way to skim content inside NorthStar.

NorthStar currently stores **525 Office files** (440 PPTX, 73 XLSX, 10 DOCX, 2 ConceptDraw). PPTX is the dominant case at 84% of rows (avg 7.35 MB, max 79 MB) and holds most of the real architecture drawings that live outside drawio. XLSX and DOCX are much smaller in count and size.

This feature makes those files viewable inline:

- **PPTX / DOCX** render via a new `northstar-converter` sidecar container (LibreOffice headless) → PDF → browser-native PDF viewer embedded in an `<iframe>`.
- **XLSX** render entirely client-side via [SheetJS](https://sheetjs.com) → HTML table with sheet tabs.

The feature is **admin-surface only** — it does not change the /apps or /graph surfaces, ontology, loader, or any PG / Neo4j invariants. It adds one new container, one new backend endpoint, one new frontend component, and one new npm dependency.

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **LibreOffice headless for PPTX/DOCX, NOT Microsoft/Google Online Viewer** | MS/Google viewers require a **public** URL so their servers can fetch the file. NorthStar runs at `192.168.68.71` on internal network — not reachable. Even if it were, uploading Lenovo internal architecture PPTs to Microsoft/Google is a data-exfiltration non-starter. |
| **Sidecar converter container, NOT bake LibreOffice into backend image** | LibreOffice + CJK fonts adds ~700MB to the image and slows backend startup. A dedicated `northstar-converter` service isolates the heavy dependency, keeps backend lean, makes future format additions (epub, rtf, odp) cheap, and gives resource isolation — a stuck conversion does not block the FastAPI event loop. |
| **Convert to PDF, NOT per-slide PNG** | Browsers render PDF natively (pdfium/PDF.js) with page navigation, zoom, text search, copy-paste — all zero frontend code. PNG-per-slide would require a custom carousel, higher disk usage, and lose text search. |
| **XLSX goes client-side via SheetJS, NOT through LibreOffice** | 73 XLSX files average 130KB and max 1.4MB — tiny payload. SheetJS renders them faithfully as HTML tables with multi-sheet tabs and cell types preserved. A PDF render of a spreadsheet loses cell interactivity (search, copy, sort) and is strictly worse UX for grids. |
| **Cache converted PDFs to `data/attachments/{id}.pdf`** | First conversion of a 7MB PPT takes 5–15s; subsequent views must be near-instant. Keying by `attachment_id` mirrors how raw files are named today (`data/attachments/{id}.drawio`, `.png`, ...) so the storage layout stays consistent. |
| **Not supporting legacy `.ppt` / `.xls` / `.doc`** | Total count across NorthStar < 15 rows. Adding legacy binary support in the converter is not worth the complexity; falls back to Download link. |
| **Not supporting ConceptDraw (`document/conceptdrawdiagram`)** | 2 files total. LibreOffice cannot parse ConceptDraw; would need a separate proprietary tool. Falls back to Download link. |

---

## 2. Functional Requirements

### 2.1 Converter Container

| ID | Requirement |
|----|-------------|
| FR-1 | `northstar-converter` MUST be a new docker-compose service built from `scripts/converter/Dockerfile`. |
| FR-2 | The converter image MUST include LibreOffice core + `libreoffice-impress` + `libreoffice-writer` + `libreoffice-calc`. |
| FR-3 | The converter image MUST include Chinese font packages (`fonts-noto-cjk`, `fonts-wqy-microhei`, `fonts-wqy-zenhei`) so CJK text renders correctly. |
| FR-4 | The converter MUST expose a single HTTP endpoint `POST /convert` that accepts a multipart file upload and returns the converted PDF as `application/pdf`. |
| FR-5 | The converter MUST be reachable by the backend container via the docker internal hostname `converter:8080`. It MUST NOT be published to the host network. |
| FR-6 | The converter SHOULD run each conversion in a subprocess with a **120-second timeout**; a stuck LibreOffice MUST be killed and the endpoint MUST return HTTP 504. |
| FR-7 | The converter MUST reject any file larger than **100 MB** with HTTP 413. |

### 2.2 Backend Preview Endpoint

| ID | Requirement |
|----|-------------|
| FR-8 | `GET /api/admin/attachments/{attachment_id}/preview` MUST serve a preview-ready response based on the attachment's file kind. |
| FR-9 | For `media_type = application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` (XLSX), the endpoint MUST stream the raw file bytes with the original content-type so SheetJS on the client can parse it. |
| FR-10 | For `media_type = application/vnd.openxmlformats-officedocument.presentationml.presentation` (PPTX) and `...wordprocessingml.document` (DOCX), the endpoint MUST return `application/pdf`. |
| FR-11 | PPTX/DOCX conversion MUST be **cached**: if `data/attachments/{id}.pdf` exists, serve it directly without calling the converter. |
| FR-12 | On cache miss, the endpoint MUST POST the source file to `http://converter:8080/convert`, write the response body to `data/attachments/{id}.pdf`, and then serve that file. |
| FR-13 | Any attachment whose file kind is not `office`, or whose media_type is not in the allow-list above (e.g. `.ppt`, `.xls`, `.doc`, ConceptDraw), MUST return HTTP 415 with error code `unsupported_format`. |
| FR-14 | If the attachment row does not exist, the endpoint MUST return HTTP 404 with error code `not_found`. |
| FR-15 | If the attachment has `local_path IS NULL` (not downloaded yet), the endpoint MUST return HTTP 404 with error code `file_missing`. |
| FR-16 | If the converter returns non-200 or times out, the endpoint MUST return HTTP 502 with error code `converter_failed` and include the converter's error message in the detail field. |
| FR-17 | The endpoint MUST set `Cache-Control: public, max-age=31536000, immutable` so browsers cache the PDF aggressively (attachment_id is stable). |
| FR-18 | The endpoint MUST NOT wrap the response in the `ApiResponse<T>` envelope — it returns raw binary. This is an explicit exemption from NFR-1 of the root template because the client is a `<iframe>` / SheetJS, not a JSON consumer. |

### 2.3 Frontend Preview Component

| ID | Requirement |
|----|-------------|
| FR-19 | On the `/admin/confluence/[page_id]` detail page, when an attachment row is expanded or selected, the card MUST render a preview area below the metadata/Download line. |
| FR-20 | For PPTX / DOCX, the preview area MUST contain `<iframe src="/api/admin/attachments/{id}/preview">` with a 700px min-height responsive to card width. |
| FR-21 | For XLSX, the preview area MUST render a table component using SheetJS (`xlsx` npm package) with one tab per workbook sheet. |
| FR-22 | While PPTX/DOCX is converting on first view (can take 15s+), the preview area MUST show a skeleton state with a "Converting…" label and an animated stripe. Browsers already block iframe rendering until the response arrives, so the skeleton is implemented as "render the iframe + overlay a loader until the iframe's `load` event fires". |
| FR-23 | If the preview endpoint returns an error (415 / 404 / 502), the preview area MUST show a friendly error state with the error code and keep the existing Download button functional. |
| FR-24 | Unsupported formats (`.ppt`, `.xls`, `.doc`, ConceptDraw, unknown office types) MUST NOT render a preview area at all — the existing Download-only row stays as-is. |
| FR-25 | The preview area MUST lazy-load: the iframe/SheetJS component is not instantiated until the user clicks a "Preview" affordance or the card is expanded. This avoids running 5 conversions simultaneously when an architect opens a page with 5 PPT attachments. |

---

## 3. Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NFR-1 | **No public network egress.** Converter MUST NOT call out to the internet. LibreOffice's online update check MUST be disabled at image build time. |
| NFR-2 | **First-view conversion latency:** typical 7MB PPT ≤ 15 seconds; worst-case 79MB PPT ≤ 60 seconds. Backend timeout when calling converter is 125 seconds (120s FR-6 + 5s margin). |
| NFR-3 | **Cached-view latency:** ≤ 100ms for cached PDF (served by FastAPI `FileResponse`). |
| NFR-4 | **Disk budget:** PDF cache directory MUST stay under 2GB (expected 900MB for all 450 PPTX/DOCX at ~30% of source size). |
| NFR-5 | **Idempotency:** two concurrent requests for the same uncached attachment MUST NOT corrupt the cache file. Implementation uses `O_EXCL` temp file + atomic rename, not an in-process lock, so it survives backend restarts. |
| NFR-6 | **CJK correctness:** Chinese characters in PPT text boxes and Excel cells MUST render correctly without tofu-boxes. Verified via a sample of 5 real FY2526 PPTs. |
| NFR-7 | **Container isolation:** the converter runs as a non-root user inside its container; `data/attachments/` is mounted read-only into the converter. The converter writes PDFs to `/tmp` and returns them in the HTTP response body; only the backend writes to the persistent cache. |
| NFR-8 | **Observability:** every conversion MUST log `attachment_id`, source size, output size, wall-clock duration to backend structured logs so slow files are discoverable. |

---

## 4. Acceptance Criteria

| ID | Given / When / Then | Ref |
|----|---------------------|-----|
| AC-1 | **Given** a PPTX attachment with `local_path` present and no cache, **When** I GET `/api/admin/attachments/{id}/preview`, **Then** response status is 200 with `content-type: application/pdf`, a non-empty body, and `data/attachments/{id}.pdf` now exists. | FR-11, FR-12, NFR-2 |
| AC-2 | **Given** a PPTX attachment whose `data/attachments/{id}.pdf` cache exists, **When** I GET the preview endpoint, **Then** response is served from cache in <100ms and the converter is not invoked (verified via converter access log). | FR-11, NFR-3 |
| AC-3 | **Given** an XLSX attachment, **When** I GET the preview endpoint, **Then** response content-type is the XLSX mime type and the body byte-matches `data/attachments/{id}.xlsx`. | FR-9 |
| AC-4 | **Given** a `.ppt` (legacy) attachment, **When** I GET the preview endpoint, **Then** response is HTTP 415 `{"error":"unsupported_format"}`. | FR-13 |
| AC-5 | **Given** an attachment row where `local_path IS NULL`, **When** I GET the preview endpoint, **Then** response is HTTP 404 `{"error":"file_missing"}`. | FR-15 |
| AC-6 | **Given** a PPTX with Chinese characters in slide text, **When** the converter renders it to PDF, **Then** the PDF extracts Chinese text (via pdftotext) that matches a known-good sample. | NFR-6 |
| AC-7 | **Given** the converter container is stopped, **When** I GET the preview endpoint for an uncached PPTX, **Then** response is HTTP 502 `{"error":"converter_failed"}` and the frontend shows an error state with the Download link still working. | FR-16, FR-23 |
| AC-8 | **Given** two simultaneous requests for the same uncached PPTX, **When** both hit the backend, **Then** only one cache file is written, both clients get valid PDFs, and no corruption occurs. | NFR-5 |
| AC-9 | **Given** an admin is on the detail page of a Confluence page with 5 PPTX attachments, **When** the page loads, **Then** no conversions run until the user clicks "Preview" on a specific attachment. | FR-25 |

---

## 5. Edge Cases

| ID | Scenario | Expected Behavior |
|----|----------|-------------------|
| EC-1 | Corrupt PPTX (truncated zip) | Converter returns HTTP 500 with error detail; backend returns HTTP 502 `converter_failed`; frontend shows error state. |
| EC-2 | Password-protected / encrypted PPTX | LibreOffice prompts interactively → subprocess hangs → 120s timeout → HTTP 504 from converter → HTTP 502 from backend. Error state. |
| EC-3 | 79MB worst-case PPTX | Conversion may take 30–60s; frontend shows skeleton; timeout budget is 125s so it should succeed. |
| EC-4 | PPTX referencing fonts not installed in the container | LibreOffice substitutes a default font; PDF renders but may look slightly different from original. **Acceptable** — document this in the UI subtitle "rendered by LibreOffice, may differ from original". |
| EC-5 | XLSX with >100k rows | SheetJS can parse it, but browser-rendering a 100k-row table will lag. Cap SheetJS's rendered rows at 1000 per sheet with a "showing first 1000 of N rows" banner. |
| EC-6 | XLSX with formulas | SheetJS reads cached values from the file; formulas that were never computed will show empty. Document as known limitation. |
| EC-7 | Backend restarts mid-conversion | Partial `.pdf.tmp` file exists; next request sees no final `.pdf`, re-converts. Startup cleanup: on backend boot, delete any `*.pdf.tmp` files in `data/attachments/`. |
| EC-8 | Attachment has `file_kind = 'office'` but `media_type` is empty or unknown | Return HTTP 415 — we only trust the known PPTX/XLSX/DOCX mime types. |

---

## 6. API Contracts

Full contracts in `api.md`. Summary:

```
GET /api/admin/attachments/{attachment_id}/preview
  200 application/pdf            (PPTX / DOCX)
  200 application/vnd...sheet     (XLSX — raw passthrough)
  404 application/json            not_found / file_missing
  415 application/json            unsupported_format
  502 application/json            converter_failed
  504 application/json            converter_timeout
```

Non-ApiResponse envelope (see FR-18 rationale).

Internal converter endpoint (docker-network only):

```
POST http://converter:8080/convert
  Request:  multipart/form-data  field "file"
  Response: 200 application/pdf
            413 text/plain        file too large
            500 text/plain        conversion_failed
            504 text/plain        timeout
```

---

## 7. Data Models

No schema changes. This feature is purely read-path; it consumes existing `northstar.confluence_attachment` rows and writes PDFs only to the filesystem cache, not to PG / Neo4j.

### 7.1 Cache filesystem layout

```
data/attachments/
├── {id}.drawio        ← existing raw attachment (drawio)
├── {id}.png           ← existing raw attachment (image)
├── {id}.pptx          ← existing raw attachment (office, PPTX)
├── {id}.pdf           ← NEW: converted cache (for PPTX/DOCX only)
├── {id}.pdf.tmp       ← NEW: transient during conversion (atomic rename on success)
```

XLSX files do not have a `.pdf` companion — they are served raw.

---

## 8. Affected Files

### New files (Backend)
- `backend/app/routers/admin.py` — add `get_attachment_preview(attachment_id)` handler
- `backend/app/services/converter_client.py` — new: httpx-based client for `converter:8080`

### New files (Converter container)
- `scripts/converter/Dockerfile` — base `debian:bookworm-slim` + LibreOffice + CJK fonts
- `scripts/converter/server.py` — FastAPI mini-server exposing `POST /convert`
- `scripts/converter/requirements.txt` — fastapi, uvicorn, python-multipart

### New files (Frontend)
- `frontend/src/components/OfficePreview.tsx` — new component, two branches:
  - PPTX/DOCX → `<iframe>` with skeleton overlay
  - XLSX → SheetJS-driven HTML table with sheet tabs
- `frontend/src/app/admin/confluence/[page_id]/page.tsx` — mount `<OfficePreview>` inline when an attachment is expanded

### Modified files
- `docker-compose.yml` — add `converter` service with internal network; mount `./data/attachments` read-only
- `frontend/package.json` — add `xlsx` (SheetJS)
- `scripts/weekly_sync.sh` (optional pre-warm step — see FR/NFR — OUT OF SCOPE FOR PHASE 1)

---

## 9. Test Coverage

### API Tests

| Test File | Covers |
|-----------|--------|
| `api-tests/test_office_preview.py::test_preview_pptx_first_view` | AC-1 |
| `api-tests/test_office_preview.py::test_preview_pptx_cached` | AC-2 |
| `api-tests/test_office_preview.py::test_preview_xlsx_passthrough` | AC-3 |
| `api-tests/test_office_preview.py::test_preview_legacy_ppt_415` | AC-4 |
| `api-tests/test_office_preview.py::test_preview_missing_file_404` | AC-5 |
| `api-tests/test_office_preview.py::test_preview_converter_down_502` | AC-7 |
| `api-tests/test_office_preview.py::test_preview_concurrent_no_corruption` | AC-8 |

### Manual verification checklist

- [ ] Pick 3 real FY2526 PPTX files with Chinese content → verify text renders
- [ ] Pick 1 XLSX with multiple sheets → verify all tabs shown
- [ ] Pick the 79MB largest PPT → verify conversion completes
- [ ] Open a Confluence detail page with 5 attachments → verify lazy-load
- [ ] `docker compose stop converter` → click Preview on an uncached file → verify error state
- [ ] Chinese, English, mixed CJK text in PPT all render correctly

---

## 10. Cross-Feature Dependencies

### This feature depends on:

| Feature | Dependency Type | Details |
|---------|----------------|---------|
| confluence-child-pages | Data | Consumes `northstar.confluence_attachment.local_path` populated by `scripts/scan_confluence.py` + `scripts/download_missing_attachments.py`. |

### Features that depend on this:

| Feature | Dependency Type | Details |
|---------|----------------|---------|
| *(none yet)* | | Future `/apps/[app_id]` detail-view attachment section could reuse `<OfficePreview>`. |

---

## 11. State Machine / Workflow

Per-attachment preview state (backend):

```
                      ┌──────────┐
                      │ cold     │  data/attachments/{id}.pdf missing
                      └────┬─────┘
           first GET       │
                           ▼
                      ┌──────────┐
                      │converting│  data/attachments/{id}.pdf.tmp exists, converter running
                      └────┬─────┘
               atomic      │  (on success)
               rename      │
                           ▼
                      ┌──────────┐
                      │ cached   │  data/attachments/{id}.pdf exists, O_EXCL safe
                      └────┬─────┘
           subsequent GET  │
                           ▼
                    200 application/pdf
```

Failure transitions: `converting` → converter timeout / error → `.pdf.tmp` is deleted → state returns to `cold`. Next request re-attempts.

---

## 12. Out of Scope / Future Considerations

| Item | Reason |
|------|--------|
| Legacy `.ppt` / `.xls` / `.doc` (binary OLE formats) | <15 files total; adding support requires more LibreOffice packages and complicates testing. Falls back to Download link. |
| ConceptDraw (`document/conceptdrawdiagram`) | 2 files; no open-source renderer. |
| PPT / DOCX edit or annotation in-browser | Read-only for MVP. NorthStar is a reference tool, not a workflow tool. |
| Automatic cache eviction / TTL | Disk budget is 2GB; manual cleanup via `scripts/cleanup_preview_cache.py` is sufficient. No automatic policy. |
| Pre-warm cache in `weekly_sync.sh` | Can be added after MVP once we see real usage patterns. |
| Preview on `/apps/[app_id]` surface | Component is reusable, but wiring is out of scope. |
| Search inside PPT (full-text) | Would need to run pdftotext + index. Deferred; users can use Confluence's own search. |
| Streaming partial conversion | LibreOffice converts whole file at once; streaming would need a different library. |
| Thumbnail generation (grid-view previews) | Would need ImageMagick + page-1 extraction. Out of scope for MVP. |
