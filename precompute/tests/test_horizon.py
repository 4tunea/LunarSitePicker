# Written with AI assistance (Claude Code), reviewed by the team.
"""Checks for precompute/horizon.py. Run:  .venv/Scripts/python.exe -m pytest -s precompute/tests

(a) flat sphere gives the analytic dip -acos(R/(R+h)) for both masts;
(b) a synthetic ring wall of known height and distance gives the analytic angle;
(c) a wall only on the east side shows up at azimuth 90 and not at 270 (azimuth convention);
(d) real DEM: the Shackleton crater floor is about -2787 m (orientation of the LOLA grid);
(e) real DEM: the Malapert massif summit appears at the right bearing with at least its
    geometric elevation (east/west sign and bearing convention on real data).
Tests (d) and (e) are skipped when data/LDEM_75S_120M.IMG is missing.
"""
import math
import os

import numpy as np
import pytest

from precompute.horizon import PolarDem, bearing_deg, ground_distance_m, horizon, sphere_dip_deg

R = 1_737_400.0
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
IMG = os.path.join(ROOT, "data", "LDEM_75S_120M.IMG")
LBL = os.path.join(ROOT, "data", "LDEM_75S_120M.LBL")
SITE = (-88.0, 40.0)                      # synthetic test site: 60 km from the pole


def site_xy(lat, lon):
    rho = 2 * R * math.tan(math.radians(90 + lat) / 2)
    return rho * math.sin(math.radians(lon)), rho * math.cos(math.radians(lon))


def report(name, got, want, tol):
    ok = abs(got - want) <= tol
    print("%s %s: got %.4f, expected %.4f (tolerance %g)" % ("ok  " if ok else "FAIL", name, got, want, tol))
    assert ok, name


def test_flat_sphere_gives_analytic_dip():
    flat = PolarDem.synthetic(3600, 120.0, lambda x, y: np.zeros_like(x))
    h = horizon([flat], *SITE, masts=(2.0, 10.0), max_range_m=150_000)
    assert h["ground_m"] == 0.0 and h["complete"]
    for m in (2.0, 10.0):
        e = h["elev_deg"][m]
        report("flat sphere, %g m mast, north" % m, e[0], sphere_dip_deg(m), 0.003)
        report("flat sphere, %g m mast, south-west" % m, e[450], sphere_dip_deg(m), 0.003)
        report("flat sphere, %g m mast, spread" % m, e.max() - e.min(), 0.0, 0.001)


def wall_angle(dist_m, height_m, mast_m):
    th = dist_m / R
    return math.degrees(math.atan2((R + height_m) * math.cos(th) - (R + mast_m), (R + height_m) * math.sin(th)))


def test_ring_wall_has_analytic_angle():
    sx, sy = site_xy(*SITE)
    wall = PolarDem.synthetic(3600, 120.0, lambda x, y: np.where(np.hypot(x - sx, y - sy) > 20_000, 1500.0, 0.0))
    h = horizon([wall], *SITE, masts=(2.0,), max_range_m=150_000)
    want = wall_angle(20_000, 1500, 2.0)
    e = h["elev_deg"][2.0]
    report("ring wall 1500 m at 20 km, north", e[0], want, 0.05)
    report("ring wall 1500 m at 20 km, azimuth 200", e[400], want, 0.05)
    report("ring wall, spread over all bins", e.max() - e.min(), 0.0, 0.05)


def test_east_wall_appears_at_azimuth_90():
    sx, sy = site_xy(*SITE)
    lo = math.radians(SITE[1])
    ex, ey = math.cos(lo), -math.sin(lo)          # local east direction in map coordinates
    wall = PolarDem.synthetic(3600, 120.0, lambda x, y: np.where((x - sx) * ex + (y - sy) * ey > 20_000, 1500.0, 0.0))
    h = horizon([wall], *SITE, masts=(2.0,), max_range_m=150_000)
    e = h["elev_deg"][2.0]
    want = wall_angle(20_000, 1500, 2.0)
    report("east wall seen at azimuth 90", e[180], want, 0.05)
    report("east wall not seen at azimuth 270", e[540], sphere_dip_deg(2.0), 0.003)
    report("east wall not seen at azimuth 0", e[0], sphere_dip_deg(2.0), 0.003)
    # A straight wall 20 km east rises above the horizontal (e > 0) as long as the slant distance
    # 20 km / cos(az - 90) stays below d0, where curvature hides a 1500 m wall: (R+H) cos(d0/R) = R+2.
    # So the visible span is [90 - acos(20 km / d0), 90 + acos(20 km / d0)], centred on east.
    d0 = R * math.acos((R + 2.0) / (R + 1500.0))
    half = math.degrees(math.acos(20_000 / d0))
    seen = np.nonzero(e > 0.0)[0] * 0.5
    report("east wall: centre of the visible span", float(seen.mean()), 90.0, 0.6)
    report("east wall: first visible azimuth", float(seen.min()), 90.0 - half, 1.5)
    report("east wall: last visible azimuth", float(seen.max()), 90.0 + half, 1.5)


def test_near_field_step_in_5m_layer_over_120m_grid():
    """Two layers: a 5 m tile (12 km, like PGDA) with a 20 m plateau starting 500 m east of the site, over a
    flat 120 m grid that has a 1500 m wall 30 km to the west (outside the tile). The step must appear at
    azimuth 90 with the analytic angle for both masts, the far wall must still be seen at 270 through the
    120 m layer, and without the 5 m layer the step must not exist."""
    sx, sy = site_xy(*SITE)
    lo = math.radians(SITE[1])
    ex, ey = math.cos(lo), -math.sin(lo)                        # local east in map coordinates
    far = PolarDem.synthetic(3600, 120.0, lambda x, y: np.where(-((x - sx) * ex + (y - sy) * ey) > 30_000, 1500.0, 0.0))
    tile = PolarDem.synthetic_window(sx - 6_000, sy + 6_000, 2400, 5.0,
                                     lambda x, y: np.where((x - sx) * ex + (y - sy) * ey > 500, 20.0, 0.0))
    report("5 m tile covers the site (height 0 there)", tile.height(*SITE), 0.0, 1e-6)
    h = horizon([tile, far], *SITE, masts=(2.0, 10.0), max_range_m=150_000)
    assert h["complete"]
    for m in (2.0, 10.0):
        e = h["elev_deg"][m]
        report("near step 20 m at 500 m, %g m mast, azimuth 90" % m, e[180], wall_angle(500, 20, m), 0.04)
        report("far wall through the 120 m layer, %g m mast, azimuth 270" % m, e[540], wall_angle(30_000, 1500, m), 0.05)
        report("nothing north, %g m mast" % m, e[0], sphere_dip_deg(m), 0.003)
    e_only_far = horizon([far], *SITE, masts=(2.0,), max_range_m=150_000)["elev_deg"][2.0]
    report("without the 5 m layer the step is absent (azimuth 90)", e_only_far[180], sphere_dip_deg(2.0), 0.003)


@pytest.mark.skipif(not os.path.exists(IMG), reason="LDEM_75S_120M.IMG not downloaded")
def test_shackleton_floor_depth():
    dem = PolarDem.from_pds(IMG, LBL)
    report("Shackleton floor height at 89.67 S, 129.78 E", dem.height(-89.67, 129.78), -2787.0, 50.0)
    # and the rim is high all round: the skyline from the floor is above 10 deg in every direction
    h = horizon([dem], -89.67, 129.78, masts=(2.0,), max_range_m=60_000)
    e = h["elev_deg"][2.0]
    print("ok   Shackleton floor skyline: min %.1f, max %.1f deg" % (e.min(), e.max()))
    assert e.min() > 10.0


@pytest.mark.skipif(not os.path.exists(IMG), reason="LDEM_75S_120M.IMG not downloaded")
def test_malapert_summit_at_right_bearing():
    dem = PolarDem.from_pds(IMG, LBL)
    summit = (-85.99, 2.073)                      # highest LDEM point within 40 km of 86 S, 2 W
    hs = dem.height(*summit)
    assert hs > 5000.0
    obs = (-87.5, 2.0)                            # 46 km south of the summit, on the pole side
    g = dem.height(*obs)
    d = ground_distance_m(*obs, *summit)
    brg = bearing_deg(*obs, *summit)
    th = d / R
    geometric = math.degrees(math.atan2((R + hs) * math.cos(th) - (R + g + 2), (R + hs) * math.sin(th)))
    e = horizon([dem], *obs, masts=(2.0,), max_range_m=150_000)["elev_deg"][2.0]
    at_bearing = e[int(round(brg / 0.5)) % 720]
    az_max = int(np.argmax(e)) * 0.5
    print("ok   Malapert summit %.0f m at %.1f km, bearing %.1f: geometric %.2f, skyline there %.2f, skyline max %.2f at az %.1f"
          % (hs, d / 1000, brg, geometric, at_bearing, e.max(), az_max))
    assert at_bearing >= geometric - 0.05
    assert at_bearing <= geometric + 3.0
    assert abs(((az_max - brg) + 180) % 360 - 180) <= 20.0
