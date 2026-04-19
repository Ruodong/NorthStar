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
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

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

interface ProjectSolutionGroup {
  project_id: string;
  project_name: string | null;
  fiscal_year: string | null;
  referenced_scope_apps: string[];
  diagrams: Array<{
    attachment_id: number;
    title: string;
    file_kind: string;
    page_id: string;
    page_title: string;
  }>;
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

// An interface row from the perspective of ONE scope app
interface ScopedIfaceRow {
  interface_id: number;
  platform: string;
  interface_name: string | null;
  // The scope app this row pivots on
  scope_app_id: string;
  scope_app_name: string;
  // scope app's role for this interface: 'provider' = scope app exposes it;
  // 'consumer' = scope app uses it.
  role: "provider" | "consumer";
  // The other end
  counter_app_id: string | null;
  counter_app_name: string | null;
  counter_account: string | null;
  status: string | null;
}

const PLATFORM_COLORS: Record<string, string> = {
  WSO2: "#f6a623", APIH: "#6ba6e8", KPaaS: "#5fc58a",
  Talend: "#e8716b", PO: "#a8b0c0", "Data Service": "#e8b458",
  Axway: "#9aa4b8", "Axway MFT": "#9aa4b8",
  "Goanywhere-job": "#6b7488", "Goanywhere-web user": "#6b7488",
};

// Top-level export wraps DesignNewPageInner in Suspense because it
// calls useSearchParams() — Next 14 requires that during static
// generation so the CSR bailout doesn't break `next build`.
export default function DesignNewPage() {
  return (
    <Suspense fallback={<div style={{ padding: 40, color: "var(--text-dim)" }}>Loading…</div>}>
      <DesignNewPageInner />
    </Suspense>
  );
}

function DesignNewPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Edit-mode: ?design_id=X prefills the wizard with an existing
  // design's selections and switches Save to call PUT /selections
  // instead of POST. See .specify/features/design-edit-wizard/spec.md.
  const editDesignIdRaw = searchParams?.get("design_id") ?? null;
  const editDesignId = editDesignIdRaw && /^\d+$/.test(editDesignIdRaw)
    ? Number(editDesignIdRaw) : null;
  const isEditMode = editDesignId != null;

  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Edit-mode only: a fatal load error (404) that blocks Save.
  const [editLoadError, setEditLoadError] = useState<string | null>(null);
  const [editLoading, setEditLoading] = useState<boolean>(isEditMode);

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
  // The picked template's human title — separate from `templates` because
  // that list only holds Standard templates; Project Solution templates and
  // edit-mode prefills need their titles carried through this channel
  // otherwise the top-bar Template row falls back to "#{attachment_id}".
  const [selectedTemplateTitle, setSelectedTemplateTitle] = useState<string | null>(null);
  const chooseTemplate = (id: number | null, title: string | null) => {
    setTemplateId(id);
    setSelectedTemplateTitle(id === null ? null : title);
  };

  // Step 3: Apps
  const [scopeApps, setScopeApps] = useState<ScopeApp[]>([]);
  const [appSearch, setAppSearch] = useState("");
  const [appCandidates, setAppCandidates] = useState<AppSearchRow[]>([]);

  // BC selector
  const [bcTree, setBcTree] = useState<BCNode[]>([]);
  const [selectedBcId, setSelectedBcId] = useState<string | null>(null);
  const [bcApps, setBcApps] = useState<BCAppRow[]>([]);
  const [bcLoading, setBcLoading] = useState(false);

  // Step 3: Interfaces — scoped rows, one per (scope_app, direction, counter)
  const [scopedRows, setScopedRows] = useState<ScopedIfaceRow[]>([]);
  const [keepIfaceIds, setKeepIfaceIds] = useState<Set<number>>(new Set());
  const [catalogLoading, setCatalogLoading] = useState(false);

  // Fetch templates + BC tree on mount
  useEffect(() => {
    (async () => {
      try {
        const [tRes, bRes] = await Promise.all([
          fetch("/api/design/standard-templates", { cache: "no-store" }),
          fetch("/api/business-capabilities", { cache: "no-store" }),
        ]);
        const [tJ, bJ] = await Promise.all([tRes.json(), bRes.json()]);
        if (tJ.success) setTemplates(tJ.data.templates || []);
        if (bJ.success) setBcTree(bJ.data.tree || []);
      } catch { /* non-blocking */ }
    })();
  }, []);

  // Edit mode: GET the existing design and prefill all wizard state.
  // Runs once on mount (editDesignId doesn't change within a session).
  useEffect(() => {
    if (!isEditMode || editDesignId == null) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/design/${editDesignId}`, { cache: "no-store" });
        const j = await r.json();
        if (cancelled) return;
        if (!r.ok || !j.success) {
          setEditLoadError(j.error || `Design #${editDesignId} not found.`);
          setEditLoading(false);
          return;
        }
        const d = j.data.design || {};
        const loadedApps = (j.data.apps || []) as Array<{
          app_id: string; name?: string | null; role?: string | null;
          planned_status?: string | null; bc_id?: string | null;
        }>;
        const loadedIfaces = (j.data.interfaces || []) as Array<{
          interface_id?: number | null;
        }>;

        setName(d.name || "");
        setDescription(d.description || "");
        if (d.fiscal_year) setFiscalYear(d.fiscal_year);
        setProjectId(d.project_id || null);
        chooseTemplate(
          d.template_attachment_id ?? null,
          d.template_title ?? null,
        );
        setScopeApps(loadedApps.map(a => ({
          app_id: a.app_id,
          name: a.name || a.app_id,
          // Normalise backend roles → wizard roles. "primary" is the
          // Major set; "related"/"external" → Surround (UI treats both
          // as passive per spec EC-6).
          role: (a.role === "primary" ? "primary"
                : a.role === "external" ? "external"
                : "related") as ScopeApp["role"],
          planned_status: (["keep", "change", "new", "sunset"].includes(a.planned_status || "")
                          ? a.planned_status : "keep") as ScopeApp["planned_status"],
          bc_id: a.bc_id ?? null,
        })));
        setKeepIfaceIds(new Set(
          loadedIfaces.map(i => i.interface_id).filter((x): x is number => typeof x === "number")
        ));
        setEditLoading(false);
      } catch (e) {
        if (cancelled) return;
        setEditLoadError(String(e));
        setEditLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isEditMode, editDesignId]);

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

  // Load interfaces: for each scope app, fetch its /integrations endpoint
  // and flatten into ScopedIfaceRow[]. Each row pivots on ONE scope app +
  // its role (provider/consumer) + the counterparty. The UI lets the
  // architect check a row to include that interface AND auto-add the
  // counterparty app to scope.
  const [coverage, setCoverage] = useState<Record<string, { total_catalog: number }>>({});
  // Track which app_ids we've fetched so incremental adds don't refetch
  // everything (which would cause a full-page flicker).
  const fetchedAppIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    // Fire on ALL steps — the top bar's cascade cleanup needs scopedRows
    // to be in sync even when the user removes Major Apps from tabs other
    // than Interfaces (e.g., clicks × on a chip while on the Template tab).
    const currentIds = new Set(scopeApps.map(a => a.app_id));
    const toAdd = scopeApps.filter(a => !fetchedAppIdsRef.current.has(a.app_id));
    const toRemove = [...fetchedAppIdsRef.current].filter(id => !currentIds.has(id));

    // 1. Remove rows + coverage for apps that left scope
    if (toRemove.length > 0) {
      const removedSet = new Set(toRemove);
      setScopedRows(prev => prev.filter(r => !removedSet.has(r.scope_app_id)));
      setCoverage(prev => {
        const next = { ...prev };
        for (const id of toRemove) delete next[id];
        return next;
      });
      for (const id of toRemove) fetchedAppIdsRef.current.delete(id);
    }

    // 2. Fetch only newly-added apps (incremental — no flicker)
    if (toAdd.length === 0) return;
    // Only show loading state for initial fetch (no rows yet); for
    // incremental adds keep the existing list visible.
    const isInitial = fetchedAppIdsRef.current.size === 0;
    if (isInitial) setCatalogLoading(true);

    (async () => {
      try {
        const results = await Promise.all(
          toAdd.map(a =>
            fetch(
              `/api/masters/applications/${encodeURIComponent(a.app_id)}/integrations?include_sunset=false`,
              { cache: "no-store" }
            ).then(r => r.json()).then(j => ({ scope: a, data: j.success ? j.data : null }))
          )
        );

        const newRows: ScopedIfaceRow[] = [];
        const newCov: Record<string, { total_catalog: number }> = {};
        for (const { scope, data } of results) {
          if (!data) continue;
          let total = 0;
          for (const platform of Object.keys(data.as_provider?.by_platform || {})) {
            const bucket = data.as_provider.by_platform[platform];
            for (const iface of (bucket.interfaces || [])) {
              for (const c of (iface.consumers || [])) {
                total++;
                newRows.push({
                  interface_id: c.interface_id,
                  platform,
                  interface_name: iface.interface_name || iface.label || null,
                  scope_app_id: scope.app_id,
                  scope_app_name: scope.name,
                  role: "provider",
                  counter_app_id: c.app_id || null,
                  counter_app_name: c.app_name || null,
                  counter_account: c.account_name || null,
                  status: c.status ?? null,
                });
              }
            }
          }
          for (const platform of Object.keys(data.as_consumer?.by_platform || {})) {
            const bucket = data.as_consumer.by_platform[platform];
            for (const row of (bucket.rows || [])) {
              total++;
              newRows.push({
                interface_id: row.interface_id,
                platform,
                interface_name: row.interface_name || row.label || null,
                scope_app_id: scope.app_id,
                scope_app_name: scope.name,
                role: "consumer",
                counter_app_id: row.provider?.app_id || null,
                counter_app_name: row.provider?.app_name || null,
                counter_account: row.my_account_name || null,
                status: row.status ?? null,
              });
            }
          }
          newCov[scope.app_id] = { total_catalog: total };
          fetchedAppIdsRef.current.add(scope.app_id);
        }

        // Append (don't replace) so existing checked rows + scroll position
        // stay put when a new app is added through the Interfaces tab.
        setScopedRows(prev => [...prev, ...newRows]);
        setCoverage(prev => ({ ...prev, ...newCov }));
      } catch (e) {
        setErr(String(e));
      }
      if (isInitial) setCatalogLoading(false);
    })();
  }, [scopeApps]);

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
    // keepIfaceIds cleanup + orphan related-app cleanup both happen in the
    // post-change effect below — the app's scopedRows get filtered out
    // automatically when scopeApps changes, then we prune.
  };

  // Remove a single kept interface by id. Cascades to drop any related
  // (role="related") scope app whose only reason for being in scope was
  // this (and any other already-dropped) interface.
  const removeInterface = (interfaceId: number) => {
    setKeepIfaceIds(prev => {
      if (!prev.has(interfaceId)) return prev;
      const next = new Set(prev);
      next.delete(interfaceId);
      return next;
    });
  };

  // Cascade cleanup: whenever scopeApps, scopedRows, or keepIfaceIds change,
  // drop (1) orphan kept interface ids (no matching scopedRow left after
  // some scope app was removed) and (2) orphan related apps (role="related"
  // scope apps with no kept interface still referencing them).
  useEffect(() => {
    // Pass 1: prune orphan interface ids
    const validIds = new Set(scopedRows.map(r => r.interface_id));
    let prunedKeep: Set<number> | null = null;
    for (const id of keepIfaceIds) {
      if (!validIds.has(id)) {
        if (!prunedKeep) prunedKeep = new Set(keepIfaceIds);
        prunedKeep.delete(id);
      }
    }
    if (prunedKeep) {
      setKeepIfaceIds(prunedKeep);
      return; // let the next effect tick handle pass 2 with updated keep set
    }

    // Pass 2: prune orphan related apps
    // A related app is orphan if no row in scopedRows has
    // (counter_app_id === relatedApp.app_id AND keepIfaceIds.has(interface_id)).
    const referenced = new Set<string>();
    for (const r of scopedRows) {
      if (keepIfaceIds.has(r.interface_id) && r.counter_app_id) {
        referenced.add(r.counter_app_id);
      }
    }
    const orphans = scopeApps.filter(a => a.role === "related" && !referenced.has(a.app_id));
    if (orphans.length > 0) {
      const orphanSet = new Set(orphans.map(a => a.app_id));
      setScopeApps(prev => prev.filter(a => !orphanSet.has(a.app_id)));
    }
  }, [scopeApps, scopedRows, keepIfaceIds]);

  const toggleAppFromBc = (app: BCAppRow) => {
    setScopeApps(prev => {
      if (prev.some(a => a.app_id === app.app_id)) {
        return prev.filter(a => a.app_id !== app.app_id);
      }
      return [...prev, { app_id: app.app_id, name: app.name, role: "primary", planned_status: "keep", bc_id: selectedBcId }];
    });
  };

  // Toggling an interface row also auto-adds the counterparty app to scope
  // (if not already there). This lets architects discover and expand scope
  // through the Interfaces tab instead of guessing upfront in the Apps tab.
  const toggleIface = (row: ScopedIfaceRow) => {
    setKeepIfaceIds(prev => {
      const next = new Set(prev);
      if (next.has(row.interface_id)) next.delete(row.interface_id);
      else next.add(row.interface_id);
      return next;
    });
    // Only add counter on CHECK (not uncheck) — and only if app is CMDB-valid
    const checking = !keepIfaceIds.has(row.interface_id);
    if (checking && row.counter_app_id && row.counter_app_id !== row.scope_app_id) {
      setScopeApps(prev => {
        if (prev.some(a => a.app_id === row.counter_app_id)) return prev;
        return [...prev, {
          app_id: row.counter_app_id!,
          name: row.counter_app_name || row.counter_app_id!,
          role: "related",
          planned_status: "keep",
        }];
      });
    }
  };

  const submit = async () => {
    setSubmitting(true);
    setErr(null);
    try {
      const appsPayload = scopeApps.map(a => ({
        app_id: a.app_id, role: a.role, planned_status: a.planned_status, bc_id: a.bc_id ?? null,
      }));
      // Dedup by interface_id: same underlying interface may appear
      // multiple times (once per scope app perspective).
      const ifacesPayload = Array.from(
        new Map(
          scopedRows
            .filter(r => keepIfaceIds.has(r.interface_id))
            .map(r => {
              // Normalize to (from_app, to_app) pair using role:
              // provider role means the scope app SUPPLIES the endpoint;
              // but the integration flow direction depends on platform.
              // For design-edge rendering, use source→target from the
              // original data: when scope app is provider for platforms
              // where source=Provider (APIH/KPaaS/etc.), scope→counter;
              // for WSO2, target=Provider so counter→scope.
              const providerSide = (r.platform === "WSO2") ? "target" : "source";
              const fromApp = r.role === "provider"
                ? (providerSide === "source" ? r.scope_app_id : r.counter_app_id)
                : (providerSide === "source" ? r.counter_app_id : r.scope_app_id);
              const toApp = r.role === "provider"
                ? (providerSide === "source" ? r.counter_app_id : r.scope_app_id)
                : (providerSide === "source" ? r.scope_app_id : r.counter_app_id);
              return [r.interface_id, {
                interface_id: r.interface_id,
                from_app: fromApp,
                to_app: toApp,
                platform: r.platform,
                interface_name: r.interface_name,
                planned_status: "keep",
              }];
            })
        ).values()
      );

      if (isEditMode && editDesignId != null) {
        // Edit mode: PUT /selections. Metadata (name / description / FY /
        // project) is NOT updated here — the Context tab is read-only in
        // edit mode per spec FR-9. The drawio canvas is also preserved;
        // the architect triggers Regenerate manually on /design/[id].
        const editPayload = {
          template_attachment_id: templateId,
          apps: appsPayload,
          interfaces: ifacesPayload,
        };
        const r = await fetch(`/api/design/${editDesignId}/selections`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(editPayload),
        });
        const j = await r.json();
        if (!j.success) throw new Error(j.error || "Save failed");
        router.push(`/design/${editDesignId}`);
      } else {
        // Create mode: POST /api/design. Runs the generator and returns
        // a fresh design_id.
        const payload = {
          name,
          description,
          fiscal_year: fiscalYear,
          project_id: projectId,
          template_attachment_id: templateId,
          apps: appsPayload,
          interfaces: ifacesPayload,
        };
        const r = await fetch("/api/design", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const j = await r.json();
        if (!j.success) throw new Error(j.error || "Create failed");
        router.push(`/design/${j.data.design_id}`);
      }
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
        <h1 style={{ margin: 0 }}>{isEditMode ? "Edit Design" : "New Design"}</h1>
      </div>

      {/* Edit-mode banner — signals the wizard is in PUT-selections flow,
          not create flow. Metadata fields in the Context tab are
          read-only per spec FR-9; canvas page keeps editing those. */}
      {isEditMode && (
        <div className="panel" style={{
          padding: "8px 14px", marginBottom: 12,
          borderColor: "var(--accent)",
          background: "var(--accent-dim)",
          fontSize: 12,
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <span style={{ color: "var(--accent)", fontFamily: "var(--font-mono)" }}>
            Editing Design #{editDesignId}
          </span>
          <span style={{ color: "var(--text-dim)" }}>
            — {editLoading ? "loading…" : (name ? `"${name}"` : "")}
          </span>
          <div style={{ flex: 1 }} />
          <span style={{ color: "var(--text-dim)", fontSize: 11 }}>
            Changes to apps / interfaces / template save here. Canvas stays as-is.
          </span>
        </div>
      )}

      {/* Fatal load error (FR-10) — stops Save from firing. */}
      {editLoadError && (
        <div className="panel" style={{ padding: 10, marginBottom: 12, borderColor: "#5b1f1f", fontSize: 12 }}>
          Could not load design #{editDesignId}: {editLoadError}
        </div>
      )}

      {/* Tabs — freely clickable (not a linear stepper). The tabs are
          independent except that Step 4 (Interfaces) needs apps selected. */}
      <div style={{ display: "flex", gap: 2, marginBottom: 20 }}>
        {["Context", "Apps", "Interfaces", "Template", "Review"].map((label, i) => {
          const idx = i + 1;
          const active = step === idx;

          // Completion signal per tab
          let complete = false;
          if (idx === 1) complete = name.trim().length > 0;
          if (idx === 2) complete = scopeApps.length > 0;
          if (idx === 3) complete = scopeApps.length > 0;  // interfaces step valid once scope exists
          if (idx === 4) complete = true; // template is optional — blank canvas is valid

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

      {/* ── Persistent summary bar — always visible at top.
          Left column: Basic Information (read-only). Right column:
          Major Applications + Interfaces (chips with × cascade removal). */}
      <SummaryBar
        name={name}
        fiscalYear={fiscalYear}
        projectId={projectId}
        templateId={templateId}
        templateTitle={selectedTemplateTitle}
        scopeApps={scopeApps}
        scopedRows={scopedRows}
        keepIfaceIds={keepIfaceIds}
        onJumpTab={setStep}
        onRemoveApp={removeApp}
        onRemoveInterface={removeInterface}
      />

      {err && <div className="panel" style={{ borderColor: "#5b1f1f", marginBottom: 14 }}>Error: {err}</div>}

      {/* ── Step 1: Context ── */}
      {step === 1 && (
        <div className="panel" style={{ padding: 24, display: "grid", gap: 16 }}>
          {isEditMode && (
            <div style={{
              fontSize: 11, color: "var(--text-muted)",
              padding: 10,
              border: "1px dashed var(--border)",
              borderRadius: 4,
              background: "var(--surface)",
            }}>
              Metadata (name / description / fiscal year / project) is
              read-only here. To edit these, use the canvas page at{" "}
              <Link href={`/design/${editDesignId}`} style={{ color: "var(--accent)" }}>
                /design/{editDesignId}
              </Link>
              .
            </div>
          )}
          <Field label="Design name *">
            <input
              autoFocus={!isEditMode}
              value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. FY2627 Digital Customer Journey"
              style={{ width: "100%" }}
              readOnly={isEditMode}
              disabled={isEditMode}
            />
          </Field>
          <Field label="Description">
            <textarea
              value={description} onChange={e => setDescription(e.target.value)}
              placeholder="(optional) the problem this design addresses"
              rows={3} style={{ width: "100%" }}
              readOnly={isEditMode}
              disabled={isEditMode}
            />
          </Field>
          <Field label="Fiscal year">
            <select value={fiscalYear} onChange={e => setFiscalYear(e.target.value)}
                    disabled={isEditMode}>
              {["FY2526", "FY2627", "FY2728"].map(y => <option key={y}>{y}</option>)}
            </select>
          </Field>
          <Field label="Link to MSPO project (optional)">
            <div style={{ position: "relative" }}>
              <input
                value={projectSearch} onChange={e => setProjectSearch(e.target.value)}
                placeholder="Search by project name or ID…"
                style={{ width: "100%" }}
                readOnly={isEditMode}
                disabled={isEditMode}
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

      {/* ── Step 4 (now): Template — Standard + Project Solutions ── */}
      {step === 4 && (
        <TemplateStep
          scopeApps={scopeApps}
          templates={templates}
          templateId={templateId}
          chooseTemplate={chooseTemplate}
        />
      )}

      {/* ── Step 2 (now): Apps — pick scope first ── */}
      {step === 2 && (
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
                      <button
                        key={a.app_id}
                        type="button"
                        onClick={() => toggleAppFromBc(a)}
                        aria-pressed={inScope}
                        title={inScope ? "Click to remove from scope" : "Click to add to scope"}
                        style={{
                          display: "flex", alignItems: "center", gap: 8,
                          width: "100%",
                          padding: "5px 8px",
                          fontSize: 12,
                          background: inScope ? "rgba(246, 166, 35, 0.10)" : "transparent",
                          borderLeft: inScope ? "2px solid var(--accent)" : "2px solid transparent",
                          borderTop: "none",
                          borderRight: "none",
                          borderBottom: "1px dotted var(--border)",
                          color: "var(--text)",
                          cursor: "pointer",
                          textAlign: "left",
                          fontFamily: "var(--font-body)",
                          transition: "background var(--t-hover) var(--ease), border-color var(--t-hover) var(--ease)",
                        }}
                      >
                        <code style={{ color: "var(--accent)", fontFamily: "var(--font-mono)", minWidth: 80 }}>{a.app_id}</code>
                        <span style={{ flex: 1 }}>{a.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

        </div>
      )}

      {/* ── Step 3 (now): Interfaces ── */}
      {step === 3 && (
        <InterfacesStep
          scopeApps={scopeApps}
          scopedRows={scopedRows}
          keepIfaceIds={keepIfaceIds}
          coverage={coverage}
          loading={catalogLoading}
          onToggle={toggleIface}
          onClearAll={() => setKeepIfaceIds(new Set())}
        />
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
            <dd>{templateId ? (selectedTemplateTitle || `#${templateId}`) : "Blank canvas"}</dd>
            <dt style={{ color: "var(--text-dim)" }}>Major Applications</dt>
            <dd>{scopeApps.length}</dd>
            <dt style={{ color: "var(--text-dim)" }}>Interfaces kept</dt>
            <dd>{keepIfaceIds.size} of {scopedRows.length}</dd>
          </dl>
          <div style={{ marginTop: 20, padding: 12, background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 4, fontSize: 12, color: "var(--text-muted)" }}>
            {isEditMode
              ? "Save will update this design's apps / interfaces / template. The drawio canvas stays exactly as it is — to redraw from the new selections, click ↻ Regenerate AS-IS on the canvas page."
              : "The system will generate an AS-IS drawio canvas from these inputs. You'll be able to edit it using the embedded draw.io editor on the next screen."}
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
        {/* Clickable Generate — if requirements unmet, auto-jumps to
            the offending tab instead of silently refusing to submit. */}
        {!(name.trim().length > 0 && scopeApps.length > 0) && (
          <span style={{ fontSize: 11, color: "#e8b458", fontFamily: "var(--font-mono)" }}>
            {!name.trim() && "missing design name"}
            {!name.trim() && !scopeApps.length && " · "}
            {!scopeApps.length && "no apps in scope"}
          </span>
        )}
        <button
          onClick={() => {
            if (submitting) return;
            if (editLoadError) return;
            if (!name.trim()) {
              setStep(1);
              setErr("Please fill in the design name on the Context tab.");
              return;
            }
            if (scopeApps.length === 0) {
              setStep(2);
              setErr("Please select at least one application on the Apps tab.");
              return;
            }
            setErr(null);
            submit();
          }}
          disabled={submitting || editLoading || !!editLoadError}
          style={{
            background: (submitting || editLoading || !!editLoadError || !name.trim() || scopeApps.length === 0) ? "var(--surface-hover)" : "var(--accent)",
            color: (submitting || editLoading || !!editLoadError || !name.trim() || scopeApps.length === 0) ? "var(--text-dim)" : "#07090d",
            fontWeight: 600,
            padding: "8px 16px",
            cursor: submitting ? "default" : "pointer",
          }}
          title={
            editLoadError ? "Cannot save — design failed to load" :
            editLoading ? "Loading existing design…" :
            !name.trim() ? "Click to go back and enter a design name" :
            scopeApps.length === 0 ? "Click to go back and select apps" :
            isEditMode ? "Save changes — updates apps / interfaces / template; canvas unchanged" :
            "Generate the AS-IS drawio canvas"
          }
        >
          {submitting ? (isEditMode ? "Saving…" : "Generating…")
            : editLoading ? "Loading…"
            : isEditMode ? "Save changes"
            : "Generate design"}
        </button>
      </div>
    </div>
  );
}

// ── Small components ────────────────────────────────────────────
/* ── SummaryBar: persistent top bar — two columns.
      Left: Basic Information (read-only, click → jumps to relevant tab).
      Right: Applications and Interfaces (two sub-columns, chips removable).
      Surround apps are implicit — rendered inside each Interface chip as
      the counterparty id+name, with × on the chip removing the interface
      and cascading to drop orphan related apps. ── */
function SummaryBar({
  name, fiscalYear, projectId, templateId, templateTitle,
  scopeApps, scopedRows, keepIfaceIds,
  onJumpTab, onRemoveApp, onRemoveInterface,
}: {
  name: string;
  fiscalYear: string;
  projectId: string | null;
  templateId: number | null;
  templateTitle: string | null;
  scopeApps: ScopeApp[];
  scopedRows: ScopedIfaceRow[];
  keepIfaceIds: Set<number>;
  onJumpTab: (idx: number) => void;
  onRemoveApp: (appId: string) => void;
  onRemoveInterface: (interfaceId: number) => void;
}) {
  // Prefer the human title when we have it (either set by the user on
  // template selection, or prefilled from GET /api/design/{id} in edit
  // mode). Fall back to `#{id}` only when the title hasn't been
  // resolved — this happens briefly during edit-mode load and never
  // after a successful prefill.
  const templateName = templateId === null
    ? "Blank canvas"
    : (templateTitle || `#${templateId}`);

  const majorApps = scopeApps.filter(a => a.role === "primary");

  // Dedup kept interfaces by interface_id — same id can appear from both
  // ends (scope app as provider AND consumer); pick the first occurrence.
  const keptIfaceRows: ScopedIfaceRow[] = [];
  const seen = new Set<number>();
  for (const r of scopedRows) {
    if (!keepIfaceIds.has(r.interface_id)) continue;
    if (seen.has(r.interface_id)) continue;
    seen.add(r.interface_id);
    keptIfaceRows.push(r);
  }

  return (
    <div style={{
      marginBottom: 16,
      padding: 12,
      background: "var(--bg-elevated)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-md)",
      display: "grid",
      gridTemplateColumns: "280px 1fr",
      gap: 12,
    }}>
      {/* ── LEFT: Basic Information (read-only) ── */}
      <div style={{
        padding: 10,
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 4,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}>
        <div style={{
          fontSize: 9, color: "var(--text-dim)", fontFamily: "var(--font-mono)",
          letterSpacing: 0.6, textTransform: "uppercase",
        }}>
          Basic Information
        </div>
        <InfoRow label="Solution" onJump={() => onJumpTab(1)} filled={name.trim().length > 0}>
          {name.trim() ? name : <span style={{ color: "var(--text-dim)" }}>(unnamed)</span>}
        </InfoRow>
        <InfoRow label="Fiscal Year" onJump={() => onJumpTab(1)} filled>
          <span style={{ fontFamily: "var(--font-mono)" }}>{fiscalYear}</span>
        </InfoRow>
        <InfoRow label="Project" onJump={() => onJumpTab(1)} filled={!!projectId}>
          {projectId ? (
            <code style={{ fontFamily: "var(--font-mono)", color: "var(--accent)" }}>{projectId}</code>
          ) : <span style={{ color: "var(--text-dim)" }}>(none)</span>}
        </InfoRow>
        <InfoRow label="Template" onJump={() => onJumpTab(4)} filled>
          <span style={{
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "inline-block",
            maxWidth: "100%",
          }} title={templateName}>{templateName}</span>
        </InfoRow>
      </div>

      {/* ── RIGHT: Applications and Interfaces (chips) ── */}
      <div style={{
        padding: 10,
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 4,
        display: "grid",
        gridTemplateColumns: "minmax(200px, 1fr) minmax(280px, 2fr)",
        gap: 12,
      }}>
        {/* Sub-column: Major Applications */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
          <div style={{
            fontSize: 9, color: "var(--text-dim)", fontFamily: "var(--font-mono)",
            letterSpacing: 0.6, textTransform: "uppercase",
          }}>
            Major Applications ({majorApps.length})
          </div>
          {majorApps.length === 0 ? (
            <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
              — none — (add from <button
                onClick={() => onJumpTab(2)}
                style={{
                  background: "none", border: "none", color: "var(--accent)",
                  cursor: "pointer", padding: 0, fontSize: 11, textDecoration: "underline",
                }}
              >Apps tab</button>)
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 8, alignItems: "start" }}>
              {majorApps.map(a => (
                <MajorAppChip key={a.app_id} app={a} onRemove={() => onRemoveApp(a.app_id)} />
              ))}
            </div>
          )}
        </div>

        {/* Sub-column: Interfaces */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
          <div style={{
            fontSize: 9, color: "var(--text-dim)", fontFamily: "var(--font-mono)",
            letterSpacing: 0.6, textTransform: "uppercase",
          }}>
            Interfaces ({keptIfaceRows.length})
          </div>
          {keptIfaceRows.length === 0 ? (
            <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
              — none — (pick from <button
                onClick={() => onJumpTab(3)}
                style={{
                  background: "none", border: "none", color: "var(--accent)",
                  cursor: "pointer", padding: 0, fontSize: 11, textDecoration: "underline",
                }}
              >Interfaces tab</button>)
            </div>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {keptIfaceRows.map(r => (
                <InterfaceChip
                  key={r.interface_id}
                  row={r}
                  onRemove={() => onRemoveInterface(r.interface_id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoRow({
  label, children, onJump, filled,
}: {
  label: string;
  children: React.ReactNode;
  onJump: () => void;
  filled: boolean;
}) {
  return (
    <button
      onClick={onJump}
      title={`Click to edit ${label.toLowerCase()}`}
      style={{
        display: "grid",
        gridTemplateColumns: "84px 1fr auto",
        alignItems: "baseline",
        gap: 6,
        padding: "3px 4px",
        background: "transparent",
        border: "none",
        borderLeft: `2px solid ${filled ? "var(--accent)" : "var(--border-strong)"}`,
        color: "var(--text)",
        cursor: "pointer",
        textAlign: "left",
        fontSize: 12,
        fontFamily: "var(--font-body)",
        minWidth: 0,
      }}
    >
      <span style={{
        fontSize: 10, color: "var(--text-dim)",
        textTransform: "uppercase", letterSpacing: 0.4,
      }}>
        {label}
      </span>
      <span style={{
        color: "var(--text)", overflow: "hidden",
        textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0,
      }}>
        {children}
      </span>
      <span style={{ color: "var(--text-dim)", fontSize: 11 }}>→</span>
    </button>
  );
}

interface BCGroup {
  l1_domain: string;
  count: number;
  l2_groups: { l2_subdomain: string; leaves: { bc_id: string; bc_name: string; bc_name_cn?: string | null }[] }[];
}

function MajorAppChip({ app, onRemove }: { app: ScopeApp; onRemove: () => void }) {
  const [expanded, setExpanded] = useState(true);
  const [bcData, setBcData] = useState<BCGroup[] | null>(null);
  const [bcLoading, setBcLoading] = useState(false);

  // Auto-fetch BC data on mount
  useEffect(() => {
    (async () => {
      setBcLoading(true);
      try {
        const r = await fetch(`/api/apps/${encodeURIComponent(app.app_id)}/business-capabilities`);
        const j = await r.json();
        if (j.success) setBcData(j.data.l1_groups || []);
        else setBcData([]);
      } catch { setBcData([]); }
      finally { setBcLoading(false); }
    })();
  }, [app.app_id]);

  const toggleExpand = () => setExpanded((p) => !p);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      <span
        title={`${app.app_id} — ${app.name} (click to show business capabilities)`}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          background: expanded ? "var(--surface)" : "var(--bg-elevated)",
          border: `1px solid ${expanded ? "var(--accent)" : "var(--border-strong)"}`,
          borderRadius: expanded ? "3px 3px 0 0" : 3,
          padding: "4px 8px", fontSize: 12,
          minWidth: 0, cursor: "pointer",
        }}
        onClick={toggleExpand}
      >
        <span style={{ fontSize: 9, color: "var(--text-dim)", flexShrink: 0 }}>
          {expanded ? "\u25be" : "\u25b8"}
        </span>
        <code style={{
          color: "var(--accent)", fontFamily: "var(--font-mono)",
          flexShrink: 0, fontSize: 11,
        }}>
          {app.app_id}
        </code>
        <span style={{
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          minWidth: 0, flex: 1,
        }}>
          {app.name}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          aria-label={`Remove ${app.name}`}
          style={{
            background: "none", border: "none", color: "var(--text-dim)",
            cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0,
            flexShrink: 0,
          }}
        >{"\u00d7"}</button>
      </span>
      {/* BC context panel */}
      {expanded && (
        <div style={{
          border: "1px solid var(--accent)",
          borderTop: "none",
          borderRadius: "0 0 3px 3px",
          padding: "6px 10px",
          background: "var(--surface)",
          fontSize: 10,
          maxHeight: 240,
          overflowY: "auto",
        }}>
          {bcLoading ? (
            <span style={{ color: "var(--text-dim)" }}>Loading...</span>
          ) : !bcData || bcData.length === 0 ? (
            <span style={{ color: "var(--text-dim)" }}>No business capabilities mapped</span>
          ) : (
            bcData.map((l1) => (
              <div key={l1.l1_domain} style={{ marginBottom: 6 }}>
                <div style={{
                  fontSize: 9, fontWeight: 600, textTransform: "uppercase",
                  letterSpacing: 0.4, color: "var(--accent)", marginBottom: 2,
                }}>
                  {l1.l1_domain} ({l1.count})
                </div>
                {l1.l2_groups.map((l2) => (
                  <div key={l2.l2_subdomain} style={{ marginLeft: 8, marginBottom: 3 }}>
                    <div style={{ fontSize: 9, color: "var(--text-muted)", fontWeight: 500 }}>
                      {l2.l2_subdomain}
                    </div>
                    {l2.leaves.map((leaf) => (
                      <div key={leaf.bc_id} style={{
                        marginLeft: 8, fontSize: 10, color: "var(--text)",
                        display: "flex", gap: 4, alignItems: "baseline",
                      }}>
                        <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 8 }}>
                          {leaf.bc_id}
                        </span>
                        <span>{leaf.bc_name}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function InterfaceChip({
  row, onRemove,
}: {
  row: ScopedIfaceRow;
  onRemove: () => void;
}) {
  const arrow = row.role === "provider" ? "→" : "←";
  const counterId = row.counter_app_id || "(unlinked)";
  const counterName = row.counter_app_name || "";
  const platformColor = PLATFORM_COLORS[row.platform] || "#5f6a80";
  const ifaceLabel = row.interface_name || "(unnamed)";

  // Rich tooltip: full platform · iface · arrow · counter_id counter_name
  const fullText = `${row.platform} · ${ifaceLabel} ${arrow} ${counterId}${counterName ? ` ${counterName}` : ""}`;

  return (
    <span
      title={fullText}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        background: "var(--bg-elevated)", border: "1px solid var(--border-strong)",
        borderRadius: 3, padding: "4px 8px", fontSize: 12,
        width: 280, minWidth: 0,
      }}
    >
      <span style={{
        fontSize: 10, color: platformColor, background: `${platformColor}26`,
        padding: "1px 6px", borderRadius: 2, fontFamily: "var(--font-mono)",
        fontWeight: 600, flexShrink: 0,
      }}>
        {row.platform}
      </span>
      <span style={{
        fontFamily: "var(--font-mono)", fontSize: 11,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        minWidth: 0, flex: 1,
      }}>
        {ifaceLabel} <span style={{ color: "var(--text-dim)" }}>{arrow}</span>{" "}
        {row.counter_app_id && (
          <code style={{ color: "var(--accent)" }}>{row.counter_app_id}</code>
        )}
        {counterName && <> {counterName}</>}
        {!row.counter_app_id && <span style={{ color: "var(--text-dim)" }}>{counterId}</span>}
      </span>
      <button
        onClick={onRemove}
        aria-label="Remove interface"
        style={{
          background: "none", border: "none", color: "var(--text-dim)",
          cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0,
          flexShrink: 0,
        }}
      >×</button>
    </span>
  );
}

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
      {/* Thumbnail area. /thumbnail is an image/webp generated by the
          attachment server — rendered directly via <img>, which is much
          cleaner than wrapping /preview (which is text/html and leaves
          iframe scrollbars + whitespace around the image). */}
      <div style={{
        position: "relative",
        width: "100%",
        height: 160,
        background: "#1b1d25",
        borderBottom: "1px solid var(--border)",
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}>
        {thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbnailUrl}
            alt={`${title} thumbnail`}
            loading="lazy"
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              width: "auto",
              height: "auto",
              objectFit: "contain",
              display: "block",
            }}
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

/* ── Template step: Standard templates | Project solutions (filtered) ── */
/* ── Interfaces step: show all interfaces touching scope, grouped by
   scope_app + role. Checking a row adds the counterparty app to scope. ── */
// Three-level tree: platform → interface → counterparty.
// Default all collapsed; search auto-expands matches.
type PlatformBranch = {
  platform: string;
  interfaces: Array<{
    name: string;
    rows: ScopedIfaceRow[];
  }>;
};

function buildPlatformBranches(rows: ScopedIfaceRow[]): PlatformBranch[] {
  const byPlatform = new Map<string, Map<string, ScopedIfaceRow[]>>();
  for (const r of rows) {
    let platformMap = byPlatform.get(r.platform);
    if (!platformMap) {
      platformMap = new Map();
      byPlatform.set(r.platform, platformMap);
    }
    const key = r.interface_name || "(unnamed)";
    if (!platformMap.has(key)) platformMap.set(key, []);
    platformMap.get(key)!.push(r);
  }
  const branches: PlatformBranch[] = [];
  for (const [platform, platformMap] of byPlatform) {
    const interfaces: PlatformBranch["interfaces"] = [];
    for (const [name, ifaceRows] of platformMap) {
      interfaces.push({ name, rows: ifaceRows });
    }
    interfaces.sort((a, b) => a.name.localeCompare(b.name));
    branches.push({ platform, interfaces });
  }
  branches.sort((a, b) => a.platform.localeCompare(b.platform));
  return branches;
}

function rowMatchesSearch(row: ScopedIfaceRow, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return (
    (row.interface_name || "").toLowerCase().includes(needle) ||
    (row.counter_app_id || "").toLowerCase().includes(needle) ||
    (row.counter_app_name || "").toLowerCase().includes(needle) ||
    row.platform.toLowerCase().includes(needle)
  );
}

function InterfacesStep({
  scopeApps,
  scopedRows,
  keepIfaceIds,
  coverage,
  loading,
  onToggle,
  onClearAll,
}: {
  scopeApps: ScopeApp[];
  scopedRows: ScopedIfaceRow[];
  keepIfaceIds: Set<number>;
  coverage: Record<string, { total_catalog: number }>;
  loading: boolean;
  onToggle: (row: ScopedIfaceRow) => void;
  onClearAll: () => void;
}) {
  const scopeSet = new Set(scopeApps.map(a => a.app_id));

  // Expansion state — one global set, keys = full path.
  // Platform key: `${app_id}|${role}|${platform}`
  // Interface key: `${app_id}|${role}|${platform}|${interface_name}`
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const needle = search.trim();

  const toggleExpand = (key: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Group: Map<scope_app_id, {provider: PlatformBranch[], consumer: PlatformBranch[]}>
  const byApp = new Map<string, { provider: PlatformBranch[]; consumer: PlatformBranch[] }>();
  for (const app of scopeApps) {
    const appRows = scopedRows.filter(r => r.scope_app_id === app.app_id);
    byApp.set(app.app_id, {
      provider: buildPlatformBranches(appRows.filter(r => r.role === "provider")),
      consumer: buildPlatformBranches(appRows.filter(r => r.role === "consumer")),
    });
  }

  // Build all possible keys so expand-all / collapse-all work
  const allKeys = (() => {
    const keys: string[] = [];
    for (const [appId, g] of byApp) {
      for (const side of ["provider", "consumer"] as const) {
        const branches = side === "provider" ? g.provider : g.consumer;
        for (const b of branches) {
          keys.push(`${appId}|${side}|${b.platform}`);
          for (const i of b.interfaces) {
            keys.push(`${appId}|${side}|${b.platform}|${i.name}`);
          }
        }
      }
    }
    return keys;
  })();

  const expandAll = () => setExpanded(new Set(allKeys));
  const collapseAll = () => setExpanded(new Set());

  // If searching, auto-expand matching branches (computed on-the-fly,
  // not written to state so clearing search returns to user's previous state).
  const effectiveExpanded = new Set(expanded);
  if (needle) {
    for (const [appId, g] of byApp) {
      for (const side of ["provider", "consumer"] as const) {
        const branches = side === "provider" ? g.provider : g.consumer;
        for (const b of branches) {
          for (const i of b.interfaces) {
            if (i.rows.some(r => rowMatchesSearch(r, needle))) {
              effectiveExpanded.add(`${appId}|${side}|${b.platform}`);
              effectiveExpanded.add(`${appId}|${side}|${b.platform}|${i.name}`);
            }
          }
        }
      }
    }
  }

  if (scopeApps.length === 0) {
    return (
      <div className="panel" style={{ padding: 14, color: "var(--text-dim)", fontSize: 12 }}>
        No apps in scope yet. Go to the Apps tab first.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="panel" style={{ padding: 20, color: "var(--text-dim)", fontSize: 12 }}>
        Loading interfaces…
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {/* Toolbar */}
      <div
        className="panel"
        style={{
          padding: "10px 14px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontSize: 11,
          color: "var(--text-muted)",
          flexWrap: "wrap",
        }}
      >
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Filter by platform / interface name / app id / app name…"
          style={{
            flex: 1,
            minWidth: 260,
            padding: "4px 10px",
            fontSize: 12,
          }}
        />
        <button
          onClick={expandAll}
          style={{
            padding: "3px 10px", fontSize: 11, fontFamily: "var(--font-mono)",
            border: "1px solid var(--border)", background: "transparent",
            color: "var(--text-muted)", cursor: "pointer", borderRadius: 3,
          }}
        >
          Expand all
        </button>
        <button
          onClick={collapseAll}
          style={{
            padding: "3px 10px", fontSize: 11, fontFamily: "var(--font-mono)",
            border: "1px solid var(--border)", background: "transparent",
            color: "var(--text-muted)", cursor: "pointer", borderRadius: 3,
          }}
        >
          Collapse all
        </button>
        <button
          onClick={onClearAll}
          disabled={keepIfaceIds.size === 0}
          style={{
            padding: "3px 10px", fontSize: 11, fontFamily: "var(--font-mono)",
            border: "1px solid var(--border)", background: "transparent",
            color: keepIfaceIds.size === 0 ? "var(--text-dim)" : "var(--text-muted)",
            cursor: keepIfaceIds.size === 0 ? "default" : "pointer",
            borderRadius: 3,
          }}
        >
          Clear ({keepIfaceIds.size})
        </button>
        <div style={{ flexBasis: "100%", height: 0 }} />
        <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
          💡 Checking a row auto-adds the counterparty app to scope. All groups are collapsed by default — click a platform row to expand.
        </span>
      </div>

      {scopeApps.map(app => {
        const g = byApp.get(app.app_id)!;
        const cov = coverage[app.app_id] || { total_catalog: 0 };
        const providerTotal = g.provider.reduce((s, b) => s + b.interfaces.reduce((a, i) => a + i.rows.length, 0), 0);
        const consumerTotal = g.consumer.reduce((s, b) => s + b.interfaces.reduce((a, i) => a + i.rows.length, 0), 0);
        const hasAny = providerTotal + consumerTotal > 0;

        return (
          <div key={app.app_id} className="panel" style={{ padding: 0, overflow: "hidden" }}>
            {/* App header */}
            <div style={{
              padding: "8px 14px",
              borderBottom: "1px solid var(--border)",
              background: "var(--bg-elevated)",
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}>
              <code style={{
                fontFamily: "var(--font-mono)", color: "var(--accent)",
                fontSize: 12, fontWeight: 600,
              }}>
                {app.app_id}
              </code>
              <span style={{
                fontSize: 14, fontWeight: 600,
                fontFamily: "var(--font-display)",
              }}>{app.name}</span>
              <div style={{ flex: 1 }} />
              <span style={{ fontSize: 10, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
                {cov.total_catalog} catalog · {providerTotal} provider · {consumerTotal} consumer
              </span>
            </div>

            {!hasAny && (
              <div style={{ padding: 14, color: "var(--text-dim)", fontSize: 12 }}>
                {cov.total_catalog === 0
                  ? <>This app has <strong style={{ color: "#e8716b" }}>no catalog entries</strong> (not registered on any integration platform).</>
                  : "No interfaces match the current filter."}
              </div>
            )}

            {/* AS PROVIDER */}
            {g.provider.length > 0 && (
              <IfaceRoleTree
                scopeAppId={app.app_id}
                role="provider"
                title="📤 AS PROVIDER — interfaces this app exposes"
                color="#f6a623"
                branches={g.provider}
                expanded={effectiveExpanded}
                onToggleExpand={toggleExpand}
                keepIfaceIds={keepIfaceIds}
                scopeSet={scopeSet}
                onToggleRow={onToggle}
                search={needle}
              />
            )}
            {/* AS CONSUMER */}
            {g.consumer.length > 0 && (
              <IfaceRoleTree
                scopeAppId={app.app_id}
                role="consumer"
                title="📥 AS CONSUMER — interfaces this app uses"
                color="#6ba6e8"
                branches={g.consumer}
                expanded={effectiveExpanded}
                onToggleExpand={toggleExpand}
                keepIfaceIds={keepIfaceIds}
                scopeSet={scopeSet}
                onToggleRow={onToggle}
                search={needle}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function IfaceRoleTree({
  scopeAppId, role, title, color, branches,
  expanded, onToggleExpand,
  keepIfaceIds, scopeSet, onToggleRow,
  search,
}: {
  scopeAppId: string;
  role: "provider" | "consumer";
  title: string;
  color: string;
  branches: PlatformBranch[];
  expanded: Set<string>;
  onToggleExpand: (key: string) => void;
  keepIfaceIds: Set<number>;
  scopeSet: Set<string>;
  onToggleRow: (row: ScopedIfaceRow) => void;
  search: string;
}) {
  // Count total interfaces for role header
  const totalInterfaces = branches.reduce((s, b) => s + b.interfaces.length, 0);

  return (
    <div>
      <div style={{
        padding: "8px 14px",
        borderLeft: `3px solid ${color}`,
        fontSize: 13,
        fontFamily: "var(--font-display)",
        color,
        fontWeight: 600,
      }}>
        {title} <span style={{ color: "var(--text-dim)", fontWeight: 500 }}>({totalInterfaces} interfaces)</span>
      </div>

      {branches.map(branch => {
        const pColor = PLATFORM_COLORS[branch.platform] || "#5f6a80";
        const l1Key = `${scopeAppId}|${role}|${branch.platform}`;
        const l1Open = expanded.has(l1Key);

        // When searching, only show branches that have matching leaves
        const visibleInterfaces = search
          ? branch.interfaces.filter(i => i.rows.some(r => rowMatchesSearch(r, search)))
          : branch.interfaces;
        if (visibleInterfaces.length === 0) return null;

        return (
          <div key={branch.platform}>
            {/* L1: platform row */}
            <button
              onClick={() => onToggleExpand(l1Key)}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                width: "100%",
                padding: "6px 14px",
                background: "transparent",
                border: "none",
                borderTop: "1px solid var(--border)",
                color: "var(--text)",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <span style={{
                width: 14, textAlign: "center",
                color: l1Open ? color : "var(--text-dim)",
                fontSize: 12, fontFamily: "var(--font-mono)",
              }}>
                {l1Open ? "▾" : "▸"}
              </span>
              <span className="status-pill" style={{
                fontSize: 10, color: pColor,
                background: `${pColor}26`,
                padding: "2px 8px", minWidth: 64, textAlign: "center",
                fontFamily: "var(--font-mono)", fontWeight: 600,
              }}>
                {branch.platform}
              </span>
              <span style={{ color: "var(--text-dim)", fontSize: 12 }}>
                ({visibleInterfaces.length} interface{visibleInterfaces.length === 1 ? "" : "s"})
              </span>
            </button>

            {/* L2: interface rows */}
            {l1Open && visibleInterfaces.map(iface => {
              const l2Key = `${scopeAppId}|${role}|${branch.platform}|${iface.name}`;
              const l2Open = expanded.has(l2Key);

              const visibleRows = search
                ? iface.rows.filter(r => rowMatchesSearch(r, search))
                : iface.rows;

              const counterLabel = role === "provider" ? "consumer" : "provider";
              const kept = iface.rows.some(r => keepIfaceIds.has(r.interface_id));

              return (
                <div key={iface.name}>
                  <button
                    onClick={() => onToggleExpand(l2Key)}
                    style={{
                      display: "flex", alignItems: "center", gap: 8,
                      width: "100%",
                      padding: "5px 14px 5px 36px",
                      background: kept ? `${color}08` : "transparent",
                      border: "none",
                      borderTop: "1px dashed var(--border)",
                      color: "var(--text)",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <span style={{
                      width: 14, textAlign: "center",
                      color: l2Open ? color : "var(--text-dim)",
                      fontSize: 12, fontFamily: "var(--font-mono)",
                    }}>
                      {l2Open ? "▾" : "▸"}
                    </span>
                    <span style={{
                      fontFamily: "var(--font-mono)", fontSize: 12,
                      wordBreak: "break-all", flex: 1,
                    }}>
                      {iface.name}
                    </span>
                    <span style={{ color: "var(--text-dim)", fontSize: 12 }}>
                      ({visibleRows.length} {counterLabel}{visibleRows.length === 1 ? "" : "s"})
                    </span>
                  </button>

                  {/* L3: counterparty rows */}
                  {l2Open && visibleRows.map(row => {
                    const rowKept = keepIfaceIds.has(row.interface_id);
                    const counterInScope = row.counter_app_id ? scopeSet.has(row.counter_app_id) : false;
                    const counterUnlinked = !row.counter_app_id || row.counter_app_id === "__UNLINKED__";
                    return (
                      <button
                        key={`${row.interface_id}-${row.counter_app_id || "u"}`}
                        type="button"
                        onClick={() => !counterUnlinked && onToggleRow(row)}
                        disabled={counterUnlinked}
                        aria-pressed={rowKept}
                        title={counterUnlinked ? "Counterparty is unlinked; can't add to scope" : (rowKept ? "Click to remove from scope" : "Click to add to scope")}
                        style={{
                          display: "flex", alignItems: "center", gap: 8,
                          width: "100%",
                          padding: "5px 14px 5px 60px",
                          borderTop: "1px dotted var(--border)",
                          borderLeft: rowKept ? `2px solid ${color}` : "2px solid transparent",
                          borderRight: "none",
                          borderBottom: "none",
                          background: rowKept ? `${color}14` : "transparent",
                          opacity: rowKept ? 1 : (counterUnlinked ? 0.55 : 0.88),
                          cursor: counterUnlinked ? "not-allowed" : "pointer",
                          textAlign: "left",
                          color: "var(--text)",
                          fontFamily: "var(--font-body)",
                          transition: "background var(--t-hover) var(--ease), border-color var(--t-hover) var(--ease), opacity var(--t-hover) var(--ease)",
                        }}
                      >
                        <span style={{ color: "var(--text-dim)", fontSize: 12 }}>
                          {row.role === "provider" ? "→" : "←"}
                        </span>
                        {counterUnlinked ? (
                          <span style={{ color: "var(--text-dim)", fontSize: 12 }}>(unlinked)</span>
                        ) : (
                          <>
                            <code style={{
                              fontFamily: "var(--font-mono)", fontSize: 12,
                              color: "var(--accent)", minWidth: 72,
                            }}>
                              {row.counter_app_id}
                            </code>
                            {row.counter_app_name && (
                              <span style={{ color: "var(--text)", fontSize: 12, flex: 1 }}>
                                {row.counter_app_name}
                              </span>
                            )}
                            {!counterInScope && (
                              <span
                                title="Will be added to scope when you check this row"
                                style={{
                                  fontSize: 10, color: "#5fc58a",
                                  fontFamily: "var(--font-mono)",
                                  padding: "2px 6px",
                                  border: "1px solid #5fc58a",
                                  borderRadius: 3,
                                }}
                              >
                                +scope
                              </span>
                            )}
                          </>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function TemplateStep({
  scopeApps,
  templates,
  templateId,
  chooseTemplate,
}: {
  scopeApps: ScopeApp[];
  templates: TemplateRow[];
  templateId: number | null;
  chooseTemplate: (id: number | null, title: string | null) => void;
}) {
  const [source, setSource] = useState<"standard" | "project">("standard");
  const [solutions, setSolutions] = useState<ProjectSolutionGroup[]>([]);
  const [loadingSolutions, setLoadingSolutions] = useState(false);

  // Fetch project solutions when switching to project source, filtered by scope apps.
  useEffect(() => {
    if (source !== "project") return;
    if (scopeApps.length === 0) { setSolutions([]); return; }
    setLoadingSolutions(true);
    (async () => {
      try {
        const appIds = scopeApps.map(a => a.app_id).join(",");
        const r = await fetch(
          `/api/design/project-solutions?app_ids=${encodeURIComponent(appIds)}`,
          { cache: "no-store" }
        );
        const j = await r.json();
        if (j.success) setSolutions(j.data.projects || []);
      } catch { /* ignore */ }
      setLoadingSolutions(false);
    })();
  }, [source, scopeApps]);

  return (
    <div>
      {/* Inner tabs */}
      <div style={{ display: "flex", gap: 2, marginBottom: 14 }}>
        {[
          { key: "standard" as const, label: "Standard Templates", count: templates.length },
          {
            key: "project" as const,
            label: "Project Solutions",
            count: scopeApps.length === 0 ? null : solutions.length,
            note: scopeApps.length === 0 ? "(select apps first)" : null,
          },
        ].map(t => {
          const active = source === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setSource(t.key)}
              style={{
                padding: "8px 14px",
                border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
                background: active ? "var(--accent-dim)" : "transparent",
                color: active ? "var(--accent)" : "var(--text)",
                fontSize: 12,
                fontFamily: "var(--font-mono)",
                cursor: "pointer",
              }}
            >
              {t.label}
              {t.count != null && (
                <span style={{ opacity: 0.6, marginLeft: 8 }}>({t.count})</span>
              )}
              {t.note && (
                <span style={{ opacity: 0.6, marginLeft: 8, fontSize: 10 }}>
                  {t.note}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Blank canvas card — always visible at top */}
      <div style={{ marginBottom: 12 }}>
        <TemplateCard
          title="Blank canvas"
          subtitle="Start from scratch"
          description="Empty drawio — only your apps + interfaces will be drawn."
          selected={templateId === null}
          onSelect={() => chooseTemplate(null, null)}
        />
      </div>

      {/* ── Standard Templates ── */}
      {source === "standard" && (
        <>
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 12,
          }}>
            {templates.map(t => (
              <TemplateCard
                key={t.attachment_id}
                title={t.title}
                subtitle={t.page_title || null}
                description={`standard · #${t.attachment_id}`}
                selected={templateId === t.attachment_id}
                onSelect={() => chooseTemplate(t.attachment_id, t.title)}
                previewUrl={`/api/admin/confluence/attachments/${t.attachment_id}/preview`}
                thumbnailUrl={`/api/admin/confluence/attachments/${t.attachment_id}/thumbnail`}
              />
            ))}
          </div>
          {templates.length === 0 && (
            <div style={{
              color: "var(--text-dim)",
              fontSize: 12,
              padding: 14,
              border: "1px dashed var(--border)",
              borderRadius: "var(--radius-md)",
            }}>
              <div style={{ marginBottom: 6 }}>
                No standard templates registered yet.
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                Configure template source pages in{" "}
                <Link href="/settings" style={{ color: "var(--accent)" }}>
                  Settings → Architecture Templates
                </Link>
                . Drawios on those pages (or their sub-pages) will appear here.
                In the meantime, use <strong>Blank canvas</strong> or switch
                to <strong>Project Solutions</strong>.
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Project Solutions ── */}
      {source === "project" && (
        <>
          {scopeApps.length === 0 && (
            <div style={{ color: "var(--text-dim)", fontSize: 12, padding: 12 }}>
              Go to the Apps tab first — project solutions are filtered by
              which of your scope apps appear in each project's diagrams.
            </div>
          )}
          {scopeApps.length > 0 && loadingSolutions && (
            <div style={{ color: "var(--text-dim)", fontSize: 12, padding: 12 }}>
              Loading project solutions…
            </div>
          )}
          {scopeApps.length > 0 && !loadingSolutions && solutions.length === 0 && (
            <div style={{ color: "var(--text-dim)", fontSize: 12, padding: 12 }}>
              No project solutions found that reference your selected apps.
            </div>
          )}
          {scopeApps.length > 0 && solutions.map(proj => (
            <div
              key={`${proj.project_id}-${proj.fiscal_year || "none"}`}
              className="panel"
              style={{ padding: 12, marginBottom: 12 }}
            >
              {/* Project header */}
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8 }}>
                <code style={{ color: "var(--accent)", fontFamily: "var(--font-mono)", fontSize: 12 }}>
                  {proj.project_id}
                </code>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", flex: 1 }}>
                  {proj.project_name || "(unnamed project)"}
                </span>
                {proj.fiscal_year && (
                  <span style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
                    {proj.fiscal_year}
                  </span>
                )}
                <span className="status-pill" style={{
                  fontSize: 10,
                  color: "var(--accent)",
                  background: "var(--accent-dim)",
                  padding: "2px 8px",
                }}>
                  {proj.referenced_scope_apps.length} of your apps
                </span>
              </div>
              {proj.referenced_scope_apps.length > 0 && (
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>
                  References: {proj.referenced_scope_apps.slice(0, 10).join(", ")}
                  {proj.referenced_scope_apps.length > 10 && ` +${proj.referenced_scope_apps.length - 10} more`}
                </div>
              )}
              {/* Diagram cards in this project */}
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
                gap: 10,
              }}>
                {proj.diagrams.map(d => (
                  <TemplateCard
                    key={d.attachment_id}
                    title={d.title}
                    subtitle={d.page_title !== d.title ? d.page_title : null}
                    description={`project solution · #${d.attachment_id}`}
                    selected={templateId === d.attachment_id}
                    onSelect={() => chooseTemplate(d.attachment_id, d.title)}
                    previewUrl={`/api/admin/confluence/attachments/${d.attachment_id}/preview`}
                    thumbnailUrl={`/api/admin/confluence/attachments/${d.attachment_id}/thumbnail`}
                  />
                ))}
              </div>
            </div>
          ))}
        </>
      )}
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
