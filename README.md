# Lunar landing site navigator

A planning tool: set a landing date and a length of stay, and the 3D Moon shows
the landing sites that suit that mission as ranked pins. Click a pin to inspect
the site: the view from the surface with the real skyline, and the Sun and Earth
moving through the stay.

## Run it

1. Double-click `index.html`. It works offline.
2. For real NASA imagery and terrain, run this once in the folder (Python 3, internet):

       python build_data.py            (116 MB download, 120 m terrain)
       python build_data.py --small    (29 MB download, 240 m terrain)

   It writes `moon-texture.js` (the Moon's surface photo map) and `horizons.js`
   (the terrain skyline for each south-pole site), then reload the page.
   Downloads are kept in `data/` and reused.

Without step 2 the tool tries NASA's live Moon Trek image tiles for the surface
and uses a smooth-sphere horizon. The status bar at the bottom always says which
surface map and which skyline are in use.

## Using it

- Top bar: landing date, stay in days, take-off date. Stay and take-off are linked.
- Left list: recommended sites, best first. "Site list" hides or shows it.
- Moon: drag to turn, scroll to zoom, click a pin to inspect, double-click the
  surface to test your own spot.
- Inside a site: click the Moon (or press Esc) to go back. Space plays the stay,
  arrow keys step through it. On the whole Moon, arrow keys move the landing date.
- "Technical data" adds whole-Moon data and the score table on the main view,
  and elevations, skyline heights and a chart inside a site.

## How sites are ranked

Score = share of the stay with both sunlight and Earth in view (0 to 100).
A site is recommended when both are there at landing and the score is at least 75.
Ties go to the site that keeps both longest after take-off (schedule margin).
The rule is `evaluate()` in `app.js`.

## Data and limits

- Sun and Earth positions: `ephem.js`, a truncated Meeus lunar theory. Checked
  against Meeus's worked examples (about 0.03 degrees) and the Apollo 11 landing.
- Skyline: NASA LOLA elevation model LDEM_75S (imbrium.mit.edu), seen from 2 m
  above the ground, out to 250 km, every 2 degrees of azimuth. It resolves
  mountains and crater rims, not boulders. Only sites south of 79 S get terrain;
  other sites and custom spots use a smooth sphere.
- Surface map: NASA SVS CGI Moon Kit colour map (2k), or Moon Trek LRO tiles.
- Slopes, landing hazards and temperature are not part of the score.
- Site coordinates are approximate.
- `server.py` is optional and only needed for the "Check against JPL Horizons" button.
