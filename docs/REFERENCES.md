# Data sources and references

Every external dataset, service and publication the project actually uses, with the URL the
code downloads it from, the local file name, and where it is used. Entries are taken from
`scripts/download_data.py`, `web/tools/*.py`, `web/tools/make_fake_data.js`, `app.js`,
`globe.js` and the `validation/` scripts. Where a source is not recorded in the repository it is
marked **unknown** rather than guessed. Written 2026-11-14.

## NASA and JPL sources

| Source | Exact URL (as in the code) | Local file(s) | Used by |
|---|---|---|---|
| JPL planetary ephemeris DE421 (NAIF generic kernels) | https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/a_old_versions/de421.bsp | `data/de421.bsp` | `precompute/ephemeris.py` (Skyfield, all Sun/Earth angles in `web/data/navigator-data.*`), `web/tools/build_moonsky_data.py` (surface-view ephemeris `web/moonsky/ephem/*.js`), `validation/` |
| Lunar frame kernel | https://naif.jpl.nasa.gov/pub/naif/generic_kernels/fk/satellites/moon_080317.tf | `data/moon_080317.tf` | same (frame `MOON_ME_DE421`) |
| Planetary constants kernel | https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/a_old_versions/pck00008.tpc | `data/pck00008.tpc` | same |
| DE421 lunar orientation (Euler angles) | https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/moon_pa_de421_1900-2050.bpc | `data/moon_pa_de421_1900-2050.bpc` | same (libration comes from this kernel) |
| LRO LOLA gridded DEM, south pole 75–90° S, 120 m/px, polar stereographic | https://imbrium.mit.edu/DATA/LOLA_GDR/POLAR/IMG/LDEM_75S_120M.IMG and `.LBL` (mirror: https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img/ldem_75s_120m.img) | `data/LDEM_75S_120M.IMG`, `data/LDEM_75S_120M.LBL` | far-field terrain horizon in `precompute/horizon.py` (analysed sites); coarse 720 m grid `web/data/terrain-lowres.js` via `web/tools/build_terrain.py` (pins and past landings); polar relief in `web/data/moon-relief.js` via `web/tools/build_relief.py`; the fake fixture via `web/tools/make_fake_data.js`; the legacy `build_data.py` (not loaded by the page) |
| LRO LOLA global DEM, 16 px/deg (about 1.9 km) | https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/ldem_16.img | `data/LDEM_16.IMG` (not kept in the repo) | surface-view terrain tiles `web/moonsky/dem/*.js` via `web/tools/build_moonsky_data.py`; global relief in `web/data/moon-relief.js` via `web/tools/build_relief.py` (read back from the committed tiles) |
| NASA GSFC PGDA "LOLA_5mpp" south-pole DEM tiles, 5 m/px (Barker et al. 2021) | https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/`<label>`/`<label>`_final_adj_5mpp_surf.tif for `Site01`, `Site04`, `Site23`, `Haworth`, `DM2`; README at https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/ | `data/<label>_final_adj_5mpp_surf.tif` (five files, 359 MB) | near-field terrain horizon in `precompute/horizon.py`; the analysed site coordinates in `precompute/sites.json` are the highest point of each tile (rule and pixel recorded per site) |
| NASA SVS "CGI Moon Kit" colour map (LRO LROC), 4096 × 2048 | https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_16bit_srgb_4k.tif (SVS entry 4720) | `data/lroc_color_16bit_srgb_4k.tif` → `moon-texture.js` (JPEG data URL, committed) | the globe's surface colour (`globe.js`, loaded by `app.js`) |
| NASA SVS CGI Moon Kit, 2k JPEG (legacy) | https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_2k.jpg | `data/moon_2k.jpg` | the legacy `build_data.py` only; not loaded by the page |
| NASA Moon Trek tile service, LRO WAC global mosaic 303 ppd v02 | https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/default/default028mm/{z}/{row}/{col}.jpg | none (streamed at run time, online only) | sharper imagery when the globe is zoomed in (`app.js` `liveTiles`, `globe.js` LOD), between 72° N and 72° S |
| NASA Blue Marble (SVS entry 2915), Earth texture | https://svs.gsfc.nasa.gov/vis/a000000/a002900/a002915/bluemarble-2048.png, fallback https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57752/land_shallow_topo_2048.jpg | `data/earth_src.img` → `web/moonsky/earth.js` (512 × 256 JPEG data URL) | Earth's disc in the 3D surface view. **Which of the two URLs produced the committed file is unknown**: the generated file does not record it |
| JPL Horizons system (API) | https://ssd.jpl.nasa.gov/api/horizons.api (documentation https://ssd-api.jpl.nasa.gov/doc/horizons.html) | `validation/horizons_raw/sun.txt`, `earth.txt` | reference positions for `validation/validate_horizons.py` → `validation/horizons_vs_skyfield.{csv,md}`; not used by the page |
| NASA NTRS: Barker, M. K., et al. (2021), "Improved LOLA elevation maps for south pole landing sites: Error estimates and their impact on illumination conditions", *Planetary and Space Science* 203, 105119 (accepted manuscript) | https://ntrs.nasa.gov/citations/20205009660 | none | `validation/compare_barker2021.py` → `validation/barker2021_vs_ours.md` (illumination cross-check, Table 2); the PGDA tile set it describes |
| Published landing coordinates of 27 past missions | **unknown exact source**: `web/data/past-landings.js` states "published landing coordinates (LROC images of the landers, NASA NSSDCA), rounded to 0.01°", with no URL or per-mission citation recorded | `web/data/past-landings.js` | reference points in the site list. To be confirmed by the file's author (see `README.md`, "Use of AI tools") |

## Non-NASA sources

| Source | Exact URL (as in the code) | Local file(s) | Used by |
|---|---|---|---|
| Yale Bright Star Catalogue, 5th ed. (BSC5), Harvard-Smithsonian CfA TDC mirror | http://tdc-www.harvard.edu/catalogs/bsc5.dat.gz | `data/bsc5.dat.gz` → `web/moonsky/stars.js` (stars V ≤ 5.5) | star field in the 3D surface view and behind the globe |
| Skyfield 1.55 (Brandon Rhodes), with the kernels above | https://rhodesmill.org/skyfield/ (installed from PyPI via `requirements.txt`) | `.venv` | reference ephemeris for everything (`precompute/ephemeris.py`, `web/tools/build_moonsky_data.py`, `validation/`) |
| NumPy 2.5.4, rasterio 1.5.2 (GeoTIFF reading), pyproj 3.8.0, requests 2.34.2, Pillow 13.0.0, pytest 9.2.0 (`requirements.txt`); Python 3.13; Node.js for the JavaScript tools | PyPI / nodejs.org | `.venv`, `requirements.txt` | pipeline, tools and tests |
| Meeus, J., *Astronomical Algorithms* (2nd ed.), ch. 25, 47, 53 | book | `ephem.js` | the legacy truncated-Meeus ephemeris, used only by `web/tools/make_fake_data.js` for the fake fixture; not loaded by the page |

## Not used

- Mazarico et al. (2011) is named in `CLAUDE.md` as a possible coordinate source; `validation/SUMMARY.md` records that it could not be opened and is not quoted. No coordinate in the repository comes from it.
- No web fonts or external style sheets: `style.css` uses system fonts and no `url()`; the only external request at run time is the Moon Trek tile service above.

## Derived files committed in the repository

| File | Built by | From |
|---|---|---|
| `web/data/navigator-data.{js,json}` | `precompute/build.py` | DE421 kernels, LDEM_75S_120M, the five PGDA tiles |
| `web/data/terrain-lowres.js` | `web/tools/build_terrain.py` | LDEM_75S_120M |
| `web/data/moon-relief.js` | `web/tools/build_relief.py` | LDEM_16 (via `web/moonsky/dem`), LDEM_75S_120M |
| `web/moonsky/meta.js`, `ephem/*.js`, `dem/*.js`, `stars.js`, `earth.js` | `web/tools/build_moonsky_data.py` | DE421 kernels, LDEM_16, BSC5, Blue Marble |
| `moon-texture.js` | `web/tools/build_texture.py` | SVS CGI Moon Kit 4k colour map |
| `web/data/navigator-data.fake.{js,json}` (not loaded) | `web/tools/make_fake_data.js` | LDEM_75S_120M, `ephem.js` |
