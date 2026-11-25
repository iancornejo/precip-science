// @ts-check
import { readFileSync } from 'node:fs';
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { parse } from 'yaml';

// The map (/map/) stays out of the sitemap until src/data/map.yaml says public: true (M2).
const mapPublic = parse(readFileSync(new URL('./src/data/map.yaml', import.meta.url), 'utf8'))?.public === true;

export default defineConfig({
  site: 'https://precip.science',
  integrations: [sitemap({ filter: (page) => !page.includes('/404') && (mapPublic || !page.includes('/map/')) })],
});
