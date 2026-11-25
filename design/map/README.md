# Map assets (S08)

The live map at `/map/` (page `src/pages/map.astro`, code `src/scripts/map/`, settings
`src/data/map.yaml`) needs three kinds of built files. None changes often; rebuild one only
when its source changes.

## Color tables: `src/scripts/map/colormaps.json`

```sh
pip install eccopy cmweather matplotlib colorspacious
python design/map/colormaps.py
```

Frames store 8-bit codes (the pipeline's `live/encode.py`), and the map colors them in the
browser with these 256-entry tables. The script prints a color-vision check (CAM02-UCS
distances under full-severity deutan, protan and tritan simulations) for the class palettes.

| Layer | Colors | Source |
| --- | --- | --- |
| Echo type, convectivity | EccoPy's defaults (D09), or the S02 Art glass draft from the legend's switch (or `?palette=artglass`) | `eccopy.core.colormaps` |
| Composite reflectivity | ChaseSpectral, −10 to 70 dBZ (D10) | cmweather |
| Precipitation rate | HomeyerRainbow, 0.1–100 mm/h, log; viridis reversed on the legend's switch. Ian's QPE bins (0.1–200, 16 bins) stay in the script for a QPE layer | cmweather, matplotlib |
| Precipitation type | seven MRMS PrecipFlag classes, every pair ≥ 17 apart under all three simulations | this script |

Choosing the rain-rate map (Nov 25): candidates were scored over the paper at the map's 0.9 opacity
(CAM02-UCS path length, step uniformity, lightness, distance to the paper, the water and the umber lines,
and the three CVD simulations), then drawn on two storm views. HomeyerRainbow had the longest path of
the maps that keep drizzle visible (about 150, against about 110 for viridis; its faintest step is still
23 from the paper). cmocean dense lost light rain over water (7 from the water color, against 24 for HomeyerRainbow), batlow drew drizzle in pink, and the
rainbow maps that start dark (RRate11, CET-R4, plasmidis) gave drizzle the most weight.

The legend's switch remembers the choice per layer in the browser (`localStorage`). Codes 0 (no echo) are clear, 254 (missing) and 255 (no coverage) get a light umber wash.

## Map labels in Geom (D32): `public/map/glyphs/`

MapLibre draws labels from pre-rendered glyph files. Built from the static TTFs in
`design/matplotlib/fonts/` (SIL OFL, `public/map/glyphs/OFL.txt`):

```sh
npx @sakitam-gis/font-maker-cli convert Geom-Regular.ttf Geom-Medium.ttf Geom-SemiBold.ttf Geom-Italic.ttf -o out
```

then each `out/Geom <Weight>/` folder, keeping only the ranges over 200 bytes (Latin, Latin
Extended, Greek, Cyrillic, punctuation), becomes `public/map/glyphs/geom-<weight>/`. The map's
styles name the fonts `geom-regular`, `geom-medium`, `geom-semibold` and `geom-italic`.

## The stand-in basemap: `public/map/basemap/standin-v1.json`

Used until the Protomaps extract is on R2 (D30; the pipeline's RUNBOOK section 16), and if it
ever fails to load. Natural Earth (public domain), clipped to 140–48° W, 14–62° N with
mapshaper:

- `ne_50m_land` (simplified to 40 %), `ne_50m_lakes`, `ne_50m_admin_0_boundary_lines_land`
- `ne_50m_admin_1_states_provinces_lines` (U.S., Canada, Mexico)
- `ne_10m_populated_places_simple` with `min_zoom` ≤ 7 (name and `mz`, Natural Earth's own zoom rank)

merged into one GeoJSON with a property `l` (land, lake, country, state, place). About 450 KB,
or about 130 KB as the browser downloads it.

## Testing locally

`astro dev` (or `astro build && astro preview`), then open
`http://localhost:4321/map/?data=http://localhost:8787/` with a copy of the bucket's `live/`
folder served on port 8787 by any static server that supports HTTP Range requests and CORS.
The `?data=` switch only works on localhost. `?basemap=standin` skips the Protomaps extract.
