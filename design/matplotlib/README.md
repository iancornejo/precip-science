# Art glass style for matplotlib

Figures that match iancornejo.github.io and precip.science: Geom for all text (mathtext included), the site's paper and umber colors, and a line-color cycle checked for color-vision deficiencies.

```python
import sys
sys.path.insert(0, "path/to/precip-science/design/matplotlib")
import mcm

mcm.use()          # paper background, for the sites
mcm.use("paper")   # white background, for journals and slides
```

`mcm.use()` registers the Geom TTFs in `fonts/` and applies `mcm.mplstyle`. Calling `plt.style.use("mcm.mplstyle")` alone would fall back to another font, because matplotlib only finds Geom after it is registered.

## Colormaps

- Reflectivity and dual-pol fields: cmweather's CVD-friendly maps (D10), e.g. `cmap="ChaseSpectral"` for Z after `import cmweather`.
- ECCO echo types and convectivity: EccoPy's own colormaps (D09), from `eccopy.core.colormaps`.

## Notes

- Geom has the true minus, °, ±, ×, ≈, ≤, ≥ and Greek, but no subscript or superscript minus glyphs. Write units and subscripts with mathtext, e.g. `r"$Z_{DR}$ (dB)"` or `r"dB km$^{-1}$"`.
- Geom has no tabular figures, so digits are proportional. That's fine in static figures.
- The line colors are blue, ochre, red, slate, plum and umber. Under simulated deutan, protan and tritan vision, the first three stay at least 28 ΔE apart (CAM02-UCS) and all six at least 12. All six are at least 3:1 against the paper background.
- Fonts: Geom, SIL Open Font License 1.1 (`fonts/OFL.txt`).
