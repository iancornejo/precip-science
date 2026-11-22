// Site-wide settings, the product stages, and the shared credits (src/data/credits.yaml).
// A mistake in credits.yaml stops the build with a message naming the entry and field,
// so a broken edit never reaches the live site. Product pages live in src/data/products/.
import { parse } from "yaml";
import { z } from "astro/zod";

import creditsRaw from "../data/credits.yaml?raw";

export const SITE = {
  name: "precip.science",
  tagline: "Experimental radar products",
  owner: "Ian C. Cornejo",
  ownerUrl: "https://iancornejo.github.io",
  contactUrl: "https://iancornejo.github.io/about/#contact",
  repo: "https://github.com/iancornejo/precip-science",
};

/** Where each product stands. Every product is experimental, whatever its stage. */
export const STAGES = {
  live: { label: "Live", color: "#3F7F62", text: "Running in real time, still experimental." },
  "in-development": { label: "In development", color: "#2F4B9A", text: "Being built now, not running live yet." },
  planned: { label: "Planned", color: "#C98A2E", text: "Scheduled, with work not yet started." },
  exploratory: { label: "Exploratory", color: "#A3352A", text: "Research first; it goes live only if it holds up." },
  "feasibility-study": { label: "Feasibility study", color: "#66574A", text: "Checking whether it can be done well at all." },
} as const;
export type Stage = keyof typeof STAGES;
export const stageIds = Object.keys(STAGES) as [Stage, ...Stage[]];

const text = z.string().trim().min(1);
const Credit = z.object({
  id: text,
  kind: z.enum(["Data", "Method", "Software"]),
  name: text,
  text,
  refs: z.array(z.object({ text, doi: text.optional() })).default([]),
  links: z.array(z.object({ label: text, url: z.url() })).default([]),
});
export type CreditT = z.infer<typeof Credit>;

function load<T extends z.ZodType>(schema: T, raw: string, file: string): z.infer<T> {
  const result = schema.safeParse(parse(raw));
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(top level)"}: ${i.message}`)
      .join("\n");
    throw new Error(`src/data/${file} has a problem:\n${issues}`);
  }
  return result.data;
}

export const credits = load(z.array(Credit), creditsRaw, "credits.yaml");

/** The credits named by id, in credits.yaml order; an unknown id stops the build. */
export function creditsFor(ids?: string[]): CreditT[] {
  if (!ids) return credits;
  for (const id of ids) {
    if (!credits.some((c) => c.id === id)) throw new Error(`Unknown credit id "${id}": add it to src/data/credits.yaml`);
  }
  return credits.filter((c) => ids.includes(c.id));
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/**
 * Plain text with radar subscripts: "Z_DR", "ρ_hv" and "K_DP" become Z<sub>DR</sub> and so on
 * (Geom has no subscript glyphs). Use in summaries and facts, which are plain text in the files.
 */
export function rich(s: string): string {
  return escapeHtml(s).replace(/([A-Za-zρ])_([A-Za-z]{1,3})\b/g, "$1<sub>$2</sub>");
}

/** The same text for places that can't hold HTML (meta descriptions): "Z_DR" becomes "ZDR". */
export function plain(s: string): string {
  return s.replace(/([A-Za-zρ])_([A-Za-z]{1,3})\b/g, "$1$2");
}
