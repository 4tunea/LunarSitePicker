# Code guide for agents

Read this before changing code. It explains what every part of the repo does, how data flows
through it, and the traps that have already cost time. Project goals, team rules and the
demo story are in `CLAUDE.md`; the JSON schema is in `docs/data-contract.md`. Where this guide
and the code disagree, trust the code and fix this file.

## 1. What the app is

A static web page for lunar south-pole mission planners: "the launch slipped, can we still
land at site X?". For each site and date it decides whether the **Sun** (power) and **Earth**
(direct radio link) are above the **terrain skyline**, ranks sites, and suggests a fallback
(another site, or a later date). Selecting a site zooms the 3D Moon down onto it and opens a
first-person **surface view** with the real Sun/Earth paths and a Sun-tracking playback.

Hard constraints:

- **Opens from `file://` with no server and no build step** (double-click `index.html`).
  So: classic `<script>` tags only (no ES modules), no `fetch()` of local files, data is
  shipped as `.js` files that assign a global or call a registration function, and images
  used by WebGL must be `data:` URLs.
- **Vanilla JS, no frameworks, no bundler.** WebGL2 is hand-written.
- **Numbers must be defensible.** Skyfield/DE421 is the reference; every derived number should
  be traceable to the data file or to a documented formula.

## 1b. UI update (Nov 2026)

- Layout: `.stage` holds the site panel, a splitter and the globe. Classes on `#stage`: `insite`, `v3d` / `v2d`.
  3D: info panel left (width `--info-w`, dragged on `#split`), 3D horizon right. 2D: one full-width panel with the
  unrolled skyline (`renderPano`); the globe is hidden. Default view is 3D.
- Sites: `allSites()` = analysed (`group: 'pole'`) + past landings (`'past'`) + user pins (`'pin'`, kept until reload).
  All are ranked together and can be compared.
- Compare: `state.picking` (choosing in list/pins), `state.sel`, `state.cmpOpen` (`#comparePanel`).
- Display settings live in `#displayBox`, moved into whichever technical panel is visible. Globe options `gopt`
  go to `Globe.set`; 3D options go to `SURF.setOption`. The 3D view's own ☰ menu is hidden when embedded.
- 3D horizon paths: `setWindow(stayStart, stayEnd, pathStart, pathEnd)`; `_buildPaths` splits the paths into
  stay / other x above / behind the skyline (cut at the crossing) and draws them after the terrain, dashed when
  hidden. Dashed outlines (`.so`, `.eo`) mark a hidden Sun or Earth. A skyline outline and a faint ambient fill
  keep shadowed ridges visible against the black sky.
- Loading: the globe loader (`#globeLoad`) shows until the colour map is ready; relief, stars and the coarse
  terrain stream in afterwards (dynamic `<script>` tags, so `file://` still works).

## 2. Repo map

| Path | Role | Loaded by the page? |
|---|---|---|
| `index.html` | Layout: top bar (mission, Compare, Technical), site list + pin form, stage (site panel, splitter, globe/3D horizon, compare panel), display settings box, status bar | yes |
| `app.js` | All app logic (data layer, ranking, panels, timeline, surface-view wiring) | yes |
| `globe.js` | `Globe`: ray-traced WebGL2 Moon with LOLA relief, star map, Moon Trek zoom imagery, smooth zoom/inertia, pins projection, `flyTo` | yes |
| `style.css` | All styles (dark theme, colours in `:root`) | yes |
| `moon-texture.js` | `MOON_TEXTURE` = NASA LRO colour map as a base64 JPEG data URL (2.3 MB) | yes |
| `web/terrain.js` | `Terrain`: terrain-horizon maths on a south-polar grid (browser + node) | yes |
| `web/moonsky/moon-sky.js` | `<moon-sky>` web component: the first-person surface view | yes |
| `web/moonsky/{meta,stars,earth}.js`, `ephem/<year>.js`, `dem/<b>-<s>.js` | Data for the surface view, loaded on demand | on demand |
| `web/data/navigator-data.js` | Real data file (precompute output). **Not written yet** | yes, if present |
| `web/data/navigator-data.fake.js` | FAKE fixture with the real shape (kept for the tools, not loaded) | no |
| `web/data/past-landings.js` | `PAST_LANDINGS`: 27 past landings (rounded published coordinates); full candidates in the list | yes |
| `web/data/terrain-lowres.js` | `TERRAIN_LOWRES`: 720 m south-polar grid for pins/past sites south of 80° S | on demand |
| `web/data/moon-relief.js` | `MOON_RELIEF`: LOLA slope maps (global LDEM_16, polar LDEM_75S_120M) for the globe | on demand |
| `web/tools/build_relief.py` | Writes `moon-relief.js` (numpy, Pillow; needs the moonsky DEM tiles and `data/LDEM_75S_120M.IMG`) | tool |
| `web/tools/make_fake_data.js` | Writes the fake fixture (node; needs `data/LDEM_75S_120M.IMG`) | tool |
| `web/tools/build_terrain.py` | Writes `terrain-lowres.js` (numpy; same input) | tool |
| `web/tools/build_texture.py` | Writes a sharper `moon-texture.js` | tool |
| `web/tools/build_moonsky_data.py` | Writes `web/moonsky/` data (skyfield, numpy, pillow) | tool |
| `web/tools/test_terrain.js` | Checks for `web/terrain.js` (`node web/tools/test_terrain.js`) | test |
| `docs/data-contract.md` | Schema between precompute and frontend (angles, not verdicts) | doc |
| `precompute/`, `validation/` | Planned Python pipeline and JPL Horizons comparison. **Only READMEs so far** | — |
| `data/` (gitignored) | Large downloads: LOLA DEMs, Skyfield kernels, star catalogue | — |
| `ephem.js` | Truncated-Meeus ephemeris; only used by `make_fake_data.js` | no |
| `sites.js`, `horizons.js`, `build_data.py`, `server.py` | Legacy first version (old site list, untrusted 2° horizons, JPL proxy) | no |

**`web/data/` is not in git.** `.gitignore` has `data/`, which matches every folder named
`data`. A fresh clone shows "No data file loaded". Regenerate locally (section 8) or change the
ignore rule to `/data/`. The surface-view data lives in `web/moonsky/` precisely so it is committed.

Script order in `index.html` matters: data files → `moon-texture.js` → `web/terrain.js` →
`web/moonsky/moon-sky.js` (defines `<moon-sky>`, upgrading the element already in the DOM) →
`globe.js` → `app.js` (uses all of the above at load time).

## 3. Conventions (everywhere)

- **Azimuth**: degrees clockwise from local north (E = 90). At the south pole "north" points
  away from the pole.
- **Altitude/elevation**: degrees above the local horizontal plane of a 1737.4 km sphere.
- **Longitude**: east-positive, [-180, 180). Latitude planetocentric, MOON_ME (DE421) frame.
- **Heights**: metres relative to the 1737.4 km sphere (LOLA convention).
- **Time**: UTC. The data file stores `start_utc`, `step_s` (3600) and `count`; sample `k` is at
  `start + k·step`. App code works in sample indices `k`; `ms(k)` converts to epoch ms.
- **Skyline**: 720 bins of 0.5°, bin `i` centred on azimuth `i·0.5`, linear interpolation with
  wrap (contract section 2). One array per mast height (2 m and 10 m).
- **Visibility** (contract section 7): `fraction = 1 - (acos(x) - x·sqrt(1-x²))/π`,
  `x = clamp((alt - skyline(az)) / r, -1, 1)`, `r` = disc radius. Sun counts as up when
  `fraction ≥ set.sun` (default 50%); Earth when `alt - skyline > set.earth` (default 0°).
  A site is **available** if both are up at landing and both-up covers `≥ set.share` of the stay.
- **Colours**: Sun `#F5A524`, Earth `#5AA9FF`, available `#3DD6B0`, not available `#F08A4B`.

## 4. `app.js` (one IIFE, sections in this order)

1. **Data layer** (only part that knows the file format). Reads `window.NAV_DATA`.
   - `SUN`, `EARTH`: Moon-fixed Sun direction and Earth position per sample, reconstructed from
     the *first* site's alt/az. `series(site)` uses them to derive alt/az for any other point
     (checked to 0.01° against the file's other sites). Analysed sites use the file directly.
   - `terrainOf(site)`: `'dem'` (analysed, skyline from the file), `'coarse'` (picked/past spot
     south of 80° S, skyline computed with `Terrain.horizon` on `TER`, the 720 m grid), or
     `'sphere'` (no skyline: smooth-sphere dip).
   - `horizonArr`, `skyline(site, az)`, `fraction`, `vis(site)` (cached per rule set),
     `status(site, k0, m)` (verdict + reason), `nextWindow`.
2. **State**: `set` (rules: mast, sun, earth, share) and `state` (plan day, slip days, stay days,
   open site, cursor `cur` relative to the planned date, tech toggle, sidebar). Saved to
   `localStorage['lunarNav2']` keyed by the data file identity. `findDemo()` picks an opening
   date where site 1 works but fails 21 days later while another site works.
3. **Helpers**: `el` (SVG), `html`, `rows`, time/coordinate formatters.
4. **Lists and pins**: `rank()`, `renderList()`, `renderPins()` (HTML buttons positioned with
   `Globe.project`), `lightGlobe()` (Sun/Earth sub-points → globe lighting).
5. **Whole-Moon technical panel**: `renderMoonTech()`, `fillRules()`.
6. **Site inspector**: `renderOptions` (recovery suggestions), tiles, `renderPano` (2D horizon), `renderCal`
   (landing-date explorer), `renderWhy` (plain-language reasons), `renderStrips`, `renderSiteTech`. Compare:
   `evaluate`, `better`, `renderCompare`. (Older text below:) `renderSurfCap` (caption for the
   3D view), `renderStrips` (timeline bars), `renderSiteTech` (table + elevation chart),
   `renderSite()` (calls the above, then `syncSurface()`).
7. **3D surface view**: see section 6.
8. **Flow**: `refresh()` (re-render everything), `tick()` (cheap re-render while playing),
   `play()`/`stop()` (setInterval over the stay; Play also turns on Sun tracking),
   `select(site)` (opens a site → `openSurface`), `back()` (closes → `closeSurface` + fly home),
   `setMission`, `inspect(lat, lon)` (creates the "Picked spot" custom site). Event listeners.
9. **Surface map and coarse terrain**: `loadSurface()` (globe texture: embedded map, else NASA
   Moon Trek tiles), `loadTerrain()` (decodes `TERRAIN_LOWRES` with `DecompressionStream`, then
   rebuilds affected sites and the open surface view).
10. **Start**: `Globe.init` with callbacks (`draw` → `placePins`, `hover`, `click` → back,
    `pick` (double-click) → `inspect`). `window.NAV_DEBUG` exposes internals for the console.

## 5. `globe.js` and `web/terrain.js`

`Globe` draws one full-screen triangle; the fragment shader ray-traces a unit sphere, samples
the equirectangular texture (lon 0 in the centre), lights it from the real Sun and adds faint
earthshine. A generated surface (maria, craters) is used until a texture is set. API: `init`,
`resize`, `request`, `project(lat, lon)` → CSS px + visibility, `flyTo(lon, lat, dist, done, ms)`
(`dist` in Moon radii; `done` runs on arrival, not if the user grabs the globe), `set({sun,
earth, grid})`, `zoom`, `view`, `dir`, `setTexture`. Camera latitude is clamped to ±88°.

`Terrain` works on a square south-polar-stereographic grid `{ n, px, at(i) }` (0° lon up, 90° E
right). `horizon(grid, lat, lon, masts, {nAz, maxRange})` marches outward on great circles
(step grows with distance) and keeps the max exact spherical elevation angle; returns
`{ ground, elev[mast][bin], complete }`. `dip(h)` is the smooth-sphere horizon dip.
`fromDeltas` decodes the delta-coded grid. Tests: flat sphere, ring wall, east wall.

## 6. The surface view (`web/moonsky/moon-sky.js`)

A self-contained custom element (`<moon-sky>`, shadow DOM, WebGL2, about 1,150 lines). It also
runs standalone (without `embedded`) with its own location/date/time UI.

### Integration with the app (`app.js`, section "3D surface view")

```text
select(site) → openSurface(site)
  ├─ Globe.flyTo(site, 1.07 radii, 1.1 s)            ┐ both must finish
  ├─ SURF.setSite(lat, lon, name) → builds terrain   ┘
  ├─ 'moonsky-progress' events → loading screen (#surfLoad: bar + stage text)
  │     shown (.surface-wait) only if still loading when the zoom ends
  └─ done → .surface-on: globe scales up + fades out, surface view fades in
renderSite() → syncSurface(): SURF.setWindow(landing, take-off); SURF.setTime(ms(curK()))
play()/stop() → SURF.setTracking(true/false)          (view locked on the Sun while playing)
back() → closeSurface() then Globe.flyTo(home)
```

CSS classes on `#globeWrap`: `surface-loading` (in progress), `surface-wait` (loading screen
visible), `surface-on` (3D view visible), `surface-error` (loading screen shows the error and
a back button). A token (`surfTok`) discards results of superseded opens.

Hooks passed with `SURF.configure(...)` keep the app the single source of truth:

| Hook | App implementation | Used by the view for |
|---|---|---|
| `sky(t)` | `series(surfSite)` interpolated linearly, azimuth unwrapped; disc sizes from `D.bodies` | Sun/Earth position, size, Earth phase, paths, labels |
| `skyline(az)` | `skyline(surfSite, az)` for the current mast, or `null` for `'sphere'` sites | conforming the terrain silhouette, visibility, hidden-Sun ring |
| `height(lat, lon)` | `Terrain.heightAt(TER, …)` south of 75° S | terrain shape (720 m instead of 1.9 km) |

Without hooks (or outside the data period) it uses its own data: built-in Skyfield ephemeris
and LOLA LDEM_16. Stars and Earth's orientation always use the built-in ephemeris.

### Public API

`configure(hooks)`, `setSite(lat, lon, label, {face, keepView})` → Promise (rejects on error),
`setWindow(t0, t1)` (ms; span of the drawn paths), `setTime(ms)`, `setTracking(bool)`,
`setEyeHeight(m)` (rebuilds), `rebuild()`, `lookAt(az, alt, fov)`, `sky(t)`, `horizonAt(az)`.
Events: `moonsky-progress` `{label, frac}`, `moonsky-change` (standalone info updates).

### Data loading (works on `file://`)

`loadJS(base, key)` appends `<script src="<base><key>.js">`; each file calls
`MoonSkyData.put(key, payload)`, which resolves the waiting promises. `base` defaults to the
component script's own folder. Binary payloads are base64; DEM tiles are also zlib-deflated
and decoded with `DecompressionStream('deflate')`.

- `meta.js`: `{ ephem: {first, last, pad, rec, sun_d0, sun_ds, earth_d0, earth_ds}, dem: {ppd,
  band_rows, bands: [{n, w, s}], radius_m} }`.
- `ephem/<year>.js`: daily records at 00:00 UTC from Jan 1 − 2 d to next Jan 1 + 2 d, 24 bytes
  each: 10 × int16 (Sun unit vector, Earth unit vector, ME←ICRF quaternion w,x,y,z, all ×32767)
  + 2 × uint16 (Sun distance = 1.46e8 + u·100 km, Earth distance = 345000 + u km). Apparent
  positions from the Moon's centre in MOON_ME_DE421. The browser interpolates with 4-point
  Lagrange and subtracts the observer position (parallax). Checked against Skyfield's
  topocentric alt/az: median about 2", max under 7".
- `dem/<b>-<s>.js`: LDEM_16 (16 px/deg) re-gridded per 5° latitude band `b` (80 rows) so every
  row has about `5760·cos(lat)` samples (`n`), split into `s` sectors of `w` columns; int16
  metres, delta-coded along rows. Tile key in code is `b*1000 + s`. A view loads about 10-20
  tiles (about 150 KB).
- `stars.js`: Yale BSC, V ≤ 5.5: 8 bytes per star (int16 xyz ICRF, uint8 (V+2)·30, int8 B−V·60).
- `earth.js`: 512×256 JPEG data URL (Blue Marble).

### Terrain build (`_buildTerrain`, async with progress and `yieldUI()` between steps)

1. Polar mesh around the observer: rings from 0 to `RMAX` = 200 km (step `max(2 m, 3%·r)`),
   `SEGS` = 360 azimuth segments. Each vertex's lat/lon by great-circle destination.
2. Load the DEM tiles those points need (`need` → `loadTiles`).
3. Heights = host hook or LOLA, plus optional synthetic detail (noise + small craters within
   about 9 km, never under the observer) for realism below the DEM resolution. Positions are in
   local ENU metres (x = east, y = north, z = up) with exact spherical curvature; the origin is
   the ground under the observer, the eye is at `z = eyeH` (the app passes the mast height).
4. **Skyline conforming** (only with a `skyline` hook): beyond 1.5 km (blended to 5 km) each 1°
   segment is shifted by `tan(Δ)·distance` so its silhouette equals the given skyline, and every
   vertex beyond 8 m is clamped to it. This keeps the picture consistent with the verdict.
5. Normals, then two R32F shadow heightmaps: coarse 1024² over ±200 km (about 390 m) and fine
   1024² over ±1.5 km (about 3 m, includes the synthetic detail), conformed the same way.
6. Upload buffers and textures; then `_setWindow` computes the paths, daily marks and rise/set
   events.

### Rendering (`_render`, only when `dirty`)

Sky pass without depth (unit-sphere directions, separate near/far planes): stars (points,
ICRF → ENU via the ephemeris quaternion), alt/az grid and Sun/Earth paths (screen-space thick
lines), daily dots, Sun (billboard disc + glow, never smaller than a few px), Earth (billboard
ray-cast sphere: texture rotated by the Earth rotation angle, lit by the Sun so the phase is
right, red refraction ring during eclipses). Then the terrain with **logarithmic depth**
(near 0.3 m, far 450 km): Lambert + Lommel-Seeliger regolith shading, earthshine, and soft
shadows by ray-marching the heightmaps toward the Sun in the fragment shader. Auto-exposure
opens up during lunar night. HTML overlay labels: compass points (sitting on the skyline),
Sun/Earth names, date marks, and the yellow **hidden-Sun ring** with "N% of disc above the
skyline", using the same disc formula as the app.

Camera: yaw/pitch/fov in degrees; drag "grabs the sky", wheel/pinch zooms (1-100°), arrows look.
`_following` (Play/tracking) locks drag and arrows and keeps the Sun centred, even below the
skyline.

## 7. How the numbers are produced (and what is still fake)

- **Data file**: the frontend reads `NAV_DATA` (contract v1.0): hourly Sun/Earth alt/az for 5
  analysed sites in 2027, 720-bin skylines for masts 2 m and 10 m, disc diameters. The real
  file (`precompute/`, Skyfield) does not exist yet; the **fake fixture** uses the Meeus
  `ephem.js`, 120 m-only horizons and placeholder coordinates. The page no longer loads it; the real file exists now.
- **Surface-view ephemeris**: real Skyfield/DE421, built by `web/tools/build_moonsky_data.py`,
  which also prints the check against Skyfield. In the app it is only the fallback for
  positions (the data file wins) and the source for stars and Earth's rotation.
- **Terrain in the 3D view** is for orientation and context; the authoritative skyline is the
  data file's (or the coarse one), enforced by conforming. Synthetic detail is cosmetic.

## 8. Running, rebuilding, testing

```text
open index.html                                   # the app (file://)
node web/tools/test_terrain.js                    # terrain-horizon checks
node web/tools/make_fake_data.js                  # web/data/navigator-data.fake.{js,json}
python web/tools/build_terrain.py                 # web/data/terrain-lowres.js
python web/tools/build_moonsky_data.py [--years 2020 2035] [--only ephem|dem|stars|earth]
```

The first two generators need `data/LDEM_75S_120M.IMG` (116 MB, PDS:
`pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img/ldem_75s_120m.img`).
`build_moonsky_data.py` downloads its inputs into `data/` (LDEM_16, Skyfield kernels, BSC5,
Blue Marble). If `python` is not on PATH, see the working rules in `CLAUDE.md`.

**Visual checks without a display**: headless Edge/Chrome renders WebGL through SwiftShader:

```text
msedge --headless=new --use-angle=swiftshader --enable-unsafe-swiftshader --window-size=1400,900
       --virtual-time-budget=40000 --screenshot=out.png "file:///…/index.html"
```

To drive the UI, write a temporary copy of `index.html` with a `<script>` before `</body>`
that clicks things (e.g. `document.querySelectorAll('#rank button')[0].click()` after a
timeout), screenshot it, then delete the copy. Validate injected scripts with `node --check`
first; a syntax error just shows the untouched page.

## 9. Pitfalls already hit

- **`file://`**: no `fetch`, no ES modules, WebGL rejects non-`data:` images. Ship data as scripts.
- **Gitignore `data/`** also hides `web/data/` (section 2).
- **Animation clocks**: in headless runs `requestAnimationFrame` timestamps (and the CSS
  transition clock) can lag `performance.now()`. Animations here use `performance.now()` for
  both start and progress, and the loading screen is toggled from JS, not by a CSS delay.
  Don't mix the two clocks.
- **One source of truth**: anything the surface view shows about visibility must come from the
  app's hooks and the contract formula; otherwise the 3D view and the verdict contradict each
  other (e.g. "below the horizontal" is not "below the skyline" for a ridge site).
- **Keyboard**: arrows inside `<moon-sky>` look around; the app's document handler ignores
  arrow keys whose target is `MOON-SKY` but still handles Space and Esc.
- **Coordinates**: east-positive longitude, azimuth clockwise from north, and "north" at the
  south pole points away from the pole. Test with a known point after any change.
- **Ownership**: `CLAUDE.md` says the root frontend files belong to a teammate; coordinate
  before large edits there, and keep precompute/validation work out of them.

## 10. Recipes

- **Change what the verdict uses**: edit the data layer in `app.js` (`series`, `skyline`,
  `vis`, `status`). The surface view follows automatically through the hooks.
- **Add a field from the data file**: update `docs/data-contract.md` first, then the data layer.
- **Different data year**: the app follows `NAV_DATA.time`; make sure `build_moonsky_data.py
  --years` covers it (stars and Earth rotation need the built-in ephemeris for that year).
- **Shrink `web/moonsky/`** (25 MB, mostly global DEM tiles): restrict `build_dem` to the bands
  the app needs (south of about 60° S) and accept flat terrain elsewhere.
- **Tune the transition**: zoom distance/duration in `openSurface` (`Globe.flyTo(…, 1.07, …, 1100)`),
  fades in `style.css` (`#globe`, `#surface`, `.surfload`).
- **Surface-view look**: shading and shadows in the `SH.terrainF` shader; Sun/Earth in `sunF`
  and `earthF`; display defaults in `this.opt`.
