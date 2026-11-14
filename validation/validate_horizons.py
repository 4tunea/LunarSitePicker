"""Compare precompute/ephemeris.py (Skyfield) with JPL Horizons for an observer on the Moon.

    .venv/Scripts/python.exe validation/validate_horizons.py            # site = first site of web/data/navigator-data.json
    .venv/Scripts/python.exe validation/validate_horizons.py --lat -89.4632 --lon -137.4896 --alt-m 1944.7

Horizons API (https://ssd-api.jpl.nasa.gov/doc/horizons.html): observer table (EPHEM_TYPE=OBSERVER)
with CENTER='coord@301' and COORD_TYPE='GEODETIC'. SITE_COORD is 'E-lon(deg),Lat(deg),Alt(km)'
(east-positive longitude, altitude in km above the body's reference radius); the response header
echoes it as "Center geodetic : ... {E-lon(deg),Lat(deg),Alt(km)}" and names the body-fixed
frame ("Center pole/equ"). QUANTITIES='4' is the apparent (airless) azimuth and elevation,
azimuth measured clockwise from north. Times are UT.

Writes validation/horizons_vs_skyfield.csv and .md, and keeps the raw Horizons responses in
validation/horizons_raw/ so the header conventions can be checked.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import math
import os
import re
import sys
import urllib.parse
import urllib.request

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from precompute.ephemeris import Sky  # noqa: E402

API = "https://ssd.jpl.nasa.gov/api/horizons.api"
BODIES = {"sun": "10", "earth": "399"}
DEFAULT_TIMES = ["2026-11-15T00:00:00Z", "2027-01-01T00:00:00Z", "2027-04-01T06:00:00Z",
                 "2027-07-01T12:00:00Z", "2027-10-01T18:00:00Z", "2028-02-29T23:00:00Z"]
RAW_DIR = os.path.join(ROOT, "validation", "horizons_raw")


def parse_utc(s):
    return dt.datetime.fromisoformat(s.replace("Z", "+00:00"))


def jd_ut(t: dt.datetime) -> float:
    return t.timestamp() / 86400.0 + 2440587.5


def query(body_id, lon, lat, alt_km, times):
    params = {
        "format": "text", "COMMAND": "'%s'" % body_id, "OBJ_DATA": "'NO'", "MAKE_EPHEM": "'YES'",
        "EPHEM_TYPE": "'OBSERVER'", "CENTER": "'coord@301'", "COORD_TYPE": "'GEODETIC'",
        "SITE_COORD": "'%.6f,%.6f,%.6f'" % (lon, lat, alt_km),
        # individually quoted values separated by spaces, URL-encoded (API doc, "TLIST Parameter")
        "TLIST": " ".join("'%.8f'" % jd_ut(t) for t in times), "TLIST_TYPE": "'JD'",
        "QUANTITIES": "'4'", "APPARENT": "'AIRLESS'", "ANG_FORMAT": "'DEG'", "EXTRA_PREC": "'YES'", "CSV_FORMAT": "'YES'",
    }
    url = API + "?" + urllib.parse.urlencode(params, quote_via=urllib.parse.quote)
    req = urllib.request.Request(url, headers={"User-Agent": "lunar-navigator-validation/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8", "replace")


def parse(text):
    """Rows between $$SOE and $$EOE: 'date, time, [flags], az, el,' in CSV format -> list of (datetime, az, el)."""
    if "$$SOE" not in text:
        raise RuntimeError("no ephemeris in the Horizons response:\n" + text[-1500:])
    body = text.split("$$SOE")[1].split("$$EOE")[0]
    rows = []
    for line in body.strip().splitlines():
        cells = [c.strip() for c in line.split(",")]
        nums = [c for c in cells if re.fullmatch(r"[-+]?\d+(\.\d+)?", c)]
        when = dt.datetime.strptime(cells[0][:20].strip(), "%Y-%b-%d %H:%M:%S" if cells[0].count(":") == 2 else "%Y-%b-%d %H:%M").replace(tzinfo=dt.timezone.utc)
        rows.append((when, float(nums[-2]), float(nums[-1])))
    return rows


def header_info(text):
    out = {}
    for key in ("Center geodetic", "Center pole/equ", "Center radii", "Center body name", "Center-site name", "Atmos refraction"):
        m = re.search(r"^%s\s*:\s*(.*)$" % re.escape(key), text, re.M)
        if m:
            out[key] = m.group(1).strip()
    return out


def sep_arcsec(alt1, az1, alt2, az2):
    a1, z1, a2, z2 = map(math.radians, (alt1, az1, alt2, az2))
    c = math.sin(a1) * math.sin(a2) + math.cos(a1) * math.cos(a2) * math.cos(z1 - z2)
    return math.degrees(math.acos(max(-1.0, min(1.0, c)))) * 3600.0


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    p = argparse.ArgumentParser()
    p.add_argument("--lat", type=float)
    p.add_argument("--lon", type=float)
    p.add_argument("--alt-m", type=float, help="observer height above the 1737.4 km sphere (ground + mast), metres")
    p.add_argument("--name", default=None)
    p.add_argument("--times", nargs="*", default=DEFAULT_TIMES)
    a = p.parse_args()
    if a.lat is None:
        D = json.load(open(os.path.join(ROOT, "web", "data", "navigator-data.json"), encoding="utf-8"))
        s = D["sites"][0]
        a.lat, a.lon, a.alt_m, a.name = s["lat_deg"], s["lon_deg"], s["ground_elev_m"] + 2.0, s["name"]
    name = a.name or "site"
    times = [parse_utc(t) for t in a.times]
    sky = Sky(os.path.join(ROOT, "data"))
    ours = sky.altaz(a.lat, a.lon, a.alt_m, sky.ts.from_datetimes(times))
    os.makedirs(RAW_DIR, exist_ok=True)
    rows, headers = [], {}
    for body, bid in BODIES.items():
        text = query(bid, a.lon, a.lat, a.alt_m / 1000.0, times)
        open(os.path.join(RAW_DIR, "%s.txt" % body), "w", encoding="utf-8").write(text)
        headers[body] = header_info(text)
        got = parse(text)
        if len(got) != len(times):
            raise RuntimeError("Horizons returned %d rows for %d times (%s)" % (len(got), len(times), body))
        for i, (when, az, el) in enumerate(got):
            if abs((when - times[i]).total_seconds()) > 1:
                raise RuntimeError("time mismatch: asked %s, got %s" % (times[i], when))
            oa, oz = float(ours[body]["alt_deg"][i]), float(ours[body]["az_deg"][i])
            daz = ((oz - az + 180) % 360) - 180
            rows.append({"utc": times[i].strftime("%Y-%m-%dT%H:%M:%SZ"), "body": body,
                         "skyfield_alt_deg": round(oa, 5), "skyfield_az_deg": round(oz, 5),
                         "horizons_el_deg": el, "horizons_az_deg": az,
                         "d_alt_arcsec": round((oa - el) * 3600, 2), "d_az_arcsec": round(daz * 3600 * math.cos(math.radians(el)), 2),
                         "sep_arcsec": round(sep_arcsec(oa, oz, el, az), 2)})
    with open(os.path.join(ROOT, "validation", "horizons_vs_skyfield.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    seps = np.array([r["sep_arcsec"] for r in rows])
    h = headers["sun"]
    md = [
        "# Skyfield (precompute/ephemeris.py) vs JPL Horizons, observer on the Moon",
        "",
        "Site: %s, lat %.4f, lon %.4f (east-positive), %.1f m above the 1737.4 km sphere (ground + 2 m mast)." % (name, a.lat, a.lon, a.alt_m),
        "Horizons: `CENTER='coord@301'`, `COORD_TYPE='GEODETIC'`, `SITE_COORD='%.6f,%.6f,%.6f'` (E-lon deg, lat deg, alt km)," % (a.lon, a.lat, a.alt_m / 1000),
        "`QUANTITIES='4'` (apparent azimuth and elevation, airless), times in UT via `TLIST`. Horizons header:",
        "",
    ] + ["- %s: %s" % (k, v) for k, v in h.items()] + [
        "",
        "Skyfield: DE421 + moon_pa_de421_1900-2050.bpc, frame MOON_ME_DE421, `observe().apparent().altaz()`.",
        "",
        "**Angular separation: median %.1f\", max %.1f\" over %d body-samples** (1\" = 0.00028°; the data file is rounded to 0.01° = 36\"). Generated %s." % (
            np.median(seps), seps.max(), len(rows), dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%MZ")),
        "",
        "| UTC | body | Skyfield alt | Skyfield az | Horizons el | Horizons az | Δalt \" | Δaz·cos \" | sep \" |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for r in rows:
        md.append("| %s | %s | %.5f | %.5f | %.5f | %.5f | %.1f | %.1f | %.1f |" % (
            r["utc"], r["body"], r["skyfield_alt_deg"], r["skyfield_az_deg"], r["horizons_el_deg"], r["horizons_az_deg"],
            r["d_alt_arcsec"], r["d_az_arcsec"], r["sep_arcsec"]))
    md += ["", "Raw Horizons responses: `validation/horizons_raw/sun.txt`, `validation/horizons_raw/earth.txt`."]
    open(os.path.join(ROOT, "validation", "horizons_vs_skyfield.md"), "w", encoding="utf-8").write("\n".join(md) + "\n")
    print("\n".join(md))


if __name__ == "__main__":
    main()
