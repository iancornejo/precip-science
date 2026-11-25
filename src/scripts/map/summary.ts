// A one-line text summary of the frame in view, for screen readers and the time bar.
// Lower zooms keep each block's highest code, so "the highest value in view" is exact at any
// zoom; which classes appear is exact for the top class and may miss small patches of others.
import { convectivity, convectivityClass, dbz, FLAG_NAMES, formatNumber, formatRate, MISSING, NO_COVERAGE, rainRate, type LayerId } from "./layers";

function maxCode(hist: Uint32Array, lo: number, hi: number): number {
  for (let c = hi; c >= lo; c--) if (hist[c] > 0) return c;
  return -1;
}

function list(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function summarize(layer: LayerId, hist: Uint32Array): string {
  let total = 0;
  for (let c = 0; c < 256; c++) total += hist[c];
  if (total === 0) return "The view is outside the radar mosaic.";
  if (hist[NO_COVERAGE] === total) return "No radar coverage in view.";
  switch (layer) {
    case "echo_type": {
      const present = [[3, "convective"], [2, "mixed"], [1, "stratiform"]]
        .filter(([c]) => hist[c as number] > 0).map(([, n]) => n as string);
      return present.length ? `In view: ${list(present)} echo.` : "No echo in view.";
    }
    case "convectivity": {
      const c = maxCode(hist, 1, 251);
      if (c < 0) return "No echo in view.";
      const v = convectivity(c);
      return `Highest convectivity in view: ${v.toFixed(2)} (${convectivityClass(v)}).`;
    }
    case "composite": {
      const c = maxCode(hist, 1, 251);
      return c < 0 ? "No echo in view." : `Strongest reflectivity in view: ${formatNumber(dbz(c), 1)} dBZ.`;
    }
    case "precip_rate": {
      const c = maxCode(hist, 1, 250);
      return c < 0 ? "No precipitation in view." : `Highest precipitation rate in view: ${formatRate(rainRate(c))} mm/h.`;
    }
    case "precip_flag": {
      const names: string[] = [];
      for (let c = 1; c < MISSING; c++) {
        const n = FLAG_NAMES[c];
        if (hist[c] > 0 && n && !names.includes(n.toLowerCase())) names.push(n.toLowerCase());
      }
      return names.length ? `Precipitation types in view: ${list(names)}.` : "No precipitation in view.";
    }
  }
}
