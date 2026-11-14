# precompute/

Offline Python pipeline (run from the repo root with the `.venv`): Sun/Earth angles and terrain
horizons per site → `web/data/navigator-data.{json,js}` in the format of `docs/data-contract.md`.
Reads raw data from `data/` (gitignored, filled by `scripts/download_data.py`).

| File | Role |
|---|---|
| `ephemeris.py` | Skyfield + DE421, frame `MOON_ME_DE421`: apparent alt/az and angular diameter of Sun and Earth from a surface point |
| `horizon.py` | Terrain horizon: 720 bins × max of 3 rays, bilinear DEM sampling, 250 km, exact spherical elevation; `PolarDem` reads the LOLA PDS `.IMG` and the PGDA 5 m GeoTIFFs; several layers, finest first |
| `pds_label.py` | PDS3 label reader (DEM geometry comes from the label, never from the file size) |
| `sites.json` | The five analysed sites: id, name, PGDA tile, coordinates and their `coord_source` |
| `pick_sites.py` | Site rules from `sites.json` ("pick": summit, rim-crest, fixed); `--write` updates coordinates and `coord_source` |
| `build.py` | The one writer of `web/data/navigator-data.{json,js}`; prints per-site statistics and file sizes |
| `analyze_windows.py` | Landing windows under the app rule and the simple rule, 21-day slip check |
| `slip_table.py` | "Launch slipped" table: flip dates, reason, alternative sites, next window, demo candidates |
| `earth_events.py` | Exact Earthrise/Earthset and sunrise/sunset times around given dates (hourly flags refined to the minute) |
| `sun_behind_terrain.py` | Periods when the Sun is above the horizontal but hidden by terrain, with the blocking terrain's distance |
| `tests/test_horizon.py` | Flat sphere, ring and east walls, two-layer near-field step, Shackleton floor, Malapert bearing |

```text
.venv/Scripts/python.exe scripts/download_data.py          # kernels, LDEM_75S_120M, five 5 m tiles
.venv/Scripts/python.exe -m pytest -s precompute/tests      # must pass before any real run
.venv/Scripts/python.exe -m precompute.pick_sites --write
.venv/Scripts/python.exe -m precompute.build
.venv/Scripts/python.exe -m precompute.slip_table --mast 2
```
