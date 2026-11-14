# Lunar Site Navigator

A planning tool for the "launch slipped, can we still land?" question. Set the planned
landing date and the stay, drag the launch-slip slider, and watch which sites still work.
Open a site that stops working and the tool offers two ways out: switch to a site that
works on the new date, or land later at the same site. Compare any set of sites side by side.

## Run it

Double-click `index.html`. No server and no build step. It works offline, except for the
sharper zoom imagery, which streams from NASA Moon Trek.

## Where the numbers come from

The page reads `web/data/navigator-data.js` (format: `docs/data-contract.md`), written by
`precompute/build.py` from Skyfield/DE421 and NASA LOLA terrain. Visibility is derived in the
browser (contract section 7): the share of the Sun's disc above the skyline, and Earth's centre
above the skyline, for the chosen mast height. A site counts as available for a landing date
when the Sun and Earth are both visible at landing and for at least half of the stay. All
these rules can be edited under **Technical**.

## Using it

- **Setup** (opens by itself on the first visit): a 5-step guided setup. Pick a mission type (robotic lander, crewed stay,
  long-duration, or custom), the dates, the requirements in plain language, and the sites, then review a live preview
  ("4 of 7 sites available") and finish by showing the list, opening the best site, or comparing your picks.
- **Top bar**: planned landing, launch slip (drag, or the arrow keys), stay in days,
  **Compare**, and **Technical**.
- **Left list**: every site, available ones first and ranked: the analysed south-pole sites,
  27 past landings and your own pins. Filter chips: All, South pole, Past landings, My pins.
- **Add a pin**: type a latitude and longitude, or double-click the Moon. Pins stay until the
  page is reloaded, so you can compare them.
- **Moon**: drag to turn (with a little inertia), scroll, pinch or use + / − to zoom, **S** to
  fly to the south pole. The Moon is lit by the real Sun for the landing time, shows LOLA
  terrain relief and sits in front of the real star map. Zooming in loads sharper NASA imagery
  for the area in view (between 72° N and 72° S; the poles use the LOLA 120 m polar relief).
- **Site view**: the info panel is on the left. Switch between **3D horizon** (default) and
  **2D horizon**:
  - 3D: a first-person view from the site, to the right of the panel. Drag the divider to
    resize the panel. Sun and Earth paths cover the whole timeline: solid above the skyline,
    dashed behind terrain, and bright during the stay. The Sun and Earth get a dashed outline
    when terrain hides them.
  - 2D: one full-width panel with the unrolled 360° skyline and the Sun and Earth paths.
  - **Show Earth** (next to the 3D/2D switch) hides or shows Earth, its path and its labels in both views.
- **In a site**: Sun and Earth elevation, time to sunset/sunrise and Earthset/Earthrise, share
  of the stay with both, longest dark stretch, the timeline (Play or Space animates it), the
  **landing-date explorer** (every landing day in the data; click one to land then), and a
  plain-language "why it works this way".
- **Compare**: press Compare, pick 2–6 sites on the Moon or in the list, then press Compare in
  the bar. The table names the better site and why, with the best value in each row marked.
- **Technical**: Moon data, availability rules, the full site table, per-site angles and
  charts, and the display settings for the Moon and the 3D horizon.

## Three kinds of site

| Kind | Sun and Earth angles | Skyline |
|---|---|---|
| Analysed (in the data file) | from the file | from the file (LOLA 5 m + 120 m) |
| Past landings and pins south of 80° S | derived in the browser from the first analysed site's angles | coarse 720 m grid (`web/data/terrain-lowres.js`) |
| Everything else | derived the same way | smooth sphere (no atmosphere, so no refraction) |

Derived angles were checked against the file for the other analysed sites: they agree to 0.01°.

## Use of AI tools

NASA Space Apps asks teams to say where AI was used. This project was written with AI coding
assistance, directed and reviewed by the team. No number in the data file or on the page was
produced by a language model: every value is computed by code from NASA LOLA elevation data and
the JPL DE421 ephemeris, and the code was checked as described below.

| Part | Written by | Tool (evidence in the git history) |
|---|---|---|
| `precompute/` (ephemeris, terrain horizon, site rules, the data writer, window analyses), `scripts/download_data.py`, `validation/` (comparison scripts and result tables), `docs/` (data contract, audits), `CLAUDE.md`, and the generated `web/data/navigator-data.*` | Rytas with Claude Code | commit trailers `Co-Authored-By: Claude Fable 5.1` (11 commits) and `Claude Opus 5.5` (1 commit) |
| `app.js`, `index.html`, `style.css`, `globe.js` (current versions), `web/moonsky/` (3D horizon and its generated data), `web/data/past-landings.js`, `web/data/terrain-lowres.js`, `web/data/moon-relief.js`, `web/tools/build_moonsky_data.py`, `web/tools/build_relief.py`, `AGENTS.md` | Shakotis | commit trailers `Co-Authored-By: Claude Opus 5.5` on the surface-view merge and the UI overhaul. **[TEAM, Shakotis: confirm which of these were AI-generated and with which tools]** |
| First version of the interface, `web/terrain.js`, `web/tools/build_terrain.py`, `web/tools/build_texture.py`, `web/tools/make_fake_data.js`, `web/tools/test_terrain.js`, `moon-texture.js`, and the legacy `sites.js`, `horizons.js`, `ephem.js`, `build_data.py`, `server.py` | 4tunea | no AI trailer in these commits. **[TEAM, 4tunea: state the tools used, if any]** |

How the AI-written parts were verified:

- Sun and Earth positions: Skyfield with DE421 compared with the JPL Horizons system at six
  times, Sun and Earth, agreement within 0.1 arcsecond (`validation/horizons_vs_skyfield.md`,
  raw responses in `validation/horizons_raw/`).
- Terrain horizon: tests with known analytic answers (flat-sphere dip, ring and east walls, a
  two-layer near-field step) and real-DEM landmarks (Shackleton floor height, Malapert bearing)
  in `precompute/tests/test_horizon.py`; the browser's coarse-horizon code has the same kind of
  tests in `web/tools/test_terrain.js`.
- Illumination against the literature: Barker et al. (2021), Table 2 (`validation/barker2021_vs_ours.md`).
- The surface view's own ephemeris against Skyfield (`validation/moonsky_vs_skyfield.md`) and
  the app's angle shortcut against a direct calculation (`validation/check_app_rebuild.py`).
- Summary for the project page: `validation/SUMMARY.md`. Every number the app shows is traced
  to the data file or to a documented formula in `docs/app-numbers-audit.md`.

The data file carries the statement `generator_note` ("computed by AI-assisted code … no values
generated by a language model", `docs/data-contract.md` section 3). AI-written source files start
with the line "Written with AI assistance (Claude Code), reviewed by the team". All external data
sources, with URLs: `docs/REFERENCES.md`.

## Files

- `index.html`, `app.js`, `style.css`, `globe.js`: the interface.
- `web/moonsky/moon-sky.js`: the 3D horizon (`<moon-sky>`), and its data scripts in `web/moonsky/`.
- `web/data/navigator-data.js`: the precomputed Sun, Earth and skyline data.
- `web/data/past-landings.js`: 27 past soft landings (rounded published coordinates).
- `web/data/terrain-lowres.js`: coarse south-pole terrain; `web/tools/build_terrain.py` writes it.
- `web/data/moon-relief.js`: LOLA slope maps for the globe relief; `web/tools/build_relief.py` writes it.
- `moon-texture.js`: the NASA Moon colour map; `web/tools/build_texture.py` writes it.
- `web/terrain.js`: terrain-horizon code. Checks: `node web/tools/test_terrain.js`.

`build_terrain.py` and `build_relief.py` need `data/LDEM_75S_120M.IMG` (116 MB, from
`scripts/download_data.py` or PDS). No longer loaded by the page: `sites.js`, `horizons.js`,
`build_data.py`, `server.py`, and the fake fixture `web/data/navigator-data.fake.js`.
