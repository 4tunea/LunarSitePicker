"""Compare our Site01 (Connecting Ridge) illumination with Barker et al. (2021), Table 2.

    .venv/Scripts/python.exe validation/compare_barker2021.py

Barker, M. K., et al. (2021), "Improved LOLA elevation maps for south pole landing sites: Error
estimates and their impact on illumination conditions", Planetary and Space Science 203, 105119.
Accepted manuscript read from NASA NTRS (https://ntrs.nasa.gov/citations/20205009660, full text
.../downloads/Mike%20Barker_%20Paper_%20Improved%20Lola.pdf.txt). Their metrics (Section 5, Fig. 14):
  average illumination = mean visible fraction of the Sun's disc, 2024-01-01 .. 2026-01-01, hourly;
  LCIP = longest uninterrupted period with any part of the Sun visible;
  LCSP = longest uninterrupted period with no part of the Sun visible;
at Δz = 1 m and 5 m above the surface, per region of interest (RoI), over 100 LDEM "clones"
(Table 2 rows: A = RoI average, 1st percentile of the clones; C = most illuminated pixel).

We compute the same three metrics with our horizon (5 m tile + LDEM 120 m, 3 rays per 0.5 deg bin)
and Skyfield ephemeris at Δz = 1 m and 5 m, over OUR range (2026-11-01 .. 2028-02-29), at the RoI 1
and RoI 2 centroids given in their Table 2 (south polar stereographic X, Y in km) and at our chosen
Connecting Ridge point. Differences are expected from the different years (lunar seasons and the
18.6-year precession), the different DEM version (PGDA release vs their new LDEM) and the single
point vs RoI average. Writes validation/barker2021_vs_ours.md.
"""
from __future__ import annotations

import datetime as dt
import json
import math
import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from precompute.build import COUNT, START_UTC, disc_fraction, skyline_at  # noqa: E402
from precompute.ephemeris import Sky, hourly_times  # noqa: E402
from precompute.horizon import PolarDem, horizon  # noqa: E402

R = 1_737_400.0
DATA = os.path.join(ROOT, "data")
# Table 2 of Barker et al. (2021), as read from the NTRS text (columns beyond RoI 2 are cut in that text).
BARKER = {
    "RoI 1": {"X_km": -11.5825, "Y_km": -12.4625, "area_m2": 8625,
              1.0: {"avg_ill_A": 68.03, "avg_ill_C": 85.84, "LCIP_A": 63.35, "LCIP_C": 205.38, "LCSP_A": 16.55, "LCSP_C": 10.46},
              5.0: {"avg_ill_A": 89.26, "avg_ill_C": 91.83, "LCIP_A": 215.79, "LCIP_C": 232.50, "LCSP_A": 5.29, "LCSP_C": 3.67}},
    "RoI 2": {"X_km": -11.4875, "Y_km": -12.5575, "area_m2": 7550,
              1.0: {"avg_ill_A": 70.32, "avg_ill_C": 85.75, "LCIP_A": 113.80, "LCIP_C": 205.08, "LCSP_A": 17.84, "LCSP_C": 10.71},
              5.0: {"avg_ill_A": 88.51, "avg_ill_C": 91.24, "LCIP_A": 216.28, "LCIP_C": 233.00, "LCSP_A": 7.31, "LCSP_C": 5.29}},
}


def xy_to_latlon(x_m, y_m):
    rho = math.hypot(x_m, y_m)
    return -90.0 + 2.0 * math.degrees(math.atan(rho / (2.0 * R))), math.degrees(math.atan2(x_m, y_m))


def longest_run(mask):
    best = run = 0
    for v in mask:
        run = run + 1 if v else 0
        best = max(best, run)
    return best


def metrics(layers, sky, t, lat, lon, dz):
    hz = horizon(layers, lat, lon, masts=(dz,))
    e = sky.altaz(lat, lon, hz["ground_m"] + dz, t)
    frac = disc_fraction(e["sun"]["alt_deg"] - skyline_at(hz["elev_deg"][dz], e["sun"]["az_deg"]), e["sun"]["diam_deg"] / 2)
    return {"ground_m": hz["ground_m"], "avg_ill": 100 * frac.mean(), "LCIP_d": longest_run(frac > 0) / 24.0, "LCSP_d": longest_run(frac <= 0) / 24.0}


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    tile = PolarDem.from_geotiff(os.path.join(DATA, "Site01_final_adj_5mpp_surf.tif"))
    ldem = PolarDem.from_pds(os.path.join(DATA, "LDEM_75S_120M.IMG"), os.path.join(DATA, "LDEM_75S_120M.LBL"))
    layers = [tile, ldem]
    sky = Sky(DATA)
    t = hourly_times(sky.ts, START_UTC, COUNT)
    D = json.load(open(os.path.join(ROOT, "web", "data", "navigator-data.json"), encoding="utf-8"))
    cr = D["sites"][0]
    points = [(k, *xy_to_latlon(v["X_km"] * 1000, v["Y_km"] * 1000)) for k, v in BARKER.items()]
    points.append(("our %s point" % cr["name"], cr["lat_deg"], cr["lon_deg"]))
    md = ["# Connecting Ridge (Site01) illumination: Barker et al. (2021) vs this pipeline", "",
          "Barker et al. (2021), Table 2 (NTRS accepted manuscript), Site 1 RoIs, 2024-01-01 to 2026-01-01, 100 LDEM clones;",
          "row A = RoI average (1st percentile over clones), row C = most illuminated pixel. Ours: single point, PGDA 5 m tile +",
          "LDEM 120 m, Skyfield, %s to 2028-02-29, hourly. Metrics as defined in their Section 5: average illumination =" % START_UTC[:10],
          "mean visible fraction of the Sun's disc; LCIP / LCSP = longest continuous illumination / shadow period in days.", "",
          "| Point | Δz | Barker avg ill A / C (%) | ours avg ill (%) | Barker LCIP A / C (d) | ours LCIP (d) | Barker LCSP A / C (d) | ours LCSP (d) |",
          "|---|---|---|---|---|---|---|---|"]
    print("%-28s %4s %9s %9s %9s %9s" % ("point", "dz", "ground", "avg ill", "LCIP d", "LCSP d"))
    for name, lat, lon in points:
        for dz in (1.0, 5.0):
            m = metrics(layers, sky, t, lat, lon, dz)
            b = BARKER.get(name, {}).get(dz)
            print("%-28s %3.0f m %8.1f m %8.1f%% %8.1f %8.1f   (lat %.5f lon %.5f)" % (name, dz, m["ground_m"], m["avg_ill"], m["LCIP_d"], m["LCSP_d"], lat, lon))
            md.append("| %s (%.5f, %.5f) | %.0f m | %s | %.1f | %s | %.1f | %s | %.1f |" % (
                name, lat, lon, dz,
                "%.2f / %.2f" % (b["avg_ill_A"], b["avg_ill_C"]) if b else "–", m["avg_ill"],
                "%.2f / %.2f" % (b["LCIP_A"], b["LCIP_C"]) if b else "–", m["LCIP_d"],
                "%.2f / %.2f" % (b["LCSP_A"], b["LCSP_C"]) if b else "–", m["LCSP_d"]))
    md += ["", "Quoted from the NTRS text of the paper: \"Site 1 is the connecting ridge between Shackleton crater and de Gerlache crater\";",
           "\"Between Jan. 1, 2024 and Jan. 1, 2026, Site 1 has the most area with average illumination >70% at 1 m above the surface\";",
           "\"At 5 m above the surface of Site 1, the RoIs merge and nearly the entire connecting ridge has an average illumination >70%\".",
           "Mazarico et al. (2011), Icarus 211, could not be opened (publisher paywall; the NTRS record 20120010094 has no file), so nothing is quoted from it.",
           "", "Generated %s." % dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%MZ")]
    open(os.path.join(ROOT, "validation", "barker2021_vs_ours.md"), "w", encoding="utf-8").write("\n".join(md) + "\n")
    print("wrote validation/barker2021_vs_ours.md")


if __name__ == "__main__":
    main()
