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
| Precipitation rate | QPE bins from Ian's studies (0.1–200 mm/h, 16 bins; the first gray darkened to show on the paper basemap), or viridis reversed, 0.1–100 mm/h, log, from the legend's switch | this script, matplotlib |
| Precipitation type | seven MRMS PrecipFlag classes, every pair ≥ 17 apart under all three simulations | this script |

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
