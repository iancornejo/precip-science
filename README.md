# precip.science

Experimental, unofficial radar products by Ian Cornejo, built with [Astro](https://astro.build) and deployed to Cloudflare Workers on every push to `main`.

## Design

- `src/styles/tokens.css`: the Art glass design tokens, with an identical copy in the [iancornejo.github.io](https://github.com/iancornejo/iancornejo.github.io) repo; change both together.
- `public/fonts/`: Geom, self-hosted (SIL Open Font License 1.1, see `public/fonts/OFL.txt`).
- `design/matplotlib/`: the matching matplotlib style for figures (see its README).

## Development

```sh
npm install
npm run dev     # local preview at localhost:4321
npm run build   # production build into ./dist
```

## License

Code is MIT-licensed (see `LICENSE`). Text and figures are CC BY 4.0. Data credits: NOAA MRMS; ECCO via EccoPy; TITAN via LROSE. Geom is under the SIL OFL 1.1.
