"""Terrain horizon (skyline) from LOLA polar stereographic DEMs.

    from precompute.horizon import PolarDem, horizon
    dem = PolarDem.from_pds("data/LDEM_75S_120M.IMG", "data/LDEM_75S_120M.LBL")
    h = horizon([dem], -89.4632, -137.4896, masts=(2.0, 10.0))
    h["ground_m"], h["elev_deg"][2.0]   # 720 values, degrees, bin i centred on azimuth i*0.5

Method (docs/data-contract.md section 2, CLAUDE.md Calculations 2):
- 720 azimuth bins of 0.5 deg, clockwise from local north; each bin takes the MAX over 3 rays
  cast at the bin centre and at +-1/6 deg.
- Each ray marches along a great circle out to max_range_m (250 km), first in steps of half a
  pixel, then in steps growing with distance (0.15 % of the distance).
- The DEM is sampled bilinearly. Several DEM layers can be given, finest first; a point takes
  the finest layer that covers it.
- Elevation angle uses the exact spherical form with curvature and no refraction:
      e = atan2((R + h) cos(d/R) - (R + h_site + mast), (R + h) sin(d/R))
  where d is the ground distance and heights are relative to the R = 1737.4 km sphere.

Geometry of the LOLA polar products (from the PDS label, precompute/pds_label.py): south polar
stereographic, x = 2R tan(pi/4 + lat/2) sin(lon) to the right (90 E), y = 2R tan(pi/4 + lat/2)
cos(lon) upward (0 lon up); sample = pole_sample + x/scale, line = pole_line - y/scale in
pixel-centre coordinates. In unit-vector form: x = 2R uy/(1 - uz), y = 2R ux/(1 - uz).
"""
from __future__ import annotations

import math
import os

import numpy as np

from precompute.pds_label import dem_geometry, read_label

R_MOON_M = 1_737_400.0


class PolarDem:
    """A south polar stereographic height grid with bilinear sampling."""

    def __init__(self, data, scale_m, pole_line, pole_sample, dn_scale=1.0, radius_m=R_MOON_M, name=""):
        self.data = data                       # 2-D array or memmap, [line, sample]
        self.scale = float(scale_m)
        self.pole_line = float(pole_line)
        self.pole_sample = float(pole_sample)
        self.dn_scale = float(dn_scale)        # metres per stored unit
        self.R = float(radius_m)
        self.name = name
        self.nl, self.ns = data.shape

    @classmethod
    def from_pds(cls, img_path, lbl_path):
        geo = dem_geometry(read_label(lbl_path))
        if geo["projection"] != "POLAR STEREOGRAPHIC" or geo["center_lat_deg"] != -90.0:
            raise ValueError("expected a south polar stereographic product, got %s at %s" % (geo["projection"], geo["center_lat_deg"]))
        if geo["positive_longitude"] != "EAST":
            raise ValueError("expected east-positive longitude")
        if os.path.getsize(img_path) != geo["expected_bytes"]:
            raise ValueError("%s is %d bytes, label implies %d" % (img_path, os.path.getsize(img_path), geo["expected_bytes"]))
        data = np.memmap(img_path, dtype=geo["dtype"], mode="r", shape=(geo["lines"], geo["samples"]))
        return cls(data, geo["scale_m"], geo["pole_line"], geo["pole_sample"], dn_scale=geo["scaling_factor"],
                   radius_m=geo["radius_km"] * 1000.0, name=os.path.basename(img_path))

    @classmethod
    def from_bounds(cls, data, left_m, top_m, scale_m, radius_m=R_MOON_M, name=""):
        """Grid whose outer pixel edges are at map x = left_m and y = top_m (GeoTIFF convention)."""
        return cls(data, scale_m, top_m / scale_m - 0.5, -left_m / scale_m - 0.5, 1.0, radius_m, name)

    @classmethod
    def from_geotiff(cls, path):
        """PGDA LOLA_5mpp *_surf.tif: south polar stereographic on the 1737.4 km sphere, metres, NaN = no data."""
        import rasterio
        with rasterio.open(path) as ds:
            if ds.crs is None or "stere" not in ds.crs.to_proj4() or "lat_0=-90" not in ds.crs.to_proj4():
                raise ValueError("%s: expected a south polar stereographic GeoTIFF, got %s" % (path, ds.crs))
            if abs(ds.res[0] - ds.res[1]) > 1e-9 or ds.transform.b != 0 or ds.transform.d != 0:
                raise ValueError("%s: expected square, north-up pixels" % path)
            data = ds.read(1).astype(np.float32)
            if ds.nodata is not None and not np.isnan(ds.nodata):
                data[data == ds.nodata] = np.nan
            dem = cls.from_bounds(data, ds.bounds.left, ds.bounds.top, ds.res[0], name=os.path.basename(path))
            dem.bounds = (ds.bounds.left, ds.bounds.bottom, ds.bounds.right, ds.bounds.top)
            return dem

    @classmethod
    def synthetic(cls, n, scale_m, fn, radius_m=R_MOON_M):
        """n x n grid, pole at the centre; fn(x, y) in map metres (x right = 90 E, y up = 0 lon) -> height m."""
        pole = (n - 1) / 2.0
        cols = (np.arange(n) - pole) * scale_m
        rows = (pole - np.arange(n)) * scale_m
        x, y = np.meshgrid(cols, rows)
        return cls(np.asarray(fn(x, y), dtype=np.float32), scale_m, pole, pole, 1.0, radius_m, "synthetic")

    @classmethod
    def synthetic_window(cls, left_m, top_m, n, scale_m, fn, radius_m=R_MOON_M):
        """n x n grid covering map x in [left, left + n*scale], y in [top - n*scale, top]; fn(x, y) -> height m."""
        cols = left_m + (np.arange(n) + 0.5) * scale_m
        rows = top_m - (np.arange(n) + 0.5) * scale_m
        x, y = np.meshgrid(cols, rows)
        return cls.from_bounds(np.asarray(fn(x, y), dtype=np.float32), left_m, top_m, scale_m, radius_m, "synthetic-window")

    def argmax_latlon(self):
        """Highest valid pixel: (lat, lon, height_m, line, sample, distance to the nearest tile edge in pixels)."""
        i = int(np.nanargmax(self.data))
        l, s = divmod(i, self.ns)
        x = (s - self.pole_sample) * self.scale
        y = (self.pole_line - l) * self.scale
        rho = math.hypot(x, y)
        lat = -90.0 + 2.0 * math.degrees(math.atan(rho / (2.0 * self.R)))
        lon = math.degrees(math.atan2(x, y))
        edge = min(l, s, self.nl - 1 - l, self.ns - 1 - s)
        return lat, lon, float(self.data[l, s]) * self.dn_scale, l, s, edge

    # ---- coordinates
    def map_xy(self, ux, uy, uz):
        """Unit vector(s) -> map x, y in metres (south polar stereographic)."""
        k = 2.0 * self.R / (1.0 - uz)
        return k * uy, k * ux

    def pixel(self, ux, uy, uz):
        """Unit vector(s) -> continuous (sample, line) in pixel-centre coordinates."""
        x, y = self.map_xy(ux, uy, uz)
        return self.pole_sample + x / self.scale, self.pole_line - y / self.scale

    def sample(self, ux, uy, uz):
        """Bilinear height in metres at unit vector(s); NaN where the point is off the grid."""
        s, l = self.pixel(np.asarray(ux, float), np.asarray(uy, float), np.asarray(uz, float))
        s0 = np.floor(s)
        l0 = np.floor(l)
        inside = (s0 >= 0) & (l0 >= 0) & (s0 < self.ns - 1) & (l0 < self.nl - 1)
        si = np.where(inside, s0, 0).astype(np.int64)
        li = np.where(inside, l0, 0).astype(np.int64)
        fs = s - s0
        fl = l - l0
        d = self.data
        h = ((d[li, si] * (1 - fs) + d[li, si + 1] * fs) * (1 - fl)
             + (d[li + 1, si] * (1 - fs) + d[li + 1, si + 1] * fs) * fl) * self.dn_scale
        return np.where(inside, h, np.nan)

    def height(self, lat_deg, lon_deg):
        u = unit(lat_deg, lon_deg)
        return float(self.sample(*u))


def unit(lat_deg, lon_deg):
    la, lo = math.radians(lat_deg), math.radians(lon_deg)
    return np.array([math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la)])


def local_frame(lat_deg, lon_deg):
    """Unit vectors up, east, north at a surface point (north = increasing latitude)."""
    la, lo = math.radians(lat_deg), math.radians(lon_deg)
    up = np.array([math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la)])
    east = np.array([-math.sin(lo), math.cos(lo), 0.0])
    north = np.cross(up, east)
    return up, east, north


def sample_layers(layers, ux, uy, uz):
    """Height from the finest layer that covers each point (layers ordered finest first)."""
    h = np.full(np.shape(ux), np.nan)
    for dem in layers:
        need = np.isnan(h)
        if not need.any():
            break
        v = dem.sample(ux[need], uy[need], uz[need])
        h[need] = v
    return h


def ray_distances(step0_m, max_range_m, growth=0.0015):
    d, out = step0_m, []
    while d <= max_range_m:
        out.append(d)
        d += max(step0_m, growth * d)
    return np.array(out)


def bearing_deg(lat1, lon1, lat2, lon2):
    """Initial great-circle bearing from point 1 to point 2, degrees clockwise from north."""
    p1, p2, dl = map(math.radians, (lat1, lat2, lon2 - lon1))
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return math.degrees(math.atan2(y, x)) % 360.0


def ground_distance_m(lat1, lon1, lat2, lon2, R=R_MOON_M):
    a, b = unit(lat1, lon1), unit(lat2, lon2)
    return R * math.acos(max(-1.0, min(1.0, float(np.dot(a, b)))))


def horizon(layers, lat_deg, lon_deg, masts=(2.0, 10.0), n_az=720, rays_per_bin=3,
            max_range_m=250_000.0, step0_m=None, chunk_bins=60):
    """Skyline elevation per azimuth bin for each mast height.

    Returns {"ground_m", "elev_deg": {mast: ndarray(n_az)}, "complete": bool, "max_range_km",
             "n_az", "step_deg", "rays_per_bin", "n_steps"}.
    'complete' is False when some ray left the DEM before max_range (the horizon is then a
    lower bound in that direction).
    """
    layers = list(layers)
    R = layers[0].R
    up, east, north = local_frame(lat_deg, lon_deg)
    ground = float(sample_layers(layers, *[np.array([c]) for c in up])[0])
    if math.isnan(ground):
        raise ValueError("site %.4f, %.4f is outside every DEM layer" % (lat_deg, lon_deg))
    step0 = step0_m if step0_m is not None else min(l.scale for l in layers) / 2.0
    dist = ray_distances(step0, max_range_m)
    theta = dist / R
    c, s = np.cos(theta), np.sin(theta)
    step_deg = 360.0 / n_az
    offsets = (np.arange(rays_per_bin) - (rays_per_bin - 1) / 2.0) * step_deg / rays_per_bin
    masts = [float(m) for m in masts]
    elev = {m: np.full(n_az, -90.0) for m in masts}
    complete = True
    for b0 in range(0, n_az, chunk_bins):
        bins = np.arange(b0, min(n_az, b0 + chunk_bins))
        az = np.radians((bins[:, None] * step_deg + offsets[None, :]).ravel())          # rays
        t = np.cos(az)[:, None] * north[None, :] + np.sin(az)[:, None] * east[None, :]   # rays x 3
        # points: rays x steps x 3
        p = c[None, :, None] * up[None, None, :] + s[None, :, None] * t[:, None, :]
        h = sample_layers(layers, p[..., 0], p[..., 1], p[..., 2])
        if np.isnan(h).any():
            complete = False
            h = np.where(np.isnan(h), -1e9, h)
        r1 = R + h
        for m in masts:
            e = np.arctan2(r1 * c[None, :] - (R + ground + m), r1 * s[None, :])
            best = e.max(axis=1).reshape(len(bins), rays_per_bin).max(axis=1)
            elev[m][bins] = np.degrees(best)
    return {"ground_m": ground, "elev_deg": elev, "complete": complete, "max_range_km": max_range_m / 1000.0,
            "n_az": n_az, "step_deg": step_deg, "rays_per_bin": rays_per_bin, "n_steps": len(dist)}


def sphere_dip_deg(h_m, R=R_MOON_M):
    """Horizon dip of a smooth sphere for an observer h metres above it (negative)."""
    return -math.degrees(math.acos(R / (R + h_m)))


if __name__ == "__main__":
    import sys
    import time

    lat, lon = (float(x) for x in (sys.argv[1:3] if len(sys.argv) >= 3 else ("-89.4632", "-137.4896")))
    dem = PolarDem.from_pds("data/LDEM_75S_120M.IMG", "data/LDEM_75S_120M.LBL")
    t0 = time.time()
    h = horizon([dem], lat, lon)
    print("site %.4f, %.4f: ground %.1f m, %d steps per ray, complete=%s, %.1f s" % (lat, lon, h["ground_m"], h["n_steps"], h["complete"], time.time() - t0))
    for m, e in h["elev_deg"].items():
        i = int(np.argmax(e))
        print("  mast %4.1f m: skyline %.2f .. %.2f deg (max at az %.1f), mean %.2f" % (m, e.min(), e.max(), i * h["step_deg"], e.mean()))
