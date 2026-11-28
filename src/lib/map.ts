// Settings for the live map (/map/), from src/data/map.yaml. A mistake in that file stops the
// build with the field named, so a broken edit never reaches the live site.
import { parse } from "yaml";
import { z } from "astro/zod";

import mapRaw from "../data/map.yaml?raw";

export const LAYER_IDS = ["echo_type", "convectivity", "composite", "precip_rate", "precip_flag"] as const;

const MapSettings = z.object({
  public: z.boolean().default(false),
  data: z.object({
    index: z.url(),
    catalog: z.url(),
    radars: z.url().default("https://data.precip.science/live/radars.json"),
    status: z.url().default("https://data.precip.science/live/status.json"),
  }),
  basemap: z.object({ pmtiles: z.url(), standin: z.string().startsWith("/") }),
  default_layer: z.enum(LAYER_IDS).default("echo_type"),
  windows: z
    .array(z.object({ hours: z.number().positive(), step_minutes: z.number().positive() }))
    .min(1),
  stale_after_minutes: z.number().positive().default(12),
});
export type MapSettingsT = z.infer<typeof MapSettings>;

function load(): MapSettingsT {
  const result = MapSettings.safeParse(parse(mapRaw));
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(top level)"}: ${i.message}`)
      .join("\n");
    throw new Error(`src/data/map.yaml has a problem:\n${issues}`);
  }
  return result.data;
}

export const MAP = load();
