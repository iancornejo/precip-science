// The radar sites' status marks and types (S09), shared by the map's Radars layer (radars.ts)
// and the status page, without pulling MapLibre into the status page.
//
// Shape carries the status as well as color (the S02 rule: red against green never carries a
// distinction): a filled dot, an open ring, a cross, and a small gray ring for no report.

export type SiteStatus = "up" | "late" | "down" | "unknown";
export interface Site {
  id: string; name: string | null; lat: number; lon: number; status: SiteStatus;
  latency_s: number | null; last_utc: string | null; rda: string | null; operability: string | null;
  mode: string | null; vcp: string | null; alarm: string | null;
}
export interface RadarDoc {
  schema: number; updated: string; counts: Partial<Record<SiteStatus, number>>;
  rules?: { late_age_s: number; late_latency_s: number; down_age_s: number };
  sites: Site[];
}

export const STATUSES: SiteStatus[] = ["up", "late", "down", "unknown"];
// "up" is umber, not glass blue: a blue dot would sink into blue stratiform echo.
export const C = { up: "#2E241D", late: "#C98A2E", down: "#A3352A", unknown: "#66574A", paper: "#F3ECDE" };
export const STATUS_TEXT: Record<SiteStatus, string> = {
  up: "Sending data", late: "Late", down: "Down", unknown: "No report",
};

export const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** The marks as small inline SVGs, for legends, popups and the status page. */
export function markSvg(s: SiteStatus, size = 12): string {
  const m = size / 2;
  const body = {
    up: `<circle cx="${m}" cy="${m}" r="${size * 0.34}" fill="${C.up}" stroke="${C.paper}" stroke-width="1"/>`,
    late: `<circle cx="${m}" cy="${m}" r="${size * 0.3}" fill="none" stroke="${C.late}" stroke-width="2"/>`,
    down: `<path d="M${size * 0.22} ${size * 0.22}L${size * 0.78} ${size * 0.78}M${size * 0.78} ${size * 0.22}L${size * 0.22} ${size * 0.78}" stroke="${C.down}" stroke-width="2.2" stroke-linecap="round"/>`,
    unknown: `<circle cx="${m}" cy="${m}" r="${size * 0.22}" fill="none" stroke="${C.unknown}" stroke-width="1.4"/>`,
  }[s];
  return `<svg class="map-radar-mark" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">${body}</svg>`;
}
