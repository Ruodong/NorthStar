"use client";

/**
 * Settings — /settings
 *
 * Tabbed layout. First tab is Architecture Templates (Phase 1): three
 * cards (Business / Application / Technical) for maintaining the
 * Confluence URL of each EA architecture template directory page, plus
 * a grid preview of drawio diagrams under each URL's subtree.
 *
 * Other tabs are placeholders so we can extend settings without
 * restructuring the page shell each time.
 *
 * See .specify/features/architecture-template-settings/spec.md.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  type ArchitectureTemplateDiagram,
  type ArchitectureTemplateSource,
} from "@/lib/api";

type Layer = "business" | "application" | "technical";

const LAYER_LABELS: Record<Layer, { code: string; name: string }> = {
  business:    { code: "BA", name: "Business Architecture" },
  application: { code: "AA", name: "Application Architecture" },
  technical:   { code: "TA", name: "Technical Architecture" },
};

const ORDER: Layer[] = ["business", "application", "technical"];

type TabId = "templates" | "general";
const TABS: { id: TabId; label: string }[] = [
  { id: "templates", label: "Architecture Templates" },
  { id: "general",   label: "General" },
];

export default function SettingsPage() {
  const [active, setActive] = useState<TabId>("templates");

  return (
    <div style={{ maxWidth: 1080 }}>
      <h1 style={{ marginBottom: 16 }}>Settings</h1>
      <TabBar active={active} onChange={setActive} />
      <div style={{ marginTop: 24 }}>
        {active === "templates" && <ArchitectureTemplatesPanel />}
        {active === "general" && <GeneralPanel />}
      </div>
    </div>
  );
}

// ── Tab bar ─────────────────────────────────────────────────────

function TabBar({
  active,
  onChange,
}: {
  active: TabId;
  onChange: (id: TabId) => void;
}) {
  return (
    <div
      role="tablist"
      style={{
        display: "flex",
        gap: 0,
        borderBottom: "1px solid var(--border)",
      }}
    >
      {TABS.map((t) => {
        const isActive = t.id === active;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={isActive}
            type="button"
            onClick={() => onChange(t.id)}
            style={{
              padding: "10px 18px",
              background: "transparent",
              border: "none",
              borderBottom: `2px solid ${isActive ? "var(--accent)" : "transparent"}`,
              marginBottom: -1,
              color: isActive ? "var(--text)" : "var(--text-muted)",
              fontFamily: "var(--font-display)",
              fontSize: 13,
              fontWeight: isActive ? 600 : 500,
              cursor: "pointer",
              transition: "color 120ms, border-color 120ms",
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Architecture Templates panel ────────────────────────────────

function ArchitectureTemplatesPanel() {
  const [rows, setRows] = useState<ArchitectureTemplateSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const data = await api.listArchitectureTemplates();
      setRows(data);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  // Auto-refresh while any row is syncing
  useEffect(() => {
    const anySyncing = rows.some((r) => r.last_sync_status === "syncing");
    if (!anySyncing) return;
    const t = setInterval(reload, 3000);
    return () => clearInterval(t);
  }, [rows, reload]);

  const sorted = useMemo(
    () => ORDER.map((layer) => rows.find((r) => r.layer === layer)).filter(Boolean) as ArchitectureTemplateSource[],
    [rows],
  );

  return (
    <div>
      <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 0, marginBottom: 24, maxWidth: 720 }}>
        Configure the Confluence page that holds the EA architecture templates for each layer.
        NorthStar will walk the page subtree, cache any drawio diagrams, and render them below.
      </p>

      {loading && (
        <div style={{ color: "var(--text-dim)", fontSize: 13, padding: 24 }}>Loading…</div>
      )}
      {err && (
        <div style={{ color: "var(--error)", fontSize: 13, padding: 16, border: "1px solid var(--error)", borderRadius: "var(--radius-md)", marginBottom: 16 }}>
          Failed to load: {err}
        </div>
      )}

      <div style={{ display: "grid", gap: 20 }}>
        {sorted.map((row) => (
          <LayerCard key={row.layer} row={row} onChange={reload} />
        ))}
      </div>
    </div>
  );
}

// ── General panel (placeholder) ─────────────────────────────────

function GeneralPanel() {
  return (
    <div
      style={{
        background: "var(--bg-elevated)",
        border: "1px dashed var(--border)",
        borderRadius: "var(--radius-md)",
        padding: "48px 24px",
        color: "var(--text-dim)",
        fontSize: 13,
        textAlign: "center",
      }}
    >
      No general settings yet.
    </div>
  );
}

// ── Layer Card ──────────────────────────────────────────────────

function LayerCard({
  row,
  onChange,
}: {
  row: ArchitectureTemplateSource;
  onChange: () => void | Promise<void>;
}) {
  const layer = row.layer as Layer;
  const meta = LAYER_LABELS[layer];

  const [title, setTitle] = useState(row.title);
  const [url, setUrl] = useState(row.confluence_url);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [diagrams, setDiagrams] = useState<ArchitectureTemplateDiagram[] | null>(null);
  const [diagramsLoading, setDiagramsLoading] = useState(false);
  const [localErr, setLocalErr] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  // Keep form in sync with server values when they change under us (e.g. after sync)
  useEffect(() => { setTitle(row.title); }, [row.title]);
  useEffect(() => { setUrl(row.confluence_url); }, [row.confluence_url]);

  const loadDiagrams = useCallback(async () => {
    if (!row.diagram_count) {
      setDiagrams([]);
      return;
    }
    setDiagramsLoading(true);
    try {
      const list = await api.listArchitectureTemplateDiagrams(layer, { limit: 60 });
      setDiagrams(list.items);
    } catch {
      setDiagrams([]);
    } finally {
      setDiagramsLoading(false);
    }
  }, [layer, row.diagram_count]);

  useEffect(() => { loadDiagrams(); }, [loadDiagrams]);

  const isDirty = title !== row.title || url !== row.confluence_url;
  const hasUrl = url.trim().length > 0;
  const lastSyncStatus = row.last_sync_status;

  const save = async () => {
    setSaving(true);
    setLocalErr(null);
    try {
      await api.updateArchitectureTemplate(layer, { title, confluence_url: url });
      await onChange();
    } catch (e) {
      setLocalErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const syncNow = async () => {
    setSyncing(true);
    setLocalErr(null);
    try {
      await api.syncArchitectureTemplate(layer);
      await onChange();
    } catch (e) {
      setLocalErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  };

  const statusLine = (() => {
    if (lastSyncStatus === "syncing") return "Syncing…";
    if (lastSyncStatus === "error") return `Error: ${row.last_sync_error || "sync failed"}`;
    if (lastSyncStatus === "ok" && row.last_synced_at) {
      return `Last synced ${new Date(row.last_synced_at).toLocaleString()}`;
    }
    return "Never synced";
  })();

  const statusColor = lastSyncStatus === "error" ? "var(--error)"
    : lastSyncStatus === "syncing" ? "var(--warning)"
    : lastSyncStatus === "ok" ? "var(--success)"
    : "var(--text-dim)";

  return (
    <section
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        padding: 20,
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <span
          style={{
            display: "inline-block",
            padding: "3px 8px",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            fontWeight: 600,
            color: "var(--accent)",
            background: "rgba(246,166,35,0.12)",
            border: "1px solid rgba(246,166,35,0.3)",
            borderRadius: "var(--radius-sm)",
          }}
        >
          {meta.code}
        </span>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, fontFamily: "var(--font-display)" }}>
          {meta.name}
        </h3>
        <span style={{ marginLeft: "auto", fontSize: 11, color: statusColor }}>
          {statusLine}
        </span>
      </div>

      {/* Form */}
      <div style={{ display: "grid", gap: 10, marginBottom: 12 }}>
        <label style={{ display: "grid", gap: 4 }}>
          <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Title
          </span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. AA Document Templates"
            style={inputStyle}
          />
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Confluence URL
          </span>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://km.xpaas.lenovo.com/display/EA/..."
            style={{ ...inputStyle, fontFamily: "var(--font-mono)", fontSize: 12 }}
          />
        </label>
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16 }}>
        <button
          type="button"
          onClick={save}
          disabled={!isDirty || saving}
          style={primaryButtonStyle(!isDirty || saving)}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={syncNow}
          disabled={!hasUrl || syncing || lastSyncStatus === "syncing"}
          style={secondaryButtonStyle(!hasUrl || syncing || lastSyncStatus === "syncing")}
        >
          {syncing || lastSyncStatus === "syncing" ? "Syncing…" : "Sync Now"}
        </button>
        <span style={{ fontSize: 11, color: "var(--text-dim)", marginLeft: "auto" }}>
          {row.diagram_count} diagram{row.diagram_count === 1 ? "" : "s"}
        </span>
      </div>

      {localErr && (
        <div style={{ color: "var(--error)", fontSize: 12, marginBottom: 12 }}>
          {localErr}
        </div>
      )}

      {/* Diagrams grid */}
      {!hasUrl ? (
        <div style={emptyStyle}>No Confluence URL configured.</div>
      ) : diagramsLoading ? (
        <div style={emptyStyle}>Loading diagrams…</div>
      ) : !diagrams || diagrams.length === 0 ? (
        <div style={emptyStyle}>
          {row.diagram_count === 0 && lastSyncStatus !== "ok"
            ? "No diagrams yet — click Sync Now."
            : "No drawio diagrams found under this URL."}
        </div>
      ) : (() => {
        const visible = showInactive ? diagrams : diagrams.filter((d) => d.active);
        const inactiveCount = diagrams.filter((d) => !d.active).length;
        const toggleActive = async (attId: string, active: boolean) => {
          await fetch(`/api/settings/architecture-templates/diagrams/${attId}/active?active=${active}`, { method: "PATCH" });
          setDiagrams((prev) => prev ? prev.map((d) => d.attachment_id === attId ? { ...d, active } : d) : prev);
        };
        return (
          <>
            {inactiveCount > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-muted)", cursor: "pointer" }}>
                  <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
                  Show inactive ({inactiveCount} hidden)
                </label>
                <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
                  {visible.length} / {diagrams.length} templates
                </span>
              </div>
            )}
            <div
              style={{
                display: "grid",
                gap: 12,
                gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
              }}
            >
              {visible.map((d) => (
                <DiagramCard key={d.attachment_id} d={d} onToggle={toggleActive} />
              ))}
            </div>
          </>
        );
      })()}
    </section>
  );
}

// ── Diagram card ────────────────────────────────────────────────

function DiagramCard({ d, onToggle }: { d: ArchitectureTemplateDiagram; onToggle: (id: string, active: boolean) => void }) {
  const [imgFailed, setImgFailed] = useState(false);
  return (
    <div
      style={{
        background: "var(--bg-elevated)",
        border: `1px solid ${d.active ? "var(--border)" : "var(--border)"}`,
        borderRadius: "var(--radius-md)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        opacity: d.active ? 1 : 0.45,
        transition: "opacity 0.2s",
      }}
    >
      <a
        href={d.preview_url}
        target="_blank"
        rel="noreferrer"
        title={`Preview ${d.file_name}`}
        style={{
          display: "block",
          aspectRatio: "4 / 3",
          background: "var(--surface)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {!imgFailed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={d.thumbnail_url}
            alt={d.file_name}
            onError={() => setImgFailed(true)}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              background: "#fff",
            }}
          />
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-dim)",
              fontSize: 11,
              fontFamily: "var(--font-mono)",
            }}
          >
            drawio
          </div>
        )}
      </a>
      <div style={{ padding: "8px 10px", display: "grid", gap: 4 }}>
        <div
          title={d.file_name}
          style={{
            fontSize: 12,
            fontWeight: 500,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {d.file_name}
        </div>
        <div
          title={d.page_title}
          style={{
            fontSize: 11,
            color: "var(--text-muted)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {d.page_title || "—"}
        </div>
        {d.page_url && (
          <a
            href={d.page_url}
            target="_blank"
            rel="noreferrer"
            style={{
              fontSize: 11,
              color: "var(--accent)",
              marginTop: 2,
            }}
          >
            Open in Confluence ↗
          </a>
        )}
        <button
          onClick={() => onToggle(d.attachment_id, !d.active)}
          style={{
            marginTop: 4,
            padding: "3px 8px",
            fontSize: 10,
            border: `1px solid ${d.active ? "var(--border-strong)" : "var(--accent)"}`,
            borderRadius: "var(--radius-sm)",
            background: d.active ? "transparent" : "var(--accent)",
            color: d.active ? "var(--text-dim)" : "#000",
            cursor: "pointer",
            fontWeight: 500,
          }}
        >
          {d.active ? "Exclude" : "Include"}
        </button>
      </div>
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  padding: "8px 12px",
  background: "var(--bg-elevated)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  color: "var(--text)",
  fontSize: 13,
  fontFamily: "var(--font-body)",
  outline: "none",
  width: "100%",
};

function primaryButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: "7px 14px",
    background: disabled ? "var(--surface-hover)" : "var(--accent)",
    color: disabled ? "var(--text-dim)" : "#07090d",
    border: "1px solid transparent",
    borderRadius: "var(--radius-md)",
    fontSize: 12,
    fontWeight: 600,
    fontFamily: "var(--font-body)",
    cursor: disabled ? "not-allowed" : "pointer",
    transition: "background 120ms",
  };
}

function secondaryButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: "7px 14px",
    background: "transparent",
    color: disabled ? "var(--text-dim)" : "var(--text)",
    border: `1px solid ${disabled ? "var(--border)" : "var(--border-strong)"}`,
    borderRadius: "var(--radius-md)",
    fontSize: 12,
    fontWeight: 500,
    fontFamily: "var(--font-body)",
    cursor: disabled ? "not-allowed" : "pointer",
  };
}

const emptyStyle: React.CSSProperties = {
  padding: "28px 12px",
  background: "var(--bg-elevated)",
  border: "1px dashed var(--border)",
  borderRadius: "var(--radius-md)",
  color: "var(--text-dim)",
  fontSize: 12,
  textAlign: "center",
};
