# Written with AI assistance (Claude Code), reviewed by the team.
"""How accurate is app.js's "rebuild Sun/Earth from sites[0]" shortcut?

    python validation/check_app_rebuild.py

app.js (data layer, lines 26-72) does not carry an ephemeris. For any point that is NOT one of the
analysed sites (picked spots, past landings, and the whole-Moon lighting / sub-solar and
sub-Earth marks) it rebuilds, from the FIRST site's stored angles:
  - a Moon-fixed unit vector to the Sun per sample:  dir(alt, az) in the first site's local frame;
  - a Moon-fixed Earth position per sample:  site0_position + dist * dir(alt, az),
    with dist = 6371 km / sin(diam_deg/2) from bodies.earth.diam_deg.
It then projects those into the other point's local frame to get its alt/az. The Sun is treated as
infinitely far (its direction is the same everywhere on the Moon); the Earth keeps its parallax.

This script repeats that maths in Python from our own rounded series (2 decimals for alt/az,
3 for the diameter, as in the data file) and compares with a direct Skyfield calculation at
points 1 km and 50 km from Connecting Ridge, over the whole data range. It also shows the same
comparison with unrounded angles, to separate the method error from the 0.01° file rounding.
"""
from __future__ import annotations

import math
import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from precompute.ephemeris import Sky, hourly_times  # noqa: E402
from precompute.horizon import PolarDem, local_frame  # noqa: E402

R_KM = 1737.4
SITE0 = (-89.4632, -137.4896)      # Connecting Ridge candidate (centre of PGDA Site01)
START, COUNT = "2026-11-01T00:00:00Z", 11664
MAST_M = 2.0


def destination(lat, lon, bearing_deg, dist_m):
    """Great-circle destination point, degrees."""
    la, lo, b, d = math.radians(lat), math.radians(lon), math.radians(bearing_deg), dist_m / (R_KM * 1000)
    la2 = math.asin(math.sin(la) * math.cos(d) + math.cos(la) * math.sin(d) * math.cos(b))
    lo2 = lo + math.atan2(math.sin(b) * math.sin(d) * math.cos(la), math.cos(d) - math.sin(la) * math.sin(la2))
    return math.degrees(la2), (math.degrees(lo2) + 540) % 360 - 180


def dir_vec(alt_deg, az_deg, up, east, north):
    ca = np.cos(np.radians(alt_deg))
    n, e, u = ca * np.cos(np.radians(az_deg)), ca * np.sin(np.radians(az_deg)), np.sin(np.radians(alt_deg))
    return n[:, None] * north + e[:, None] * east + u[:, None] * up


def app_rebuild(site0, ground0_m, s0, diam_earth, target, ground_t_m):
    """app.js series(): alt/az at target from site0's angles."""
    up0, east0, north0 = local_frame(*site0)
    r0 = R_KM + ground0_m / 1000.0
    SUN = dir_vec(s0["sun"]["alt"], s0["sun"]["az"], up0, east0, north0)
    dist = 6371.0 / np.sin(np.radians(diam_earth) / 2)
    EARTH = r0 * up0 + dist[:, None] * dir_vec(s0["earth"]["alt"], s0["earth"]["az"], up0, east0, north0)
    up, east, north = local_frame(*target)
    r = R_KM + ground_t_m / 1000.0
    out = {}
    v = SUN
    out["sun"] = (np.degrees(np.arcsin(np.clip(v @ up, -1, 1))), np.degrees(np.arctan2(v @ east, v @ north)) % 360)
    v = EARTH - r * up
    l = np.linalg.norm(v, axis=1)
    out["earth"] = (np.degrees(np.arcsin(np.clip((v @ up) / l, -1, 1))), np.degrees(np.arctan2(v @ east, v @ north)) % 360)
    return out


def stats(ours, theirs):
    da = theirs[0] - ours[0]
    dz = (((theirs[1] - ours[1]) + 180) % 360 - 180) * np.cos(np.radians(ours[0]))
    sep = np.degrees(np.arccos(np.clip(np.sin(np.radians(ours[0])) * np.sin(np.radians(theirs[0])) +
                                       np.cos(np.radians(ours[0])) * np.cos(np.radians(theirs[0])) * np.cos(np.radians(theirs[1] - ours[1])), -1, 1)))
    return da, dz, sep


def main():
    sky = Sky(os.path.join(ROOT, "data"))
    dem = PolarDem.from_pds(os.path.join(ROOT, "data", "LDEM_75S_120M.IMG"), os.path.join(ROOT, "data", "LDEM_75S_120M.LBL"))
    t = hourly_times(sky.ts, START, COUNT)
    g0 = dem.height(*SITE0)
    e0 = sky.altaz(SITE0[0], SITE0[1], g0 + MAST_M, t)
    print("site0 = Connecting Ridge %.4f, %.4f, ground %.1f m; %d hourly samples" % (SITE0[0], SITE0[1], g0, COUNT))
    print("%-34s %-6s %10s %10s %10s %10s" % ("case", "body", "max|dAlt|", "max|dAz|", "max sep", "rms sep"))
    for dist_km, bearing in ((1, 0), (1, 90), (50, 0), (50, 90)):
        tgt = destination(SITE0[0], SITE0[1], bearing, dist_km * 1000)
        gt = dem.height(*tgt)
        direct = sky.altaz(tgt[0], tgt[1], gt + MAST_M, t)
        for label, rnd in (("file rounding (0.01°, diam 0.001°)", True), ("unrounded angles", False)):
            q = (lambda x, n: np.round(x, n)) if rnd else (lambda x, n: x)
            s0 = {b: {"alt": q(e0[b]["alt_deg"], 2), "az": q(e0[b]["az_deg"], 2)} for b in ("sun", "earth")}
            rb = app_rebuild(SITE0, g0, s0, q(e0["earth"]["diam_deg"], 3), tgt, gt)
            for b in ("sun", "earth"):
                da, dz, sep = stats((direct[b]["alt_deg"], direct[b]["az_deg"]), rb[b])
                print("%2d km %-3s %-24s %-6s %9.4f° %9.4f° %9.4f° %9.4f°" % (
                    dist_km, "N" if bearing == 0 else "E", label, b, np.abs(da).max(), np.abs(dz).max(), sep.max(), math.sqrt(np.mean(sep ** 2))))


if __name__ == "__main__":
    main()
