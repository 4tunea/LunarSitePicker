"""Terrain relief for the 3D globe: surface slopes as images, so the globe can light real
topography from the real Sun direction (no baked-in shadows).

    python web/tools/build_relief.py          (needs numpy and Pillow)

Inputs, both NASA LRO LOLA:
  * global: LDEM_16 (16 px/deg, ~1.9 km), read back from the committed web/moonsky/dem tiles
  * south pole: LDEM_75S_120M (data/LDEM_75S_120M.IMG, 120 m, polar stereographic), cropped to 80 deg S

Output web/data/moon-relief.js defines MOON_RELIEF with two JPEG data URLs (4:4:4, so no chroma
smearing). Each pixel stores the surface gradient: R = d(height)/d(east-ish), G = d(height)/d(north-ish),
encoded as 128 + 127 * clamp(gradient / scale, -1, 1). B is unused (128).
  * global map: equirectangular 4096 x 2048, longitude -180 at the left edge, gradient in local
    east / north metres per metre.
  * polar map: south polar stereographic, image up = 0 deg longitude, image right = 90 deg E (the same
    orientation as web/terrain.js), gradient along image right / image up.
"""
import base64, io, json, os, re, zlib
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
DEM_DIR = os.path.join(ROOT, "web", "moonsky", "dem")
META = os.path.join(ROOT, "web", "moonsky", "meta.js")
IMG = os.path.join(ROOT, "data", "LDEM_75S_120M.IMG")
OUT = os.path.join(ROOT, "web", "data", "moon-relief.js")
R = 1737400.0

GLOBAL_W, GLOBAL_H, GLOBAL_SCALE = 4096, 2048, 0.35
POLAR_N, POLAR_EDGE_LAT, POLAR_SCALE = 3072, -80.0, 0.6
# LDEM_75S_120M geometry from its PDS label (LINES/LINE_SAMPLES 7624, MAP_SCALE 120 m,
# projection offsets 3811.5 px, SCALING_FACTOR 0.5 m per DN).
N_SRC, PX_SRC, OFF_SRC, DN_M = 7624, 120.0, 3811.5, 0.5


def read_put(path):
    txt = open(path, encoding="ascii").read()
    m = re.search(r'MoonSkyData\.put\("([^"]+)",\s*(.*)\);\s*$', txt, re.S)
    return m.group(1), json.loads(m.group(2))


def ldem16():
    """Rebuild the 2880 x 5760 LDEM_16 grid (metres) from the re-gridded band tiles."""
    _, meta = read_put(META)
    dem = meta["dem"]
    ppd, rows_b = dem["ppd"], dem["band_rows"]
    W = 360 * ppd
    out = np.zeros((180 * ppd, W), np.float32)
    for b, B in enumerate(dem["bands"]):
        n, w, s = B["n"], B["w"], B["s"]
        band = np.zeros((rows_b, s * w), np.float32)
        for k in range(s):
            _, b64 = read_put(os.path.join(DEM_DIR, "%d-%d.js" % (b, k)))
            a = np.frombuffer(zlib.decompress(base64.b64decode(b64)), "<i2").astype(np.int32).reshape(rows_b, w)
            band[:, k * w:(k + 1) * w] = np.cumsum(a, axis=1)
        band = band[:, :n]
        # row samples are centred at (i + 0.5) / n of 360 deg east longitude; resample to W columns
        x = (np.arange(W) + 0.5) / W * n - 0.5
        i0 = np.floor(x).astype(int); f = (x - i0).astype(np.float32)
        out[b * rows_b:(b + 1) * rows_b] = band[:, i0 % n] * (1 - f) + band[:, (i0 + 1) % n] * f
    return out, ppd   # row 0 = 90 N, column 0 = 0 E


def encode(gx, gy, scale):
    r = np.clip(128 + 127 * np.clip(gx / scale, -1, 1), 0, 255).astype(np.uint8)
    g = np.clip(128 + 127 * np.clip(gy / scale, -1, 1), 0, 255).astype(np.uint8)
    rgb = np.dstack([r, g, np.full_like(r, 128)])
    buf = io.BytesIO()
    Image.fromarray(rgb, "RGB").save(buf, "JPEG", quality=88, subsampling=0, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def global_map():
    h, ppd = ldem16()
    H, W = h.shape
    lat = 90 - (np.arange(H) + 0.5) / ppd
    dy = np.pi / 180 / ppd * R                                   # metres per row
    dx = np.maximum(np.cos(np.radians(lat)), 1e-3)[:, None] * dy  # metres per column
    ge = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) / (2 * dx)
    gn = np.zeros_like(h)
    gn[1:-1] = (h[:-2] - h[2:]) / (2 * dy)                       # row up = north
    # columns start at 0 E; the globe texture starts at 180 W
    ge = np.roll(ge, W // 2, axis=1); gn = np.roll(gn, W // 2, axis=1)
    def rs(a):
        return np.asarray(Image.fromarray(a.astype(np.float32), "F").resize((GLOBAL_W, GLOBAL_H), Image.BILINEAR))
    return encode(rs(ge), rs(gn), GLOBAL_SCALE)


def polar_map():
    a = np.memmap(IMG, dtype="<i2", mode="r", shape=(N_SRC, N_SRC))
    half_m = 2 * R * np.tan(np.radians((90 + POLAR_EDGE_LAT) / 2))   # stereographic radius of the edge
    half_px = half_m / PX_SRC
    c0 = int(np.floor(OFF_SRC - half_px)); c1 = int(np.ceil(OFF_SRC + half_px)) + 1
    h = a[c0:c1, c0:c1].astype(np.float32) * DN_M
    gx = np.zeros_like(h); gy = np.zeros_like(h)
    gx[:, 1:-1] = (h[:, 2:] - h[:, :-2]) / (2 * PX_SRC)          # image right
    gy[1:-1] = (h[:-2] - h[2:]) / (2 * PX_SRC)                   # image up
    # resample to POLAR_N pixels spanning exactly +-half_m around the pole
    src = (np.arange(POLAR_N) + 0.5) / POLAR_N * 2 * half_px - half_px + OFF_SRC - c0      # pole at 0-based index 3811.5
    i0 = np.floor(src).astype(int); f = (src - i0).astype(np.float32)
    def rs(z):
        z = z[:, i0] * (1 - f) + z[:, i0 + 1] * f
        return z[i0] * (1 - f)[:, None] + z[i0 + 1] * f[:, None]
    return encode(rs(gx), rs(gy), POLAR_SCALE), half_m


def main():
    g = global_map()
    p, half_m = polar_map()
    rel = {
        "global": {"url": g, "w": GLOBAL_W, "h": GLOBAL_H, "scale": GLOBAL_SCALE,
                   "source": "LRO LOLA LDEM_16 (~1.9 km/px)"},
        "polar": {"url": p, "n": POLAR_N, "half_m": round(half_m, 1), "edge_lat_deg": POLAR_EDGE_LAT, "scale": POLAR_SCALE,
                  "source": "LRO LOLA LDEM_75S_120M (120 m/px), %.0f m/px here" % (2 * half_m / POLAR_N)},
    }
    with open(OUT, "w") as f:
        f.write("/* Terrain slopes for the 3D globe. Generated by web/tools/build_relief.py from NASA LRO LOLA\n"
                "   LDEM_16 (global) and LDEM_75S_120M (south pole). Do not edit by hand. */\n")
        f.write("var MOON_RELIEF = " + json.dumps(rel) + ";\n")
    print("wrote %s: %.1f MB (global %.1f MB, polar %.1f MB)" % (os.path.relpath(OUT, ROOT), os.path.getsize(OUT) / 1e6,
          len(g) * 3 / 4e6, len(p) * 3 / 4e6))


if __name__ == "__main__":
    main()
