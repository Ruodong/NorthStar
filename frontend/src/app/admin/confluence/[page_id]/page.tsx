"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

interface QRow {
  key: string;
  value: string;
}

interface QSection {
  heading: string;
  level: number;
  rows: QRow[];
}

interface QExpandPanel {
  title: string;
  content_text: string;
}

interface Questionnaire {
  sections: QSection[];
  expand_panels: QExpandPanel[];
  stats: { tables?: number; headings?: number; chars?: number };
}

interface Page {
  page_id: string;
  fiscal_year: string;
  title: string;
  project_id: string | null;
  page_url: string;
  parent_id: string | null;
  depth: number | null;
  has_body: boolean;
  body_size_chars: number | null;
  questionnaire: Questionnaire | null;
  q_project_id: string | null;
  q_project_name: string | null;
  q_pm: string | null;
  q_pm_name: string | null;
  q_it_lead: string | null;
  q_it_lead_name: string | null;
  q_dt_lead: string | null;
  q_dt_lead_name: string | null;
}

// source_kind identifies where this attachment actually lives:
//   "own"        → physically on this page
//   "descendant" → on a child/grandchild page (source_page_* set)
//   "referenced" → on an external source page reached via a drawio macro
//                  reference (inc-drawio or templateUrl). Carries
//                  diagram_name + macro_kind + via_page_* (which of this
//                  folder's children the macro actually lives on).
interface Attachment {
  attachment_id: string;
  title: string;
  media_type: string;
  file_kind: string; // drawio|image|pdf|office|xml|other
  file_size: number | null;
  version: number | null;
  download_path: string;
  local_path: string | null;
  source_kind: "own" | "descendant" | "referenced";
  source_page_id: string | null;
  source_page_title: string | null;
  diagram_name: string | null;
  via_page_id?: string | null;
  via_page_title?: string | null;
  macro_kind?: string | null;
}

interface ParentPage {
  page_id: string;
  title: string;
  depth: number | null;
}

interface ChildPage {
  page_id: string;
  title: string;
  depth: number | null;
  page_url: string;
  page_type: string | null;
  own_attachments: number;
  own_drawio: number;
  ref_drawio: number;
}

interface Detail {
  page: Page;
  attachments: Attachment[];
  parent: ParentPage | null;
  children: ChildPage[];
}

// ---------------------------------------------------------------------------
// Extracted Apps / Interactions — populated by scripts/parse_confluence_drawios.py
// See backend route GET /api/admin/confluence/pages/{id}/extracted
// ---------------------------------------------------------------------------
interface ExtractedApp {
  attachment_id: string;
  attachment_title: string;
  source_page_id: string;
  source_page_title: string;
  source_kind: "own" | "descendant" | "referenced";
  cell_id: string;
  app_name: string;
  standard_id: string | null;
  id_is_standard: boolean;
  application_status: string | null;
  functions: string | null;
  fill_color: string | null;
  cmdb_name: string | null;
  // Name-id reconciliation fields (spec: drawio-name-id-reconciliation)
  resolved_app_id: string | null;
  match_type:
    | "direct"
    | "typo_tolerated"
    | "auto_corrected"
    | "auto_corrected_missing_id"
    | "fuzzy_by_name"
    | "mismatch_unresolved"
    | "no_cmdb"
    | null;
  name_similarity: number | null;
  cmdb_name_for_drawio_id: string | null;
  cmdb_name_for_resolved: string | null;
}

interface ExtractedInteraction {
  attachment_id: string;
  attachment_title: string;
  source_page_id: string;
  source_page_title: string;
  source_kind: "own" | "descendant" | "referenced";
  edge_cell_id: string;
  source_cell_id: string | null;
  target_cell_id: string | null;
  interaction_type: string | null;
  direction: string | null;
  interaction_status: string | null;
  business_object: string | null;
  source_app_name: string | null;
  source_standard_id: string | null;
  source_resolved_id: string | null;
  source_match_type: string | null;
  source_cmdb_name_resolved: string | null;
  source_cmdb_name_orig: string | null;
  target_app_name: string | null;
  target_standard_id: string | null;
  target_resolved_id: string | null;
  target_match_type: string | null;
  target_cmdb_name_resolved: string | null;
  target_cmdb_name_orig: string | null;
}

interface ExtractedByAttachment {
  attachment_id: string;
  attachment_title: string;
  source_page_title: string;
  source_kind: "own" | "descendant" | "referenced";
  app_count: number;
  app_with_std_id_count: number;
  interaction_count: number;
}

interface ExtractedMajorApp {
  app_id: string;
  drawio_name: string | null;
  application_status: "New" | "Change" | "Sunset";
  occurrence_count: number;
  attachment_titles: string[] | null;
  cmdb_name: string | null;
}

interface ExtractedData {
  apps: ExtractedApp[];
  interactions: ExtractedInteraction[];
  by_attachment: ExtractedByAttachment[];
  major_apps: ExtractedMajorApp[];
  vision_apps?: ExtractedApp[];
  vision_interactions?: ExtractedInteraction[];
  vision_by_attachment?: ExtractedByAttachment[];
}

// Image vision extract (Phase 1 PoC) — the `/vision-extract` endpoint
// returns this shape. Architects click a per-image button to trigger
// the call. Spec: .specify/features/image-vision-extract/spec.md FR-16
interface VisionExtractResponse {
  diagram_type: "app_arch" | "tech_arch" | "unknown";
  applications: {
    app_id: string;
    id_is_standard: boolean;
    standard_id: string;
    name: string;
    functions: string[];
    application_status: string;
    source: "vision";
  }[];
  interactions: {
    source_app_id: string;
    target_app_id: string;
    interaction_type: string;
    direction: string;
    business_object: string;
    interface_status: string;
    status_inferred_from_endpoints: boolean;
    source: "vision";
  }[];
  tech_components: {
    name: string;
    component_type: string;
    layer: string;
    deploy_mode: string;
    runtime: string;
    source: "vision";
  }[];
  meta: {
    model: string;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    wall_ms: number;
  };
}

const KIND_LABEL: Record<string, string> = {
  drawio: "draw.io",
  image: "Image",
  pdf: "PDF",
  office: "Office",
  xml: "XML",
  other: "Other",
};

const KIND_COLOR: Record<string, string> = {
  drawio: "var(--accent)",
  image: "#5fc58a",
  pdf: "#e8716b",
  office: "#6ba6e8",
  xml: "#a8b0c0",
  other: "#6b7488",
};

function humanSize(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

type Tab = "attachments" | "extracted" | "hierarchy" | "questionnaire" | "raw";

export default function ConfluencePageDetail() {
  const params = useParams();
  const pageId = params.page_id as string;
  const [detail, setDetail] = useState<Detail | null>(null);
  const [extracted, setExtracted] = useState<ExtractedData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<Attachment | null>(null);
  // Read initial tab from URL query param (?tab=extracted) so the list
  // page's APP NAME link can deep-link directly to the Extracted tab.
  const [tab, setTab] = useState<Tab>(() => {
    if (typeof window === "undefined") return "attachments";
    const sp = new URLSearchParams(window.location.search);
    const t = sp.get("tab");
    if (t && ["attachments", "extracted", "hierarchy", "questionnaire", "raw"].includes(t)) {
      return t as Tab;
    }
    return "attachments";
  });

  useEffect(() => {
    (async () => {
      try {
        const [rDetail, rExtracted] = await Promise.all([
          fetch(`/api/admin/confluence/pages/${pageId}`, { cache: "no-store" }),
          fetch(`/api/admin/confluence/pages/${pageId}/extracted`, {
            cache: "no-store",
          }),
        ]);
        const jDetail = await rDetail.json();
        if (!jDetail.success) throw new Error(jDetail.error);
        setDetail(jDetail.data);
        // auto-select first previewable
        const first = jDetail.data.attachments.find(
          (a: Attachment) =>
            a.local_path && ["drawio", "image", "pdf"].includes(a.file_kind)
        );
        if (first) setSelected(first);

        // Extraction is best-effort: if the endpoint errors (e.g. migration
        // 011 not applied on this host), the tab is hidden silently.
        if (rExtracted.ok) {
          const jExtracted = await rExtracted.json();
          if (jExtracted.success) setExtracted(jExtracted.data);
        }
      } catch (e) {
        setErr(String(e));
      }
    })();
  }, [pageId]);

  if (err) {
    return (
      <div>
        <Link href="/admin/confluence" style={{ color: "var(--text-muted)" }}>
          ← All pages
        </Link>
        <div className="panel" style={{ marginTop: 16, borderColor: "#5b1f1f" }}>
          {err}
        </div>
      </div>
    );
  }

  if (!detail) return <div className="subtitle">Loading…</div>;

  const previewable = detail.attachments.filter(
    (a) => !a.title.startsWith("drawio-backup") && !a.title.startsWith("~")
  );
  const imageCount = previewable.filter((a) => a.file_kind === "image").length;
  const questionnaire = detail.page.questionnaire;
  const qRowCount =
    questionnaire?.sections.reduce((n, s) => n + s.rows.length, 0) ?? 0;

  return (
    <div>
      <Link
        href="/admin/confluence"
        style={{ color: "var(--text-muted)", fontSize: 13 }}
      >
        ← All pages
      </Link>
      <h1 style={{ marginTop: 12 }}>{detail.page.title}</h1>
      <div
        style={{
          display: "flex",
          gap: 18,
          marginBottom: 16,
          fontSize: 13,
          color: "var(--text-muted)",
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <span>
          <code>{detail.page.fiscal_year}</code>
        </span>
        {detail.page.project_id && (
          <span>
            Project <code>{detail.page.project_id}</code>
          </span>
        )}
        <a
          href={detail.page.page_url}
          target="_blank"
          rel="noreferrer"
          style={{ color: "var(--accent)" }}
        >
          Open in Confluence ↗
        </a>
        {detail.page.body_size_chars ? (
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
            body: {detail.page.body_size_chars.toLocaleString()} chars
          </span>
        ) : null}
      </div>

      {/* Linked project info extracted from questionnaire */}
      {(detail.page.q_project_id ||
        detail.page.q_pm ||
        detail.page.q_it_lead ||
        detail.page.q_dt_lead) && (
        <div
          className="panel"
          style={{
            marginBottom: 16,
            padding: "14px 20px",
            borderLeft: "2px solid var(--accent)",
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: 0.7,
              color: "var(--accent)",
              marginBottom: 10,
            }}
          >
            Linked Project (from questionnaire)
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 14,
              fontSize: 12,
            }}
          >
            {detail.page.q_project_id && (
              <KV label="Project ID">
                <Link
                  href={`/admin/projects?q=${encodeURIComponent(detail.page.q_project_id)}`}
                  style={{ color: "var(--accent)" }}
                >
                  <code>{detail.page.q_project_id}</code>
                </Link>
              </KV>
            )}
            {detail.page.q_project_name && (
              <KV label="Name">{detail.page.q_project_name}</KV>
            )}
            {detail.page.q_pm && (
              <KV label="PM">
                <NameWithCode name={detail.page.q_pm_name} code={detail.page.q_pm} />
              </KV>
            )}
            {detail.page.q_it_lead && (
              <KV label="IT Lead">
                <NameWithCode name={detail.page.q_it_lead_name} code={detail.page.q_it_lead} />
              </KV>
            )}
            {detail.page.q_dt_lead && (
              <KV label="DT Lead">
                <NameWithCode name={detail.page.q_dt_lead_name} code={detail.page.q_dt_lead} />
              </KV>
            )}
          </div>
        </div>
      )}

      {/* Tab bar */}
      <div
        style={{
          display: "flex",
          gap: 4,
          marginBottom: 16,
          borderBottom: "1px solid var(--border-strong)",
        }}
      >
        <TabButton active={tab === "attachments"} onClick={() => setTab("attachments")}>
          Attachments <Chip>{previewable.length}</Chip>
        </TabButton>
        <TabButton
          active={tab === "extracted"}
          onClick={() => setTab("extracted")}
          disabled={!extracted || (
            extracted.apps.length === 0
            && (extracted.vision_apps?.length ?? 0) === 0
            && imageCount === 0
          )}
        >
          Extracted <Chip>{
            (extracted?.apps.length ?? 0) + (extracted?.vision_apps?.length ?? 0)
            || (imageCount > 0 ? `${imageCount} img` : 0)
          }</Chip>
        </TabButton>
        <TabButton active={tab === "hierarchy"} onClick={() => setTab("hierarchy")}>
          Hierarchy{" "}
          <Chip>
            {detail.children.length + (detail.parent ? 1 : 0)}
          </Chip>
        </TabButton>
        <TabButton
          active={tab === "questionnaire"}
          onClick={() => setTab("questionnaire")}
          disabled={!questionnaire}
        >
          Questionnaire <Chip>{qRowCount}</Chip>
        </TabButton>
        <TabButton
          active={tab === "raw"}
          onClick={() => setTab("raw")}
          disabled={!detail.page.has_body}
        >
          Raw HTML
        </TabButton>
      </div>

      {tab === "attachments" && (
        <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: 16 }}>
          {/* Attachment list */}
          <div
            className="panel"
            style={{ padding: 0, overflow: "hidden", maxHeight: 720, overflowY: "auto" }}
          >
            <div className="panel-title" style={{ padding: "18px 18px 10px" }}>
              Attachments ({previewable.length})
            </div>
            {previewable.length === 0 && <div className="empty">No attachments.</div>}
            {previewable.map((a) => {
              const isSelected = selected?.attachment_id === a.attachment_id;
              return (
                <button
                  key={a.attachment_id}
                  onClick={() => setSelected(a)}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    background: isSelected ? "var(--surface-hover)" : "transparent",
                    borderLeft: isSelected
                      ? "2px solid var(--accent)"
                      : "2px solid transparent",
                    padding: "12px 18px",
                    borderRadius: 0,
                    border: 0,
                    borderBottom: "1px solid var(--border)",
                    color: "var(--text)",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span
                      style={{
                        color: KIND_COLOR[a.file_kind] || "var(--text-muted)",
                        fontFamily: "var(--font-mono)",
                        fontSize: 10,
                        textTransform: "uppercase",
                        letterSpacing: 0.6,
                      }}
                    >
                      {KIND_LABEL[a.file_kind] || a.file_kind}
                    </span>
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 10,
                        color: "var(--text-dim)",
                      }}
                    >
                      {humanSize(a.file_size)}
                    </span>
                  </div>
                  <div style={{ marginTop: 4, wordBreak: "break-all" }}>{a.title}</div>
                  <SourceBadge a={a} />
                  {!a.local_path && (
                    <div style={{ fontSize: 10, color: "#e8716b", marginTop: 3 }}>
                      not downloaded
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Preview pane */}
          <div
            className="panel"
            style={{
              padding: 0,
              overflow: "hidden",
              minHeight: 720,
              display: "flex",
              flexDirection: "column",
            }}
          >
            {!selected ? (
              <div className="empty" style={{ margin: "auto" }}>
                Pick an attachment to preview.
              </div>
            ) : (
              <AttachmentPreview attachment={selected} />
            )}
          </div>
        </div>
      )}

      {tab === "extracted" && (
        <ExtractedView
          data={extracted}
          imageAttachments={previewable.filter((a) => a.file_kind === "image")}
        />
      )}

      {tab === "hierarchy" && (
        <HierarchyView
          currentTitle={detail.page.title}
          currentDepth={detail.page.depth}
          parent={detail.parent}
          children={detail.children}
        />
      )}

      {tab === "questionnaire" && (
        <QuestionnaireView questionnaire={questionnaire} />
      )}

      {tab === "raw" && <RawHtmlView pageId={pageId} />}
    </div>
  );
}

function TabButton({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: "transparent",
        color: active ? "var(--text)" : disabled ? "var(--text-dim)" : "var(--text-muted)",
        border: 0,
        borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
        borderRadius: 0,
        padding: "10px 18px",
        fontSize: 13,
        fontWeight: active ? 600 : 500,
        marginBottom: -1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {children}
    </button>
  );
}

function NameWithCode({
  name,
  code,
}: {
  name: string | null;
  code: string;
}) {
  if (name) {
    return (
      <span>
        {name}{" "}
        <code style={{ color: "var(--text-dim)", fontSize: 11 }}>{code}</code>
      </span>
    );
  }
  return <code>{code}</code>;
}

function KV({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 9,
          fontWeight: 500,
          textTransform: "uppercase",
          letterSpacing: 0.7,
          color: "var(--text-muted)",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div style={{ color: "var(--text)" }}>{children}</div>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        color: "var(--text-dim)",
        marginLeft: 6,
      }}
    >
      {children}
    </span>
  );
}

function QuestionnaireView({ questionnaire }: { questionnaire: Questionnaire | null }) {
  if (!questionnaire) {
    return (
      <div className="panel">
        <div className="empty">
          No questionnaire parsed. Run the scanner without <code>--no-body</code> to
          populate this page.
        </div>
      </div>
    );
  }
  if (questionnaire.sections.length === 0 && questionnaire.expand_panels.length === 0) {
    return (
      <div className="panel">
        <div className="empty">Body parsed but contained no structured Q&A.</div>
      </div>
    );
  }
  return (
    <div style={{ display: "grid", gap: 14 }}>
      {questionnaire.sections.map((s, i) => (
        <div key={i} className="panel">
          <div
            className="panel-title"
            style={{ marginBottom: 14, display: "flex", gap: 10, alignItems: "center" }}
          >
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                color: "var(--accent)",
              }}
            >
              H{s.level || "-"}
            </span>
            <span style={{ color: "var(--text)", fontSize: 14, textTransform: "none" }}>
              {s.heading || "(unnamed)"}
            </span>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                color: "var(--text-dim)",
              }}
            >
              {s.rows.length} rows
            </span>
          </div>
          <table>
            <tbody>
              {s.rows.map((r, j) => (
                <tr key={j}>
                  <th style={{ width: "30%", verticalAlign: "top", whiteSpace: "nowrap" }}>
                    {r.key || "—"}
                  </th>
                  <td
                    style={{
                      color: "var(--text)",
                      fontSize: 13,
                      lineHeight: 1.6,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {r.value || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {questionnaire.expand_panels.length > 0 && (
        <div className="panel">
          <div className="panel-title">Expand Panels</div>
          {questionnaire.expand_panels.map((p, i) => (
            <details
              key={i}
              style={{
                padding: "12px 0",
                borderBottom: "1px solid var(--border)",
                color: "var(--text-muted)",
                fontSize: 13,
              }}
            >
              <summary style={{ cursor: "pointer", color: "var(--text)", fontWeight: 500 }}>
                {p.title || "(expand)"}
              </summary>
              <div style={{ marginTop: 10, whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
                {p.content_text || "(empty)"}
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}

function RawHtmlView({ pageId }: { pageId: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`/api/admin/confluence/pages/${pageId}/body`, {
          cache: "no-store",
        });
        const j = await r.json();
        if (!j.success) throw new Error(j.error);
        setHtml(j.data.html);
      } catch (e) {
        setErr(String(e));
      }
    })();
  }, [pageId]);

  if (err) return <div className="panel empty">Error: {err}</div>;
  if (html === null) return <div className="panel empty">Loading raw HTML…</div>;

  // Sandbox the HTML in an iframe with allow-same-origin=false so any scripts
  // or remote resources can't leak anything. We write into a blank srcdoc.
  const wrapped = `<!doctype html><html><head><meta charset="utf-8"><base target="_blank">
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
             background: #fff; color: #172b4d; margin: 24px; max-width: 960px; }
      table { border-collapse: collapse; margin: 8px 0; width: 100%; }
      th, td { border: 1px solid #dfe1e6; padding: 8px 12px; text-align: left; vertical-align: top; }
      th { background: #f4f5f7; }
      h1, h2, h3 { color: #172b4d; }
      img { max-width: 100%; }
      code { background: #f4f5f7; padding: 2px 4px; border-radius: 3px; }
      a { color: #0052cc; }
    </style></head><body>${html}</body></html>`;

  return (
    <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
      <iframe
        sandbox=""
        srcDoc={wrapped}
        title="raw confluence body"
        style={{ width: "100%", height: 800, border: 0, background: "#fff" }}
      />
    </div>
  );
}

// Chrome's built-in PDF viewer refuses to render PDFs inside iframes when
// the src is a non-standard port URL (e.g. :3003). Workaround: fetch the
// PDF as a blob, create an object URL, and use that as the iframe src.
// Blob URLs work because Chrome treats them as same-origin trusted content.
function PdfBlobPreview({ src, title }: { src: string; title: string }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let revoke: string | null = null;
    (async () => {
      try {
        const res = await fetch(src);
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        revoke = url;
        setBlobUrl(url);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [src]);

  if (err) {
    return (
      <div style={{ padding: 32, color: "var(--error)", fontSize: 13 }}>
        Failed to load PDF: {err}
      </div>
    );
  }
  if (!blobUrl) {
    return (
      <div style={{ padding: 32, color: "var(--text-dim)", fontSize: 13 }}>
        Loading PDF…
      </div>
    );
  }
  return (
    <iframe
      src={blobUrl}
      title={title}
      style={{ flex: 1, border: 0, minHeight: 640 }}
    />
  );
}

function AttachmentPreview({ attachment }: { attachment: Attachment }) {
  const src = `/api/admin/confluence/attachments/${attachment.attachment_id}/raw`;

  if (!attachment.local_path) {
    return (
      <div style={{ padding: 32 }}>
        <div className="panel-title">Not downloaded</div>
        <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
          This attachment is indexed but has not been downloaded locally yet. Run the
          scanner again without <code>--no-download</code>:
          <br />
          <code
            style={{
              display: "block",
              marginTop: 12,
              padding: 10,
              background: "var(--bg-elevated)",
              borderRadius: 4,
              fontSize: 12,
            }}
          >
            .venv-ingest/bin/python scripts/scan_confluence.py --fy {"<fy>"}
          </code>
        </p>
      </div>
    );
  }

  const header = (
    <div
      style={{
        padding: "14px 22px",
        borderBottom: "1px solid var(--border)",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        fontSize: 12,
      }}
    >
      <div style={{ color: "var(--text-muted)" }}>
        <span style={{ color: KIND_COLOR[attachment.file_kind] || "var(--text-muted)" }}>
          {KIND_LABEL[attachment.file_kind] || attachment.file_kind}
        </span>{" "}
        · <code>{attachment.media_type}</code> · {humanSize(attachment.file_size)}
      </div>
      <a
        href={src}
        download={attachment.title}
        style={{ fontSize: 12, color: "var(--accent)" }}
      >
        Download ↓
      </a>
    </div>
  );

  if (attachment.file_kind === "image") {
    return (
      <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
        {header}
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            background: "var(--bg)",
            overflow: "auto",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={attachment.title}
            style={{ maxWidth: "100%", maxHeight: "100%" }}
          />
        </div>
      </div>
    );
  }

  if (attachment.file_kind === "pdf") {
    return (
      <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
        {header}
        <PdfBlobPreview src={src} title={attachment.title} />
      </div>
    );
  }

  if (attachment.file_kind === "drawio") {
    return (
      <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
        {header}
        <DrawioPreview src={src} />
      </div>
    );
  }

  if (attachment.file_kind === "xml") {
    return (
      <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
        {header}
        <XmlPreview src={src} />
      </div>
    );
  }

  // office files: route through the OfficePreview component which
  // handles PPTX/DOCX (server-side LibreOffice → PDF in an iframe)
  // and XLSX (client-side SheetJS → HTML table) internally, and
  // degrades gracefully for legacy .ppt/.xls/.doc/ConceptDraw.
  if (attachment.file_kind === "office") {
    return (
      <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
        {header}
        <OfficePreview attachment={attachment} rawSrc={src} />
      </div>
    );
  }

  // Anything else (unknown kind) → download fallback
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      {header}
      <div style={{ margin: "auto", textAlign: "center", color: "var(--text-muted)" }}>
        <div style={{ fontSize: 14, marginBottom: 10 }}>
          Cannot preview this file type inline.
        </div>
        <a
          href={src}
          download={attachment.title}
          className="btn"
          style={{ display: "inline-block" }}
        >
          Download to view
        </a>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// OfficePreview
//
// PPTX / DOCX  → server-side LibreOffice converts to PDF, which the
//                browser's built-in PDF viewer renders in an iframe.
// XLSX         → client-side SheetJS parses the raw bytes and renders
//                one HTML table per workbook sheet, with a tab row.
// Everything   → legacy .ppt/.xls/.doc and ConceptDraw files fall into
//   else        the download-only card. Spec office-preview FR-19..FR-25.
//
// Lazy-loading: the component does not run until the parent decides
// to mount it (i.e. the user clicks an attachment). This ensures we
// don't kick off 5 parallel LibreOffice conversions just because the
// user opened a page with 5 PPTX attachments.
// ---------------------------------------------------------------------------

type OfficeMode = "pdf" | "xlsx" | "unsupported";

function officeMode(mediaType: string): OfficeMode {
  const mt = (mediaType || "").toLowerCase();
  if (
    mt === "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    || mt === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "pdf";
  }
  if (mt === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
    return "xlsx";
  }
  return "unsupported";
}

// Bump this token any time the preview endpoint's RESPONSE HEADERS
// change in a way that would trap a cached browser response. Body
// changes (e.g. re-conversion) don't need a bump — ETag + max-age
// handle that. But header changes DO: browsers cache headers along
// with the body and serve the pair as a unit, so an old cached
// response can keep force-downloading for as long as the previous
// Cache-Control allowed, regardless of what the server returns now.
//
// v2 shipped when we fixed Content-Disposition: attachment →
// inline (PDF preview force-downloading in Chrome/Firefox).
const PREVIEW_CACHE_BUST = "v2";

function OfficePreview({
  attachment,
  rawSrc,
}: {
  attachment: Attachment;
  rawSrc: string;
}) {
  const mode = officeMode(attachment.media_type);
  const previewSrc = `/api/admin/confluence/attachments/${attachment.attachment_id}/preview?${PREVIEW_CACHE_BUST}`;

  if (mode === "unsupported") {
    return (
      <div style={{ margin: "auto", textAlign: "center", color: "var(--text-muted)", padding: 40 }}>
        <div style={{ fontSize: 14, marginBottom: 10 }}>
          This Office format can&rsquo;t be previewed in-browser. Supported formats: PPTX, DOCX, XLSX.
          Legacy .ppt / .xls / .doc and ConceptDraw files must be downloaded.
        </div>
        <a
          href={rawSrc}
          download={attachment.title}
          className="btn"
          style={{ display: "inline-block" }}
        >
          Download to view
        </a>
      </div>
    );
  }

  if (mode === "pdf") {
    return <OfficePdfPreview previewSrc={previewSrc} title={attachment.title} />;
  }

  return <OfficeXlsxPreview previewSrc={previewSrc} title={attachment.title} />;
}

function OfficePdfPreview({
  previewSrc,
  title,
}: {
  previewSrc: string;
  title: string;
}) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errMsg, setErrMsg] = useState<string | null>(null);

  // Detect an HTTP error before committing to iframe rendering. A HEAD
  // request is cheap and lets us show a real error panel instead of
  // the browser's default "this file could not be loaded" screen.
  useEffect(() => {
    setStatus("loading");
    setErrMsg(null);
    const ctrl = new AbortController();
    (async () => {
      try {
        const r = await fetch(previewSrc, { method: "HEAD", signal: ctrl.signal });
        if (!r.ok) {
          // Try to pull the error code from the JSON body (endpoint
          // returns JSON on error per FR-18 rationale).
          let code = `HTTP ${r.status}`;
          try {
            const body = await fetch(previewSrc, { signal: ctrl.signal });
            if (!body.ok) {
              const j = await body.json();
              code = j.error || code;
            }
          } catch {
            // Ignore — stick with the generic HTTP status.
          }
          setErrMsg(code);
          setStatus("error");
          return;
        }
        setStatus("ready");
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setErrMsg(String(e));
        setStatus("error");
      }
    })();
    return () => ctrl.abort();
  }, [previewSrc]);

  if (status === "error") {
    return (
      <div style={{ margin: "auto", textAlign: "center", padding: 40 }}>
        <div style={{ fontSize: 14, color: "var(--text-muted)", marginBottom: 6 }}>
          Preview failed.
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}>
          Error: <code>{errMsg}</code>
        </div>
        <a
          href={previewSrc.replace("/preview", "/raw")}
          download={title}
          className="btn"
        >
          Download original
        </a>
      </div>
    );
  }

  if (status === "loading") {
    return (
      <div style={{ margin: "auto", textAlign: "center", padding: 40 }}>
        <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 10 }}>
          Converting to PDF&hellip;
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
          First view of a large PPTX can take 10&ndash;60 seconds. Subsequent views are instant.
        </div>
      </div>
    );
  }

  return (
    <iframe
      src={previewSrc}
      title={title}
      style={{ flex: 1, border: 0, minHeight: 640, background: "var(--bg)" }}
    />
  );
}

function OfficeXlsxPreview({
  previewSrc,
  title,
}: {
  previewSrc: string;
  title: string;
}) {
  // Lazy-load the SheetJS runtime so the main bundle isn't bloated
  // by the ~600KB xlsx library on every admin page load.
  const [workbook, setWorkbook] = useState<unknown | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [activeSheet, setActiveSheet] = useState<string | null>(null);
  const [tableHtml, setTableHtml] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);
  const [rowCount, setRowCount] = useState<number>(0);
  const [truncated, setTruncated] = useState<boolean>(false);

  // Spec EC-5: cap rendered rows at 1000 per sheet.
  const MAX_ROWS = 1000;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [xlsxMod, resp] = await Promise.all([
          import("xlsx"),
          fetch(previewSrc),
        ]);
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`);
        }
        const buf = await resp.arrayBuffer();
        const wb = xlsxMod.read(new Uint8Array(buf), { type: "array" });
        if (cancelled) return;
        setWorkbook(wb);
        setSheetNames(wb.SheetNames);
        setActiveSheet(wb.SheetNames[0] || null);
      } catch (e) {
        if (!cancelled) setErr(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [previewSrc]);

  // Render the active sheet whenever the user switches tabs.
  useEffect(() => {
    if (!workbook || !activeSheet) return;
    (async () => {
      try {
        const xlsxMod = await import("xlsx");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ws = (workbook as any).Sheets[activeSheet];
        const range = xlsxMod.utils.decode_range(ws["!ref"] || "A1");
        const actualRows = range.e.r - range.s.r + 1;
        setRowCount(actualRows);
        if (actualRows > MAX_ROWS) {
          setTruncated(true);
          const capped: typeof range = {
            s: { r: range.s.r, c: range.s.c },
            e: { r: range.s.r + MAX_ROWS - 1, c: range.e.c },
          };
          ws["!ref"] = xlsxMod.utils.encode_range(capped);
        } else {
          setTruncated(false);
        }
        const html = xlsxMod.utils.sheet_to_html(ws, { editable: false });
        setTableHtml(html);
      } catch (e) {
        setErr(String(e));
      }
    })();
  }, [workbook, activeSheet]);

  if (err) {
    return (
      <div style={{ margin: "auto", textAlign: "center", padding: 40 }}>
        <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 10 }}>
          Excel preview failed: <code>{err}</code>
        </div>
        <a href={previewSrc} download={title} className="btn">
          Download original
        </a>
      </div>
    );
  }

  if (!workbook) {
    return (
      <div style={{ margin: "auto", textAlign: "center", padding: 40, color: "var(--text-muted)", fontSize: 13 }}>
        Loading workbook&hellip;
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 640 }}>
      <div
        style={{
          display: "flex",
          gap: 4,
          padding: "8px 14px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-elevated)",
          overflowX: "auto",
        }}
      >
        {sheetNames.map((name) => (
          <button
            key={name}
            onClick={() => setActiveSheet(name)}
            style={{
              padding: "6px 12px",
              fontSize: 12,
              fontFamily: "var(--font-mono)",
              background: activeSheet === name ? "var(--accent)" : "transparent",
              color: activeSheet === name ? "var(--bg)" : "var(--text)",
              border: "1px solid var(--border)",
              borderRadius: 3,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {name}
          </button>
        ))}
      </div>
      {truncated && (
        <div
          style={{
            padding: "6px 14px",
            fontSize: 11,
            color: "var(--text-muted)",
            borderBottom: "1px solid var(--border)",
            background: "var(--bg-elevated)",
          }}
        >
          Showing first {MAX_ROWS.toLocaleString()} of {rowCount.toLocaleString()} rows. Download the file to see the full sheet.
        </div>
      )}
      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: 12,
          fontSize: 12,
          background: "var(--bg)",
        }}
        // The html we inject is produced by SheetJS from the local
        // workbook bytes, not from user input over the wire — safe
        // to render as-is. eslint-disable-next-line lives below.
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: tableHtml }}
      />
    </div>
  );
}

function DrawioPreview({ src }: { src: string }) {
  const [xml, setXml] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(src);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        setXml(await r.text());
      } catch (e) {
        setErr(String(e));
      }
    })();
  }, [src]);

  if (err) return <div className="empty">Failed to load: {err}</div>;
  if (!xml) return <div className="empty">Loading drawio…</div>;

  // Use diagrams.net viewer with the XML passed via postMessage.
  // Simpler approach: use the viewer URL with URL-fragment "#R" + url-encoded XML.
  const encoded = encodeURIComponent(xml);
  const viewerSrc = `https://viewer.diagrams.net/?lightbox=1&edit=_blank&layers=1&nav=1&highlight=0000ff#R${encoded}`;
  return (
    <iframe
      src={viewerSrc}
      title="drawio preview"
      style={{ flex: 1, border: 0, minHeight: 640, background: "#fff" }}
    />
  );
}

function XmlPreview({ src }: { src: string }) {
  const [text, setText] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(src);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        setText(await r.text());
      } catch (e) {
        setErr(String(e));
      }
    })();
  }, [src]);

  if (err) return <div className="empty">Failed to load: {err}</div>;
  if (!text) return <div className="empty">Loading XML…</div>;

  return (
    <pre
      style={{
        flex: 1,
        margin: 0,
        padding: 20,
        background: "var(--bg)",
        color: "var(--text)",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        lineHeight: 1.5,
        overflow: "auto",
        whiteSpace: "pre-wrap",
      }}
    >
      {text.slice(0, 50000)}
      {text.length > 50000 && "\n... (truncated)"}
    </pre>
  );
}

// ---- Source badge: tags each attachment in the list with its origin ----
// "own"        : physically on this page (no badge, cleanest look)
// "descendant" : on a child/grandchild → show "from <child title>"
// "referenced" : reached via an inc-drawio/templateUrl macro → show
//                source page + (if a direct-child page owns the macro)
//                which child the macro is on
function SourceBadge({ a }: { a: Attachment }) {
  if (a.source_kind === "own") return null;
  if (a.source_kind === "descendant") {
    return (
      <div
        style={{
          fontSize: 10,
          marginTop: 4,
          color: "var(--text-dim)",
          fontFamily: "var(--font-mono)",
          display: "flex",
          gap: 6,
          alignItems: "center",
        }}
      >
        <span
          style={{
            padding: "1px 5px",
            background: "rgba(107,166,232,0.12)",
            color: "#6ba6e8",
            borderRadius: "var(--radius-sm)",
            border: "1px solid rgba(107,166,232,0.35)",
            fontWeight: 600,
          }}
        >
          CHILD
        </span>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
          {a.source_page_title || a.source_page_id}
        </span>
      </div>
    );
  }
  // referenced
  return (
    <div
      style={{
        fontSize: 10,
        marginTop: 4,
        color: "var(--text-dim)",
        fontFamily: "var(--font-mono)",
        lineHeight: 1.45,
      }}
    >
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <span
          style={{
            padding: "1px 5px",
            background: "rgba(246,166,35,0.12)",
            color: "var(--accent)",
            borderRadius: "var(--radius-sm)",
            border: "1px solid rgba(246,166,35,0.35)",
            fontWeight: 600,
          }}
          title={`${a.macro_kind} macro`}
        >
          REF
        </span>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
          {a.source_page_title || a.source_page_id}
        </span>
      </div>
      {a.via_page_title && a.via_page_id !== a.source_page_id && (
        <div
          style={{
            marginTop: 2,
            paddingLeft: 2,
            color: "var(--text-dim)",
            fontSize: 9,
          }}
        >
          via {a.via_page_title.slice(0, 40)}
        </div>
      )}
    </div>
  );
}

// ---- Hierarchy tab: parent + current + children tree ----
// Answers two questions at a glance:
//   1. Where is this page in its project tree? (parent breadcrumb)
//   2. What lives underneath it? (children with their drawio counts)
function HierarchyView({
  currentTitle,
  currentDepth,
  parent,
  children,
}: {
  currentTitle: string;
  currentDepth: number | null;
  parent: ParentPage | null;
  children: ChildPage[];
}) {
  return (
    <div className="panel" style={{ padding: 24 }}>
      <div className="panel-title" style={{ marginBottom: 16 }}>
        Page Hierarchy
      </div>

      {/* Parent breadcrumb */}
      {parent && (
        <div style={{ marginBottom: 10, fontSize: 13 }}>
          <div
            style={{
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: 0.6,
              color: "var(--text-dim)",
              marginBottom: 4,
            }}
          >
            Parent
          </div>
          <Link
            href={`/admin/confluence/${parent.page_id}`}
            style={{
              color: "var(--accent)",
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 11 }}>
              d={parent.depth}
            </span>
            {parent.title}
            <span style={{ color: "var(--text-dim)" }}>↗</span>
          </Link>
        </div>
      )}

      {/* Current node */}
      <div
        style={{
          padding: "10px 14px",
          marginTop: parent ? 8 : 0,
          marginBottom: 16,
          background: "var(--surface-hover)",
          borderLeft: "2px solid var(--accent)",
          borderRadius: "var(--radius-md)",
        }}
      >
        <div
          style={{
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: 0.6,
            color: "var(--accent)",
            marginBottom: 4,
          }}
        >
          This page
        </div>
        <div style={{ fontSize: 14, color: "var(--text)" }}>
          <span
            style={{
              color: "var(--text-dim)",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              marginRight: 10,
            }}
          >
            d={currentDepth ?? "?"}
          </span>
          {currentTitle}
        </div>
      </div>

      {/* Children */}
      <div
        style={{
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: 0.6,
          color: "var(--text-dim)",
          marginBottom: 8,
        }}
      >
        Children ({children.length})
      </div>
      {children.length === 0 ? (
        <div className="empty" style={{ padding: "12px 0" }}>
          No child pages under this node.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {children.map((c) => (
            <Link
              key={c.page_id}
              href={`/admin/confluence/${c.page_id}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 14px",
                borderBottom: "1px solid var(--border)",
                color: "var(--text)",
                textDecoration: "none",
                fontSize: 13,
                borderLeft: "2px solid transparent",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--surface-hover)";
                e.currentTarget.style.borderLeftColor = "var(--border-strong)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.borderLeftColor = "transparent";
              }}
            >
              <span
                style={{
                  color: "var(--text-dim)",
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  width: 24,
                  flexShrink: 0,
                }}
              >
                d={c.depth}
              </span>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                {c.title}
              </span>
              <CountChip
                label="att"
                value={c.own_attachments}
                color="var(--text-muted)"
              />
              <CountChip
                label="drawio"
                value={c.own_drawio + c.ref_drawio}
                color={
                  c.own_drawio + c.ref_drawio > 0 ? "var(--accent)" : "var(--text-dim)"
                }
              />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function CountChip({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        gap: 4,
        padding: "2px 8px",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        color,
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-sm)",
        minWidth: 60,
        justifyContent: "flex-end",
      }}
    >
      <span>{value}</span>
      <span style={{ fontSize: 9, color: "var(--text-dim)" }}>{label}</span>
    </span>
  );
}


// ---------------------------------------------------------------------------
// ExtractedView — drawio parser output
//
// Lists every application + interaction that scripts/parse_confluence_drawios.py
// extracted from every drawio attached to this page or any descendant, grouped
// by source drawio file. Apps with A-ids link into the CMDB application detail
// page when available.
// ---------------------------------------------------------------------------
function ExtractedView({
  data,
  imageAttachments,
}: {
  data: ExtractedData | null;
  imageAttachments: Attachment[];
}) {
  if (!data) {
    return (
      <div className="empty" style={{ padding: 40 }}>
        Loading extracted apps…
      </div>
    );
  }
  // If neither drawio extracts nor images exist, show the empty state.
  // If there ARE images (but no drawio), still render so the vision
  // section shows up as a runnable PoC.
  if (
    data.apps.length === 0
    && data.by_attachment.length === 0
    && imageAttachments.length === 0
  ) {
    return (
      <div className="empty" style={{ padding: 40 }}>
        No apps extracted yet from drawios on this page.
        <br />
        <small style={{ color: "var(--text-dim)" }}>
          Run <code>scripts/parse_confluence_drawios.py</code> on 71 and
          reload.
        </small>
      </div>
    );
  }

  // Bucket apps + interactions by source attachment so the UI can show
  // "this file → 20 apps (8 with A-id), 23 interactions".
  const appsByAttachment = new Map<string, ExtractedApp[]>();
  for (const a of data.apps) {
    const list = appsByAttachment.get(a.attachment_id) || [];
    list.push(a);
    appsByAttachment.set(a.attachment_id, list);
  }
  const intersByAttachment = new Map<string, ExtractedInteraction[]>();
  for (const i of data.interactions) {
    const list = intersByAttachment.get(i.attachment_id) || [];
    list.push(i);
    intersByAttachment.set(i.attachment_id, list);
  }

  // Summary totals across all files
  const totalApps = data.apps.length;
  const totalStd = data.apps.filter((a) => a.standard_id).length;
  const totalInters = data.interactions.length;

  const hasDrawio = data.by_attachment.length > 0;

  // Vision persisted data (Phase 2)
  const visionApps = data.vision_apps ?? [];
  const visionInters = data.vision_interactions ?? [];
  const visionByAtt = data.vision_by_attachment ?? [];
  const hasVision = visionByAtt.length > 0;

  const visionAppsByAtt = new Map<string, ExtractedApp[]>();
  for (const a of visionApps) {
    const list = visionAppsByAtt.get(a.attachment_id) || [];
    list.push(a);
    visionAppsByAtt.set(a.attachment_id, list);
  }
  const visionIntersByAtt = new Map<string, ExtractedInteraction[]>();
  for (const i of visionInters) {
    const list = visionIntersByAtt.get(i.attachment_id) || [];
    list.push(i);
    visionIntersByAtt.set(i.attachment_id, list);
  }

  // Images without persisted vision results — show "Run Vision" fallback
  const extractedImageIds = new Set(visionByAtt.map((v) => v.attachment_id));
  const unextractedImages = imageAttachments.filter(
    (a) => !extractedImageIds.has(a.attachment_id)
  );

  return (
    <div>
      {/* Major Applications — shared across drawio + vision sources */}
      {data.major_apps && data.major_apps.length > 0 && (
        <div className="panel" style={{ padding: 0, marginBottom: 16 }}>
          <MajorAppsSection majors={data.major_apps} />
        </div>
      )}

      {/* Drawio section */}
      {hasDrawio && (
        <div className="panel" style={{ padding: 0 }}>
          <div
            className="panel-title"
            style={{
              padding: "18px 18px 12px",
              display: "flex",
              gap: 16,
              alignItems: "baseline",
              justifyContent: "space-between",
              flexWrap: "wrap",
            }}
          >
            <span>Extracted from drawio diagrams</span>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <SummaryChip label="apps" value={totalApps} color="var(--text-muted)" />
              <SummaryChip label="A-id" value={totalStd} color="var(--accent)" />
              <SummaryChip label="edges" value={totalInters} color="var(--text-muted)" />
              <SummaryChip label="files" value={data.by_attachment.length} color="var(--text-muted)" />
            </div>
          </div>

          {data.by_attachment.map((f) => {
            const apps = appsByAttachment.get(f.attachment_id) || [];
            const inters = intersByAttachment.get(f.attachment_id) || [];
            return (
              <ExtractedFileCard key={f.attachment_id} file={f} apps={apps} interactions={inters} />
            );
          })}
        </div>
      )}

      {/* Persisted vision results (Phase 2) */}
      {hasVision && (
        <div className="panel" style={{ padding: 0, marginTop: hasDrawio ? 16 : 0 }}>
          <div
            className="panel-title"
            style={{
              padding: "18px 18px 12px",
              display: "flex",
              gap: 16,
              alignItems: "baseline",
              justifyContent: "space-between",
              flexWrap: "wrap",
            }}
          >
            <span>
              Extracted from images
              <span style={{
                fontSize: 10,
                color: "var(--text-dim)",
                fontFamily: "var(--font-mono)",
                marginLeft: 8,
                textTransform: "uppercase",
              }}>
                AI vision
              </span>
            </span>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <SummaryChip label="apps" value={visionApps.length} color="var(--text-muted)" />
              <SummaryChip label="A-id" value={visionApps.filter((a) => a.standard_id).length} color="var(--accent)" />
              <SummaryChip label="edges" value={visionInters.length} color="var(--text-muted)" />
              <SummaryChip label="files" value={visionByAtt.length} color="var(--text-muted)" />
            </div>
          </div>

          {visionByAtt.map((f) => {
            const apps = visionAppsByAtt.get(f.attachment_id) || [];
            const inters = visionIntersByAtt.get(f.attachment_id) || [];
            return (
              <ExtractedFileCard key={`v-${f.attachment_id}`} file={f} apps={apps} interactions={inters} />
            );
          })}
        </div>
      )}

      {/* Unextracted images: "Run Vision" fallback for images not yet batch-processed */}
      {unextractedImages.length > 0 && (
        <div className="panel" style={{ padding: 0, marginTop: (hasDrawio || hasVision) ? 16 : 0 }}>
          <VisionExtractSection images={unextractedImages} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// VisionExtractSection — Phase 1 PoC for image-vision-extract.
//
// One card per PNG/JPEG attachment on this page. Each card has a
// "Run Vision" button that calls the backend endpoint. Results
// render in-place using the same status-pill and summary-chip
// styles as the drawio cards above, with an AI-EXTRACTED warning
// badge so architects can't confuse the two sources.
//
// Spec: .specify/features/image-vision-extract/spec.md FR-20..FR-26
// ---------------------------------------------------------------------------
function VisionExtractSection({ images }: { images: Attachment[] }) {
  return (
    <div
      style={{
        borderTop: "2px solid var(--border)",
        padding: "16px 18px 12px",
        background: "rgba(107, 166, 232, 0.03)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 12,
          marginBottom: 4,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            color: "var(--text-muted)",
            textTransform: "uppercase",
            letterSpacing: 0.6,
          }}
        >
          From images (vision, PoC)
        </span>
        <span
          style={{
            fontSize: 9,
            fontFamily: "var(--font-mono)",
            color: "#e8b458",
            textTransform: "uppercase",
            letterSpacing: 0.6,
            padding: "1px 5px",
            border: "1px solid #e8b45844",
            borderRadius: "var(--radius-sm)",
          }}
          title="Phase 1 PoC — results are not persisted and not yet in Neo4j"
        >
          ⚠ PoC · not persisted
        </span>
      </div>
      <div
        style={{
          fontSize: 11,
          color: "var(--text-dim)",
          marginBottom: 12,
          lineHeight: 1.5,
        }}
      >
        Click Run Vision on any image below to send it through the
        LLM pipeline and see what applications + interactions it
        extracts. Results are ephemeral — they vanish on reload.
      </div>
      {images.map((img) => (
        <VisionExtractCard key={img.attachment_id} attachment={img} />
      ))}
    </div>
  );
}

function VisionExtractCard({ attachment }: { attachment: Attachment }) {
  const [state, setState] = useState<"idle" | "running" | "success" | "error">("idle");
  const [result, setResult] = useState<VisionExtractResponse | null>(null);
  const [errorCode, setErrorCode] = useState<string>("");
  const [errorDetail, setErrorDetail] = useState<string>("");

  async function runVision() {
    setState("running");
    setResult(null);
    setErrorCode("");
    setErrorDetail("");
    try {
      const resp = await fetch(
        `/api/admin/confluence/attachments/${attachment.attachment_id}/vision-extract`,
        { method: "GET", cache: "no-store" },
      );
      const body = await resp.json().catch(() => null);
      if (!resp.ok) {
        setState("error");
        setErrorCode(body?.error || `http_${resp.status}`);
        setErrorDetail(body?.detail || `HTTP ${resp.status}`);
        return;
      }
      setResult(body as VisionExtractResponse);
      setState("success");
    } catch (e) {
      setState("error");
      setErrorCode("network_error");
      setErrorDetail(String(e));
    }
  }

  const isDerived = attachment.title.startsWith("drawio-backup") || false;

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-sm)",
        padding: "12px 14px",
        marginBottom: 10,
        background: "var(--bg-elevated)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: state === "idle" ? 0 : 10,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 13,
              color: "var(--text)",
              wordBreak: "break-word",
            }}
          >
            {attachment.title}
          </div>
          <div
            style={{
              fontSize: 10,
              color: "var(--text-dim)",
              fontFamily: "var(--font-mono)",
              marginTop: 2,
            }}
          >
            {attachment.media_type} · {humanSize(attachment.file_size)}
          </div>
        </div>
        <button
          onClick={runVision}
          disabled={state === "running" || isDerived}
          style={{
            fontSize: 11,
            padding: "5px 12px",
            fontFamily: "var(--font-mono)",
            background: state === "running" ? "transparent" : "var(--accent)",
            color: state === "running" ? "var(--text-dim)" : "var(--bg)",
            border: state === "running" ? "1px solid var(--border)" : "none",
            borderRadius: "var(--radius-sm)",
            cursor: state === "running" ? "wait" : "pointer",
            whiteSpace: "nowrap",
          }}
        >
          {state === "running"
            ? "Extracting… (up to 60s)"
            : state === "success"
            ? "Re-run"
            : "Run Vision"}
        </button>
      </div>

      {state === "error" && (
        <div
          style={{
            marginTop: 8,
            padding: "8px 10px",
            border: "1px solid #5b1f1f",
            borderRadius: "var(--radius-sm)",
            fontSize: 11,
            color: "var(--text-muted)",
          }}
        >
          <div style={{ fontFamily: "var(--font-mono)", color: "#e8716b" }}>
            {errorCode}
          </div>
          <div style={{ marginTop: 4 }}>{errorDetail}</div>
        </div>
      )}

      {state === "success" && result && (
        <VisionExtractResult result={result} />
      )}
    </div>
  );
}

function VisionExtractResult({ result }: { result: VisionExtractResponse }) {
  const [showRaw, setShowRaw] = useState(false);
  return (
    <div>
      <div
        style={{
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          marginBottom: 10,
          alignItems: "center",
        }}
      >
        <span
          style={{
            fontSize: 9,
            fontFamily: "var(--font-mono)",
            color: "var(--accent)",
            textTransform: "uppercase",
            letterSpacing: 0.6,
            padding: "1px 5px",
            border: "1px solid var(--accent)44",
            borderRadius: "var(--radius-sm)",
          }}
          title="AI-extracted output — review carefully before trusting"
        >
          ⚠ AI-extracted
        </span>
        <span
          style={{
            fontSize: 9,
            fontFamily: "var(--font-mono)",
            color: "var(--text-muted)",
            textTransform: "uppercase",
            letterSpacing: 0.6,
          }}
        >
          {result.diagram_type}
        </span>
        <SummaryChip
          label="apps"
          value={result.applications.length}
          color="var(--text-muted)"
        />
        <SummaryChip
          label="edges"
          value={result.interactions.length}
          color="var(--text-muted)"
        />
        {result.tech_components.length > 0 && (
          <SummaryChip
            label="tech"
            value={result.tech_components.length}
            color="var(--text-muted)"
          />
        )}
        <span
          style={{
            fontSize: 10,
            color: "var(--text-dim)",
            fontFamily: "var(--font-mono)",
            marginLeft: "auto",
          }}
        >
          {result.meta.model} · {result.meta.total_tokens.toLocaleString()} tok ·{" "}
          {(result.meta.wall_ms / 1000).toFixed(1)}s
        </span>
      </div>

      {result.applications.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div
            style={{
              fontSize: 10,
              color: "var(--text-dim)",
              letterSpacing: 0.6,
              textTransform: "uppercase",
              fontFamily: "var(--font-mono)",
              marginBottom: 6,
            }}
          >
            Applications ({result.applications.length})
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr
                style={{
                  fontSize: 10,
                  color: "var(--text-dim)",
                  textTransform: "uppercase",
                  letterSpacing: 0.6,
                  fontFamily: "var(--font-mono)",
                  textAlign: "left",
                }}
              >
                <th style={{ padding: "6px 8px", width: 110 }}>App ID</th>
                <th style={{ padding: "6px 8px" }}>Name</th>
                <th style={{ padding: "6px 8px", width: 80 }}>Status</th>
                <th style={{ padding: "6px 8px" }}>Functions</th>
              </tr>
            </thead>
            <tbody>
              {result.applications.map((a, idx) => (
                <tr
                  key={`${a.app_id}-${idx}`}
                  style={{
                    fontSize: 12,
                    borderTop: "1px solid var(--border)",
                  }}
                >
                  <td
                    style={{
                      padding: "6px 8px",
                      fontFamily: "var(--font-mono)",
                      color: a.id_is_standard
                        ? "var(--accent)"
                        : "var(--text-dim)",
                    }}
                  >
                    {a.id_is_standard ? a.standard_id : "—"}
                  </td>
                  <td style={{ padding: "6px 8px" }}>{a.name || "—"}</td>
                  <td style={{ padding: "6px 8px" }}>
                    <StatusPill status={a.application_status || null} />
                  </td>
                  <td
                    style={{
                      padding: "6px 8px",
                      fontSize: 11,
                      color: "var(--text-muted)",
                    }}
                  >
                    {a.functions.slice(0, 3).join(", ")}
                    {a.functions.length > 3
                      ? ` … +${a.functions.length - 3}`
                      : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {result.interactions.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div
            style={{
              fontSize: 10,
              color: "var(--text-dim)",
              letterSpacing: 0.6,
              textTransform: "uppercase",
              fontFamily: "var(--font-mono)",
              marginBottom: 6,
            }}
          >
            Interactions ({result.interactions.length})
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr
                style={{
                  fontSize: 10,
                  color: "var(--text-dim)",
                  textTransform: "uppercase",
                  letterSpacing: 0.6,
                  fontFamily: "var(--font-mono)",
                  textAlign: "left",
                }}
              >
                <th style={{ padding: "6px 8px" }}>Source → Target</th>
                <th style={{ padding: "6px 8px", width: 90 }}>Type</th>
                <th style={{ padding: "6px 8px", width: 80 }}>Status</th>
                <th style={{ padding: "6px 8px" }}>Business object</th>
              </tr>
            </thead>
            <tbody>
              {result.interactions.map((i, idx) => (
                <tr
                  key={idx}
                  style={{
                    fontSize: 12,
                    borderTop: "1px solid var(--border)",
                  }}
                >
                  <td
                    style={{
                      padding: "6px 8px",
                      fontFamily: "var(--font-mono)",
                      color: "var(--text-muted)",
                    }}
                  >
                    {i.source_app_id} → {i.target_app_id}
                  </td>
                  <td
                    style={{
                      padding: "6px 8px",
                      fontFamily: "var(--font-mono)",
                      color: "var(--text-muted)",
                    }}
                  >
                    {i.interaction_type || "—"}
                  </td>
                  <td style={{ padding: "6px 8px" }}>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                      }}
                      title={
                        i.status_inferred_from_endpoints
                          ? "Inferred from endpoint status, not directly read from the line color"
                          : ""
                      }
                    >
                      <StatusPill status={i.interface_status || null} />
                      {i.status_inferred_from_endpoints && (
                        <span
                          style={{ color: "var(--text-dim)", fontSize: 10 }}
                        >
                          *
                        </span>
                      )}
                    </span>
                  </td>
                  <td
                    style={{
                      padding: "6px 8px",
                      fontSize: 11,
                      color: "var(--text-muted)",
                    }}
                  >
                    {i.business_object || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {result.tech_components.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div
            style={{
              fontSize: 10,
              color: "var(--text-dim)",
              letterSpacing: 0.6,
              textTransform: "uppercase",
              fontFamily: "var(--font-mono)",
              marginBottom: 6,
            }}
          >
            Tech components ({result.tech_components.length})
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr
                style={{
                  fontSize: 10,
                  color: "var(--text-dim)",
                  textTransform: "uppercase",
                  letterSpacing: 0.6,
                  fontFamily: "var(--font-mono)",
                  textAlign: "left",
                }}
              >
                <th style={{ padding: "6px 8px" }}>Name</th>
                <th style={{ padding: "6px 8px", width: 140 }}>Layer</th>
                <th style={{ padding: "6px 8px", width: 100 }}>Deploy</th>
                <th style={{ padding: "6px 8px" }}>Runtime</th>
              </tr>
            </thead>
            <tbody>
              {result.tech_components.map((t, idx) => (
                <tr
                  key={idx}
                  style={{
                    fontSize: 12,
                    borderTop: "1px solid var(--border)",
                  }}
                >
                  <td style={{ padding: "6px 8px" }}>{t.name || "—"}</td>
                  <td
                    style={{
                      padding: "6px 8px",
                      fontFamily: "var(--font-mono)",
                      color: "var(--text-muted)",
                    }}
                  >
                    {t.layer || "—"}
                  </td>
                  <td
                    style={{
                      padding: "6px 8px",
                      fontFamily: "var(--font-mono)",
                      color: "var(--text-muted)",
                    }}
                  >
                    {t.deploy_mode || "—"}
                  </td>
                  <td
                    style={{
                      padding: "6px 8px",
                      fontSize: 11,
                      color: "var(--text-muted)",
                    }}
                  >
                    {t.runtime || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div>
        <button
          onClick={() => setShowRaw((v) => !v)}
          style={{
            fontSize: 10,
            fontFamily: "var(--font-mono)",
            color: "var(--text-dim)",
            background: "transparent",
            border: "none",
            padding: 0,
            cursor: "pointer",
            textDecoration: "underline",
          }}
        >
          {showRaw ? "▾ Hide" : "▸ Show"} raw JSON
        </button>
        {showRaw && (
          <pre
            style={{
              marginTop: 6,
              padding: 10,
              fontSize: 10,
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              overflow: "auto",
              maxHeight: 300,
              fontFamily: "var(--font-mono)",
              color: "var(--text-muted)",
            }}
          >
            {JSON.stringify(result, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}


// ---------------------------------------------------------------------------
// MajorAppsSection — the "what apps is this project actually touching?"
// rollup shown at the top of the Extracted tab. Deliberately simple table
// so the reader's eye lands on it immediately: app_id, name, status pill,
// occurrence count.
// Spec: confluence-major-apps § 2 FR-7
// ---------------------------------------------------------------------------
function MajorAppsSection({ majors }: { majors: ExtractedMajorApp[] }) {
  return (
    <div
      style={{
        borderTop: "1px solid var(--border)",
        padding: "14px 18px 18px",
        // Amber top hairline to visually distinguish this as the "primary"
        // readout vs the per-attachment raw breakdown below
        background: "rgba(246, 166, 35, 0.03)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 10,
          marginBottom: 10,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            letterSpacing: 0.6,
            textTransform: "uppercase",
            color: "var(--accent)",
            fontWeight: 600,
          }}
        >
          Major Applications ({majors.length})
        </span>
        <span
          style={{
            fontSize: 10,
            color: "var(--text-dim)",
          }}
          title="Apps whose drawio cells were marked Change / New / Sunset — i.e. actively in scope for this project."
        >
          (status in Change / New / Sunset)
        </span>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr
            style={{
              fontSize: 10,
              color: "var(--text-dim)",
              textTransform: "uppercase",
              letterSpacing: 0.6,
              fontFamily: "var(--font-mono)",
              textAlign: "left",
            }}
          >
            <th style={{ padding: "6px 8px", width: 100 }}>APP ID</th>
            <th style={{ padding: "6px 8px" }}>Name</th>
            <th style={{ padding: "6px 8px", width: 90 }}>Status</th>
            <th
              style={{ padding: "6px 8px", width: 80, textAlign: "right" }}
              title="How many drawio cells across this page's subtree referenced this app as a major (Change/New/Sunset) app"
            >
              Refs
            </th>
          </tr>
        </thead>
        <tbody>
          {majors.map((m) => {
            const name = m.cmdb_name || m.drawio_name || m.app_id;
            return (
              <tr
                key={m.app_id}
                style={{
                  fontSize: 12,
                  borderTop: "1px solid var(--border)",
                }}
              >
                <td
                  style={{
                    padding: "6px 8px",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  <Link
                    href={`/admin/applications/${encodeURIComponent(
                      m.app_id
                    )}`}
                    style={{
                      color: m.cmdb_name
                        ? "var(--accent)"
                        : "var(--text-muted)",
                      textDecoration: "none",
                    }}
                  >
                    {m.app_id}
                  </Link>
                </td>
                <td
                  style={{
                    padding: "6px 8px",
                    color: "var(--text)",
                    wordBreak: "break-word",
                  }}
                >
                  {name}
                  {m.cmdb_name &&
                    m.drawio_name &&
                    m.cmdb_name.toLowerCase() !==
                      m.drawio_name.toLowerCase() && (
                      <span
                        title="drawio label (pre-reconciliation)"
                        style={{
                          marginLeft: 8,
                          fontSize: 10,
                          color: "var(--text-dim)",
                          fontFamily: "var(--font-mono)",
                        }}
                      >
                        · drawio: {m.drawio_name}
                      </span>
                    )}
                </td>
                <td style={{ padding: "6px 8px" }}>
                  <StatusPill status={m.application_status} />
                </td>
                <td
                  style={{
                    padding: "6px 8px",
                    textAlign: "right",
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    color: "var(--text-muted)",
                  }}
                  title={(m.attachment_titles || []).join("\n")}
                >
                  {m.occurrence_count}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SummaryChip({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        gap: 4,
        padding: "3px 10px",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        color,
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-sm)",
      }}
    >
      <span style={{ fontWeight: 600 }}>{value}</span>
      <span style={{ fontSize: 9, color: "var(--text-dim)" }}>{label}</span>
    </span>
  );
}

const STATUS_COLOR: Record<string, string> = {
  Keep: "#5fc58a",
  Change: "var(--accent)",
  New: "#e8716b",
  Sunset: "#808080",
  "3rd Party": "#6ba6e8",
  Unknown: "var(--text-dim)",
};

function StatusPill({ status }: { status: string | null }) {
  if (!status) return null;
  const color = STATUS_COLOR[status] || "var(--text-dim)";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "1px 6px",
        fontSize: 9,
        fontFamily: "var(--font-mono)",
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: 0.4,
        color,
        background: "rgba(255, 255, 255, 0.03)",
        border: `1px solid ${color}44`,
        borderRadius: "var(--radius-sm)",
      }}
    >
      {status}
    </span>
  );
}

function ExtractedFileCard({
  file,
  apps,
  interactions,
}: {
  file: ExtractedByAttachment;
  apps: ExtractedApp[];
  interactions: ExtractedInteraction[];
}) {
  return (
    <div
      style={{
        borderTop: "1px solid var(--border)",
        padding: "14px 18px 18px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 8,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 13,
              color: "var(--text)",
              wordBreak: "break-word",
            }}
          >
            {file.attachment_title}
          </div>
          <div
            style={{
              fontSize: 10,
              color: "var(--text-dim)",
              fontFamily: "var(--font-mono)",
              marginTop: 2,
            }}
          >
            {file.source_kind === "referenced"
              ? `ref: ${file.source_page_title}`
              : file.source_kind === "descendant"
              ? `from child: ${file.source_page_title}`
              : "this page"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <SummaryChip
            label="apps"
            value={file.app_count}
            color="var(--text-muted)"
          />
          <SummaryChip
            label="A-id"
            value={file.app_with_std_id_count}
            color="var(--accent)"
          />
          <SummaryChip
            label="edges"
            value={file.interaction_count}
            color="var(--text-muted)"
          />
        </div>
      </div>

      {apps.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div
            style={{
              fontSize: 10,
              color: "var(--text-dim)",
              letterSpacing: 0.6,
              textTransform: "uppercase",
              fontFamily: "var(--font-mono)",
              marginBottom: 6,
            }}
          >
            Applications ({apps.length})
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr
                style={{
                  fontSize: 10,
                  color: "var(--text-dim)",
                  textTransform: "uppercase",
                  letterSpacing: 0.6,
                  fontFamily: "var(--font-mono)",
                  textAlign: "left",
                }}
              >
                <th style={{ padding: "6px 8px", width: 100 }}>APP ID</th>
                <th style={{ padding: "6px 8px", width: 110 }}>Match</th>
                <th style={{ padding: "6px 8px" }}>Name</th>
                <th style={{ padding: "6px 8px", width: 90 }}>Status</th>
                <th style={{ padding: "6px 8px" }}>Functions</th>
              </tr>
            </thead>
            <tbody>
              {apps.map((a) => {
                // Display id = the resolved id (post-reconciliation) if
                // present, falling back to the drawio-typed standard_id.
                const displayId = a.resolved_app_id || a.standard_id;
                const wasCorrected =
                  a.match_type === "auto_corrected" ||
                  a.match_type === "auto_corrected_missing_id";
                const linkTargetId = displayId;
                const resolvedName =
                  a.cmdb_name_for_resolved || a.cmdb_name;
                return (
                <tr
                  key={`${a.attachment_id}:${a.cell_id}`}
                  style={{
                    fontSize: 12,
                    borderTop: "1px solid var(--border)",
                  }}
                >
                  {/* APP ID column: resolved id + optional "was <old>" */}
                  <td
                    style={{
                      padding: "6px 8px",
                      fontFamily: "var(--font-mono)",
                      verticalAlign: "top",
                    }}
                  >
                    {displayId ? (
                      <Link
                        href={`/admin/applications/${encodeURIComponent(
                          linkTargetId || ""
                        )}`}
                        style={{
                          color: resolvedName
                            ? "var(--accent)"
                            : "var(--text-muted)",
                          textDecoration: "none",
                        }}
                      >
                        {displayId}
                      </Link>
                    ) : (
                      <span style={{ color: "var(--text-dim)" }}>—</span>
                    )}
                    {wasCorrected && a.standard_id && (
                      <div
                        style={{
                          fontSize: 10,
                          color: "var(--text-dim)",
                          marginTop: 2,
                        }}
                        title={`drawio wrote ${a.standard_id}${
                          a.cmdb_name_for_drawio_id
                            ? ` (${a.cmdb_name_for_drawio_id})`
                            : ""
                        }`}
                      >
                        was {a.standard_id}
                      </div>
                    )}
                  </td>
                  {/* Match type pill */}
                  <td
                    style={{ padding: "6px 8px", verticalAlign: "top" }}
                  >
                    <MatchPill app={a} />
                  </td>
                  <td
                    style={{
                      padding: "6px 8px",
                      color: "var(--text)",
                      wordBreak: "break-word",
                      verticalAlign: "top",
                    }}
                  >
                    {/* Drawio label stays primary. When the resolved id */}
                    {/* disagrees with the drawio id, append the CMDB */}
                    {/* canonical name of the *resolved* target so the */}
                    {/* reviewer can see which app we routed this cell to. */}
                    {a.app_name || resolvedName || "—"}
                    {resolvedName &&
                      a.app_name &&
                      resolvedName.toLowerCase() !==
                        a.app_name.toLowerCase() && (
                        <span
                          title={`CMDB name for ${displayId}`}
                          style={{
                            marginLeft: 8,
                            fontSize: 10,
                            color: "var(--text-dim)",
                            fontFamily: "var(--font-mono)",
                          }}
                        >
                          · CMDB: {resolvedName}
                        </span>
                      )}
                    {a.match_type === "mismatch_unresolved" &&
                      a.cmdb_name_for_drawio_id && (
                        <span
                          title={`drawio said ${a.standard_id} but that's "${a.cmdb_name_for_drawio_id}" in CMDB — no fuzzy match found`}
                          style={{
                            marginLeft: 8,
                            fontSize: 10,
                            color: "#e8716b",
                            fontFamily: "var(--font-mono)",
                          }}
                        >
                          ⚠ drawio id → CMDB: {a.cmdb_name_for_drawio_id}
                        </span>
                      )}
                  </td>
                  <td style={{ padding: "6px 8px" }}>
                    <StatusPill status={a.application_status} />
                  </td>
                  <td
                    style={{
                      padding: "6px 8px",
                      color: "var(--text-dim)",
                      fontSize: 11,
                      wordBreak: "break-word",
                    }}
                  >
                    {a.functions || ""}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {interactions.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div
            style={{
              fontSize: 10,
              color: "var(--text-dim)",
              letterSpacing: 0.6,
              textTransform: "uppercase",
              fontFamily: "var(--font-mono)",
              marginBottom: 6,
            }}
          >
            Interactions ({interactions.length})
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr
                style={{
                  fontSize: 10,
                  color: "var(--text-dim)",
                  textTransform: "uppercase",
                  letterSpacing: 0.6,
                  fontFamily: "var(--font-mono)",
                  textAlign: "left",
                }}
              >
                <th style={{ padding: "6px 8px" }}>From</th>
                <th style={{ padding: "6px 8px", width: 30 }}></th>
                <th style={{ padding: "6px 8px" }}>To</th>
                <th style={{ padding: "6px 8px" }}>Business object / type</th>
                <th style={{ padding: "6px 8px", width: 80 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {interactions.map((i) => {
                // Prefer the CMDB canonical name of the resolved app, fall
                // back to the drawio label, then to the raw A-id as a last
                // resort. Show names in the From/To cells, not raw IDs.
                const fromLabel =
                  i.source_cmdb_name_resolved ||
                  i.source_app_name ||
                  i.source_cmdb_name_orig ||
                  i.source_resolved_id ||
                  i.source_standard_id ||
                  "—";
                const toLabel =
                  i.target_cmdb_name_resolved ||
                  i.target_app_name ||
                  i.target_cmdb_name_orig ||
                  i.target_resolved_id ||
                  i.target_standard_id ||
                  "—";
                const fromId =
                  i.source_resolved_id || i.source_standard_id || null;
                const toId =
                  i.target_resolved_id || i.target_standard_id || null;
                const fromHasCmdb =
                  !!(
                    i.source_cmdb_name_resolved ||
                    i.source_cmdb_name_orig
                  );
                const toHasCmdb =
                  !!(
                    i.target_cmdb_name_resolved ||
                    i.target_cmdb_name_orig
                  );
                const bo =
                  i.business_object || i.interaction_type || "";
                return (
                  <tr
                    key={`${i.attachment_id}:${i.edge_cell_id}`}
                    style={{
                      fontSize: 12,
                      borderTop: "1px solid var(--border)",
                    }}
                  >
                    <td
                      style={{
                        padding: "6px 8px",
                        color: fromHasCmdb
                          ? "var(--text)"
                          : "var(--text-muted)",
                        wordBreak: "break-word",
                      }}
                      title={fromId || ""}
                    >
                      {fromId && fromHasCmdb ? (
                        <Link
                          href={`/admin/applications/${encodeURIComponent(
                            fromId
                          )}`}
                          style={{
                            color: "var(--text)",
                            textDecoration: "none",
                          }}
                        >
                          {fromLabel}
                        </Link>
                      ) : (
                        fromLabel
                      )}
                      {fromId && (
                        <span
                          style={{
                            marginLeft: 6,
                            fontSize: 10,
                            color: "var(--text-dim)",
                            fontFamily: "var(--font-mono)",
                          }}
                        >
                          {fromId}
                        </span>
                      )}
                    </td>
                    <td
                      style={{
                        padding: "6px 8px",
                        color: "var(--text-dim)",
                        textAlign: "center",
                      }}
                    >
                      →
                    </td>
                    <td
                      style={{
                        padding: "6px 8px",
                        color: toHasCmdb
                          ? "var(--text)"
                          : "var(--text-muted)",
                        wordBreak: "break-word",
                      }}
                      title={toId || ""}
                    >
                      {toId && toHasCmdb ? (
                        <Link
                          href={`/admin/applications/${encodeURIComponent(
                            toId
                          )}`}
                          style={{
                            color: "var(--text)",
                            textDecoration: "none",
                          }}
                        >
                          {toLabel}
                        </Link>
                      ) : (
                        toLabel
                      )}
                      {toId && (
                        <span
                          style={{
                            marginLeft: 6,
                            fontSize: 10,
                            color: "var(--text-dim)",
                            fontFamily: "var(--font-mono)",
                          }}
                        >
                          {toId}
                        </span>
                      )}
                    </td>
                    <td
                      style={{
                        padding: "6px 8px",
                        color: "var(--text-dim)",
                        fontSize: 11,
                        wordBreak: "break-word",
                      }}
                    >
                      {bo}
                    </td>
                    <td style={{ padding: "6px 8px" }}>
                      <StatusPill status={i.interaction_status} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}


// ---------------------------------------------------------------------------
// MatchPill — visual tag for the name-id reconciliation result
// Spec: drawio-name-id-reconciliation § FR-5
// ---------------------------------------------------------------------------
const MATCH_STYLES: Record<
  string,
  { label: string; icon: string; color: string; tooltipBase: string }
> = {
  direct: {
    label: "direct",
    icon: "✓",
    color: "#5fc58a",
    tooltipBase: "drawio id and name both agree with CMDB",
  },
  typo_tolerated: {
    label: "typo",
    icon: "≈",
    color: "var(--accent)",
    tooltipBase: "drawio id matches CMDB; name has a small typo but same app",
  },
  auto_corrected: {
    label: "auto-fixed",
    icon: "↻",
    color: "var(--accent)",
    tooltipBase:
      "drawio id pointed to a different CMDB app; the drawio name matched a better candidate — auto-corrected",
  },
  auto_corrected_missing_id: {
    label: "auto-fixed",
    icon: "↻",
    color: "var(--accent)",
    tooltipBase:
      "drawio id was not in CMDB; the drawio name matched a real CMDB app — resolved via name",
  },
  fuzzy_by_name: {
    label: "fuzzy",
    icon: "?",
    color: "var(--accent)",
    tooltipBase:
      "drawio had no A-id at all; resolved via fuzzy match on the name",
  },
  mismatch_unresolved: {
    label: "mismatch",
    icon: "✗",
    color: "#e8716b",
    tooltipBase:
      "drawio id does not match its name in CMDB and no alternate CMDB app matched — needs human review",
  },
  no_cmdb: {
    label: "no cmdb",
    icon: "—",
    color: "var(--text-dim)",
    tooltipBase: "drawio has no A-id and name could not be matched in CMDB",
  },
};

function MatchPill({ app }: { app: ExtractedApp }) {
  const type = app.match_type || "no_cmdb";
  const spec = MATCH_STYLES[type] || MATCH_STYLES["no_cmdb"];
  // Compose a richer tooltip with the similarity number and both ids
  const sim =
    app.name_similarity != null
      ? ` (sim=${app.name_similarity.toFixed(2)})`
      : "";
  const drawioId = app.standard_id || "—";
  const resolvedId = app.resolved_app_id || drawioId;
  const extraContext =
    type === "auto_corrected" || type === "auto_corrected_missing_id"
      ? `\n  drawio wrote: ${drawioId}${
          app.cmdb_name_for_drawio_id
            ? ` (${app.cmdb_name_for_drawio_id})`
            : ""
        }\n  resolved to: ${resolvedId}${
          app.cmdb_name_for_resolved
            ? ` (${app.cmdb_name_for_resolved})`
            : ""
        }`
      : type === "mismatch_unresolved"
      ? `\n  drawio wrote: ${drawioId}${
          app.cmdb_name_for_drawio_id
            ? ` → CMDB: ${app.cmdb_name_for_drawio_id}`
            : ""
        }\n  name "${app.app_name}" did not match anything`
      : "";
  const title = `${spec.tooltipBase}${sim}${extraContext}`;
  const isAutoCorrected =
    type === "auto_corrected" || type === "auto_corrected_missing_id";
  return (
    <span
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 8px",
        fontSize: 10,
        fontFamily: "var(--font-mono)",
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: 0.5,
        color: spec.color,
        background: "rgba(255, 255, 255, 0.03)",
        border: `1px solid ${spec.color}55`,
        borderLeft: isAutoCorrected
          ? `2px solid ${spec.color}`
          : `1px solid ${spec.color}55`,
        borderRadius: "var(--radius-sm)",
        whiteSpace: "nowrap",
      }}
    >
      <span>{spec.icon}</span>
      <span>{spec.label}</span>
    </span>
  );
}
