# Written with AI assistance (Claude Code), reviewed by the team.
"""Landing windows from the real data file, with the app's rules (docs/data-contract.md section 7).

    .venv/Scripts/python.exe -m precompute.analyze_windows [web/data/navigator-data.json] [--site connecting-ridge]
                                                           [--stay-days 14] [--shift-days 21] [--mast 2]

Two availability rules for a landing at hour k:
  app rule    : Sun >= 50 % of disc above the skyline AND Earth centre above the skyline at k,
                AND both true for >= 50 % of the stay [k, k + stay)
  simple rule : Sun >= 50 % of disc above the skyline AND Earth centre above the skyline at k
A "window" is a maximal run of consecutive hours k on which the rule holds. The shift check lists
the days d on which the site is available at d but not at d + shift, and which other sites are
available at d + shift (the "launch slipped" demo).
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
from precompute.build import disc_fraction, skyline_at  # noqa: E402


def visibility(D, site, mast, sun_frac=0.5, earth_clear=0.0):
    masts = [h["mast_height_m"] for h in site["horizons"]]
    elev = np.array(site["horizons"][masts.index(mast)]["elev_deg"])
    sun_alt, sun_az = np.array(site["sun"]["alt_deg"]), np.array(site["sun"]["az_deg"])
    earth_alt, earth_az = np.array(site["earth"]["alt_deg"]), np.array(site["earth"]["az_deg"])
    sun_up = disc_fraction(sun_alt - skyline_at(elev, sun_az), np.array(D["bodies"]["sun"]["diam_deg"]) / 2) >= sun_frac
    earth_up = (earth_alt - skyline_at(elev, earth_az)) > earth_clear
    return sun_up, earth_up


def app_rule(sun_up, earth_up, m, share=0.5):
    both = (sun_up & earth_up).astype(int)
    pre = np.concatenate([[0], np.cumsum(both)])
    n = len(both)
    ok = np.zeros(n, bool)
    for k in range(n):
        end = min(n - 1, k + m)
        total = max(1, end - k)
        ok[k] = sun_up[k] and earth_up[k] and (pre[k + total] - pre[k]) / total >= share
    return ok


def runs(mask):
    out, start = [], None
    for i, v in enumerate(mask):
        if v and start is None:
            start = i
        if not v and start is not None:
            out.append((start, i - 1))
            start = None
    if start is not None:
        out.append((start, len(mask) - 1))
    return out


def main():
    p = argparse.ArgumentParser()
    p.add_argument("path", nargs="?", default=os.path.join(ROOT, "web", "data", "navigator-data.json"))
    p.add_argument("--site", default=None, help="site id (default: the first site)")
    p.add_argument("--stay-days", type=int, default=14)
    p.add_argument("--shift-days", type=int, default=21)
    p.add_argument("--mast", type=float, default=2.0)
    a = p.parse_args()
    D = json.load(open(a.path, encoding="utf-8"))
    t0 = dt.datetime.fromisoformat(D["time"]["start_utc"].replace("Z", "+00:00"))
    step = D["time"]["step_s"]
    spd = 86400 // step
    when = lambda k: (t0 + dt.timedelta(seconds=k * step)).strftime("%Y-%m-%d %H:%M")
    day = lambda k: (t0 + dt.timedelta(seconds=k * step)).strftime("%Y-%m-%d")
    sites = {s["id"]: s for s in D["sites"]}
    sid = a.site or D["sites"][0]["id"]
    m = a.stay_days * spd
    vis = {s: visibility(D, sites[s], a.mast) for s in sites}
    ok_app = {s: app_rule(vis[s][0], vis[s][1], m) for s in sites}
    ok_simple = {s: vis[s][0] & vis[s][1] for s in sites}
    print("data %s .. %s, %d h; site %s; stay %d d; mast %g m; fake=%s" % (when(0), when(D["time"]["count"] - 1), D["time"]["count"], sid, a.stay_days, a.mast, D["fake"]))
    for label, ok in (("APP RULE (both at landing + both for >= 50 % of the stay)", ok_app), ("SIMPLE RULE (both at landing)", ok_simple)):
        r = runs(ok[sid])
        lens = np.array([b - x + 1 for x, b in r]) / spd if r else np.array([])
        print("\n%s: %s available %.1f %% of landing hours" % (label, sid, 100 * ok[sid].mean()))
        if len(r):
            print("  %d windows; length median %.1f d, min %.1f d, max %.1f d" % (len(r), np.median(lens), lens.min(), lens.max()))
            for x, b in r:
                print("    %s -> %s  (%.1f d)" % (when(x), when(b), (b - x + 1) / spd))
        else:
            print("  no windows")
        # availability of every site, for the overview
        print("  all sites: " + ", ".join("%s %.0f%%" % (s, 100 * ok[s].mean()) for s in sites))
        # 21-day shift: days d where site ok at d 00:00 and not ok at d + shift
        shift = a.shift_days * spd
        ndays = (D["time"]["count"] - shift) // spd
        flips = []
        for d in range(ndays):
            k, k2 = d * spd, d * spd + shift
            if ok[sid][k] and not ok[sid][k2]:
                others = [s for s in sites if s != sid and ok[s][k2]]
                flips.append((d, others))
        print("  %d landing days where %s works but not %d days later" % (len(flips), sid, a.shift_days))
        if flips:
            with_alt = [f for f in flips if f[1]]
            print("  %d of them have another site available on the later date" % len(with_alt))
            # group consecutive days
            groups, g = [], [flips[0]]
            for f in flips[1:]:
                if f[0] == g[-1][0] + 1:
                    g.append(f)
                else:
                    groups.append(g)
                    g = [f]
            groups.append(g)
            for g in groups[:12]:
                alts = sorted({s for f in g for s in f[1]})
                print("    %s .. %s (%d d): +%d d falls on %s .. %s; alternatives then: %s" % (
                    day(g[0][0] * spd), day(g[-1][0] * spd), len(g), a.shift_days, day(g[0][0] * spd + shift), day(g[-1][0] * spd + shift), ", ".join(alts) or "none"))
            if len(groups) > 12:
                print("    ... %d more groups" % (len(groups) - 12))


if __name__ == "__main__":
    main()
