"""Fetch real NASA data for the navigator and turn it into two small files the page loads.

    python build_data.py            # 120 m elevation model (116 MB download)
    python build_data.py --small    # 240 m elevation model (29 MB download)

What it does (standard library only):
  1. Downloads NASA's LRO colour map of the Moon and writes moon-texture.js,
     so the 3D Moon shows real imagery even when the page is opened offline.
  2. Downloads the LOLA south-pole elevation model (75-90 deg S) and, for every
     site in sites.js south of 79 deg S, measures how high the terrain rises
     above the horizontal in each compass direction. Writes horizons.js.

Downloads are kept in data/ and reused on the next run.
"""
import base64
import json
import math
import mmap
import os
import re
import struct
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
R_MOON = 1737400.0          # metres, LOLA reference sphere
EDGE_LAT = -75.0            # northern edge of the elevation model
MAX_RANGE = 250000.0        # how far to look for terrain, metres
AZ_STEP = 2                 # degrees between horizon samples
EYE_HEIGHT = 2.0            # metres above the ground (solar panel / antenna height)

TEXTURE_URL = "https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_2k.jpg"
DEM_URLS = {
    "120": "https://imbrium.mit.edu/DATA/LOLA_GDR/POLAR/IMG/LDEM_75S_120M.IMG",
    "240": "https://imbrium.mit.edu/DATA/LOLA_GDR/POLAR/IMG/LDEM_75S_240M.IMG",
}
# Known landmark used to confirm the map is read the right way round.
SHACKLETON_FLOOR = (-89.67, 129.78)


def download(url, path):
    if os.path.exists(path) and os.path.getsize(path) > 0:
        print("  using saved copy:", os.path.relpath(path, HERE))
        return
    print("  downloading", url)
    req = urllib.request.Request(url, headers={"User-Agent": "lunar-landing-navigator/1.0"})
    tmp = path + ".part"
    with urllib.request.urlopen(req, timeout=60) as r, open(tmp, "wb") as f:
        total = int(r.headers.get("Content-Length") or 0)
        done = 0
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
            done += len(chunk)
            if total:
                sys.stdout.write("\r  %3d%% of %d MB" % (100 * done // total, total >> 20))
                sys.stdout.flush()
        if total:
            print()
    os.replace(tmp, path)


def build_texture():
    print("Moon surface map")
    path = os.path.join(DATA, "moon_2k.jpg")
    download(TEXTURE_URL, path)
    raw = open(path, "rb").read()
    if raw[:2] != b"\xff\xd8":
        raise RuntimeError("the downloaded surface map is not a JPEG image")
    with open(os.path.join(HERE, "moon-texture.js"), "w") as f:
        f.write("/* NASA SVS CGI Moon Kit colour map (LRO camera). Written by build_data.py. */\n")
        f.write('var MOON_TEXTURE = "data:image/jpeg;base64,%s";\n' % base64.b64encode(raw).decode("ascii"))
        f.write('var MOON_TEXTURE_SOURCE = "NASA LRO colour map";\n')
    print("  wrote moon-texture.js (%d KB)" % (len(raw) * 4 // 3 >> 10))


class Dem:
    """South polar stereographic grid of 16-bit heights (half metres above 1737.4 km)."""

    def __init__(self, path):
        size = os.path.getsize(path)
        n = int(round(math.sqrt(size / 2)))
        if n * n * 2 != size:
            raise RuntimeError("unexpected elevation file size: %d bytes" % size)
        self.n = n
        self.half = n / 2.0
        self.px = 2 * (2 * R_MOON * math.tan(math.radians(90 + EDGE_LAT) / 2)) / n
        self.f = open(path, "rb")
        self.m = mmap.mmap(self.f.fileno(), 0, access=mmap.ACCESS_READ)
        self.flip_x = self.flip_y = False

    def height_xyz(self, ux, uy, uz):
        """Height in metres at the surface point with unit vector (ux, uy, uz), or None if off the map."""
        k = 2 * R_MOON / (1 - uz) / self.px
        x, y = k * uy, k * ux                     # map x = r sin(lon), map y = r cos(lon)
        if self.flip_x:
            x = -x
        if self.flip_y:
            y = -y
        col, row = int(self.half + x), int(self.half - y)
        if col < 0 or row < 0 or col >= self.n or row >= self.n:
            return None
        return struct.unpack_from("<h", self.m, 2 * (row * self.n + col))[0] * 0.5

    def height(self, lat, lon):
        la, lo = math.radians(lat), math.radians(lon)
        return self.height_xyz(math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la))

    def orient(self):
        """Confirm orientation with Shackleton crater, whose floor lies almost 3 km below the reference sphere."""
        for fx in (False, True):
            for fy in (False, True):
                self.flip_x, self.flip_y = fx, fy
                h = self.height(*SHACKLETON_FLOOR)
                if h is not None and h < -2000:
                    print("  orientation check: Shackleton floor at %.0f m%s" %
                          (h, "" if not (fx or fy) else " (map mirrored: x=%s y=%s)" % (fx, fy)))
                    return
        raise RuntimeError("could not find Shackleton crater in the elevation model; horizons not written")


def horizon(dem, lat, lon):
    la, lo = math.radians(lat), math.radians(lon)
    up = (math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la))
    east = (-math.sin(lo), math.cos(lo), 0.0)
    north = (-math.sin(la) * math.cos(lo), -math.sin(la) * math.sin(lo), math.cos(la))
    ground = dem.height_xyz(*up)
    if ground is None:
        return None
    r0 = R_MOON + ground + EYE_HEIGHT
    dists, d = [], dem.px
    while d < MAX_RANGE:
        dists.append(d)
        d += max(dem.px, d * 0.02)
    out = []
    for az in range(0, 360, AZ_STEP):
        a = math.radians(az)
        t = tuple(math.cos(a) * north[i] + math.sin(a) * east[i] for i in range(3))
        best = -90.0
        for d in dists:
            th = d / R_MOON
            c, s = math.cos(th), math.sin(th)
            h = dem.height_xyz(c * up[0] + s * t[0], c * up[1] + s * t[1], c * up[2] + s * t[2])
            if h is None:
                break
            r1 = R_MOON + h
            el = math.degrees(math.atan2(r1 * c - r0, r1 * s))
            if el > best:
                best = el
        out.append(round(best, 2))
    return {"ground": round(ground), "el": out}


def build_horizons(res):
    print("Terrain horizons")
    path = os.path.join(DATA, "LDEM_75S_%sM.IMG" % res)
    download(DEM_URLS[res], path)
    dem = Dem(path)
    print("  elevation model: %d x %d pixels, %.0f m per pixel" % (dem.n, dem.n, dem.px))
    dem.orient()
    src = open(os.path.join(HERE, "sites.js"), encoding="utf-8").read()
    sites = re.findall(r"id:\s*'([^']+)'.*?lat:\s*(-?[\d.]+),\s*lon:\s*(-?[\d.]+)", src)
    out = {}
    for sid, lat, lon in sites:
        lat, lon = float(lat), float(lon)
        if lat > -79:
            continue
        h = horizon(dem, lat, lon)
        if h:
            out[sid] = h
            print("  %-12s ground %6d m, horizon %5.2f to %5.2f deg" % (sid, h["ground"], min(h["el"]), max(h["el"])))
    with open(os.path.join(HERE, "horizons.js"), "w") as f:
        f.write("/* Terrain horizon per site: elevation angle of the skyline (degrees) every %d degrees of\n"
                "   azimuth, clockwise from north. From NASA LOLA LDEM_75S_%sM. Written by build_data.py. */\n" % (AZ_STEP, res))
        f.write("var HORIZONS = %s;\n" % json.dumps(out, separators=(",", ":")))
        f.write('var HORIZON_SOURCE = "LOLA %s m terrain";\n' % res)
    print("  wrote horizons.js for %d sites" % len(out))


if __name__ == "__main__":
    os.makedirs(DATA, exist_ok=True)
    res = "240" if "--small" in sys.argv else "120"
    failed = False
    for step in (build_texture, lambda: build_horizons(res)):
        try:
            step()
        except Exception as exc:
            failed = True
            print("  FAILED:", exc)
    print("Done with problems (see above)." if failed else "Done. Reload the page.")
