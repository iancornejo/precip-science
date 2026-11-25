// The point panel: what every layer says under the pointer (or a tapped point), and for a
// pinned point, the convectivity and precipitation-rate history over the loop.
// Values come from full-resolution (z7, about 1 km) tiles of the nearest frame of each layer.
import type { Frame, FrameStore } from "./frames";
import type { Palette } from "./colors";
import { cssColor } from "./colors";
import { codeAt } from "./sample";
import { describe, LAYERS, LAYER_ORDER, convectivity, rainRate, convectivityClass, formatRate, NO_COVERAGE, MISSING, type LayerId } from "./layers";
import { stamp, utcClock } from "./timefmt";

export interface PanelContext {
  store: FrameStore;
  t: number;                                  // the time on screen
  loop: (layer: LayerId) => Frame[];          // frames of the current loop
  palette: (layer: LayerId) => Palette;
  windowLabel: string;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function latlon(lon: number, lat: number): string {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(2)}° ${ns}, ${Math.abs(lon).toFixed(2)}° ${ew}`;
}

type Series = { t: number; v: number | null }[];

function sparkline(series: Series, kind: "convectivity" | "rate", tNow: number, t0: number, t1: number, pal: Palette, label: string): string {
  const W = 260, H = 56, P = 2;
  const x = (t: number) => P + ((t - t0) / Math.max(1, t1 - t0)) * (W - 2 * P);
  const lo = kind === "rate" ? Math.log10(0.1) : 0, hi = kind === "rate" ? Math.log10(100) : 1;
  const y = (v: number) => {
    const f = kind === "rate" ? (Math.log10(Math.max(0.1, Math.min(100, v))) - lo) / (hi - lo) : v;
    return H - P - f * (H - 2 * P);
  };
  let bg = "";
  if (kind === "convectivity") {
    const band = (a: number, b: number, code: number) =>
      `<rect x="0" width="${W}" y="${y(b).toFixed(1)}" height="${(y(a) - y(b)).toFixed(1)}" fill="${cssColor(pal, code)}" opacity="0.18"/>`;
    bg = band(0, 0.4, 51) + band(0.4, 0.5, 113) + band(0.5, 1, 200);
  } else {
    bg = [1, 10].map((v) => `<line x1="0" x2="${W}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="spark-grid"/>`).join("");
  }
  const segs: string[][] = [];
  let cur: string[] = [];
  for (const p of series) {
    if (p.v === null) { if (cur.length) segs.push(cur); cur = []; continue; }
    cur.push(`${x(p.t).toFixed(1)},${y(kind === "rate" && p.v === 0 ? 0.1 : p.v).toFixed(1)}`);
  }
  if (cur.length) segs.push(cur);
  const lines = segs.map((s) => (s.length > 1
    ? `<polyline points="${s.join(" ")}" class="spark-line"/>`
    : `<circle cx="${s[0].split(",")[0]}" cy="${s[0].split(",")[1]}" r="1.8" class="spark-dot"/>`)).join("");
  const nowX = x(tNow).toFixed(1);
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" width="100%" height="${H}" role="img" aria-label="${esc(label)}">
    ${bg}${lines}<line x1="${nowX}" x2="${nowX}" y1="0" y2="${H}" class="spark-now"/></svg>`;
}

function describeSeries(name: string, series: Series, fmt: (v: number) => string, windowLabel: string): string {
  const vals = series.filter((p) => p.v !== null) as { t: number; v: number }[];
  if (!vals.length) return `${name}: no data over the last ${windowLabel}.`;
  const max = vals.reduce((a, b) => (b.v > a.v ? b : a));
  return `${name} over the last ${windowLabel}: ${fmt(vals[0].v)} at ${utcClock(vals[0].t)} UTC, ${fmt(vals[vals.length - 1].v)} at ${utcClock(vals[vals.length - 1].t)} UTC, highest ${fmt(max.v)} at ${utcClock(max.t)} UTC.`;
}

export class PointPanel {
  lon = 0;
  lat = 0;
  pinned = false;
  private token = 0;
  private seriesKey = "";
  private seriesData: { conv: Series; rate: Series } | null = null;

  constructor(private el: HTMLElement, private onClose: () => void) {}

  get visible() { return !this.el.hidden; }

  hide() {
    this.pinned = false;
    this.token++;
    this.el.hidden = true;
  }

  /** Values at (lon, lat) for the time on screen; with `pinned`, the loop's history too. */
  async show(ctx: PanelContext, lon: number, lat: number, pinned: boolean) {
    const token = ++this.token;
    this.lon = lon; this.lat = lat; this.pinned = pinned;
    const rows = await Promise.all(LAYER_ORDER.map(async (layer) => {
      const f = ctx.store.nearest(layer, ctx.t, 5);
      if (!f) return { layer, html: `<span class="muted">No frame</span>`, at: null as number | null };
      let code: number;
      try { code = await codeAt(f.url, lon, lat); } catch { return { layer, html: `<span class="muted">Not loaded</span>`, at: null }; }
      const r = describe(layer, code);
      let html = esc(r.text);
      if ((layer === "echo_type" || layer === "precip_flag") && code !== 0 && code !== NO_COVERAGE && code !== MISSING) {
        html = `<span class="swatch" style="background:${cssColor(ctx.palette(layer), code)}"></span>${html}`;
      }
      if (layer === "convectivity" && r.value !== null) html += ` <span class="muted">${convectivityClass(r.value)}</span>`;
      return { layer, html, at: Math.abs(f.t - ctx.t) >= 90e3 ? f.t : null };
    }));
    if (token !== this.token) return;
    const key = `${lon.toFixed(4)},${lat.toFixed(4)},${ctx.windowLabel},${ctx.loop("convectivity").length}`;
    const keepSeries = pinned && key === this.seriesKey && this.seriesData;
    this.el.innerHTML = `
      <div class="map-panel-head">
        <h2 id="map-panel-h">${pinned ? "Pinned point" : "Under the pointer"}</h2>
        <button type="button" class="map-btn map-panel-close" aria-label="Close the point panel">×</button>
      </div>
      <p class="map-panel-where">${latlon(lon, lat)}<br><span class="muted">${stamp(ctx.t).html}</span></p>
      <dl class="map-values">${rows.map((r) => `<div><dt>${LAYERS[r.layer].label}</dt><dd>${r.html}${r.at ? ` <span class="muted">(${utcClock(r.at)})</span>` : ""}</dd></div>`).join("")}</dl>
      <div class="map-series">${pinned
        ? (keepSeries ? this.seriesHtml(ctx) : `<p class="muted">Loading the last ${esc(ctx.windowLabel)}…</p>`)
        : `<p class="muted">Click or tap the map to pin a point and see its last ${esc(ctx.windowLabel)}.</p>`}</div>`;
    this.el.hidden = false;
    this.el.querySelector(".map-panel-close")?.addEventListener("click", () => { this.hide(); this.onClose(); });
    if (pinned && !keepSeries) {
      this.seriesKey = key;
      this.seriesData = null;
      await this.loadSeries(ctx, token);
    }
  }

  private async loadSeries(ctx: PanelContext, token: number) {
    const get = (layer: LayerId) => Promise.all(ctx.loop(layer).map(async (f) => {
      try {
        const c = await codeAt(f.url, this.lon, this.lat);
        if (c === NO_COVERAGE || c === MISSING) return { t: f.t, v: null };
        if (layer === "convectivity") return { t: f.t, v: c === 0 ? null : convectivity(c) };
        return { t: f.t, v: c === 0 ? 0 : rainRate(c) };
      } catch { return { t: f.t, v: null }; }
    }));
    const [conv, rate] = await Promise.all([get("convectivity"), get("precip_rate")]);
    if (token !== this.token) return;
    this.seriesData = { conv, rate };
    const box = this.el.querySelector(".map-series");
    if (box) box.innerHTML = this.seriesHtml(ctx);
  }

  private seriesHtml(ctx: PanelContext): string {
    if (!this.seriesData) return "";
    const { conv, rate } = this.seriesData;
    const all = [...conv, ...rate];
    if (!all.length) return `<p class="muted">No frames in this loop.</p>`;
    const t0 = Math.min(...all.map((p) => p.t)), t1 = Math.max(...all.map((p) => p.t));
    const convLabel = describeSeries("Convectivity", conv, (v) => v.toFixed(2), ctx.windowLabel);
    const rateLabel = describeSeries("Precipitation rate", rate, (v) => `${formatRate(v)} mm/h`, ctx.windowLabel);
    return `
      <p class="map-series-title">Last ${esc(ctx.windowLabel)} <span class="muted">· ${utcClock(t0)}–${utcClock(t1)} UTC</span></p>
      <figure><figcaption>Convectivity <span class="muted">· stratiform, mixed, convective bands</span></figcaption>
        ${sparkline(conv, "convectivity", ctx.t, t0, t1, ctx.palette("convectivity"), convLabel)}</figure>
      <figure><figcaption>Precipitation rate <span class="muted">· 0.1–100 mm/h, log</span></figcaption>
        ${sparkline(rate, "rate", ctx.t, t0, t1, ctx.palette("precip_rate"), rateLabel)}</figure>`;
  }
}
