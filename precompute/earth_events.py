# Written with AI assistance (Claude Code), reviewed by the team.
"""Exact Earthrise / Earthset (and sunrise / sunset) times at a site around given dates.

    .venv/Scripts/python.exe -m precompute.earth_events --site connecting-ridge --mast 2 --dates 2027-08-19 2027-09-09

Uses the data file's skyline (interpolated between bins, as the app does) and the hourly flags of
docs/data-contract.md section 7 (Earth up = centre above the skyline; Sun up = >= 50 % of the disc
above it) to find the hour of each transition before and after 00:00 UTC of the date, then refines
the crossing to the minute with Skyfield. The app itself resolves events to the hour.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from precompute.analyze_windows import visibility  # noqa: E402
from precompute.build import disc_fraction, skyline_at  # noqa: E402
from precompute.ephemeris import Sky  # noqa: E402


def refine(sky, site, elev, body, mast, t_hour, up_before, ground):
    """Minute within [t_hour, t_hour + 1 h) where the body's flag flips."""
    mins = [t_hour + dt.timedelta(minutes=m) for m in range(0, 61)]
    e = sky.altaz(site["lat_deg"], site["lon_deg"], ground + 2.0, sky.ts.from_datetimes(mins), bodies=(body,))[body]
    clear = e["alt_deg"] - skyline_at(elev, e["az_deg"])
    up = disc_fraction(clear, e["diam_deg"] / 2) >= 0.5 if body == "sun" else clear > 0
    for i in range(1, len(mins)):
        if up[i] != up_before:
            return mins[i], float(e["az_deg"][i]), float(e["alt_deg"][i])
    return mins[-1], float(e["az_deg"][-1]), float(e["alt_deg"][-1])


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--site", default=None)
    p.add_argument("--mast", type=float, default=2.0)
    p.add_argument("--dates", nargs="+", required=True)
    p.add_argument("--path", default=os.path.join(ROOT, "web", "data", "navigator-data.json"))
    a = p.parse_args()
    D = json.load(open(a.path, encoding="utf-8"))
    sites = {s["id"]: s for s in D["sites"]}
    site = sites[a.site] if a.site else D["sites"][0]
    t0 = dt.datetime.fromisoformat(D["time"]["start_utc"].replace("Z", "+00:00"))
    step = D["time"]["step_s"]
    masts = [h["mast_height_m"] for h in site["horizons"]]
    elev = np.array(site["horizons"][masts.index(a.mast)]["elev_deg"])
    sun_up, earth_up = visibility(D, site, a.mast)
    sky = Sky(os.path.join(ROOT, "data"))
    when = lambda k: t0 + dt.timedelta(seconds=k * step)
    print("site %s (%.5f, %.5f), mast %g m" % (site["id"], site["lat_deg"], site["lon_deg"], a.mast))
    for d in a.dates:
        kd = int((dt.datetime.fromisoformat(d + "T00:00:00+00:00") - t0).total_seconds() // step)
        print("\n%s 00:00 UTC (k=%d): Sun %s, Earth %s" % (d, kd, "up" if sun_up[kd] else "down", "up" if earth_up[kd] else "down"))
        for body, flags in (("earth", earth_up), ("sun", sun_up)):
            # last transition before kd and first after
            before = [k for k in range(kd, 0, -1) if flags[k] != flags[k - 1]]
            after = [k for k in range(kd + 1, len(flags)) if flags[k] != flags[k - 1]]
            for label, k in (("previous", before[0] if before else None), ("next", after[0] if after else None)):
                if k is None:
                    print("  %-5s %s transition: none in the data" % (body, label))
                    continue
                kind = ("rise" if flags[k] else "set")
                t_min, az, alt = refine(sky, site, elev, body, a.mast, when(k - 1), bool(flags[k - 1]), site["ground_elev_m"])
                print("  %-5s %s %-4s between %s and %s UTC (hourly flags); Skyfield minute: %s UTC, az %.1f, alt %.2f, skyline there %.2f" % (
                    body, label, kind, when(k - 1).strftime("%Y-%m-%d %H:%M"), when(k).strftime("%H:%M"), t_min.strftime("%Y-%m-%d %H:%M"),
                    az, alt, float(skyline_at(elev, np.array([az]))[0])))


if __name__ == "__main__":
    main()
