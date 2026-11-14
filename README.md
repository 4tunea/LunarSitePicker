# Lunar landing site navigator (demo)

A 3D Moon with the landing sites that suit a chosen date shown as ranked pins.
Click a pin to zoom in and see the view from the surface, with the Sun and Earth
moving over the next lunar day.

## Run it

- Simplest: double-click `index.html`. Everything works offline except the
  "Check against JPL Horizons" button.
- With the Horizons check: run `python server.py` in this folder and open
  http://localhost:8000 (needs Python 3 and an internet connection).

## How to use it

- The date bar on top sets the landing date. Pins and the ranked list update.
- The left list runs from the top pick to the worst. "Hide" retracts it.
- Drag to turn the Moon, scroll to zoom, double-click the surface to test your own spot.
- "Show technical data" adds whole-Moon data on the front page (phase, Sun and
  Earth overhead points, sunrise line, the full score table) and site data when
  zoomed in (elevations, azimuths, elevation chart, score).

## How sites are ranked

A site is recommended when the Sun is up and Earth is in view on the landing
date and both stay that way for at least 5 days. Score out of 100:
60% time with both after landing (capped at 14 days), 20% share of the lunar
day in sunlight, 20% share with Earth in view. The rule lives in `evaluate()`
in `app.js`.

Only Sun and Earth geometry goes into the score. Terrain, slopes, hazards and
temperature are not included.

## Files

- `index.html`, `style.css`, `app.js`: the page.
- `globe.js`: the 3D Moon (WebGL2, no libraries). The surface is generated, not
  a photo. To use a real map, save an equirectangular Moon image (0 degrees
  longitude in the centre) as `moon.jpg` in this folder and run through `server.py`.
- `ephem.js`: Sun and Earth positions seen from the Moon, computed in the browser.
- `sites.js`: the site list. Add a site by adding one line.
- `server.py`: optional local server with a small proxy to the JPL Horizons API.

## Limits to know about

- `ephem.js` is an approximate model (truncated Meeus lunar theory). It matched
  Meeus's worked examples to about 0.03 degrees and the Apollo 11 landing Sun
  elevation (10.7 vs 10.8 degrees published).
- The horizon is a smooth sphere. Near the poles terrain decides most of the
  real lighting, so polar results are optimistic or pessimistic by site.
- Site coordinates are approximate.
- The Horizons proxy has not been tested against the live API.
# LunarSitePicker
