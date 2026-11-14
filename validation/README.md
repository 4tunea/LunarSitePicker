# validation/

Static comparisons of our numbers with independent references. Results are committed so the
project page can show them without running anything.

| Script | Reference | Result files |
|---|---|---|
| `validate_horizons.py` | JPL Horizons API, observer on the Moon (`coord@301`, geodetic E-lon/lat/alt km, quantity 4 apparent az/el), Sun and Earth at 6 timestamps | `horizons_vs_skyfield.{csv,md}`, raw responses in `horizons_raw/` |
| `compare_moonsky.py` | The surface view's own Skyfield-based ephemeris (`web/moonsky/ephem/`), 10 random times and points | `moonsky_vs_skyfield.{csv,md}` |
| `check_app_rebuild.py` | Direct Skyfield calculation vs the app's "rebuild Sun/Earth from the first site" shortcut at 1 km and 50 km | printed |
| `compare_barker2021.py` | Barker et al. (2021), PSS 203, Table 2: Site 1 illumination at Δz = 1 m and 5 m (NTRS accepted manuscript) | `barker2021_vs_ours.md` |

```text
.venv/Scripts/python.exe validation/validate_horizons.py      # site = first site of web/data/navigator-data.json
.venv/Scripts/python.exe validation/compare_moonsky.py
.venv/Scripts/python.exe validation/check_app_rebuild.py
.venv/Scripts/python.exe validation/compare_barker2021.py
```
