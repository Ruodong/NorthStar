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
const CARD_W = 130; // label card width in SVG units
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

  // Prepare city cards with positions
  const cityCards = useMemo(() => {
    const cards: {
      city: string;
      geo: typeof CITY_GEO[string];
      agg: CityAgg;
      cx: number;
      cy: number;
      rows: { icon: string; prod: number; nonProd: number }[];
    }[] = [];

    for (const [city, agg] of Object.entries(byCityAgg)) {
      const geo = CITY_GEO[city];
      if (!geo) continue;
      const [cx, cy] = lonLatToXY(geo.lon, geo.lat, viewport.bounds, H);
      if (cx < -50 || cx > W + 50 || cy < -50 || cy > H + 50) continue;

      const rows: { icon: string; prod: number; nonProd: number }[] = [];
      for (const rt of RESOURCE_TYPES) {
        const p = agg.prod[rt.key as keyof typeof agg.prod] as number;
        const np = agg.nonProd[rt.key as keyof typeof agg.nonProd] as number;
        if (p > 0 || np > 0) {
          rows.push({ icon: rt.icon, prod: p, nonProd: np });
        }
      }
      if (rows.length === 0) continue;
      cards.push({ city, geo, agg, cx, cy, rows });
    }

    // Sort by total descending so larger cities render first (z-order)
    cards.sort((a, b) => b.agg.total - a.agg.total);
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
        {cityCards.map(({ city, geo, agg, cx, cy, rows }) => {
          const { dx, dy } = getCardOffset(cx, cy, W, H);
          const cardX = cx + dx;
          const cardY = cy + dy;
          const titleH = 18; // city name row height
          const cardH = titleH + rows.length * CARD_LINE_H + 6; // 6px bottom padding

          // Leader line from dot to card edge
          const lineEndX = dx > 0 ? cardX : cardX + CARD_W;
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
                const ry = cardY + titleH + ri * CARD_LINE_H + 2;
                return (
                  <g key={row.icon}>
                    {/* Icon label */}
                    <text
                      x={cardX + 7} y={ry + 10}
                      fill="rgba(255,255,255,0.4)"
                      fontSize="8" fontWeight={600}
                      fontFamily="var(--font-mono)"
                    >
                      {row.icon}
                    </text>

                    {/* Numbers: prod (amber) · nonProd (blue) */}
                    <text
                      x={cardX + 38} y={ry + 10}
                      fontSize="10" fontWeight={600}
                      fontFamily="var(--font-mono)"
                    >
                      {row.prod > 0 && (
                        <tspan fill="#f6a623">{row.prod}</tspan>
                      )}
                      {row.prod > 0 && row.nonProd > 0 && (
                        <tspan fill="rgba(255,255,255,0.2)" dx={2} fontSize="8"> · </tspan>
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
          <span key={rt.key} style={{ fontFamily: "var(--font-mono)", letterSpacing: 0.3 }}>
            <span style={{ color: "var(--text-muted)", fontWeight: 600 }}>{rt.icon}</span>
            <span style={{ marginLeft: 4 }}>{rt.label}</span>
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
