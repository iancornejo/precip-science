// Color tables (design/map/colormaps.py writes colormaps.json) turned into PNG palettes.
import data from "./colormaps.json";
import { paletteChunks } from "./png";
import type { LayerId } from "./layers";

export interface LegendItem { label: string; color: string }
export interface LegendStop { v: number; color: string }
export type Legend =
  | { kind: "categorical"; items: LegendItem[] }
  | { kind: "binned"; units: string; edges: number[]; colors: string[]; labels: number[] }
  | { kind: "continuous"; scale: "linear" | "log"; min: number; max: number; units: string;
      stops: LegendStop[]; ticks: number[]; bands?: { from: number; to: number; label: string }[] };

export interface Palette {
  id: string;
  label: string;
  rgba: Uint8Array;                     // 256 x RGBA
  chunks: { plte: Uint8Array; trns: Uint8Array };
  legend: Legend;
}

type Raw = { layers: Record<string, { default: string; palettes: Record<string, { label: string; lut: string; legend: Legend }> }> };
const raw = data as unknown as Raw;

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(2 * i, 2), 16);
  return out;
}

const cache = new Map<string, Palette>();

/** The palette for a layer: `wanted` if it exists (?palette=artglass), else the layer's default. */
export function palette(layer: LayerId, wanted?: string | null): Palette {
  const entry = raw.layers[layer];
  const id = wanted && entry.palettes[wanted] ? wanted : entry.default;
  const key = `${layer}/${id}`;
  let p = cache.get(key);
  if (!p) {
    const rgba = hexToBytes(entry.palettes[id].lut);
    p = { id, label: entry.palettes[id].label, rgba, chunks: paletteChunks(rgba), legend: entry.palettes[id].legend };
    cache.set(key, p);
  }
  return p;
}

export function isDefaultPalette(layer: LayerId, id: string): boolean {
  return raw.layers[layer].default === id;
}

/** The palettes a layer offers, default first: [{id, label}]. */
export function paletteChoices(layer: LayerId): { id: string; label: string }[] {
  const e = raw.layers[layer];
  const ids = [e.default, ...Object.keys(e.palettes).filter((k) => k !== e.default)];
  return ids.map((id) => ({ id, label: e.palettes[id].label }));
}

export function cssColor(p: Palette, code: number): string {
  const i = 4 * code;
  return `rgb(${p.rgba[i]} ${p.rgba[i + 1]} ${p.rgba[i + 2]} / ${(p.rgba[i + 3] / 255).toFixed(3)})`;
}
