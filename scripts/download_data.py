"""Download the raw inputs for precompute/ into data/ (gitignored). Downloads only.

    python scripts/download_data.py              # kernels + LDEM_75S_120M (.IMG and .LBL)
    python scripts/download_data.py --only kernels
    python scripts/download_data.py --only dem
    python scripts/download_data.py --check      # HEAD requests only: show sizes, download nothing

Rules: skip a file whose size already matches the server; stream to <name>.part and rename
when the size matches; fail loudly otherwise. Standard library only, so it runs without the
.venv. The DEM geometry is read from the PDS label (precompute/pds_label.py) and cross-checked
against the values we know; the label is the truth, the known values are only a guard.

Not downloaded yet: the 5 m/px PGDA tiles (see TILES_5MPP below). Their file names must be
taken from the README at https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/ before they are added.
"""
from __future__ import annotations

import argparse
import os
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from precompute.pds_label import dem_geometry, read_label  # noqa: E402

DATA_DIR = os.path.join(ROOT, "data")
USER_AGENT = "lunar-navigator-download/1.0"
NAIF = "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/"
LOLA_MIT = "https://imbrium.mit.edu/DATA/LOLA_GDR/POLAR/IMG/"
LOLA_PDS = "https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img/"

# name -> (group, [url, mirror...], expected size in bytes or None). Sizes verified by HEAD on
# 2026-11-14; None means "trust the server's Content-Length".
FILES = {
    # Skyfield / SPICE kernels (CLAUDE.md, Calculations 1). de421 and pck00008 live in a_old_versions/.
    "de421.bsp":                    ("kernels", [NAIF + "spk/planets/a_old_versions/de421.bsp"], 16_790_528),
    "moon_080317.tf":               ("kernels", [NAIF + "fk/satellites/moon_080317.tf"], 21_437),
    "pck00008.tpc":                 ("kernels", [NAIF + "pck/a_old_versions/pck00008.tpc"], 111_586),
    "moon_pa_de421_1900-2050.bpc":  ("kernels", [NAIF + "pck/moon_pa_de421_1900-2050.bpc"], 1_770_496),
    # LOLA far-field DEM, 75-90 S, 120 m/px, polar stereographic (CLAUDE.md, Data).
    "LDEM_75S_120M.LBL":            ("dem", [LOLA_MIT + "LDEM_75S_120M.LBL", LOLA_PDS + "ldem_75s_120m.lbl"], 4_991),
    "LDEM_75S_120M.IMG":            ("dem", [LOLA_MIT + "LDEM_75S_120M.IMG", LOLA_PDS + "ldem_75s_120m.img"], 116_250_752),
}

# PGDA LOLA_5mpp near-field tiles, one per analysed site. NOT downloaded yet (step 3 of the plan):
# the exact file names and sizes must be read from the README on the PGDA page first.
TILES_5MPP = {
    "connecting-ridge": "Site01",
    "shackleton-rim":   "Site04",
    "malapert-massif":  "Site23",
    "haworth":          "Haworth",
    "nobile-rim-2":     "DM2",
}
PGDA_5MPP = "https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/"

# What we know about LDEM_75S_120M from an earlier reading of its label. Used only as a guard:
# if the parsed label disagrees, the script stops and says so.
KNOWN_DEM = {
    "lines": 7624, "samples": 7624, "scale_m": 120.0, "pole_line": 3811.5, "pole_sample": 3811.5,
    "scaling_factor": 0.5, "radius_km": 1737.4, "positive_longitude": "EAST",
    "projection": "POLAR STEREOGRAPHIC", "dtype": "<i2",
}


def _request(url, method="GET"):
    return urllib.request.Request(url, method=method, headers={"User-Agent": USER_AGENT})


def head_size(url, timeout=30):
    """Content-Length from a HEAD request, or None if the server does not say."""
    with urllib.request.urlopen(_request(url, "HEAD"), timeout=timeout) as r:
        n = r.headers.get("Content-Length")
        return int(n) if n else None


def fetch(url, dest, expected, timeout=60):
    """Stream url to dest + '.part', check the size, rename. Returns the final size."""
    part = dest + ".part"
    done, t0 = 0, time.time()
    with urllib.request.urlopen(_request(url), timeout=timeout) as r, open(part, "wb") as f:
        total = expected or (int(r.headers.get("Content-Length") or 0) or None)
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
            done += len(chunk)
            if total:
                sys.stdout.write("\r    %3d%% of %.1f MB" % (100 * done // total, total / 1e6))
                sys.stdout.flush()
    if total:
        print()
    if expected is not None and done != expected:
        os.remove(part)
        raise RuntimeError("size mismatch for %s: got %d bytes, expected %d" % (os.path.basename(dest), done, expected))
    os.replace(part, dest)
    print("    saved %s (%.1f MB in %.0f s)" % (os.path.basename(dest), done / 1e6, time.time() - t0))
    return done


def ensure(name, urls, expected, data_dir, check_only=False):
    """Download one file unless it is already present with the right size."""
    dest = os.path.join(data_dir, name)
    print("%-28s" % name, end=" ")
    if check_only:
        for url in urls:
            try:
                n = head_size(url)
                flag = "" if expected is None or n == expected else "  !! expected %d" % expected
                print("HEAD %s -> %s bytes%s" % (url, n, flag))
            except urllib.error.URLError as exc:
                print("HEAD %s -> FAILED (%s)" % (url, exc))
        return True
    if os.path.exists(dest):
        size = os.path.getsize(dest)
        want = expected
        if want is None:
            try:
                want = head_size(urls[0])
            except urllib.error.URLError:
                want = None
        if want is None or size == want:
            print("present, %d bytes, skipped" % size)
            return True
        print("present but %d bytes instead of %d, re-downloading" % (size, want))
    errors = []
    for url in urls:
        try:
            print("\n    from", url)
            fetch(url, dest, expected)
            return True
        except (urllib.error.URLError, RuntimeError, OSError) as exc:
            errors.append("%s: %s" % (url, exc))
            print("    failed:", exc)
    print("  FAILED", name, "\n   " + "\n   ".join(errors))
    return False


def check_dem_label(data_dir):
    """Parse the LDEM label and compare with KNOWN_DEM; verify the IMG size against the label."""
    lbl_path = os.path.join(data_dir, "LDEM_75S_120M.LBL")
    img_path = os.path.join(data_dir, "LDEM_75S_120M.IMG")
    if not os.path.exists(lbl_path):
        print("label missing, cannot cross-check the DEM geometry")
        return False
    geo = dem_geometry(read_label(lbl_path))
    ok = True
    print("DEM geometry from the label:")
    for key in ("lines", "samples", "dtype", "scale_m", "resolution_pix_per_deg", "pole_line", "pole_sample",
                "scaling_factor", "offset_m", "radius_km", "positive_longitude", "projection",
                "center_lat_deg", "center_lon_deg", "min_lat_deg", "max_lat_deg", "coordinate_system"):
        flag = ""
        if key in KNOWN_DEM and KNOWN_DEM[key] != geo[key]:
            flag = "   !! known value %r disagrees" % (KNOWN_DEM[key],)
            ok = False
        print("  %-24s %s%s" % (key, geo[key], flag))
    if os.path.exists(img_path):
        size = os.path.getsize(img_path)
        if size == geo["expected_bytes"]:
            print("  IMG size %d bytes = LINES x LINE_SAMPLES x 2, OK" % size)
        else:
            print("  !! IMG size %d bytes, label implies %d" % (size, geo["expected_bytes"]))
            ok = False
    return ok


def main():
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--only", choices=["kernels", "dem"], help="download one group only")
    p.add_argument("--check", action="store_true", help="HEAD requests only, download nothing")
    p.add_argument("--data-dir", default=DATA_DIR)
    a = p.parse_args()
    os.makedirs(a.data_dir, exist_ok=True)
    print("data dir:", a.data_dir)
    ok = True
    for name, (group, urls, expected) in FILES.items():
        if a.only and group != a.only:
            continue
        ok = ensure(name, urls, expected, a.data_dir, a.check) and ok
    if not a.check and a.only in (None, "dem"):
        ok = check_dem_label(a.data_dir) and ok
    print("5 m/px PGDA tiles are not downloaded yet; needed per site:",
          ", ".join("%s=%s" % kv for kv in TILES_5MPP.items()), "from", PGDA_5MPP)
    print("all files OK" if ok else "PROBLEMS, see above")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
