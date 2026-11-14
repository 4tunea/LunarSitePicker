"""The "launch slipped" table: which landing days at the hero site stop working after a slip, and why.

    .venv/Scripts/python.exe -m precompute.slip_table [--mast 2] [--shift-days 21] [--site connecting-ridge]

Simple rule (docs/data-contract.md section 7 defaults, no stay share): a landing at hour k works
when >= 50 % of the Sun's disc is above the skyline AND Earth's centre is above the skyline.
Landings are taken at 00:00 UTC of each day, as the app does. For every day d with
work(d) and not work(d + shift): the reason on the slipped date (Sun behind terrain / below the
horizon, Earth behind terrain / set), the other analysed sites that work on the slipped date, and
the next day after the slipped date on which the hero site works again. Consecutive days are
grouped. Ends with the three best demo candidates: a slip whose reason is terrain, with at least
one alternative site, in the middle of stable runs.
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
from precompute.analyze_windows import visibility  # noqa: E402
from precompute.horizon import sphere_dip_deg  # noqa: E402


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    p = argparse.ArgumentParser()
    p.add_argument("path", nargs="?", default=os.path.join(ROOT, "web", "data", "navigator-data.json"))
    p.add_argument("--site", default=None)
    p.add_argument("--shift-days", type=int, default=21)
    p.add_argument("--mast", type=float, default=2.0)
    p.add_argument("--top", type=int, default=3)
    a = p.parse_args()
    D = json.load(open(a.path, encoding="utf-8"))
    t0 = dt.datetime.fromisoformat(D["time"]["start_utc"].replace("Z", "+00:00"))
    step = D["time"]["step_s"]
    spd = 86400 // step
    n = D["time"]["count"]
    day = lambda k: (t0 + dt.timedelta(seconds=k * step)).strftime("%Y-%m-%d")
    sites = {s["id"]: s for s in D["sites"]}
    sid = a.site or D["sites"][0]["id"]
    hero = sites[sid]
    vis = {s: visibility(D, sites[s], a.mast) for s in sites}
    ok = {s: vis[s][0] & vis[s][1] for s in sites}
    sun_up, earth_up = vis[sid]
    sun_alt = np.array(hero["sun"]["alt_deg"])
    earth_alt = np.array(hero["earth"]["alt_deg"])
    r_sun = np.array(D["bodies"]["sun"]["diam_deg"]) / 2
    dip = sphere_dip_deg(a.mast)
    shift = a.shift_days * spd

    def reason(k):
        out = []
        if not sun_up[k]:
            out.append("Sun behind terrain" if sun_alt[k] + r_sun[k] > dip else "Sun below the horizon")
        if not earth_up[k]:
            out.append("Earth behind terrain" if earth_alt[k] > dip else "Earth set")
        return " + ".join(out)

    def next_window(k2):
        later = np.nonzero(ok[sid][k2 + 1:])[0]
        if not len(later):
            return None
        k = k2 + 1 + int(later[0])
        end = k
        while end + 1 < n and ok[sid][end + 1]:
            end += 1
        return k, end

    def stable_days(k, want, direction):
        """How many consecutive days before (-1) or after (+1) k keep ok == want (at 00:00)."""
        c = 0
        kk = k + direction * spd
        while 0 <= kk < n and ok[sid][kk] == want:
            c += 1
            kk += direction * spd
        return c

    ndays = (n - shift) // spd
    flips = []
    for d in range(ndays):
        k, k2 = d * spd, d * spd + shift
        if ok[sid][k] and not ok[sid][k2]:
            flips.append({"d": d, "k": k, "k2": k2, "reason": reason(k2), "alts": [s for s in sites if s != sid and ok[s][k2]],
                          "next": next_window(k2),
                          "stable": min(stable_days(k, True, -1), stable_days(k, True, +1), stable_days(k2, False, -1), stable_days(k2, False, +1))})
    print("hero %s, mast %g m, shift %d d, simple rule; data %s .. %s" % (sid, a.mast, a.shift_days, day(0), day(n - 1)))
    print("availability (share of landing hours): " + ", ".join("%s %.0f%%" % (s, 100 * ok[s].mean()) for s in sites))
    print("%d landing days flip to unavailable after the slip, %d of them with an alternative site\n" % (len(flips), sum(1 for f in flips if f["alts"])))
    groups, g = [], []
    for f in flips:
        if g and f["d"] != g[-1]["d"] + 1:
            groups.append(g)
            g = []
        g.append(f)
    if g:
        groups.append(g)
    print("%-23s  %-23s  %-38s  %-32s  %s" % ("planned landing", "slipped landing", "reason on the slipped date", "sites that work instead", "next window at the hero site"))
    for g in groups:
        reasons = sorted({f["reason"] for f in g})
        alts = sorted({s for f in g for s in f["alts"]})
        nexts = [f["next"] for f in g if f["next"]]
        if nexts:
            nd = sorted((f["next"][0] - f["k2"]) / spd for f in g if f["next"])
            nxt = "+%.0f..%.0f d (%s..%s, %.1f d long)" % (nd[0], nd[-1], day(nexts[0][0]), day(nexts[-1][0]), (nexts[0][1] - nexts[0][0] + 1) / spd)
        else:
            nxt = "none in the data"
        print("%s .. %s  %s .. %s  %-38s  %-32s  %s" % (day(g[0]["k"]), day(g[-1]["k"]), day(g[0]["k2"]), day(g[-1]["k2"]),
                                                      "; ".join(reasons), ", ".join(alts) or "none", nxt))
    # demo candidates
    def score(f):
        return (3 if "terrain" in f["reason"] else 0) + (2 if f["alts"] else -10) + min(f["stable"], 3) + (1 if len(f["alts"]) > 1 else 0)
    best = []
    for g in groups:
        cands = [f for f in g if f["alts"]]
        if cands:
            best.append(max(cands, key=score))
    best.sort(key=score, reverse=True)
    print("\nbest demo candidates (planned date -> slipped date), mast %g m:" % a.mast)
    for f in best[:a.top]:
        nxt = f["next"]
        print("  %s -> %s : %s; alternatives %s; next hero window %s (+%d d after the slipped date); stable for %d d around both dates; score %d" % (
            day(f["k"]), day(f["k2"]), f["reason"], ", ".join(f["alts"]), day(nxt[0]) if nxt else "none", (nxt[0] - f["k2"]) / spd if nxt else -1, f["stable"], score(f)))
    if not best:
        print("  none: no slip with an alternative site")


if __name__ == "__main__":
    main()
