# Navigator – Lunar Window Planner (NASA Space Apps 2026)

Code walkthrough for agents (files, data flow, surface view, pitfalls): see `AGENTS.md`.

Challenge: "Lunar Landing Site Navigator". Build a tool that lets mission planners
compare lunar south-pole landing sites and dates quickly, showing Sun and Earth
positions relative to the local horizon (power + direct-to-Earth comms).
Hackathon: 14-15 Nov 2026. Judged on Impact, Creativity, Validity, Relevance,
Presentation (check the 2026 Judging & Awards Guide). Team max 6.

## The demo story (everything serves this)
"The launch slipped 3 weeks. Can we still land at Connecting Ridge?"
1. Original date: site is AVAILABLE (Sun + Earth above the terrain horizon).
2. Click the site: horizon panorama (unrolled 360° skyline) + window timeline.
3. Date +3 weeks: site turns NOT AVAILABLE (Sun behind a massif).
4. Tool suggests (A) another pre-analysed site that works on the new date, and
   (B) the next good window at the same site. Both are lookups in a precomputed table.
Keep the scope small: 5 south-pole sites, done properly.

## Repo layout and ownership
- `scripts/`    downloads only (`download_data.py`) into `data/` (gitignored).
- `precompute/` Python calculations (ephemeris, horizon, visibility) -> JSON.
- `validation/` Skyfield vs JPL Horizons comparison; static CSV + markdown results.
- `docs/`       `data-contract.md` = the JSON schema between precompute and the frontend.
- `web/`        reserved for frontend data/assets.
- Root frontend: `index.html`, `app.js`, `globe.js`, `style.css` are owned by a teammate.
  DO NOT edit them from the precompute/validation work. Integration happens via the
  JSON in the data contract.

## Architecture
- Python (offline, precompute): Sun/Earth alt/az per site -> terrain horizon mask
  -> visibility flags -> JSON (see docs/data-contract.md). No live backend in the
  submission; the site is static (GitHub Pages/Vercel).
- Frontend: the existing vanilla-JS app (no build step, custom WebGL2 globe, hand-drawn
  panorama/timeline). No Vite/React.
- `server.py` and the live "Check against JPL Horizons" button are DEV-ONLY. The
  submission shows a static validation table (CSV + markdown) instead.
- UI colours: dark theme, Sun = amber #F5A524, Earth = blue #5AA9FF,
  available = green #3DD6B0, unavailable = orange #F08A4B.

## Calculations (the part judges will check)
1. Sun and Earth alt/az from a lunar surface point: Skyfield is the REFERENCE.
   Kernels de421.bsp, moon_080317.tf, pck00008.tpc, moon_pa_de421_1900-2050.bpc,
   frame MOON_ME_DE421, pc.build_latlon_degrees(). Libration comes from the frame.
   `ephem.js` (truncated Meeus, no physical libration) is kept for now: measure its
   max error vs Skyfield and Horizons over the demo period and report it. Do not delete
   it until that is done and the team decides.
2. Terrain horizon: 720 azimuth bins (0.5°), march outward up to ~150 km over the DEM,
   keep max of atan((h - h_site - d^2/(2R)) / d), R = 1737.4 km (or exact spherical
   form). No refraction. Observer mast height is an input (e.g. 2 m / 10 m).
   Sun = 0.53° disc (fraction visible), Earth ~1.9° disc.
   Required tests BEFORE any real results: (a) flat sphere gives -acos(R/(R+h));
   (b) synthetic ridge with a known analytic answer.
3. visible(t) = body_alt(t) > horizon(body_az(t)). "Available" = Sun AND Earth visible;
   thresholds must be user-visible settings, not hidden constants.
4. Metrics: % sunlit, longest continuous dark period, Sun+Earth hours in first 14 days,
   time to next sunset/Earthset.
5. Alternatives: other sites ranked by Sun+Earth hours over first 14 days from the
   chosen date; next window at same site = first future green interval.
6. VALIDATION (must be on the project page): compare Skyfield angles against JPL
   Horizons (observer on body 301, Sun and Earth, 3+ timestamps), report differences
   as static CSV + markdown in validation/.

## Sites (analysed set: these 5, one comparison point, and the two polar past landings)
Site01 Connecting Ridge, Site04 Shackleton Rim, Malapert Massif, Haworth, Nobile Rim 2.
Appended 2026-11-14 (horizon-coverage): IM-2 Athena and IM-1 Odysseus at their published landing
coordinates (no 5 m tile, LDEM 120 m horizon only; IM-1 incomplete towards the north), so the two
past landings inside the DEM get a real skyline; the app drops them from the reference points.
Decision 2026-11-14: coordinates = highest point of the PGDA 5 m tile (Shackleton Rim: highest
point on the rim crest); a sixth site "Connecting Ridge (lower slope)" at the Site01 tile centre
shows what a 0.7 km move does. Rules and sources: precompute/sites.json, docs/data-contract.md §10.
- Coordinates from the PGDA LOLA_5mpp DEM metadata or Mazarico et al.; record the
  source per site in the JSON (`coord_source`). Never invent coordinates.
- The old `sites.js` id 'shackleton' is really Connecting Ridge; new ids must not repeat this.
- Sites outside the 75S DEM (Apollo, Chang'e, Chandrayaan-3, ...) have no terrain:
  flag them "sphere-only" or leave them out of analysed results.
- Past landings and user pins are *reference points* (decision 2026-11-14): ranked and counted
  separately from the analysed sites, never among them, and every verdict is labelled with its
  skyline source (coarse 720 m grid south of 75 S, lower bound; smooth sphere elsewhere).
- The existing `horizons.js` is NOT trusted (2° bins, 120 m nearest-neighbour, suspicious
  long constant runs). Replace it with output from the tested horizon code.

## Data
- Site DEMs: https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/ (README there). 5 m/px
  GeoTIFFs, south polar stereographic X/Y in metres, MOON_ME frame of DE421.
  Use *_surf.tif. Each covers only ~16x16 km.
- Far field: LOLA LDEM_75S_120M.IMG (imbrium.mit.edu). Read geometry (size, scale,
  projection centre, offsets, scaling factor) from its PDS .LBL label; no guessing from
  file size.
- Never commit large data. Download via scripts/download_data.py into /data (gitignored).

## Pitfalls
- Longitude convention (0-360 vs +-180) and east/west sign; test with a known point.
  Check JPL Horizons' SITE_COORD longitude sign and altitude units (km) for body 301.
- Convert the site lat/lon into the DEM's polar stereographic CRS; do not reproject the DEM.
- Do not invent site coordinates; take them from the DEM metadata/papers.
- Illustrative numbers in the mockup are fake. Real results decide the demo dates.
- Choose the demo date pair AFTER computing: hero site flips green->red and at least
  one other site stays green.

## Working rules
- Python: if `python` is not on PATH, use
  `C:\Users\adamo\AppData\Local\Programs\Python\Python313\python.exe` (or the .venv).
- Small commits, one calculation module at a time, each with a test or a printed
  sanity check. If something cannot be verified, say so.
- Before a frontend PR: `node web/tools/test_app.js` (headless Edge/Chrome) must pass.
- Stop and report after each step (verified / not verified). If a step runs 20+ min
  over, stop and report instead of continuing.
- Cut order if behind: custom coordinates, past landings, globe night shading, public mode.
  Never cut: terrain horizon, site comparison, Horizons validation.
