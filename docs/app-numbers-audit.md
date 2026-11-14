# Audit: every number and verdict the app shows

Read-only review of `app.js` (703 lines, commit 2e89dc1) and `web/moonsky/moon-sky.js` against
`docs/data-contract.md` section 7, done 2026-11-14 for the real data file (6 sites). No app file
was edited. "Contract rule" means: Sun up = at least S of the disc above the skyline (S default
50 %), Earth up = centre more than E above the skyline (E default 0°), skyline interpolated
between 0.5° bins for the chosen mast. "App rule" means the extra stay-share condition the app
adds: both up at landing AND both up for at least P of the stay (P default 50 %).

Symbols: ✔ matches the contract · ⚠ uses the app rule as the headline · ⓤ unit or meaning not
labelled · Δ behaviour changes now that the hero site's skyline is below the horizontal.

## 1. Whole-Moon view and side list

| Where | Text / number | Computed by | Rule | Notes |
|---|---|---|---|---|
| Side list, rank badge | `1`, `2`, … or `!` | `rank()` → `status(site, landK, M)`; `ok` sites first, then by `both` | ⚠ app rule | A site with Sun and Earth up at landing but < 50 % of the stay shows `!` |
| Side list, subtitle | "G of N work for landing on <date> and a D-day stay" | `renderList()` | ⚠ app rule | |
| Side list, reason line | "Sun and Earth for X of the Y stay" / "The Sun is behind terrain at landing" / "…below the horizon at landing" / "Earth is behind terrain…" / "Earth is below the horizon…" / "Sun and Earth for only N% of the stay" | `status().why` | ✔ per-sample flags; "behind terrain" = `alt + r > dip` (sphere dip for the mast), else "below the horizon" | Δ at the Connecting Ridge summit the Sun branch never fires; only Earth reasons appear. `hrs()` prints "x d" or "x h" ✔ |
| Side list, small line | "N% of the stay, analysed terrain / coarse terrain, 720 m grid / smooth sphere" | `status().share` | ✔ | |
| Side list, tag | "Worked on the planned date" | `status(site, planK)` vs `status(site, landK)` | ⚠ app rule | |
| Pins on the globe | rank number or `!`, aria "available / not available" | same as list | ⚠ app rule | ⓤ Connecting Ridge and Connecting Ridge (lower slope) are 0.7 km apart: two pins and two labels overlap on the globe |
| Technical data, Moon table | "Phase seen from Earth: <name>, N% lit" | `renderMoonTech()`: `lit = (1 + a·b)/2`, a = sub-solar, b = sub-Earth unit vector | ✔ geometric illuminated fraction of the Moon as seen from Earth (not in the contract, derived from file angles) | |
| | "Sun overhead at", "Earth overhead at (libration)" | `subPoint(SUN/EARTH, k)` | ✔ rebuilt from `sites[0]` (exact to 0.007°) | |
| | "Sunrise line", "Sunset line" | sub-solar longitude ∓ 90° | ✔ | |
| | "South pole season: Summer/Winter, Sun N° south/north" | sub-solar latitude | ✔ | |
| | "Earth distance … km" | `subPoint(EARTH).dist` from `bodies.earth.diam_deg` and 6371 km | ✔ | |
| Technical data, site table | columns "Both" (`hrs`), "Share" (%), "Next window" ("Now", "+N d", "None") | `rank()`, `nextWindow()` | ⚠ app rule for "Next window" and for the row colour; "Both" and "Share" are per-sample counts ✔ | ⓤ "Both" column header has no unit; values carry "d"/"h" |
| Technical data, data table | FAKE fixture / Precomputed, generator, generated, positions, corrections, covers, skyline bins | file metadata | ✔ | |
| Technical data, rules box | Mast (select), Sun disc showing at least N %, Earth above the skyline by E °, Share of the stay with both P % | `set` | ✔ these are S, E, P and the mast | |
| FAKE banner, status bar "Data:" | shown when `fake === true` | | ✔ | hidden with the real file |

## 2. Site panel

| Where | Text / number | Computed by | Rule | Notes |
|---|---|---|---|---|
| Badge | "Available / Not available for landing on <date>" | `status().ok` | ⚠ app rule, the headline verdict | |
| Slip line | "On the planned date … worked / did not work. After a N-day slip it still works / no longer works: <why>." | `status()` at planK and landK | ⚠ app rule | Δ for the summit the `<why>` is always an Earth reason |
| Slip line, cut note | "The data ends on <date>, so only X of the stay are covered." | `status().cut` | ✔ contract §4 | |
| "Two ways to recover" → switch site | up to 3 sites, "<name>, X of Y with Sun and Earth" | `ranked.filter(ok)` sorted by `both` | ⚠ candidates filtered by the app rule; X, Y per-sample ✔ | with 6 sites at most 3 are offered |
| "Two ways to recover" → land later | "Land on <date>, N days later" | `nextWindow()`: first later day (same hour) with `status().ok` | ⚠ app rule | |
| Verdict box | "The Sun is up. It sets in <dur>." / "The Sun is down. It rises in <dur>." / "…up for the rest of the data." | `flip(v.sun, k)`: hours until the per-sample flag changes, minus 0.5 h | ✔ contract rule, hourly resolution ±0.5 h | Δ at the summit in southern summer this reads "sets in 170 d"; correct |
| | "Earth is in view. It sets in <dur>." / "Earth is out of view. It rises in <dur>." / "Earth does not come into view here. Talking to Earth needs a relay satellite." | `flip(v.earth, k)` | ✔ | |
| Stats | "Stay with both Sun and Earth: X (N%)" | `status().both/total` | ✔ | |
| | "Stay in sunlight: N%", "Stay with Earth in view: N%" | per-sample flags over the stay | ✔ | |
| | "Longest dark stretch: <dur> / None" | longest run of Sun-down samples within the stay | ✔ | ⓤ "dark" means Sun down by the contract rule (< S of the disc), not darkness at the site |
| | "Skyline: Analysed terrain / Coarse terrain, 720 m grid / Smooth sphere, no terrain" | `terrainOf()` | ✔ | |
| Timeline strips | Sun / Earth / Both bars, white box = stay, dashed line = planned date | `vis()` flags | ✔ | ⓤ legend has no "hours" scale; dates below are day-month only |
| Clock | "<UTC time>, <dur> before landing / day N of the stay / <dur> after take-off" | `curK()` | ✔ UTC labelled | |
| Site technical table | Sun/Earth elevation and azimuth (°), skyline toward the Sun / toward Earth (°), "Sun disc showing N%", "Earth above the skyline by N°", diameters (°), mast (m), terrain, coordinate source, elevation files | `series()`, `vis()` | ✔ exactly §7 | |
| Site note | "The Sun counts as up when at least S% of its disc clears the skyline, Earth when its centre is more than E° above it." | `set` | ✔ states the contract rule | does not mention P (stay share) although the badge uses it |
| Elevation chart | Sun and Earth altitude lines, dashed skyline toward each body, y axis "°", Landing / Take-off | `series()`, `vis().sunSky/earthSky` | ✔ | Δ at the summit both dashed skylines lie below 0°; fine |
| Surface-view caption | "…a yellow ring marks it when terrain hides it. The skyline is the analysed terrain horizon… Sun and Earth positions are the ones used for the verdict." | `renderSurfCap()` | ✔ | Δ at the summit the ring appears only near sunrise/sunset |

## 3. Surface view labels (`web/moonsky/moon-sky.js`, function `_labels`, about line 1008)

| Label | Code | Meaning | Notes |
|---|---|---|---|
| "Sun" | `st.sunVis >= 0.999` | whole disc above the skyline | ✔ |
| "Sun (N% of disc above the skyline)" | `st.sunVis = discFrac(sAlt − horizonAt(sAz), sunAR)` (line 903), the §7 formula with `sunAR = atan(696000 km / sunDist)` | fraction of the Sun's disc above the skyline | ✔; the 696 000 km vs the contract's 695 700 km changes the radius by 0.04 %, invisible |
| "Sun (below the skyline)" | `st.sunVis <= 0.001` | | ✔ |
| "Sun — eclipsed by Earth" / "— partial eclipse" | `occ` from the Sun–Earth separation and radii | | not in the contract; geometric |
| yellow ring | drawn when `sunVis < 0.999` at the Sun's position | where the hidden Sun is | ✔ |
| **"Earth N%"** | `this.earthEl.textContent = \`Earth ${Math.round(st.s.phase * 100)}%\`` (line 1028) | **Earth's illuminated phase**, not the disc fraction above the skyline. With the app's hooks `phase = (1 − sun·earth)/2` (line 558, unit direction vectors from the observer); with the built-in ephemeris `0.5·(1 + cos(Sun–Earth–observer angle))` (line 551) | ⓤ **the only unlabelled percentage**; a judge will read it as visibility. The label is shown only while some of Earth's disc is above the skyline (`earthVis > 0`), which strengthens the wrong reading |
| Standalone info panel (not shown when embedded) | "N% lit · <km> km · visible / partly behind terrain / below terrain horizon" | `_info()` line 1047 | labelled correctly | |

### Note for the surface-view owner (web/moonsky/moon-sky.js)

In `_labels()` (about line 1028) the Earth label reads `Earth ${Math.round(st.s.phase * 100)}%`.
That number is Earth's illuminated phase (`s.phase`, the sunlit fraction of Earth's disc as seen
from the site), not how much of Earth is above the skyline, but it carries no word saying so.
Please change it to

    Earth, 69% lit

and, while part of Earth is behind the skyline (`0 < st.earthVis < 0.999`), append the disc
fraction with the same words the Sun label already uses:

    Earth, 69% lit, 40% of disc above skyline

For consistency the Sun label could read `Sun, 30% of disc above skyline` instead of the
bracketed form; both are unambiguous. Nothing else in the surface view needs to change; the
standalone info panel already says "69% lit".

## 4. Flags, ranked

1. ⚠ **Headline verdicts use the app rule, not the contract rule.** Badge, list order and `!`
   marks, pins, subtitle, slip line, the alternatives and the "land later" date all require both
   bodies up for ≥ 50 % of the stay. With the real data this hides most simple-rule windows at
   Connecting Ridge (available 24 % of hours under the app rule vs 49 % under the simple rule at
   2 m) and the "Earth set" slips still work, so the demo is not blocked, but the contract §7
   text and the site note describe only S and E. Either make P = 0 the default or state P in the
   badge ("available: Sun and Earth now, and for 7 of 14 days").
2. ⓤ **"Earth N%" in the surface view** is the phase and reads like visibility (section 3).
3. ⓤ **Two pins at the same spot**: Connecting Ridge and Connecting Ridge (lower slope) are
   0.7 km apart and overlap on the globe; the label of one hides the other.
4. ⓤ Minor labels: rank-table "Both" header without a unit; timeline dates without a year;
   "Longest dark stretch" means Sun counted as down by the rule.
5. Δ **Hero site never loses the Sun to terrain.** At the Connecting Ridge summit the skyline is
   −3.6° to −0.6°, so the "Sun is behind terrain" reason, the yellow ring and the panorama's
   terrain occultation only appear at the lower-slope site (`docs/sun-behind-terrain-connecting-ridge-lower.md`).
   The 21-day slip flips at the summit are all "Earth set"; the demo text should say so.
6. Technical, no user impact: `moon-sky.js` uses 696 000 km for the solar radius in `_render`
   and 695 700 km in `sky()`; `app.js` `renderStrips` divides by a span that is 0 when the planned
   day is the last data day; `MASTS` are taken from `sites[0]` (the contract requires identical mast
   lists, satisfied).

Everything else listed above follows the contract formulas exactly (`skyline`, `fraction`, `vis`,
`status` in the data layer of `app.js`).
