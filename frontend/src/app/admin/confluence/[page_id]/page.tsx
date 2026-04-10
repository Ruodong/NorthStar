"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

interface Page {
  page_id: string;
  fiscal_year: string;
  title: string;
  project_id: string | null;
  page_url: string;
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

export default function ConfluencePageDetail() {
  const params = useParams();
  const pageId = params.page_id as string;
  const [detail, setDetail] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<Attachment | null>(null);

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
          marginBottom: 24,
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
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: 16 }}>
        {/* Attachment list */}
        <div className="panel" style={{ padding: 0, overflow: "hidden", maxHeight: 720, overflowY: "auto" }}>
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
