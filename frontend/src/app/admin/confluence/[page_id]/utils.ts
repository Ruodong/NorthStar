// utils.ts — helper functions for the Confluence page detail view

import type { OfficeMode } from "./types";

export function humanSize(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function officeMode(mediaType: string): OfficeMode {
  const mt = (mediaType || "").toLowerCase();
  if (
    mt === "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    || mt === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "pdf";
  }
  if (mt === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
    return "xlsx";
  }
  return "unsupported";
}
