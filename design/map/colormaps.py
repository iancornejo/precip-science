"""Color tables for the S08 map viewer: src/scripts/map/colormaps.json.

Frames store 8-bit codes (D28, pipeline/live/encode.py), and the viewer colors them in the
browser with a 256-entry RGBA table per layer. This script builds those tables, and the
legends, from the same sources as the site's figures:

  echo type, convectivity   EccoPy's own colormaps (D09), plus the draft Art glass
                            alternative (website-plan.md, S02) behind ?palette=artglass
  composite reflectivity    cmweather ChaseSpectral, -10 to 70 dBZ (D10)
  precipitation rate        Ian's QPE bins (Cornejo et al. figures; 0.1, 1, 2, 6 ... 200, as mm/h),
                            with viridis reversed (log 0.1-100 mm/h) as the alternative
  precipitation type        CVD-checked colors for MRMS PrecipFlag classes (proposed in S08)

Codes: 0 no echo / no precipitation (transparent), 254 missing, 255 no coverage (a light wash).
Run:  python design/map/colormaps.py   (needs eccopy, cmweather, matplotlib, colorspacious)
"""
from __future__ import annotations

import itertools
import json
from pathlib import Path

import matplotlib
import numpy as np
from colorspacious import cspace_convert

import cmweather  # noqa: F401  (registers ChaseSpectral)
from eccopy.core import colormaps as ecm

OUT = Path(__file__).resolve().parents[2] / "src/scripts/map/colormaps.json"

NO_COVERAGE = (46, 36, 29, 18)     # umber at 7 %: where no radar sees
MISSING = (46, 36, 29, 46)         # umber at 18 %: the field is missing there
CLEAR = (0, 0, 0, 0)


def hexrgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def to8(rgb) -> tuple[int, int, int]:
    return tuple(int(round(float(c) * 255)) for c in rgb[:3])


def lut_hex(lut: list[tuple[int, int, int, int]]) -> str:
    assert len(lut) == 256
    return "".join(f"{r:02x}{g:02x}{b:02x}{a:02x}" for r, g, b, a in lut)


def css(rgb) -> str:
    return "#" + "".join(f"{c:02x}" for c in rgb[:3])


def base_lut() -> list:
    lut = [CLEAR] * 256
    lut[254], lut[255] = MISSING, NO_COVERAGE
    return lut


# ---------------------------------------------------------------- echo type
ECHO_NAMES = {1: "Stratiform", 2: "Mixed", 3: "Convective"}
ECHO_EC = {k: to8(c) for k, c in zip((1, 2, 3), ecm._BASIC_ECHO_TYPE_COLORS)}
ECHO_ART = {1: hexrgb("#4F6FC5"), 2: hexrgb("#A6C1B7"), 3: hexrgb("#A42B22")}


def echo_palette(colors: dict) -> dict:
    lut = base_lut()
    for k, rgb in colors.items():
        lut[k] = (*rgb, 255)
    return {"lut": lut_hex(lut), "legend": {"kind": "categorical",
            "items": [{"label": ECHO_NAMES[k], "color": css(colors[k])} for k in (1, 2, 3)]}}


# ---------------------------------------------------------------- convectivity
def conv_value(code: int) -> float:
    return (code - 1) / 250.0


def conv_palette(cmap) -> dict:
    lut = base_lut()
    for code in range(1, 252):
        lut[code] = (*to8(cmap(conv_value(code))), 255)
    stops = [{"v": round(v, 3), "color": css(to8(cmap(v)))} for v in np.linspace(0, 1, 101)]
    return {"lut": lut_hex(lut), "legend": {"kind": "continuous", "scale": "linear", "min": 0, "max": 1,
            "units": "", "stops": stops, "ticks": [0, 0.4, 0.5, 1],
            "bands": [{"from": 0, "to": 0.4, "label": "stratiform"}, {"from": 0.4, "to": 0.5, "label": "mixed"},
                      {"from": 0.5, "to": 1, "label": "convective"}]}}


def artglass_conv_cmap():
    """The S02 draft: blue band #24386E->#CED1E0, teal #076E5A->#86D9C1, red #FEA395->#4F120D,
    hard breaks at 0.4 and 0.5 (half a step below, as EccoPy does)."""
    eps = 0.5 / 1024
    to1 = lambda h: tuple(c / 255 for c in hexrgb(h))
    stops = [(0.0, to1("#24386E")), (0.4 - eps, to1("#CED1E0")), (0.4 - eps, to1("#076E5A")),
             (0.5 - eps, to1("#86D9C1")), (0.5 - eps, to1("#FEA395")), (1.0, to1("#4F120D"))]
    return matplotlib.colors.LinearSegmentedColormap.from_list("artglass_conv", stops, N=1024)


# ---------------------------------------------------------------- composite reflectivity
Z_MIN, Z_MAX = -10.0, 70.0


def dbz(code: int) -> float:
    return code * 0.5 - 30.5


def composite_palette() -> dict:
    cmap = matplotlib.colormaps["ChaseSpectral"]
    lut = base_lut()
    for code in range(1, 252):
        z = dbz(code)
        if z < Z_MIN:
            continue                      # below the map's range: clear, like no echo
        lut[code] = (*to8(cmap(min(1.0, (z - Z_MIN) / (Z_MAX - Z_MIN)))), 255)
    stops = [{"v": float(v), "color": css(to8(cmap((v - Z_MIN) / (Z_MAX - Z_MIN))))} for v in np.arange(Z_MIN, Z_MAX + 0.1, 1)]
    return {"lut": lut_hex(lut), "legend": {"kind": "continuous", "scale": "linear", "min": Z_MIN, "max": Z_MAX,
            "units": "dBZ", "stops": stops, "ticks": [-10, 10, 30, 50, 70]}}


# ---------------------------------------------------------------- precipitation rate
R_MIN, R_MAX = 0.1, 100.0


def rate(code: int) -> float:
    return 0.1 * 10 ** ((code - 1) / 60.0)


def rate_palette() -> dict:
    base = matplotlib.colormaps["viridis"]
    cmap = lambda f: base(0.95 * (1.0 - f))   # reversed, trimmed so the lightest step stays visible on paper
    frac = lambda r: (np.log10(min(max(r, R_MIN), R_MAX)) - np.log10(R_MIN)) / (np.log10(R_MAX) - np.log10(R_MIN))
    lut = base_lut()
    for code in range(1, 251):
        lut[code] = (*to8(cmap(frac(rate(code)))), 255)
    stops = [{"v": round(float(10 ** e), 4), "color": css(to8(cmap(frac(10 ** e))))} for e in np.linspace(-1, 2, 61)]
    return {"lut": lut_hex(lut), "legend": {"kind": "continuous", "scale": "log", "min": R_MIN, "max": R_MAX,
            "units": "mm/h", "stops": stops, "ticks": [0.1, 1, 10, 100]}}


# Ian's rainfall colorbar (sampled from his figure, Nov 25), used here as rate bins in mm/h.
# The lowest bin is a touch darker than his #F0F0F0 so drizzle stays visible on the paper basemap.
QPE_EDGES = [0.1, 1, 2, 6, 10, 15, 20, 30, 40, 50, 70, 90, 110, 130, 150, 200]
QPE_COLORS = ["#D9D9D9", "#CCE6FF", "#99CDFF", "#66B2FE", "#3399FF", "#1F77B4", "#FEFF99", "#FFCC66",
              "#FF9933", "#FF6600", "#E21A1B", "#B00025", "#800126", "#6A3D9A", "#9F6DB6", "#D4B9DA"]


def qpe_palette() -> dict:
    lut = base_lut()
    for code in range(1, 251):
        r = rate(code)
        i = max(k for k, e in enumerate(QPE_EDGES) if r >= e - 1e-9)
        lut[code] = (*hexrgb(QPE_COLORS[i]), 255)
    return {"label": "QPE bins", "lut": lut_hex(lut), "legend": {"kind": "binned", "units": "mm/h",
            "edges": QPE_EDGES, "colors": QPE_COLORS, "labels": [0.1, 2, 6, 15, 30, 50, 90, 130, 200]}}


# ---------------------------------------------------------------- precipitation type (MRMS PrecipFlag)
FLAG_CLASSES = [   # chosen by a search over CAM02-UCS: every pair at least 17 apart under full-severity
    ("Warm stratiform rain", (1, 2), "#7B93D0"),      # deutan, protan and tritan simulations; snow sits 12 from paper
    ("Cold stratiform rain", (10,), "#503B91"),
    ("Snow", (3, 4), "#DEECFB"),
    ("Convective rain", (6,), "#C9A60F"),
    ("Rain with hail", (7,), "#711829"),
    ("Tropical stratiform mix", (91,), "#7E8C63"),
    ("Tropical convective mix", (96,), "#226968"),
]


def flag_palette() -> dict:
    lut = base_lut()
    for code in range(1, 254):
        lut[code] = (*hexrgb("#9C8F80"), 255)    # unlisted codes: a neutral grey-brown
    for _, codes, color in FLAG_CLASSES:
        for c in codes:
            lut[c] = (*hexrgb(color), 255)
    lut[0] = CLEAR
    return {"lut": lut_hex(lut), "legend": {"kind": "categorical",
            "items": [{"label": label, "color": color} for label, _, color in FLAG_CLASSES]}}


# ---------------------------------------------------------------- CVD check
def worst_pairs(colors: dict[str, str], label: str) -> None:
    names = list(colors)
    rgb = np.array([hexrgb(colors[n]) for n in names]) / 255
    paper = np.array(hexrgb("#F3ECDE")) / 255
    for kind in ("normal", "deuteranomaly", "protanomaly", "tritanomaly"):
        if kind == "normal":
            sim = rgb
        else:
            sim = np.clip(cspace_convert(rgb, {"name": "sRGB1+CVD", "cvd_type": kind, "severity": 100}, "sRGB1"), 0, 1)
        lab = cspace_convert(sim, "sRGB1", "CAM02-UCS")
        pairs = sorted((float(np.linalg.norm(lab[i] - lab[j])), names[i], names[j])
                       for i, j in itertools.combinations(range(len(names)), 2))
        bg = cspace_convert(paper, "sRGB1", "CAM02-UCS")
        vs_paper = min((float(np.linalg.norm(lab[i] - bg)), names[i]) for i in range(len(names)))
        print(f"  {label:<14} {kind:<14} worst pair {pairs[0][0]:5.1f} ({pairs[0][1]} / {pairs[0][2]}); "
              f"closest to paper {vs_paper[0]:5.1f} ({vs_paper[1]})")


def main() -> None:
    out = {
        "schema": 1,
        "note": "Generated by design/map/colormaps.py; LUTs are 256 RGBA entries as hex, indexed by frame code.",
        "layers": {
            "echo_type": {"default": "eccopy", "palettes": {
                "eccopy": {"label": "EccoPy", **echo_palette(ECHO_EC)},
                "artglass": {"label": "Art glass", **echo_palette(ECHO_ART)}}},
            "convectivity": {"default": "eccopy", "palettes": {
                "eccopy": {"label": "EccoPy", **conv_palette(ecm.convectivity_cmap())},
                "artglass": {"label": "Art glass", **conv_palette(artglass_conv_cmap())}}},
            "composite": {"default": "chase", "palettes": {"chase": {"label": "ChaseSpectral", **composite_palette()}}},
            "precip_rate": {"default": "qpe", "palettes": {
                "qpe": qpe_palette(), "viridis": {"label": "Viridis", **rate_palette()}}},
            "precip_flag": {"default": "artglass", "palettes": {"artglass": {"label": "Art glass", **flag_palette()}}},
        },
        "no_coverage": css(NO_COVERAGE[:3]) + f"{NO_COVERAGE[3]:02x}",
        "missing": css(MISSING[:3]) + f"{MISSING[3]:02x}",
    }
    OUT.write_text(json.dumps(out, separators=(",", ":")) + "\n")
    print(f"wrote {OUT} ({OUT.stat().st_size / 1024:.1f} KB)")
    print("CVD check (CAM02-UCS distance, full-severity simulations):")
    worst_pairs({ECHO_NAMES[k]: css(v) for k, v in ECHO_EC.items()}, "echo eccopy")
    worst_pairs({ECHO_NAMES[k]: css(v) for k, v in ECHO_ART.items()}, "echo artglass")
    worst_pairs({label: color for label, _, color in FLAG_CLASSES}, "precip type")


if __name__ == "__main__":
    main()
