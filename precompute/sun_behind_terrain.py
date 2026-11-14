"""Periods when the Sun is above the horizontal but hidden by terrain, with the blocking feature.

    .venv/Scripts/python.exe -m precompute.sun_behind_terrain --site connecting-ridge-lower --mast 2 [--out docs/x.md]

Hidden = the Sun's centre is above the local horizontal (alt > 0) but less than 50 % of the disc is
above the skyline (the app then counts the Sun as down). For each continuous run: UTC start/end,
duration, Sun azimuth range, skyline elevation toward the Sun, and the terrain that sets the
skyline at the run's middle azimuth (distance and height along that ray, from the 5 m tile +
LDEM 120 m). Written as a markdown table for the panorama / surface view.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from precompute.build import DATA, disc_fraction, skyline_at  # noqa: E402
from precompute.horizon import PolarDem, local_frame, ray_distances, sample_layers  # noqa: E402


def blocking_feature(layers, lat, lon, ground, mast, az_deg, max_range_m=250_000.0):
    """Distance (km) and height (m) of the terrain sample that sets the skyline along one ray."""
    R = layers[0].R
    up, east, north = local_frame(lat, lon)
    dist = ray_distances(min(l.scale for l in layers) / 2, max_range_m)
    c, s = np.cos(dist / R), np.sin(dist / R)
    az = math.radians(az_deg)
    t = math.cos(az) * north + math.sin(az) * east
    p = c[:, None] * up + s[:, None] * t
    h = sample_layers(layers, p[:, 0], p[:, 1], p[:, 2])
    h = np.where(np.isnan(h), -1e9, h)
    e = np.arctan2((R + h) * c - (R + ground + mast), (R + h) * s)
    i = int(np.argmax(e))
    return dist[i] / 1000.0, float(h[i]), math.degrees(e[i])


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    p = argparse.ArgumentParser()
    p.add_argument("--site", default="connecting-ridge-lower")
    p.add_argument("--mast", type=float, default=2.0)
    p.add_argument("--path", default=os.path.join(ROOT, "web", "data", "navigator-data.json"))
    p.add_argument("--out", default=None)
    a = p.parse_args()
    D = json.load(open(a.path, encoding="utf-8"))
    site = {s["id"]: s for s in D["sites"]}[a.site]
    t0 = dt.datetime.fromisoformat(D["time"]["start_utc"].replace("Z", "+00:00"))
    step = D["time"]["step_s"]
    masts = [h["mast_height_m"] for h in site["horizons"]]
    elev = np.array(site["horizons"][masts.index(a.mast)]["elev_deg"])
    alt, az = np.array(site["sun"]["alt_deg"]), np.array(site["sun"]["az_deg"])
    r = np.array(D["bodies"]["sun"]["diam_deg"]) / 2
    sky = skyline_at(elev, az)
    frac = disc_fraction(alt - sky, r)
    hidden = (alt > 0) & (frac < 0.5)
    layers = [PolarDem.from_geotiff(os.path.join(DATA, site["dem"][0]["file"])), PolarDem.from_pds(os.path.join(DATA, "LDEM_75S_120M.IMG"), os.path.join(DATA, "LDEM_75S_120M.LBL"))]
    when = lambda k: (t0 + dt.timedelta(seconds=k * step)).strftime("%Y-%m-%d %H:%M")
    runs, start = [], None
    for k, v in enumerate(hidden):
        if v and start is None:
            start = k
        if not v and start is not None:
            runs.append((start, k - 1))
            start = None
    if start is not None:
        runs.append((start, len(hidden) - 1))
    head = ("| Start (UTC) | End (UTC) | Hours | Sun azimuth | Sun altitude | Skyline toward the Sun | Blocking terrain at the middle azimuth |",
            "|---|---|---|---|---|---|---|")
    lines = []
    total = 0
    for s0, s1 in runs:
        mid = (s0 + s1) // 2
        dkm, hm, edeg = blocking_feature(layers, site["lat_deg"], site["lon_deg"], site["ground_elev_m"], a.mast, float(az[mid]))
        total += s1 - s0 + 1
        lines.append("| %s | %s | %d | %.1f° → %.1f° | %.2f° → %.2f° | %.2f° → %.2f° | az %.1f°: %.1f km away, %.0f m high (%.0f m above the site), skyline %.2f° |" % (
            when(s0), when(s1), s1 - s0 + 1, az[s0], az[s1], alt[s0], alt[s1], sky[s0], sky[s1], az[mid], dkm, hm, hm - site["ground_elev_m"], edeg))
    md = ["# %s: Sun above the horizontal but hidden by terrain" % site["name"], "",
          "Site %s (%.5f, %.5f, ground %.1f m), mast %g m, %s to %s. Hidden = Sun centre above the local horizontal and less than" % (
              site["id"], site["lat_deg"], site["lon_deg"], site["ground_elev_m"], a.mast, when(0)[:10], when(len(hidden) - 1)[:10]),
          "50 %% of the disc above the skyline (the app counts the Sun as down). %d runs, %d hours in total (%.1f %% of the %d hours" % (len(runs), total, 100 * total / int((alt > 0).sum()), int((alt > 0).sum())),
          "with the Sun centre above the horizontal). Skyline from the PGDA 5 m tile + LDEM 120 m, 3 rays per 0.5° bin, 250 km.", "", *head, *lines]
    text = "\n".join(md) + "\n"
    print(text)
    if a.out:
        open(a.out, "w", encoding="utf-8").write(text)
        print("wrote", a.out)


if __name__ == "__main__":
    main()
