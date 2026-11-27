// The precip.science live map (S08): MRMS-based layers from R2, colored in the browser.
//
// Frames are PMTiles of 8-bit codes (D28). A custom "frame://" protocol reads a tile through
// the block cache (blocks.ts), gives it the layer's palette (png.ts) and hands MapLibre a
// colored PNG. Two raster sources take turns: the next frame loads into the hidden one, which
// then fades in on top of the current one, so playback never shows a half-drawn frame.
import * as maplibregl from "maplibre-gl";
import type { RasterTileSource, RequestParameters } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import "maplibre-gl/dist/maplibre-gl.css";
import { PMTiles, Protocol } from "pmtiles";

import { basemap, TERRAIN_CREDIT, TERRAIN_LAYER, type Basemap } from "./basemap";
import { stats, tileBytes, reader } from "./blocks";
import { palette, paletteChoices, washChunks, type Palette } from "./colors";
import { FrameStore, type Frame } from "./frames";
import { LAYERS, LAYER_ORDER, NO_COVERAGE, type LayerId } from "./layers";
import { legendHtml } from "./legend";
import { onePixel, recolor } from "./png";
import { latlon, PointPanel, readPoint, type PanelContext } from "./panel";
import { histogram, type ViewBox } from "./sample";
import { drawOverlays, gifWriter, loadFonts, outputSize, videoWriter, type LoopWriter, type PointInfo, type Scene } from "./save";
import { summarize } from "./summary";
import { ago, fileStamp, localClock, stamp, utcStamp } from "./timefmt";

interface Config {
  index: string;
  catalog: string;
  basemap: { pmtiles: string; standin: string };
  defaultLayer: LayerId;
  windows: { hours: number; step: number }[];
  staleMin: number;
}

const cfg: Config = JSON.parse(document.getElementById("map-config")!.textContent!);
const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const app = $<HTMLElement>(".mapapp");
const params = new URLSearchParams(location.search);

// Local testing: ?data=http://localhost:8787/ points the map at a local copy of the bucket.
const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
const dataOverride = local ? params.get("data") : null;
const store = new FrameStore(
  dataOverride ? new URL("live/index.json", dataOverride).href : cfg.index,
  dataOverride ? new URL("live/catalog.json", dataOverride).href : cfg.catalog,
  dataOverride ?? undefined,
);
const OPACITY = 0.9;
const SPEEDS = [900, 450, 225, 110];     // ms per frame: 0.5x, 1x, 2x, 4x (the last frame stays 3x as long)

// ---------------------------------------------------------------- state
const state = {
  layer: cfg.defaultLayer as LayerId,
  win: 0,
  loop: [] as Frame[],
  idx: -1,
  follow: true,               // stay on the newest frame as new ones arrive
  playing: false,
  speed: 1,
  grid: null as ViewBox | null,
  pal: {} as Partial<Record<LayerId, string>>,   // color choice per layer (the legend's switch)
  terrain: false,
  labels: true,               // the basemap's place, water and road names
};

// Remembered in this browser only; storage can be missing or refuse, which is fine.
try { Object.assign(state.pal, JSON.parse(localStorage.getItem("precip-map-colors") ?? "{}")); } catch { /* none */ }
const LABELS_KEY = "precip-map-labels";
try { state.labels = localStorage.getItem(LABELS_KEY) !== "off"; } catch { /* none */ }
const urlPalette = params.get("palette");               // ?palette=artglass: Art glass ECCO colors
if (urlPalette) for (const l of ["echo_type", "convectivity"] as LayerId[]) state.pal[l] = urlPalette;
function savePalettes() {
  try { localStorage.setItem("precip-map-colors", JSON.stringify(state.pal)); } catch { /* none */ }
}

function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  const l = h.get("layer") as LayerId | null;
  if (l && LAYER_ORDER.includes(l)) state.layer = l;
  const w = Number(h.get("loop"));
  const wi = cfg.windows.findIndex((x) => x.hours === w);
  if (wi >= 0) state.win = wi;
}

function writeHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  h.set("layer", state.layer);
  h.set("loop", String(cfg.windows[state.win].hours));
  history.replaceState(null, "", `${location.pathname}${location.search}#${h.toString().replace(/%2F/g, "/")}`);
}

const pal = (layer: LayerId): Palette => palette(layer, state.pal[layer] ?? null);

// ---------------------------------------------------------------- the frame protocol
let noCov: Uint8Array | null = null;
async function frameTile(req: RequestParameters): Promise<{ data: ArrayBuffer }> {
  const m = /^frame:\/\/(.+)\/([a-z_]+)\/([a-z0-9-]+)\/(\d+)\/(\d+)\/(\d+)$/.exec(req.url);
  if (!m) throw new Error(`bad frame url ${req.url}`);
  const layer = m[2] as LayerId;
  const chunks = m[3] === "wash" ? washChunks(layer) : palette(layer, m[3]).chunks;
  const bytes = await tileBytes(decodeURIComponent(m[1]), +m[4], +m[5], +m[6]);
  const png = recolor(bytes ?? (noCov ??= await onePixel(NO_COVERAGE)), chunks);
  return { data: png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer };
}

const template = (f: Frame, layer: LayerId) =>
  `frame://${encodeURIComponent(f.url)}/${layer}/${pal(layer).id}/{z}/{x}/{y}`;
const washTemplate = (f: Frame, layer: LayerId) =>
  `frame://${encodeURIComponent(f.url)}/${layer}/wash/{z}/{x}/{y}`;

// ---------------------------------------------------------------- map
maplibregl.setWorkerUrl(workerUrl);
const pmtilesProtocol = new Protocol();
maplibregl.addProtocol("pmtiles", pmtilesProtocol.tile);
maplibregl.addProtocol("frame", frameTile);

let map: maplibregl.Map;
let base: Basemap;
let labelLayers: string[] = [];

function setLabels(on: boolean) {
  state.labels = on;
  for (const id of labelLayers) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
  try { localStorage.setItem(LABELS_KEY, on ? "on" : "off"); } catch { /* private mode */ }
}

async function createMap() {
  base = await basemap({
    pmtiles: cfg.basemap.pmtiles,
    standin: cfg.basemap.standin,
    origin: location.origin,
    probe: async () => {
      if (params.get("basemap") === "standin") return false;
      const p = new PMTiles(cfg.basemap.pmtiles);
      const h = await p.getHeader();
      pmtilesProtocol.add(p);
      return h.maxZoom > 0;
    },
  });
  app.dataset.basemap = base.kind;
  // Every symbol layer is a basemap label (the radar layers are rasters), so hidden labels can be
  // set in the style itself and never flash on at load.
  labelLayers = base.style.layers.filter((l) => l.type === "symbol").map((l) => l.id);
  if (!state.labels) {
    for (const l of base.style.layers) if (l.type === "symbol") l.layout = { ...l.layout, visibility: "none" };
  }

  map = new maplibregl.Map({
    container: "map",
    style: base.style,
    bounds: [[-125, 24.5], [-66.5, 49.5]],
    fitBoundsOptions: { padding: { top: 70, bottom: 150, left: 20, right: 20 } },
    minZoom: 2,
    maxZoom: 11,
    renderWorldCopies: false,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    fadeDuration: 0,
    hash: "view",
    attributionControl: false,      // credits sit in the time bar instead (#map-credits), always visible
  });
  // With no view in the link, fit the lower 48 between the cards along the top and bottom.
  if (!/(^|[#&])view=/.test(location.hash)) {
    map.once("load", () => {
      const top = (document.querySelector(".map-top") as HTMLElement).getBoundingClientRect();
      const bot = (document.querySelector(".map-bottom") as HTMLElement).getBoundingClientRect();
      const box = map.getContainer().getBoundingClientRect();
      const pad = {
        top: Math.max(20, top.bottom - box.top + 8),
        bottom: Math.max(20, box.bottom - bot.top + 8),
        left: 16, right: 16,
      };
      if (pad.top + pad.bottom < box.height - 120) map.fitBounds([[-125, 24.5], [-66.5, 49.5]], { padding: pad, animate: false });
    });
  }
  renderCredits();
  map.getCanvas().setAttribute("aria-label", "Radar map. The time controls below it carry a text summary of the frame.");
  map.touchZoomRotate.disableRotation();
  map.keyboard.disableRotation();
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  map.addControl(new maplibregl.ScaleControl({ unit: "imperial", maxWidth: 90 }), "bottom-left");
  const bottom = document.querySelector(".map-bottom") as HTMLElement;
  new ResizeObserver(() => app.style.setProperty("--map-bottom-h", `${bottom.offsetHeight + 16}px`)).observe(bottom);
  (window as unknown as Record<string, unknown>).__map = { map, stats };    // for debugging and tests
}

// ---------------------------------------------------------------- UI references
const ui = {
  play: $<HTMLButtonElement>("#map-play"),
  prev: $<HTMLButtonElement>("#map-prev"),
  next: $<HTMLButtonElement>("#map-next"),
  latest: $<HTMLButtonElement>("#map-latest"),
  speed: $<HTMLSelectElement>("#map-speed"),
  gotoOpen: $<HTMLButtonElement>("#map-goto-open"),
  barToggle: $<HTMLButtonElement>("#map-bar-toggle"),
  gotoForm: $<HTMLFormElement>("#map-goto"),
  gotoTime: $<HTMLInputElement>("#map-goto-time"),
  gotoUtc: $<HTMLElement>("#map-goto-utc"),
  terrain: $<HTMLInputElement>("#map-terrain"),
  labels: $<HTMLInputElement>("#map-labels"),
  saveOpen: $<HTMLButtonElement>("#map-save-open"),
  saveForm: $<HTMLFormElement>("#map-save"),
  savePoint: $<HTMLInputElement>("#map-save-point"),
  savePinHint: $<HTMLElement>("#map-save-pinhint"),
  saveFormat: $<HTMLElement>("#map-save-format"),
  saveInfo: $<HTMLElement>("#map-save-info"),
  saveGo: $<HTMLButtonElement>("#map-save-go"),
  saveClose: $<HTMLButtonElement>("#map-save-close"),
  saveStatus: $<HTMLElement>("#map-save-status"),
  saveResult: $<HTMLElement>("#map-save-result"),
  saveDownload: $<HTMLAnchorElement>("#map-save-download"),
  saveShare: $<HTMLButtonElement>("#map-save-share"),
  saveFile: $<HTMLElement>("#map-save-file"),
  slider: $<HTMLInputElement>("#map-slider"),
  time: $<HTMLElement>("#map-time"),
  age: $<HTMLElement>("#map-age"),
  loading: $<HTMLElement>("#map-loading"),
  legend: $<HTMLElement>("#map-legend"),
  summary: $<HTMLElement>("#map-summary"),
  banner: $<HTMLElement>("#map-banner"),
  layers: $<HTMLFormElement>("#map-layers"),
  windows: $<HTMLFormElement>("#map-windows"),
  about: $<HTMLDialogElement>("#map-about"),
  aboutOpen: $<HTMLButtonElement>("#map-about-open"),
};
const panel = new PointPanel($<HTMLElement>("#map-panel"), () => unpin());
let pinned: { lon: number; lat: number } | null = null;
let pinMarker: maplibregl.Marker | null = null;

function renderCredits() {
  $<HTMLElement>("#map-credits").innerHTML =
    `Radar: <a href="https://www.nssl.noaa.gov/projects/mrms/">NOAA MRMS</a>, processed here, not endorsed by NOAA · ` +
    `ECCO via <a href="https://github.com/iancornejo/EccoPy">EccoPy</a> · ${base.attribution}` +
    (state.terrain ? ` · ${TERRAIN_CREDIT}` : "");
}

/** A crosshair on the pinned point, so it's clear which spot the panel describes. */
function pin(lon: number, lat: number) {
  pinned = { lon, lat };
  if (!pinMarker) {
    const el = document.createElement("div");
    el.className = "map-pin";
    el.setAttribute("aria-hidden", "true");
    el.innerHTML = `<svg width="34" height="34" viewBox="0 0 34 34"><g fill="none" stroke-linecap="round">
      <g stroke="#F7F2E8" stroke-width="5"><circle cx="17" cy="17" r="7"/><path d="M17 2v7M17 25v7M2 17h7M25 17h7"/></g>
      <g stroke="#2E241D" stroke-width="2"><circle cx="17" cy="17" r="7"/><path d="M17 2v7M17 25v7M2 17h7M25 17h7"/></g></g></svg>`;
    pinMarker = new maplibregl.Marker({ element: el });
  }
  pinMarker.setLngLat([lon, lat]).addTo(map);
  panel.show(panelContext(), lon, lat, true);
  settlePin();
  if (!ui.saveForm.hidden && !saving) updateSaveForm();
}

function unpin() {
  pinned = null;
  pinMarker?.remove();
  panel.hide();
  if (!ui.saveForm.hidden && !saving) updateSaveForm();
}

/**
 * Pan the map, if need be, so the crosshair isn't hidden under the panel or a card. It acts for a
 * few seconds after a pin or a tab switch (the panel grows as its values and history arrive), and
 * stops as soon as the reader moves the map themselves.
 */
let pinSettleUntil = 0;
function keepPinVisible() {
  if (!pinned || !panel.visible || performance.now() > pinSettleUntil) return;
  const box = map.getContainer().getBoundingClientRect();
  const pt = map.project([pinned.lon, pinned.lat]);
  const x = box.left + pt.x, y = box.top + pt.y, m = 22;
  const under = (r: DOMRect) => r.width > 0 && x > r.left - m && x < r.right + m && y > r.top - m && y < r.bottom + m;
  const cards = [...document.querySelectorAll<HTMLElement>(".map-card")].map((c) => c.getBoundingClientRect());
  if (!cards.some(under)) return;
  const p = $<HTMLElement>("#map-panel").getBoundingClientRect();
  let tx = x, ty = y;
  if (p.width > box.width * 0.6) {
    // Phones: the panel spans the map, so aim for the middle of the gap between it and the cards below.
    const below = $<HTMLElement>(".map-bottom").getBoundingClientRect().top;
    if (below - p.bottom < 3 * m) return;
    ty = (p.bottom + below) / 2;
  } else if (under(p)) {
    tx = p.left - 3 * m;    // wider screens: just left of the panel
  } else return;
  map.panBy([x - tx, y - ty], { duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 300 });
}
function settlePin() {
  pinSettleUntil = performance.now() + 4000;
  requestAnimationFrame(() => keepPinVisible());
}
new ResizeObserver(() => keepPinVisible()).observe($<HTMLElement>("#map-panel"));
$<HTMLElement>("#map-panel").addEventListener("click", (e) => {
  if ((e.target as Element).closest("[role=tab]")) settlePin();
});

// ---------------------------------------------------------------- double-buffered frames
let front = "radar-a";
const shown: Record<string, string> = {};
let showGen = 0;

function whenIdle(): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      map.off("idle", finish);
      resolve();
    };
    const timer = setTimeout(finish, 6000);
    map.once("idle", finish);
    map.triggerRepaint();
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let chain: Promise<unknown> = Promise.resolve();

/** Show a frame. Calls run one after another, and a call that's been overtaken skips. */
function display(f: Frame, layer: LayerId, fadeMs = 0): Promise<boolean> {
  const gen = ++showGen;
  const echo = template(f, layer), wash = washTemplate(f, layer);
  const run = chain.then(() => swap(echo, wash, fadeMs, gen));
  chain = run.catch(() => false);
  return run;
}

const washOf = (id: string) => (id === "radar-a" ? "wash-a" : "wash-b");

async function swap(echo: string, wash: string, fadeMs: number, gen: number): Promise<boolean> {
  if (gen !== showGen) return false;
  if (shown[front] === echo && shown[washOf(front)] === wash) return true;
  const back = front === "radar-a" ? "radar-b" : "radar-a";
  for (const [id, tpl] of [[back, echo], [washOf(back), wash]] as const) {
    if (shown[id] !== tpl) {
      (map.getSource(id) as RasterTileSource).setTiles([tpl]);
      shown[id] = tpl;
    }
  }
  await whenIdle();
  if (gen !== showGen) return false;
  map.moveLayer(back, base.radarBefore);                  // the incoming frame goes on top
  map.setPaintProperty(washOf(back), "raster-opacity", OPACITY);   // the wash switches at once
  map.setPaintProperty(washOf(front), "raster-opacity", 0);
  await crossfade(back, front, fadeMs);
  front = back;
  return true;
}

/**
 * Fade the incoming frame in over the outgoing one so their combined opacity stays OPACITY
 * throughout: incoming b goes 0 → OPACITY, outgoing (OPACITY − b) / (1 − b). Where both frames
 * have echo, the colors blend with no darkening; echo that appears or goes away fades in or out.
 * (Fading the incoming frame in over the outgoing one at full strength made every step darken,
 * then snap back.)
 */
function crossfade(back: string, frontId: string, ms: number): Promise<void> {
  const set = (b: number) => {
    map.setPaintProperty(back, "raster-opacity", b);
    map.setPaintProperty(frontId, "raster-opacity", b >= OPACITY ? 0 : (OPACITY - b) / (1 - b));
  };
  if (ms <= 0) { set(OPACITY); return Promise.resolve(); }
  return new Promise((resolve) => {
    let done = false;
    const t0 = performance.now();
    const finish = () => { if (done) return; done = true; set(OPACITY); resolve(); };
    const step = (now: number) => {
      if (done) return;
      const k = Math.min(1, (now - t0) / ms);
      if (k >= 1) return finish();
      set(OPACITY * k);
      requestAnimationFrame(step);
    };
    set(0);
    requestAnimationFrame(step);
    setTimeout(finish, ms + 250);                         // a hidden tab doesn't run animation frames
  });
}

/** The two radar sources, added once the first frame's header gives the grid's bounds. */
async function ensureRadar(f: Frame) {
  if (state.grid) return;
  const h = await reader(f.url).getHeader();
  if (state.grid) return;
  state.grid = { west: h.minLon, south: h.minLat, east: h.maxLon, north: h.maxLat };
  addRadar(f, state.grid);
}

function addRadar(first: Frame, grid: ViewBox) {
  // Bottom to top: the two wash layers (missing, no coverage), then the two echo layers.
  for (const id of ["wash-a", "wash-b", "radar-a", "radar-b"]) {
    const tpl = id.startsWith("wash") ? washTemplate(first, state.layer) : template(first, state.layer);
    map.addSource(id, {
      type: "raster",
      tiles: [tpl],
      tileSize: 256,
      minzoom: 0,
      maxzoom: 7,
      bounds: [grid.west, grid.south, grid.east, grid.north],
    });
    map.addLayer({
      id, type: "raster", source: id,
      paint: {
        "raster-opacity": id.endsWith("-a") ? OPACITY : 0,
        "raster-opacity-transition": { duration: 0, delay: 0 },
        "raster-resampling": "nearest",
        "raster-fade-duration": 0,
      },
    }, base.radarBefore);
    shown[id] = tpl;
  }
}

// ---------------------------------------------------------------- loop and time
const win = () => cfg.windows[state.win];
const windowLabel = () => `${win().hours} h`;
const current = (): Frame | undefined => state.loop[state.idx];

/** The loop around `anchor`: centered on it, or ending at it (the time picker). */
function rebuildLoop(anchor: number | "latest", mode: "center" | "end" = "center") {
  const latest = store.latest(state.layer);
  if (!latest) {
    state.loop = [];
    state.idx = -1;
    return;
  }
  const w = win();
  const end = anchor === "latest" ? latest.t
    : Math.min(latest.t, mode === "end" ? anchor : anchor + (w.hours * 3600e3) / 2);
  state.loop = store.window(state.layer, end, w.hours, w.step);
  if (!state.loop.length) state.loop = [latest];
  if (anchor === "latest") state.idx = state.loop.length - 1;
  else {
    let best = 0;
    state.loop.forEach((f, i) => { if (Math.abs(f.t - anchor) < Math.abs(state.loop[best].t - anchor)) best = i; });
    state.idx = best;
  }
}

function updateTimeUi() {
  const f = current();
  const n = state.loop.length;
  ui.slider.max = String(Math.max(0, n - 1));
  ui.slider.value = String(Math.max(0, state.idx));
  ui.slider.disabled = n < 2;
  if (!f) {
    ui.time.textContent = "No frames online";
    ui.slider.setAttribute("aria-valuetext", "No frames");
    return;
  }
  const s = stamp(f.t);
  ui.time.innerHTML = s.html;
  localLine = s.local;
  ui.slider.setAttribute("aria-valuetext", `${s.text}, frame ${state.idx + 1} of ${n}`);
  const latest = store.latest(state.layer);
  const isLatest = latest && f.t === latest.t;
  ui.latest.disabled = !!isLatest && state.follow;
  ui.latest.setAttribute("aria-pressed", String(!!isLatest && state.follow));
  updateAge();
}

let localLine = "";
function updateAge() {
  const latest = store.latest(state.layer);
  if (!latest) return;
  const f = current();
  const lag = f ? latest.t - f.t : 0;
  const age = lag > 60e3 ? `${ago(f!.t)} · newest ${ago(latest.t)}` : `<span class="map-wide">Newest frame, </span>${ago(latest.t)}`;
  ui.age.innerHTML = `<span class="map-local-2">${localLine} · </span>${age}`;
  const stale = Date.now() - latest.t > cfg.staleMin * 60e3;
  setBanner(stale ? `No new ${LAYERS[state.layer].label.toLowerCase()} frames for ${ago(latest.t).replace(" ago", "")}. The pipeline may be paused or catching up.` : null);
}

function setBanner(text: string | null) {
  ui.banner.hidden = !text;
  ui.banner.textContent = text ?? "";
}

async function showIdx(i: number, announce = true, fadeMs = 0) {
  if (!state.loop.length) return;
  state.idx = Math.max(0, Math.min(state.loop.length - 1, i));
  updateTimeUi();
  const f = current()!;
  await ensureRadar(f);
  await display(f, state.layer, fadeMs);
  if (announce && !state.playing) scheduleSummary();
  if (panel.visible) refreshPanel();
}

// ---------------------------------------------------------------- summary, legend, panel
let summaryTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSummary() {
  if (summaryTimer) clearTimeout(summaryTimer);
  summaryTimer = setTimeout(async () => {
    const f = current();
    if (!f || !state.grid) return;
    const b = map.getBounds();
    const z = Math.max(0, Math.min(7, Math.round(map.getZoom() + 1)));
    try {
      const hist = await histogram(f.url, { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() }, z, state.grid);
      if (f !== current()) return;
      ui.summary.textContent = `${LAYERS[state.layer].label}, ${stamp(f.t).text}. ${summarize(state.layer, hist)}`;
    } catch (e) {
      console.warn(e);
    }
  }, 400);
}

function renderLegend() {
  ui.legend.innerHTML = legendHtml(LAYERS[state.layer].title, pal(state.layer), paletteChoices(state.layer));
}

/** The legend's color switch: the same frame, recolored. */
async function setPalette(id: string) {
  state.pal[state.layer] = id;
  savePalettes();
  renderLegend();
  const f = current();
  if (f) await display(f, state.layer);
  if (panel.visible) refreshPanel();
}

function panelContext(): PanelContext {
  const f = current();
  return {
    store,
    t: f ? f.t : Date.now(),
    loop: (layer) => {
      const w = win();
      const end = state.loop.length ? state.loop[state.loop.length - 1].t : Date.now();
      return store.window(layer, end + 3 * 60e3, w.hours, w.step).filter((x) => x.t <= end + 3 * 60e3);
    },
    palette: pal,
    windowLabel: windowLabel(),
  };
}

function refreshPanel() {
  if (pinned) panel.show(panelContext(), pinned.lon, pinned.lat, true);
  else if (panel.visible) panel.show(panelContext(), panel.lon, panel.lat, false);
}

// ---------------------------------------------------------------- playback
let playToken = 0;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

function zoomForTiles(): number {
  return Math.max(0, Math.min(7, Math.round(map.getZoom() + 1)));
}

async function prefetch(frames: Frame[]) {
  if (!state.grid) return;
  const z = zoomForTiles();
  const b = map.getBounds();
  const g = state.grid;
  const w = Math.max(b.getWest(), g.west), e = Math.min(b.getEast(), g.east);
  const s = Math.max(b.getSouth(), g.south), n = Math.min(b.getNorth(), g.north);
  if (w >= e || s >= n) return;
  const tile = (lon: number, lat: number) => {
    const N = 2 ** z;
    const x = Math.floor(((lon + 180) / 360) * N);
    const sn = Math.sin((lat * Math.PI) / 180);
    const y = Math.floor((0.5 - Math.log((1 + sn) / (1 - sn)) / (4 * Math.PI)) * N);
    return { x: Math.max(0, Math.min(N - 1, x)), y: Math.max(0, Math.min(N - 1, y)) };
  };
  const a = tile(w, n), c = tile(e, s);
  let done = 0;
  ui.loading.hidden = false;
  const token = playToken;
  await Promise.all(frames.map(async (f) => {
    const jobs: Promise<unknown>[] = [];
    for (let x = a.x; x <= c.x; x++) for (let y = a.y; y <= c.y; y++) jobs.push(tileBytes(f.url, z, x, y).catch(() => null));
    await Promise.all(jobs);
    done++;
    if (token === playToken) ui.loading.textContent = `Loading frames ${done}/${frames.length}`;
  }));
  if (token === playToken) ui.loading.hidden = true;
}

async function play() {
  if (state.loop.length < 2) return;
  state.playing = true;
  state.follow = false;
  ui.play.setAttribute("aria-pressed", "true");
  ui.play.setAttribute("aria-label", "Pause");
  app.dataset.playing = "true";
  const token = ++playToken;
  prefetch(state.loop);
  if (state.idx >= state.loop.length - 1) state.idx = -1;
  while (state.playing && token === playToken) {
    const t0 = performance.now();
    const next = (state.idx + 1) % state.loop.length;
    const ms = SPEEDS[state.speed];
    // a cross-fade over part of each frame's time; none when jumping back to the start
    const fade = next === 0 || reducedMotion.matches ? 0 : Math.round(Math.min(300, ms * 0.5));
    await showIdx(next, false, fade);
    const last = state.idx === state.loop.length - 1;
    await sleep(Math.max(30, ms * (last ? 3 : 1) - (performance.now() - t0)));
  }
}

function pause() {
  state.playing = false;
  playToken++;
  ui.loading.hidden = true;
  ui.play.setAttribute("aria-pressed", "false");
  ui.play.setAttribute("aria-label", "Play");
  app.dataset.playing = "false";
  scheduleSummary();
}

function step(d: number) {
  pause();
  if (!state.loop.length) return;
  const i = (state.idx + d + state.loop.length) % state.loop.length;
  state.follow = false;
  showIdx(i);
  const nxt = state.loop[(i + d + state.loop.length) % state.loop.length];
  if (nxt) prefetch([nxt]);
}

async function goLatest() {
  pause();
  state.follow = true;
  rebuildLoop("latest");
  await showIdx(state.idx);
}

// ---------------------------------------------------------------- layers and loops
async function setLayer(layer: LayerId) {
  if (layer === state.layer) return;
  const t = current()?.t;
  state.layer = layer;
  rebuildLoop(state.follow || t === undefined ? "latest" : t);
  if (!ui.saveForm.hidden && !saving) updateSaveForm();
  writeHash();
  renderLegend();
  (ui.layers.elements.namedItem("layer") as RadioNodeList).value = layer;
  const wasPlaying = state.playing;
  if (wasPlaying) pause();
  await showIdx(state.idx);
  if (wasPlaying) play();
}

/** catalog.json (all 48 h), read at most every 10 minutes. */
async function ensureCatalog(): Promise<boolean> {
  if (Date.now() - store.catalogLoaded < 10 * 60e3) return true;
  ui.loading.hidden = false;
  ui.loading.textContent = "Loading the frame catalog…";
  try {
    await store.loadCatalog();
    return true;
  } catch (e) {
    console.warn(e);
    setBanner("Couldn't load the full frame catalog; only the last 2 hours are available.");
    return false;
  } finally {
    ui.loading.hidden = true;
  }
}

// ---------------------------------------------------------------- the time picker: a 2 h loop ending at any time online
const pad2 = (n: number) => String(n).padStart(2, "0");
const toLocalInput = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

/** Collapse the time bar to one row (play, step, time, Latest) or open it again; remembered per browser. */
const BAR_KEY = "precip-map-bar";
const barCollapsed = () => $<HTMLElement>(".map-timebar").dataset.collapsed === "true";
function setBarCollapsed(collapsed: boolean, save = true) {
  $<HTMLElement>(".map-timebar").dataset.collapsed = String(collapsed);
  const label = collapsed ? "Show the time controls" : "Hide the time controls";
  ui.barToggle.setAttribute("aria-expanded", String(!collapsed));
  ui.barToggle.setAttribute("aria-label", label);
  ui.barToggle.title = label;
  if (collapsed && !ui.gotoForm.hidden) {
    ui.gotoForm.hidden = true;
    ui.gotoOpen.setAttribute("aria-expanded", "false");
  }
  if (collapsed && !ui.saveForm.hidden && !saving) {
    ui.saveForm.hidden = true;
    ui.saveOpen.setAttribute("aria-expanded", "false");
    clearSaveResult();
  }
  if (save) try { localStorage.setItem(BAR_KEY, collapsed ? "collapsed" : "open"); } catch { /* private mode */ }
}

async function openGoto() {
  if (barCollapsed()) setBarCollapsed(false);
  const open = ui.gotoForm.hidden;
  if (open && !ui.saveForm.hidden) {
    ui.saveForm.hidden = true;
    ui.saveOpen.setAttribute("aria-expanded", "false");
    clearSaveResult();
  }
  ui.gotoForm.hidden = !open;
  ui.gotoOpen.setAttribute("aria-expanded", String(open));
  if (!open) return;
  await ensureCatalog();
  const all = store.all(state.layer);
  if (!all.length) return;
  ui.gotoTime.min = toLocalInput(all[0].t);
  ui.gotoTime.max = toLocalInput(all[all.length - 1].t + 59e3);
  ui.gotoTime.value = toLocalInput(current()?.t ?? all[all.length - 1].t);
  showGotoUtc();
  ui.gotoTime.focus();
}

function showGotoUtc() {
  const t = new Date(ui.gotoTime.value).getTime();
  ui.gotoUtc.textContent = Number.isFinite(t) ? `= ${stamp(t).text.split(" · ")[0]}` : "";
}

async function gotoTime(e: Event) {
  e.preventDefault();
  const t = new Date(ui.gotoTime.value).getTime();
  if (!Number.isFinite(t)) return;
  pause();
  state.follow = false;
  const two = cfg.windows.findIndex((w) => w.hours <= 2.01);
  if (two >= 0) {
    state.win = two;
    (ui.windows.elements.namedItem("loop") as RadioNodeList).value = String(two);
    writeHash();
  }
  rebuildLoop(t, "end");
  state.idx = state.loop.length - 1;
  ui.gotoForm.hidden = true;
  ui.gotoOpen.setAttribute("aria-expanded", "false");
  await showIdx(state.idx);
  if (pinned) refreshPanel();
}

async function setWindow(i: number) {
  if (i === state.win) return;
  const t = current()?.t;
  state.win = i;
  writeHash();
  const wasPlaying = state.playing;
  if (wasPlaying) pause();
  if (win().hours > 2.01) await ensureCatalog();
  rebuildLoop(state.follow || t === undefined ? "latest" : t);
  if (!ui.saveForm.hidden && !saving) updateSaveForm();
  await showIdx(state.idx);
  if (pinned) refreshPanel();
  if (wasPlaying) play();
}

// ---------------------------------------------------------------- saving: an image of the frame, or the loop
// The map's canvas, as drawn, goes into an output canvas; save.ts adds the time, the color bar,
// the logo and its notes. A loop is stepped frame by frame with no fade, each frame fully loaded
// before it's taken, while the rest of the page is held still. All of it runs in this browser.
const PNG_CAP = 2560, VIDEO_CAP = 1920, GIF_CAP = 960;     // px on the long side
const desktopPointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
let saving = false;
let saveStop = false;
let saveUrl: string | null = null;
let saveBlobFile: File | null = null;
class Stopped extends Error {}

const saveKind = () => (ui.saveForm.elements.namedItem("kind") as RadioNodeList).value as "image" | "loop";
const saveFmt = () => (ui.saveForm.elements.namedItem("format") as RadioNodeList).value as "video" | "gif";
const setSaveStatus = (s: string) => { ui.saveStatus.textContent = s; };

function updateSaveForm() {
  const loop = saveKind() === "loop";
  ui.saveFormat.hidden = !loop;
  ui.savePoint.disabled = saving || !pinned;
  if (!pinned) ui.savePoint.checked = false;
  ui.savePinHint.hidden = !!pinned;
  const c = map.getCanvas();
  const o = outputSize(c.width, c.height, !loop ? PNG_CAP : saveFmt() === "gif" ? GIF_CAP : VIDEO_CAP);
  const speed = ui.speed.selectedOptions[0]?.textContent ?? "1×";
  ui.saveInfo.textContent = loop
    ? `${state.loop.length} frames (the ${windowLabel()} loop) at ${speed} speed, ${o.w} × ${o.h} px.`
    : `PNG, ${o.w} × ${o.h} px.`;
  ui.saveGo.textContent = !loop ? "Make PNG" : saveFmt() === "gif" ? "Make GIF" : "Make video";
}

function clearSaveResult() {
  if (saveUrl) URL.revokeObjectURL(saveUrl);
  saveUrl = null;
  saveBlobFile = null;
  ui.saveResult.hidden = true;
}

function openSave() {
  if (saving) return;
  if (barCollapsed()) setBarCollapsed(false);
  const open = ui.saveForm.hidden;
  if (open && !ui.gotoForm.hidden) {
    ui.gotoForm.hidden = true;
    ui.gotoOpen.setAttribute("aria-expanded", "false");
  }
  ui.saveForm.hidden = !open;
  ui.saveOpen.setAttribute("aria-expanded", String(open));
  if (open) {
    setSaveStatus("");
    updateSaveForm();
    ui.saveGo.focus();
  } else clearSaveResult();
}

/** Hold the page still while a file is made: everything but the save form ignores input. */
function lockUi(on: boolean) {
  saving = on;
  app.dataset.saving = String(on);
  for (const el of document.querySelectorAll<HTMLElement>(".map-top, #map-legend, #map-panel, #map, .map-timebar > .map-row, #map-bar-more, #map-goto")) {
    el.inert = on;
  }
  for (const el of ui.saveForm.querySelectorAll<HTMLInputElement>("input[type=radio]")) el.disabled = on;
  ui.savePoint.disabled = on || !pinned;
  ui.saveGo.disabled = on;
  ui.saveClose.textContent = on ? "Stop" : "Close";
}

/** Settle until every tile on screen has loaded (or 20 s pass). */
async function settle(maxMs = 20000) {
  const t0 = performance.now();
  while (!map.loaded() && performance.now() - t0 < maxMs) await whenIdle();
}

/** A hidden tab draws nothing, so wait to be seen again. */
function whenVisible(): Promise<void> {
  if (!document.hidden) return Promise.resolve();
  return new Promise((resolve) => {
    const on = () => { if (!document.hidden) { document.removeEventListener("visibilitychange", on); resolve(); } };
    document.addEventListener("visibilitychange", on);
  });
}

/** Copy the map's next drawn frame into `out` (scaled). Read inside the render event, while WebGL still holds it. */
function grabInto(out: HTMLCanvasElement, check: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const draw = () => {
      clearTimeout(timer);
      map.off("render", draw);
      const ctx = out.getContext("2d")!;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(map.getCanvas(), 0, 0, out.width, out.height);
      // the basemap is opaque, so a clear pixel means the browser didn't hand the image over
      if (check && ctx.getImageData(out.width >> 1, out.height >> 1, 1, 1).data[3] === 0) reject(new Error("the browser returned a blank map"));
      else resolve();
    };
    const timer = setTimeout(() => { map.off("render", draw); reject(new Error("the map didn't redraw")); }, 8000);
    map.on("render", draw);
    map.triggerRepaint();
  });
}

const nbsp = (s: string) => s.replace(/ /g, "\u00a0");

function exportScene(t: number, point: PointInfo | null): Scene {
  const basemapNote = base.kind === "protomaps" ? "Map © OpenStreetMap" : "Map: Natural Earth";
  return {
    title: LAYERS[state.layer].title,
    time: utcStamp(t),
    local: localClock(t),
    t,
    palette: pal(state.layer),
    // lines break only between phrases (the spaces inside each phrase don't break)
    notes: [
      ["Experimental and unofficial.", "Not a forecast or warning."].map(nbsp).join(" "),
      ["Radar: NOAA MRMS, not endorsed by NOAA", basemapNote, ...(state.terrain ? ["Terrain: Mapzen"] : [])].map(nbsp).join(" · "),
    ],
    point,
  };
}

async function exportPoint(t: number): Promise<PointInfo | null> {
  if (!pinned) return null;
  const rows = await readPoint({ ...panelContext(), t }, pinned.lon, pinned.lat);
  const at = map.project([pinned.lon, pinned.lat]);
  const h = panel.history;
  return {
    x: at.x, y: at.y,
    where: latlon(pinned.lon, pinned.lat),
    rows: rows.map((r) => ({ label: LAYERS[r.layer].label, text: r.text, muted: r.muted, swatch: r.swatch, note: r.note, at: r.at })),
    history: h ? { ...h, windowLabel: windowLabel(), convPal: pal("convectivity") } : null,
  };
}

const formatBytes = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

function showSaveResult(blob: Blob, name: string) {
  clearSaveResult();
  saveUrl = URL.createObjectURL(blob);
  saveBlobFile = new File([blob], name, { type: blob.type });
  ui.saveDownload.href = saveUrl;
  ui.saveDownload.download = name;
  ui.saveFile.textContent = `${name} · ${formatBytes(blob.size)}`;
  ui.saveShare.hidden = !(navigator.canShare?.({ files: [saveBlobFile] }));
  ui.saveResult.hidden = false;
  setSaveStatus("");
  if (desktopPointer) ui.saveDownload.click();      // desktop: straight to Downloads; the link stays for another copy
}

async function runSave(e: Event) {
  e.preventDefault();
  if (saving || !current()) return;
  const kind = saveKind();
  let fmt = saveFmt();
  const withPoint = ui.savePoint.checked && !!pinned;
  clearSaveResult();
  const wasPlaying = state.playing;
  if (wasPlaying) pause();
  const before = { idx: state.idx, follow: state.follow };
  const frames = kind === "image" ? [current()!] : state.loop.slice();
  saveStop = false;
  lockUi(true);
  let writer: LoopWriter | null = null;
  try {
    setSaveStatus("Getting ready…");
    await loadFonts();
    const src = map.getCanvas();
    const cssW = map.getContainer().clientWidth;
    const make = (cap: number) => {
      const o = outputSize(src.width, src.height, cap);
      const c = document.createElement("canvas");
      c.width = o.w; c.height = o.h;
      c.getContext("2d", { willReadFrequently: kind === "loop" && fmt === "gif" });   // the first call sets this
      return c;
    };
    let out = make(kind === "image" ? PNG_CAP : fmt === "gif" ? GIF_CAP : VIDEO_CAP);
    if (kind === "loop") {
      if (fmt === "video") writer = await videoWriter(out);
      if (!writer) {
        if (fmt === "video") setSaveStatus("This browser can't make video, so a GIF instead…");
        fmt = "gif";
        out = make(GIF_CAP);
        writer = await gifWriter(out);
      }
    }
    for (let i = 0; i < frames.length; i++) {
      if (saveStop) throw new Stopped();
      const f = frames[i];
      if (kind === "loop") {
        state.idx = i;
        updateTimeUi();
        setSaveStatus(`Frame ${i + 1} of ${frames.length}…`);
      }
      await display(f, state.layer, 0);
      await settle();
      await whenVisible();
      await grabInto(out, i === 0);
      drawOverlays(out, cssW, exportScene(f.t, withPoint ? await exportPoint(f.t) : null));
      if (writer) await writer.add(SPEEDS[state.speed] * (i === frames.length - 1 ? 3 : 1));
    }
    if (saveStop) throw new Stopped();
    setSaveStatus("Finishing…");
    const blob = writer
      ? await writer.finish()
      : await new Promise<Blob>((res, rej) => out.toBlob((b) => (b ? res(b) : rej(new Error("the PNG couldn't be made"))), "image/png"));
    const slug = state.layer.replace(/_/g, "-");
    const when = frames.length > 1 ? `${fileStamp(frames[0].t)}_to_${fileStamp(frames[frames.length - 1].t)}` : fileStamp(frames[0].t);
    showSaveResult(blob, `precip-science_${slug}_${when}.${writer ? writer.ext : "png"}`);
  } catch (err) {
    await writer?.cancel();
    setSaveStatus(err instanceof Stopped ? "Stopped." : `Couldn't save: ${(err as Error).message}.`);
    if (!(err instanceof Stopped)) console.warn(err);
  } finally {
    if (kind === "loop") {
      state.idx = Math.min(before.idx, state.loop.length - 1);
      state.follow = before.follow;
      updateTimeUi();
      await display(current()!, state.layer, 0);
    }
    lockUi(false);
    updateSaveForm();
    if (wasPlaying) play();
  }
}

// ---------------------------------------------------------------- refresh from the pipeline
async function refreshIndex() {
  if (saving) return;                       // the loop holds still while it's saved
  const before = store.latest(state.layer)?.t;
  try {
    await store.refresh();
    if (win().hours > 2.01 && Date.now() - store.catalogLoaded > 10 * 60e3) await store.loadCatalog().catch(() => {});
  } catch (e) {
    console.warn(e);
    setBanner("Couldn't reach the frame list at data.precip.science. Trying again every minute.");
    return;
  }
  const after = store.latest(state.layer)?.t;
  if (after !== before && state.follow && !state.playing) {
    rebuildLoop("latest");
    await showIdx(state.idx);
  } else {
    const t = current()?.t;
    if (!state.playing && t !== undefined) rebuildLoop(t);
    updateTimeUi();
  }
}

// ---------------------------------------------------------------- start
async function start() {
  readHash();
  const indexReady = store.refresh().then(() => true, (err) => { console.warn(err); return false; });
  await createMap();
  await new Promise<void>((resolve) => (map.loaded() ? resolve() : map.once("load", () => resolve())));
  renderLegend();
  const ok = await indexReady;
  if (!ok) setBanner("Couldn't reach the frame list at data.precip.science. Trying again every minute.");
  rebuildLoop("latest");
  const first = current();
  if (first) {
    await ensureRadar(first);
    updateTimeUi();
    await whenIdle();
    scheduleSummary();
  }
  app.dataset.state = "ready";
  writeHash();
  (ui.layers.elements.namedItem("layer") as RadioNodeList).value = state.layer;
  (ui.windows.elements.namedItem("loop") as RadioNodeList).value = String(state.win);

  ui.layers.addEventListener("change", () => setLayer((ui.layers.elements.namedItem("layer") as RadioNodeList).value as LayerId));
  ui.windows.addEventListener("change", () => setWindow(Number((ui.windows.elements.namedItem("loop") as RadioNodeList).value)));
  ui.play.addEventListener("click", () => (state.playing ? pause() : play()));
  ui.prev.addEventListener("click", () => step(-1));
  ui.next.addEventListener("click", () => step(1));
  ui.latest.addEventListener("click", () => goLatest());
  ui.speed.value = String(state.speed);
  ui.speed.addEventListener("change", () => { state.speed = Number(ui.speed.value); });
  let barPref: string | null = null;
  try { barPref = localStorage.getItem(BAR_KEY); } catch { /* private mode */ }
  setBarCollapsed(barPref === "collapsed", false);
  ui.barToggle.addEventListener("click", () => setBarCollapsed(!barCollapsed()));
  ui.gotoOpen.addEventListener("click", () => openGoto());
  ui.gotoForm.addEventListener("submit", gotoTime);
  ui.gotoTime.addEventListener("input", showGotoUtc);
  ui.gotoForm.querySelector(".map-goto-cancel")?.addEventListener("click", () => {
    ui.gotoForm.hidden = true;
    ui.gotoOpen.setAttribute("aria-expanded", "false");
  });
  ui.terrain.addEventListener("change", () => {
    state.terrain = ui.terrain.checked;
    map.setLayoutProperty(TERRAIN_LAYER, "visibility", state.terrain ? "visible" : "none");
    renderCredits();
  });
  ui.labels.checked = state.labels;
  ui.labels.addEventListener("change", () => setLabels(ui.labels.checked));
  ui.saveOpen.addEventListener("click", () => openSave());
  ui.saveForm.addEventListener("submit", runSave);
  ui.saveForm.addEventListener("change", (e) => { if ((e.target as HTMLInputElement).type === "radio") updateSaveForm(); });
  ui.saveClose.addEventListener("click", () => {
    if (saving) { saveStop = true; setSaveStatus("Stopping…"); }
    else openSave();
  });
  ui.saveShare.addEventListener("click", async () => {
    if (!saveBlobFile) return;
    try { await navigator.share({ files: [saveBlobFile], title: "precip.science" }); } catch { /* cancelled */ }
  });
  // keep the form's numbers current while it's open
  const saveInfoChanged = () => { if (!ui.saveForm.hidden && !saving) updateSaveForm(); };
  ui.speed.addEventListener("change", saveInfoChanged);
  map.on("resize", saveInfoChanged);
  ui.legend.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-pal]");
    if (b && b.getAttribute("aria-checked") !== "true") setPalette(b.dataset.pal!);
  });
  ui.slider.addEventListener("input", () => {
    pause();
    state.follow = false;
    showIdx(Number(ui.slider.value));
  });
  ui.aboutOpen.addEventListener("click", () => ui.about.showModal());
  $<HTMLButtonElement>("#map-about-link").addEventListener("click", () => ui.about.showModal());   // phones: in the notice
  ui.about.querySelector(".map-about-close")?.addEventListener("click", () => ui.about.close());

  map.on("moveend", () => {
    if (!state.playing) scheduleSummary();
    else prefetch(state.loop);
  });

  // The point panel: hover on a mouse, tap or click to pin.
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  let hoverTimer: ReturnType<typeof setTimeout> | null = null;
  map.on("mousemove", (e) => {
    if (!finePointer || pinned) return;
    if (hoverTimer) clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => panel.show(panelContext(), e.lngLat.lng, e.lngLat.lat, false), 120);
  });
  map.getCanvas().addEventListener("mouseleave", () => {
    if (hoverTimer) clearTimeout(hoverTimer);
    if (!pinned) panel.hide();
  });
  map.on("click", (e) => pin(e.lngLat.lng, e.lngLat.lat));
  map.on("movestart", (e) => { if ((e as { originalEvent?: Event }).originalEvent) pinSettleUntil = 0; });

  document.addEventListener("keydown", (e) => {
    const t = e.target as HTMLElement;
    if (e.metaKey || e.ctrlKey || e.altKey || ui.about.open || saving) return;
    // Leave typing and the controls' own keys alone: text fields always, and Space/Enter/arrows
    // on buttons, links, radios and the slider (they activate or move those).
    if (t.closest("textarea, select, [contenteditable], input:not([type=radio]):not([type=range])")) return;
    if ([" ", "Enter", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)
        && t.closest("button, a, input")) return;
    const layerKey = LAYER_ORDER.find((l) => LAYERS[l].key === e.key);
    if (layerKey) { setLayer(layerKey); e.preventDefault(); return; }
    switch (e.key) {
      case " ": case "k": state.playing ? pause() : play(); e.preventDefault(); break;
      case ",": case "j": step(-1); e.preventDefault(); break;
      case ".": case "l": step(1); e.preventDefault(); break;
      case "n": goLatest(); break;
      case "?": ui.about.showModal(); break;
      case "Escape": unpin(); break;
      case "t": openGoto(); e.preventDefault(); break;
      case "s": openSave(); e.preventDefault(); break;
    }
  });

  setInterval(() => { if (!document.hidden) refreshIndex(); }, 60e3);
  setInterval(updateAge, 30e3);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pause();
    else refreshIndex();
  });
}

start();
