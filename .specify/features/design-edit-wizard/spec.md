# Design Edit Wizard — Re-enter the 4-tab picker on an existing design

| Field   | Value                |
|---------|----------------------|
| Author  | Ruodong Yang         |
| Date    | 2026-04-19           |
| Status  | Draft                |

---

## 1. Context

The Design wizard at `/design/new` (5 tabs: Context / Apps / Interfaces / Template / Review) is **create-only**. Once the user generates a design, the only way to modify it is (a) draw edits directly on the drawio canvas at `/design/[id]`, or (b) click `↻ Regenerate AS-IS` on that page — which re-runs the generator against the *already stored* `design_app` + `design_interface` rows. There is no way to change the underlying selections (which apps are Major, which interfaces are kept, which template is used).

Architects have asked for a second entry point on the `/design` list:

- **View/edit diagram** (existing) — click the row's ID or name → `/design/[id]` → drawio canvas.
- **Edit selections + regenerate** (new) — click a new icon action on the row → re-enter the 4-tab wizard pre-loaded with the design's current selections; after saving, persist the selections and return to the canvas page.

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Reuse `/design/new` in dual mode** via `?design_id=X` query param, rather than fork a new `/design/[id]/edit` route. | The wizard file is already 1991 lines. Splitting it into a shared component would double the blast radius of this change. Dual-mode is signalled in the UI by a banner "Editing Design #123" and a different Save button label. |
| **Save is decoupled from Regenerate.** | Auto-regenerating on save would overwrite any drawio canvas edits the architect already made. Instead, Save only replaces the `design_app` / `design_interface` / `template_attachment_id` rows, then routes the user back to `/design/[id]` where they can manually click `↻ Regenerate AS-IS`. |
| **Backend gets a new `PUT /api/design/{id}/selections` endpoint** rather than overloading the existing metadata-only `PUT /api/design/{id}`. | Separation of concerns: metadata (name / FY / project / status) remains on the top-level PUT; bulk selection replacement is a distinct operation that needs a transaction. |
| **Selections replacement is a full REPLACE, not a diff.** | The wizard always has the complete view of what apps + interfaces + template the user wants. Backend DELETE-then-INSERT is simpler, idempotent, and avoids diff-edge-case bugs. |
| **List page action icon is placed in the existing actions column**, not a new column. | Keeps visual parity with the existing ↓ (Download) and ✕ (Delete) icons. |

---

## 2. Functional Requirements

### 2.1 Design List entry points

| ID | Requirement |
|----|-------------|
| FR-1 | The Design list row's actions column MUST render three icon buttons in this order: `✎ Edit selections` (new), `↓ Download`, `✕ Delete`. |
| FR-2 | Clicking `✎` MUST navigate to `/design/new?design_id={design_id}` — same route as the create wizard, with a query param signalling edit mode. |
| FR-3 | The ID link and name link on each row continue to navigate to `/design/{design_id}` (the drawio canvas editor). This behavior is unchanged. |
| FR-4 | The `✎` icon MUST have tooltip `Edit selections (apps / interfaces / template)` so it's discoverable. |

### 2.2 Wizard — Edit mode activation

| ID | Requirement |
|----|-------------|
| FR-5 | When `/design/new` mounts with `?design_id=X` in the URL, it MUST call `GET /api/design/{X}` once and prefill: `name`, `description`, `fiscalYear`, `projectId`, `templateId` (from `template_attachment_id`), `scopeApps` (from `apps[]` — each row's `app_id`, `name`, `role`, `planned_status`, `bc_id`), `keepIfaceIds` (from `interfaces[]` — the set of `interface_id`s). |
| FR-6 | The wizard MUST display a dismissible banner above the tab bar: `Editing Design #{id} · "{name}"` in edit mode, nothing in create mode. |
| FR-7 | The Generate button label MUST switch to `Save changes` in edit mode. |
| FR-8 | In edit mode, after clicking `Save changes`, the wizard MUST call `PUT /api/design/{id}/selections` with the current `apps[]` + `interfaces[]` + `template_attachment_id`, then `router.push(`/design/${id}`)` on success. It MUST NOT auto-regenerate the drawio canvas. |
| FR-9 | The wizard MUST NOT update design metadata (name / description / fiscal_year / project_id) via this new endpoint — those are already editable on `/design/{id}` via the existing `PUT /api/design/{id}`. In edit mode, the Context tab's fields are rendered read-only (with a note pointing to the canvas page for metadata edits). |
| FR-10 | If `GET /api/design/{X}` returns 404, the wizard MUST show an error banner and disable the Save button — do NOT silently fall through to create mode. |

### 2.3 Backend — selections endpoint

| ID | Requirement |
|----|-------------|
| FR-11 | `PUT /api/design/{design_id}/selections` MUST accept a JSON body: `{ template_attachment_id: int \| null, apps: [{app_id, role, planned_status, bc_id?}], interfaces: [{interface_id, from_app, to_app, platform, interface_name, planned_status}] }`. The shape mirrors the existing `POST /api/design` body for apps + interfaces. |
| FR-12 | The endpoint MUST execute in a single transaction: (a) `UPDATE northstar.design_session SET template_attachment_id = $1 WHERE design_id = $2`; (b) `DELETE FROM northstar.design_app WHERE design_id = $2`; (c) bulk-INSERT new `design_app` rows; (d) `DELETE FROM northstar.design_interface WHERE design_id = $2`; (e) bulk-INSERT new `design_interface` rows. If any step fails, the transaction rolls back and the 500 response MUST include the DB error. |
| FR-13 | The endpoint MUST NOT modify `drawio_xml` or `as_is_snapshot_xml`. Regeneration is explicitly triggered by the separate `POST /{id}/regenerate` endpoint. |
| FR-14 | The endpoint MUST return `ApiResponse({saved: true, apps_count: N, ifaces_count: M})` on success, 404 if design doesn't exist, 422 for malformed body. |
| FR-15 | Duplicate `app_id` values in the `apps[]` payload MUST cause a 400 response — the wizard frontend already de-duplicates, so a duplicate at the API surface indicates a bug. |

---

## 3. Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NFR-1 | All API responses MUST use the `ApiResponse<T>` envelope. |
| NFR-2 | The selections PUT MUST complete in < 300ms for a design with 10 apps + 30 interfaces (99th percentile). |
| NFR-3 | Frontend MUST show a saving indicator while the PUT is in flight; button is disabled during save to prevent double-submit. |
| NFR-4 | No new dependencies. |
| NFR-5 | Closed-loop gate: this is an L2 change. `.specify/features/design-edit-wizard/spec.md` (this file) satisfies the doc phase. |

---

## 4. Acceptance Criteria

| ID | Given / When / Then | Ref |
|----|---------------------|-----|
| AC-1 | **Given** a design list with ≥ 1 existing design, **When** the user clicks the row's `✎` icon, **Then** the browser navigates to `/design/new?design_id={id}` and the wizard loads with the correct selections prefilled. | FR-1, FR-5 |
| AC-2 | **Given** a design in edit mode, **When** the user removes a Major App from the top summary chip, changes the template, and clicks `Save changes`, **Then** `PUT /{id}/selections` is called once with the new state and the browser navigates to `/design/{id}`. | FR-8, FR-11 |
| AC-3 | **Given** a design in edit mode, **When** the user clicks `Save changes`, **Then** the design's `drawio_xml` field is NOT modified. The architect can visually confirm by inspecting the canvas page — it still shows the pre-edit drawing. | FR-8, FR-13 |
| AC-4 | **Given** an invalid `design_id` (e.g., `?design_id=99999` for a deleted design), **When** the wizard mounts, **Then** an error banner displays and the Save button is disabled. | FR-10 |
| AC-5 | **Given** a PUT payload with duplicate app_ids, **When** the backend processes it, **Then** it returns 400 with a clear error and the transaction is rolled back (no partial writes). | FR-15 |
| AC-6 | **Given** two concurrent `PUT /{id}/selections` requests for the same design, **When** both run, **Then** one succeeds and the other either succeeds with the newer payload or fails cleanly. No interleaved partial state. (Implicit row-level locking via `FOR UPDATE` or last-write-wins via serial transactions — implementation choice.) | FR-12 |

---

## 5. Edge Cases

| ID | Scenario | Expected Behavior |
|----|----------|-------------------|
| EC-1 | User opens edit mode, deletes all Major Apps, tries to Save. | Save button disabled (same validation as create mode: `scopeApps.length > 0`). |
| EC-2 | User opens edit mode, makes no changes, clicks Save. | PUT fires with the same data; backend writes an idempotent no-op replacement. Not considered wasteful — keeps the code path simple. |
| EC-3 | User opens edit mode, then navigates away without saving. | No-op. The URL query `?design_id=X` is not sticky — reopening `/design/new` without param is still create mode. |
| EC-4 | User opens `/design/new?design_id=X` but the design was just deleted by someone else. | GET returns 404 → error banner (FR-10), no crash. |
| EC-5 | Template attachment the design used has been deleted from Confluence. | Wizard shows `templateId = <deleted id>` in the Template tab with a warning chip `template no longer available — pick another or use Blank canvas`. Save path still succeeds if user picks a new template. |
| EC-6 | Existing design has apps with `role="external"` (not "primary" or "related"). | Prefill maps them into `scopeApps` with their original role. The wizard UI renders `external` apps as Surround (same as `related`) for now — a future feature may surface them separately. |
| EC-7 | Existing design has interfaces referencing an app that was removed from `ref_application` (CMDB). | Prefill still loads them; the Interfaces tab may not have a matching `scopedRow` for them (the integrations endpoint won't return them). Behavior: those interface_ids remain in `keepIfaceIds` but won't appear as chips in the top bar. The cascade-cleanup effect will drop them on next re-render. Acceptable — these were already orphans. |

---

## 6. Affected Files

| File | Kind | Change |
|------|------|--------|
| `backend/app/routers/design.py` | EDIT | Add `PUT /{design_id}/selections` handler. |
| `backend/app/models/schemas.py` | EDIT | Add `DesignSelectionsUpdate` pydantic model (reuses `DesignAppPayload` + `DesignInterfacePayload` already used by POST). |
| `frontend/src/app/design/page.tsx` | EDIT | Add `✎` IconButton to the actions column per row; wire to `/design/new?design_id=${r.design_id}`. |
| `frontend/src/app/design/new/page.tsx` | EDIT | (a) Read `design_id` from `useSearchParams`; (b) prefill on mount in edit mode; (c) render edit banner; (d) change Save button label + submit handler; (e) disable Context tab inputs. |
| `api-tests/test_design_selections_put.py` | NEW | Cover FR-11..15 + AC-2, AC-3, AC-5. |
| `scripts/test-map.json` | EDIT | Map `routers/design.py` → add the new test file alongside existing `test_design.py`. |
| `.specify/features/design-edit-wizard/spec.md` | NEW | This file. |

---

## 7. Test Coverage

`api-tests/test_design_selections_put.py` (new):

- `test_put_selections_replaces_apps` — creates design with 2 apps, PUTs 3 different apps, asserts `design_app` table has exactly the 3 new rows.
- `test_put_selections_replaces_interfaces` — similar for `design_interface`.
- `test_put_selections_updates_template` — verifies `template_attachment_id` changes.
- `test_put_selections_does_not_modify_drawio` — before-PUT `drawio_xml` SHA equals after-PUT SHA.
- `test_put_selections_404_for_missing_design` — returns 404.
- `test_put_selections_400_on_duplicate_app_ids` — returns 400 and DB unchanged.
- `test_put_selections_rollback_on_error` — inject a failing step (e.g., invalid `interface_id` FK), assert no apps were replaced.

Frontend — manual verification (no e2e suite yet for this route):

- Click `✎` on a design with 3 Major Apps + 5 interfaces → wizard shows same 3 chips + 5 interface chips in the top bar.
- Remove 1 Major App via chip × → Save → confirm DB has 2 apps and cascade cleanup dropped orphan ifaces/relateds.
- Re-open canvas at `/design/{id}` → drawio still shows pre-edit drawing (not auto-regenerated).
- Click `↻ Regenerate AS-IS` on canvas page → drawio redraws from the *new* selections.

---

## 8. Out of Scope

- Multi-user collaborative editing / optimistic concurrency UI (last-write-wins is fine for V1).
- Versioning / audit log of selection changes (the `as_is_snapshot_xml` field already captures a point-in-time snapshot at create; a future feature may snapshot on every edit).
- Undo / rollback UI.
- Prompting the user to regenerate on save (design choice: we chose manual regen to preserve drawio hand-edits).
- Editing design metadata (name / description / FY / project_id) via the wizard — that stays on the canvas page's metadata panel, where it already works.
