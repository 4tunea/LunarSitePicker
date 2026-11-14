"""Build the data for the 3D surface view (web/moonsky/moon-sky.js).

    python web/tools/build_moonsky_data.py               (needs skyfield, numpy, pillow)
    python web/tools/build_moonsky_data.py --years 2026 2028
    python web/tools/build_moonsky_data.py --only ephem

Inputs (downloaded into data/ on first run, gitignored):
  de421.bsp, moon_080317.tf, pck00008.tpc, moon_pa_de421_1900-2050.bpc   Skyfield kernels
  LDEM_16.IMG        NASA LRO LOLA global elevation, 16 px/deg (~1.9 km), PDS
  bsc5.dat.gz        Yale Bright Star Catalogue
  earth_src.img      NASA Blue Marble (SVS)

Outputs (web/moonsky/, committed; each file is a script so the page also works from file://):
  meta.js            format description
  ephem/<year>.js    daily Sun and Earth apparent positions from the Moon's centre in MOON_ME_DE421,
                     plus the ICRF->Moon rotation (stars, Earth's orientation). ~12 KB per year.
                     The browser adds the observer's own position (parallax) and interpolates
                     (4-point Lagrange); checked against Skyfield's topocentric alt/az below.
                     In the app, Sun/Earth angles come from NAV_DATA when it covers the time;
                     this file is the fallback and is always used for stars and Earth's rotation.
  dem/<band>-<sector>.js
                     LDEM_16 re-gridded per 5 deg latitude band so tiles have ~equal ground size,
                     row-delta coded, deflated, base64. Fetched only around the observer.
  stars.js           BSC5 stars V <= 5.5
  earth.js           Earth map, 512x256 JPEG as a data URL (WebGL refuses file:// images)
"""
import argparse, base64, datetime as dt, gzip, json, math, os, struct, urllib.request, zlib

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
DATA = os.path.join(ROOT, "data")
OUT = os.path.join(ROOT, "web", "moonsky")

KERNELS = ["de421.bsp", "moon_080317.tf", "pck00008.tpc", "moon_pa_de421_1900-2050.bpc"]
LDEM_URL = "https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/ldem_16.img"
BSC5_URL = "http://tdc-www.harvard.edu/catalogs/bsc5.dat.gz"
EARTH_URLS = ["https://svs.gsfc.nasa.gov/vis/a000000/a002900/a002915/bluemarble-2048.png",
              "https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57752/land_shallow_topo_2048.jpg"]

DEM_PPD, BAND_ROWS, MOON_R_M = 16, 80, 1737400.0
EPH_REC = struct.Struct("<10h2H")              # sun unit, earth unit, quaternion (x32767), 2 distances
SUN_D0, SUN_DS, EARTH_D0, EARTH_DS, PAD_DAYS = 1.46e8, 100.0, 345000.0, 1.0, 2


def write_js(key, payload):
    path = os.path.join(OUT, key + ".js")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write("MoonSkyData.put(%s,%s);\n" % (json.dumps(key), json.dumps(payload, separators=(",", ":"))))
    return os.path.getsize(path)


def b64(b):
    return base64.b64encode(b).decode("ascii")


def download(url, path):
    if not os.path.exists(path):
        print("downloading", url)
        urllib.request.urlretrieve(url, path)
    return path


# ------------------------------------------------------------------ ephemeris (Skyfield)
def load_sky():
    from skyfield.api import Loader, PlanetaryConstants
    load = Loader(DATA)
    ts, eph = load.timescale(), load("de421.bsp")
    pc = PlanetaryConstants()
    pc.read_text(load("moon_080317.tf")); pc.read_text(load("pck00008.tpc"))
    pc.read_binary(load("moon_pa_de421_1900-2050.bpc"))
    return ts, eph, pc, pc.build_frame_named("MOON_ME_DE421")


def mat_to_quat(R):
    q = np.empty((R.shape[2], 4))
    for k in range(R.shape[2]):
        m = R[:, :, k]; tr = m.trace()
        if tr > 0:
            s = math.sqrt(tr + 1) * 2; q[k] = [s / 4, (m[2, 1] - m[1, 2]) / s, (m[0, 2] - m[2, 0]) / s, (m[1, 0] - m[0, 1]) / s]
        elif m[0, 0] > m[1, 1] and m[0, 0] > m[2, 2]:
            s = math.sqrt(1 + m[0, 0] - m[1, 1] - m[2, 2]) * 2; q[k] = [(m[2, 1] - m[1, 2]) / s, s / 4, (m[0, 1] + m[1, 0]) / s, (m[0, 2] + m[2, 0]) / s]
        elif m[1, 1] > m[2, 2]:
            s = math.sqrt(1 + m[1, 1] - m[0, 0] - m[2, 2]) * 2; q[k] = [(m[0, 2] - m[2, 0]) / s, (m[0, 1] + m[1, 0]) / s, s / 4, (m[1, 2] + m[2, 1]) / s]
        else:
            s = math.sqrt(1 + m[2, 2] - m[0, 0] - m[1, 1]) * 2; q[k] = [(m[1, 0] - m[0, 1]) / s, (m[0, 2] + m[2, 0]) / s, (m[1, 2] + m[2, 1]) / s, s / 4]
        if k and np.dot(q[k], q[k - 1]) < 0:
            q[k] = -q[k]
    return q


def build_ephem(years):
    ts, eph, pc, frame = load_sky()
    done = []
    for y in range(years[0], years[1] + 1):
        ndays = (dt.date(y + 1, 1, 1) - dt.date(y, 1, 1)).days
        t = ts.utc(y, 1, 1 + np.arange(-PAD_DAYS, ndays + PAD_DAYS + 1))
        try:
            m = eph["moon"].at(t); R = frame.rotation_at(t)
            vec = {b: np.einsum("ijn,jn->in", R, m.observe(eph[b]).apparent().position.km) for b in ("sun", "earth")}
        except Exception as exc:
            print("  skip %d: %s" % (y, str(exc)[:70])); continue
        q, recs = mat_to_quat(R), bytearray()
        for k in range(R.shape[2]):
            s, e = vec["sun"][:, k], vec["earth"][:, k]; ds, de = np.linalg.norm(s), np.linalg.norm(e)
            recs += EPH_REC.pack(*[round(x * 32767) for x in (*(s / ds), *(e / de), *q[k])],
                                 round((ds - SUN_D0) / SUN_DS), round((de - EARTH_D0) / EARTH_DS))
        write_js("ephem/%d" % y, b64(bytes(recs)))
        done.append(y)
    print("ephemeris: %d-%d" % (done[0], done[-1]))
    return done[0], done[-1]


def validate(y0, y1, n=200):
    """Re-implements the browser maths in Python and compares with Skyfield topocentric alt/az."""
    ts, eph, pc, frame = load_sky()
    rng, errs = np.random.default_rng(3), []
    for _ in range(n):
        y = int(rng.integers(y0, y1 + 1)); doy = rng.uniform(0, 364.9)
        lat, lon = rng.uniform(-90, -60) if rng.random() < 0.6 else rng.uniform(-89, 89), rng.uniform(-180, 180)
        txt = open(os.path.join(OUT, "ephem", "%d.js" % y)).read()
        raw = base64.b64decode(txt[txt.index(',"') + 2:txt.rindex('"')])
        rec = np.array(list(EPH_REC.iter_unpack(raw)), float)
        x = doy + PAD_DAYS; i = int(x); f = x - i
        w = [-f * (f - 1) * (f - 2) / 6, (f + 1) * (f - 1) * (f - 2) / 2, -(f + 1) * f * (f - 2) / 2, (f + 1) * f * (f - 1) / 6]
        r = sum(w[k] * rec[i - 1 + k] for k in range(4))
        la, lo = math.radians(lat), math.radians(lon)
        up = np.array([math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la)])
        east = np.array([-math.sin(lo), math.cos(lo), 0]); north = np.cross(up, east)
        site = eph["moon"] + pc.build_latlon_degrees(frame, lat, lon); t = ts.utc(y, 1, 1 + doy)
        for b, sl, d in (("sun", slice(0, 3), SUN_D0 + r[10] * SUN_DS), ("earth", slice(3, 6), EARTH_D0 + r[11] * EARTH_DS)):
            v = r[sl] / np.linalg.norm(r[sl]) * d - up * MOON_R_M / 1000
            v /= np.linalg.norm(v)
            alt, az, _ = site.at(t).observe(eph[b]).apparent().altaz()
            ref = np.array([math.cos(alt.radians) * math.sin(az.radians), math.cos(alt.radians) * math.cos(az.radians), math.sin(alt.radians)])
            mine = np.array([v @ east, v @ north, v @ up])
            errs.append(math.degrees(math.acos(min(1.0, float(mine @ ref)))) * 3600)
    print('check vs Skyfield topocentric (%d): median %.1f", max %.1f"' % (len(errs), np.median(errs), max(errs)))


# ------------------------------------------------------------------ elevation (LOLA LDEM_16)
def resample_row(row, n):
    N = row.size
    if n == N:
        return row.astype(float)
    cum = np.concatenate([[0], np.cumsum(np.concatenate([row[-1:], row, row[:1]]).astype(float))])
    edges = np.arange(cum.size) - 1.0
    c = (np.arange(n) + 0.5) * N / n; half = N / n / 2
    return (np.interp(c + half, edges, cum) - np.interp(c - half, edges, cum)) / (2 * half)


def build_dem():
    path = download(LDEM_URL, os.path.join(DATA, "LDEM_16.IMG"))
    rows, cols = 180 * DEM_PPD, 360 * DEM_PPD
    dem = np.fromfile(path, dtype="<i2").reshape(rows, cols).astype(np.float32) * 0.5
    bands, total = [], 0
    for b in range(rows // BAND_ROWS):
        top, bot = 90 - 5 * b, 90 - 5 * (b + 1)
        lat_eq = min(abs(top), abs(bot)) if top * bot > 0 else 0
        S = math.ceil(math.ceil(cols * math.cos(math.radians(lat_eq))) / BAND_ROWS)
        w = math.ceil(math.ceil(cols * math.cos(math.radians(lat_eq))) / S); n = S * w
        block = np.round(np.stack([resample_row(dem[r], n) for r in range(b * BAND_ROWS, (b + 1) * BAND_ROWS)])).astype(np.int16)
        for s in range(S):
            delta = np.diff(block[:, s * w:(s + 1) * w].astype(np.int32), axis=1, prepend=0).astype("<i2")
            total += write_js("dem/%d-%d" % (b, s), b64(zlib.compress(delta.tobytes(), 9)))
        bands.append(dict(n=n, w=w, s=S))
    print("elevation: %d tiles, %.1f MB" % (sum(x["s"] for x in bands), total / 1e6))
    return bands


# ------------------------------------------------------------------ stars, Earth
def build_stars(max_mag=5.5):
    lines = gzip.decompress(open(download(BSC5_URL, os.path.join(DATA, "bsc5.dat.gz")), "rb").read()).decode("ascii", "replace").splitlines()
    out = bytearray()
    for ln in lines:
        try:
            ra = (int(ln[75:77]) + int(ln[77:79]) / 60 + float(ln[79:83]) / 3600) * 15
            dec = (int(ln[84:86]) + int(ln[86:88]) / 60 + int(ln[88:90]) / 3600) * (-1 if ln[83] == "-" else 1)
            vmag = float(ln[102:107])
        except (ValueError, IndexError):
            continue
        if vmag > max_mag:
            continue
        try:
            bv = float(ln[109:114])
        except ValueError:
            bv = 0.6
        r, d = math.radians(ra), math.radians(dec)
        out += struct.pack("<3hBb", *[round(c * 32767) for c in (math.cos(d) * math.cos(r), math.cos(d) * math.sin(r), math.sin(d))],
                           round((vmag + 2) * 30), round(max(-2, min(2.1, bv)) * 60))
    write_js("stars", b64(bytes(out)))
    print("stars: %d" % (len(out) // 8))


def build_earth():
    from PIL import Image
    import io
    path = os.path.join(DATA, "earth_src.img")
    for url in EARTH_URLS:
        try:
            download(url, path); break
        except Exception as exc:
            print("  failed:", exc)
    buf = io.BytesIO()
    Image.open(path).convert("RGB").resize((512, 256), Image.LANCZOS).save(buf, "JPEG", quality=80, optimize=True)
    write_js("earth", "data:image/jpeg;base64," + b64(buf.getvalue()))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--years", nargs=2, type=int, default=[2020, 2035])
    p.add_argument("--only", choices=["ephem", "dem", "stars", "earth"])
    a = p.parse_args()
    os.makedirs(DATA, exist_ok=True); os.makedirs(OUT, exist_ok=True)
    meta_path = os.path.join(OUT, "meta.js")
    meta = {}
    if os.path.exists(meta_path):
        txt = open(meta_path).read(); meta = json.loads(txt[txt.index(",") + 1:txt.rindex(")")])
    if a.only in (None, "ephem"):
        y0, y1 = build_ephem(a.years)
        meta["ephem"] = dict(first=y0, last=y1, pad=PAD_DAYS, rec=24, sun_d0=SUN_D0, sun_ds=SUN_DS, earth_d0=EARTH_D0, earth_ds=EARTH_DS,
                             frame="MOON_ME_DE421", source="Skyfield + DE421, apparent, from the Moon's centre")
    if a.only in (None, "dem"):
        meta["dem"] = dict(ppd=DEM_PPD, band_rows=BAND_ROWS, bands=build_dem(), radius_m=MOON_R_M, source="LRO LOLA LDEM_16 (PDS)")
    if a.only in (None, "stars"):
        build_stars()
    if a.only in (None, "earth"):
        build_earth()
    meta["version"] = 1
    write_js("meta", meta)
    if a.only in (None, "ephem"):
        validate(meta["ephem"]["first"], meta["ephem"]["last"])


if __name__ == "__main__":
    main()
