-- NorthStar drawio reference links
-- --------------------------------
-- Some Confluence pages render a drawio diagram they do not physically own.
-- Two patterns in Lenovo's ARD space:
--
--   1. <ac:structured-macro ac:name="drawio"> with @templateUrl pointing at
--      /download/attachments/<OTHER_PAGE_ID>/<filename>. The macro sources
--      its diagram from a template attachment on another page.
--
--   2. <ac:structured-macro ac:name="inc-drawio"> (transclude variant) with
--      @pageId parameter pointing at the source page whose "real" drawio
--      macro holds the diagram.
--
-- Either way, the inclusion page has 0 drawio attachments on itself but
-- visually displays a diagram from another page. The scanner only walks the
-- ARD FY tree, so source pages living outside that tree were never scanned
-- and their attachments never landed in confluence_attachment. When a user
-- opens the admin list, the inclusion page shows drawio_count=0 even though
-- the rendered page has a diagram — mismatch with Confluence reality.
--
-- This table captures the inclusion → source mapping so the admin query can
-- join through it and count diagrams that live on the source page. The
-- referenced source pages (and their attachments) get backfilled by
-- scripts/backfill_drawio_sources.py out of the normal FY scan scope.
--
-- Runs automatically on backend startup via ensure_sql_migrations().

SET search_path TO northstar, public;

CREATE TABLE IF NOT EXISTS drawio_reference (
    -- The page that EMBEDS/INCLUDES the diagram (what the user sees)
    inclusion_page_id  VARCHAR NOT NULL,
    -- The page that OWNS the diagram (where the attachment actually lives)
    source_page_id     VARCHAR NOT NULL,
    -- Macro kind: 'template_url' | 'inc_drawio' | 'drawio_sketch'
    macro_kind         VARCHAR(20) NOT NULL,
    -- Human-readable name of the diagram (for display); may be NULL for
    -- unnamed diagrams. We use coalesce('') in the unique key so NULLs
    -- don't proliferate duplicate rows.
    diagram_name       VARCHAR DEFAULT '' NOT NULL,
    -- Source filename when templateUrl exists, NULL for inc-drawio
    template_filename  VARCHAR,
    first_seen_at      TIMESTAMP DEFAULT NOW(),
    last_seen_at       TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (inclusion_page_id, source_page_id, macro_kind, diagram_name)
);

CREATE INDEX IF NOT EXISTS idx_drawio_ref_inclusion
    ON drawio_reference (inclusion_page_id);
CREATE INDEX IF NOT EXISTS idx_drawio_ref_source
    ON drawio_reference (source_page_id);
CREATE INDEX IF NOT EXISTS idx_drawio_ref_kind
    ON drawio_reference (macro_kind);
