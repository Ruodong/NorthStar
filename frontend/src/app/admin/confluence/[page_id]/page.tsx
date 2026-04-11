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
  source_kind: "own" | "descendant";
  cell_id: string;
  app_name: string;
  standard_id: string | null;
  id_is_standard: boolean;
  application_status: string | null;
  functions: string | null;
  fill_color: string | null;
  cmdb_name: string | null;
}

interface ExtractedInteraction {
  attachment_id: string;
  attachment_title: string;
  source_page_id: string;
  source_page_title: string;
  source_kind: "own" | "descendant";
  edge_cell_id: string;
  source_cell_id: string | null;
  target_cell_id: string | null;
  interaction_type: string | null;
  direction: string | null;
  interaction_status: string | null;
  business_object: string | null;
  source_app_name: string | null;
  source_standard_id: string | null;
  target_app_name: string | null;
  target_standard_id: string | null;
}

interface ExtractedByAttachment {
  attachment_id: string;
  attachment_title: string;
  source_page_title: string;
  source_kind: "own" | "descendant";
  app_count: number;
  app_with_std_id_count: number;
  interaction_count: number;
}

interface ExtractedData {
  apps: ExtractedApp[];
  interactions: ExtractedInteraction[];
  by_attachment: ExtractedByAttachment[];
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
  const [tab, setTab] = useState<Tab>("attachments");

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
          disabled={!extracted || extracted.apps.length === 0}
        >
          Extracted <Chip>{extracted?.apps.length ?? 0}</Chip>
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

      {tab === "extracted" && <ExtractedView data={extracted} />}

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
        <iframe
          src={src}
          title={attachment.title}
          style={{ flex: 1, border: 0, minHeight: 640 }}
        />
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

  // office / other → cannot preview inline
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
function ExtractedView({ data }: { data: ExtractedData | null }) {
  if (!data) {
    return (
      <div className="empty" style={{ padding: 40 }}>
        Loading extracted apps…
      </div>
    );
  }
  if (data.apps.length === 0 && data.by_attachment.length === 0) {
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

  return (
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
          <SummaryChip
            label="apps"
            value={totalApps}
            color="var(--text-muted)"
          />
          <SummaryChip label="A-id" value={totalStd} color="var(--accent)" />
          <SummaryChip
            label="edges"
            value={totalInters}
            color="var(--text-muted)"
          />
          <SummaryChip
            label="files"
            value={data.by_attachment.length}
            color="var(--text-muted)"
          />
        </div>
      </div>

      {data.by_attachment.map((f) => {
        const apps = appsByAttachment.get(f.attachment_id) || [];
        const inters = intersByAttachment.get(f.attachment_id) || [];
        return (
          <ExtractedFileCard
            key={f.attachment_id}
            file={f}
            apps={apps}
            interactions={inters}
          />
        );
      })}
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
            {file.source_kind === "descendant"
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
                <th style={{ padding: "6px 8px", width: 80 }}>APP ID</th>
                <th style={{ padding: "6px 8px" }}>Name</th>
                <th style={{ padding: "6px 8px", width: 90 }}>Status</th>
                <th style={{ padding: "6px 8px" }}>Functions</th>
              </tr>
            </thead>
            <tbody>
              {apps.map((a) => (
                <tr
                  key={`${a.attachment_id}:${a.cell_id}`}
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
                    {a.standard_id ? (
                      <Link
                        href={`/admin/applications/${encodeURIComponent(
                          a.standard_id
                        )}`}
                        style={{
                          color: a.cmdb_name
                            ? "var(--accent)"
                            : "var(--text-muted)",
                          textDecoration: "none",
                        }}
                      >
                        {a.standard_id}
                      </Link>
                    ) : (
                      <span style={{ color: "var(--text-dim)" }}>—</span>
                    )}
                  </td>
                  <td
                    style={{
                      padding: "6px 8px",
                      color: "var(--text)",
                      wordBreak: "break-word",
                    }}
                  >
                    {a.cmdb_name || a.app_name || "—"}
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
              ))}
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
                const fromLabel =
                  i.source_standard_id || i.source_app_name || "—";
                const toLabel =
                  i.target_standard_id || i.target_app_name || "—";
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
                        fontFamily: "var(--font-mono)",
                        color: i.source_standard_id
                          ? "var(--accent)"
                          : "var(--text-muted)",
                        wordBreak: "break-word",
                      }}
                    >
                      {fromLabel}
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
                        fontFamily: "var(--font-mono)",
                        color: i.target_standard_id
                          ? "var(--accent)"
                          : "var(--text-muted)",
                        wordBreak: "break-word",
                      }}
                    >
                      {toLabel}
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
