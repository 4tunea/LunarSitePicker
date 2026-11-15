# Use of AI (Super Intelligence) tools in this project

**Short version: the software was written with heavy AI assistance. The numbers it shows were
not. Every Sun, Earth and terrain value comes from NASA data through published algorithms, and
the results are checked against JPL Horizons.**

This file is the project's disclosure under the NASA Space Apps Challenge rules on Super
Intelligence (SI) tool use. It is linked from `README.md` and summarised inside the tool itself
under **Technical → How this project was built**.

---

## 1. Which tools

| Tool | Used for |
|---|---|
| Anthropic Claude (Claude Code and the Claude app) | Writing and refactoring source code, the precompute pipeline, test scaffolding, and project documentation |

No image-generation, video-generation or audio-generation model was used anywhere in this
project. No AI model produced any number that the tool displays.

## 2. Where AI was used, file by file

**AI-assisted code** — written or substantially rewritten by Claude from the team's
instructions, then read, run and corrected by the team:

| File or folder | What it is |
|---|---|
| `index.html`, `app.js`, `style.css` | The interface: layout, site ranking, slip flow, comparison tool, timeline |
| `globe.js` | The WebGL2 Moon: ray-traced sphere, star map, LOLA relief, zoom tiles |
| `web/moonsky/moon-sky.js` | The 3D first-person horizon view |
| `web/terrain.js` | Terrain-horizon maths used in the browser |
| `precompute/` | The Python pipeline: Skyfield ephemeris, horizon ray-marching, visibility flags, JSON output |
| `validation/` | The scripts that compare our output against JPL Horizons |
| `web/tools/` | Data-preparation and test scripts |
| `docs/`, `README.md`, `AGENTS.md`, `CLAUDE.md`, this file | Project documentation |

**Not AI-generated** — data, and the facts derived from it:

| Input | Source |
|---|---|
| Sun and Earth positions | JPL DE421 ephemeris via Skyfield, frame `MOON_ME_DE421`, apparent positions (light-time + aberration), no refraction |
| Lunar terrain and horizons | NASA LRO **LOLA** elevation models (`LDEM_75S_120M`, and 5 m polar DEMs where available) |
| Moon surface imagery | NASA LRO camera mosaics (CGI Moon Kit colour map; Moon Trek tiles when zoomed in) |
| Star positions | Public star catalogue data |
| Site coordinates | Published mission and PGDA coordinates, listed in the data file with their source |
| Validation results | Computed by running our pipeline against **JPL Horizons** output; the numbers in `validation/` are measured, not written |

The distinction that matters for judging: an AI wrote the *code that computes* the results. The
results themselves are deterministic output of NASA data and published algorithms, and anyone
can re-run `precompute/build.py` and the validation scripts to reproduce them.

## 3. What the team did

The team supplied the mission concept and the demo story (launch slip → site turns unavailable →
recover by switching site or date), chose the five analysed south-pole sites, set the physical
rules (mast height, Sun-disc fraction, Earth clearance, the share of the stay that must work),
decided what the interface should show and how it should behave, and reviewed, tested, ran and
corrected the generated code throughout. Correctness requirements — the flat-sphere and
synthetic-ridge horizon tests, and the Skyfield-vs-Horizons comparison — were set by the team
before any result was accepted, and are in the repository as runnable checks:

```
node web/tools/test_terrain.js     # horizon maths against analytic answers
node web/tools/test_app.js         # end-to-end checks of the page
python validation/validate_horizons.py
```

## 4. Images, video and audio

- **No AI-generated images or video are used.** Everything on screen is drawn live by our own
  code from NASA data: the Moon is ray-traced in WebGL from the LRO colour map and LOLA relief,
  and the 3D horizon is a mesh built from LOLA elevations. There is no raster artwork, no
  generated texture and no stock imagery in the repository.
- **No audio is used.**
- Because no image or video in the project is AI-generated, no SI watermark is applied to any
  visual. Screenshots and screen recordings of the tool show NASA data rendered by AI-assisted
  code; that status is disclosed here and in the tool rather than stamped on the pixels. Any
  separate presentation material the team produces is covered by its own disclosure.

## 5. NASA branding

This project uses **no NASA branding or design elements**: no NASA logo, insignia, worm or
meatball, no flags, and no mission identifiers or mission logos. The circle in the top-left of
the interface is a plain CSS gradient of the Moon drawn by our own stylesheet, not a NASA mark.

NASA *data and imagery* (LOLA, LRO, DE421, Moon Trek) is used as open data and credited in the
interface and in `README.md`. That is data attribution, not branding, and NASA does not endorse
this project.

## 6. How this is marked in the project

| Where | What a judge sees |
|---|---|
| `README.md` | A link to this file near the top |
| This file (`AI_USE.md`) | The full disclosure |
| In the running tool, **Technical → How this project was built** | A short statement with the same split: AI-assisted code, NASA-derived numbers |
| Page footer | `AI-assisted code · NASA data` on every screen |
| `index.html` `<meta name="generator">` and a comment in `<head>` | Machine-readable metadata |
| Header comment of each AI-assisted source file | A one-line acknowledgment |
| `web/data/navigator-data.js` → `si_assisted` field | Metadata inside the data file itself, saying the pipeline code was AI-assisted and the values were not |

---

*Last updated: 15 November 2026. If the project changes after this date, update this file with it.*
