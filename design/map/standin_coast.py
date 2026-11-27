"""Add coastlines to the stand-in basemap.

The stand-in's land and lake polygons were clipped to 140-48 W, 14-62 N, so outlining them in
the map style would also draw the straight edges of that box across Canada, Greenland and
Central America. This writes their outlines as lines instead, minus every segment that lies on
the box, as features with l = "coast" (ocean coasts and lake shores alike). standin-v2.json is
standin-v1.json (in git history) after this script; any coast features already in the input are
replaced, so it can also be rerun on its own output. Standard library only, from the repo root:

    python3 design/map/standin_coast.py standin-v1.json public/map/basemap/standin-v2.json
"""
import json
import sys

WEST, SOUTH, EAST, NORTH = -140.0, 14.0, -48.0, 62.0
EPS = 1e-6


def on_box(p, q):
    """True if the segment p-q runs along one side of the clipping box."""
    return any(abs(p[i] - v) < EPS and abs(q[i] - v) < EPS
               for i, v in ((0, WEST), (0, EAST), (1, SOUTH), (1, NORTH)))


def pieces(ring):
    """The ring's runs of segments that are not on the box (the whole ring if none are)."""
    pts = ring[:-1] if ring[0] == ring[-1] else ring
    n = len(pts)
    edge = [on_box(pts[i], pts[(i + 1) % n]) for i in range(n)]
    if not any(edge):
        return [pts + [pts[0]]]
    start = edge.index(True)            # walk from just after a box segment, so no run is split
    out, cur = [], []
    for k in range(1, n + 1):
        i = (start + k) % n
        if edge[i]:
            if len(cur) >= 2:
                out.append(cur)
            cur = []
        else:
            if not cur:
                cur = [pts[i]]
            cur.append(pts[(i + 1) % n])
    return out


def rings(geom):
    polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
    for poly in polys:
        yield from poly


def main(src, dst):
    gj = json.load(open(src))
    feats = [f for f in gj["features"] if f["properties"]["l"] != "coast"]
    coast, dropped = [], 0
    for f in feats:
        if f["properties"]["l"] not in ("land", "lake"):
            continue
        lines = []
        for r in rings(f["geometry"]):
            p = pieces(r)
            dropped += not p
            lines.extend(p)
        if lines:
            coast.append({"type": "Feature", "properties": {"l": "coast"},
                          "geometry": {"type": "MultiLineString", "coordinates": lines}})
    # check: nothing left on the box
    left = sum(on_box(a, b) for c in coast for line in c["geometry"]["coordinates"] for a, b in zip(line, line[1:]))
    assert left == 0, left
    gj["features"] = feats + coast
    with open(dst, "w") as fh:
        json.dump(gj, fh, separators=(",", ":"))
    n = sum(len(c["geometry"]["coordinates"]) for c in coast)
    print(f"{len(coast)} coast features, {n} lines; {dropped} rings lay wholly on the box")


if __name__ == "__main__":
    main(*sys.argv[1:3])
