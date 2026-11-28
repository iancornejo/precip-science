// Radar sites (S09): the WSR-88Ds behind MRMS, marked by the NWS's own status report.
//
// The pipeline (pipeline repo, live/ops.py) reads the NWS API every 10 minutes and writes
// live/radars.json to R2: each site up, late (Level II last received 10 min ago or more, or a
// latency of 5 min or more), down (no Level II for 30 min, or the radar reports itself
// inoperable, shut down or disconnected) or unknown (no report). This layer only reads that
// file; it never calls api.weather.gov itself. The marks and types are in radarmarks.ts, shared
// with the status page.
import * as maplibregl from "maplibre-gl";
import type { FeatureCollection, Point } from "geojson";

import { C, esc, markSvg, STATUSES, STATUS_TEXT, type RadarDoc, type Site, type SiteStatus } from "./radarmarks";
import { ago, localClock } from "./timefmt";

export type { RadarDoc, Site, SiteStatus };

export const SITES_LAYER = "radar-sites";
const IDS_LAYER = "radar-sites-id";
const SOURCE = "radar-sites";
const KEY = "precip-map-radars";
const REFRESH_MS = 5 * 60e3;          // the file changes every 10 min and is cached 5 min
const STALE_MS = 40 * 60e3;           // older than this, the legend says the list is old
const LEGEND_WORD: Record<SiteStatus, string> = { up: "up", late: "late", down: "down", unknown: "no report" };

/** Map icons, drawn at twice their size for sharp edges, each with a paper casing over echo. */
function icon(s: SiteStatus, ratio = 2): ImageData {
  const css = 16;
  const cv = document.createElement("canvas");
  cv.width = cv.height = css * ratio;
  const g = cv.getContext("2d")!;
  g.scale(ratio, ratio);
  const m = css / 2;
  const ring = (r: number, w: number, color: string) => {
    g.beginPath(); g.arc(m, m, r, 0, 2 * Math.PI); g.lineWidth = w; g.strokeStyle = color; g.stroke();
  };
  if (s === "up") {
    g.beginPath(); g.arc(m, m, 5.4, 0, 2 * Math.PI); g.fillStyle = C.paper; g.fill();
    g.beginPath(); g.arc(m, m, 4.2, 0, 2 * Math.PI); g.fillStyle = C.up; g.fill();
  } else if (s === "late") {
    ring(4.6, 4.6, C.paper);
    ring(4.6, 2.3, C.late);
  } else if (s === "down") {
    g.lineCap = "round";
    const cross = (w: number, color: string) => {
      g.beginPath(); g.moveTo(m - 4, m - 4); g.lineTo(m + 4, m + 4); g.moveTo(m + 4, m - 4); g.lineTo(m - 4, m + 4);
      g.lineWidth = w; g.strokeStyle = color; g.stroke();
    };
    cross(5, C.paper);
    cross(2.6, C.down);
  } else {
    ring(3.2, 3.4, C.paper);
    ring(3.2, 1.5, C.unknown);
  }
  return g.getImageData(0, 0, cv.width, cv.height);
}

const empty = (): FeatureCollection<Point> => ({ type: "FeatureCollection", features: [] });

export class RadarSites {
  on = false;
  doc: RadarDoc | null = null;
  failed = false;
  private added = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private popup: maplibregl.Popup | null = null;
  private popupPinned = false;

  constructor(private map: maplibregl.Map, private url: string, private onChange: () => void) {}

  /** Off unless this browser turned it on before. */
  static stored(): boolean {
    try { return localStorage.getItem(KEY) === "on"; } catch { return false; }
  }

  private ensureLayers() {
    if (this.added) return;
    for (const s of STATUSES) if (!this.map.hasImage(`radar-${s}`)) this.map.addImage(`radar-${s}`, icon(s), { pixelRatio: 2 });
    this.map.addSource(SOURCE, { type: "geojson", data: empty() });
    // On top of everything, labels included: a site is a point to find, not a backdrop.
    this.map.addLayer({
      id: SITES_LAYER, type: "symbol", source: SOURCE,
      layout: {
        "icon-image": ["match", ["get", "status"], "up", "radar-up", "late", "radar-late", "down", "radar-down", "radar-unknown"],
        "icon-allow-overlap": true, "icon-ignore-placement": true,
        // zoomed out, sites sending data recede and the late or down ones keep their size
        "icon-size": ["interpolate", ["linear"], ["zoom"],
          3, ["match", ["get", "status"], "up", 0.7, "unknown", 0.85, 1],
          6, 1],
        "symbol-sort-key": ["match", ["get", "status"], "down", 3, "late", 2, "unknown", 1, 0],   // down drawn on top
        visibility: "none",
      },
    });
    this.map.addLayer({
      id: IDS_LAYER, type: "symbol", source: SOURCE, minzoom: 5.5,
      layout: {
        "text-field": ["get", "id"], "text-font": ["geom-medium"], "text-size": 10.5,
        "text-anchor": "top", "text-offset": [0, 0.85], "text-padding": 1, visibility: "none",
      },
      paint: { "text-color": "#2E241D", "text-halo-color": C.paper, "text-halo-width": 1.4 },
    });
    const canvas = this.map.getCanvas();
    this.map.on("mouseenter", SITES_LAYER, (e) => {
      canvas.style.cursor = "pointer";
      const f = e.features?.[0];
      if (f && !this.popupPinned) this.showPopup(f.properties as Record<string, unknown>, false);
    });
    this.map.on("mouseleave", SITES_LAYER, () => {
      canvas.style.cursor = "";
      if (!this.popupPinned) this.closePopup();
    });
    this.added = true;
  }

  async set(on: boolean) {
    this.on = on;
    try { localStorage.setItem(KEY, on ? "on" : "off"); } catch { /* private mode */ }
    if (on) {
      this.ensureLayers();
      for (const id of [SITES_LAYER, IDS_LAYER]) this.map.setLayoutProperty(id, "visibility", "visible");
      await this.load();
      if (!this.timer) this.timer = setInterval(() => { if (!document.hidden) this.load(); }, REFRESH_MS);
    } else {
      if (this.added) for (const id of [SITES_LAYER, IDS_LAYER]) this.map.setLayoutProperty(id, "visibility", "none");
      if (this.timer) { clearInterval(this.timer); this.timer = null; }
      this.closePopup();
    }
    this.onChange();
  }

  async load() {
    try {
      const r = await fetch(this.url, { cache: "no-cache" });
      if (!r.ok) throw new Error(`${r.status} for ${this.url}`);
      const doc = (await r.json()) as RadarDoc;
      if (!Array.isArray(doc.sites)) throw new Error("radars.json without sites");
      this.doc = doc;
      this.failed = false;
      const fc: FeatureCollection<Point> = {
        type: "FeatureCollection",
        features: doc.sites.map((s) => ({
          type: "Feature", geometry: { type: "Point", coordinates: [s.lon, s.lat] },
          properties: { ...s, status: STATUSES.includes(s.status) ? s.status : "unknown" },
        })),
      };
      (this.map.getSource(SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData(fc);
    } catch (e) {
      console.warn(e);
      this.failed = true;
    }
    this.onChange();
  }

  /** A click or tap on a site opens its details and reports true, so the map doesn't pin a point there. */
  hit(point: maplibregl.Point): boolean {
    if (!this.on || !this.added) return false;
    const pad = 7;
    const box: [maplibregl.PointLike, maplibregl.PointLike] = [[point.x - pad, point.y - pad], [point.x + pad, point.y + pad]];
    const hits = this.map.queryRenderedFeatures(box, { layers: [SITES_LAYER] });
    let f = hits[0];
    let best = Infinity;
    for (const h of hits) {                   // sites overlap when zoomed out: take the nearest
      const [lon, lat] = (h.geometry as Point).coordinates;
      const q = this.map.project([lon, lat]);
      const d = (q.x - point.x) ** 2 + (q.y - point.y) ** 2;
      if (d < best) { best = d; f = h; }
    }
    if (!f) {
      if (this.popupPinned) this.closePopup();
      return false;
    }
    this.showPopup(f.properties as Record<string, unknown>, true);
    return true;
  }

  private showPopup(p: Record<string, unknown>, pinned: boolean) {
    this.closePopup();
    const s = p as unknown as Site;
    const status = (STATUSES.includes(s.status) ? s.status : "unknown") as SiteStatus;
    const num = (v: unknown) => (typeof v === "number" ? v : v == null || v === "null" ? null : Number(v));
    const latency = num(s.latency_s);
    const last = s.last_utc && s.last_utc !== "null" ? Date.parse(s.last_utc) : NaN;
    const str = (v: unknown) => (v == null || v === "null" || v === "" ? null : String(v));
    const rda = [str(s.rda), str(s.operability)?.replace(/^RDA - /, ""), str(s.mode)].filter(Boolean).join(" · ");
    // each phrase stays on one line; lines break only between phrases
    const ph = (...parts: (string | null | false)[]) =>
      parts.filter(Boolean).map((x) => `<span class="map-radar-ph">${x}</span>`).join("<span class=\"map-radar-sep\"> · </span>");
    const lines = [
      `<p class="map-radar-pop-head"><strong>${esc(String(s.id))}</strong>${str(s.name) ? ` ${esc(String(s.name))}` : ""}</p>`,
      `<p>${ph(`${markSvg(status)} ${STATUS_TEXT[status]}`,
        latency !== null && Number.isFinite(latency) && `latency ${Math.round(latency)} s`)}</p>`,
      Number.isFinite(last) || str(s.vcp)
        ? `<p>${ph(Number.isFinite(last) && `Level II ${ago(last)}`, str(s.vcp) && `VCP ${esc(String(s.vcp))}`)}</p>` : "",
      rda ? `<p class="muted">${ph(`RDA: ${esc(rda)}`)}</p>` : "",
      str(s.alarm) && str(s.alarm) !== "No Alarms" ? `<p class="muted">${ph(`Alarms: ${esc(String(s.alarm))}`)}</p>` : "",
      this.doc ? `<p class="muted">${ph(`NWS report, ${localClock(Date.parse(this.doc.updated))}`)}</p>` : "",
    ].join("");
    this.popup = new maplibregl.Popup({
      closeButton: pinned, closeOnClick: false, className: "map-radar-pop", offset: 10, maxWidth: "260px",
      focusAfterOpen: false,
    })
      .setLngLat([Number(s.lon), Number(s.lat)])
      .setHTML(lines)
      .addTo(this.map);
    this.popupPinned = pinned;
    if (pinned) this.popup.on("close", () => { this.popupPinned = false; this.popup = null; });
  }

  private closePopup() {
    const p = this.popup;
    this.popup = null;
    this.popupPinned = false;
    p?.remove();
  }

  /** A line for the legend while the layer is on. */
  legendHtml(now = Date.now()): string {
    if (!this.on) return "";
    if (!this.doc) {
      return `<p class="map-radar-key"><span class="map-radar-key-title">Radars</span> ${this.failed ? "couldn’t load the site list" : "loading…"}</p>`;
    }
    const counts = STATUSES.map((s) => ({ s, n: this.doc!.counts?.[s] ?? this.doc!.sites.filter((x) => x.status === s).length }))
      .filter(({ s, n }) => n > 0 || s !== "unknown");
    const t = Date.parse(this.doc.updated);
    const old = now - t > STALE_MS;
    return `<p class="map-radar-key"><span class="map-radar-key-title">Radars</span>${counts
      .map(({ s, n }) => `<span class="map-radar-count">${markSvg(s)}${n} ${LEGEND_WORD[s]}</span>`).join("")}<span class="muted">NWS, ${localClock(t)}${old ? " (old)" : ""}</span></p>`;
  }

  /** For saved images: a credit line while the layer is on. */
  credit(): string | null {
    return this.on ? "Radar sites: NWS" : null;
  }
}
