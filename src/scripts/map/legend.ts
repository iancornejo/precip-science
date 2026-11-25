// The legend for the layer on screen, from the palette's legend spec (colormaps.json).
import type { Palette } from "./colors";
import { formatNumber } from "./layers";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function pos(v: number, min: number, max: number, log: boolean): number {
  const f = log ? (Math.log10(v) - Math.log10(min)) / (Math.log10(max) - Math.log10(min)) : (v - min) / (max - min);
  return Math.min(100, Math.max(0, f * 100));
}

function tick(v: number): string {
  if (Math.abs(v) >= 1 || v === 0) return formatNumber(v, 0);
  return formatNumber(v, 1);
}

export function legendHtml(title: string, p: Palette, note: string | null): string {
  const L = p.legend;
  let body: string;
  if (L.kind === "categorical") {
    body = `<ul class="map-legend-items">${L.items
      .map((i) => `<li><span class="swatch" style="background:${i.color}"></span>${esc(i.label)}</li>`)
      .join("")}</ul>`;
  } else {
    const log = L.scale === "log";
    const grad = L.stops.map((s) => `${s.color} ${pos(s.v, L.min, L.max, log).toFixed(2)}%`).join(", ");
    const ticks = L.ticks
      .map((v) => `<span style="left:${pos(v, L.min, L.max, log).toFixed(2)}%">${tick(v)}</span>`)
      .join("");
    const bands = (L.bands ?? [])
      .map((b) => {
        const a = pos(b.from, L.min, L.max, log);
        const w = pos(b.to, L.min, L.max, log) - a;
        return `<span style="left:${(a + w / 2).toFixed(2)}%">${esc(b.label)}</span>`;
      })
      .join("");
    body = `<div class="map-ramp" style="background:linear-gradient(to right, ${grad})" aria-hidden="true"></div>
      <div class="map-ticks" aria-hidden="true">${ticks}</div>
      ${bands ? `<div class="map-bands" aria-hidden="true">${bands}</div>` : ""}
      <p class="visually-hidden">Scale from ${tick(L.min)} to ${tick(L.max)} ${esc(L.units)}${log ? ", logarithmic" : ""}.</p>`;
  }
  const units = L.kind === "continuous" && L.units ? ` <span class="muted">(${esc(L.units)})</span>` : "";
  return `<p class="map-legend-title">${esc(title)}${units}</p>${body}
    <p class="map-legend-foot"><span class="swatch swatch-nocov"></span>No radar coverage${note ? ` · <span class="map-legend-note">${esc(note)}</span>` : ""}</p>`;
}
