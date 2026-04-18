"use client";

/**
 * /design/new — 5-step wizard to bootstrap a new architecture design.
 *
 * Steps:
 *   1. Context  — name, description, fiscal year, optional project link
 *   2. Template — pick a drawio template (or start blank)
 *   3. Apps     — select primary apps (by name or BC) + optional related apps
 *   4. Ifaces   — review interfaces between selected apps, keep/drop
 *   5. Generate — submit, redirect to /design/[id]
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

// ── Types ────────────────────────────────────────────────────────
interface TemplateRow {
  attachment_id: number;
  title: string;
  display_name?: string | null;
  file_kind: string;
  description?: string | null;
  page_title?: string | null;
  fiscal_year?: string | null;
  project_id?: string | null;
}

interface AppSearchRow {
  app_id: string;
  name: string;
  status?: string | null;
}

interface BCNode {
  bc_id: string;
  bc_name: string;
  bc_name_cn?: string | null;
  level: number;
  app_count: number;
  children: BCNode[];
}

interface BCAppRow {
  app_id: string;
  name: string;
  status: string | null;
  app_ownership: string | null;
  u_service_area: string | null;
  mapped_bc_name: string;
  mapped_bc_level: number;
}

interface ProjectRow {
  project_id: string;
  project_name: string;
}

interface ScopeApp {
  app_id: string;
  name: string;
  role: "primary" | "related" | "external";
  planned_status: "keep" | "change" | "new" | "sunset";
  bc_id?: string | null;
}

interface CatalogInterface {
  interface_id: number;
  integration_platform: string;
  interface_name: string | null;
  source_cmdb_id: string | null;
  target_cmdb_id: string | null;
  source_app_name: string | null;
  target_app_name: string | null;
  status: string | null;
}

const PLATFORM_COLORS: Record<string, string> = {
  WSO2: "#f6a623", APIH: "#6ba6e8", KPaaS: "#5fc58a",
  Talend: "#e8716b", PO: "#a8b0c0", "Data Service": "#e8b458",
  Axway: "#9aa4b8", "Axway MFT": "#9aa4b8",
  "Goanywhere-job": "#6b7488", "Goanywhere-web user": "#6b7488",
};

export default function DesignNewPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Step 1: Context
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [fiscalYear, setFiscalYear] = useState("FY2627");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectSearch, setProjectSearch] = useState("");
  const [projectCandidates, setProjectCandidates] = useState<ProjectRow[]>([]);

  // Step 2: Template
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [templateId, setTemplateId] = useState<number | null>(null);

  // Step 3: Apps
  const [scopeApps, setScopeApps] = useState<ScopeApp[]>([]);
  const [appSearch, setAppSearch] = useState("");
  const [appCandidates, setAppCandidates] = useState<AppSearchRow[]>([]);

  // BC selector
  const [bcTree, setBcTree] = useState<BCNode[]>([]);
  const [selectedBcId, setSelectedBcId] = useState<string | null>(null);
  const [bcApps, setBcApps] = useState<BCAppRow[]>([]);
  const [bcLoading, setBcLoading] = useState(false);

  // Step 4: Interfaces
  const [catalog, setCatalog] = useState<CatalogInterface[]>([]);
  const [keepIfaceIds, setKeepIfaceIds] = useState<Set<number>>(new Set());
  const [catalogLoading, setCatalogLoading] = useState(false);

  // Fetch templates + BC tree on mount
  useEffect(() => {
    (async () => {
      try {
        const [tRes, bRes] = await Promise.all([
          fetch("/api/design/templates", { cache: "no-store" }),
          fetch("/api/business-capabilities", { cache: "no-store" }),
        ]);
        const [tJ, bJ] = await Promise.all([tRes.json(), bRes.json()]);
        if (tJ.success) setTemplates(tJ.data.templates || []);
        if (bJ.success) setBcTree(bJ.data.tree || []);
      } catch { /* non-blocking */ }
    })();
  }, []);

  // Debounced app search
  useEffect(() => {
    if (appSearch.length < 2) { setAppCandidates([]); return; }
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(appSearch)}&limit=10`, { cache: "no-store" });
        const j = await r.json();
        if (j.success) setAppCandidates(j.data.applications || []);
      } catch { /* ignore */ }
    }, 200);
    return () => clearTimeout(t);
  }, [appSearch]);

  // Debounced project search
  useEffect(() => {
    if (projectSearch.length < 2) { setProjectCandidates([]); return; }
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/masters/projects?q=${encodeURIComponent(projectSearch)}&limit=10`, { cache: "no-store" });
        const j = await r.json();
        if (j.success) setProjectCandidates((j.data.rows || []).map((p: { project_id: string; project_name: string }) => ({
          project_id: p.project_id, project_name: p.project_name,
        })));
      } catch { /* ignore */ }
    }, 200);
    return () => clearTimeout(t);
  }, [projectSearch]);

  // Load apps for selected BC
  useEffect(() => {
    if (!selectedBcId) { setBcApps([]); return; }
    setBcLoading(true);
    (async () => {
      try {
        const r = await fetch(`/api/business-capabilities/${encodeURIComponent(selectedBcId)}/apps`, { cache: "no-store" });
        const j = await r.json();
        if (j.success) setBcApps(j.data.apps || []);
      } catch { /* ignore */ }
      setBcLoading(false);
    })();
  }, [selectedBcId]);

  // Load catalog interfaces for selected apps (Step 4)
  useEffect(() => {
    if (step !== 4 || scopeApps.length === 0) return;
    setCatalogLoading(true);
    (async () => {
      // Query all interfaces where source or target is in our scope
      const appIds = scopeApps.map(a => a.app_id);
      try {
        const res = await Promise.all(
          appIds.map(id =>
            fetch(`/api/masters/applications/${encodeURIComponent(id)}/integrations?include_sunset=false`, { cache: "no-store" })
              .then(r => r.json())
          )
        );
        // Collect unique interface rows between in-scope apps
        const scopeSet = new Set(appIds);
        const seen = new Set<number>();
        const ifaces: CatalogInterface[] = [];
        for (const r of res) {
          if (!r.success) continue;
          const d = r.data;
          for (const platform of Object.keys(d.as_provider.by_platform)) {
            for (const iface of d.as_provider.by_platform[platform].interfaces) {
              for (const c of iface.consumers) {
                if (!c.app_id || !scopeSet.has(c.app_id)) continue;
                if (seen.has(c.interface_id)) continue;
                seen.add(c.interface_id);
                ifaces.push({
                  interface_id: c.interface_id,
                  integration_platform: platform,
                  interface_name: iface.interface_name || iface.label,
                  source_cmdb_id: d.app_id,
                  target_cmdb_id: c.app_id,
                  source_app_name: null,
                  target_app_name: c.app_name,
                  status: c.status ?? null,
                });
              }
            }
          }
        }
        setCatalog(ifaces);
        // Default: all kept
        setKeepIfaceIds(new Set(ifaces.map(i => i.interface_id)));
      } catch (e) {
        setErr(String(e));
      }
      setCatalogLoading(false);
    })();
  }, [step, scopeApps]);

  const addApp = (app: { app_id: string; name: string }, role: ScopeApp["role"] = "primary") => {
    setScopeApps(prev => {
      if (prev.some(a => a.app_id === app.app_id)) return prev;
      return [...prev, { app_id: app.app_id, name: app.name, role, planned_status: "keep" }];
    });
    setAppSearch("");
    setAppCandidates([]);
  };

  const removeApp = (appId: string) => {
    setScopeApps(prev => prev.filter(a => a.app_id !== appId));
  };

  const toggleAppFromBc = (app: BCAppRow) => {
    setScopeApps(prev => {
      if (prev.some(a => a.app_id === app.app_id)) {
        return prev.filter(a => a.app_id !== app.app_id);
      }
      return [...prev, { app_id: app.app_id, name: app.name, role: "primary", planned_status: "keep", bc_id: selectedBcId }];
    });
  };

  const toggleIface = (id: number) => {
    setKeepIfaceIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const submit = async () => {
    setSubmitting(true);
    setErr(null);
    try {
      const payload = {
        name,
        description,
        fiscal_year: fiscalYear,
        project_id: projectId,
        template_attachment_id: templateId,
        apps: scopeApps.map(a => ({
          app_id: a.app_id, role: a.role, planned_status: a.planned_status, bc_id: a.bc_id ?? null,
        })),
        interfaces: catalog
          .filter(i => keepIfaceIds.has(i.interface_id))
          .map(i => ({
            interface_id: i.interface_id,
            from_app: i.source_cmdb_id,
            to_app: i.target_cmdb_id,
            platform: i.integration_platform,
            interface_name: i.interface_name,
            planned_status: "keep",
          })),
      };
      const r = await fetch("/api/design", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.error || "Create failed");
      router.push(`/design/${j.data.design_id}`);
    } catch (e) {
      setErr(String(e));
      setSubmitting(false);
    }
  };

  const canAdvance = useMemo(() => {
    if (step === 1) return name.trim().length > 0;
    if (step === 3) return scopeApps.length > 0;
    return true;
  }, [step, name, scopeApps.length]);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <Link href="/design" style={{ color: "var(--text-dim)", fontSize: 12, textDecoration: "none" }}>
          ← Designs
        </Link>
        <h1 style={{ margin: 0 }}>New Design</h1>
      </div>

      {/* Tabs — freely clickable (not a linear stepper). The tabs are
          independent except that Step 4 (Interfaces) needs apps selected. */}
      <div style={{ display: "flex", gap: 2, marginBottom: 20 }}>
        {["Context", "Template", "Apps", "Interfaces", "Review"].map((label, i) => {
          const idx = i + 1;
          const active = step === idx;

          // Completion signal per tab
          let complete = false;
          if (idx === 1) complete = name.trim().length > 0;
          if (idx === 2) complete = templateId !== null || name.trim().length > 0;
          if (idx === 3) complete = scopeApps.length > 0;
          if (idx === 4) complete = scopeApps.length > 0;

          return (
            <button
              key={idx}
              onClick={() => setStep(idx)}
              style={{
                flex: 1,
                padding: "10px 14px",
                border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
                background: active ? "var(--accent-dim)" : "transparent",
                color: active ? "var(--accent)" : "var(--text)",
                fontSize: 12,
                fontFamily: "var(--font-mono)",
                cursor: "pointer",
                textAlign: "left",
                position: "relative",
              }}
            >
              <div style={{ fontSize: 10, color: "var(--text-dim)", display: "flex", alignItems: "center", gap: 4 }}>
                <span>Tab {idx}</span>
                {complete && (
                  <span style={{ color: "#5fc58a", fontSize: 10 }}>✓</span>
                )}
              </div>
              {label}
            </button>
          );
        })}
      </div>

      {err && <div className="panel" style={{ borderColor: "#5b1f1f", marginBottom: 14 }}>Error: {err}</div>}

      {/* ── Step 1: Context ── */}
      {step === 1 && (
        <div className="panel" style={{ padding: 24, display: "grid", gap: 16 }}>
          <Field label="Design name *">
            <input
              autoFocus value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. FY2627 Digital Customer Journey"
              style={{ width: "100%" }}
            />
          </Field>
          <Field label="Description">
            <textarea
              value={description} onChange={e => setDescription(e.target.value)}
              placeholder="(optional) the problem this design addresses"
              rows={3} style={{ width: "100%" }}
            />
          </Field>
          <Field label="Fiscal year">
            <select value={fiscalYear} onChange={e => setFiscalYear(e.target.value)}>
              {["FY2526", "FY2627", "FY2728"].map(y => <option key={y}>{y}</option>)}
            </select>
          </Field>
          <Field label="Link to MSPO project (optional)">
            <div style={{ position: "relative" }}>
              <input
                value={projectSearch} onChange={e => setProjectSearch(e.target.value)}
                placeholder="Search by project name or ID…"
                style={{ width: "100%" }}
              />
              {projectCandidates.length > 0 && (
                <div style={{
                  position: "absolute", top: "100%", left: 0, right: 0,
                  background: "var(--surface)", border: "1px solid var(--border-strong)",
                  borderRadius: 4, marginTop: 4, zIndex: 10, maxHeight: 240, overflow: "auto",
                }}>
                  {projectCandidates.map(p => (
                    <button
                      key={p.project_id}
                      onClick={() => { setProjectId(p.project_id); setProjectSearch(""); setProjectCandidates([]); }}
                      style={{
                        display: "flex", width: "100%", padding: "8px 12px",
                        background: "transparent", border: "none",
                        borderBottom: "1px solid var(--border)",
                        color: "var(--text)", fontSize: 13, cursor: "pointer", textAlign: "left",
                        fontFamily: "var(--font-body)",
                      }}
                    >
                      <code style={{ fontFamily: "var(--font-mono)", color: "var(--accent)", minWidth: 80 }}>{p.project_id}</code>
                      <span style={{ marginLeft: 10 }}>{p.project_name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {projectId && (
              <div style={{ marginTop: 6, fontSize: 12 }}>
                Linked: <code style={{ color: "var(--accent)" }}>{projectId}</code>{" "}
                <button onClick={() => setProjectId(null)} style={{ background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", fontSize: 11 }}>clear</button>
              </div>
            )}
          </Field>
        </div>
      )}

      {/* ── Step 2: Template ── */}
      {step === 2 && (
        <div>
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 12,
          }}>
            <TemplateCard
              title="Blank canvas"
              subtitle="Start from scratch"
              description="Empty drawio canvas — only your selected apps and interfaces will be drawn."
              selected={templateId === null}
              onSelect={() => setTemplateId(null)}
            />
            {templates.map(t => (
              <TemplateCard
                key={t.attachment_id}
                title={t.title}
                subtitle={
                  [t.fiscal_year, t.project_id, t.page_title && t.page_title !== t.title ? t.page_title : null]
                    .filter(Boolean)
                    .join(" · ") || null
                }
                description={t.description || `drawio · #${t.attachment_id}`}
                selected={templateId === t.attachment_id}
                onSelect={() => setTemplateId(t.attachment_id)}
                previewUrl={`/api/admin/confluence/attachments/${t.attachment_id}/preview`}
                thumbnailUrl={`/api/admin/confluence/attachments/${t.attachment_id}/preview`}
              />
            ))}
          </div>
          {templates.length === 0 && (
            <div style={{ color: "var(--text-dim)", fontSize: 12, padding: 12 }}>
              No templates registered. You can proceed with a blank canvas.
            </div>
          )}
        </div>
      )}

      {/* ── Step 3: Apps ── */}
      {step === 3 && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {/* Left: By name */}
          <div className="panel" style={{ padding: 14 }}>
            <h3 style={{ marginTop: 0, fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.6 }}>
              By application name / ID
            </h3>
            <div style={{ position: "relative" }}>
              <input
                value={appSearch} onChange={e => setAppSearch(e.target.value)}
                placeholder="Search apps…"
                style={{ width: "100%" }}
              />
              {appCandidates.length > 0 && (
                <div style={{
                  position: "absolute", top: "100%", left: 0, right: 0,
                  background: "var(--surface)", border: "1px solid var(--border-strong)",
                  borderRadius: 4, marginTop: 4, zIndex: 10, maxHeight: 280, overflow: "auto",
                }}>
                  {appCandidates.map(a => (
                    <button
                      key={a.app_id}
                      onClick={() => addApp(a)}
                      style={{
                        display: "flex", width: "100%", padding: "8px 12px",
                        background: "transparent", border: "none",
                        borderBottom: "1px solid var(--border)",
                        color: "var(--text)", fontSize: 13, cursor: "pointer", textAlign: "left",
                        fontFamily: "var(--font-body)",
                      }}
                    >
                      <code style={{ fontFamily: "var(--font-mono)", color: "var(--accent)", minWidth: 80 }}>{a.app_id}</code>
                      <span style={{ marginLeft: 10, flex: 1 }}>{a.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right: By BC */}
          <div className="panel" style={{ padding: 14 }}>
            <h3 style={{ marginTop: 0, fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.6 }}>
              By business capability
            </h3>
            <BCTreeSelector tree={bcTree} selectedId={selectedBcId} onSelect={setSelectedBcId} />
            {selectedBcId && (
              <div style={{ marginTop: 10, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 6 }}>
                  {bcLoading ? "loading…" : `${bcApps.length} apps in this capability`}
                </div>
                <div style={{ maxHeight: 280, overflowY: "auto" }}>
                  {bcApps.map(a => {
                    const inScope = scopeApps.some(s => s.app_id === a.app_id);
                    return (
                      <div key={a.app_id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 12 }}>
                        <input type="checkbox" checked={inScope} onChange={() => toggleAppFromBc(a)} />
                        <code style={{ color: "var(--accent)", fontFamily: "var(--font-mono)", minWidth: 80 }}>{a.app_id}</code>
                        <span style={{ flex: 1 }}>{a.name}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Selected scope */}
          <div className="panel" style={{ padding: 14, gridColumn: "span 2" }}>
            <h3 style={{ marginTop: 0, fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.6 }}>
              In scope ({scopeApps.length})
            </h3>
            {scopeApps.length === 0 ? (
              <div style={{ color: "var(--text-dim)", fontSize: 12 }}>None yet — add apps from either panel above.</div>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {scopeApps.map(a => (
                  <span key={a.app_id} style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    background: "var(--bg-elevated)", border: "1px solid var(--border-strong)",
                    borderRadius: 3, padding: "4px 10px", fontSize: 12,
                  }}>
                    <code style={{ color: "var(--accent)", fontFamily: "var(--font-mono)" }}>{a.app_id}</code>
                    <span>{a.name}</span>
                    <button onClick={() => removeApp(a.app_id)} style={{
                      background: "none", border: "none", color: "var(--text-dim)",
                      cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0,
                    }}>×</button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Step 4: Interfaces ── */}
      {step === 4 && (
        <div className="panel" style={{ padding: 14 }}>
          <h3 style={{ marginTop: 0, fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.6 }}>
            Existing interfaces between scope apps
          </h3>
          {catalogLoading ? (
            <div style={{ color: "var(--text-dim)", padding: 20 }}>Loading interfaces…</div>
          ) : catalog.length === 0 ? (
            <div style={{ color: "var(--text-dim)", fontSize: 12 }}>
              No existing interfaces found among the selected apps. You can add new ones on the canvas.
            </div>
          ) : (
            <>
              <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 6 }}>
                Found {catalog.length} interfaces. {keepIfaceIds.size} selected.
              </div>
              <div style={{ maxHeight: 450, overflowY: "auto" }}>
                {catalog.map(iface => {
                  const color = PLATFORM_COLORS[iface.integration_platform] || "#5f6a80";
                  const kept = keepIfaceIds.has(iface.interface_id);
                  return (
                    <div key={iface.interface_id} style={{
                      display: "flex", alignItems: "center", gap: 8,
                      padding: "6px 8px", borderBottom: "1px solid var(--border)",
                      opacity: kept ? 1 : 0.5,
                    }}>
                      <input type="checkbox" checked={kept} onChange={() => toggleIface(iface.interface_id)} />
                      <span className="status-pill" style={{
                        fontSize: 9, color, background: `${color}26`, padding: "2px 6px", minWidth: 48, textAlign: "center",
                      }}>
                        {iface.integration_platform}
                      </span>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, flex: 1, wordBreak: "break-all" }}>
                        {iface.interface_name || "(unnamed)"}
                      </span>
                      <code style={{ fontFamily: "var(--font-mono)", color: "var(--accent)", fontSize: 11 }}>
                        {iface.source_cmdb_id}
                      </code>
                      <span style={{ color: "var(--text-dim)", fontSize: 11 }}>→</span>
                      <code style={{ fontFamily: "var(--font-mono)", color: "var(--accent)", fontSize: 11 }}>
                        {iface.target_cmdb_id}
                      </code>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Step 5: Generate ── */}
      {step === 5 && (
        <div className="panel" style={{ padding: 24 }}>
          <h3 style={{ marginTop: 0 }}>Review & generate</h3>
          <dl style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: "6px 14px", fontSize: 13 }}>
            <dt style={{ color: "var(--text-dim)" }}>Name</dt><dd>{name}</dd>
            <dt style={{ color: "var(--text-dim)" }}>FY</dt><dd>{fiscalYear}</dd>
            {projectId && <><dt style={{ color: "var(--text-dim)" }}>Project</dt><dd><code style={{ color: "var(--accent)" }}>{projectId}</code></dd></>}
            <dt style={{ color: "var(--text-dim)" }}>Template</dt>
            <dd>{templateId ? (templates.find(t => t.attachment_id === templateId)?.title || `#${templateId}`) : "Blank canvas"}</dd>
            <dt style={{ color: "var(--text-dim)" }}>Apps in scope</dt>
            <dd>{scopeApps.length}</dd>
            <dt style={{ color: "var(--text-dim)" }}>Interfaces kept</dt>
            <dd>{keepIfaceIds.size} of {catalog.length}</dd>
          </dl>
          <div style={{ marginTop: 20, padding: 12, background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 4, fontSize: 12, color: "var(--text-muted)" }}>
            The system will generate an AS-IS drawio canvas from these inputs.
            You'll be able to edit it using the embedded draw.io editor on the next screen.
          </div>
        </div>
      )}

      {/* ── Footer: prev/next convenience + always-visible Generate ── */}
      <div style={{
        display: "flex",
        gap: 8,
        marginTop: 20,
        alignItems: "center",
        paddingTop: 16,
        borderTop: "1px solid var(--border)",
      }}>
        {step > 1 && (
          <button className="btn-secondary" onClick={() => setStep(step - 1)} disabled={submitting}>
            ← Previous tab
          </button>
        )}
        {step < 5 && (
          <button className="btn-secondary" onClick={() => setStep(step + 1)} disabled={submitting}>
            Next tab →
          </button>
        )}
        <div style={{ flex: 1 }} />
        {/* Requirement hint for Generate button */}
        {!(name.trim().length > 0 && scopeApps.length > 0) && (
          <span style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
            needs: {!name.trim() && "name"} {!name.trim() && !scopeApps.length && " + "} {!scopeApps.length && "≥1 app"}
          </span>
        )}
        <button
          onClick={submit}
          disabled={submitting || !name.trim() || scopeApps.length === 0}
          style={{
            background: (submitting || !name.trim() || scopeApps.length === 0) ? "var(--surface-hover)" : "var(--accent)",
            color: (submitting || !name.trim() || scopeApps.length === 0) ? "var(--text-dim)" : "#07090d",
            fontWeight: 600,
            padding: "8px 16px",
          }}
        >
          {submitting ? "Generating…" : "Generate design"}
        </button>
      </div>
    </div>
  );
}

// ── Small components ────────────────────────────────────────────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6 }}>
        {label}
      </div>
      {children}
    </label>
  );
}

function TemplateCard({
  title, subtitle, description, selected, onSelect, previewUrl, thumbnailUrl,
}: {
  title: string;
  subtitle?: string | null;
  description: string;
  selected: boolean;
  onSelect: () => void;
  previewUrl?: string;
  thumbnailUrl?: string;
}) {
  return (
    <div
      onClick={onSelect}
      style={{
        border: `2px solid ${selected ? "var(--accent)" : "var(--border)"}`,
        borderRadius: "var(--radius-md)",
        cursor: "pointer",
        background: selected ? "var(--accent-dim)" : "var(--surface)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Thumbnail area */}
      <div style={{
        position: "relative",
        width: "100%",
        height: 160,
        background: "#1b1d25",
        borderBottom: "1px solid var(--border)",
        overflow: "hidden",
      }}>
        {thumbnailUrl ? (
          // Use native lazy loading — iframe only loads when scrolled near viewport
          <iframe
            src={thumbnailUrl}
            loading="lazy"
            style={{
              width: "100%",
              height: "100%",
              border: 0,
              pointerEvents: "none",  // disable interaction; whole card is clickable
            }}
            title={`${title} preview`}
          />
        ) : (
          // Placeholder for blank canvas option
          <div style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--text-dim)",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            letterSpacing: 0.6,
            background: "repeating-linear-gradient(45deg, transparent, transparent 8px, rgba(255,255,255,0.02) 8px, rgba(255,255,255,0.02) 16px)",
          }}>
            BLANK CANVAS
          </div>
        )}
      </div>

      {/* Text area */}
      <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {title}
          </div>
          {previewUrl && (
            <a
              href={previewUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              style={{ color: "var(--accent)", fontSize: 10, textDecoration: "none", whiteSpace: "nowrap" }}
            >
              open ↗
            </a>
          )}
        </div>
        {subtitle && (
          <div style={{ fontSize: 11, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {subtitle}
          </div>
        )}
        <div style={{ fontSize: 10, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
          {description}
        </div>
      </div>
    </div>
  );
}

function BCTreeSelector({
  tree, selectedId, onSelect,
}: {
  tree: BCNode[]; selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) => {
    setExpanded(p => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };
  const renderNode = (n: BCNode, depth: number) => {
    const isSelected = selectedId === n.bc_id;
    const hasChildren = n.children.length > 0;
    const isExpanded = expanded.has(n.bc_id);
    return (
      <div key={n.bc_id}>
        <div style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "3px 4px", paddingLeft: 4 + depth * 14,
          background: isSelected ? "var(--accent-dim)" : "transparent",
          color: isSelected ? "var(--accent)" : "var(--text)",
          cursor: "pointer", fontSize: 12,
        }} onClick={() => onSelect(n.bc_id)}>
          {hasChildren ? (
            <button onClick={(e) => { e.stopPropagation(); toggle(n.bc_id); }}
              style={{ width: 14, height: 14, background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", padding: 0 }}>
              {isExpanded ? "▾" : "▸"}
            </button>
          ) : <span style={{ width: 14 }} />}
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {n.bc_name}
          </span>
          <span style={{ fontSize: 10, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
            {n.app_count}
          </span>
        </div>
        {hasChildren && isExpanded && n.children.map(c => renderNode(c, depth + 1))}
      </div>
    );
  };
  return (
    <div style={{ maxHeight: 280, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 4 }}>
      {tree.length === 0 && <div style={{ padding: 10, color: "var(--text-dim)", fontSize: 12 }}>Loading BC taxonomy…</div>}
      {tree.map(n => renderNode(n, 0))}
    </div>
  );
}
