"""The one writer of web/data/navigator-data.{json,js} (docs/data-contract.md).

    .venv/Scripts/python.exe -m precompute.build                       # all 5 sites
    .venv/Scripts/python.exe -m precompute.build --sites connecting-ridge
    .venv/Scripts/python.exe -m precompute.build --out web/data/test   # write test.json/.js instead

Per site: terrain horizon for masts 2 m and 10 m (precompute/horizon.py, LDEM_75S_120M, 250 km,
3 rays per 0.5 deg bin) and hourly apparent Sun/Earth alt/az (precompute/ephemeris.py, observer
at DEM ground + 2 m). Sun/Earth angular diameters are stored once, from the first site. Prints,
for each site, the Sun altitude range, the share of hours with the Sun up (>= 50 % of the disc
above the 2 m skyline), the share with Earth up (centre above the skyline), the longest dark
period, and finally the file sizes.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import subprocess
import sys
import time

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from precompute.ephemeris import FRAME, KERNELS, Sky, hourly_times  # noqa: E402
from precompute.horizon import PolarDem, horizon  # noqa: E402

START_UTC = "2026-11-01T00:00:00Z"
STEP_S = 3600
COUNT = 11664                       # to 2028-02-29T23:00Z
MASTS = (2.0, 10.0)
EPHEM_MAST_M = 2.0
MAX_RANGE_KM = 250.0
N_AZ, RAYS = 720, 3
DATA = os.path.join(ROOT, "data")
OUT_DIR = os.path.join(ROOT, "web", "data")
FAR_FIELD = {"file": "LDEM_75S_120M.IMG", "role": "far-field", "resolution_m": 120, "extent_km": 914.9}


def git_sha():
    try:
        return subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, text=True).strip()
    except Exception:
        return "unknown"


def r2(a):
    return [float(x) for x in np.round(np.asarray(a, float), 2)]


def r3(a):
    return [float(x) for x in np.round(np.asarray(a, float), 3)]


def skyline_at(elev, az_deg):
    """Linear interpolation between 0.5 deg bins with wrap, as app.js does."""
    x = (np.asarray(az_deg) % 360.0) / (360.0 / len(elev))
    i = np.floor(x).astype(int) % len(elev)
    f = x - np.floor(x)
    return elev[i] * (1 - f) + elev[(i + 1) % len(elev)] * f


def disc_fraction(clear_deg, r_deg):
    x = np.clip(clear_deg / r_deg, -1, 1)
    return 1 - (np.arccos(x) - x * np.sqrt(1 - x * x)) / np.pi


def stats(site, diam_sun):
    """Sun/Earth visibility over the whole range with the 2 m skyline (contract section 7 defaults)."""
    elev = np.array(site["horizons"][0]["elev_deg"])
    sun_alt, sun_az = np.array(site["sun"]["alt_deg"]), np.array(site["sun"]["az_deg"])
    earth_alt, earth_az = np.array(site["earth"]["alt_deg"]), np.array(site["earth"]["az_deg"])
    sun_up = disc_fraction(sun_alt - skyline_at(elev, sun_az), np.array(diam_sun) / 2) >= 0.5
    earth_up = (earth_alt - skyline_at(elev, earth_az)) > 0
    longest, run = 0, 0
    for up in sun_up:
        run = 0 if up else run + 1
        longest = max(longest, run)
    return {"sun_alt_min": sun_alt.min(), "sun_alt_max": sun_alt.max(), "sunlit": sun_up.mean(), "earth": earth_up.mean(),
            "both": (sun_up & earth_up).mean(), "longest_dark_h": longest}


def build_site(cfg, dem, sky, t, use_tiles=True):
    t0 = time.time()
    layers, dem_list = [dem], [dict(FAR_FIELD)]
    nf = cfg.get("near_field")
    if use_tiles and nf and os.path.exists(os.path.join(DATA, nf["file"])):
        tile = PolarDem.from_geotiff(os.path.join(DATA, nf["file"]))
        layers = [tile, dem]
        dem_list = [{"file": nf["file"], "role": "near-field", "resolution_m": tile.scale, "extent_km": nf["extent_km"]}] + dem_list
    elif nf:
        print("  %-18s WARNING: near-field tile %s missing, 120 m only" % (cfg["id"], nf["file"]))
    hz = horizon(layers, cfg["lat_deg"], cfg["lon_deg"], masts=MASTS, n_az=N_AZ, rays_per_bin=RAYS, max_range_m=MAX_RANGE_KM * 1000)
    ground = hz["ground_m"]
    e = sky.altaz(cfg["lat_deg"], cfg["lon_deg"], ground + EPHEM_MAST_M, t)
    site = {
        "id": cfg["id"], "name": cfg["name"], "pgda_site": cfg.get("pgda_site"), "terrain": "dem",
        "lat_deg": cfg["lat_deg"], "lon_deg": cfg["lon_deg"], "ground_elev_m": round(ground, 1),
        "coord_source": cfg["coord_source"],
        "dem": dem_list,
        "horizons": [{"mast_height_m": m, "max_range_km": MAX_RANGE_KM, "complete": bool(hz["complete"]), "elev_deg": r2(hz["elev_deg"][m])} for m in MASTS],
        "sun": {"alt_deg": r2(e["sun"]["alt_deg"]), "az_deg": r2(e["sun"]["az_deg"] % 360.0)},
        "earth": {"alt_deg": r2(e["earth"]["alt_deg"]), "az_deg": r2(e["earth"]["az_deg"] % 360.0)},
    }
    # 360.00 after rounding must wrap to 0
    for b in ("sun", "earth"):
        site[b]["az_deg"] = [0.0 if v >= 360.0 else v for v in site[b]["az_deg"]]
    diam = {"sun": r3(e["sun"]["diam_deg"]), "earth": r3(e["earth"]["diam_deg"])}
    print("  %-18s lat %9.5f lon %10.5f ground %7.1f m (%s)  horizon complete=%s  %.1f s" % (
        cfg["id"], cfg["lat_deg"], cfg["lon_deg"], ground, "5 m + 120 m" if len(layers) == 2 else "120 m only", hz["complete"], time.time() - t0))
    return site, diam


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--sites", nargs="*", help="site ids to build (default: all, in sites.json order)")
    p.add_argument("--out", default=os.path.join(OUT_DIR, "navigator-data"), help="output path without extension")
    p.add_argument("--no-tiles", action="store_true", help="ignore the 5 m tiles (120 m LDEM only), for comparisons")
    a = p.parse_args()
    cfgs = json.load(open(os.path.join(ROOT, "precompute", "sites.json")))
    if a.sites:
        cfgs = [c for c in cfgs if c["id"] in a.sites]
        missing = set(a.sites) - {c["id"] for c in cfgs}
        if missing:
            sys.exit("unknown site ids: %s" % ", ".join(sorted(missing)))
    print("loading DEM and kernels")
    dem = PolarDem.from_pds(os.path.join(DATA, "LDEM_75S_120M.IMG"), os.path.join(DATA, "LDEM_75S_120M.LBL"))
    sky = Sky(DATA)
    t = hourly_times(sky.ts, START_UTC, COUNT, STEP_S)
    sites, diam = [], None
    print("building %d site(s): %s .. %s, %d hourly samples" % (len(cfgs), START_UTC, (t[-1].utc_datetime()).strftime("%Y-%m-%dT%H:%M:%SZ"), COUNT))
    for cfg in cfgs:
        site, d = build_site(cfg, dem, sky, t, use_tiles=not a.no_tiles)
        sites.append(site)
        if diam is None:
            diam = d
    out = {
        "schema_version": "1.0",
        "fake": False,
        "generated_utc": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "generator": "precompute/build.py, git %s" % git_sha(),
        "constants": {"moon_radius_km": 1737.4},
        "ephemeris": {"software": "Skyfield 1.55", "kernels": KERNELS, "frame": FRAME,
                      "corrections": "apparent (light-time + aberration), no refraction"},
        "time": {"start_utc": START_UTC, "step_s": STEP_S, "count": COUNT},
        "horizon_grid": {"n_az": N_AZ, "step_deg": 360.0 / N_AZ, "bin0_center_deg": 0.0, "sampling": "max of %d rays per bin" % RAYS},
        "bodies": {"sun": {"diam_deg": diam["sun"]}, "earth": {"diam_deg": diam["earth"]}},
        "sites": sites,
    }
    print("\nstatistics over the whole range, 2 m mast, Sun up = 50 % of the disc above the skyline, Earth up = centre above it")
    print("  %-18s %-16s %7s %7s %7s  %s" % ("site", "Sun alt range", "sunlit", "Earth", "both", "longest dark"))
    for s in sites:
        st = stats(s, out["bodies"]["sun"]["diam_deg"])
        print("  %-18s %6.2f .. %5.2f  %6.1f%% %6.1f%% %6.1f%%  %d h = %.1f d" % (
            s["id"], st["sun_alt_min"], st["sun_alt_max"], 100 * st["sunlit"], 100 * st["earth"], 100 * st["both"], st["longest_dark_h"], st["longest_dark_h"] / 24))
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    text = json.dumps(out, separators=(",", ":"))
    with open(a.out + ".json", "w", encoding="utf-8") as f:
        f.write(text + "\n")
    with open(a.out + ".js", "w", encoding="utf-8") as f:
        f.write("/* Generated by precompute/build.py from Skyfield + LOLA. Do not edit by hand. See docs/data-contract.md. */\n")
        f.write("var NAV_DATA = " + text + ";\n")
    import gzip
    gz = len(gzip.compress(text.encode("utf-8")))
    print("\nwrote %s.json (%.2f MB) and .js (%.2f MB); gzip %.2f MB; %d sites" % (
        os.path.relpath(a.out, ROOT), os.path.getsize(a.out + ".json") / 1e6, os.path.getsize(a.out + ".js") / 1e6, gz / 1e6, len(sites)))


if __name__ == "__main__":
    main()
