// Shared city code → display label mapping.
// Used by OverviewTab (deploy summary "top cities" line) and DeploymentTab
// (city-level breakdown table). Co-located here because both tabs need it.
//
// Codes match the upstream `infraops` city codes (SY/NM/BJ/...).
// Labels are bilingual (CN + EN) for Lenovo internal context.

export const CITY_LABELS: Record<string, string> = {
  SY: "沈阳 Shenyang",
  NM: "内蒙 Hohhot",
  BJ: "北京 Beijing",
  SH: "上海 Shanghai",
  SZ: "深圳 Shenzhen",
  TJ: "天津 Tianjin",
  WH: "武汉 Wuhan",
  HK: "香港 Hong Kong",
  NA: "North America",
  "US-Reston": "US Reston",
  "US-Chicago": "US Chicago",
  "US-Ral": "US Raleigh",
  Frankfurt: "Frankfurt",
};

export function cityLabel(code: string | null): string {
  if (!code) return "Unknown";
  return CITY_LABELS[code] || code;
}
