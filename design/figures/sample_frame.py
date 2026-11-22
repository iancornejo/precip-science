"""Sample frames for precip.science: EccoPy 2D on one archived MRMS composite.

Makes the home-page figure and the two EcConus panels from the MRMS composite that
ships with EccoPy's notebooks (15 Dec 2021, 22:38 UTC, the serial derecho):

    python design/figures/sample_frame.py path/to/EccoPy/notebooks/data/mrms_composite_20211215.nc

Needs eccopy, netCDF4 and matplotlib, plus Natural Earth 50m lines as GeoJSON
(ne_50m_admin_1_states_provinces_lines, ne_50m_admin_0_boundary_lines_land,
ne_50m_coastline from github.com/nvkelso/natural-earth-vector) in --lines.
Colors are EccoPy's defaults (D09); type and paper colors come from design/matplotlib.
The EccoPy version and parameters are written into each PNG's metadata.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import netCDF4 as nc
import numpy as np
from matplotlib.patches import Patch

import eccopy
from eccopy import eccopy2d_h
from eccopy.core.colormaps import (
    basic_echo_type_cmap, basic_echo_type_norm, convectivity_cmap, convectivity_norm,
)
from eccopy.core.coords import latlon_to_xy_spacing
from eccopy.params import WindowSpec

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "design" / "matplotlib"))
import mcm  # noqa: E402

INSET = mcm.PALETTE["paper_light"]
LINE = mcm.PALETTE["umber"]
WINDOW_KM = 7


def load(path: Path):
    ds = nc.Dataset(path)
    fill = lambda name: np.ma.filled(ds.variables[name][:].astype(float), np.nan)
    lat, lon = fill("latitude"), fill("longitude")
    dbz = fill("MergedReflectivityQCComposite")
    valid = getattr(ds, "valid_time", "")
    return lat, lon, dbz, valid


def lines(folder: Path):
    """All line work as a list of (lon, lat) arrays."""
    out = []
    for name in ("ne_50m_admin_1_states_provinces_lines", "ne_50m_admin_0_boundary_lines_land",
                 "ne_50m_coastline"):
        f = folder / f"{name}.geojson"
        if not f.exists():
            continue
        for feat in json.loads(f.read_text())["features"]:
            g = feat["geometry"]
            parts = [g["coordinates"]] if g["type"] == "LineString" else g["coordinates"]
            out += [np.asarray(p) for p in parts]
    return out


def map_axes(fig, rect, lat, lon, linework, ticks: bool):
    ax = fig.add_axes(rect)
    ax.set_facecolor(INSET)
    ax.set_xlim(lon.min(), lon.max())
    ax.set_ylim(lat.min(), lat.max())
    ax.set_aspect(1 / np.cos(np.deg2rad(lat.mean())))
    for seg in linework:
        ax.plot(seg[:, 0], seg[:, 1], color=LINE, lw=0.55, alpha=0.6, solid_capstyle="round")
    if ticks:
        xt = np.arange(np.ceil(lon.min() / 2) * 2, lon.max() + 0.01, 2)
        yt = np.arange(np.ceil(lat.min()), lat.max() + 0.01, 2)
        ax.set_xticks(xt, [f"{abs(x):.0f}°W" for x in xt])
        ax.set_yticks(yt, [f"{y:.0f}°N" for y in yt])
        for side in ("top", "right"):
            ax.spines[side].set_visible(True)
    else:
        ax.set_axis_off()
    return ax


def save(fig, path: Path, meta: dict):
    fig.savefig(path, facecolor=INSET, metadata={"Software": meta["software"], "Description": meta["description"]})
    plt.close(fig)
    print(f"wrote {path.relative_to(REPO)}")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("composite", type=Path)
    p.add_argument("--lines", type=Path, default=Path("."), help="folder with the Natural Earth GeoJSON files")
    p.add_argument("--out", type=Path, default=REPO / "src" / "assets" / "figures")
    a = p.parse_args()

    mcm.use()
    lat, lon, dbz, valid = load(a.composite)
    LAT, LON = np.meshgrid(lat, lon, indexing="ij")
    dy, dx = latlon_to_xy_spacing(LAT, LON)
    res = eccopy2d_h.run(dbz, coords_y=dy, coords_x=dx, coord_mode="spacing",
                         window=WindowSpec((WINDOW_KM, "km")), kernel_mode="uniform")
    et = res.echo_type
    frac = {k: float(np.mean(et[np.isfinite(et)] == v)) for k, v in (("stratiform", 1), ("mixed", 2), ("convective", 3))}
    print(f"clumps {res.n_clumps}; " + ", ".join(f"{k} {v:.1%}" for k, v in frac.items()))

    meta = {
        "software": f"EccoPy {eccopy.__version__} (eccopy2d_h, package defaults, {WINDOW_KM} km window, uniform kernel)",
        "description": f"NOAA MRMS MergedReflectivityQCComposite {valid}, 39-45N 100-91W, from EccoPy's sample data",
    }
    linework = lines(a.lines)
    a.out.mkdir(parents=True, exist_ok=True)

    # Home-page figure: echo type, no axes or legend (the page draws the legend).
    w = 7.2
    h = w * (np.ptp(lat) / (np.ptp(lon) * np.cos(np.deg2rad(lat.mean()))))
    fig = plt.figure(figsize=(w, h))
    ax = map_axes(fig, [0, 0, 1, 1], lat, lon, linework, ticks=False)
    ax.pcolormesh(lon, lat, et, cmap=basic_echo_type_cmap(), norm=basic_echo_type_norm(), shading="nearest", rasterized=True)
    fig.savefig(a.out / "sample-echo-type.png", facecolor=INSET, bbox_inches="tight", pad_inches=0,
                metadata={"Software": meta["software"], "Description": meta["description"]})
    plt.close(fig)
    print("wrote src/assets/figures/sample-echo-type.png")

    # EcConus panels: convectivity and echo type, each with its key below the map.
    for name in ("convectivity", "echo-type"):
        fig = plt.figure(figsize=(5.6, 4.6))
        ax = map_axes(fig, [0.1, 0.24, 0.86, 0.72], lat, lon, linework, ticks=True)
        if name == "convectivity":
            m = ax.pcolormesh(lon, lat, res.convectivity, cmap=convectivity_cmap(), norm=convectivity_norm(),
                              shading="nearest", rasterized=True)
            cax = fig.add_axes([0.22, 0.1, 0.62, 0.035])
            cb = fig.colorbar(m, cax=cax, orientation="horizontal", ticks=[0, 0.4, 0.5, 1])
            cb.outline.set_linewidth(0.6)
            cb.set_label("Convectivity (0 stratiform, 1 convective)", labelpad=4)
        else:
            ax.pcolormesh(lon, lat, et, cmap=basic_echo_type_cmap(), norm=basic_echo_type_norm(),
                          shading="nearest", rasterized=True)
            cmap = basic_echo_type_cmap()
            handles = [Patch(facecolor=cmap(i), label=lab) for i, lab in enumerate(("Stratiform", "Mixed", "Convective"))]
            fig.legend(handles=handles, loc="lower center", ncol=3, bbox_to_anchor=(0.53, 0.06),
                       handlelength=1.1, handleheight=1.1, columnspacing=1.6, fontsize=10)
        save(fig, a.out / f"ecconus-{name}.png", meta)


if __name__ == "__main__":
    main()
