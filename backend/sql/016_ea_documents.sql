-- 016_ea_documents.sql
-- EA Knowledge Layer: stores metadata from the Enterprise Architecture
-- Confluence space (standards, guidelines, reference architectures, templates).
-- NorthStar links out to Confluence — no full body content stored here.

SET search_path TO northstar, public;

-- ── Table ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ref_ea_document (
    page_id         VARCHAR PRIMARY KEY,
    title           VARCHAR NOT NULL,
    domain          VARCHAR NOT NULL,       -- ai | aa | ta | da | dpp | governance
    doc_type        VARCHAR NOT NULL,       -- standard | guideline | reference_arch | template
    parent_section  VARCHAR,                -- category name for breadcrumb (e.g. "TA: Standards")
    page_url        VARCHAR NOT NULL,
    excerpt         TEXT,                   -- first ~500 chars of plain text for search + preview
    labels          TEXT[],                 -- Confluence labels (keyword matching)
    last_modified   TIMESTAMP,
    last_modifier   VARCHAR,
    synced_at       TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ── Indexes ────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_ea_doc_domain
    ON ref_ea_document (domain);

CREATE INDEX IF NOT EXISTS idx_ea_doc_type
    ON ref_ea_document (doc_type);

CREATE INDEX IF NOT EXISTS idx_ea_doc_domain_type
    ON ref_ea_document (domain, doc_type);

-- Full-text search (tsvector on title + excerpt)
CREATE INDEX IF NOT EXISTS idx_ea_doc_fts
    ON ref_ea_document
    USING GIN (
        to_tsvector('simple',
            coalesce(title, '') || ' ' ||
            coalesce(excerpt, '')
        )
    );

-- Trigram fuzzy match
CREATE INDEX IF NOT EXISTS idx_ea_doc_trgm
    ON ref_ea_document
    USING GIN (
        (lower(coalesce(title, '') || ' ' || coalesce(excerpt, '')))
        gin_trgm_ops
    );
