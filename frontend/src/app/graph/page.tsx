"use client";

import { useEffect, useRef, useState } from "react";
import cytoscape, { Core, ElementDefinition } from "cytoscape";
import { api, ApplicationNode, IntegrationEdge } from "@/lib/api";

// Read URL query params at module scope — only runs in the browser.
function initialParam(key: string): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get(key) || "";
}

const STATUS_COLORS: Record<string, string> = {
  Keep: "#6ba6e8",
  Change: "#e8b458",
  New: "#e8716b",
  Sunset: "#6b7488",
  "3rd Party": "#a8b0c0",
};

export default function GraphPage() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);
  const [selected, setSelected] = useState<{
    node?: ApplicationNode;
    edge?: IntegrationEdge;
  } | null>(null);
  // Initialize from URL query params so dashboard deep links work.
  const [fy, setFy] = useState<string>(() => initialParam("fiscal_year"));
  const [status, setStatus] = useState<string>(() => initialParam("status"));
  const [search, setSearch] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);
  const [empty, setEmpty] = useState<boolean>(false);

  useEffect(() => {
    loadGraph();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fy, status]);

  async function loadGraph() {
    try {
      setErr(null);
      const data = await api.fullGraph({ fiscal_year: fy || undefined, status: status || undefined });
      const elements: ElementDefinition[] = [];
      for (const n of data.nodes) {
        elements.push({
          data: { id: n.app_id, label: n.name || n.app_id, status: n.status, raw: n },
        });
      }
      for (const e of data.edges) {
        elements.push({
          data: {
            id: `${e.source_app_id}->${e.target_app_id}-${e.interaction_type || ""}`,
            source: e.source_app_id,
            target: e.target_app_id,
            label: e.interaction_type || "",
            raw: e,
          },
        });
      }
      setEmpty(elements.length === 0);
      if (cyRef.current) {
        cyRef.current.destroy();
      }
      if (!containerRef.current || elements.length === 0) return;

      const cy = cytoscape({
        container: containerRef.current,
        elements,
        style: [
          {
            selector: "node",
            style: {
              "background-color": (ele: cytoscape.NodeSingular) =>
                STATUS_COLORS[ele.data("status")] || "#6ba6e8",
              "border-width": 2,
              "border-color": "#07090d",
              label: "data(label)",
              color: "#e7eaf0",
              "font-family": "Geist, -apple-system, sans-serif",
              "font-size": 11,
              "font-weight": 500,
              "text-outline-color": "#07090d",
              "text-outline-width": 3,
              "text-valign": "bottom",
              "text-margin-y": 6,
              width: 28,
              height: 28,
            },
          },
          {
            selector: "edge",
            style: {
              "curve-style": "bezier",
              "target-arrow-shape": "triangle",
              "line-color": "#2a3142",
              "target-arrow-color": "#2a3142",
              width: 1.2,
              label: "data(label)",
              "font-family": "Geist, -apple-system, sans-serif",
              "font-size": 9,
              color: "#5f6a80",
              "text-rotation": "autorotate",
            },
          },
          {
            selector: ".faded",
            style: { opacity: 0.12 },
          },
          {
            selector: ".highlighted",
            style: {
              "border-width": 3,
              "border-color": "#f6a623",
              "border-opacity": 0.9,
            },
          },
          {
            selector: "node:selected",
            style: {
              "border-width": 3,
              "border-color": "#f6a623",
            },
          },
        ],
        layout: { name: "cose", animate: false, nodeRepulsion: 9000, idealEdgeLength: 130 },
      });

      cy.on("tap", "node", (evt) => {
        const node = evt.target;
        setSelected({ node: node.data("raw") });
      });
      cy.on("tap", "edge", (evt) => {
        const edge = evt.target;
        setSelected({ edge: edge.data("raw") });
      });
      cy.on("tap", (evt) => {
        if (evt.target === cy) setSelected(null);
      });

      cyRef.current = cy;
    } catch (e) {
      setErr(String(e));
    }
  }

  function focusSearch() {
    const cy = cyRef.current;
    if (!cy || !search) return;
    cy.elements().removeClass("faded").removeClass("highlighted");
    const match = cy.nodes().filter((n) => {
      const label = (n.data("label") || "").toLowerCase();
      const id = (n.data("id") || "").toLowerCase();
      return label.includes(search.toLowerCase()) || id.includes(search.toLowerCase());
    });
    if (match.length === 0) return;
    const neighborhood = match.closedNeighborhood();
    cy.elements().difference(neighborhood).addClass("faded");
    match.addClass("highlighted");
    cy.fit(neighborhood, 80);
  }

  return (
    <div>
      <h1>Asset Graph</h1>
      <p className="subtitle">Applications and their integrations, from draw.io ingestion</p>

      <div className="toolbar">
        <input
          placeholder="Search by name or app ID…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && focusSearch()}
          style={{ minWidth: 280 }}
        />
        <button onClick={focusSearch}>Focus</button>
        <select value={fy} onChange={(e) => setFy(e.target.value)}>
          <option value="">All fiscal years</option>
          <option value="FY2122">FY2122</option>
          <option value="FY2223">FY2223</option>
          <option value="FY2324">FY2324</option>
          <option value="FY2425">FY2425</option>
          <option value="FY2526">FY2526</option>
          <option value="FY2627">FY2627</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="Keep">Keep</option>
          <option value="Change">Change</option>
          <option value="New">New</option>
          <option value="Sunset">Sunset</option>
          <option value="3rd Party">3rd Party</option>
        </select>
        <button className="btn-secondary" onClick={loadGraph}>
          Reload
        </button>
      </div>

      {err && (
        <div className="panel" style={{ borderColor: "#5b1f1f", marginBottom: 12 }}>
          Error: {err}
        </div>
      )}

      <div className="graph-wrap">
        {empty && <div className="empty">Graph is empty. Run an ingestion task first.</div>}
        <div id="cy" ref={containerRef} />
        <div className="graph-legend">
          {Object.entries(STATUS_COLORS).map(([k, v]) => (
            <div key={k}>
              <span className="dot" style={{ background: v }} /> {k}
            </div>
          ))}
        </div>
      </div>

      {selected?.node && (
        <div className="panel" style={{ marginTop: 14 }}>
          <div className="panel-title">Application Detail</div>
          <table>
            <tbody>
              <tr>
                <th>App ID</th>
                <td>{selected.node.app_id}</td>
              </tr>
              <tr>
                <th>Name</th>
                <td>{selected.node.name}</td>
              </tr>
              <tr>
                <th>Status</th>
                <td>{selected.node.status}</td>
              </tr>
              <tr>
                <th>Source Project</th>
                <td>{selected.node.source_project_id}</td>
              </tr>
              <tr>
                <th>Fiscal Year</th>
                <td>{selected.node.source_fiscal_year}</td>
              </tr>
              {selected.node.description && (
                <tr>
                  <th>Description</th>
                  <td>{selected.node.description}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {selected?.edge && (
        <div className="panel" style={{ marginTop: 14 }}>
          <div className="panel-title">Integration Detail</div>
          <table>
            <tbody>
              <tr>
                <th>Source</th>
                <td>{selected.edge.source_app_id}</td>
              </tr>
              <tr>
                <th>Target</th>
                <td>{selected.edge.target_app_id}</td>
              </tr>
              <tr>
                <th>Type</th>
                <td>{selected.edge.interaction_type || "—"}</td>
              </tr>
              <tr>
                <th>Business Object</th>
                <td>{selected.edge.business_object || "—"}</td>
              </tr>
              <tr>
                <th>Protocol</th>
                <td>{selected.edge.protocol || "—"}</td>
              </tr>
              <tr>
                <th>Status</th>
                <td>{selected.edge.status}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
