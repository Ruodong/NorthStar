"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface AppRow {
  app_id: string;
  name: string;
  app_full_name: string | null;
  status: string;
  u_service_area: string | null;
  portfolio_mgt: string | null;
  app_classification: string | null;
  budget_k: number | null;
  actual_k: number | null;
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

function formatMoney(k: number | null): string {
  if (k == null) return "—";
  if (Math.abs(k) < 0.01) return "$0";
  if (Math.abs(k) < 1000) return `$${k.toFixed(2)}k`;
  return `$${(k / 1000).toFixed(2)}M`;
}

interface StatusCount {
  status: string;
  count: number;
}

export default function AdminApplications() {
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [status, setStatus] = useState("");
  const [statuses, setStatuses] = useState<StatusCount[]>([]);
  const [page, setPage] = useState(0);
  const [data, setData] = useState<ListResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/masters/applications/statuses", { cache: "no-store" });
        const j = await r.json();
        if (j.success) setStatuses(j.data);
      } catch {
        // non-blocking
      }
    })();
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      setQDebounced(q);
      setPage(0);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    let cancelled = false;
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
        if (!cancelled) setData(j.data);
      } catch (e) {
        if (!cancelled) setErr(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [qDebounced, status, page]);

  const total = data?.total ?? 0;
  const maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

  return (
    <div>
      <h1>Applications (CMDB)</h1>
      <p className="subtitle">
        Active application portfolio from EAM. Driven by{" "}
        <code>application_tco</code> (apps with budgeted/actual spend this FY),
        joined to <code>cmdb_application</code> for name, status, classification
        and portfolio decision. Ordered by budget descending.
      </p>

      <div className="toolbar">
        <input
          placeholder="Search by name or app ID (e.g. A003559, EAM)…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ minWidth: 320 }}
        />
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(0);
          }}
        >
          <option value="">All statuses</option>
          {statuses.map((s) => (
            <option key={s.status || "__EMPTY__"} value={s.status || "__EMPTY__"}>
              {s.status || "(empty)"} ({s.count.toLocaleString()})
            </option>
          ))}
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
              <th style={{ width: 110 }}>App ID</th>
              <th>Name</th>
              <th style={{ width: 130 }}>Status</th>
              <th style={{ width: 110 }}>Portfolio</th>
              <th style={{ width: 140 }}>Service Area</th>
              <th style={{ width: 110, textAlign: "right" }}>Budget</th>
              <th style={{ width: 110, textAlign: "right" }}>Actual</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((r) => (
              <tr key={r.app_id}>
                <td>
                  <Link
                    href={`/admin/applications/${encodeURIComponent(r.app_id)}`}
                    style={{ color: "var(--accent)" }}
                  >
                    <code>{r.app_id}</code>
                  </Link>
                </td>
                <td>
                  <Link
                    href={`/admin/applications/${encodeURIComponent(r.app_id)}`}
                    style={{ color: "var(--text)" }}
                  >
                    {r.name}
                    {r.app_full_name && r.app_full_name !== r.name && (
                      <span
                        style={{
                          color: "var(--text-dim)",
                          fontSize: 11,
                          marginLeft: 8,
                        }}
                      >
                        {r.app_full_name}
                      </span>
                    )}
                  </Link>
                </td>
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
                  {r.portfolio_mgt || "—"}
                </td>
                <td style={{ color: "var(--text-muted)", fontSize: 12 }}>
                  {r.u_service_area || "—"}
                </td>
                <td
                  style={{
                    textAlign: "right",
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                    color: "var(--text)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {formatMoney(r.budget_k)}
                </td>
                <td
                  style={{
                    textAlign: "right",
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                    color: "var(--text-muted)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {formatMoney(r.actual_k)}
                </td>
              </tr>
            ))}
            {!loading && data?.rows.length === 0 && (
              <tr>
                <td colSpan={7} className="empty" style={{ padding: 40 }}>
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
