# precip.science

Experimental, unofficial radar products by Ian C. Cornejo, built with [Astro](https://astro.build) and deployed to Cloudflare Workers on every push to `main`.

## Editing content

Everything you'd normally edit is in `src/data/`. Edit a file on GitHub (pencil, then commit) and the site redeploys in a few minutes. A mistake in a field stops the build with the file and field named, and the live site stays as it was.

- `products/*.md`: one file per product page (`ecconus.md` becomes `/products/ecconus/`). The fields at the top set the title, stage, card summary, facts box, figures and credits; the text below them is the page.
- `credits.yaml`: the shared data, method and software credits. Each product page lists the entries named in its `credits:` field, and the About page lists them all.
- `about.md`: the About page.

Stages are `live`, `in-development`, `planned`, `exploratory` and `feasibility-study`; their labels and colors are in `src/lib/site.ts`. The shared notice shown on the home and product pages is `src/components/Notice.astro`.

## Design

- `src/styles/tokens.css`: the Art glass design tokens, with an identical copy in the [iancornejo.github.io](https://github.com/iancornejo/iancornejo.github.io) repo; change both together.
- `public/fonts/`: Geom, self-hosted (SIL Open Font License 1.1, see `public/fonts/OFL.txt`).
- `design/matplotlib/`: the matching matplotlib style for figures (see its README).
- `design/figures/sample_frame.py`: remakes the sample frames in `src/assets/figures/` from the MRMS composite bundled with EccoPy's notebooks.

## Development

```sh
npm install
npm run dev     # local preview at localhost:4321
npm run build   # production build into ./dist
```

## License

Code is MIT-licensed (see `LICENSE`). Text and figures are CC BY 4.0. Data, method and software credits are on the About page (from `src/data/credits.yaml`). Geom is under the SIL OFL 1.1.
