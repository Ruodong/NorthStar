"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
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

interface FilterCount {
  status?: string;
  ownership?: string;
  portfolio?: string;
  count: number;
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
  if (k == null) return "\u2014";
  if (Math.abs(k) < 0.01) return "$0";
  if (Math.abs(k) < 1000) return `$${k.toFixed(2)}k`;
  return `$${(k / 1000).toFixed(2)}M`;
}

/* ── Multi-select pill toggle ─────────────────────────── */
function PillGroup({
  options,
  selected,
  onToggle,
  colorMap,
  labelKey,
}: {
  options: FilterCount[];
  selected: string[];
  onToggle: (v: string) => void;
  colorMap: Record<string, string>;
  labelKey: "status" | "ownership" | "portfolio";
}) {
  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
      {options.map((o) => {
        const raw = o[labelKey] ?? "";
        const value = raw || "__EMPTY__";
        const label = raw || "(empty)";
        const active = selected.includes(value);
        const color = colorMap[raw] || "#5f6a80";
        return (
          <button
            key={value}
            onClick={() => onToggle(value)}
            style={{
              border: `1px solid ${active ? color : "var(--border)"}`,
              background: active ? `${color}26` : "transparent",
              color: active ? color : "var(--text-dim)",
              padding: "3px 10px",
              borderRadius: 4,
              fontSize: 12,
              cursor: "pointer",
              fontFamily: "var(--font-body)",
              transition: "all 0.15s",
              whiteSpace: "nowrap",
              lineHeight: "18px",
            }}
          >
            {label}{" "}
            <span style={{ opacity: 0.5, fontSize: 11 }}>
              {o.count.toLocaleString()}
            </span>
          </button>
        );
      })}
      {selected.length > 0 && (
        <button
          onClick={() => selected.forEach((v) => onToggle(v))}
          style={{
            border: "none",
            background: "transparent",
            color: "var(--text-dim)",
            fontSize: 11,
            cursor: "pointer",
            padding: "3px 6px",
            opacity: 0.6,
          }}
          title="Clear filter"
        >
          \u2715
        </button>
      )}
    </div>
  );
}

export default function ApplicationsPage() {
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [selStatus, setSelStatus] = useState<string[]>([]);
  const [selOwnership, setSelOwnership] = useState<string[]>(["CIO/CDTO"]);
  const [selPortfolio, setSelPortfolio] = useState<string[]>([]);
  const [statusOpts, setStatusOpts] = useState<FilterCount[]>([]);
  const [ownershipOpts, setOwnershipOpts] = useState<FilterCount[]>([]);
  const [portfolioOpts, setPortfolioOpts] = useState<FilterCount[]>([]);
  const [page, setPage] = useState(0);
  const [data, setData] = useState<ListResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [sRes, oRes, pRes] = await Promise.all([
          fetch("/api/masters/applications/statuses", { cache: "no-store" }),
          fetch("/api/masters/applications/ownerships", { cache: "no-store" }),
          fetch("/api/masters/applications/portfolios", { cache: "no-store" }),
        ]);
        const [sJ, oJ, pJ] = await Promise.all([sRes.json(), oRes.json(), pRes.json()]);
        if (sJ.success) setStatusOpts(sJ.data);
        if (oJ.success) setOwnershipOpts(oJ.data);
        if (pJ.success) setPortfolioOpts(pJ.data);
      } catch { /* non-blocking */ }
    })();
  }, []);

  useEffect(() => {
    const t = setTimeout(() => { setQDebounced(q); setPage(0); }, 250);
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
        if (selStatus.length) params.set("status", selStatus.join(","));
        if (selOwnership.length) params.set("app_ownership", selOwnership.join(","));
        if (selPortfolio.length) params.set("portfolio_mgt", selPortfolio.join(","));
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
    return () => { cancelled = true; };
  }, [qDebounced, selStatus, selOwnership, selPortfolio, page]);

  const toggle = useCallback(
    (setter: React.Dispatch<React.SetStateAction<string[]>>) =>
      (v: string) => {
        setter((prev) => {
          setPage(0);
          return prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v];
        });
      },
    [],
  );

  const total = data?.total ?? 0;
  const maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

  return (
    <div>
      <h1>Applications</h1>
      <p className="subtitle">
        CMDB application registry ({data?.total.toLocaleString() ?? "\u2026"} apps).
        Sorted by budget. Click any app to view detail.
      </p>

      <div className="toolbar">
        <input
          placeholder="Search by name or app ID (e.g. A003559, EAM)\u2026"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ minWidth: 320 }}
        />
        <div style={{ flex: 1 }} />
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-dim)" }}>
          {loading ? "loading\u2026" : `${total.toLocaleString()} results`}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
        {[
          { label: "Status", opts: statusOpts, sel: selStatus, set: setSelStatus, map: STATUS_COLORS, key: "status" as const },
          { label: "Ownership", opts: ownershipOpts, sel: selOwnership, set: setSelOwnership, map: OWNERSHIP_COLORS, key: "ownership" as const },
          { label: "Portfolio", opts: portfolioOpts, sel: selPortfolio, set: setSelPortfolio, map: PORTFOLIO_COLORS, key: "portfolio" as const },
        ].map((f) => (
          <div key={f.label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)", minWidth: 70, textAlign: "right" }}>
              {f.label}
            </span>
            <PillGroup options={f.opts} selected={f.sel} onToggle={toggle(f.set)} colorMap={f.map} labelKey={f.key} />
          </div>
        ))}
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
                  <Link href={`/apps/${encodeURIComponent(r.app_id)}`} style={{ color: "var(--accent)" }}>
                    <code>{r.app_id}</code>
                  </Link>
                </td>
                <td>
                  <Link href={`/apps/${encodeURIComponent(r.app_id)}`} style={{ color: "var(--text)" }}>
                    {r.name}
                    {r.app_full_name && r.app_full_name !== r.name && (
                      <span style={{ color: "var(--text-dim)", fontSize: 11, marginLeft: 8 }}>{r.app_full_name}</span>
                    )}
                  </Link>
                </td>
                <td>
                  <span className="status-pill" style={{ color: STATUS_COLORS[r.status] || "var(--text-muted)", background: `${STATUS_COLORS[r.status] || "#5f6a80"}26` }}>
                    {r.status}
                  </span>
                </td>
                <td>
                  {r.app_ownership ? (
                    <span className="status-pill" style={{ color: OWNERSHIP_COLORS[r.app_ownership] || "var(--text-muted)", background: `${OWNERSHIP_COLORS[r.app_ownership] || "#5f6a80"}26` }}>
                      {r.app_ownership}
                    </span>
                  ) : <span style={{ color: "var(--text-dim)", fontSize: 12 }}>\u2014</span>}
                </td>
                <td>
                  {r.portfolio_mgt ? (
                    <span className="status-pill" style={{ color: PORTFOLIO_COLORS[r.portfolio_mgt] || "var(--text-muted)", background: `${PORTFOLIO_COLORS[r.portfolio_mgt] || "#5f6a80"}26` }}>
                      {r.portfolio_mgt}
                    </span>
                  ) : <span style={{ color: "var(--text-dim)", fontSize: 12 }}>\u2014</span>}
                </td>
                <td style={{ color: "var(--text-muted)", fontSize: 12 }}>{r.u_service_area || "\u2014"}</td>
                <td style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>
                  {formatMoney(r.budget_k)}
                </td>
                <td style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
                  {formatMoney(r.actual_k)}
                </td>
              </tr>
            ))}
            {!loading && data?.rows.length === 0 && (
              <tr><td colSpan={8} className="empty" style={{ padding: 40 }}>No results.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Pager page={page} maxPage={maxPage} total={total} pageSize={PAGE_SIZE} loading={loading} onPageChange={setPage} />
    </div>
  );
}
