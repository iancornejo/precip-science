// The five map layers and how their 8-bit frame codes turn back into values.
// Mirrors pipeline/live/encode.py (D28): 255 = no coverage, 254 = missing, 0 = no echo or
// no precipitation. Keep the two in step if the encoding ever changes (index.json carries
// each layer's encoding too, as a check).

export type LayerId = "echo_type" | "convectivity" | "composite" | "precip_rate" | "precip_flag";
export const LAYER_ORDER: LayerId[] = ["echo_type", "convectivity", "composite", "precip_rate", "precip_flag"];

export const NO_COVERAGE = 255;
export const MISSING = 254;

export interface LayerInfo {
  label: string;          // menu and panel label
  title: string;          // legend title
  group: "EcConus 2D" | "MRMS";
  key: string;            // keyboard shortcut
}

export const LAYERS: Record<LayerId, LayerInfo> = {
  echo_type: { label: "Echo type", title: "Echo type (ECCO)", group: "EcConus 2D", key: "1" },
  convectivity: { label: "Convectivity", title: "Convectivity (ECCO)", group: "EcConus 2D", key: "2" },
  composite: { label: "Reflectivity", title: "Composite reflectivity", group: "MRMS", key: "3" },
  precip_rate: { label: "Precip rate", title: "Precipitation rate", group: "MRMS", key: "4" },
  precip_flag: { label: "Precip type", title: "Precipitation type", group: "MRMS", key: "5" },
};

/** Layers that share the composite's times (one frame per MRMS composite). */
export const COMPOSITE_LAYERS: LayerId[] = ["echo_type", "convectivity", "composite"];

const ECHO_NAMES: Record<number, string> = { 0: "No echo", 1: "Stratiform", 2: "Mixed", 3: "Convective" };
export const FLAG_NAMES: Record<number, string> = {
  0: "No precipitation", 1: "Warm stratiform rain", 2: "Warm stratiform rain", 3: "Snow", 4: "Snow",
  6: "Convective rain", 7: "Rain with hail", 10: "Cold stratiform rain",
  91: "Tropical stratiform mix", 96: "Tropical convective mix",
};

export const convectivity = (code: number) => (code - 1) / 250;
export const dbz = (code: number) => code * 0.5 - 30.5;
export const rainRate = (code: number) => 0.1 * 10 ** ((code - 1) / 60);

/** A value for the panel, or null where there's nothing to say (no coverage, missing). */
export interface Reading { text: string; value: number | null; code: number }

export function describe(layer: LayerId, code: number): Reading {
  if (code === NO_COVERAGE) return { text: "No coverage", value: null, code };
  if (code === MISSING) return { text: "Missing", value: null, code };
  switch (layer) {
    case "echo_type":
      return { text: ECHO_NAMES[code] ?? `Code ${code}`, value: code, code };
    case "convectivity":
      if (code === 0) return { text: "No echo", value: null, code };
      return { text: convectivity(code).toFixed(2), value: convectivity(code), code };
    case "composite":
      if (code === 0) return { text: "No echo", value: null, code };
      if (code === 1) return { text: "≤ −30 dBZ", value: -30, code };
      return { text: `${formatNumber(dbz(code), 1)} dBZ`, value: dbz(code), code };
    case "precip_rate":
      if (code === 0) return { text: "None", value: 0, code };
      if (code === 1) return { text: "≤ 0.1 mm/h", value: 0.1, code };
      return { text: `${formatRate(rainRate(code))} mm/h`, value: rainRate(code), code };
    case "precip_flag":
      return { text: FLAG_NAMES[code] ?? `Type ${code}`, value: code, code };
  }
}

/** Convectivity's class, from the EccoPy thresholds (0.4 and 0.5). */
export function convectivityClass(c: number): string {
  return c >= 0.5 ? "convective" : c >= 0.4 ? "mixed" : "stratiform";
}

export function formatRate(r: number): string {
  return r >= 10 ? Math.round(r).toString() : r >= 1 ? r.toFixed(1) : r.toFixed(2);
}

/** Numbers with a true minus sign (U+2212), as the site's typography uses. */
export function formatNumber(v: number, digits: number): string {
  const s = Math.abs(v).toFixed(digits);
  return v < 0 && Number(s) !== 0 ? `−${s}` : s;
}
