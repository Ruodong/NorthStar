// constants.ts — shared constants for the Confluence page detail view

export const KIND_LABEL: Record<string, string> = {
  drawio: "draw.io",
  image: "Image",
  pdf: "PDF",
  office: "Office",
  xml: "XML",
  other: "Other",
};

export const KIND_COLOR: Record<string, string> = {
  drawio: "var(--accent)",
  image: "#5fc58a",
  pdf: "#e8716b",
  office: "#6ba6e8",
  xml: "#a8b0c0",
  other: "#6b7488",
};

export const STATUS_COLOR: Record<string, string> = {
  Keep: "#5fc58a",
  Change: "var(--accent)",
  New: "#e8716b",
  Sunset: "#808080",
  "3rd Party": "#6ba6e8",
  Unknown: "var(--text-dim)",
};

export const MATCH_STYLES: Record<
  string,
  { label: string; icon: string; color: string; tooltipBase: string }
> = {
  direct: {
    label: "direct",
    icon: "✓",
    color: "#5fc58a",
    tooltipBase: "drawio id and name both agree with CMDB",
  },
  typo_tolerated: {
    label: "typo",
    icon: "≈",
    color: "var(--accent)",
    tooltipBase: "drawio id matches CMDB; name has a small typo but same app",
  },
  auto_corrected: {
    label: "auto-fixed",
    icon: "↻",
    color: "var(--accent)",
    tooltipBase:
      "drawio id pointed to a different CMDB app; the drawio name matched a better candidate — auto-corrected",
  },
  auto_corrected_missing_id: {
    label: "auto-fixed",
    icon: "↻",
    color: "var(--accent)",
    tooltipBase:
      "drawio id was not in CMDB; the drawio name matched a real CMDB app — resolved via name",
  },
  fuzzy_by_name: {
    label: "fuzzy",
    icon: "?",
    color: "var(--accent)",
    tooltipBase:
      "drawio had no A-id at all; resolved via fuzzy match on the name",
  },
  mismatch_unresolved: {
    label: "mismatch",
    icon: "✗",
    color: "#e8716b",
    tooltipBase:
      "drawio id does not match its name in CMDB and no alternate CMDB app matched — needs human review",
  },
  no_cmdb: {
    label: "no cmdb",
    icon: "—",
    color: "var(--text-dim)",
    tooltipBase: "drawio has no A-id and name could not be matched in CMDB",
  },
};

// Bump this token any time the preview endpoint's RESPONSE HEADERS
// change in a way that would trap a cached browser response.
export const PREVIEW_CACHE_BUST = "v2";
