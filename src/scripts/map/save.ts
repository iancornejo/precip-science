// Saving the map: a PNG of the frame on screen, or the loop as a video (MP4, or WebM where the
// browser can't make H.264) or a GIF. Everything happens in the reader's browser.
//
// main.ts draws the map's own canvas into an output canvas; this file draws what a saved image
// needs on top of it, kept to the corners so the map stays clear (Ian, Nov 27): the time top left,
// the color bar bottom left, the logo bottom right with the lines a copy must carry (unofficial,
// not endorsed by NOAA, OpenStreetMap), and, if asked, the pinned point's values and history.
// Sizes are in "overlay pixels", which match CSS pixels on screen and never get smaller than that,
// so the text stays readable in a small GIF. The encoders load only when a loop is saved.
import type { Palette } from "./colors";
import { cssColor } from "./colors";
import { formatNumber } from "./layers";
import type { Series } from "./panel";
import { utcClock } from "./timefmt";
import { DROP_DOME, DROP_VIEWBOX, DROP_WAVE } from "../../lib/dropmark";

const PAPER_CARD = "rgba(247, 242, 232, 0.95)";
const PAPER_LIGHT = "#F7F2E8";
const UMBER = "#2E241D";
const UMBER_MUTED = "#66574A";
const ACCENT = "#A3352A";
const RULE = "rgba(46, 36, 29, 0.24)";
const RULE_STRONG = "rgba(46, 36, 29, 0.38)";
const FAMILY = 'Geom, system-ui, -apple-system, "Segoe UI", sans-serif';
const font = (weight: number, px: number) => `${weight} ${px}px ${FAMILY}`;
const M = 12;                       // margin, overlay px

export interface PointInfo {
  x: number; y: number;             // map CSS px
  where: string;                    // "41.60° N, 95.80° W"
  rows: { label: string; text: string; muted: boolean; swatch: string | null; note: string | null; at: number | null }[];
  history: { conv: Series; rate: Series; t0: number; t1: number; windowLabel: string; convPal: Palette } | null;
}

export interface Scene {
  title: string;                    // the color bar's title: "Echo type (ECCO)"
  time: string;                     // "Nov 25, 2026, 17:50 UTC"
  local: string;                    // "10:50 AM MST"
  t: number;
  palette: Palette;
  notes: string[];                  // the small lines under the logo
  point: PointInfo | null;
}

/** Output size for a map canvas of w × h device px: at most `cap` px on the long side, even (H.264). */
export function outputSize(w: number, h: number, cap: number): { w: number; h: number } {
  const k = Math.min(1, cap / Math.max(w, h));
  const even = (v: number) => Math.max(2, 2 * Math.round((v * k) / 2));
  return { w: even(w), h: even(h) };
}

export async function loadFonts() {
  try {
    await Promise.all([document.fonts.load(font(400, 12)), document.fonts.load(font(600, 12))]);
  } catch { /* the fallback fonts will do */ }
}

// ---------------------------------------------------------------- text helpers
type Run = { text: string; font: string; color: string };

/** Lay runs of text out in lines no wider than maxW; words never split. */
function layout(ctx: CanvasRenderingContext2D, runs: Run[], maxW: number): { x: number; run: Run; text: string }[][] {
  const lines: { x: number; run: Run; text: string }[][] = [[]];
  let x = 0;
  for (const run of runs) {
    ctx.font = run.font;
    for (const word of run.text.match(/[^ ]+ *| +/g) ?? []) {      // words keep their trailing spaces; no-break spaces hold
      const w = ctx.measureText(word).width;
      const trimmed = ctx.measureText(word.trimEnd()).width;
      if (x > 0 && x + trimmed > maxW) {
        lines.push([]);
        x = 0;
        if (!word.trim()) continue;
      }
      lines[lines.length - 1].push({ x, run, text: word });
      x += w;
    }
  }
  // a separator never ends or starts a line
  for (const line of lines) {
    while (line.length && line[line.length - 1].text.trim() === "·") line.pop();
    if (line.length && line[0].text.trim() === "·") {
      const dx = line[1] ? line[1].x - line[0].x : 0;
      line.shift();
      for (const p of line) p.x -= dx;
    }
  }
  return lines;
}

function drawLines(ctx: CanvasRenderingContext2D, lines: ReturnType<typeof layout>, x: number, y: number, lh: number) {
  ctx.textBaseline = "alphabetic";
  lines.forEach((line, i) => {
    for (const p of line) {
      ctx.font = p.run.font;
      ctx.fillStyle = p.run.color;
      ctx.fillText(p.text, x + p.x, y + i * lh);
    }
  });
}

function lineWidth(ctx: CanvasRenderingContext2D, line: { x: number; run: Run; text: string }[]): number {
  const last = line[line.length - 1];
  if (!last) return 0;
  ctx.font = last.run.font;
  return last.x + ctx.measureText(last.text.trimEnd()).width;
}

function card(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = PAPER_CARD;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = RULE_STRONG;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

function setSpacing(ctx: CanvasRenderingContext2D, v: string) {
  if ("letterSpacing" in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = v;
}

const tick = (v: number) => (Math.abs(v) >= 1 || v === 0 ? formatNumber(v, 0) : formatNumber(v, 1));

// ---------------------------------------------------------------- the pieces
function timeCard(ctx: CanvasRenderingContext2D, s: Scene): { w: number; h: number; draw: (x: number, y: number) => void } {
  const padX = 12, padY = 9;
  ctx.font = font(600, 15);
  const w1 = ctx.measureText(s.time).width;
  ctx.font = font(400, 13);
  const w2 = ctx.measureText(s.local).width;
  const w = Math.max(w1, w2) + 2 * padX, h = 2 * padY + 36;
  return {
    w, h,
    draw(x, y) {
      card(ctx, x, y, w, h);
      ctx.textBaseline = "alphabetic";
      ctx.font = font(600, 15);
      ctx.fillStyle = UMBER;
      ctx.fillText(s.time, x + padX, y + padY + 14);
      ctx.font = font(400, 13);
      ctx.fillStyle = UMBER_MUTED;
      ctx.fillText(s.local, x + padX, y + padY + 32);
    },
  };
}

function legendCard(ctx: CanvasRenderingContext2D, p: Palette, title: string, w: number): { h: number; draw: (x: number, y: number) => void } {
  const L = p.legend;
  const padX = 12, padY = 10, innerW = w - 2 * padX;
  const units = L.kind !== "categorical" && L.units ? ` (${L.units})` : "";
  const head = layout(ctx, [{ text: title, font: font(600, 14), color: UMBER }, { text: units, font: font(400, 14), color: UMBER_MUTED }], innerW);
  let bodyH = 0;
  let items: { x: number; y: number; color: string; label: string }[] = [];
  if (L.kind === "categorical") {
    ctx.font = font(400, 13);
    let x = 0, y = 0;
    for (const it of L.items) {
      const iw = 18 + ctx.measureText(it.label).width;
      if (x > 0 && x + iw > innerW) { x = 0; y += 19; }
      items.push({ x, y, color: it.color, label: it.label });
      x += iw + 14;
    }
    bodyH = y + 17;
  } else {
    bodyH = 12 + 17 + (L.kind === "continuous" && L.bands?.length ? 15 : 0);
  }
  const h = padY + head.length * 19 + 4 + bodyH + 8 + 15 + padY - 2;
  return {
    h,
    draw(x0, y0) {
      card(ctx, x0, y0, w, h);
      const x = x0 + padX;
      let y = y0 + padY + 13;
      drawLines(ctx, head, x, y, 19);
      y += (head.length - 1) * 19 + 10;
      if (L.kind === "categorical") {
        ctx.font = font(400, 13);
        for (const it of items) {
          ctx.fillStyle = it.color;
          ctx.fillRect(x + it.x, y + it.y + 1, 12, 12);
          ctx.strokeStyle = "rgba(46, 36, 29, 0.28)";
          ctx.strokeRect(x + it.x + 0.5, y + it.y + 1.5, 11, 11);
          ctx.fillStyle = UMBER;
          ctx.fillText(it.label, x + it.x + 18, y + it.y + 12);
        }
      } else if (L.kind === "binned") {
        const n = L.colors.length, bw = innerW / n;
        L.colors.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(x + i * bw, y, Math.ceil(bw), 12); });
        ctx.strokeStyle = "rgba(46, 36, 29, 0.28)";
        ctx.strokeRect(x + 0.5, y + 0.5, innerW - 1, 11);
        ctx.font = font(400, 12);
        ctx.fillStyle = UMBER;
        L.edges.forEach((v, i) => {
          if (!L.labels.includes(v)) return;
          ctx.textAlign = i === 0 ? "left" : "center";
          ctx.fillText(tick(v), x + i * bw, y + 12 + 14);
        });
        ctx.textAlign = "left";
      } else {
        const log = L.scale === "log";
        const pos = (v: number) => {
          const f = log ? (Math.log10(v) - Math.log10(L.min)) / (Math.log10(L.max) - Math.log10(L.min)) : (v - L.min) / (L.max - L.min);
          return Math.min(1, Math.max(0, f));
        };
        const g = ctx.createLinearGradient(x, 0, x + innerW, 0);
        for (const s of L.stops) g.addColorStop(pos(s.v), s.color);
        ctx.fillStyle = g;
        ctx.fillRect(x, y, innerW, 12);
        ctx.strokeStyle = "rgba(46, 36, 29, 0.28)";
        ctx.strokeRect(x + 0.5, y + 0.5, innerW - 1, 11);
        ctx.font = font(400, 12);
        ctx.fillStyle = UMBER;
        L.ticks.forEach((v, i) => {
          ctx.textAlign = i === 0 ? "left" : i === L.ticks.length - 1 ? "right" : "center";
          ctx.fillText(tick(v), x + pos(v) * innerW, y + 12 + 14);
        });
        if (L.bands?.length) {
          ctx.font = font(400, 11);
          ctx.fillStyle = UMBER_MUTED;
          ctx.textAlign = "center";
          for (const b of L.bands) ctx.fillText(b.label, x + ((pos(b.from) + pos(b.to)) / 2) * innerW, y + 12 + 14 + 15);
        }
        ctx.textAlign = "left";
      }
      y += bodyH + 8;
      ctx.fillStyle = "rgba(46, 36, 29, 0.08)";
      ctx.fillRect(x, y, 12, 12);
      ctx.strokeStyle = "rgba(46, 36, 29, 0.28)";
      ctx.strokeRect(x + 0.5, y + 0.5, 11, 11);
      ctx.font = font(400, 12);
      ctx.fillStyle = UMBER_MUTED;
      ctx.fillText("No radar coverage", x + 18, y + 11);
    },
  };
}

/** The drop mark and "precip.science", with the notes under them, right-aligned. */
function brandBlock(ctx: CanvasRenderingContext2D, notes: string[], maxW: number): { w: number; h: number; draw: (x: number, y: number) => void } {
  const padX = 10, padY = 8, markH = 17, markW = (markH * DROP_VIEWBOX.w) / DROP_VIEWBOX.h, gap = 7, lh = 13.5;
  ctx.font = font(600, 15);
  const wordW = ctx.measureText("precip.science").width;
  const lines = notes.flatMap((n) => layout(ctx, [{ text: n, font: font(400, 10.5), color: UMBER_MUTED }], maxW - 2 * padX));
  const w = Math.min(maxW, Math.max(markW + gap + wordW, ...lines.map((l) => lineWidth(ctx, l))) + 2 * padX);
  const h = 2 * padY + 20 + (lines.length ? 4 + lines.length * lh : 0) - 2;
  return {
    w, h,
    draw(x, y) {
      card(ctx, x, y, w, h);
      const right = x + w - padX;
      // the mark, from its SVG paths
      const k = markH / DROP_VIEWBOX.h;
      ctx.save();
      ctx.translate(right - wordW - gap - markW, y + padY + 1);
      ctx.scale(k, k);
      ctx.translate(-DROP_VIEWBOX.x, -DROP_VIEWBOX.y);
      ctx.fillStyle = DROP_DOME.fill;
      ctx.fill(new Path2D(DROP_DOME.d));
      ctx.strokeStyle = DROP_WAVE.stroke;
      ctx.lineWidth = DROP_WAVE.width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke(new Path2D(DROP_WAVE.d));
      ctx.restore();
      ctx.textBaseline = "alphabetic";
      ctx.font = font(600, 15);
      ctx.fillStyle = UMBER;
      ctx.fillText("precip.science", right - wordW, y + padY + 14);
      lines.forEach((line, i) => {
        const lw = lineWidth(ctx, line);
        drawLines(ctx, [line], right - lw, y + padY + 20 + 4 + 10 + i * lh, 0);
      });
    },
  };
}

/** The crosshair, as on screen (main.ts pin()). */
function crosshair(ctx: CanvasRenderingContext2D, x: number, y: number) {
  const pass = (color: string, width: number) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, 2 * Math.PI);
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      ctx.moveTo(x + dx * 15, y + dy * 15);
      ctx.lineTo(x + dx * 8, y + dy * 8);
    }
    ctx.stroke();
  };
  pass("#F7F2E8", 5);
  pass(UMBER, 2);
  ctx.lineWidth = 1;
  ctx.lineCap = "butt";
}

function spark(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, series: Series, kind: "conv" | "rate",
  tNow: number, t0: number, t1: number, convPal: Palette) {
  const P = 2;
  const sx = (t: number) => x + P + ((t - t0) / Math.max(1, t1 - t0)) * (w - 2 * P);
  const lo = Math.log10(0.1), hi = Math.log10(100);
  const sy = (v: number) => {
    const f = kind === "rate" ? (Math.log10(Math.max(0.1, Math.min(100, v))) - lo) / (hi - lo) : v;
    return y + h - P - f * (h - 2 * P);
  };
  ctx.fillStyle = PAPER_LIGHT;
  ctx.fillRect(x, y, w, h);
  if (kind === "conv") {
    ctx.globalAlpha = 0.18;
    for (const [a, b, code] of [[0, 0.4, 51], [0.4, 0.5, 113], [0.5, 1, 200]]) {
      ctx.fillStyle = cssColor(convPal, code);
      ctx.fillRect(x, sy(b), w, sy(a) - sy(b));
    }
    ctx.globalAlpha = 1;
  } else {
    ctx.strokeStyle = "rgba(46, 36, 29, 0.2)";
    ctx.setLineDash([2, 3]);
    for (const v of [1, 10]) { ctx.beginPath(); ctx.moveTo(x, sy(v)); ctx.lineTo(x + w, sy(v)); ctx.stroke(); }
    ctx.setLineDash([]);
  }
  ctx.strokeStyle = UMBER;
  ctx.fillStyle = UMBER;
  ctx.lineWidth = 1.6;
  ctx.lineJoin = "round";
  let run: [number, number][] = [];
  const flush = () => {
    if (run.length > 1) { ctx.beginPath(); run.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py))); ctx.stroke(); }
    else if (run.length === 1) { ctx.beginPath(); ctx.arc(run[0][0], run[0][1], 1.8, 0, 2 * Math.PI); ctx.fill(); }
    run = [];
  };
  for (const p of series) {
    if (p.v === null) { flush(); continue; }
    run.push([sx(p.t), sy(kind === "rate" && p.v === 0 ? 0.1 : p.v)]);
  }
  flush();
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(sx(tNow), y); ctx.lineTo(sx(tNow), y + h); ctx.stroke();
  ctx.strokeStyle = RULE;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

function pointCard(ctx: CanvasRenderingContext2D, pt: PointInfo, t: number, w: number): { h: number; draw: (x: number, y: number) => void } {
  const padX = 12, padY = 10, innerW = w - 2 * padX, labelW = 94, rowH = 18;
  const hist = pt.history;
  const sparkH = 34;
  const histH = hist ? 10 + 17 + 2 * (15 + sparkH + 6) : 0;
  const h = padY + 12 + 18 + pt.rows.length * rowH + histH + padY - 2;
  return {
    h,
    draw(x0, y0) {
      card(ctx, x0, y0, w, h);
      const x = x0 + padX;
      let y = y0 + padY + 9;
      setSpacing(ctx, "1.6px");
      ctx.font = font(600, 10.5);
      ctx.fillStyle = ACCENT;
      ctx.fillText("PINNED POINT", x, y);
      setSpacing(ctx, "0px");
      y += 18;
      ctx.font = font(500, 13);
      ctx.fillStyle = UMBER;
      ctx.fillText(pt.where, x, y);
      y += 6;
      for (const r of pt.rows) {
        y += rowH;
        ctx.font = font(400, 12);
        ctx.fillStyle = UMBER_MUTED;
        ctx.fillText(r.label, x, y);
        let vx = x + labelW;
        if (r.swatch) {
          ctx.fillStyle = r.swatch;
          ctx.fillRect(vx, y - 10, 11, 11);
          ctx.strokeStyle = "rgba(46, 36, 29, 0.28)";
          ctx.strokeRect(vx + 0.5, y - 9.5, 10, 10);
          vx += 17;
        }
        const runs: Run[] = [{ text: r.text, font: font(r.muted ? 400 : 500, 13), color: r.muted ? UMBER_MUTED : UMBER }];
        if (r.note) runs.push({ text: ` ${r.note}`, font: font(400, 13), color: UMBER_MUTED });
        if (r.at !== null) runs.push({ text: ` (${utcClock(r.at)})`, font: font(400, 12), color: UMBER_MUTED });
        const line = layout(ctx, runs, 1e6)[0];
        drawLines(ctx, [line], vx, y, 0);
      }
      if (!hist) return;
      y += 10;
      ctx.fillStyle = RULE;
      ctx.fillRect(x, y, innerW, 1);
      y += 17;
      drawLines(ctx, layout(ctx, [
        { text: `Last ${hist.windowLabel} `, font: font(600, 12.5), color: UMBER },
        { text: `· ${utcClock(hist.t0)}–${utcClock(hist.t1)} UTC`, font: font(400, 12), color: UMBER_MUTED },
      ], 1e6), x, y - 2, 0);
      for (const [label, kind, series] of [["Convectivity", "conv", hist.conv], ["Precipitation rate (mm/h, log)", "rate", hist.rate]] as const) {
        y += 15;
        ctx.font = font(400, 11.5);
        ctx.fillStyle = UMBER_MUTED;
        ctx.fillText(label, x, y);
        spark(ctx, x, y + 4, innerW, sparkH, series, kind, t, hist.t0, hist.t1, hist.convPal);
        y += 4 + sparkH + 2;
      }
    },
  };
}

// ---------------------------------------------------------------- the composition
/**
 * Draw the overlays onto `out`, which already holds the map image. `mapCssW` is the map's width in
 * CSS px, so the pinned point can be placed on the output.
 */
export function drawOverlays(out: HTMLCanvasElement, mapCssW: number, s: Scene) {
  const ctx = out.getContext("2d")!;
  const k = out.width / mapCssW;                 // output px per map CSS px
  const u = Math.max(1, k);                      // output px per overlay px
  const vw = out.width / u, vh = out.height / u; // the output in overlay px
  ctx.save();
  ctx.setTransform(u, 0, 0, u, 0, 0);
  ctx.textAlign = "left";

  if (s.point) crosshair(ctx, (s.point.x * k) / u, (s.point.y * k) / u);

  const time = timeCard(ctx, s);
  time.draw(M, M);

  const legendW = Math.min(290, vw - 2 * M);
  const legend = legendCard(ctx, s.palette, s.title, legendW);
  const legendY = vh - M - legend.h;
  legend.draw(M, legendY);

  // the logo in the bottom-right corner: beside the color bar, or above it on a narrow image
  const brand = brandBlock(ctx, s.notes, Math.min(380, vw - 2 * M));
  const beside = M + legendW + 12 + brand.w + M <= vw;
  brand.draw(vw - M - brand.w, beside ? vh - M - brand.h : legendY - 8 - brand.h);

  if (s.point) {
    const pw = Math.min(290, vw - 2 * M);
    const pc = pointCard(ctx, s.point, s.t, pw);
    if (vw >= 640) pc.draw(vw - M - pw, M);
    else pc.draw(M, M + time.h + 8);
  }
  ctx.restore();
}

// ---------------------------------------------------------------- loops
export interface LoopWriter {
  ext: string;
  mime: string;
  label: string;
  add(ms: number): Promise<void>;     // the canvas as it is now, shown for ms
  finish(): Promise<Blob>;
  cancel(): Promise<void>;
}

/** H.264 in MP4 where the browser can make it, else VP9 or VP8 in WebM; null if neither. Loads on demand. */
export async function videoWriter(canvas: HTMLCanvasElement): Promise<LoopWriter | null> {
  if (typeof VideoEncoder === "undefined") return null;
  return (await import("./video")).videoWriter(canvas);
}

export async function gifWriter(canvas: HTMLCanvasElement): Promise<LoopWriter> {
  return (await import("./gif")).gifWriter(canvas);
}
