// The product pages: one Markdown file each in src/data/products/. The file name is the
// page address (ecconus.md becomes /products/ecconus/). The fields at the top of each file
// are checked here, so a typo stops the build with the file and field named.
import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";
import { stageIds } from "./lib/site";

const products = defineCollection({
  loader: glob({ pattern: "*.md", base: "./src/data/products" }),
  schema: ({ image }) =>
    z.object({
      title: z.string().trim().min(1),
      order: z.number().int(),
      stage: z.enum(stageIds),
      summary: z.string().trim().min(1),
      icon: z.enum(["ecconus", "storms", "fingerprints", "eccoworld", "generic"]).default("generic"),
      facts: z.array(z.object({ label: z.string().trim().min(1), value: z.string().trim().min(1) })).default([]),
      figures: z
        .array(z.object({ src: image(), alt: z.string().trim().min(1), caption: z.string().optional() }))
        .default([]),
      figure_credit: z.string().optional(),
      credits: z.array(z.string()).default([]),
      links: z.array(z.object({ label: z.string().trim().min(1), url: z.url() })).default([]),
    }),
});

export const collections = { products };
