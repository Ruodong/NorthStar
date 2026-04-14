"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Pager } from "@/components/Pager";

interface AppRow {
  app_id: string;
  name: string;
  app_full_name: string | null;
  status: string;
  app_ownership: string | null;
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

const OWNERSHIP_COLORS: Record<string, string> = {
  "CIO/CDTO": "#6ba6e8",
  Shadow: "#e8716b",
  LPL: "#a8b0c0",
};

const PORTFOLIO_COLORS: Record<string, string> = {
  Invest: "#5fc58a",
  Tolerate: "#e8b458",
  Migrate: "#6ba6e8",
  Retire: "#e8716b",
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
        Full CMDB application registry from EAM ({data?.total.toLocaleString() ?? "…"} apps).
        Enriched with TCO budget data where available.
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
              <th style={{ width: 100 }}>App ID</th>
              <th>Name</th>
              <th style={{ width: 120 }}>Status</th>
              <th style={{ width: 110 }}>Ownership</th>
              <th style={{ width: 100 }}>Portfolio</th>
              <th style={{ width: 140 }}>Service Area</th>
              <th style={{ width: 100, textAlign: "right" }}>Budget</th>
              <th style={{ width: 100, textAlign: "right" }}>Actual</th>
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
                <td>
                  {r.app_ownership ? (
                    <span
                      className="status-pill"
                      style={{
                        color: OWNERSHIP_COLORS[r.app_ownership] || "var(--text-muted)",
                        background: `${OWNERSHIP_COLORS[r.app_ownership] || "#5f6a80"}26`,
                      }}
                    >
                      {r.app_ownership}
                    </span>
                  ) : (
                    <span style={{ color: "var(--text-dim)", fontSize: 12 }}>—</span>
                  )}
                </td>
                <td>
                  {r.portfolio_mgt ? (
                    <span
                      className="status-pill"
                      style={{
                        color: PORTFOLIO_COLORS[r.portfolio_mgt] || "var(--text-muted)",
                        background: `${PORTFOLIO_COLORS[r.portfolio_mgt] || "#5f6a80"}26`,
                      }}
                    >
                      {r.portfolio_mgt}
                    </span>
                  ) : (
                    <span style={{ color: "var(--text-dim)", fontSize: 12 }}>—</span>
                  )}
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
                <td colSpan={8} className="empty" style={{ padding: 40 }}>
                  No results.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pager
        page={page}
        maxPage={maxPage}
        total={total}
        pageSize={PAGE_SIZE}
        loading={loading}
        onPageChange={setPage}
      />
    </div>
  );
}
