# Lunar landing site navigator

A planning tool for the "launch slipped, can we still land?" question. Set the planned
landing date and the stay, drag the launch-slip slider, and watch which sites still work.
Open a site that stops working and the tool offers two ways out: switch to a site that
works on the new date, or land later at the same site.

## Run it

Double-click `index.html`. No server, no build step, works offline.

## Where the numbers come from

The page reads one data file in the format of `docs/data-contract.md`:

- `web/data/navigator-data.js` if precompute has written it, otherwise
- `web/data/navigator-data.fake.js`, a FAKE fixture of the same shape. While it is in use
  an orange "FAKE DATA" banner is shown.

Visibility is derived in the browser (contract section 7): share of the Sun's disc above
the skyline, Earth's centre above the skyline, for the chosen mast height. The rules are
editable under "Technical data".

A site counts as available for a landing date when the Sun and Earth are both visible at
landing and for at least half of the stay (also editable).

## Using it

- Top bar: planned landing, launch slip (drag, or arrow keys), stay in days.
- Left list: the analysed sites, best first; "Past landings" opens a reference list.
- Moon: drag to turn, scroll to zoom, click a pin to open a site, click the Moon or press
  Esc to close it, double-click the surface to inspect any spot.
- Inside a site: Space plays the stay, arrow keys step through time.
- "Technical data": Moon data, availability rules, a coordinate box to inspect any
  latitude and longitude, the full site table, and per-site angles and charts.

## Three kinds of site

| Kind | Sun and Earth angles | Skyline |
|---|---|---|
| Analysed (in the data file) | from the file | from the file |
| Past landings and picked spots south of 80° S | derived in the browser from the first analysed site's angles | coarse 720 m grid (`web/data/terrain-lowres.js`) |
| Everything else | derived the same way | smooth sphere |

Derived angles were checked against the file for the other four sites: they agree to 0.01°.

## Files

- `index.html`, `app.js`, `style.css`, `globe.js`: the interface.
- `web/terrain.js`: terrain-horizon code (browser and tools). Checks: `node web/tools/test_terrain.js`
  (flat sphere against the analytic dip, synthetic walls, azimuth direction).
- `web/data/past-landings.js`: 27 past soft landings, approximate coordinates.
- `web/tools/make_fake_data.js`: writes the fake fixture (needs `data/LDEM_75S_120M.IMG`).
- `web/tools/build_terrain.py`: writes the coarse terrain grid (numpy).
- `web/tools/build_texture.py`: embeds a sharper NASA Moon map (`--8k` for the largest).
- `moon-texture.js`: the embedded Moon map the globe uses.

No longer loaded by the page: `sites.js`, `horizons.js`, `build_data.py`, `server.py`.
`ephem.js` is only used by the fake-data generator.
