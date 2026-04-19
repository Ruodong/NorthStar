"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useCallback } from "react";
import cytoscape, { Core, ElementDefinition } from "cytoscape";

const STATUS_COLORS: Record<string, string> = {
  Keep: "#6ba6e8",
  Change: "#e8b458",
  New: "#e8716b",
  Sunset: "#6b7488",
  "3rd Party": "#a8b0c0",
  Active: "#5fc58a",
  Planned: "#6ba6e8",
  Decommissioned: "#6b7488",
};

interface SearchResult {
  app_id: string;
  name: string;
  kind: string;
  status?: string;
}

interface NeighborNode {
  app_id: string;
  name: string;
  status: string;
  cmdb_linked?: boolean;
  description?: string;
}

interface NeighborEdge {
  source: string;
  target: string;
  type: string;
  status?: string;
}

interface SelectedNode {
  app_id: string;
  name: string;
  status: string;
  cmdb_linked?: boolean;
  description?: string;
}

interface SelectedEdge {
  source: string;
  target: string;
  type: string;
  status?: string;
}

export default function GraphPage() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);

  const [search, setSearch] = useState("");
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [depth, setDepth] = useState(2);
  const [rootApp, setRootApp] = useState<string | null>(null);
  const [rootName, setRootName] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [nodeCount, setNodeCount] = useState(0);
  const [edgeCount, setEdgeCount] = useState(0);
  const [selected, setSelected] = useState<{
    node?: SelectedNode;
    edge?: SelectedEdge;
  } | null>(null);

  // Debounced search suggestions
  useEffect(() => {
    if (search.length < 2) {
      setSuggestions([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(search)}&limit=8`, { cache: "no-store" });
        const j = await r.json();
        if (j.success && j.data) {
          const apps = (j.data.applications || []).map((a: Record<string, string>) => ({
            app_id: a.app_id,
            name: a.name,
            kind: "app",
            status: a.status,
          }));
          setSuggestions(apps.slice(0, 8));
          setShowSuggestions(true);
        }
      } catch { /* ignore */ }
    }, 200);
    return () => clearTimeout(t);
  }, [search]);

  const loadNeighbors = useCallback(async (appId: string, d: number) => {
    setLoading(true);
    setErr(null);
    setSelected(null);
    try {
      const r = await fetch(`/api/graph/nodes/${encodeURIComponent(appId)}/neighbors?depth=${d}`, { cache: "no-store" });
      const j = await r.json();
      if (!j.success) throw new Error(j.error || "Not found");

      const data = j.data;
      if (!data.root) throw new Error(`${appId} has no integration data in the graph yet. It may exist in CMDB but has not appeared in any architecture diagram.`);

      const elements: ElementDefinition[] = [];
      const root = data.root;
      const rootId = root.app_id;

      // Build adjacency for BFS depth computation
      const adj: Record<string, Set<string>> = {};
      for (const e of data.edges || []) {
        if (!adj[e.source]) adj[e.source] = new Set();
        if (!adj[e.target]) adj[e.target] = new Set();
        adj[e.source].add(e.target);
        adj[e.target].add(e.source);
      }

      // BFS from root to assign depth
      const depthMap: Record<string, number> = { [rootId]: 0 };
      const queue = [rootId];
      while (queue.length > 0) {
        const cur = queue.shift()!;
        for (const nb of adj[cur] || []) {
          if (depthMap[nb] === undefined) {
            depthMap[nb] = depthMap[cur] + 1;
            queue.push(nb);
          }
        }
      }

      // Root node
      elements.push({
        data: {
          id: rootId,
          label: root.name || rootId,
          status: root.status || "",
          isRoot: true,
          depth: 0,
          raw: root,
        },
      });

      // Neighbor nodes
      for (const n of data.nodes || []) {
        if (n.app_id === rootId) continue;
        if (n.app_id?.startsWith("X")) continue;
        elements.push({
          data: {
            id: n.app_id,
            label: n.name || n.app_id,
            status: n.status || "",
            isRoot: false,
            depth: depthMap[n.app_id] ?? 2,
            raw: n,
          },
        });
      }

      const nodeIds = new Set(elements.map((e) => e.data.id));

      // Edges
      for (const e of data.edges || []) {
        if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) continue;
        elements.push({
          data: {
            id: `${e.source}->${e.target}-${e.type || ""}`,
            source: e.source,
            target: e.target,
            label: e.type || "",
            raw: e,
          },
        });
      }

      const nNodes = elements.filter((e) => !e.data.source).length;
      const nEdges = elements.filter((e) => e.data.source).length;
      setNodeCount(nNodes);
      setEdgeCount(nEdges);

      // Render
      if (cyRef.current) cyRef.current.destroy();
      if (!containerRef.current || elements.length === 0) return;

      const cy = cytoscape({
        container: containerRef.current,
        elements,
        style: [
          {
            selector: "node",
            style: {
              "background-color": (ele: cytoscape.NodeSingular) => {
                const depth = ele.data("depth") ?? 1;
                if (depth === 0) return "#f6a623"; // root: amber
                if (depth === 1) return "#5fc58a"; // layer 1: green
                return "#6ba6e8"; // layer 2+: blue
              },
              "background-opacity": (ele: cytoscape.NodeSingular) => {
                const depth = ele.data("depth") ?? 1;
                return depth === 0 ? 1 : depth === 1 ? 0.85 : 0.6;
              },
              "border-width": 1,
              "border-color": "#1a1f2e",
              label: "data(label)",
              color: "#c0c6d4",
              "font-family": "Geist, -apple-system, sans-serif",
              "font-size": 9,
              "font-weight": 400,
              "text-outline-color": "#07090d",
              "text-outline-width": 2,
              "text-valign": "bottom",
              "text-margin-y": 4,
              width: 18,
              height: 18,
            },
          },
          {
            selector: "node[?isRoot]",
            style: {
              width: 30,
              height: 30,
              "border-width": 2,
              "border-color": "#f6a623",
              "font-size": 12,
              "font-weight": 600,
              color: "#f6a623",
            },
          },
          {
            selector: "edge",
            style: {
              "curve-style": "bezier",
              "target-arrow-shape": "triangle",
              "target-arrow-color": "#1e2536",
              "line-color": "#1e2536",
              width: 0.7,
              "arrow-scale": 0.6,
              label: "data(label)",
              "font-family": "Geist, -apple-system, sans-serif",
              "font-size": 7,
              color: "#3a4560",
              "text-rotation": "autorotate",
              "text-opacity": 0.7,
            },
          },
          {
            selector: "node:selected",
            style: {
              "border-width": 2,
              "border-color": "#f6a623",
              width: 24,
              height: 24,
            },
          },
        ],
        layout: {
          name: "cose",
          animate: false,
          nodeRepulsion: 16000,
          idealEdgeLength: 160,
          gravity: 0.25,
        },
      });

      cy.on("tap", "node", (evt) => {
        setSelected({ node: evt.target.data("raw") });
      });
      cy.on("tap", "edge", (evt) => {
        setSelected({ edge: evt.target.data("raw") });
      });
      cy.on("tap", (evt) => {
        if (evt.target === cy) setSelected(null);
      });
      // Double-click node to re-center graph on that app
      cy.on("dbltap", "node", (evt) => {
        const appId = evt.target.data("id");
        if (appId && appId !== rootApp) {
          setRootApp(appId);
          setRootName(evt.target.data("label") || appId);
          setSearch(evt.target.data("label") || appId);
        }
      });

      cyRef.current = cy;
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }, [rootApp]);

  // Load when rootApp or depth changes
  useEffect(() => {
    if (rootApp) loadNeighbors(rootApp, depth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootApp, depth]);

  function selectApp(app: SearchResult) {
    setRootApp(app.app_id);
    setRootName(app.name);
    setSearch(app.name);
    setShowSuggestions(false);
  }

  function handleSearchSubmit() {
    if (suggestions.length > 0) {
      selectApp(suggestions[0]);
    }
    setShowSuggestions(false);
  }

  return (
    <div>
      <h1>Asset Graph</h1>
      <p className="subtitle">
        Search for an application to explore its integration network.
        {rootName && (
          <> Showing <strong style={{ color: "var(--accent)" }}>{rootName}</strong> and {nodeCount - 1} connected apps, {edgeCount} integrations.</>
        )}
      </p>

      <div className="toolbar" style={{ position: "relative" }}>
        <div style={{ position: "relative", minWidth: 360 }}>
          <input
            placeholder={"Search application name or ID\u2026"}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setShowSuggestions(true); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSearchSubmit();
              if (e.key === "Escape") setShowSuggestions(false);
            }}
            onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
            style={{ width: "100%" }}
          />
          {showSuggestions && suggestions.length > 0 && (
            <div
              style={{
                position: "absolute",
                top: "100%",
                left: 0,
                right: 0,
                background: "var(--surface)",
                border: "1px solid var(--border-strong)",
                borderRadius: "var(--radius-md)",
                marginTop: 4,
                zIndex: 100,
                maxHeight: 320,
                overflow: "auto",
              }}
            >
              {suggestions.map((s) => (
                <button
                  key={s.app_id}
                  onClick={() => selectApp(s)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    width: "100%",
                    padding: "8px 12px",
                    background: "transparent",
                    border: "none",
                    borderBottom: "1px solid var(--border)",
                    color: "var(--text)",
                    fontSize: 13,
                    cursor: "pointer",
                    textAlign: "left",
                    fontFamily: "var(--font-body)",
                  }}
                  onMouseOver={(e) => { e.currentTarget.style.background = "var(--surface-hover)"; }}
                  onMouseOut={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  <code style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--accent)", minWidth: 70 }}>
                    {s.app_id}
                  </code>
                  <span style={{ flex: 1 }}>{s.name}</span>
                  {s.status && (
                    <span className="status-pill" style={{
                      fontSize: 10,
                      color: STATUS_COLORS[s.status] || "var(--text-muted)",
                      background: `${STATUS_COLORS[s.status] || "#5f6a80"}26`,
                    }}>
                      {s.status}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>Depth</span>
          {[1, 2, 3].map((d) => (
            <button
              key={d}
              onClick={() => setDepth(d)}
              style={{
                padding: "4px 10px",
                fontSize: 12,
                border: `1px solid ${d === depth ? "var(--accent)" : "var(--border)"}`,
                background: d === depth ? "var(--accent-dim)" : "transparent",
                color: d === depth ? "var(--accent)" : "var(--text-dim)",
                borderRadius: "var(--radius-sm)",
                cursor: "pointer",
                fontFamily: "var(--font-mono)",
              }}
            >
              {d}
            </button>
          ))}
        </div>

        <div style={{ flex: 1 }} />

        {loading && (
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-dim)" }}>
            loading{"\u2026"}
          </span>
        )}
      </div>

      {err && (
        <div className="panel" style={{ borderColor: "#5b1f1f", marginBottom: 12 }}>
          Error: {err}
        </div>
      )}

      <div className="graph-wrap">
        {!rootApp && !loading && (
          <div className="empty">
            Search for an application above to explore its integration network.
            <br />
            <span style={{ color: "var(--text-dim)", fontSize: 12 }}>
              Double-click any node in the graph to re-center on it.
            </span>
          </div>
        )}
        <div id="cy" ref={containerRef} />
        <div className="graph-legend">
          {Object.entries(STATUS_COLORS).filter(([k]) => ["Keep", "Change", "New", "Sunset", "3rd Party"].includes(k)).map(([k, v]) => (
            <div key={k}>
              <span className="dot" style={{ background: v }} /> {k}
            </div>
          ))}
          <div>
            <span className="dot" style={{ background: "#f6a623", border: "2px solid #f6a623" }} /> Root
          </div>
        </div>
      </div>

      {/* ── Detail panel ── */}
      {selected?.node && (
        <div className="panel" style={{ marginTop: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div className="panel-title" style={{ margin: 0 }}>Application</div>
            <Link
              href={`/apps/${encodeURIComponent(selected.node.app_id)}`}
              style={{ color: "var(--accent)", fontSize: 12 }}
            >
              Open detail \u2192
            </Link>
          </div>
          <table>
            <tbody>
              <tr><th style={{ width: 100 }}>App ID</th><td><code>{selected.node.app_id}</code></td></tr>
              <tr><th>Name</th><td>{selected.node.name}</td></tr>
              <tr><th>Status</th><td>{selected.node.status}</td></tr>
              {selected.node.description && (
                <tr><th>Description</th><td style={{ fontSize: 12, color: "var(--text-muted)" }}>{selected.node.description}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {selected?.edge && (
        <div className="panel" style={{ marginTop: 14 }}>
          <div className="panel-title">Integration</div>
          <table>
            <tbody>
              <tr><th style={{ width: 100 }}>Source</th><td><code>{selected.edge.source}</code></td></tr>
              <tr><th>Target</th><td><code>{selected.edge.target}</code></td></tr>
              <tr><th>Type</th><td>{selected.edge.type || "\u2014"}</td></tr>
              <tr><th>Status</th><td>{selected.edge.status || "\u2014"}</td></tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
