# How the numbers were checked

Everything the Navigator shows comes from one data file (`web/data/navigator-data.js`) written
offline by `precompute/build.py`. This page lists the checks behind it. All comparison scripts and
their raw outputs are in this folder and can be re-run.

## 1. Sun and Earth positions vs JPL Horizons

Our positions: Skyfield 1.55 with the JPL DE421 ephemeris and the DE421 lunar orientation
(`moon_pa_de421_1900-2050.bpc`), frame `MOON_ME_DE421`, apparent (light-time and aberration, no
refraction, the Moon has no atmosphere). Reference: the JPL Horizons system, observer on the Moon
(`CENTER='coord@301'`, geodetic site in east longitude / latitude / altitude km, quantity 4 =
apparent azimuth and elevation). Site: Connecting Ridge, 89.4389 S, 137.1436 W, 1961.5 m above the
1737.4 km sphere.

| UTC | Body | Skyfield alt | Skyfield az | Horizons el | Horizons az | Difference |
|---|---|---|---|---|---|---|
| 2026-11-15 00:00 | Sun | 1.37894° | 251.56123° | 1.37895° | 251.56123° | 0.0″ |
| 2027-01-01 00:00 | Sun | 1.44208° | 40.26701° | 1.44207° | 40.26702° | 0.0″ |
| 2027-04-01 06:00 | Sun | −0.72958° | 21.99225° | −0.72958° | 21.99225° | 0.0″ |
| 2027-07-01 12:00 | Sun | −0.30859° | 347.79950° | −0.30858° | 347.79951° | 0.0″ |
| 2027-10-01 18:00 | Sun | 1.61615° | 301.03014° | 1.61616° | 301.03015° | 0.1″ |
| 2028-02-29 23:00 | Sun | −1.06694° | 261.10466° | −1.06693° | 261.10466° | 0.0″ |
| 2026-11-15 00:00 | Earth | −3.94638° | 134.49902° | −3.94639° | 134.49902° | 0.0″ |
| 2027-01-01 00:00 | Earth | −6.70401° | 144.29342° | −6.70402° | 144.29343° | 0.0″ |
| 2027-04-01 06:00 | Earth | −2.25936° | 135.86599° | −2.25936° | 135.86599° | 0.0″ |
| 2027-07-01 12:00 | Earth | 5.66514° | 131.37890° | 5.66512° | 131.37890° | 0.1″ |
| 2027-10-01 18:00 | Earth | −7.24502° | 142.84740° | −7.24502° | 142.84741° | 0.0″ |
| 2028-02-29 23:00 | Earth | 6.11091° | 131.05197° | 6.11090° | 131.05198° | 0.0″ |

Largest difference 0.1 arcsecond (0.00003°). The data file stores angles to 0.01°, so the
ephemeris is not a source of error. Details: `horizons_vs_skyfield.md`, raw responses in
`horizons_raw/`.

## 2. Cross-check against an independent implementation

The 3D surface view carries its own Skyfield-based ephemeris (daily vectors from the Moon's
centre, interpolated and parallax-corrected in the browser, `web/moonsky/`). At 10 random times
between Nov 2026 and Feb 2028 and random points south of 80° S, the two implementations agree to
a median of 1.8″ and a maximum of 4.4″ (`moonsky_vs_skyfield.md`). The app's shortcut for points
that are not in the file (rebuilding the Sun direction and Earth position from the first site's
angles) was compared with direct calculations 1 km and 50 km away: it is exact apart from the
file's 0.01° rounding (maximum 0.007°).

## 3. Terrain horizon tests

The skyline is computed from LOLA elevation models: the PGDA 5 m/px tile of each site in the
near field and the 120 m/px LDEM_75S_120M beyond it, 720 azimuth bins of 0.5°, the maximum of 3
rays per bin, out to 250 km, bilinear sampling, exact spherical geometry with curvature, no
refraction, observer 2 m or 10 m above the ground. Tests run before every real run
(`precompute/tests/test_horizon.py`, 6 passed):

| Test | Result | Expected |
|---|---|---|
| Flat sphere, 2 m / 10 m mast | −0.0869° / −0.1944°, identical in all directions | −acos(R/(R+h)) = −0.0869° / −0.1944° |
| Ring wall 1500 m high at 20 km | 3.943° | 3.952° analytic |
| Wall only to the east | seen at azimuth 90°, visible span centred on 90.0°, nothing at 0° or 270° | 16.1°–163.9° span |
| 5 m layer over 120 m grid: 20 m step 500 m east | 2.043° (2 m), 1.132° (10 m); absent without the 5 m layer | 2.054°, 1.138° |
| Real DEM: Shackleton crater floor | −2787.4 m, rim 19.8–23.6° above the floor all round | about −2787 m |
| Real DEM: Malapert massif from 46 km south | skyline at the summit bearing 10.67° ≥ 9.95° (summit alone) | lower bound |

## 4. Illumination vs the literature

Barker et al. (2021), *Planetary and Space Science* 203, 105119, Table 2, give for the Connecting
Ridge (their Site 1) regions of interest, over 2024-01-01 to 2026-01-01: average illumination
(mean visible fraction of the Sun's disc) 68–70 % (region average) to 86 % (best pixel) at 1 m
above the surface and 88.5–89.3 % to 91.2–91.8 % at 5 m; longest continuous shadow 10.5–17.8 days
at 1 m and 3.7–7.3 days at 5 m. Our pipeline, at their RoI 1 centroid and over Nov 2026 to Feb
2028, gives 84.1 % and 93.2 % average illumination and 11.9 and 3.9 days of longest shadow at 1 m
and 5 m. This is consistent with their results; the remaining differences are expected from the
different years (the Sun's declination and the 18.6-year precession change the pattern), a single
point versus a region average, and the DEM release used. Mazarico et al. (2011) could not be
opened and is not quoted. Details: `barker2021_vs_ours.md`.

## 5. Data sources

| Data | Source |
|---|---|
| Planetary ephemeris DE421 | https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/a_old_versions/de421.bsp |
| Lunar orientation (DE421 Euler angles), frame and constants kernels | https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/moon_pa_de421_1900-2050.bpc, `.../fk/satellites/moon_080317.tf`, `.../pck/a_old_versions/pck00008.tpc` |
| Far-field elevation, 120 m/px, 75–90° S | LRO LOLA LDEM_75S_120M, https://imbrium.mit.edu/DATA/LOLA_GDR/POLAR/IMG/ (also pds-geosciences.wustl.edu) |
| Near-field elevation, 5 m/px, per site | NASA GSFC PGDA, https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/ (Site01, Site04, Site23, Haworth, DM2), Barker et al. 2021 |
| Reference positions | JPL Horizons API, https://ssd-api.jpl.nasa.gov/doc/horizons.html |
| Software | Skyfield 1.55, NumPy, rasterio; Python 3.13 |

Site coordinates are derived from the tiles (highest point of the tile; for Shackleton Rim the
highest point on the rim crest), recorded with their rule in `precompute/sites.json`. They are
candidate points for comparing sites, not published landing coordinates.

## 6. Known limitations

- Horizon accuracy is limited by the elevation models: 5 m pixels within about 8–15 km of each
  site, 120 m beyond; terrain beyond 250 km is ignored; a peak narrower than about 0.17° of
  azimuth can be missed; boulders and the lander are not modelled.
- Visibility uses the fraction of a body's disc above a locally flat skyline; Earth's disc spans
  about four azimuth bins.
- Positions are hourly and interpolated linearly in between, so rise and set times in the app are
  accurate to minutes, and the app's own verdict changes on the hour.
- The data covers 2026-11-01 to 2028-02-29 only.
- A spherical Moon of 1737.4 km defines "horizontal", consistent with the LOLA products.
- The PGDA tiles are 16–30 km wide; the Nobile Rim 2 summit lies on its tile's edge, so the true
  high point may be outside the tile.
