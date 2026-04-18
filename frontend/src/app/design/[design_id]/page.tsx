"use client";

/**
 * /design/[design_id] — architecture design editor.
 *
 * Loads the design's drawio XML and embeds the draw.io editor via iframe.
 * Communication via postMessage protocol (embed mode).
 */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";

interface DesignDetail {
  design: {
    design_id: number;
    name: string;
    description: string | null;
    fiscal_year: string | null;
    project_id: string | null;
    template_attachment_id: number | null;
    owner_itcode: string | null;
    status: string;
    has_as_is: boolean;
    has_current: boolean;
    created_at: string;
    updated_at: string;
  };
  apps: Array<{
    app_id: string;
    role: string;
    planned_status: string;
    bc_id: string | null;
    name: string | null;
    cmdb_status: string | null;
  }>;
  interfaces: Array<{
    design_iface_id: number;
    interface_id: number | null;
    from_app: string;
    to_app: string;
    platform: string | null;
    interface_name: string | null;
    planned_status: string;
  }>;
}

const DRAWIO_EMBED_URL =
  "https://embed.diagrams.net/?embed=1&ui=atlas&spin=1&proto=json&saveAndExit=0&noSaveBtn=0&noExitBtn=1&modified=unsavedChanges";

export default function DesignEditorPage() {
  const params = useParams();
  const design_id = params.design_id as string;
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [data, setData] = useState<DesignDetail | null>(null);
  const [drawioXml, setDrawioXml] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [editorReady, setEditorReady] = useState(false);

  // Load design metadata + current drawio XML
  useEffect(() => {
    (async () => {
      try {
        const [dRes, xRes] = await Promise.all([
          fetch(`/api/design/${design_id}`, { cache: "no-store" }),
          fetch(`/api/design/${design_id}/drawio`, { cache: "no-store" }),
        ]);
        const dJ = await dRes.json();
        if (!dJ.success) throw new Error(dJ.error || "Failed to load design");
        const xml = await xRes.text();
        setData(dJ.data);
        setDrawioXml(xml);
      } catch (e) {
        setErr(String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [design_id]);

  // postMessage handler from draw.io embed
  useEffect(() => {
    const handler = (ev: MessageEvent) => {
      // Accept only from diagrams.net
      if (!ev.origin.includes("diagrams.net")) return;
      let msg: { event?: string; xml?: string };
      try {
        msg = typeof ev.data === "string" ? JSON.parse(ev.data) : ev.data;
      } catch { return; }
      if (!msg || typeof msg !== "object" || !msg.event) return;

      const ifr = iframeRef.current;
      if (!ifr || !ifr.contentWindow) return;

      switch (msg.event) {
        case "init":
          // Editor is ready; send our XML to load
          setEditorReady(true);
          ifr.contentWindow.postMessage(
            JSON.stringify({ action: "load", autosave: 1, xml: drawioXml || " " }),
            "*"
          );
          break;
        case "save":
          // Manual save or Ctrl+S
          if (msg.xml) saveDrawio(msg.xml);
          break;
        case "autosave":
          if (msg.xml) saveDrawio(msg.xml);
          break;
        case "exit":
          // Architect hit exit; no-op (we keep them on our page)
          break;
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawioXml]);

  const saveDrawio = async (xml: string) => {
    setSaveStatus("saving");
    try {
      const r = await fetch(`/api/design/${design_id}/drawio`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ drawio_xml: xml }),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.error);
      setDrawioXml(xml);
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 1500);
    } catch (e) {
      setErr(String(e));
      setSaveStatus("error");
    }
  };

  const regenerate = async () => {
    if (!confirm("Regenerate AS-IS from live PG data? This will overwrite your current canvas edits.")) return;
    try {
      const r = await fetch(`/api/design/${design_id}/regenerate`, { method: "POST" });
      const j = await r.json();
      if (!j.success) throw new Error(j.error);
      // Reload fresh XML
      const xRes = await fetch(`/api/design/${design_id}/drawio`, { cache: "no-store" });
      const xml = await xRes.text();
      setDrawioXml(xml);
      // Tell editor to load fresh
      iframeRef.current?.contentWindow?.postMessage(
        JSON.stringify({ action: "load", autosave: 1, xml }),
        "*"
      );
    } catch (e) {
      setErr(String(e));
    }
  };

  const exportDrawio = () => {
    const blob = new Blob([drawioXml], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `design-${design_id}-${(data?.design.name || "untitled").replace(/\s+/g, "_")}.drawio`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <div style={{ padding: 40, color: "var(--text-dim)" }}>Loading design…</div>;
  if (err && !data) return <div className="panel" style={{ borderColor: "#5b1f1f", margin: 20 }}>Error: {err}</div>;
  if (!data) return null;

  const { design, apps, interfaces } = data;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 0, height: "calc(100vh - 80px)" }}>
      {/* ── Main canvas area ── */}
      <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: "10px 16px", borderBottom: "1px solid var(--border)",
          background: "var(--surface)",
        }}>
          <Link href="/design" style={{ color: "var(--text-dim)", fontSize: 12, textDecoration: "none" }}>
            ← Designs
          </Link>
          <h2 style={{ margin: 0, fontSize: 16 }}>{design.name}</h2>
          <span className="status-pill" style={{
            fontSize: 10, padding: "2px 8px",
            background: "var(--surface-hover)", color: "var(--text-muted)",
          }}>
            {design.status}
          </span>
          <div style={{ flex: 1 }} />
          <span style={{
            fontSize: 11, fontFamily: "var(--font-mono)",
            color: saveStatus === "saved" ? "var(--accent)" :
                   saveStatus === "saving" ? "var(--text-muted)" :
                   saveStatus === "error" ? "#e8716b" : "var(--text-dim)",
          }}>
            {saveStatus === "saved" && "✓ saved"}
            {saveStatus === "saving" && "saving…"}
            {saveStatus === "error" && "save failed"}
            {saveStatus === "idle" && "auto-save on"}
          </span>
          <button onClick={regenerate} className="btn-secondary" style={{ fontSize: 11 }}>
            ↻ Regenerate AS-IS
          </button>
          <button onClick={exportDrawio} className="btn-secondary" style={{ fontSize: 11 }}>
            Export .drawio
          </button>
        </div>

        {/* draw.io iframe */}
        <div style={{ flex: 1, background: "#1b1d25", position: "relative" }}>
          <iframe
            ref={iframeRef}
            src={DRAWIO_EMBED_URL}
            style={{ width: "100%", height: "100%", border: 0 }}
            title="Architecture design canvas"
          />
          {!editorReady && (
            <div style={{
              position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
              color: "var(--text-dim)", fontSize: 13,
            }}>
              Loading draw.io editor…
            </div>
          )}
        </div>
      </div>

      {/* ── Sidebar ── */}
      <div style={{
        borderLeft: "1px solid var(--border)",
        background: "var(--bg-elevated)",
        overflowY: "auto",
      }}>
        <div style={{ padding: 14, borderBottom: "1px solid var(--border)" }}>
          <h3 style={{ margin: "0 0 8px", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.6 }}>
            Metadata
          </h3>
          <dl style={{ display: "grid", gridTemplateColumns: "80px 1fr", gap: "4px 8px", fontSize: 11, margin: 0 }}>
            <dt style={{ color: "var(--text-dim)" }}>ID</dt>
            <dd style={{ margin: 0, fontFamily: "var(--font-mono)" }}>#{design.design_id}</dd>
            {design.fiscal_year && (
              <>
                <dt style={{ color: "var(--text-dim)" }}>FY</dt>
                <dd style={{ margin: 0, fontFamily: "var(--font-mono)" }}>{design.fiscal_year}</dd>
              </>
            )}
            {design.project_id && (
              <>
                <dt style={{ color: "var(--text-dim)" }}>Project</dt>
                <dd style={{ margin: 0 }}>
                  <Link href={`/projects/${encodeURIComponent(design.project_id)}`} style={{ color: "var(--accent)", fontFamily: "var(--font-mono)" }}>
                    {design.project_id}
                  </Link>
                </dd>
              </>
            )}
            <dt style={{ color: "var(--text-dim)" }}>Created</dt>
            <dd style={{ margin: 0, fontFamily: "var(--font-mono)", color: "var(--text-dim)" }}>
              {new Date(design.created_at).toISOString().slice(0, 10)}
            </dd>
          </dl>
          {design.description && (
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 10 }}>
              {design.description}
            </p>
          )}
        </div>

        <div style={{ padding: 14, borderBottom: "1px solid var(--border)" }}>
          <h3 style={{ margin: "0 0 8px", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.6 }}>
            Apps in scope ({apps.length})
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {apps.map(a => (
              <Link key={a.app_id} href={`/apps/${encodeURIComponent(a.app_id)}`}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "3px 4px", fontSize: 11, textDecoration: "none",
                  color: "var(--text)",
                }}>
                <code style={{ color: "var(--accent)", fontFamily: "var(--font-mono)", minWidth: 70 }}>
                  {a.app_id}
                </code>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {a.name || a.app_id}
                </span>
                <span style={{ fontSize: 9, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
                  {a.role[0].toUpperCase()}
                </span>
              </Link>
            ))}
          </div>
        </div>

        <div style={{ padding: 14 }}>
          <h3 style={{ margin: "0 0 8px", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.6 }}>
            Interfaces ({interfaces.length})
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {interfaces.slice(0, 30).map(i => (
              <div key={i.design_iface_id} style={{ fontSize: 11, color: "var(--text-muted)" }}>
                <span style={{ fontSize: 9, color: "var(--text-dim)", fontFamily: "var(--font-mono)", marginRight: 4 }}>
                  [{i.platform}]
                </span>
                <span style={{ fontFamily: "var(--font-mono)" }}>
                  {(i.interface_name || "(unnamed)").slice(0, 26)}
                </span>
              </div>
            ))}
            {interfaces.length > 30 && (
              <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 4 }}>
                +{interfaces.length - 30} more
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
