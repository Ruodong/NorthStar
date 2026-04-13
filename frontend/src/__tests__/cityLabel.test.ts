import { describe, it, expect } from "vitest";

// Replicate the CITY_LABELS + cityLabel logic from the app detail page
const CITY_LABELS: Record<string, string> = {
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

function cityLabel(code: string | null): string {
  if (!code) return "Unknown";
  return CITY_LABELS[code] || code;
}

describe("cityLabel", () => {
  it("maps SY to Shenyang", () => {
    expect(cityLabel("SY")).toBe("沈阳 Shenyang");
  });

  it("maps NM to Hohhot (内蒙)", () => {
    expect(cityLabel("NM")).toBe("内蒙 Hohhot");
  });

  it("returns code for unknown city", () => {
    expect(cityLabel("XYZ")).toBe("XYZ");
  });

  it("returns Unknown for null", () => {
    expect(cityLabel(null)).toBe("Unknown");
  });

  it("handles US-Reston", () => {
    expect(cityLabel("US-Reston")).toBe("US Reston");
  });
});
