// AttachmentPreview.tsx — dispatches attachment rendering by file kind
// Includes: PdfBlobPreview, DrawioPreview, XmlPreview,
//           OfficePreview, OfficePdfPreview, OfficeXlsxPreview, SourceBadge
// Split from page.tsx for maintainability.

"use client";

import { useEffect, useState } from "react";
import type { Attachment } from "../types";
import { KIND_LABEL, KIND_COLOR, PREVIEW_CACHE_BUST } from "../constants";
import { humanSize, officeMode } from "../utils";
import { previewHeader, flexColumn } from "../styles";

// ---- Source badge: tags each attachment in the list with its origin ----
export function SourceBadge({ a }: { a: Attachment }) {
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

// Chrome's built-in PDF viewer refuses to render PDFs inside iframes when
// the src is a non-standard port URL. Workaround: fetch as blob, create
// an object URL, and use that as the iframe src.
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

  useEffect(() => {
    setStatus("loading");
    setErrMsg(null);
    const ctrl = new AbortController();
    (async () => {
      try {
        const r = await fetch(previewSrc, { method: "HEAD", signal: ctrl.signal });
        if (!r.ok) {
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
  const [workbook, setWorkbook] = useState<unknown | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [activeSheet, setActiveSheet] = useState<string | null>(null);
  const [tableHtml, setTableHtml] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);
  const [rowCount, setRowCount] = useState<number>(0);
  const [truncated, setTruncated] = useState<boolean>(false);

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
          const cappedRef = xlsxMod.utils.encode_range(capped);
          const wsCopy = { ...ws, "!ref": cappedRef };
          const html = xlsxMod.utils.sheet_to_html(wsCopy, { editable: false });
          setTableHtml(html);
          return;
        }
        setTruncated(false);
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
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: tableHtml }}
      />
    </div>
  );
}

export function AttachmentPreview({ attachment }: { attachment: Attachment }) {
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
    <div style={previewHeader}>
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
      <div style={flexColumn}>
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
      <div style={flexColumn}>
        {header}
        <PdfBlobPreview src={src} title={attachment.title} />
      </div>
    );
  }

  if (attachment.file_kind === "drawio") {
    return (
      <div style={flexColumn}>
        {header}
        <DrawioPreview src={src} />
      </div>
    );
  }

  if (attachment.file_kind === "xml") {
    return (
      <div style={flexColumn}>
        {header}
        <XmlPreview src={src} />
      </div>
    );
  }

  if (attachment.file_kind === "office") {
    return (
      <div style={flexColumn}>
        {header}
        <OfficePreview attachment={attachment} rawSrc={src} />
      </div>
    );
  }

  // Anything else → download fallback
  return (
    <div style={flexColumn}>
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
