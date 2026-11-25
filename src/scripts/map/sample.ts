// Reading codes out of frames: one point (the panel) or everything in view (the summary).
// Tiles follow pipeline/live/tiles.py: Web Mercator, 256 px, zooms 0-7; z7 pixels are about
// 1 km. Lower zooms keep the highest-priority code of each 2x2 block, so maxima survive.
import { tileBytes } from "./blocks";
import { decodeGray } from "./png";
import { NO_COVERAGE } from "./layers";

export const ZMAX = 7;
const TS = 256;
const MAX_TILES = 260;                     // decoded tiles kept (64 KB each)
const decoded = new Map<string, Promise<Uint8Array | null>>();

export function worldPx(lon: number, lat: number, z: number): { x: number; y: number } {
  const n = TS * 2 ** z;
  const s = Math.sin((Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180);
  return { x: ((lon + 180) / 360) * n, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n };
}

/** A tile's codes (256 x 256), or null when the frame leaves it out (all "no coverage"). */
export function codes(url: string, z: number, x: number, y: number): Promise<Uint8Array | null> {
  const key = `${url}|${z}/${x}/${y}`;
  let p = decoded.get(key);
  if (p) {
    decoded.delete(key); decoded.set(key, p);
    return p;
  }
  p = tileBytes(url, z, x, y).then(async (b) => (b ? (await decodeGray(b)).data : null));
  p.catch(() => decoded.delete(key));
  decoded.set(key, p);
  if (decoded.size > MAX_TILES) decoded.delete(decoded.keys().next().value as string);
  return p;
}

/** The code under a point at full resolution (z7). */
export async function codeAt(url: string, lon: number, lat: number): Promise<number> {
  const { x, y } = worldPx(lon, lat, ZMAX);
  const tx = Math.floor(x / TS), ty = Math.floor(y / TS);
  const data = await codes(url, ZMAX, tx, ty);
  if (!data) return NO_COVERAGE;
  return data[(Math.floor(y) - ty * TS) * TS + (Math.floor(x) - tx * TS)];
}

export interface ViewBox { west: number; south: number; east: number; north: number }

/** Count each code over the pixels in view at zoom z (for the text summary). */
export async function histogram(url: string, view: ViewBox, z: number, grid: ViewBox): Promise<Uint32Array> {
  const hist = new Uint32Array(256);
  const w = Math.max(view.west, grid.west), e = Math.min(view.east, grid.east);
  const s = Math.max(view.south, grid.south), n = Math.min(view.north, grid.north);
  if (w >= e || s >= n) return hist;
  const a = worldPx(w, n, z), b = worldPx(e, s, z);
  const x0 = Math.floor(a.x), x1 = Math.ceil(b.x), y0 = Math.floor(a.y), y1 = Math.ceil(b.y);
  const tiles: Promise<void>[] = [];
  for (let ty = Math.floor(y0 / TS); ty <= Math.floor((y1 - 1) / TS); ty++) {
    for (let tx = Math.floor(x0 / TS); tx <= Math.floor((x1 - 1) / TS); tx++) {
      tiles.push(codes(url, z, tx, ty).then((data) => {
        const px0 = Math.max(x0 - tx * TS, 0), px1 = Math.min(x1 - tx * TS, TS);
        const py0 = Math.max(y0 - ty * TS, 0), py1 = Math.min(y1 - ty * TS, TS);
        if (!data) { hist[NO_COVERAGE] += (px1 - px0) * (py1 - py0); return; }
        for (let py = py0; py < py1; py++) {
          const row = py * TS;
          for (let px = px0; px < px1; px++) hist[data[row + px]]++;
        }
      }));
    }
  }
  await Promise.all(tiles);
  return hist;
}
