// The frame lists: index.json (last 2 h per layer, refreshed every minute) and, for longer
// loops, catalog.json (everything online, 48 h). Both come from pipeline/live/publish.py
// (schema 1): {base_url, layers: {name: {frames: [{t, key, bytes}], latest, ...}}}.
import type { LayerId } from "./layers";
import { LAYER_ORDER } from "./layers";

export interface Frame { t: number; url: string; bytes: number }

interface IndexDoc {
  schema: number;
  updated: string;
  base_url: string;
  window_hours: number | null;
  ecconus2d?: { version: string; kernel_mode: string; window_km: number };
  layers: Record<string, { title: string; version: string | null; latest: string | null; frames: { t: string; key: string; bytes: number }[] }>;
}

export class FrameStore {
  private lists = new Map<LayerId, Map<string, Frame>>();
  updated = 0;                    // when the pipeline last wrote index.json (ms)
  catalogLoaded = 0;              // when we last read catalog.json (ms)
  versions: Partial<Record<LayerId, string>> = {};
  ecconus: IndexDoc["ecconus2d"] | undefined;

  constructor(private indexUrl: string, private catalogUrl: string, private baseOverride?: string) {}

  private merge(doc: IndexDoc, prune: boolean) {
    if (doc.schema !== 1) console.warn("index schema", doc.schema);
    const base = this.baseOverride ?? doc.base_url;
    this.updated = Math.max(this.updated, Date.parse(doc.updated));
    this.ecconus = doc.ecconus2d ?? this.ecconus;
    for (const id of LAYER_ORDER) {
      const entry = doc.layers[id];
      if (!entry) continue;
      if (entry.version) this.versions[id] = entry.version;
      let list = this.lists.get(id);
      if (!list) this.lists.set(id, (list = new Map()));
      for (const f of entry.frames) {
        list.set(f.key, { t: Date.parse(f.t), url: new URL(f.key, base).href, bytes: f.bytes });
      }
      if (prune) {                  // the catalog is complete: drop frames it no longer lists
        const keep = new Set(entry.frames.map((f) => f.key));
        const oldest = entry.frames.length ? Date.parse(entry.frames[0].t) : Infinity;
        for (const [k, f] of list) if (!keep.has(k) && f.t < oldest) list.delete(k);
      }
    }
  }

  private async get(url: string): Promise<IndexDoc> {
    const resp = await fetch(url, { cache: "no-cache" });
    if (!resp.ok) throw new Error(`${resp.status} for ${url}`);
    return resp.json();
  }

  async refresh(): Promise<void> {
    this.merge(await this.get(this.indexUrl), false);
    this.trim();
  }

  async loadCatalog(): Promise<void> {
    this.merge(await this.get(this.catalogUrl), true);
    this.catalogLoaded = Date.now();
    this.trim();
  }

  /** Frames past the 48 h window are gone from R2; forget them. */
  private trim() {
    const cut = Date.now() - 49 * 3600e3;
    for (const list of this.lists.values()) for (const [k, f] of list) if (f.t < cut) list.delete(k);
  }

  all(layer: LayerId): Frame[] {
    return [...(this.lists.get(layer)?.values() ?? [])].sort((a, b) => a.t - b.t);
  }

  latest(layer: LayerId): Frame | undefined {
    const all = this.all(layer);
    return all[all.length - 1];
  }

  /** Frames of a loop that ends at `end` and spans `hours`, about one every `stepMin` minutes. */
  window(layer: LayerId, end: number, hours: number, stepMin: number): Frame[] {
    const start = end - hours * 3600e3;
    const inside = this.all(layer).filter((f) => f.t > start - 30e3 && f.t <= end + 30e3);
    if (stepMin <= 2.5) return inside;
    const step = stepMin * 60e3;
    const out: Frame[] = [];
    let next = end;
    for (let i = inside.length - 1; i >= 0; i--) {   // newest first, keep one per step
      const f = inside[i];
      if (f.t <= next + 45e3) {
        out.push(f);
        next = f.t - step;
      }
    }
    return out.reverse();
  }

  /** The frame nearest to `t` within `tolMin` minutes, if any. */
  nearest(layer: LayerId, t: number, tolMin = 5): Frame | undefined {
    let best: Frame | undefined;
    for (const f of this.all(layer)) if (!best || Math.abs(f.t - t) < Math.abs(best.t - t)) best = f;
    return best && Math.abs(best.t - t) <= tolMin * 60e3 ? best : undefined;
  }
}
