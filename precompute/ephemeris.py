"""Apparent Sun and Earth positions from a point on the lunar surface (Skyfield, the reference).

    from precompute.ephemeris import Sky, hourly_times
    sky = Sky("data")                                     # loads the four kernels
    t = hourly_times(sky.ts, "2026-11-01T00:00:00Z", 11664)
    e = sky.altaz(-89.4632, -137.4896, 1945.0 + 2.0, t)   # elevation = DEM height + mast, metres
    e["sun"]["alt_deg"], e["sun"]["az_deg"], e["sun"]["diam_deg"], ...

Conventions (docs/data-contract.md section 2): azimuth clockwise from local north, altitude
above the local horizontal of the 1737.4 km sphere, longitude east-positive, frame
MOON_ME_DE421, apparent positions (light-time + aberration, no refraction), UTC.

Kernel set and frame are the same as the surface view's web/tools/build_moonsky_data.py, so the
two can be cross-checked (validation/compare_moonsky.py). The observer is built with Skyfield's
PlanetaryConstants.build_latlon_degrees(), which places it on the pck00008 Moon sphere
(1737.4 km) plus the given elevation; "up" is the radius vector, as the contract requires.
"""
from __future__ import annotations

import datetime as dt
import os

import numpy as np
from skyfield.api import Loader, PlanetaryConstants

KERNELS = ["de421.bsp", "moon_080317.tf", "pck00008.tpc", "moon_pa_de421_1900-2050.bpc"]
FRAME = "MOON_ME_DE421"
SUN_RADIUS_KM = 695_700.0      # IAU nominal
EARTH_RADIUS_KM = 6_371.0      # IAU mean, matches app.js
CHUNK = 2048                   # samples per Skyfield call (memory)


def parse_utc(iso: str) -> dt.datetime:
    """'2026-11-01T00:00:00Z' -> aware datetime."""
    return dt.datetime.fromisoformat(iso.replace("Z", "+00:00"))


def hourly_times(ts, start_utc: str, count: int, step_s: int = 3600):
    """Skyfield Time array for samples start + k*step, k = 0..count-1."""
    t0 = parse_utc(start_utc)
    secs = np.arange(count) * step_s
    return ts.from_datetimes([t0 + dt.timedelta(seconds=float(s)) for s in secs])


class Sky:
    def __init__(self, data_dir: str = "data"):
        for k in KERNELS:
            if not os.path.exists(os.path.join(data_dir, k)):
                raise FileNotFoundError("missing kernel %s in %s; run scripts/download_data.py" % (k, data_dir))
        load = Loader(data_dir, verbose=False)
        self.ts = load.timescale()
        self.eph = load("de421.bsp")
        self.pc = PlanetaryConstants()
        self.pc.read_text(load("moon_080317.tf"))
        self.pc.read_text(load("pck00008.tpc"))
        self.pc.read_binary(load("moon_pa_de421_1900-2050.bpc"))
        self.frame = self.pc.build_frame_named(FRAME)
        self.moon = self.eph["moon"]

    def observer(self, lat_deg: float, lon_deg: float, elevation_m: float):
        """Vector-function for a surface point; lon east-positive, elevation above the 1737.4 km sphere."""
        return self.moon + self.pc.build_latlon_degrees(self.frame, lat_deg, lon_deg, elevation_m=elevation_m)

    def altaz(self, lat_deg: float, lon_deg: float, elevation_m: float, t, bodies=("sun", "earth")) -> dict:
        """Apparent alt/az (deg), distance (km) and angular diameter (deg) of each body at times t."""
        site = self.observer(lat_deg, lon_deg, elevation_m)
        n = len(t)
        out = {b: {"alt_deg": np.empty(n), "az_deg": np.empty(n), "dist_km": np.empty(n)} for b in bodies}
        for i0 in range(0, n, CHUNK):
            tt = t[i0:i0 + CHUNK]
            at = site.at(tt)
            for b in bodies:
                alt, az, d = at.observe(self.eph[b]).apparent().altaz()
                o = out[b]
                o["alt_deg"][i0:i0 + len(tt)] = alt.degrees
                o["az_deg"][i0:i0 + len(tt)] = az.degrees % 360.0
                o["dist_km"][i0:i0 + len(tt)] = d.km
        for b in bodies:
            r = SUN_RADIUS_KM if b == "sun" else EARTH_RADIUS_KM
            out[b]["diam_deg"] = np.degrees(2.0 * np.arcsin(r / out[b]["dist_km"]))
        return out


if __name__ == "__main__":
    import sys
    import time

    lat, lon, h = (float(x) for x in (sys.argv[1:4] if len(sys.argv) >= 4 else ("-89.4632", "-137.4896", "1947")))
    sky = Sky()
    t = hourly_times(sky.ts, "2026-11-01T00:00:00Z", 11664)
    t0 = time.time()
    e = sky.altaz(lat, lon, h, t)
    print("site %.4f, %.4f, %.0f m: %d hourly samples in %.1f s" % (lat, lon, h, len(t), time.time() - t0))
    for b in ("sun", "earth"):
        print("  %-5s alt %7.3f .. %6.3f deg, diam %.3f .. %.3f deg, dist %.4g .. %.4g km" % (
            b, e[b]["alt_deg"].min(), e[b]["alt_deg"].max(), e[b]["diam_deg"].min(), e[b]["diam_deg"].max(),
            e[b]["dist_km"].min(), e[b]["dist_km"].max()))
