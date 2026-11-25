// Reading frames from R2 with few requests.
//
// Every frame is its own PMTiles file, and a loop touches 60-100 of them, so the request
// count matters (the free tier, the data host's rate limit, and phones on slow links). The
// pmtiles library asks for each tile separately; this source instead reads aligned 16 KB
// blocks, merges the blocks wanted in the same moment into one Range request, and keeps
// them in memory. A frame's header and its low-zoom tiles sit in the first 64 KB, so at the
// national view one request usually covers a whole frame.
import { PMTiles, SharedPromiseCache, type RangeResponse, type Source } from "pmtiles";

const BLOCK = 16 * 1024;
const FIRST = 64 * 1024;            // header, directory, metadata and the low zooms
const MAX_BYTES = 48 * 1024 * 1024; // memory for cached blocks
const MAX_INFLIGHT = 8;
const GAP = 1;                      // merge runs separated by at most this many blocks

type Deferred = { resolve: (b: Uint8Array) => void; reject: (e: unknown) => void };

export const stats = { requests: 0, bytes: 0, hits: 0 };

class BlockNet {
  private cache = new Map<string, Uint8Array>();
  private cached = 0;
  private pending = new Map<string, Promise<Uint8Array>>();
  private waiting = new Map<string, Deferred>();
  private queue = new Map<string, Set<number>>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inflight = 0;
  private runs: Array<() => Promise<void>> = [];
  private sizes = new Map<string, number>();

  block(url: string, b: number): Promise<Uint8Array> {
    const key = `${url}#${b}`;
    const hit = this.cache.get(key);
    if (hit) {
      this.cache.delete(key); this.cache.set(key, hit);   // most recently used last
      stats.hits++;
      return Promise.resolve(hit);
    }
    const size = this.sizes.get(url);
    if (size !== undefined && b * BLOCK >= size) return Promise.resolve(new Uint8Array(0));
    let p = this.pending.get(key);
    if (!p) {
      p = new Promise<Uint8Array>((resolve, reject) => this.waiting.set(key, { resolve, reject }));
      this.pending.set(key, p);
      let set = this.queue.get(url);
      if (!set) this.queue.set(url, (set = new Set()));
      set.add(b);
      if (!this.timer) this.timer = setTimeout(() => this.flush(), 4);
    }
    return p;
  }

  private flush() {
    this.timer = null;
    for (const [url, set] of this.queue) {
      const blocks = [...set].sort((a, b) => a - b);
      let start = blocks[0];
      let end = blocks[0];
      for (let i = 1; i <= blocks.length; i++) {
        const b = blocks[i];
        if (b !== undefined && b - end <= GAP + 1) { end = b; continue; }
        const s = start, e = end;
        this.runs.push(() => this.fetchRun(url, s, e));
        if (b !== undefined) { start = b; end = b; }
      }
    }
    this.queue.clear();
    this.pump();
  }

  private pump() {
    while (this.inflight < MAX_INFLIGHT && this.runs.length) {
      const run = this.runs.shift()!;
      this.inflight++;
      run().finally(() => { this.inflight--; this.pump(); });
    }
  }

  private settle(url: string, b: number, bytes: Uint8Array | null, err?: unknown) {
    const key = `${url}#${b}`;
    const d = this.waiting.get(key);
    this.waiting.delete(key);
    this.pending.delete(key);
    if (bytes) this.store(key, bytes);
    if (!d) return;
    if (bytes) d.resolve(bytes);
    else d.reject(err ?? new Error("block unavailable"));
  }

  private store(key: string, bytes: Uint8Array) {
    if (this.cache.has(key)) return;
    this.cache.set(key, bytes);
    this.cached += bytes.length;
    for (const [k, v] of this.cache) {
      if (this.cached <= MAX_BYTES) break;
      this.cache.delete(k);
      this.cached -= v.length;
    }
  }

  private async fetchRun(url: string, b0: number, b1: number) {
    const from = b0 * BLOCK;
    const to = (b1 + 1) * BLOCK - 1;
    try {
      stats.requests++;
      const resp = await fetch(url, { headers: { Range: `bytes=${from}-${to}` } });
      if (resp.status === 416) {
        for (let b = b0; b <= b1; b++) this.settle(url, b, new Uint8Array(0));
        return;
      }
      if (!resp.ok) throw new Error(`${resp.status} for ${url}`);
      const buf = new Uint8Array(await resp.arrayBuffer());
      stats.bytes += buf.length;
      let base = from;
      if (resp.status === 200) {
        base = 0;                                  // the whole file: keep every block of it
        this.sizes.set(url, buf.length);
        for (let b = 0; b * BLOCK < buf.length; b++) {
          if (b < b0 || b > b1) this.store(`${url}#${b}`, buf.slice(b * BLOCK, (b + 1) * BLOCK));
        }
      } else {
        const total = Number((resp.headers.get("Content-Range") || "").split("/")[1]);
        if (Number.isFinite(total)) this.sizes.set(url, total);
      }
      for (let b = b0; b <= b1; b++) {
        const s = b * BLOCK - base;
        this.settle(url, b, buf.slice(Math.max(0, s), Math.max(0, s + BLOCK)));
      }
    } catch (err) {
      for (let b = b0; b <= b1; b++) this.settle(url, b, null, err);
    }
  }
}

const net = new BlockNet();

/** A pmtiles Source that reads through the shared block cache. */
class BlockSource implements Source {
  constructor(private url: string) {}
  getKey() { return this.url; }
  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    let start = offset;
    let end = offset + length;
    if (start < FIRST) { start = 0; end = Math.max(end, FIRST); }
    const b0 = Math.floor(start / BLOCK);
    const b1 = Math.max(b0, Math.ceil(end / BLOCK) - 1);
    const blocks = await Promise.all(Array.from({ length: b1 - b0 + 1 }, (_, i) => net.block(this.url, b0 + i)));
    const out = new Uint8Array(length);
    let pos = 0;
    for (let i = 0; i < blocks.length; i++) {
      const blk = blocks[i];
      const bStart = (b0 + i) * BLOCK;
      const s = Math.max(offset, bStart) - bStart;
      const e = Math.min(offset + length, bStart + blk.length) - bStart;
      if (e > s) { out.set(blk.subarray(s, e), pos); pos += e - s; }
      if (blk.length < BLOCK) break;               // end of file
    }
    return { data: out.buffer.slice(0, pos) };
  }
}

// One PMTiles reader per frame file, sharing one directory cache.
const dirCache = new SharedPromiseCache(800);
const readers = new Map<string, PMTiles>();

export function reader(url: string): PMTiles {
  let r = readers.get(url);
  if (!r) {
    r = new PMTiles(new BlockSource(url), dirCache);
    readers.set(url, r);
    if (readers.size > 600) readers.delete(readers.keys().next().value as string);
  }
  return r;
}

/** A tile's bytes, or null when the archive leaves it out. */
export async function tileBytes(url: string, z: number, x: number, y: number): Promise<Uint8Array | null> {
  const t = await reader(url).getZxy(z, x, y);
  return t ? new Uint8Array(t.data) : null;
}
