"use client";

/**
 * NorthStar Application Architecture viewer.
 *
 * Renders frontend/public/diagrams/northstar-application-architecture.drawio
 * via the same viewer.diagrams.net iframe pattern used by AttachmentPreview's
 * DrawioPreview component (so the rendering path is identical to how
 * Confluence-sourced drawio attachments are displayed elsewhere in the app).
 *
 * The drawio file uses the Lenovo EA Application Solution Diagram Template
 * visual language: yellow=exist, red=new, blue=3rd-party, green=role, with
 * [Event]/[Query]/[Embed]/[Sync] interaction labels on edges.
 */
import { useEffect, useState } from "react";

const DIAGRAM_URL = "/diagrams/northstar-application-architecture.drawio";

export default function ArchitecturePage() {
  const [xml, setXml] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(DIAGRAM_URL);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        setXml(await r.text());
      } catch (e) {
        setErr(String(e));
      }
    })();
  }, []);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "var(--background, #0b0d11)",
        color: "var(--foreground, #e8e8e6)",
        fontFamily: "var(--font-body, system-ui)",
      }}
    >
      <header
        style={{
          padding: "16px 24px",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 16,
        }}
      >
        <div>
          <h1
            style={{
              fontFamily: "var(--font-display, system-ui)",
              fontSize: 18,
              fontWeight: 600,
              letterSpacing: "0.02em",
              margin: 0,
            }}
          >
            NorthStar Application Architecture
          </h1>
          <div
            style={{
              fontSize: 12,
              opacity: 0.6,
              marginTop: 2,
            }}
          >
            Lenovo EA Application Solution Diagram Template — yellow=exist,
            red=new, blue=3rd-party, green=role
          </div>
        </div>
        <a
          href={DIAGRAM_URL}
          download
          style={{
            fontSize: 12,
            color: "#f6a623",
            textDecoration: "none",
            border: "1px solid rgba(246,166,35,0.4)",
            padding: "6px 12px",
            borderRadius: 4,
          }}
        >
          Download .drawio
        </a>
      </header>

      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        {err && (
          <div style={{ padding: 24, color: "#ff6b6b" }}>
            Failed to load diagram: {err}
          </div>
        )}
        {!err && !xml && (
          <div style={{ padding: 24, opacity: 0.6 }}>Loading diagram…</div>
        )}
        {xml && (
          <iframe
            src={`https://viewer.diagrams.net/?lightbox=1&edit=_blank&layers=1&nav=1&highlight=0000ff#R${encodeURIComponent(
              xml,
            )}`}
            title="NorthStar Architecture"
            style={{
              flex: 1,
              border: 0,
              minHeight: "calc(100vh - 80px)",
              background: "#fff",
            }}
          />
        )}
      </div>
    </main>
  );
}
