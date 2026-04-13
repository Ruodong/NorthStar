"use client";

import { useEffect, useMemo, useState } from "react";
import { feature } from "topojson-client";
import type { Topology, GeometryObject } from "topojson-specification";

// City coordinates in lon/lat (WGS84)
const CITY_GEO: Record<string, { lon: number; lat: number; label: string; region: "CN" | "US" | "EU" | "APAC" }> = {
  SY:           { lon: 123.43, lat: 41.80, label: "沈阳 Shenyang",   region: "CN" },
  NM:           { lon: 111.65, lat: 40.84, label: "内蒙 Hohhot",     region: "CN" },
  BJ:           { lon: 116.40, lat: 39.90, label: "北京 Beijing",    region: "CN" },
  SH:           { lon: 121.47, lat: 31.23, label: "上海 Shanghai",   region: "CN" },
  SZ:           { lon: 114.07, lat: 22.55, label: "深圳 Shenzhen",   region: "CN" },
  TJ:           { lon: 117.20, lat: 39.13, label: "天津 Tianjin",    region: "CN" },
  WH:           { lon: 114.30, lat: 30.59, label: "武汉 Wuhan",      region: "CN" },
  HK:           { lon: 114.17, lat: 22.28, label: "香港 Hong Kong",  region: "CN" },
  "US-Reston":  { lon: -77.35, lat: 38.97, label: "US Reston",       region: "US" },
  "US-Chicago": { lon: -87.63, lat: 41.88, label: "US Chicago",      region: "US" },
  "US-Ral":     { lon: -78.64, lat: 35.78, label: "US Raleigh",      region: "US" },
  NA:           { lon: -80.00, lat: 38.00, label: "North America",   region: "US" },
  Frankfurt:    { lon:   8.68, lat: 50.11, label: "Frankfurt",       region: "EU" },
  Hohhot:       { lon: 111.65, lat: 40.84, label: "内蒙 Hohhot",     region: "CN" },
  Shenyang:     { lon: 123.43, lat: 41.80, label: "沈阳 Shenyang",   region: "CN" },
};

// Viewports: [minLon, maxLon, minLat, maxLat]
const VIEWPORTS: Record<string, { bounds: [number, number, number, number]; title: string }> = {
  WORLD: { bounds: [-130, 160, -10, 65], title: "Global Deployment" },
  CN:    { bounds: [100, 135, 18, 50],   title: "China Deployment" },
  US:    { bounds: [-100, -65, 25, 50],  title: "US Deployment" },
  EU:    { bounds: [-5, 30, 42, 58],     title: "Europe Deployment" },
};

interface CityData {
  city: string;
  env: string;
  servers: number;
  containers: number;
  databases: number;
  object_storage: number;
  nas: number;
  total: number;
}

const W = 900;
const H = 440;

function lonLatToXY(
  lon: number, lat: number,
  bounds: [number, number, number, number],
): [number, number] {
  const [minLon, maxLon, minLat, maxLat] = bounds;
  const x = ((lon - minLon) / (maxLon - minLon)) * W;
  const y = ((maxLat - lat) / (maxLat - minLat)) * H;
  return [x, y];
}

// Convert GeoJSON polygon coordinates to SVG path string
function geoToPath(
  coordinates: number[][][],
  bounds: [number, number, number, number],
): string {
  return coordinates
    .map((ring) => {
      const pts = ring.map(([lon, lat]) => lonLatToXY(lon, lat, bounds));
      return "M" + pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join("L") + "Z";
    })
    .join(" ");
}

export function DeploymentMap({ data }: { data: CityData[] }) {
  const [hovered, setHovered] = useState<string | null>(null);
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
        // Store raw coordinate arrays
        setLandPaths(paths as unknown as string[]);
      } catch (e) {
        console.error("Failed to load world map:", e);
      }
    })();
  }, []);

  // Aggregate by city
  const byCityAgg = useMemo(() => {
    const agg: Record<string, { total: number; prod: number; nonProd: number; data: CityData[] }> = {};
    for (const d of data) {
      const key = d.city;
      if (!agg[key]) agg[key] = { total: 0, prod: 0, nonProd: 0, data: [] };
      agg[key].total += d.total;
      if (d.env === "Production") agg[key].prod += d.total;
      else agg[key].nonProd += d.total;
      agg[key].data.push(d);
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

  const maxTotal = Math.max(...Object.values(byCityAgg).map((v) => v.total), 1);

  // Convert land polygons to SVG paths for current viewport
  const svgLandPaths = useMemo(() => {
    if (!landPaths.length) return [];
    return (landPaths as unknown as number[][][][]).map((coords) =>
      geoToPath(coords as unknown as number[][][], viewport.bounds)
    );
  }, [landPaths, viewport]);

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

      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", maxHeight: 380 }}>
        <rect width={W} height={H} fill="var(--bg)" rx="4" />

        {/* Land masses */}
        {svgLandPaths.map((d, i) => (
          <path key={i} d={d} fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.12)" strokeWidth="0.5" />
        ))}

        {/* City bubbles */}
        {Object.entries(byCityAgg).map(([city, agg]) => {
          const geo = CITY_GEO[city];
          if (!geo) return null;

          const [cx, cy] = lonLatToXY(geo.lon, geo.lat, viewport.bounds);
          if (cx < -30 || cx > W + 30 || cy < -30 || cy > H + 30) return null;

          const radius = Math.max(8, Math.min(45, Math.sqrt(agg.total / maxTotal) * 45));
          const prodRatio = agg.total > 0 ? agg.prod / agg.total : 0;
          const isHov = hovered === city;

          return (
            <g key={city}
              onMouseEnter={() => setHovered(city)}
              onMouseLeave={() => setHovered(null)}
              style={{ cursor: "pointer" }}
            >
              {isHov && (
                <circle cx={cx} cy={cy} r={radius + 6}
                  fill="none" stroke="var(--accent)" strokeWidth="1" opacity="0.4">
                  <animate attributeName="r" from={radius + 2} to={radius + 14} dur="1s" repeatCount="indefinite" />
                  <animate attributeName="opacity" from="0.4" to="0" dur="1s" repeatCount="indefinite" />
                </circle>
              )}

              <circle cx={cx} cy={cy} r={radius}
                fill="rgba(107, 166, 232, 0.2)"
                stroke={isHov ? "#6ba6e8" : "rgba(107, 166, 232, 0.4)"}
                strokeWidth={isHov ? 2 : 1}
              />

              {prodRatio > 0 && (
                <circle cx={cx} cy={cy} r={radius * Math.sqrt(prodRatio)}
                  fill="rgba(246, 166, 35, 0.45)"
                  stroke="rgba(246, 166, 35, 0.7)"
                  strokeWidth={0.5}
                />
              )}

              <text x={cx} y={cy + 4}
                textAnchor="middle" fill={isHov ? "#fff" : "var(--text-muted)"}
                fontSize={radius > 16 ? 13 : 10}
                fontFamily="var(--font-mono)" fontWeight={700}
              >
                {agg.total}
              </text>

              {(isHov || viewport !== VIEWPORTS.WORLD) && (
                <text x={cx} y={cy - radius - 6}
                  textAnchor="middle" fill="var(--text)"
                  fontSize="11" fontWeight={600}
                >
                  {geo.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 10, color: "var(--text-dim)", flexWrap: "wrap" }}>
        <span>
          <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: "rgba(246, 166, 35, 0.45)", marginRight: 4, verticalAlign: "middle" }} />
          Production
        </span>
        <span>
          <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: "rgba(107, 166, 232, 0.2)", border: "1px solid rgba(107, 166, 232, 0.4)", marginRight: 4, verticalAlign: "middle" }} />
          Non-Production
        </span>
        <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono)" }}>
          bubble size = total resources
        </span>
      </div>

      {/* Hover tooltip */}
      {hovered && byCityAgg[hovered] && (
        <div style={{
          position: "absolute", top: 16, right: 16,
          background: "var(--bg)", border: "1px solid var(--accent-dim)",
          borderRadius: "var(--radius-md)", padding: "10px 14px",
          fontSize: 11, minWidth: 200, zIndex: 10,
          boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
        }}>
          <div style={{ fontWeight: 600, marginBottom: 6, color: "var(--text)", fontSize: 12 }}>
            {CITY_GEO[hovered]?.label || hovered}
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              {byCityAgg[hovered].data.map((d, i) => (
                <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "3px 0", color: d.env === "Production" ? "var(--accent)" : "#6ba6e8", fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600 }}>
                    {d.env === "Production" ? "PROD" : "NON-P"}
                  </td>
                  <td style={{ padding: "3px 4px", color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 10, textAlign: "right" }}>
                    {[
                      d.servers && `${d.servers} srv`,
                      d.containers && `${d.containers} ctr`,
                      d.databases && `${d.databases} db`,
                      d.object_storage && `${d.object_storage} oss`,
                      d.nas && `${d.nas} nas`,
                    ].filter(Boolean).join(" · ")}
                  </td>
                  <td style={{ padding: "3px 0", fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 700, textAlign: "right", color: "var(--text)" }}>
                    {d.total}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
