# Skyfield (precompute/ephemeris.py) vs JPL Horizons, observer on the Moon

Site: Connecting Ridge, lat -89.4389, lon -137.1436 (east-positive), 1961.5 m above the 1737.4 km sphere (ground + 2 m mast).
Horizons: `CENTER='coord@301'`, `COORD_TYPE='GEODETIC'`, `SITE_COORD='-137.143570,-89.438910,1.961500'` (E-lon deg, lat deg, alt km),
`QUANTITIES='4'` (apparent azimuth and elevation, airless), times in UT via `TLIST`. Horizons header:

- Center geodetic: 222.85643, -89.43891, 1.9615    {E-lon(deg),Lat(deg),Alt(km)}
- Center pole/equ: MEAN_ME (high precision)        {East-longitude positive}
- Center radii: 1737.4, 1737.4, 1737.4 km       {Equator_a, b, pole_c}
- Center body name: Moon (301)                      {source: DE441}
- Center-site name: (user defined site below)
- Atmos refraction: NO (AIRLESS)

Skyfield: DE421 + moon_pa_de421_1900-2050.bpc, frame MOON_ME_DE421, `observe().apparent().altaz()`.

**Angular separation: median 0.0", max 0.1" over 12 body-samples** (1" = 0.00028°; the data file is rounded to 0.01° = 36"). Generated 2026-11-14 14:35Z.

| UTC | body | Skyfield alt | Skyfield az | Horizons el | Horizons az | Δalt " | Δaz·cos " | sep " |
|---|---|---|---|---|---|---|---|---|
| 2026-11-15T00:00:00Z | sun | 1.37894 | 251.56123 | 1.37895 | 251.56123 | -0.0 | -0.0 | 0.0 |
| 2027-01-01T00:00:00Z | sun | 1.44208 | 40.26701 | 1.44207 | 40.26702 | 0.0 | -0.0 | 0.0 |
| 2027-04-01T06:00:00Z | sun | -0.72958 | 21.99225 | -0.72958 | 21.99225 | 0.0 | -0.0 | 0.0 |
| 2027-07-01T12:00:00Z | sun | -0.30859 | 347.79950 | -0.30858 | 347.79951 | -0.0 | -0.0 | 0.0 |
| 2027-10-01T18:00:00Z | sun | 1.61615 | 301.03014 | 1.61616 | 301.03015 | -0.0 | -0.0 | 0.1 |
| 2028-02-29T23:00:00Z | sun | -1.06694 | 261.10466 | -1.06693 | 261.10466 | -0.0 | -0.0 | 0.0 |
| 2026-11-15T00:00:00Z | earth | -3.94638 | 134.49902 | -3.94639 | 134.49902 | 0.0 | -0.0 | 0.0 |
| 2027-01-01T00:00:00Z | earth | -6.70401 | 144.29342 | -6.70402 | 144.29343 | 0.0 | -0.0 | 0.0 |
| 2027-04-01T06:00:00Z | earth | -2.25936 | 135.86599 | -2.25936 | 135.86599 | 0.0 | -0.0 | 0.0 |
| 2027-07-01T12:00:00Z | earth | 5.66514 | 131.37890 | 5.66512 | 131.37890 | 0.0 | -0.0 | 0.1 |
| 2027-10-01T18:00:00Z | earth | -7.24502 | 142.84740 | -7.24502 | 142.84741 | 0.0 | -0.0 | 0.0 |
| 2028-02-29T23:00:00Z | earth | 6.11091 | 131.05197 | 6.11090 | 131.05198 | 0.0 | -0.0 | 0.0 |

Raw Horizons responses: `validation/horizons_raw/sun.txt`, `validation/horizons_raw/earth.txt`.
