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
  has_body: boolean;
  body_size_chars: number | null;
  questionnaire: Questionnaire | null;
  q_project_id: string | null;
  q_project_name: string | null;
  q_pm: string | null;
  q_it_lead: string | null;
  q_dt_lead: string | null;
}

interface Attachment {
  attachment_id: string;
  title: string;
  media_type: string;
  file_kind: string; // drawio|image|pdf|office|xml|other
  file_size: number | null;
  version: number | null;
  download_path: string;
  local_path: string | null;
}

interface Detail {
  page: Page;
  attachments: Attachment[];
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

type Tab = "attachments" | "questionnaire" | "raw";

export default function ConfluencePageDetail() {
  const params = useParams();
  const pageId = params.page_id as string;
  const [detail, setDetail] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<Attachment | null>(null);
  const [tab, setTab] = useState<Tab>("attachments");

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`/api/admin/confluence/pages/${pageId}`, { cache: "no-store" });
        const j = await r.json();
        if (!j.success) throw new Error(j.error);
        setDetail(j.data);
        // auto-select first previewable
        const first = j.data.attachments.find(
          (a: Attachment) =>
            a.local_path && ["drawio", "image", "pdf"].includes(a.file_kind)
        );
        if (first) setSelected(first);
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
            {detail.page.q_pm && <KV label="PM">{detail.page.q_pm}</KV>}
            {detail.page.q_it_lead && <KV label="IT Lead">{detail.page.q_it_lead}</KV>}
            {detail.page.q_dt_lead && <KV label="DT Lead">{detail.page.q_dt_lead}</KV>}
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
