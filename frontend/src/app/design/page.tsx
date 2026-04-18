"use client";

/**
 * /design — list of architecture design sessions.
 */
import Link from "next/link";
import { useEffect, useState } from "react";

interface DesignRow {
  design_id: number;
  name: string;
  description: string | null;
  fiscal_year: string | null;
  project_id: string | null;
  template_attachment_id: number | null;
  owner_itcode: string | null;
  status: string;
  app_count: number;
  iface_count: number;
  created_at: string;
  updated_at: string;
}

const STATUS_COLORS: Record<string, string> = {
  draft: "#e8b458",
  in_review: "#6ba6e8",
  approved: "#5fc58a",
  archived: "#6b7488",
};

export default function DesignListPage() {
  const [rows, setRows] = useState<DesignRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/design", { cache: "no-store" });
        const j = await r.json();
        if (!j.success) throw new Error(j.error);
        setRows(j.data.rows || []);
      } catch (e) {
        setErr(String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
        <h1 style={{ margin: 0 }}>Design</h1>
        <div style={{ flex: 1 }} />
        <Link
          href="/design/new"
          style={{
            background: "var(--accent)",
            color: "#07090d",
            padding: "7px 14px",
            borderRadius: "var(--radius-md)",
            fontSize: 12,
            fontFamily: "var(--font-mono)",
            textDecoration: "none",
            fontWeight: 600,
          }}
        >
          + New Design
        </Link>
      </div>
      <p className="subtitle">
        Design new architectures by bootstrapping from CMDB + integration catalog.
        Pick a template, pick applications (by name or business capability),
        pick interfaces, and get an editable as-is drawio canvas.
      </p>

      {err && <div className="panel" style={{ borderColor: "#5b1f1f" }}>Error: {err}</div>}
      {loading && <div style={{ color: "var(--text-dim)", padding: 20 }}>Loading…</div>}

      {!loading && rows.length === 0 && (
        <div className="panel" style={{ padding: 40, textAlign: "center", color: "var(--text-dim)" }}>
          No designs yet. <Link href="/design/new" style={{ color: "var(--accent)" }}>Create your first one</Link>.
        </div>
      )}

      {rows.length > 0 && (
        <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: 60 }}>ID</th>
                <th>Name</th>
                <th style={{ width: 100 }}>Status</th>
                <th style={{ width: 90 }}>FY</th>
                <th style={{ width: 100 }}>Project</th>
                <th style={{ width: 70, textAlign: "right" }}>Apps</th>
                <th style={{ width: 80, textAlign: "right" }}>Ifaces</th>
                <th style={{ width: 140 }}>Updated</th>
                <th style={{ width: 110 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.design_id}>
                  <td>
                    <Link href={`/design/${r.design_id}`} style={{ color: "var(--accent)", fontFamily: "var(--font-mono)" }}>
                      #{r.design_id}
                    </Link>
                  </td>
                  <td>
                    <Link href={`/design/${r.design_id}`} style={{ color: "var(--text)", textDecoration: "none" }}>
                      <div style={{ fontWeight: 500 }}>{r.name}</div>
                      {r.description && (
                        <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2 }}>
                          {r.description.length > 80 ? r.description.slice(0, 78) + "…" : r.description}
                        </div>
                      )}
                    </Link>
                  </td>
                  <td>
                    <span className="status-pill" style={{
                      color: STATUS_COLORS[r.status] || "var(--text-muted)",
                      background: `${STATUS_COLORS[r.status] || "#5f6a80"}26`,
                    }}>
                      {r.status}
                    </span>
                  </td>
                  <td style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" }}>
                    {r.fiscal_year || "—"}
                  </td>
                  <td style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
                    {r.project_id ? (
                      <Link href={`/projects/${encodeURIComponent(r.project_id)}`} style={{ color: "var(--accent)" }}>
                        {r.project_id}
                      </Link>
                    ) : (
                      <span style={{ color: "var(--text-dim)" }}>—</span>
                    )}
                  </td>
                  <td style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{r.app_count}</td>
                  <td style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{r.iface_count}</td>
                  <td style={{ fontSize: 11, color: "var(--text-dim)" }}>
                    {r.updated_at ? new Date(r.updated_at).toISOString().slice(0, 16).replace("T", " ") : "—"}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <button
                      title="Download as .drawio"
                      onClick={async (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        try {
                          const res = await fetch(`/api/design/${r.design_id}/drawio`, { cache: "no-store" });
                          const xml = await res.text();
                          const blob = new Blob([xml], { type: "application/xml" });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = `design-${r.design_id}-${(r.name || "untitled").replace(/[^\w]+/g, "_")}.drawio`;
                          a.click();
                          URL.revokeObjectURL(url);
                        } catch (e) {
                          alert("Download failed: " + e);
                        }
                      }}
                      style={{
                        background: "transparent",
                        border: "1px solid var(--border)",
                        color: "var(--accent)",
                        padding: "3px 8px",
                        fontSize: 10,
                        fontFamily: "var(--font-mono)",
                        cursor: "pointer",
                        borderRadius: 3,
                        marginRight: 4,
                      }}
                    >
                      ↓ .drawio
                    </button>
                    <button
                      title="Delete design"
                      onClick={async (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (!confirm(`Delete design "${r.name}"? This can't be undone.`)) return;
                        try {
                          const res = await fetch(`/api/design/${r.design_id}`, { method: "DELETE" });
                          const j = await res.json();
                          if (!j.success) throw new Error(j.error);
                          setRows(prev => prev.filter(x => x.design_id !== r.design_id));
                        } catch (e) {
                          alert("Delete failed: " + e);
                        }
                      }}
                      style={{
                        background: "transparent",
                        border: "1px solid var(--border)",
                        color: "#e8716b",
                        padding: "3px 8px",
                        fontSize: 10,
                        fontFamily: "var(--font-mono)",
                        cursor: "pointer",
                        borderRadius: 3,
                      }}
                    >
                      ✕ delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
