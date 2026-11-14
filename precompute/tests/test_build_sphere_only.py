"""build.py must never crash on a point outside the DEM: it writes a sphere-only record (contract section 9).

Run:  .venv/Scripts/python.exe -m pytest -s precompute/tests/test_build_sphere_only.py

Uses a small synthetic flat DEM around the pole (no LOLA files needed) and three hourly samples. Needs the
Skyfield kernels in data/ (skipped when data/de421.bsp is missing).
"""
import os

import numpy as np
import pytest

from precompute import build
from precompute.ephemeris import Sky, hourly_times
from precompute.horizon import PolarDem, sphere_dip_deg

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA = os.path.join(ROOT, "data")
SRC = {"kind": "paper", "ref": "test fixture", "note": ""}

pytestmark = pytest.mark.skipif(not os.path.exists(os.path.join(DATA, "de421.bsp")), reason="Skyfield kernels not downloaded")


@pytest.fixture(scope="module")
def sky_t():
    sky = Sky(DATA)
    return sky, hourly_times(sky.ts, "2027-08-19T00:00:00Z", 3, 3600)


def test_point_outside_every_dem_layer_gets_a_sphere_only_record(sky_t):
    sky, t = sky_t
    flat = PolarDem.synthetic(600, 120.0, lambda x, y: np.zeros_like(x))        # 72 km square around the pole
    cfg = {"id": "apollo-11", "name": "Apollo 11", "lat_deg": 0.67, "lon_deg": 23.47, "coord_source": SRC}
    assert not build.on_dem([flat], cfg["lat_deg"], cfg["lon_deg"])
    site, diam = build.build_site(cfg, flat, sky, t)
    assert site["terrain"] == "sphere-only" and site["dem"] == [] and site["ground_elev_m"] == 0.0
    assert site["id"] == "apollo-11" and site["coord_source"] == SRC
    assert [h["mast_height_m"] for h in site["horizons"]] == list(build.MASTS)
    for h in site["horizons"]:
        want = round(float(sphere_dip_deg(h["mast_height_m"])), 2)
        assert len(h["elev_deg"]) == build.N_AZ and all(v == want for v in h["elev_deg"]) and want < 0
    assert len(site["sun"]["alt_deg"]) == 3 and len(site["earth"]["az_deg"]) == 3 and len(diam["sun"]) == 3
    assert all(0.0 <= v < 360.0 for v in site["sun"]["az_deg"] + site["earth"]["az_deg"])
    print("ok   sphere-only record for %s: dips %s" % (cfg["id"], [h["elev_deg"][0] for h in site["horizons"]]))


def test_point_on_the_dem_still_takes_the_terrain_path(sky_t):
    sky, t = sky_t
    flat = PolarDem.synthetic(600, 120.0, lambda x, y: np.zeros_like(x))
    cfg = {"id": "pole-test", "name": "Pole test", "lat_deg": -89.95, "lon_deg": 0.0, "coord_source": SRC}
    assert build.on_dem([flat], cfg["lat_deg"], cfg["lon_deg"])
    site, _ = build.build_site(cfg, flat, sky, t)
    assert site["terrain"] == "dem" and site["dem"][0]["file"] == "LDEM_75S_120M.IMG"
    assert site["horizons"][0]["complete"] is False                               # the 72 km grid ends before 250 km
    assert abs(site["horizons"][0]["elev_deg"][0] - round(float(sphere_dip_deg(2.0)), 2)) <= 0.01   # flat: the dip
    print("ok   terrain path on the synthetic grid: complete=%s, elev[0]=%s" % (site["horizons"][0]["complete"], site["horizons"][0]["elev_deg"][0]))
