# Written with AI assistance (Claude Code), reviewed by the team.
"""Cross-check precompute/ephemeris.py against the surface view's ephemeris (web/moonsky/ephem/<year>.js).

    python validation/compare_moonsky.py [--n 10] [--seed 42]

Both use Skyfield + DE421 + MOON_ME_DE421, but through different code: the surface view stores
daily apparent Sun/Earth vectors from the Moon's centre (int16 unit vectors, uint16 distances),
interpolates with 4-point Lagrange in the browser and shifts to the observer (parallax). This
script re-implements that browser maths in Python (same as the teammate's validate() in
web/tools/build_moonsky_data.py) and compares with our direct topocentric alt/az at random
times and south-polar points. Writes validation/moonsky_vs_skyfield.{csv,md}.
"""
from __future__ import annotations

import argparse
import base64
import csv
import datetime as dt
import json
import math
import os
import struct
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from precompute.ephemeris import Sky  # noqa: E402
from precompute.horizon import PolarDem, local_frame  # noqa: E402

MOONSKY = os.path.join(ROOT, "web", "moonsky")
REC = struct.Struct("<10h2H")


def _payload(path):
    txt = open(path, encoding="utf-8").read()
    return txt[txt.index(",") + 1: txt.rindex(")")]


def load_meta():
    return json.loads(_payload(os.path.join(MOONSKY, "meta.js")))["ephem"]


def load_year(y):
    raw = base64.b64decode(json.loads(_payload(os.path.join(MOONSKY, "ephem", "%d.js" % y))))
    return np.array(list(REC.iter_unpack(raw)), float)


def moonsky_altaz(meta, recs_by_year, t: dt.datetime, lat, lon, h0_m):
    """Browser maths of moon-sky.js sky(): Lagrange-interpolated centre vectors minus the observer."""
    y = t.year
    x = (t - dt.datetime(y, 1, 1, tzinfo=dt.timezone.utc)).total_seconds() / 86400.0 + meta["pad"]
    i = int(math.floor(x))
    f = x - i
    w = [-f * (f - 1) * (f - 2) / 6, (f + 1) * (f - 1) * (f - 2) / 2, -(f + 1) * f * (f - 2) / 2, (f + 1) * f * (f - 1) / 6]
    rec = recs_by_year[y]
    r = sum(w[k] * rec[i - 1 + k] for k in range(4))
    up, east, north = local_frame(lat, lon)
    obs = up * (1737400.0 + h0_m) / 1000.0
    out = {}
    for body, sl, d in (("sun", slice(0, 3), meta["sun_d0"] + r[10] * meta["sun_ds"]),
                        ("earth", slice(3, 6), meta["earth_d0"] + r[11] * meta["earth_ds"])):
        v = r[sl] / np.linalg.norm(r[sl]) * d - obs
        v /= np.linalg.norm(v)
        out[body] = (math.degrees(math.asin(max(-1.0, min(1.0, float(v @ up))))), math.degrees(math.atan2(v @ east, v @ north)) % 360.0)
    return out


def sep_arcsec(alt1, az1, alt2, az2):
    a1, z1, a2, z2 = map(math.radians, (alt1, az1, alt2, az2))
    c = math.sin(a1) * math.sin(a2) + math.cos(a1) * math.cos(a2) * math.cos(z1 - z2)
    return math.degrees(math.acos(max(-1.0, min(1.0, c)))) * 3600.0


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    p = argparse.ArgumentParser()
    p.add_argument("--n", type=int, default=10)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--start", default="2026-11-01T00:00:00Z")
    p.add_argument("--end", default="2028-03-01T00:00:00Z")
    a = p.parse_args()
    rng = np.random.default_rng(a.seed)
    meta = load_meta()
    sky = Sky(os.path.join(ROOT, "data"))
    dem = PolarDem.from_pds(os.path.join(ROOT, "data", "LDEM_75S_120M.IMG"), os.path.join(ROOT, "data", "LDEM_75S_120M.LBL"))
    t0 = dt.datetime.fromisoformat(a.start.replace("Z", "+00:00"))
    t1 = dt.datetime.fromisoformat(a.end.replace("Z", "+00:00"))
    recs = {}
    rows = []
    for _ in range(a.n):
        t = t0 + dt.timedelta(seconds=float(rng.uniform(0, (t1 - t0).total_seconds())))
        t = t.replace(microsecond=0)
        lat, lon = float(rng.uniform(-90, -80)), float(rng.uniform(-180, 180))
        h0 = dem.height(lat, lon)
        if t.year not in recs:
            recs[t.year] = load_year(t.year)
        theirs = moonsky_altaz(meta, recs, t, lat, lon, h0)
        ours = sky.altaz(lat, lon, h0, sky.ts.from_datetimes([t]))
        for body in ("sun", "earth"):
            oa, oz = float(ours[body]["alt_deg"][0]), float(ours[body]["az_deg"][0])
            ta, tz = theirs[body]
            daz = ((tz - oz + 180) % 360) - 180
            rows.append({"utc": t.strftime("%Y-%m-%dT%H:%M:%SZ"), "lat_deg": round(lat, 4), "lon_deg": round(lon, 4), "ground_m": round(h0, 1),
                         "body": body, "skyfield_alt_deg": round(oa, 5), "skyfield_az_deg": round(oz, 5),
                         "moonsky_alt_deg": round(ta, 5), "moonsky_az_deg": round(tz, 5),
                         "d_alt_arcsec": round((ta - oa) * 3600, 2), "d_az_arcsec": round(daz * 3600 * math.cos(math.radians(oa)), 2),
                         "sep_arcsec": round(sep_arcsec(oa, oz, ta, tz), 2)})
    out_csv = os.path.join(ROOT, "validation", "moonsky_vs_skyfield.csv")
    with open(out_csv, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    seps = np.array([r["sep_arcsec"] for r in rows])
    md = [
        "# Surface-view ephemeris vs precompute/ephemeris.py",
        "",
        "Both are Skyfield + DE421 in MOON_ME_DE421. The surface view (`web/moonsky/`) stores daily apparent",
        "Sun/Earth vectors from the Moon's centre as int16 unit vectors (1/32767 ≈ 6\") and shifts them to the",
        "observer in the browser; `precompute/ephemeris.py` computes topocentric apparent alt/az directly.",
        "Random times in %s – %s and random points south of 80° S, seed %d." % (a.start[:10], a.end[:10], a.seed),
        "",
        "Angular separation: median %.1f\", max %.1f\" over %d body-samples. Generated %s." % (
            np.median(seps), seps.max(), len(rows), dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%MZ")),
        "",
        "| UTC | lat | lon | body | Skyfield alt | Skyfield az | moonsky alt | moonsky az | Δalt \" | Δaz·cos \" | sep \" |",
        "|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for r in rows:
        md.append("| %s | %.4f | %.4f | %s | %.4f | %.4f | %.4f | %.4f | %.1f | %.1f | %.1f |" % (
            r["utc"], r["lat_deg"], r["lon_deg"], r["body"], r["skyfield_alt_deg"], r["skyfield_az_deg"],
            r["moonsky_alt_deg"], r["moonsky_az_deg"], r["d_alt_arcsec"], r["d_az_arcsec"], r["sep_arcsec"]))
    open(os.path.join(ROOT, "validation", "moonsky_vs_skyfield.md"), "w", encoding="utf-8").write("\n".join(md) + "\n")
    print("\n".join(md))


if __name__ == "__main__":
    main()
