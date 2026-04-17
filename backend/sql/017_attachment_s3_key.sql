-- 017_attachment_s3_key.sql
-- Add s3_key column to confluence_attachment so the backend knows which
-- attachments are replicated to S3 (oss2.xcloud.lenovo.com, bucket lenovo-it,
-- prefix pm/northstar/attachments/).
--
-- The column is nullable by design: attachments that have not been uploaded
-- to S3 keep s3_key = NULL, and the /raw endpoint serves them from the local
-- filesystem as before. Population happens via scripts/migrate_attachments_to_s3.py.
--
-- Spec: .specify/features/s3-attachments/spec.md §FR-6, FR-7
-- Idempotent.

SET search_path TO northstar, public;

ALTER TABLE northstar.confluence_attachment
    ADD COLUMN IF NOT EXISTS s3_key VARCHAR;

-- Partial index: only index rows that actually live on S3. This keeps the
-- index small (for 10,921 rows with all migrated it's just one fully-
-- populated index; for a partial rollout it's even smaller) and makes the
-- "is this attachment on S3?" lookup in serve_attachment a single index hit.
CREATE INDEX IF NOT EXISTS idx_conf_attach_s3_key
    ON northstar.confluence_attachment (attachment_id)
    WHERE s3_key IS NOT NULL;
