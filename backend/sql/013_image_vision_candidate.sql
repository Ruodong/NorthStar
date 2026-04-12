-- image-vision-extract Phase 0
--
-- Adds dedup + candidate-queue columns to confluence_attachment so
-- scripts/mark_vision_candidates.py can identify which PNG/JPEG
-- attachments are real "there is no drawio for this, we actually
-- need to LLM-extract it" candidates, vs ones that are just drawio
-- exports (same file, different format, no new information).
--
-- All additive. All IF NOT EXISTS. Safe to re-run on every backend
-- startup (ensure_sql_migrations() applies every file every boot).
--
-- Spec: .specify/features/image-vision-extract/spec.md § 7.1

SET search_path TO northstar, public;

ALTER TABLE northstar.confluence_attachment
    ADD COLUMN IF NOT EXISTS derived_source       VARCHAR,
    ADD COLUMN IF NOT EXISTS derived_source_att   VARCHAR,
    ADD COLUMN IF NOT EXISTS vision_candidate     BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN northstar.confluence_attachment.derived_source IS
    'Non-null if this attachment is a derived copy of another artifact '
    'on the same page. Values: ''drawio'' (PNG/JPEG is an export of a '
    'drawio file whose stem matches). NULL means the attachment stands '
    'alone. Set by scripts/mark_vision_candidates.py.';

COMMENT ON COLUMN northstar.confluence_attachment.derived_source_att IS
    'attachment_id of the source this row was derived from. Nullable. '
    'Lets the admin UI link "this PNG is an export of drawio X" back '
    'to the original drawio row.';

COMMENT ON COLUMN northstar.confluence_attachment.vision_candidate IS
    'TRUE if this attachment is a PNG/JPEG that (a) is NOT derived '
    'from a drawio on the same page and (b) has a local file and (c) '
    'is attached to a FY2425+FY2526 page. These are the rows the '
    'vision-extract PoC button can meaningfully run against.';

-- Partial index: queue lookups scan only the candidates, not the full
-- 10k+ attachment table. The WHERE clause matches the FR-7 vision-queue
-- endpoint's filter exactly.
CREATE INDEX IF NOT EXISTS ix_confluence_attachment_vision_candidate
    ON northstar.confluence_attachment (vision_candidate)
    WHERE vision_candidate = TRUE;
