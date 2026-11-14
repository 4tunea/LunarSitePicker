# Data contract: precompute → frontend

Status: **DRAFT v1.0, not yet approved.** Nothing builds on this until it is approved.

`precompute/` writes **one file** that the frontend loads. It ships **angles, not
verdicts**. It contains terrain horizons and Sun/Earth positions. It has **no**
"available" / "visible" flags. The browser derives visibility so that thresholds stay
user-settable and the slip search runs on the client.

## 1. Files

| File | Content | Why |
|---|---|---|
| `web/data/navigator-data.json` | The JSON object below | For tools, tests and HTTP hosting |
| `web/data/navigator-data.js`   | `var NAV_DATA = <same JSON>;` | The app is opened as `file://`, where `fetch()` of local JSON is blocked. Load it with a `<script>` tag, the same way as `horizons.js` today. |

Both are generated. Never edit them by hand. They are small (see §6) and are committed
so the static site works without running Python.

## 2. Conventions (apply to every field)

| Quantity | Convention |
|---|---|
| Angles | Degrees unless the field name says otherwise |
| Azimuth | 0 = local north, increasing **clockwise** (east = 90, south = 180, west = 270). Range [0, 360). "North" means the direction of increasing latitude along the local meridian. At south-pole sites this points **away** from the pole. |
| Altitude / elevation angle | Degrees above the local horizontal plane. The horizontal plane is perpendicular to the radius vector through the site (spherical Moon, R = 1737.4 km). Negative = below the horizontal. |
| Latitude | Planetocentric, degrees, south negative, MOON_ME (DE421) frame |
| Longitude | **East-positive**, degrees, range **[-180, 180)**, MOON_ME (DE421) frame |
| Heights | Metres. Terrain heights are relative to the 1737.4 km reference sphere. |
| Distances | km (e.g. `max_range_km`) |
| Time | **UTC**, ISO 8601 with `Z` (e.g. `2027-01-01T00:00:00Z`). Times are not stored per sample (see §4). |
| Refraction | None anywhere (the Moon has no atmosphere) |
| Missing value | `null` (should not occur for the 5 analysed sites) |

### Horizon azimuth bins
- 720 bins, 0.5° apart. **Bin `i` is centred on azimuth `i × 0.5°`** and represents
  [i×0.5 − 0.25, i×0.5 + 0.25). Bin 0 is centred on north (0°) and covers 359.75–0.25.
- Each value is the terrain elevation angle of a ray cast **exactly at the bin centre**
  (not the maximum over the bin; see "Open questions").
- Lookup at an arbitrary azimuth `az`: interpolate linearly between bins
  `floor(az/0.5) mod 720` and the next bin. Wrap 719 → 0.

### Ephemeris
- Sun and Earth positions are **apparent** topocentric positions: light-time and stellar
  aberration are applied, with no refraction. This matches JPL Horizons quantity 4
  (apparent Az/El), which we validate against.
- The observer is at the site's DEM ground height. Mast height is ignored for the
  ephemeris, because 10 m moves the Earth by < 0.00001°. Mast height only affects the
  terrain horizon.
- Reference: Skyfield, DE421 + `moon_pa_de421_1900-2050.bpc`, frame `MOON_ME_DE421`.

## 3. Top-level schema

```text
{
  "schema_version": "1.0",
  "fake": false,                      // true only in fake example/fixture data
  "generated_utc": "2026-11-14T15:00:00Z",
  "generator": "precompute/build.py, git <short-sha>",
  "constants": {
    "moon_radius_km": 1737.4
  },
  "ephemeris": {
    "software": "Skyfield 1.55",
    "kernels": ["de421.bsp", "moon_080317.tf", "pck00008.tpc", "moon_pa_de421_1900-2050.bpc"],
    "frame": "MOON_ME_DE421",
    "corrections": "apparent (light-time + aberration), no refraction"
  },
  "time": {
    "start_utc": "2027-01-01T00:00:00Z",
    "step_s": 3600,
    "count": 8760                     // 365 days × 24 h; 2027 is not a leap year
  },
  "horizon_grid": {
    "n_az": 720,
    "step_deg": 0.5,
    "bin0_center_deg": 0.0,
    "sampling": "single ray at bin centre"
  },
  "bodies": {                         // shared by all sites (see §5)
    "sun":   { "diam_deg": [8760 numbers] },
    "earth": { "diam_deg": [8760 numbers] }
  },
  "sites": [ Site, ... ]              // the 5 analysed sites, fixed order
}
```

### Site

```text
{
  "id": "connecting-ridge",           // stable, lowercase, hyphenated
  "name": "Connecting Ridge",
  "pgda_site": "Site01",              // PGDA LOLA_5mpp site label, or null
  "terrain": "dem",                   // "dem" | "sphere-only"
  "lat_deg": -89.45,                  // see §2
  "lon_deg": -137.31,
  "ground_elev_m": 1954.0,            // DEM height at the site, relative to 1737.4 km
  "coord_source": {
    "kind": "dem-metadata",           // "dem-metadata" | "paper"
    "ref": "PGDA LOLA_5mpp Site01 README",  // or e.g. "Mazarico et al. 2011, Icarus 211, Table 2"
    "note": ""                         // anything non-obvious, e.g. "centre of DEM tile"
  },
  "dem": [
    { "file": "Site01_final_adj_5mpp_surf.tif", "role": "near-field", "resolution_m": 5,   "extent_km": 16 },
    { "file": "LDEM_75S_120M.IMG",             "role": "far-field",  "resolution_m": 120, "extent_km": 914.9 }
  ],
  "horizons": [
    { "mast_height_m": 2,  "max_range_km": 150, "elev_deg": [720 numbers] },
    { "mast_height_m": 10, "max_range_km": 150, "elev_deg": [720 numbers] }
  ],
  "sun":   { "alt_deg": [8760 numbers], "az_deg": [8760 numbers] },
  "earth": { "alt_deg": [8760 numbers], "az_deg": [8760 numbers] }
}
```

The `dem[].file` names above are placeholders. The real PGDA file names are verified in step 2.

## 4. Time series

- Sample `k` (0-based) is at time `start_utc + k × step_s`, so times are not stored.
  2027-01-01T00:00Z is k = 0, and the last sample is 2027-12-31T23:00Z (k = 8759).
- Hourly. Between samples the frontend interpolates **linearly**. For azimuth it must
  unwrap across 360/0, e.g. 359.8 → 0.3 is +0.5°, not −359.5°.
- The Sun's azimuth at these latitudes moves ≈ 0.51°/h, about one horizon bin per hour.
  Linear interpolation gives sunrise/sunset times to within minutes. This needs to be
  confirmed once real data exists.
- End of data: a 14-day window that starts after 2027-12-17T23:00Z runs past the last
  sample. The frontend must show this rather than extrapolate.

## 5. Sun and Earth angular diameters

The frontend reads these from `bodies.*.diam_deg[k]`. **It must not hard-code them.**

| Body | Typical | Range in 2027 (expected) | Stored as |
|---|---|---|---|
| Sun | 0.533° | ≈ 0.524–0.542° (Earth–Sun distance varies) | hourly series, 3 decimals |
| Earth | 1.90° | ≈ 1.80–2.05° (Earth–Moon distance 356–407 thousand km) | hourly series, 3 decimals |

- Diameters are stored as series, not constants. Earth's diameter varies by about ±7%,
  which matters at the edge of the disc.
- They are stored **once** (topocentric from Connecting Ridge), not per site. Between the
  5 south-pole sites the difference is < 0.0001°.
- Diameters use IAU nominal radii: Sun 695,700 km, Earth 6,371.0 km (mean).

## 6. Encoding and size

- **Plain JSON number arrays.** No base64 or binary, so it can be debugged by eye.
- Alt/az and horizon values are rounded to **2 decimals** (0.01°; max quantisation error
  0.005°, well below horizon/DEM uncertainty). Diameters are rounded to **3 decimals**.
- Measured on fake data of the real shape (8760 h, 720 bins × 2 masts):

  | | Size |
  |---|---|
  | Per site | ≈ 205 KB |
  | Total (5 sites + shared diameters) | ≈ 1.1 MB |
  | Gzipped (as GitHub Pages / Vercel serve it) | ≈ 0.3 MB |

- This is under the ~3 MB budget, so no reduction is needed. If we add sites or a second
  year, these are the options, in order:
  1. Drop to 1 decimal for azimuth beyond ±30 days of the demo dates (≈ −10%).
  2. int16 (alt, hundredths) / uint16 (az, hundredths: 0–35999 does not fit int16)
     little-endian arrays, base64-encoded (≈ 0.5 MB total for 5 sites).
  3. One file per site, loaded on demand.

## 7. How the frontend derives visibility (reference formulas)

These are **not** in the file. They are defined here so every consumer computes the same
thing.

```text
h(az)      = horizon elevation at az for the chosen mast (interpolated, §2)
r          = diam_deg[k] / 2
x          = clamp((alt - h(az)) / r, -1, 1)
fraction   = 1 - (acos(x) - x*sqrt(1 - x*x)) / PI      // share of disc above the horizon line
centre_vis = alt > h(az)
```

Suggested user settings, all with visible UI controls: required Sun fraction (default 0.5,
i.e. centre above horizon), required Earth clearance (default 0°), mast height (2 or 10 m).
"Available" = Sun condition AND Earth condition.

The fraction formula treats the horizon as flat across the disc. Earth's disc spans
~4 bins (§9).

## 8. Example (FAKE numbers, for building the UI only)

**Every number below is invented.** The arrays are shortened to 4 entries for
readability. Real arrays have 720 (horizon) and 8760 (time series) entries. On request,
a full-shape fake fixture (`web/data/navigator-data.fake.js`, `"fake": true`) can be
generated so the UI can be tested at real sizes.

```json
{
  "schema_version": "1.0",
  "fake": true,
  "_comment": "FAKE DATA. Shapes shortened. Do not use for any result.",
  "generated_utc": "2026-11-14T15:00:00Z",
  "generator": "hand-written example",
  "constants": { "moon_radius_km": 1737.4 },
  "ephemeris": {
    "software": "Skyfield 1.55",
    "kernels": ["de421.bsp", "moon_080317.tf", "pck00008.tpc", "moon_pa_de421_1900-2050.bpc"],
    "frame": "MOON_ME_DE421",
    "corrections": "apparent (light-time + aberration), no refraction"
  },
  "time": { "start_utc": "2027-01-01T00:00:00Z", "step_s": 3600, "count": 4 },
  "horizon_grid": { "n_az": 4, "step_deg": 90.0, "bin0_center_deg": 0.0, "sampling": "single ray at bin centre" },
  "bodies": {
    "sun":   { "diam_deg": [0.542, 0.542, 0.542, 0.542] },
    "earth": { "diam_deg": [1.873, 1.874, 1.874, 1.875] }
  },
  "sites": [
    {
      "id": "connecting-ridge",
      "name": "Connecting Ridge",
      "pgda_site": "Site01",
      "terrain": "dem",
      "lat_deg": -89.45,
      "lon_deg": -137.31,
      "ground_elev_m": 1954.0,
      "coord_source": { "kind": "dem-metadata", "ref": "FAKE", "note": "fake example" },
      "dem": [
        { "file": "FAKE_near.tif", "role": "near-field", "resolution_m": 5, "extent_km": 16 },
        { "file": "FAKE_far.IMG", "role": "far-field", "resolution_m": 120, "extent_km": 914.9 }
      ],
      "horizons": [
        { "mast_height_m": 2,  "max_range_km": 150, "elev_deg": [0.41, -0.62, 1.37, 0.05] },
        { "mast_height_m": 10, "max_range_km": 150, "elev_deg": [0.38, -0.71, 1.33, 0.01] }
      ],
      "sun":   { "alt_deg": [1.12, 1.09, 1.05, 1.02], "az_deg": [358.9, 359.41, 359.92, 0.43] },
      "earth": { "alt_deg": [4.83, 4.85, 4.88, 4.90], "az_deg": [42.17, 42.21, 42.25, 42.30] }
    }
  ]
}
```

## 9. Known limitations

- **No atmospheric refraction.** This is correct for the Moon, not a simplification.
- **Horizon accuracy is limited by the DEMs.** The near field (≈ ±8 km) uses 5 m/px
  PGDA tiles. Beyond that it uses the 120 m/px LDEM_75S. Ridges narrower than a few
  pixels in the far field are smoothed out. Boulders and the lander itself are not
  represented. Interpolation errors at the 5 m / 120 m seam are possible.
- **Range cut at 150 km.** Terrain beyond 150 km is ignored. At the pole, distant
  massifs can still matter for grazing Sun angles. To be checked by comparing 150 vs
  250 km on one site.
- **Horizon sampled at the bin centre**, every 0.5°. A peak narrower than 0.5° between
  centres can be missed.
- **Disc model is approximate.** The visible fraction assumes a flat horizon across the
  disc. Earth (~1.9°) spans ~4 bins, so the error is largest where the skyline is steep.
- **Hourly ephemeris** with linear interpolation. Event times are approximate to minutes.
- **One year only** (2027). Dates outside it have no data.
- **Sphere-only sites.** Sites outside the 75°S DEM (Apollo, Chang'e, Chandrayaan-3, …)
  have no terrain. They are **not in this file** in v1. If added later they get
  `"terrain": "sphere-only"`, `dem: []`, and a horizon equal to the smooth-sphere dip
  `-acos(R/(R+h_mast))` (≈ −0.087° at 2 m, −0.194° at 10 m). The UI must label them as such.
- **Spherical Moon.** "Horizontal" uses the radius vector of a 1737.4 km sphere,
  consistent with the LOLA DEMs.
- **Ephemeris accuracy** is bounded by DE421 and the lunar orientation model. The
  measured difference to JPL Horizons will be in `validation/`.

## 10. Site list (v1)

| id | name | PGDA label | Coordinates |
|---|---|---|---|
| `connecting-ridge` | Connecting Ridge | Site01 | TBD in step 2 |
| `shackleton-rim` | Shackleton Rim | Site04 | TBD in step 2 |
| `malapert-massif` | Malapert Massif | TBD (CLAUDE.md says Site23, unverified) | TBD |
| `haworth` | Haworth | TBD | TBD |
| `nobile-rim-2` | Nobile Rim 2 | TBD | TBD |

The old `sites.js` id `shackleton` (named "Shackleton connecting ridge") maps to
**`connecting-ridge`**. `shackleton-rim` is a different site. `sites.js` is a frontend
file and is not changed by precompute; mapping old ids is up to the frontend owner.
