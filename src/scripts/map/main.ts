// The precip.science live map (S08): MRMS-based layers from R2, colored in the browser.
//
// Frames are PMTiles of 8-bit codes (D28). A custom "frame://" protocol reads a tile through
// the block cache (blocks.ts), gives it the layer's palette (png.ts) and hands MapLibre a
// colored PNG. Two raster sources take turns: the next frame loads into the hidden one and
// the two swap once it's complete, so playback never shows a half-drawn frame.
import * as maplibregl from "maplibre-gl";
import type { RasterTileSource, RequestParameters } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import "maplibre-gl/dist/maplibre-gl.css";
import { PMTiles, Protocol } from "pmtiles";

import { basemap, type Basemap } from "./basemap";
import { stats, tileBytes, reader } from "./blocks";
import { palette, isDefaultPalette, type Palette } from "./colors";
import { FrameStore, type Frame } from "./frames";
import { LAYERS, LAYER_ORDER, NO_COVERAGE, type LayerId } from "./layers";
import { legendHtml } from "./legend";
import { onePixel, recolor } from "./png";
import { PointPanel, type PanelContext } from "./panel";
import { histogram, type ViewBox } from "./sample";
import { summarize } from "./summary";
import { ago, stamp } from "./timefmt";

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
const paletteChoice = params.get("palette");         // ?palette=artglass: the draft Art glass ECCO colors
const OPACITY = 0.9;
const SPEEDS = [{ label: "Slow", ms: 900 }, { label: "Normal", ms: 450 }, { label: "Fast", ms: 200 }];

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
};

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

const pal = (layer: LayerId): Palette =>
  palette(layer, layer === "echo_type" || layer === "convectivity" ? paletteChoice : null);

// ---------------------------------------------------------------- the frame protocol
let noCov: Uint8Array | null = null;
async function frameTile(req: RequestParameters): Promise<{ data: ArrayBuffer }> {
  const m = /^frame:\/\/(.+)\/([a-z_]+)\/([a-z0-9-]+)\/(\d+)\/(\d+)\/(\d+)$/.exec(req.url);
  if (!m) throw new Error(`bad frame url ${req.url}`);
  const layer = m[2] as LayerId;
  const p = palette(layer, m[3]);
  const bytes = await tileBytes(decodeURIComponent(m[1]), +m[4], +m[5], +m[6]);
  const png = recolor(bytes ?? (noCov ??= await onePixel(NO_COVERAGE)), p.chunks);
  return { data: png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer };
}

const template = (f: Frame, layer: LayerId) =>
  `frame://${encodeURIComponent(f.url)}/${layer}/${pal(layer).id}/{z}/{x}/{y}`;

// ---------------------------------------------------------------- map
maplibregl.setWorkerUrl(workerUrl);
const pmtilesProtocol = new Protocol();
maplibregl.addProtocol("pmtiles", pmtilesProtocol.tile);
maplibregl.addProtocol("frame", frameTile);

let map: maplibregl.Map;
let base: Basemap;

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
  $<HTMLElement>("#map-credits").innerHTML =
    `Radar: <a href="https://www.nssl.noaa.gov/projects/mrms/">NOAA MRMS</a>, processed here, not endorsed by NOAA · ` +
    `ECCO via <a href="https://github.com/iancornejo/EccoPy">EccoPy</a> · ${base.attribution}`;
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
  speed: $<HTMLButtonElement>("#map-speed"),
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
const panel = new PointPanel($<HTMLElement>("#map-panel"), () => { pinned = null; });
let pinned: { lon: number; lat: number } | null = null;

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

async function display(tpl: string): Promise<boolean> {
  const gen = ++showGen;
  if (shown[front] === tpl) return true;
  const back = front === "radar-a" ? "radar-b" : "radar-a";
  if (shown[back] !== tpl) {
    (map.getSource(back) as RasterTileSource).setTiles([tpl]);
    shown[back] = tpl;
  }
  await whenIdle();
  if (gen !== showGen) return false;
  map.setPaintProperty(back, "raster-opacity", OPACITY);
  map.setPaintProperty(front, "raster-opacity", 0);
  front = back;
  return true;
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
  for (const id of ["radar-a", "radar-b"]) {
    map.addSource(id, {
      type: "raster",
      tiles: [template(first, state.layer)],
      tileSize: 256,
      minzoom: 0,
      maxzoom: 7,
      bounds: [grid.west, grid.south, grid.east, grid.north],
    });
    map.addLayer({
      id, type: "raster", source: id,
      paint: { "raster-opacity": id === "radar-a" ? OPACITY : 0, "raster-resampling": "nearest", "raster-fade-duration": 0 },
    }, base.radarBefore);
    shown[id] = template(first, state.layer);
  }
}

// ---------------------------------------------------------------- loop and time
const win = () => cfg.windows[state.win];
const windowLabel = () => `${win().hours} h`;
const current = (): Frame | undefined => state.loop[state.idx];

function rebuildLoop(anchor: number | "latest") {
  const latest = store.latest(state.layer);
  if (!latest) {
    state.loop = [];
    state.idx = -1;
    return;
  }
  const w = win();
  const end = anchor === "latest" ? latest.t : Math.min(latest.t, anchor + (w.hours * 3600e3) / 2);
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

async function showIdx(i: number, announce = true) {
  if (!state.loop.length) return;
  state.idx = Math.max(0, Math.min(state.loop.length - 1, i));
  updateTimeUi();
  const f = current()!;
  await ensureRadar(f);
  await display(template(f, state.layer));
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
  const p = pal(state.layer);
  const preview = (state.layer === "echo_type" || state.layer === "convectivity") && !isDefaultPalette(state.layer, p.id)
    ? "Art glass preview colors" : null;
  ui.legend.innerHTML = legendHtml(LAYERS[state.layer].title, p, preview);
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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
    await showIdx(next, false);
    const last = state.idx === state.loop.length - 1;
    const dwell = SPEEDS[state.speed].ms * (last ? 3 : 1);
    await sleep(Math.max(30, dwell - (performance.now() - t0)));
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
  writeHash();
  renderLegend();
  (ui.layers.elements.namedItem("layer") as RadioNodeList).value = layer;
  const wasPlaying = state.playing;
  if (wasPlaying) pause();
  await showIdx(state.idx);
  if (wasPlaying) play();
}

async function setWindow(i: number) {
  if (i === state.win) return;
  const t = current()?.t;
  state.win = i;
  writeHash();
  const wasPlaying = state.playing;
  if (wasPlaying) pause();
  if (win().hours > 2.01 && Date.now() - store.catalogLoaded > 10 * 60e3) {
    ui.loading.hidden = false;
    ui.loading.textContent = "Loading the frame catalog…";
    try { await store.loadCatalog(); } catch (e) { console.warn(e); setBanner("Couldn't load the full frame catalog; showing the last 2 hours."); }
    ui.loading.hidden = true;
  }
  rebuildLoop(state.follow || t === undefined ? "latest" : t);
  await showIdx(state.idx);
  if (pinned) refreshPanel();
  if (wasPlaying) play();
}

// ---------------------------------------------------------------- refresh from the pipeline
async function refreshIndex() {
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
  ui.speed.addEventListener("click", () => {
    state.speed = (state.speed + 1) % SPEEDS.length;
    ui.speed.textContent = SPEEDS[state.speed].label;
    ui.speed.setAttribute("aria-label", `Speed: ${SPEEDS[state.speed].label}`);
  });
  ui.slider.addEventListener("input", () => {
    pause();
    state.follow = false;
    showIdx(Number(ui.slider.value));
  });
  ui.aboutOpen.addEventListener("click", () => ui.about.showModal());
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
  map.on("click", (e) => {
    pinned = { lon: e.lngLat.lng, lat: e.lngLat.lat };
    panel.show(panelContext(), pinned.lon, pinned.lat, true);
  });

  document.addEventListener("keydown", (e) => {
    const t = e.target as HTMLElement;
    if (e.metaKey || e.ctrlKey || e.altKey || ui.about.open) return;
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
      case "Escape": pinned = null; panel.hide(); break;
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
