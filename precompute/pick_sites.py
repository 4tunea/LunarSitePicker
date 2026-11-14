# Written with AI assistance (Claude Code), reviewed by the team.
"""Site rules (team decisions 2026-11-14): where exactly each analysed site is.

    .venv/Scripts/python.exe -m precompute.pick_sites           # report only
    .venv/Scripts/python.exe -m precompute.pick_sites --write   # also update precompute/sites.json

Each entry of sites.json carries a "pick" rule:
  "summit"    (default) the highest valid pixel of the PGDA 5 m tile;
  "rim-crest" the highest 5 m pixel within an annulus around a crater centre
              ({"kind": "rim-crest", "crater_centre": [lat, lon], "radius_km": [r_in, r_out]});
  "fixed"     keep the coordinates as written (e.g. a comparison point).
The script converts the pixel to lat/lon (east-positive, MOON_ME), reports the distance to the tile
edge (a summit on the edge means the real summit may lie outside the tile), compares the 5 m height
with the 120 m LDEM at the same point (vertical datum check), and writes coordinates and
coord_source back. Ids and names are kept.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from precompute.horizon import PolarDem, ground_distance_m, unit  # noqa: E402

DATA = os.path.join(ROOT, "data")
SITES = os.path.join(ROOT, "precompute", "sites.json")
EDGE_M = 100.0          # a summit closer than this to the tile edge is reported as "at the tile edge"


def pixel_latlon(tile, line, samp):
    x = (samp - tile.pole_sample) * tile.scale
    y = (tile.pole_line - line) * tile.scale
    rho = math.hypot(x, y)
    return -90.0 + 2.0 * math.degrees(math.atan(rho / (2.0 * tile.R))), math.degrees(math.atan2(x, y))


def rim_crest_argmax(tile, crater_centre, radius_km):
    """Highest valid pixel whose ground distance to the crater centre lies in [r_in, r_out] km."""
    s = np.arange(tile.ns)
    l = np.arange(tile.nl)
    S, L = np.meshgrid(s, l)
    x = (S - tile.pole_sample) * tile.scale
    y = (tile.pole_line - L) * tile.scale
    rho = np.hypot(x, y)
    lat = -90.0 + 2.0 * np.degrees(np.arctan(rho / (2.0 * tile.R)))
    lon = np.degrees(np.arctan2(x, y))
    u = np.stack([np.cos(np.radians(lat)) * np.cos(np.radians(lon)), np.cos(np.radians(lat)) * np.sin(np.radians(lon)), np.sin(np.radians(lat))])
    c = unit(*crater_centre)
    d = tile.R * np.arccos(np.clip(u[0] * c[0] + u[1] * c[1] + u[2] * c[2], -1, 1))
    mask = (d >= radius_km[0] * 1000) & (d <= radius_km[1] * 1000) & ~np.isnan(tile.data)
    if not mask.any():
        raise ValueError("no tile pixel inside the %s km annulus" % (radius_km,))
    i = int(np.nanargmax(np.where(mask, tile.data, -np.inf)))
    li, si = divmod(i, tile.ns)
    la, lo = pixel_latlon(tile, li, si)
    edge = min(li, si, tile.nl - 1 - li, tile.ns - 1 - si)
    return la, lo, float(tile.data[li, si]) * tile.dn_scale, li, si, edge, float(d.flat[i])


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--write", action="store_true")
    a = p.parse_args()
    cfgs = json.load(open(SITES, encoding="utf-8"))
    ldem = PolarDem.from_pds(os.path.join(DATA, "LDEM_75S_120M.IMG"), os.path.join(DATA, "LDEM_75S_120M.LBL"))
    print("%-18s %-8s %10s %11s %9s %9s %8s %9s  %s" % ("site", "tile", "lat", "lon", "5 m h", "LDEM h", "to edge", "from old", "note"))
    for cfg in cfgs:
        nf = cfg.get("near_field")
        path = os.path.join(DATA, nf["file"]) if nf else None
        if not path or not os.path.exists(path):
            print("%-18s tile missing (%s), unchanged" % (cfg["id"], nf and nf["file"]))
            continue
        tile = PolarDem.from_geotiff(path)
        pick = cfg.get("pick", "summit")
        kind = pick if isinstance(pick, str) else pick["kind"]
        label = cfg["pgda_site"]
        extra = ""
        if kind == "fixed":
            lat, lon = cfg["lat_deg"], cfg["lon_deg"]
            h5 = tile.height(lat, lon)
            line = samp = -1
            edge_m = float("nan")
            ref = cfg["coord_source"]["ref"]
        elif kind == "rim-crest":
            lat, lon, h5, line, samp, edge_px, dist_c = rim_crest_argmax(tile, pick["crater_centre"], pick["radius_km"])
            edge_m = edge_px * tile.scale
            ref = "highest point on the rim crest within PGDA tile %s, chosen by team" % label
            extra = "; %.1f km from the crater centre %s, annulus %s km" % (dist_c / 1000, tuple(pick["crater_centre"]), tuple(pick["radius_km"]))
        else:
            lat, lon, h5, line, samp, edge_px = tile.argmax_latlon()
            edge_m = edge_px * tile.scale
            ref = "highest point of PGDA 5 m tile %s, chosen by team" % label
        h120 = ldem.height(lat, lon)
        moved = ground_distance_m(cfg["lat_deg"], cfg["lon_deg"], lat, lon)
        at_edge = edge_m < EDGE_M
        note = "AT THE TILE EDGE: the summit may continue outside the tile" if at_edge else ""
        print("%-26s %-8s %10.5f %11.5f %9.1f %9.1f %7.0f m %8.1f km  %-9s %s" % (cfg["id"], label, lat, lon, h5, h120, edge_m, moved / 1000, kind, note))
        if a.write:
            cfg["lat_deg"], cfg["lon_deg"] = round(lat, 5), round(lon, 5)
            if kind == "fixed":
                continue
            cfg["coord_source"] = {
                "kind": "dem-metadata",
                "ref": ref,
                "note": ("%s pixel line %d, sample %d, height %.1f m (LDEM 120 m there: %.1f m), %.0f m from the nearest tile edge%s%s. "
                         "Not a published landing coordinate; the tile is %s." % (
                             nf["file"], line, samp, h5, h120, edge_m, "; summit at the tile edge" if at_edge else "", extra,
                             "%.1f x %.1f km" % (nf["extent_km"], nf["extent_km"]))),
            }
    if a.write:
        json.dump(cfgs, open(SITES, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
        open(SITES, "a", encoding="utf-8").write("\n")
        print("wrote", os.path.relpath(SITES, ROOT))


if __name__ == "__main__":
    main()
