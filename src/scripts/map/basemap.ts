// The basemap (D30) and its labels in Geom (D32).
//
// The preferred map is a Protomaps extract of OpenStreetMap on R2, drawn with the
// @protomaps/basemaps style in Art glass colors and pared down for radar: land, water, a few
// roads, borders and place names. If that file fails to load, a small Natural Earth map
// (public domain) stands in. Either way the radar is drawn above the land and water but below
// the roads, coastlines, borders and labels, so they stay readable over echo.
import type { FilterSpecification, LayerSpecification, StyleSpecification } from "maplibre-gl";
import { layers as protomapsLayers, namedFlavor, type Flavor } from "@protomaps/basemaps";

export const PAPER = "#F3ECDE";
const PAPER_DEEP = "#EDE3D1";
const WATER = "#CBD3DE";
const UMBER = "#2E241D";
const UMBER_MUTED = "#66574A";
const LINE = "#8C7B6B";
const ROAD = "#CBBBA6";
const WATER_TEXT = "#4B5E7E";
// Coastlines and lake shores: a deep slate ink, cool where the borders are warm, so a coast
// reads as a coast and not as one more border.
const COAST = "#22354E";
type LineWidth = NonNullable<Extract<LayerSpecification, { type: "line" }>["paint"]>["line-width"];
const COAST_WIDTH: LineWidth = ["interpolate", ["linear"], ["zoom"], 3, 0.7, 8, 1.2];

const FONT = { regular: "geom-regular", medium: "geom-medium", bold: "geom-semibold", italic: "geom-italic" };

// Optional terrain: a hillshade from the AWS-hosted Terrain Tiles (Mapzen, open data), drawn under
// the radar and off until the reader turns it on.
export const TERRAIN_LAYER = "terrain-hillshade";
export const TERRAIN_CREDIT = 'Terrain: <a href="https://registry.opendata.aws/terrain-tiles/">Terrain Tiles</a> (Mapzen; SRTM, GMTED2010, ETOPO1, USGS 3DEP and others)';
const TERRAIN_SOURCE = {
  type: "raster-dem" as const,
  tiles: ["https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png"],
  encoding: "terrarium" as const,
  tileSize: 256,
  maxzoom: 11,
  attribution: "",
};
const TERRAIN: LayerSpecification = {
  id: TERRAIN_LAYER, type: "hillshade", source: "terrain",
  layout: { visibility: "none" },
  paint: {
    "hillshade-exaggeration": 0.45,
    "hillshade-shadow-color": "#5B4A3D",
    "hillshade-highlight-color": "#FFFBF2",
    "hillshade-accent-color": "#7A6A5C",
    "hillshade-illumination-direction": 315,
  },
};

/** A paper-colored halo under a line layer, so borders read over dark radar colors too. */
function casing(l: LayerSpecification, extra = 1.8): LayerSpecification {
  const c = structuredClone(l) as LayerSpecification & { paint?: Record<string, unknown> };
  const w = c.paint?.["line-width"] ?? 1;
  // zoom expressions must stay top-level, so widen an interpolate's stops rather than wrap it
  const widen = (v: unknown): unknown => {
    if (typeof v === "number") return v + extra;
    if (Array.isArray(v) && v[0] === "interpolate") {
      const out: unknown[] = v.slice(0, 3);
      for (let i = 3; i < v.length; i += 2) out.push(v[i], typeof v[i + 1] === "number" ? v[i + 1] + extra : v[i + 1]);
      return out;
    }
    return 2.5;
  };
  c.id = `${l.id}-casing`;
  c.paint = { "line-color": PAPER, "line-opacity": 0.75, "line-width": widen(w) };
  return c as LayerSpecification;
}

export interface Basemap {
  style: StyleSpecification;
  radarBefore: string;      // radar layers go just under this layer
  kind: "protomaps" | "standin";
  attribution: string;
}

function artGlassFlavor(): Flavor {
  const f: Flavor = { ...namedFlavor("light") };
  delete f.pois;
  delete f.landcover;
  return {
    ...f,
    background: PAPER_DEEP, earth: PAPER, water: WATER,
    highway: ROAD, major: ROAD, minor_a: "#DED3C3", minor_b: "#DED3C3",
    boundaries: LINE,
    roads_label_major: UMBER_MUTED, roads_label_major_halo: PAPER,
    roads_label_minor: UMBER_MUTED, roads_label_minor_halo: PAPER,
    ocean_label: WATER_TEXT,
    city_label: UMBER, city_label_halo: PAPER,
    subplace_label: UMBER_MUTED, subplace_label_halo: PAPER,
    state_label: UMBER_MUTED, state_label_halo: PAPER,
    country_label: UMBER_MUTED,
    regular: FONT.regular, bold: FONT.bold, italic: FONT.italic,
  };
}

// Kept from the Protomaps style; everything else (landcover, buildings, tunnels, icons, POIs,
// minor labels) is dropped to keep the map quiet under the radar.
const KEEP_BELOW = ["background", "earth", "water", "water_stream", "water_river"];
const KEEP_ROADS = ["roads_minor", "roads_major", "roads_highway"];
const KEEP_BORDERS = ["boundaries_country", "boundaries"];
const KEEP_LABELS = ["water_label_ocean", "water_label_lakes", "roads_labels_major", "places_region", "places_locality", "places_country"];

// The coast is the outline of the land polygons, so it matches the land and water exactly. Lake
// shores are the outlines of the lakes in the extract's tiles up to zoom 5, which carry only
// Natural Earth's major lakes (the Great Lakes, Great Salt Lake, Okeechobee, the big reservoirs);
// from zoom 6 the water layer holds every OpenStreetMap pond, and outlining those would speckle
// the radar. So from zoom 5 the shores come from a second view of the same file held to its
// zoom-5 tiles, and up close they are a little generalized next to the water fill. (Below zoom
// 5 the main source already has those tiles, so the second one stays idle there.)
const LAKES: FilterSpecification = ["all", ["==", ["geometry-type"], "Polygon"], ["==", ["get", "kind"], "lake"]];
const COAST_LAYERS: LayerSpecification[] = [
  { id: "coast", type: "line", source: "protomaps", "source-layer": "earth",
    filter: ["==", ["geometry-type"], "Polygon"],
    layout: { "line-join": "round" },
    paint: { "line-color": COAST, "line-width": COAST_WIDTH } },
  { id: "lake-shores", type: "line", source: "protomaps", "source-layer": "water", maxzoom: 5, filter: LAKES,
    layout: { "line-join": "round" },
    paint: { "line-color": COAST, "line-width": COAST_WIDTH } },
  { id: "lake-shores-z5", type: "line", source: "protomaps-lakes", "source-layer": "water", minzoom: 5, filter: LAKES,
    layout: { "line-join": "round" },
    paint: { "line-color": COAST, "line-width": COAST_WIDTH } },
];

function protomapsStyle(url: string, glyphs: string): Basemap {
  const all = protomapsLayers("protomaps", artGlassFlavor(), { lang: "en" });
  const byId = new Map(all.map((l) => [l.id, l]));
  const pick = (ids: string[]) => (ids.map((id) => byId.get(id)).filter(Boolean) as LayerSpecification[]).map((l) => {
    const layer = structuredClone(l) as LayerSpecification & { layout?: Record<string, unknown>; paint?: Record<string, unknown> };
    if (layer.layout && "icon-image" in layer.layout) delete layer.layout["icon-image"];   // no sprite
    if (layer.id === "boundaries_country") layer.paint = { ...layer.paint, "line-color": UMBER_MUTED, "line-width": 1 };
    if (layer.id === "boundaries") layer.paint = { ...layer.paint, "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.5, 8, 0.9] };
    return layer as LayerSpecification;
  });
  const below = [...pick(KEEP_BELOW), TERRAIN];
  // All the halos first, then all the lines, so no line is cut where another's halo crosses it.
  const lines = [...COAST_LAYERS, ...pick(KEEP_BORDERS)];
  const above = [...pick(KEEP_ROADS), ...lines.map((l) => casing(l)), ...lines, ...pick(KEEP_LABELS)];
  return {
    kind: "protomaps",
    radarBefore: above[0].id,
    attribution: '<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>',
    style: {
      version: 8,
      glyphs,
      sources: {
        protomaps: { type: "vector", url: `pmtiles://${url}`, attribution: "" },
        // the same file, read no deeper than zoom 5 (source options outrank the file's own maxzoom)
        "protomaps-lakes": { type: "vector", url: `pmtiles://${url}`, maxzoom: 5, attribution: "" },
        terrain: TERRAIN_SOURCE,
      },
      layers: [...below, ...above],
    },
  };
}

function standinStyle(url: string, glyphs: string): Basemap {
  const src = "standin";
  const kind = (k: string) => ["==", ["get", "l"], k] as unknown as FilterSpecification;
  return {
    kind: "standin",
    radarBefore: "standin-coast-casing",
    attribution: 'Basemap: <a href="https://www.naturalearthdata.com">Natural Earth</a>',
    style: {
      version: 8,
      glyphs,
      sources: { [src]: { type: "geojson", data: url, attribution: "" }, terrain: TERRAIN_SOURCE },
      layers: [
        { id: "standin-water", type: "background", paint: { "background-color": WATER } },
        { id: "standin-land", type: "fill", source: src, filter: kind("land"), paint: { "fill-color": PAPER } },
        { id: "standin-lakes", type: "fill", source: src, filter: kind("lake"), paint: { "fill-color": WATER } },
        TERRAIN,
        // coast: the land and lake outlines, without the edges of the clipping box (design/map/README.md)
        { id: "standin-coast-casing", type: "line", source: src, filter: kind("coast"), layout: { "line-join": "round" },
          paint: { "line-color": PAPER, "line-opacity": 0.75, "line-width": ["interpolate", ["linear"], ["zoom"], 3, 2.5, 8, 3] } },
        { id: "standin-states-casing", type: "line", source: src, filter: kind("state"),
          paint: { "line-color": PAPER, "line-opacity": 0.75, "line-width": ["interpolate", ["linear"], ["zoom"], 3, 2.2, 8, 2.8] } },
        { id: "standin-countries-casing", type: "line", source: src, filter: kind("country"),
          paint: { "line-color": PAPER, "line-opacity": 0.75, "line-width": ["interpolate", ["linear"], ["zoom"], 3, 2.6, 8, 3.2] } },
        { id: "standin-coast", type: "line", source: src, filter: kind("coast"), layout: { "line-join": "round" },
          paint: { "line-color": COAST, "line-width": COAST_WIDTH } },
        { id: "standin-states", type: "line", source: src, filter: kind("state"),
          paint: { "line-color": LINE, "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.6, 8, 1] } },
        { id: "standin-countries", type: "line", source: src, filter: kind("country"),
          paint: { "line-color": UMBER_MUTED, "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.8, 8, 1.4] } },
        { id: "standin-places", type: "symbol", source: src,
          // Natural Earth's own min_zoom (256 px tiles) ranks the cities; MapLibre zooms run one lower
          filter: ["all", kind("place"), ["<=", ["get", "mz"], ["+", ["zoom"], 1.3]]] as FilterSpecification,
          layout: {
            "text-field": ["get", "name"],
            "text-font": ["step", ["get", "mz"], ["literal", [FONT.medium]], 4.5, ["literal", [FONT.regular]]],
            "text-size": ["interpolate", ["linear"], ["zoom"], 3, ["step", ["get", "mz"], 12.5, 4.5, 11], 8, ["step", ["get", "mz"], 15, 4.5, 13.5]],
            "symbol-sort-key": ["get", "mz"],
            "text-padding": 6,
          },
          paint: { "text-color": UMBER, "text-halo-color": PAPER, "text-halo-width": 1.4 },
        } as LayerSpecification,
      ],
    },
  };
}

/** Use the Protomaps extract if it answers within a few seconds, else the stand-in. */
export async function basemap(opts: { pmtiles: string; standin: string; origin: string; probe: () => Promise<boolean> }): Promise<Basemap> {
  const glyphs = `${opts.origin}/map/glyphs/{fontstack}/{range}.pbf`;
  const standinUrl = new URL(opts.standin, opts.origin).href;
  let ok = false;
  try {
    ok = await Promise.race([opts.probe(), new Promise<boolean>((r) => setTimeout(() => r(false), 4000))]);
  } catch {
    ok = false;
  }
  return ok ? protomapsStyle(opts.pmtiles, glyphs) : standinStyle(standinUrl, glyphs);
}
