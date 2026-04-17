# S3-Backed Attachment Storage

| Field   | Value                |
|---------|----------------------|
| Author  | Ruodong Yang         |
| Date    | 2026-04-16           |
| Status  | Draft                |

---

## 1. Context

NorthStar caches ~15,000 Confluence attachments (9.7 GB of `.drawio`, `.png`,
`.pptx`, `.pdf` etc.) on local disk at `data/attachments/` so the backend can
serve them via `/api/admin/confluence/attachments/{id}/raw` without hammering
Confluence for every view. On a laptop dev environment this works but:

- Fresh clones require a one-time `scripts/scan_confluence.py` rescan to
  re-download all attachments (hours + VPN).
- Multiple contributors duplicate the 9.7 GB on their laptops.
- No durable off-laptop backup — a wipe loses all diagrams.

EGM already uses the shared Lenovo S3 gateway (`oss2.xcloud.lenovo.com`) for
its attachments, with a `pm/egm/app/` prefix under the `lenovo-it` bucket.
NorthStar should do the same under `pm/northstar/attachments/`.

The 10,921 files have already been uploaded (manually, via
`/tmp/ns-s3-dryrun/migrate.py`). This feature makes that migration a
**first-class** in-repo capability and teaches the backend to read from S3
with filesystem fallback.

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Backend reads S3 when `s3_enabled=true` AND `s3_key IS NOT NULL`**, else falls back to local FS | Zero-risk rollout — a DB without `s3_key` columns populated, or with `S3_ENABLED=false`, behaves identically to today. |
| **New column `s3_key` on `confluence_attachment` (nullable)** | Allows per-file opt-in. The migration script sets it only for files confirmed present in S3. |
| **No `media_type` migration needed — kept in DB** | `confluence_attachment.media_type` already tracks mimetype; S3 doesn't need to re-learn it. |
| **Streaming response via `StreamingResponse(body.iter_chunks())`** rather than `Response(content=bytes)` | A 100 MB PPTX shouldn't sit in backend RAM. `boto3` get_object's Body is a stream; FastAPI can consume chunks directly. |
| **Same S3 credential as EGM, but independent prefix** (`pm/northstar/attachments/`) | Sharing IAM keys is OK for an internal tool. Prefix isolation prevents cross-app collisions. |
| **Migration script lives in `scripts/` and is idempotent** (HeadObject skip-if-size-match) | Safe to re-run for newly-scanned attachments; doubles as ongoing sync. |
| **`requirements.txt` adds `boto3`** | New runtime dep. Backend Docker image rebuilds on change. |
| **No Neo4j changes** | Attachments belong to Postgres layer only; the graph doesn't store blob locations. |

---

## 2. Functional Requirements

### 2.1 Config

| ID | Requirement |
|----|-------------|
| FR-1 | New settings: `s3_enabled` (bool, default false), `s3_endpoint`, `s3_region`, `s3_access_key`, `s3_secret_key`, `s3_bucket`, `s3_prefix`. Read from env via Pydantic. |
| FR-2 | `s3_enabled=false` disables all S3 code paths — backend behaves identically to current filesystem-only mode. |

### 2.2 Storage service

| ID | Requirement |
|----|-------------|
| FR-3 | New `app/services/s3_storage.py` with `upload_bytes(key, data, content_type)`, `download_stream(key) -> iterable`, `head(key) -> dict | None`, `make_key(filename) -> str`. |
| FR-4 | Boto3 client created once (module-level singleton), configured with `signature_version='s3'`, `addressing_style='path'`, `request_checksum_calculation='when_required'` — matches EGM's working config and avoids the `Transfer-Encoding: chunked` rejection from this OSS gateway. |
| FR-5 | All S3 errors log `logger.warning/error` but do not crash the request — callers MUST handle `None` / exception and fall back to filesystem. |

### 2.3 Schema

| ID | Requirement |
|----|-------------|
| FR-6 | New migration `backend/sql/017_attachment_s3_key.sql` adds `s3_key VARCHAR` column to `confluence_attachment` (nullable, default NULL). Plus `idx_conf_attach_s3_key` partial index for `WHERE s3_key IS NOT NULL` lookups. |
| FR-7 | Migration is idempotent (`ADD COLUMN IF NOT EXISTS`). Applies clean on both fresh and existing DBs. |

### 2.4 Attachment serving

| ID | Requirement |
|----|-------------|
| FR-8 | `GET /api/admin/confluence/attachments/{attachment_id}/raw` selects `s3_key` in addition to `local_path`. If `settings.s3_enabled` AND `s3_key` is not NULL, stream the object from S3 with the existing mimetype/inline logic preserved. |
| FR-9 | If S3 read fails (endpoint down, object missing) AND `local_path` points to an existing file, fall back to filesystem. Log the fallback at `warning` level with attachment_id. |
| FR-10 | If both S3 and local fail, return 404 (same behavior as today). |

### 2.5 Migration script

| ID | Requirement |
|----|-------------|
| FR-11 | `scripts/migrate_attachments_to_s3.py` — idempotent uploader: scans `ATTACHMENT_ROOT`, HeadObject-checks each file, uploads missing, updates `confluence_attachment.s3_key` in PG after successful upload. |
| FR-12 | Supports resume on VPN flap (retry with exponential backoff up to 15 min endpoint-dead timeout). |
| FR-13 | Parallel uploads (default 20 workers, configurable via `--workers` CLI flag). |
| FR-14 | Dry-run mode (`--dry-run`) prints what would be uploaded without hitting S3. |

### 2.6 Verification script

| ID | Requirement |
|----|-------------|
| FR-15 | `scripts/verify_s3_attachments.py` — samples N files (default 50) from `confluence_attachment` where `s3_key IS NOT NULL`, downloads from S3, compares SHA256 against local copy. Exits 0 on all-match, 1 on any mismatch. |

---

## 3. Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NFR-1 | All S3 API calls MUST use `ContentLength` header (not chunked transfer) — required by the OSS2 gateway. |
| NFR-2 | Backend startup time MUST NOT regress more than 100ms when `s3_enabled=false`. |
| NFR-3 | Migration script MUST NOT emit secrets to stdout / logs (keys come from env, not argv). |
| NFR-4 | Response for `/raw` endpoint streams — peak backend RAM per request is bounded by chunk size (1 MB), not file size. |
| NFR-5 | No new network calls when `s3_enabled=false`. |

---

## 4. Acceptance Criteria

| ID | Given / When / Then | Ref |
|----|---------------------|-----|
| AC-1 | **Given** `S3_ENABLED=false`, **When** `/api/admin/confluence/attachments/X/raw` is hit, **Then** the response is identical to pre-change behavior (FileResponse from disk). | FR-2, FR-8 |
| AC-2 | **Given** `S3_ENABLED=true` and the attachment has `s3_key` set, **When** `/raw` is hit, **Then** backend streams from S3 and returns 200 with correct media_type. | FR-8 |
| AC-3 | **Given** `S3_ENABLED=true` but OSS endpoint is unreachable AND local file exists, **When** `/raw` is hit, **Then** backend falls back to FS and returns 200. | FR-9 |
| AC-4 | **When** `scripts/migrate_attachments_to_s3.py` runs twice back-to-back, **Then** the 2nd run uploads 0 files (all skipped via HeadObject). | FR-11 |
| AC-5 | **When** `scripts/verify_s3_attachments.py` runs on the populated DB, **Then** sampled SHA256 hashes match between local and S3 for 50/50 files. | FR-15 |
| AC-6 | **When** migration 017 is applied twice, **Then** no error; `confluence_attachment.s3_key` column exists both times. | FR-7 |

---

## 5. Edge Cases

| ID | Scenario | Expected Behavior |
|----|----------|-------------------|
| EC-1 | `s3_key` is set but S3 returns 404 (object deleted out-of-band) | Log warning; fall back to local FS; if FS also missing, 404. |
| EC-2 | Boto3 client creation fails at import time (missing creds, network) | Logged at warning; downstream callers get None/exception and fall back. Backend still boots. |
| EC-3 | VPN drops mid-request on a streaming read | Client sees truncated body; backend logs warning. Next request retries. No state corruption. |
| EC-4 | File on disk is modified after upload (size differs) | `s3_key` still points at the old upload. Re-run migration script with `--force` (not in this PR — manual fix). |
| EC-5 | `ATTACHMENT_ROOT` mount is missing in container | Existing behavior: `full_path.exists()` returns False → 404. With S3, preference order still tries S3 first if configured. |

---

## 6. Files affected

**Added:**
- `backend/app/services/s3_storage.py`
- `backend/sql/017_attachment_s3_key.sql`
- `scripts/migrate_attachments_to_s3.py`
- `scripts/verify_s3_attachments.py`
- `api-tests/test_s3_storage.py`

**Modified:**
- `backend/app/config.py` — 7 new S3_* settings
- `backend/app/routers/admin.py` — `serve_attachment` prefers S3 when configured
- `backend/requirements.txt` — add `boto3`
- `.env.example` — document new S3 vars (commented, disabled by default)
- `CLAUDE.md` → `frontend/` N/A; root doc gets a data-flow note on S3

---

## 7. Out of Scope

- **S3 WRITES from backend**: backend is read-only against S3. Uploads happen via the `scripts/migrate_attachments_to_s3.py` script (triggered by the architect manually / via scan_confluence). Live write-on-scan is a follow-up.
- **Thumbnail / preview cache on S3**: `THUMBNAIL_CACHE_ROOT` and `PREVIEW_CACHE_ROOT` remain on local disk (regenerable, speed-sensitive, scoped per-deployment).
- **Retention / lifecycle policies on the bucket**: handled by Lenovo S3 admin, not this repo.
- **Per-file encryption / signed URLs**: internal network only, not needed.
