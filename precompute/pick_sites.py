"""Site rule (team decision 2026-11-14): each analysed site is the highest point of its PGDA 5 m tile.

    .venv/Scripts/python.exe -m precompute.pick_sites           # report only
    .venv/Scripts/python.exe -m precompute.pick_sites --write   # also update precompute/sites.json

For every entry of sites.json with a near_field tile in data/, finds the highest valid 5 m pixel,
converts it to lat/lon (east-positive, MOON_ME), reports how far it is from the tile edge (a summit
on the edge means the real summit may lie outside the tile), compares the 5 m height with the
120 m LDEM at the same point (vertical datum check), and writes the result back with
coord_source.ref = "highest point of PGDA 5 m tile <label>, chosen by team". Ids and names are kept.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from precompute.horizon import PolarDem, ground_distance_m  # noqa: E402

DATA = os.path.join(ROOT, "data")
SITES = os.path.join(ROOT, "precompute", "sites.json")
EDGE_M = 100.0          # a summit closer than this to the tile edge is reported as "at the tile edge"


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
        lat, lon, h5, line, samp, edge_px = tile.argmax_latlon()
        edge_m = edge_px * tile.scale
        h120 = ldem.height(lat, lon)
        moved = ground_distance_m(cfg["lat_deg"], cfg["lon_deg"], lat, lon)
        at_edge = edge_m < EDGE_M
        label = cfg["pgda_site"]
        note = "AT THE TILE EDGE: the summit may continue outside the tile" if at_edge else ""
        print("%-18s %-8s %10.5f %11.5f %9.1f %9.1f %7.0f m %8.1f km  %s" % (cfg["id"], label, lat, lon, h5, h120, edge_m, moved / 1000, note))
        if a.write:
            cfg["lat_deg"], cfg["lon_deg"] = round(lat, 5), round(lon, 5)
            cfg["coord_source"] = {
                "kind": "dem-metadata",
                "ref": "highest point of PGDA 5 m tile %s, chosen by team" % label,
                "note": ("%s pixel line %d, sample %d, height %.1f m (LDEM 120 m there: %.1f m), %.0f m from the nearest tile edge%s. "
                         "Not a published landing coordinate; the tile is %s." % (
                             nf["file"], line, samp, h5, h120, edge_m, "; summit at the tile edge" if at_edge else "",
                             "%.1f x %.1f km" % (nf["extent_km"], nf["extent_km"]))),
            }
    if a.write:
        json.dump(cfgs, open(SITES, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
        open(SITES, "a", encoding="utf-8").write("\n")
        print("wrote", os.path.relpath(SITES, ROOT))


if __name__ == "__main__":
    main()
