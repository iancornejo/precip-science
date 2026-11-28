// @ts-check
import { readFileSync } from 'node:fs';
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { parse } from 'yaml';

// The map (/map/) stays out of the sitemap until src/data/map.yaml says public: true (M2).
// The status page (/status/, S09) is unlisted: never in the sitemap or the menu.
const mapPublic = parse(readFileSync(new URL('./src/data/map.yaml', import.meta.url), 'utf8'))?.public === true;

export default defineConfig({
  site: 'https://precip.science',
  integrations: [sitemap({ filter: (page) => !page.includes('/404') && !page.includes('/status/') && (mapPublic || !page.includes('/map/')) })],
});
