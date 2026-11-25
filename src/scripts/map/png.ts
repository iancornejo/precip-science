// PNG helpers for the frames' 8-bit grayscale tiles (pipeline/live/tiles.py).
//
// recolor(): a gray 8-bit PNG and an indexed 8-bit PNG store their pixels the same way (one
// byte per pixel, same row filters), so turning a tile's codes into colors only means
// changing IHDR's color type to 3 and adding a palette (PLTE) and alpha table (tRNS). The
// browser then decodes the colors itself; no pixel loop, and a palette swap is cheap.
//
// decodeGray(): the codes themselves, for the point panel and the text summary.

const SIG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

let table: Uint32Array | null = null;
function crcTable(): Uint32Array {
  if (table) return table;
  table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}

function crc32(bytes: Uint8Array): number {
  const t = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** One PNG chunk: length, type, data, CRC over type + data. */
export function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** PLTE and tRNS chunks for a 256-entry RGBA table (1024 bytes). */
export function paletteChunks(rgba: Uint8Array): { plte: Uint8Array; trns: Uint8Array } {
  const rgb = new Uint8Array(768);
  const alpha = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    rgb[3 * i] = rgba[4 * i];
    rgb[3 * i + 1] = rgba[4 * i + 1];
    rgb[3 * i + 2] = rgba[4 * i + 2];
    alpha[i] = rgba[4 * i + 3];
  }
  return { plte: chunk("PLTE", rgb), trns: chunk("tRNS", alpha) };
}

const DROP = new Set(["PLTE", "tRNS", "bKGD", "gAMA", "cHRM", "sRGB", "iCCP", "sBIT", "hIST"]);

function type4(b: Uint8Array, off: number): string {
  return String.fromCharCode(b[off], b[off + 1], b[off + 2], b[off + 3]);
}

function checkHeader(png: Uint8Array): DataView {
  for (let i = 0; i < 8; i++) if (png[i] !== SIG[i]) throw new Error("not a PNG");
  if (type4(png, 12) !== "IHDR") throw new Error("PNG without IHDR first");
  const bitDepth = png[24];
  const colorType = png[25];
  if (bitDepth !== 8 || (colorType !== 0 && colorType !== 3) || png[28] !== 0) {
    throw new Error(`unexpected PNG (bit depth ${bitDepth}, color type ${colorType})`);
  }
  return new DataView(png.buffer, png.byteOffset, png.byteLength);
}

/** The same tile with a palette: gray codes in, colors out (see the note at the top). */
export function recolor(png: Uint8Array, pal: { plte: Uint8Array; trns: Uint8Array }): Uint8Array {
  const view = checkHeader(png);
  const ihdr = png.slice(16, 29);
  ihdr[9] = 3;                                 // color type: indexed
  const parts: Uint8Array[] = [SIG, chunk("IHDR", ihdr), pal.plte, pal.trns];
  let off = 33;
  while (off + 12 <= png.length) {
    const len = view.getUint32(off);
    const t = type4(png, off + 4);
    if (!DROP.has(t)) parts.push(png.subarray(off, off + 12 + len));
    off += 12 + len;
    if (t === "IEND") break;
  }
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let pos = 0;
  for (const p of parts) { out.set(p, pos); pos += p.length; }
  return out;
}

/** A one-pixel gray PNG holding `code`, for tiles the archive leaves out (all "no coverage"). */
export async function onePixel(code: number): Promise<Uint8Array> {
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, 1); v.setUint32(4, 1);
  ihdr[8] = 8; ihdr[9] = 0;
  const raw = new Uint8Array([0, code]);       // filter byte, one pixel
  const z = new Uint8Array(await new Response(
    new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer());
  const parts = [SIG, chunk("IHDR", ihdr), chunk("IDAT", z), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let pos = 0;
  for (const p of parts) { out.set(p, pos); pos += p.length; }
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** The tile's codes, row by row (width × height bytes). */
export async function decodeGray(png: Uint8Array): Promise<{ width: number; height: number; data: Uint8Array }> {
  const view = checkHeader(png);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  const idat: Uint8Array[] = [];
  let off = 8;
  while (off + 12 <= png.length) {
    const len = view.getUint32(off);
    const t = type4(png, off + 4);
    if (t === "IDAT") idat.push(png.subarray(off + 8, off + 8 + len));
    if (t === "IEND") break;
    off += 12 + len;
  }
  const inflated = new Uint8Array(await new Response(
    new Blob(idat as BlobPart[]).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer());
  const out = new Uint8Array(width * height);
  const stride = width + 1;
  for (let y = 0; y < height; y++) {
    const f = inflated[y * stride];
    const src = inflated.subarray(y * stride + 1, (y + 1) * stride);
    const row = y * width;
    const prev = row - width;
    for (let x = 0; x < width; x++) {
      const a = x > 0 ? out[row + x - 1] : 0;
      const b = y > 0 ? out[prev + x] : 0;
      const c = x > 0 && y > 0 ? out[prev + x - 1] : 0;
      let v = src[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) v += paeth(a, b, c);
      out[row + x] = v & 0xff;
    }
  }
  return { width, height, data: out };
}
