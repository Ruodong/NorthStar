"use client";

import { useEffect, useState } from "react";

interface AppRow {
  app_id: string;
  name: string;
  status: string;
  short_description: string | null;
}

interface ListResult {
  total: number;
  rows: AppRow[];
}

const PAGE_SIZE = 50;

const STATUS_COLORS: Record<string, string> = {
  Active: "#5fc58a",
  Planned: "#6ba6e8",
  Decommissioned: "#6b7488",
  Retain: "#e8b458",
};

export default function AdminApplications() {
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(0);
  const [data, setData] = useState<ListResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    setPage(0);
  }, [qDebounced, status]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const params = new URLSearchParams();
        if (qDebounced) params.set("q", qDebounced);
        if (status) params.set("status", status);
        params.set("limit", String(PAGE_SIZE));
        params.set("offset", String(page * PAGE_SIZE));
        const r = await fetch(`/api/masters/applications?${params}`, { cache: "no-store" });
        const j = await r.json();
        if (!j.success) throw new Error(j.error);
        setData(j.data);
      } catch (e) {
        setErr(String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [qDebounced, status, page]);

  const total = data?.total ?? 0;
  const maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

  return (
    <div>
      <h1>Applications (CMDB)</h1>
      <p className="subtitle">
        Application master data from Lenovo CMDB, synced via EGM. 3,168 rows.
      </p>

      <div className="toolbar">
        <input
          placeholder="Search by name or app ID (e.g. A003559, EAM)…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ minWidth: 320 }}
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="Active">Active</option>
          <option value="Planned">Planned</option>
          <option value="Decommissioned">Decommissioned</option>
          <option value="Retain">Retain</option>
        </select>
        <div style={{ flex: 1 }} />
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            color: "var(--text-dim)",
          }}
        >
          {loading ? "loading…" : `${total.toLocaleString()} results`}
        </div>
      </div>

      {err && <div className="panel" style={{ borderColor: "#5b1f1f" }}>Error: {err}</div>}

      <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
        <table>
          <thead>
            <tr>
              <th style={{ width: 120 }}>App ID</th>
              <th>Name</th>
              <th style={{ width: 140 }}>Status</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((r) => (
              <tr key={r.app_id}>
                <td>
                  <code>{r.app_id}</code>
                </td>
                <td style={{ color: "var(--text)" }}>{r.name}</td>
                <td>
                  <span
                    className="status-pill"
                    style={{
                      color: STATUS_COLORS[r.status] || "var(--text-muted)",
                      background: `${STATUS_COLORS[r.status] || "#5f6a80"}26`,
                    }}
                  >
                    {r.status}
                  </span>
                </td>
                <td style={{ color: "var(--text-muted)", fontSize: 12 }}>
                  {r.short_description || "—"}
                </td>
              </tr>
            ))}
            {!loading && data?.rows.length === 0 && (
              <tr>
                <td colSpan={4} className="empty" style={{ padding: 40 }}>
                  No results.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div
        style={{
          display: "flex",
          gap: 8,
          marginTop: 14,
          alignItems: "center",
          justifyContent: "flex-end",
        }}
      >
        <button
          className="btn-secondary"
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          disabled={page === 0 || loading}
        >
          ← Prev
        </button>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            color: "var(--text-muted)",
            padding: "0 8px",
          }}
        >
          {page + 1} / {maxPage + 1}
        </div>
        <button
          className="btn-secondary"
          onClick={() => setPage((p) => Math.min(maxPage, p + 1))}
          disabled={page >= maxPage || loading}
        >
          Next →
        </button>
      </div>
    </div>
  );
}
