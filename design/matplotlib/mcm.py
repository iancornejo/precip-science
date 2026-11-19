"""Art glass matplotlib style for figures on iancornejo.github.io and precip.science.

    import mcm
    mcm.use()          # paper-colored background, matches the sites
    mcm.use("paper")   # white background, for journals and slides

Registers the Geom static fonts that sit next to this file, then applies mcm.mplstyle.
Radar fields keep their own colormaps: cmweather's CVD-friendly maps for reflectivity and
dual-pol fields (D10), and EccoPy's colormaps for ECCO echo types and convectivity (D09).
"""
from pathlib import Path

import matplotlib as mpl
from matplotlib import font_manager

HERE = Path(__file__).resolve().parent

PALETTE = {
    "paper": "#F3ECDE", "paper_deep": "#EDE3D1", "paper_light": "#F7F2E8",
    "umber": "#2E241D", "umber_muted": "#66574A",
    "red": "#A3352A", "blue": "#2F4B9A", "ochre": "#C98A2E", "green": "#3F7F62",
}
CYCLE = ["#2F4B9A", "#AA7832", "#771B14", "#7585AE", "#5A325B", "#66574A"]


def register_fonts() -> None:
    """Make the bundled Geom TTFs available to matplotlib (idempotent)."""
    known = {f.fname for f in font_manager.fontManager.ttflist}
    for f in sorted((HERE / "fonts").glob("Geom-*.ttf")):
        if str(f) not in known:
            font_manager.fontManager.addfont(str(f))


def use(variant: str = "web") -> None:
    """Apply the style. variant: "web" (paper background) or "paper" (white background)."""
    if variant not in ("web", "paper"):
        raise ValueError("variant must be 'web' or 'paper'")
    register_fonts()
    mpl.style.use(HERE / "mcm.mplstyle")
    if variant == "paper":
        mpl.rcParams.update({"figure.facecolor": "white", "axes.facecolor": "white",
                             "savefig.facecolor": "white", "patch.edgecolor": "white"})
