"use client";

import { useEffect, useMemo, useState } from "react";
import { feature } from "topojson-client";
import type { Topology, GeometryObject } from "topojson-specification";

// City coordinates in lon/lat (WGS84)
const CITY_GEO: Record<string, { lon: number; lat: number; label: string; labelZh?: string; region: "CN" | "US" | "EU" | "APAC" }> = {
  SY:           { lon: 123.43, lat: 41.80, label: "Shenyang",   labelZh: "沈阳",   region: "CN" },
  NM:           { lon: 111.65, lat: 40.84, label: "Hohhot",     labelZh: "内蒙",   region: "CN" },
  BJ:           { lon: 116.40, lat: 39.90, label: "Beijing",    labelZh: "北京",   region: "CN" },
  SH:           { lon: 121.47, lat: 31.23, label: "Shanghai",   labelZh: "上海",   region: "CN" },
  SZ:           { lon: 114.07, lat: 22.55, label: "Shenzhen",   labelZh: "深圳",   region: "CN" },
  TJ:           { lon: 117.20, lat: 39.13, label: "Tianjin",    labelZh: "天津",   region: "CN" },
  WH:           { lon: 114.30, lat: 30.59, label: "Wuhan",      labelZh: "武汉",   region: "CN" },
  HK:           { lon: 114.17, lat: 22.28, label: "Hong Kong",  labelZh: "香港",   region: "CN" },
  "US-Reston":  { lon: -77.35, lat: 38.97, label: "Reston",                       region: "US" },
  "US-Chicago": { lon: -87.63, lat: 41.88, label: "Chicago",                      region: "US" },
  "US-Ral":     { lon: -78.64, lat: 35.78, label: "Raleigh",                      region: "US" },
  NA:           { lon: -80.00, lat: 38.00, label: "N. America",                    region: "US" },
  Frankfurt:    { lon:   8.68, lat: 50.11, label: "Frankfurt",                     region: "EU" },
  Hohhot:       { lon: 111.65, lat: 40.84, label: "Hohhot",     labelZh: "内蒙",   region: "CN" },
  Shenyang:     { lon: 123.43, lat: 41.80, label: "Shenyang",   labelZh: "沈阳",   region: "CN" },
};

// Viewports: [minLon, maxLon, minLat, maxLat]
const VIEWPORTS: Record<string, { bounds: [number, number, number, number]; title: string }> = {
  WORLD: { bounds: [-130, 160, -10, 65], title: "Global Deployment" },
  CN:    { bounds: [100, 135, 18, 50],   title: "China Deployment" },
  US:    { bounds: [-100, -65, 25, 50],  title: "US Deployment" },
  EU:    { bounds: [-5, 30, 42, 58],     title: "Europe Deployment" },
};

export interface CityData {
  city: string;
  env: string;
  servers: number;
  containers: number;
  databases: number;
  object_storage: number;
  nas: number;
  total: number;
}

// Aggregated data for a single city across environments
interface CityAgg {
  prod: { servers: number; containers: number; databases: number; oss: number; nas: number; total: number };
  nonProd: { servers: number; containers: number; databases: number; oss: number; nas: number; total: number };
  total: number;
}

// Resource type config for display
const RESOURCE_TYPES = [
  { key: "servers",    icon: "SRV", label: "Server" },
  { key: "containers", icon: "CTR", label: "Container" },
  { key: "databases",  icon: "DB",  label: "Database" },
  { key: "oss",        icon: "OSS", label: "Object Storage" },
  { key: "nas",        icon: "NAS", label: "NAS" },
] as const;

const W = 960;
const CARD_W = 120; // ~12.5% of SVG width — fixed proportion per card
const CARD_LINE_H = 14; // line height per resource row

function getH(bounds: [number, number, number, number]): number {
  const [minLon, maxLon, minLat, maxLat] = bounds;
  const lonSpan = maxLon - minLon;
  const latSpan = maxLat - minLat;
  return Math.round(W * (latSpan / lonSpan) * 1.3);
}

function lonLatToXY(
  lon: number, lat: number,
  bounds: [number, number, number, number],
  h: number,
): [number, number] {
  const [minLon, maxLon, minLat, maxLat] = bounds;
  const x = ((lon - minLon) / (maxLon - minLon)) * W;
  const y = ((maxLat - lat) / (maxLat - minLat)) * h;
  return [x, y];
}

function geoToPath(
  coordinates: number[][][],
  bounds: [number, number, number, number],
  h: number,
): string {
  return coordinates
    .map((ring) => {
      const pts = ring.map(([lon, lat]) => lonLatToXY(lon, lat, bounds, h));
      return "M" + pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join("L") + "Z";
    })
    .join(" ");
}

// Label card offset: push card away from center to avoid overlapping the dot
function getCardOffset(
  cx: number, cy: number, svgW: number, svgH: number,
): { dx: number; dy: number } {
  // Push cards toward the nearest edge (away from center)
  const dx = cx > svgW / 2 ? 16 : -(CARD_W + 16);
  const dy = cy > svgH / 2 ? -8 : 8;
  return { dx, dy };
}

// Resource icons rendered as small SVG shapes (10x10 viewbox)
function renderResourceIcon(
  key: string, x: number, y: number, color: string,
) {
  const sc = 0.9; // slight scale-down for visual balance
  switch (key) {
    case "servers": // rack unit: rectangle with horizontal dividers + LED dots
      return (
        <g transform={`translate(${x},${y}) scale(${sc})`} fill="none" stroke={color}>
          <rect width={8} height={10} rx={1} strokeWidth={0.8} />
          <line x1={0} y1={3.5} x2={8} y2={3.5} strokeWidth={0.5} />
          <line x1={0} y1={7} x2={8} y2={7} strokeWidth={0.5} />
          <circle cx={6} cy={1.7} r={0.6} fill={color} stroke="none" />
          <circle cx={6} cy={5.2} r={0.6} fill={color} stroke="none" />
          <circle cx={6} cy={8.5} r={0.6} fill={color} stroke="none" />
        </g>
      );
    case "containers": // box with handle tab (Docker-esque)
      return (
        <g transform={`translate(${x},${y}) scale(${sc})`} fill="none" stroke={color}>
          <rect y={2.5} width={10} height={7.5} rx={1} strokeWidth={0.8} />
          <rect x={1} width={3} height={3} rx={0.5} strokeWidth={0.7} />
        </g>
      );
    case "databases": // classic cylinder
      return (
        <g transform={`translate(${x},${y}) scale(${sc})`} fill="none" stroke={color} strokeWidth={0.8}>
          <path d="M0,2.5 C0,0.5 8,0.5 8,2.5 V7.5 C8,9.5 0,9.5 0,7.5 Z" />
          <path d="M0,2.5 C0,4.2 8,4.2 8,2.5" strokeWidth={0.6} />
        </g>
      );
    case "oss": // bucket shape
      return (
        <g transform={`translate(${x},${y}) scale(${sc})`} fill="none" stroke={color} strokeWidth={0.8}>
          <path d="M1.5,0 H8.5 L10,8 C10,10 0,10 0,8 Z" />
          <line x1={1.5} y1={2.2} x2={8.5} y2={2.2} strokeWidth={0.5} />
        </g>
      );
    case "nas": // stacked storage units
      return (
        <g transform={`translate(${x},${y}) scale(${sc})`} fill="none" stroke={color} strokeWidth={0.7}>
          <rect width={10} height={2.5} rx={0.5} />
          <rect y={3.5} width={10} height={2.5} rx={0.5} />
          <rect y={7} width={10} height={2.5} rx={0.5} />
          <circle cx={8} cy={1.25} r={0.5} fill={color} stroke="none" />
          <circle cx={8} cy={4.75} r={0.5} fill={color} stroke="none" />
          <circle cx={8} cy={8.25} r={0.5} fill={color} stroke="none" />
        </g>
      );
    default:
      return null;
  }
}

// Resolve overlapping cards by iteratively pushing them apart
function resolveCardOverlaps(
  cards: { cardX: number; cardY: number; cardH: number }[],
  svgW: number, svgH: number,
): void {
  const GAP = 6;
  for (let iter = 0; iter < 30; iter++) {
    let moved = false;
    for (let i = 0; i < cards.length; i++) {
      for (let j = i + 1; j < cards.length; j++) {
        const a = cards[i], b = cards[j];
        const ox = Math.min(a.cardX + CARD_W + GAP, b.cardX + CARD_W + GAP) - Math.max(a.cardX, b.cardX);
        const oy = Math.min(a.cardY + a.cardH + GAP, b.cardY + b.cardH + GAP) - Math.max(a.cardY, b.cardY);
        if (ox > 0 && oy > 0) {
          moved = true;
          if (ox < oy) {
            const half = ox / 2 + 1;
            if (a.cardX <= b.cardX) { a.cardX -= half; b.cardX += half; }
            else { a.cardX += half; b.cardX -= half; }
          } else {
            const half = oy / 2 + 1;
            if (a.cardY <= b.cardY) { a.cardY -= half; b.cardY += half; }
            else { a.cardY += half; b.cardY -= half; }
          }
          a.cardX = Math.max(2, Math.min(svgW - CARD_W - 2, a.cardX));
          a.cardY = Math.max(2, Math.min(svgH - a.cardH - 2, a.cardY));
          b.cardX = Math.max(2, Math.min(svgW - CARD_W - 2, b.cardX));
          b.cardY = Math.max(2, Math.min(svgH - b.cardH - 2, b.cardY));
        }
      }
    }
    if (!moved) break;
  }
}

export function DeploymentMap({ data }: { data: CityData[] }) {
  const [landPaths, setLandPaths] = useState<string[]>([]);

  // Load world-atlas land data
  useEffect(() => {
    (async () => {
      try {
        const topo: Topology = await import("world-atlas/land-110m.json" as string) as unknown as Topology;
        const landGeo = feature(topo, topo.objects.land as GeometryObject);
        const paths: string[] = [];
        if (landGeo.type === "FeatureCollection") {
          for (const f of landGeo.features) {
            if (f.geometry.type === "Polygon") {
              paths.push(f.geometry.coordinates as unknown as string);
            } else if (f.geometry.type === "MultiPolygon") {
              for (const poly of f.geometry.coordinates) {
                paths.push(poly as unknown as string);
              }
            }
          }
        } else if (landGeo.type === "Feature") {
          const g = landGeo.geometry;
          if (g.type === "Polygon") {
            paths.push(g.coordinates as unknown as string);
          } else if (g.type === "MultiPolygon") {
            for (const poly of g.coordinates) {
              paths.push(poly as unknown as string);
            }
          }
        }
        setLandPaths(paths as unknown as string[]);
      } catch (e) {
        console.error("Failed to load world map:", e);
      }
    })();
  }, []);

  // Aggregate by city: merge prod/non-prod rows into a single CityAgg
  const byCityAgg = useMemo(() => {
    const agg: Record<string, CityAgg> = {};
    for (const d of data) {
      const key = d.city;
      if (!agg[key]) {
        agg[key] = {
          prod:    { servers: 0, containers: 0, databases: 0, oss: 0, nas: 0, total: 0 },
          nonProd: { servers: 0, containers: 0, databases: 0, oss: 0, nas: 0, total: 0 },
          total: 0,
        };
      }
      const bucket = d.env === "Production" ? agg[key].prod : agg[key].nonProd;
      bucket.servers    += d.servers || 0;
      bucket.containers += d.containers || 0;
      bucket.databases  += d.databases || 0;
      bucket.oss        += d.object_storage || 0;
      bucket.nas        += d.nas || 0;
      bucket.total      += d.total;
      agg[key].total    += d.total;
    }
    return agg;
  }, [data]);

  // Pick viewport based on regions
  const viewport = useMemo(() => {
    const regions = new Set<string>();
    for (const city of Object.keys(byCityAgg)) {
      const geo = CITY_GEO[city];
      if (geo) regions.add(geo.region);
    }
    if (regions.size === 1) {
      const r = [...regions][0];
      if (VIEWPORTS[r]) return VIEWPORTS[r];
    }
    return VIEWPORTS.WORLD;
  }, [byCityAgg]);

  const H = getH(viewport.bounds);

  // Convert land polygons to SVG paths for current viewport
  const svgLandPaths = useMemo(() => {
    if (!landPaths.length) return [];
    return (landPaths as unknown as number[][][][]).map((coords) =>
      geoToPath(coords as unknown as number[][][], viewport.bounds, H)
    );
  }, [landPaths, viewport, H]);

  // Prepare city cards with positions + overlap resolution
  const cityCards = useMemo(() => {
    const cards: {
      city: string;
      geo: typeof CITY_GEO[string];
      agg: CityAgg;
      cx: number;
      cy: number;
      rows: { key: string; prod: number; nonProd: number }[];
      cardX: number;
      cardY: number;
      cardH: number;
    }[] = [];

    for (const [city, agg] of Object.entries(byCityAgg)) {
      const geo = CITY_GEO[city];
      if (!geo) continue;
      const [cx, cy] = lonLatToXY(geo.lon, geo.lat, viewport.bounds, H);
      if (cx < -50 || cx > W + 50 || cy < -50 || cy > H + 50) continue;

      const rows: { key: string; prod: number; nonProd: number }[] = [];
      for (const rt of RESOURCE_TYPES) {
        const p = agg.prod[rt.key as keyof typeof agg.prod] as number;
        const np = agg.nonProd[rt.key as keyof typeof agg.nonProd] as number;
        if (p > 0 || np > 0) {
          rows.push({ key: rt.key, prod: p, nonProd: np });
        }
      }
      if (rows.length === 0) continue;

      const titleH = 18;
      const cardH = titleH + rows.length * CARD_LINE_H + 6;
      const { dx, dy } = getCardOffset(cx, cy, W, H);

      cards.push({ city, geo, agg, cx, cy, rows, cardX: cx + dx, cardY: cy + dy, cardH });
    }

    // Sort by total descending so larger cities render first (z-order)
    cards.sort((a, b) => b.agg.total - a.agg.total);

    // Resolve any overlapping cards
    resolveCardOverlaps(cards, W, H);

    return cards;
  }, [byCityAgg, viewport, H]);

  return (
    <div style={{
      position: "relative",
      background: "var(--bg-elevated)",
      borderRadius: "var(--radius-md)",
      border: "1px solid var(--border)",
      padding: 16,
      marginBottom: 16,
    }}>
      <div style={{
        fontSize: 10, textTransform: "uppercase", letterSpacing: 0.6,
        color: "var(--text-dim)", marginBottom: 8, fontWeight: 600,
      }}>
        {viewport.title}
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", maxHeight: 520 }}>
        <rect width={W} height={H} fill="var(--bg)" rx="4" />

        {/* Land masses */}
        {svgLandPaths.map((d, i) => (
          <path key={i} d={d} fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.12)" strokeWidth="0.5" />
        ))}

        {/* City label cards */}
        {cityCards.map(({ city, geo, agg, cx, cy, rows, cardX, cardY, cardH }) => {
          // Leader line from dot to nearest card edge
          const lineEndX = cardX > cx ? cardX : cardX + CARD_W;
          const lineEndY = cardY + cardH / 2;

          return (
            <g key={city}>
              {/* Location dot */}
              <circle cx={cx} cy={cy} r={3.5}
                fill="var(--accent)" stroke="rgba(246,166,35,0.4)" strokeWidth={1.5}
              />

              {/* Leader line */}
              <line x1={cx} y1={cy} x2={lineEndX} y2={lineEndY}
                stroke="rgba(255,255,255,0.15)" strokeWidth={0.7}
                strokeDasharray="3,2"
              />

              {/* Card background */}
              <rect
                x={cardX} y={cardY}
                width={CARD_W} height={cardH}
                rx={3} ry={3}
                fill="rgba(12,16,23,0.88)"
                stroke="rgba(255,255,255,0.12)"
                strokeWidth={0.5}
              />

              {/* City name */}
              <text
                x={cardX + 7} y={cardY + 13}
                fill="#e7eaf0"
                fontSize="10" fontWeight={700}
                fontFamily="var(--font-mono)"
              >
                {geo.label}
                {geo.labelZh && (
                  <tspan fill="rgba(255,255,255,0.35)" fontSize="9" dx={4}>
                    {geo.labelZh}
                  </tspan>
                )}
              </text>

              {/* Total count badge */}
              <text
                x={cardX + CARD_W - 7} y={cardY + 13}
                fill="rgba(255,255,255,0.3)"
                fontSize="9" fontWeight={600}
                fontFamily="var(--font-mono)"
                textAnchor="end"
              >
                {agg.total}
              </text>

              {/* Resource rows */}
              {rows.map((row, ri) => {
                const rowY = cardY + 18 + ri * CARD_LINE_H + 2;
                return (
                  <g key={row.key}>
                    {/* Resource icon */}
                    {renderResourceIcon(row.key, cardX + 5, rowY + 1, "rgba(255,255,255,0.4)")}

                    {/* Numbers: prod (amber) · nonProd (blue), right-aligned */}
                    <text
                      x={cardX + CARD_W - 7} y={rowY + 10}
                      textAnchor="end"
                      fontSize="10" fontWeight={600}
                      fontFamily="var(--font-mono)"
                    >
                      {row.prod > 0 && (
                        <tspan fill="#f6a623">{row.prod}</tspan>
                      )}
                      {row.prod > 0 && row.nonProd > 0 && (
                        <tspan fill="rgba(255,255,255,0.2)"> · </tspan>
                      )}
                      {row.nonProd > 0 && (
                        <tspan fill="#6ba6e8">{row.nonProd}</tspan>
                      )}
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div style={{
        display: "flex", gap: 16, marginTop: 10, fontSize: 10,
        color: "var(--text-dim)", flexWrap: "wrap", alignItems: "center",
      }}>
        {RESOURCE_TYPES.map((rt) => (
          <span key={rt.key} style={{
            fontFamily: "var(--font-mono)", letterSpacing: 0.3,
            display: "inline-flex", alignItems: "center", gap: 4,
          }}>
            <svg width={12} height={12} viewBox="0 0 10 10" style={{ flexShrink: 0 }}>
              {renderResourceIcon(rt.key, 0, 0, "var(--text-muted)")}
            </svg>
            <span>{rt.label}</span>
          </span>
        ))}
        <span style={{ marginLeft: "auto", display: "flex", gap: 12 }}>
          <span>
            <span style={{ color: "#f6a623", fontWeight: 700 }}>N</span>
            <span style={{ marginLeft: 3 }}>= Prod</span>
          </span>
          <span>
            <span style={{ color: "#6ba6e8", fontWeight: 700 }}>N</span>
            <span style={{ marginLeft: 3 }}>= Non-Prod</span>
          </span>
        </span>
      </div>
    </div>
  );
}
