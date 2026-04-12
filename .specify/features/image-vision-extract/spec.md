# Image Vision Extract (Phase 0 + Phase 1 PoC)

| Field   | Value                |
|---------|----------------------|
| Author  | Ruodong Yang         |
| Date    | 2026-04-11           |
| Status  | Draft                |

---

## 1. Context

NorthStar currently has **3,797 PNG images + 34 JPEG + 190 SVG** (3,902 total in FY2425+FY2526) attached to confluence pages. `drawio_parser.py` extracts applications, interactions, standard IDs, status colors, business-object labels, and tech-component metadata from native drawio XML. Image attachments get **zero structured extraction** — they show up as a raw picture in the preview pane and that's it. This leaves ~1,200 architecture-titled pages with *no machine-readable architecture* if they only have a PNG export instead of the underlying drawio.

EAM's `/backend/app/ea_agents/` has production-tested **vision LLM extraction** that reads a PNG/JPEG architecture diagram and produces `{applications, interactions}` JSON, keyed off the same A+6-digit CMDB pattern and the same Keep/Change/New/Sunset color convention NorthStar uses. EAM runs it via LangChain-OpenAI against a Lenovo aiverse endpoint (`gpt-4.1-dev` today). That infrastructure is a natural fit for NorthStar's PNG gap.

**This spec covers Phase 0 (dedup) and Phase 1 (single-image PoC) only.** Phase 2 (batch runner + persistence + Neo4j projection) is deliberately deferred until Phase 1 tells us the extraction quality is good enough on real NorthStar PNGs.

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Vision LLM, not OCR + heuristics** | EAM proved this works. OCR alone can read text but can't identify "this box is an app vs a container vs a legend" — that's exactly the judgment LLMs are good at. |
| **Reuse existing `LLM_*` settings (not new `EA_AGENT_*`)** | `settings.llm_base_url / llm_api_key / llm_model / llm_enabled` already exist in `backend/app/config.py` and an `ai_evaluator.py` already uses them. No new env surface. |
| **Adapt EAM prompt, don't copy verbatim** | EAM prompt covers App-Arch diagrams but not NorthStar's Tech-Arch layer (k8s pods, persistence layer, VPC peering), and doesn't hardcode NorthStar's template legend strings ("Event Producer", "Command Executor", "3rd-parties App Name") that would otherwise be misidentified as real apps. |
| **Phase 0 dedup uses signal 1 only (same-page + filename stem match)** | Covers the bulk of PNG-is-drawio-export cases with near-zero false positives. Perceptual hash (signal 3) is deferred to Phase 2 if needed. |
| **Phase 1 endpoint is read-only** | `GET /.../vision-extract` returns JSON, persists nothing. Architects click a button, see the result in-place, and that tells them (and us) whether Phase 2 is worth it. Zero risk of polluting the drawio-extract tables. |
| **Merge into existing Extracted tab, not a new tab** | Architects already think of "what apps/integrations come out of this page" as one question. A separate tab splits attention. The tab shows drawio results (existing) + vision results (new) side by side, with an explicit source badge. |
| **No Neo4j writes in Phase 0+1** | Ontology invariants untouched. Any future Phase 2 Neo4j projection will route through PG → loader → Neo4j like drawio does, with a `source:image` edge property so architects can filter. |
| **Backend calls LLM directly via httpx, no LangChain dep** | EAM uses LangChain because it orchestrates a multi-stage DAG. Phase 1 is a single call; pulling in langchain (+ langgraph + langchain-openai) adds ~50MB and two transitive dep trees for one LLM POST. A plain httpx.AsyncClient matches the rest of `backend/app/services/*_client.py`. |

---

## 2. Functional Requirements

### 2.1 Phase 0 — Dedup & Candidate Queue

| ID | Requirement |
|----|-------------|
| FR-1 | Migration `013_image_vision_candidate.sql` MUST add to `northstar.confluence_attachment`: `derived_source VARCHAR` (nullable), `derived_source_att VARCHAR` (nullable), `vision_candidate BOOLEAN DEFAULT FALSE`. All additive, all `IF NOT EXISTS`, safe to re-run. |
| FR-2 | Script `scripts/mark_vision_candidates.py` MUST run on the host (.venv-ingest) and set `derived_source='drawio'` + `derived_source_att=<drawio_id>` for every image attachment whose **filename stem** (case-insensitive, ignoring `.png/.jpg/.jpeg/.svg/.drawio/.drawio.xml`) equals a drawio attachment on the **same page_id**. |
| FR-3 | After the derived-source pass, the script MUST set `vision_candidate=true` for every `image/png` or `image/jpeg` row where `derived_source IS NULL` AND `local_path IS NOT NULL` AND the parent page's `fiscal_year IN ('FY2425','FY2526')`. |
| FR-4 | The script MUST print a summary at the end: `total PNGs / marked as drawio-derived / marked as candidates / candidates on architecture-titled pages`. |
| FR-5 | The script MUST be idempotent — running it twice produces identical PG state and the second run's summary shows zero newly-marked rows. |
| FR-6 | `GET /api/admin/confluence/vision-queue` MUST return a paginated list of candidates: `{attachment_id, title, page_id, page_title, fiscal_year, file_size}`, ordered by `file_size DESC` within `fiscal_year DESC`. Used by the admin UI to surface the queue. |
| FR-7 | The admin list page (`/admin/confluence`) MUST show a KPI card "Vision queue: N pending" linking to `/admin/confluence?vision_queue=1`. Click-through renders the queue filtered to `vision_candidate=true` only. |

### 2.2 Phase 1 — Single-Image Vision Extract (PoC)

| ID | Requirement |
|----|-------------|
| FR-8 | `GET /api/admin/confluence/attachments/{attachment_id}/vision-extract` MUST stream an image attachment through the Lenovo aiverse LLM and return the extracted `{applications, interactions, tech_components, diagram_type}` JSON. Read-only: no writes to any PG or Neo4j table. |
| FR-9 | The endpoint MUST accept `image/png`, `image/jpeg`. It MUST return HTTP 415 `unsupported_format` for any other `media_type` (including SVG — SVG needs a different path and is out of scope for Phase 1). |
| FR-10 | The endpoint MUST return HTTP 404 `file_missing` if the attachment row has `local_path IS NULL` or the underlying file does not exist on disk. |
| FR-11 | The endpoint MUST return HTTP 503 `llm_disabled` if `settings.llm_enabled` is false or `settings.llm_base_url` is empty. The UI MUST surface this gracefully (not a crash). |
| FR-12 | Before sending to the LLM, the backend MUST preprocess the image: convert to RGB, resize so max dimension ≤ 2048 px (PIL `Image.thumbnail`), re-encode as JPEG quality 90, base64-encode. Raw images > 10 MB MUST be rejected with HTTP 413 before upload. |
| FR-13 | The LLM call MUST be a single multimodal POST to `{LLM_BASE_URL}/chat/completions` using the OpenAI-compatible schema: `messages=[{role:"system", content:PROMPT}, {role:"user", content:[{type:"text", text:""}, {type:"image_url", image_url:{url:"data:image/jpeg;base64,..."}}]}]`, `temperature=0`, `response_format={type:"json_object"}` (when the model supports it). |
| FR-14 | The backend MUST enforce a per-request timeout of 120 s. On timeout, return HTTP 504 `llm_timeout` with the elapsed time in `detail`. |
| FR-15 | The backend MUST parse the LLM response as JSON. If parsing fails, the endpoint MUST return HTTP 502 `malformed_llm_output` with the raw response text truncated to 1 KB in `detail`. |
| FR-16 | The returned JSON schema MUST be: `{diagram_type, applications[], interactions[], tech_components[], meta:{model, prompt_tokens, completion_tokens, total_tokens, wall_ms}}`. |
| FR-17 | Each `applications[]` entry MUST carry: `app_id`, `id_is_standard` (bool), `standard_id`, `name`, `functions[]`, `application_status`, `source:"vision"`. The `app_id`/`standard_id` pattern matches the drawio_parser output shape so the UI can render both side-by-side. |
| FR-18 | Each `interactions[]` entry MUST carry: `source_app_id`, `target_app_id`, `interaction_type`, `direction`, `business_object`, `interface_status`, `status_inferred_from_endpoints` (bool — EAM's fallback rule, must be visible to the architect so they know it's a guess not a direct read). |
| FR-19 | `tech_components[]` entries are populated only when the LLM sets `diagram_type="tech_arch"`. Shape: `{component_type, name, deploy_mode, runtime, layer}`. For Phase 1 this is descriptive — we don't have a tech-arch rendering in the UI yet. |

### 2.3 Phase 1 — Extracted Tab UI Integration

| ID | Requirement |
|----|-------------|
| FR-20 | The existing Extracted tab (`frontend/src/app/admin/confluence/[page_id]/page.tsx` `ExtractedView`) MUST render a new sub-section "From images (vision)" below the existing "From drawio diagrams" section. |
| FR-21 | For every image attachment on the page whose `derived_source` is NOT 'drawio' (i.e. it's a true vision candidate), the UI MUST render a card with: thumbnail, title, a "Run Vision" button, and an empty results area. |
| FR-22 | Clicking "Run Vision" MUST fire the vision-extract endpoint. While in flight, the button MUST show a spinner + "Extracting… (up to 60s)". On success, the card MUST render `applications` + `interactions` in the same visual shape as the drawio results (same row styles, same status chip colors). |
| FR-23 | The vision-extract card MUST show a source badge `VISION · {model}` in the same slot where drawio cards show their filename, so architects can tell at a glance "this came from an LLM, not deterministic parser". |
| FR-24 | Every app/interaction row from vision MUST be rendered with a `⚠️ AI-extracted, review needed` tooltip when the architect hovers. Phase 1 is PoC — architects must never confuse vision output with verified data. |
| FR-25 | The card MUST show the token usage + wall time in a small footer: `gpt-4.1-dev · 11,430 tok · 8.2s`. |
| FR-26 | On error (415, 404, 503, 502, 504), the card MUST show a friendly error state with the error code + a "Retry" button. The existing Download button on the attachment row MUST still work. |

---

## 3. Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NFR-1 | Phase 1 MUST NOT write to any PG table. Zero persistence. Architects run the endpoint N times and leave zero state. |
| NFR-2 | Phase 1 MUST NOT write to Neo4j. Ontology invariants unchanged. |
| NFR-3 | The vision-extract endpoint MUST NOT be wrapped in `ApiResponse<T>` — the response is a single JSON document the UI consumes directly. Matches the office-preview FR-18 exemption. |
| NFR-4 | The backend MUST NOT log the full LLM response body at INFO level (leak risk for sensitive architecture names). Only log `attachment_id`, `bytes`, `tokens`, `wall_ms`, and the LLM HTTP status. |
| NFR-5 | The vision-extract endpoint MUST NOT call the converter or any other external service — only the LLM. One moving dependency per endpoint. |
| NFR-6 | Per-request LLM cost MUST be bounded: max image dim 2048 px, max raw file 10 MB, prompt ≤ 8 KB. These cap the worst-case token use around ~15K prompt tokens per request. |
| NFR-7 | The prompt MUST be stored as a plain text file at `backend/app/services/image_vision_prompt.md` and loaded once at import time, not hardcoded in Python. This makes it reviewable + editable without a code change. |
| NFR-8 | Phase 0's SQL migration MUST be additive (no DROP, no RENAME), use `IF NOT EXISTS`, and set `search_path TO northstar, public;` at the top. |

---

## 4. Acceptance Criteria

| ID | Given / When / Then | Ref |
|----|---------------------|-----|
| AC-1 | **Given** migration 013 is applied, **When** I run `scripts/mark_vision_candidates.py`, **Then** `confluence_attachment.derived_source='drawio'` is set on every PNG whose stem matches a drawio on the same page, and the summary reports a non-zero count. | FR-1, FR-2 |
| AC-2 | **Given** mark_vision_candidates.py was run once, **When** I run it again, **Then** the summary shows "0 newly marked". | FR-5 |
| AC-3 | **Given** a PNG attachment with `local_path` present, **When** I GET its `/vision-extract` endpoint, **Then** response is 200 with a JSON body containing `applications`, `interactions`, `diagram_type`, and `meta.total_tokens > 0`. | FR-8, FR-16 |
| AC-4 | **Given** an attachment with `media_type='image/svg+xml'`, **When** I GET `/vision-extract`, **Then** response is 415 `unsupported_format`. | FR-9 |
| AC-5 | **Given** a row with `local_path IS NULL`, **When** I GET `/vision-extract`, **Then** response is 404 `file_missing`. | FR-10 |
| AC-6 | **Given** `LLM_ENABLED=false`, **When** I GET `/vision-extract`, **Then** response is 503 `llm_disabled`. | FR-11 |
| AC-7 | **Given** a real FY2526 PPT-exported PNG with Chinese text, **When** I run vision extract, **Then** the returned `applications[]` contains at least one entry with Chinese characters preserved in `name`. | FR-12, FR-13 |
| AC-8 | **Given** a real NorthStar "Application Architecture" PNG, **When** I run vision extract, **Then** at least one returned app has `id_is_standard=true` and `standard_id` matching `^A\d{6}$`. | FR-17 |
| AC-9 | **Given** an admin is on the detail page with a candidate image, **When** they click "Run Vision", **Then** within 60 s the card shows applications + interactions + token/cost footer, and the source badge reads `VISION · gpt-4.1-dev`. | FR-20, FR-22, FR-23, FR-25 |

---

## 5. Edge Cases

| ID | Scenario | Expected Behavior |
|----|----------|-------------------|
| EC-1 | Image > 10 MB | 413 `file_too_large`, UI shows "image too large to extract" |
| EC-2 | Image has transparent background | Preprocess composites onto white before JPEG encode; LLM sees a clean background |
| EC-3 | LLM returns JSON with missing top-level `applications` key | 502 `malformed_llm_output`, response.detail has truncated raw text |
| EC-4 | LLM returns JSON with wrapped markdown code block | Preprocessing strips ``` fences and retries parse once |
| EC-5 | Corrupt PNG (truncated) | PIL raises `UnidentifiedImageError`, return 500 `image_decode_failed` |
| EC-6 | LLM transient 500 from aiverse | Single retry with 2s backoff. Second failure returns 502 `llm_upstream_error` |
| EC-7 | `derived_source='drawio'` image clicked anyway | UI shows the Vision button as disabled with tooltip "This PNG is a drawio export — check the drawio extract above" |
| EC-8 | Same attachment clicked twice in quick succession | No de-dup on the backend — each click is a fresh LLM call. Frontend button locks while in flight. |
| EC-9 | Image with only a title and no actual diagram | LLM returns `applications:[]`, `interactions:[]`. UI shows "No apps/integrations detected" |
| EC-10 | NorthStar template PNG with legend placeholders ("Event Producer" etc.) | Prompt explicitly lists these as exclusions → LLM should not return them as apps. If it does, tooltip warns architect to reject. |

---

## 6. API Contracts

```
GET /api/admin/confluence/attachments/{attachment_id}/vision-extract
  200 application/json
      {
        "diagram_type": "app_arch" | "tech_arch" | "unknown",
        "applications": [
          {
            "app_id": "A000001",
            "id_is_standard": true,
            "standard_id": "A000001",
            "name": "ECC",
            "functions": ["Invoice posting"],
            "application_status": "Keep",
            "source": "vision"
          }
        ],
        "interactions": [
          {
            "source_app_id": "A000001",
            "target_app_id": "A000125",
            "interaction_type": "Query",
            "direction": "one_way",
            "business_object": "Order",
            "interface_status": "Keep",
            "status_inferred_from_endpoints": false
          }
        ],
        "tech_components": [],
        "meta": {
          "model": "gpt-4.1-dev",
          "prompt_tokens": 11234,
          "completion_tokens": 2198,
          "total_tokens": 13432,
          "wall_ms": 8240
        }
      }

  404 {"error": "not_found", ...}
  404 {"error": "file_missing", ...}
  413 {"error": "file_too_large", ...}
  415 {"error": "unsupported_format", ...}
  500 {"error": "image_decode_failed", ...}
  502 {"error": "llm_upstream_error" | "malformed_llm_output", ...}
  503 {"error": "llm_disabled", ...}
  504 {"error": "llm_timeout", ...}

GET /api/admin/confluence/vision-queue?limit=N&offset=M
  200 ApiResponse { rows: [{attachment_id, title, page_id, page_title, fiscal_year, file_size}], total: N }
```

---

## 7. Data Models

### 7.1 PG additive columns (migration 013)

```sql
ALTER TABLE northstar.confluence_attachment
  ADD COLUMN IF NOT EXISTS derived_source      VARCHAR,
  ADD COLUMN IF NOT EXISTS derived_source_att  VARCHAR,
  ADD COLUMN IF NOT EXISTS vision_candidate    BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS ix_confluence_attachment_vision_candidate
  ON northstar.confluence_attachment (vision_candidate)
  WHERE vision_candidate = TRUE;
```

No new tables. No Neo4j changes.

### 7.2 Python schemas

Pydantic models live in `backend/app/services/image_vision.py`, not `models/schemas.py`, because they only leave the service layer as a dict inside the endpoint response — no cross-module typing pressure.

---

## 8. Affected Files

### Backend
- `backend/sql/013_image_vision_candidate.sql` — new migration
- `backend/app/services/image_vision.py` — new service: preprocess + LLM call + JSON parse
- `backend/app/services/image_vision_prompt.md` — new prompt file (NorthStar-adapted from EAM)
- `backend/app/routers/admin.py` — new endpoints `/vision-extract` and `/vision-queue`

### Frontend
- `frontend/src/app/admin/confluence/[page_id]/page.tsx` — extend `ExtractedView` with vision sub-section

### Scripts
- `scripts/mark_vision_candidates.py` — new host-side script

### Tests
- `api-tests/test_image_vision.py` — covers AC-1..AC-9

### Test map
- `scripts/test-map.json` — register new source → test mapping

---

## 9. Test Coverage

| Test File | Covers |
|-----------|--------|
| `api-tests/test_image_vision.py::test_mark_candidates_sets_derived_source` | AC-1 |
| `api-tests/test_image_vision.py::test_mark_candidates_idempotent` | AC-2 |
| `api-tests/test_image_vision.py::test_vision_extract_returns_structured_json` | AC-3 |
| `api-tests/test_image_vision.py::test_vision_extract_svg_returns_415` | AC-4 |
| `api-tests/test_image_vision.py::test_vision_extract_missing_file_404` | AC-5 |
| `api-tests/test_image_vision.py::test_vision_extract_llm_disabled_503` | AC-6 |
| `api-tests/test_image_vision.py::test_vision_extract_preserves_chinese` | AC-7 |
| `api-tests/test_image_vision.py::test_vision_extract_detects_standard_id` | AC-8 |
| (manual) UI click-through verification | AC-9 |

---

## 10. Cross-Feature Dependencies

### This feature depends on:

| Feature | Dependency Type | Details |
|---------|----------------|---------|
| confluence-child-pages | Data | Consumes `confluence_attachment.local_path` rows written by `scripts/scan_confluence.py`. |
| office-preview | Pattern | Copies the "read-only backend endpoint + raw JSON response + error-code UI card" pattern. |

### Features that depend on this:

| Feature | Dependency Type | Details |
|---------|----------------|---------|
| *(Phase 2, future)* | Data | Phase 2 will add `confluence_image_extract_app`/`_interaction` tables populated from a batch runner, then project to Neo4j with `source:image` discriminator. Phase 1 deliberately does not pre-build Phase 2 infrastructure. |

---

## 11. State Machine

Phase 0+1 is stateless from PG's perspective. The only state is the `vision_candidate` flag, which is a one-way transition set by the host script.

```
attachment ingested → derived_source=NULL, vision_candidate=FALSE
  ↓ (mark_vision_candidates.py)
stem-matches-drawio? → derived_source='drawio', vision_candidate=FALSE (dead end for vision)
     ↓ no
real PNG?              → vision_candidate=TRUE (shows in queue, ready for Run Vision click)
```

No persistence of vision output in Phase 0+1. Clicking "Run Vision" does not change any flag.

---

## 12. Out of Scope / Future Considerations

| Item | Reason |
|------|--------|
| Phase 2: batch runner (`scripts/run_vision_extract.py`) | Depends on Phase 1 quality signal. Build only if architects say extraction is worth persisting. |
| Phase 2: `confluence_image_extract_app`/`_interaction` tables | Same reason. Schema will mirror `confluence_diagram_app`/`_interaction` + add `source='vision'`, `confidence`, `review_status`, `reviewed_by`. |
| Phase 2: Neo4j projection with `source:image` | Same reason. Loader change only, no ontology change. |
| Phase 2: human-review UI | Confirm/edit/reject workflow on the extracted rows. |
| SVG support | SVG has an embedded text layer — would use a different extractor (direct XML parse + LLM fallback), not the image-vision path. Deferred. |
| Perceptual hash dedup (signal 3) | Signal 1 (filename stem) is expected to cover >60% of duplicates. Only add phash if Phase 0 leaves >2000 candidates and architects say that's too many. |
| Confidence scores per extracted entity | Phase 1 model doesn't reliably self-calibrate; adding a confidence field without a sound source is misleading. Deferred to Phase 2 where we can derive it from review-outcome history. |
| Caching of vision results keyed by attachment_id | Deferred to Phase 2 — in Phase 1 we *want* cheap re-runs while tuning the prompt. |
| Auto-run on new PNGs during `weekly_sync.sh` | Deferred until Phase 2 persistence exists. |
| OCR fallback for unreadable text | Architects can re-upload a clearer PNG or recreate the drawio. Not worth a second pipeline for edge cases. |
| Tech-arch rendering in UI | `tech_components[]` is returned in the JSON but Phase 1 UI does not render it — Extracted tab's current structure only has app+interaction lists. Add in a later feature when the tech-arch Neo4j schema is defined. |
