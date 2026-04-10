"use client";

import { useEffect, useState } from "react";
import { api, IngestionTask } from "@/lib/api";

const FY_OPTIONS = ["FY2122", "FY2223", "FY2324", "FY2425", "FY2526", "FY2627"];

export default function IngestionPage() {
  const [tasks, setTasks] = useState<IngestionTask[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set(["FY2526"]));
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    try {
      const data = await api.listTasks();
      setTasks(data);
    } catch (e) {
      setErr(String(e));
    }
  }

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  }, []);

  function toggle(fy: string) {
    const next = new Set(selected);
    if (next.has(fy)) next.delete(fy);
    else next.add(fy);
    setSelected(next);
  }

  async function run() {
    if (selected.size === 0) return;
    setRunning(true);
    setErr(null);
    try {
      await api.runIngestion(Array.from(selected));
      await refresh();
    } catch (e) {
      setErr(String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div>
      <h1>Ingestion Console</h1>
      <p className="subtitle">
        Trigger Confluence draw.io ingestion and review task history & AI quality evaluation
      </p>

      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-title">Run Ingestion</div>
        <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
          {FY_OPTIONS.map((fy) => (
            <label key={fy} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                type="checkbox"
                checked={selected.has(fy)}
                onChange={() => toggle(fy)}
              />
              {fy}
            </label>
          ))}
        </div>
        <button onClick={run} disabled={running || selected.size === 0}>
          {running ? "Starting…" : `Start ingestion (${selected.size} FY)`}
        </button>
        {err && (
          <div style={{ marginTop: 10, color: "#f4857c" }}>Error: {err}</div>
        )}
      </div>

      <div className="panel">
        <div className="panel-title">Task History</div>
        {tasks.length === 0 ? (
          <div className="empty">No tasks yet.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Task</th>
                <th>Fiscal Years</th>
                <th>Status</th>
                <th>Projects</th>
                <th>Apps</th>
                <th>Integrations</th>
                <th>Started</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.task_id}>
                  <td><code>{t.task_id}</code></td>
                  <td>{t.fiscal_years.join(", ")}</td>
                  <td>
                    <span className={`status-pill status-${t.status}`}>{t.status}</span>
                  </td>
                  <td>
                    {t.success_count}/{t.total_projects}
                    {t.error_count > 0 && <span style={{ color: "#f4857c" }}> ({t.error_count} errs)</span>}
                  </td>
                  <td>{t.new_applications}</td>
                  <td>{t.new_interactions}</td>
                  <td>{new Date(t.started_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
