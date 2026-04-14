"use client";

import { useCallback, useEffect, useState } from "react";

interface EaDoc {
  page_id: string;
  title: string;
  domain: string;
  doc_type: string;
  parent_section: string | null;
  page_url: string;
  excerpt: string | null;
  last_modified: string | null;
  last_modifier: string | null;
}

interface DomainCount {
  code: string;
  label: string;
  count: number;
}

interface ListResponse {
  documents: EaDoc[];
  total: number;
  domains: DomainCount[];
}

const DOMAIN_LABELS: Record<string, string> = {
  ai: "GenAI", aa: "App Arch", ta: "Tech Arch",
  da: "Data Arch", dpp: "Data & Privacy", governance: "Governance",
};

const DOC_TYPE_LABELS: Record<string, string> = {
  standard: "Standard", guideline: "Guideline",
  reference_arch: "Ref Arch", template: "Template",
};

const DOC_TYPES = ["standard", "guideline", "reference_arch", "template"] as const;

export default function StandardsPage() {
  const [docs, setDocs] = useState<EaDoc[]>([]);
  const [total, setTotal] = useState(0);
  const [domains, setDomains] = useState<DomainCount[]>([]);
  const [loading, setLoading] = useState(true);

  const [domainFilter, setDomainFilter] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search.trim()), 200);
    return () => clearTimeout(t);
  }, [search]);

  // Fetch data
  const fetchDocs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (domainFilter) params.set("domain", domainFilter);
      if (typeFilter) params.set("doc_type", typeFilter);
      if (searchDebounced.length >= 2) params.set("q", searchDebounced);
      params.set("limit", "500");

      const r = await fetch(`/api/ea-documents?${params}`);
      const j = await r.json();
      if (j.success) {
        const d = j.data as ListResponse;
        setDocs(d.documents);
        setTotal(d.total);
        setDomains(d.domains);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [domainFilter, typeFilter, searchDebounced]);

  useEffect(() => { fetchDocs(); }, [fetchDocs]);

  return (
    <div>
      <h1 style={{ marginBottom: 8 }}>EA Standards & Guidelines</h1>
      <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 24 }}>
        Browse Lenovo Enterprise Architecture standards, guidelines, reference architectures, and templates.
        All links open in Confluence.
      </p>

      {/* Search */}
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by title or content..."
        style={{
          width: "100%",
          maxWidth: 480,
          padding: "10px 14px",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-md)",
          color: "var(--text)",
          fontSize: 14,
          fontFamily: "var(--font-body)",
          outline: "none",
          marginBottom: 16,
        }}
      />

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <FilterPill label="All Domains" active={!domainFilter} onClick={() => setDomainFilter(null)} />
        {domains.map((d) => (
          <FilterPill
            key={d.code}
            label={`${DOMAIN_LABELS[d.code] || d.code} (${d.count})`}
            active={domainFilter === d.code}
            onClick={() => setDomainFilter(domainFilter === d.code ? null : d.code)}
          />
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 24 }}>
        <FilterPill label="All Types" active={!typeFilter} onClick={() => setTypeFilter(null)} />
        {DOC_TYPES.map((t) => (
          <FilterPill
            key={t}
            label={DOC_TYPE_LABELS[t]}
            active={typeFilter === t}
            onClick={() => setTypeFilter(typeFilter === t ? null : t)}
          />
        ))}
      </div>

      {/* Results */}
      {loading ? (
        <div style={{ color: "var(--text-dim)", fontSize: 13, padding: 24 }}>Loading...</div>
      ) : docs.length === 0 ? (
        <div style={{ color: "var(--text-dim)", fontSize: 13, padding: 24 }}>
          No documents found. Try adjusting your filters.
        </div>
      ) : (
        <>
          <div style={{ color: "var(--text-dim)", fontSize: 11, marginBottom: 12 }}>
            Showing {docs.length} of {total} documents
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {docs.map((d) => (
              <DocCard key={d.page_id} doc={d} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function FilterPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "5px 12px",
        fontSize: 11,
        fontFamily: "var(--font-body)",
        fontWeight: active ? 600 : 400,
        background: active ? "rgba(246,166,35,0.15)" : "var(--bg-elevated)",
        color: active ? "var(--accent)" : "var(--text-muted)",
        border: `1px solid ${active ? "rgba(246,166,35,0.3)" : "var(--border)"}`,
        borderRadius: "var(--radius-md)",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function DocCard({ doc }: { doc: EaDoc }) {
  const modified = doc.last_modified
    ? new Date(doc.last_modified).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
    : null;

  return (
    <div
      style={{
        padding: "14px 18px",
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            fontSize: 9,
            fontWeight: 600,
            padding: "2px 6px",
            border: "1px solid var(--border-strong)",
            borderRadius: "var(--radius-sm)",
            color: "var(--text-muted)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {DOMAIN_LABELS[doc.domain] || doc.domain}
        </span>
        <span
          style={{
            fontSize: 9,
            fontWeight: 600,
            padding: "2px 6px",
            background: "var(--bg-elevated)",
            borderRadius: "var(--radius-sm)",
            color: "var(--text-dim)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {DOC_TYPE_LABELS[doc.doc_type] || doc.doc_type}
        </span>
        <a
          href={doc.page_url}
          target="_blank"
          rel="noreferrer"
          style={{
            color: "var(--accent)",
            textDecoration: "none",
            fontSize: 14,
            fontWeight: 500,
            flex: 1,
          }}
        >
          {doc.title} ↗
        </a>
      </div>
      {doc.excerpt && (
        <div
          style={{
            fontSize: 12,
            color: "var(--text-muted)",
            lineHeight: 1.5,
            overflow: "hidden",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
          }}
        >
          {doc.excerpt}
        </div>
      )}
      {(modified || doc.last_modifier) && (
        <div style={{ fontSize: 10, color: "var(--text-dim)" }}>
          {modified && <span>Updated {modified}</span>}
          {modified && doc.last_modifier && <span> by </span>}
          {doc.last_modifier && <span>{doc.last_modifier}</span>}
        </div>
      )}
    </div>
  );
}
