/* Writes the FAKE full-shape fixture web/data/navigator-data.fake.{json,js} in the shape of
   docs/data-contract.md v1.0 (8760 hourly samples, 720 horizon bins, masts 2 and 10 m).

       node web/tools/make_fake_data.js      (needs data/LDEM_75S_120M.IMG)

   It exists so the interface can be built before precompute/ delivers. It is NOT the
   validated pipeline: positions come from the old truncated-Meeus ephem.js (not Skyfield,
   geometric not apparent), horizons use only the 120 m far-field grid (no 5 m tiles), and
   the site coordinates are unverified placeholders nudged to nearby high ground.
   Every consumer must treat the output as fake ("fake": true). */
var fs = require('fs'), path = require('path');
var ROOT = path.join(__dirname, '..', '..');
var Ephem = require(path.join(ROOT, 'ephem.js')), Terrain = require(path.join(ROOT, 'web', 'terrain.js'));
var R = Terrain.R, RAD = Math.PI / 180, N = 7624, PX = 120.00684643669544;

var buf = fs.readFileSync(path.join(ROOT, 'data', 'LDEM_75S_120M.IMG'));
var dem = new Int16Array(buf.buffer, buf.byteOffset, N * N);
var grid = { n: N, px: PX, at: function (i) { return dem[i] * 0.5; } };

var NOMINAL = [
  { id: 'connecting-ridge', name: 'Connecting Ridge', pgda: 'Site01', lat: -89.45, lon: -137.31 },
  { id: 'shackleton-rim', name: 'Shackleton Rim', pgda: 'Site04', lat: -89.78, lon: -155.73 },
  { id: 'malapert-massif', name: 'Malapert Massif', pgda: null, lat: -85.99, lon: -2.9 },
  { id: 'haworth', name: 'Haworth', pgda: null, lat: -86.8, lon: -22.0 },
  { id: 'nobile-rim-2', name: 'Nobile Rim 2', pgda: null, lat: -83.95, lon: 58.8 }
];
// Move each placeholder to the highest ground within 3 km, so the fake sites sit on ridges like real candidates do.
function snap(s) {
  var r = 2 * R * Math.tan((90 + s.lat) * RAD / 2), X = r * Math.sin(s.lon * RAD), Y = r * Math.cos(s.lon * RAD), best = null;
  for (var dx = -3000; dx <= 3000; dx += 120) for (var dy = -3000; dy <= 3000; dy += 120) {
    if (dx * dx + dy * dy > 9e6) continue;
    var x = X + dx, y = Y + dy, h = dem[Math.floor(N / 2 - y / PX) * N + Math.floor(N / 2 + x / PX)] * 0.5;
    if (!best || h > best.h) best = { h: h, x: x, y: y };
  }
  var rr = Math.hypot(best.x, best.y);
  return { lat: +(-90 + 2 * Math.atan(rr / (2 * R)) / RAD).toFixed(4), lon: +(Math.atan2(best.x, best.y) / RAD).toFixed(4) };
}
var r2 = function (v) { return Math.round(v * 100) / 100; }, r3 = function (v) { return Math.round(v * 1000) / 1000; };
var START = Date.UTC(2027, 0, 1), COUNT = 8760, H = 3600000;

var sites = NOMINAL.map(function (s) {
  var p = snap(s), hz = Terrain.horizon(grid, p.lat, p.lon, [2, 10], { nAz: 720, maxRange: 150000 });
  console.log(s.id, p.lat, p.lon, 'ground', Math.round(hz.ground), 'm, skyline', Math.min.apply(null, hz.elev[0]).toFixed(2), 'to', Math.max.apply(null, hz.elev[0]).toFixed(2));
  return {
    id: s.id, name: s.name, pgda_site: s.pgda, terrain: 'dem', lat_deg: p.lat, lon_deg: p.lon, ground_elev_m: Math.round(hz.ground * 10) / 10,
    coord_source: { kind: 'paper', ref: 'FAKE', note: 'Unverified placeholder near ' + s.lat + ', ' + s.lon + ', moved to the highest ground within 3 km. Not a real site coordinate.' },
    dem: [{ file: 'LDEM_75S_120M.IMG', role: 'far-field', resolution_m: 120, extent_km: 914.9 }],
    horizons: [2, 10].map(function (m, i) { return { mast_height_m: m, max_range_km: 150, elev_deg: hz.elev[i].map(r2) }; }),
    sun: { alt_deg: [], az_deg: [] }, earth: { alt_deg: [], az_deg: [] }
  };
});
var sunD = [], earthD = [];
for (var k = 0; k < COUNT; k++) {
  var st = Ephem.state(START + k * H);
  sunD.push(r3(2 * Math.asin(695700 / st.sunDist) / RAD)); earthD.push(r3(2 * Math.asin(6371.0 / st.dist) / RAD));
  sites.forEach(function (s) {
    var v = Ephem.at(st, s.lat_deg, s.lon_deg);
    s.sun.alt_deg.push(r2(v.sun.el)); s.sun.az_deg.push(r2(v.sun.az) % 360);
    s.earth.alt_deg.push(r2(v.earth.el)); s.earth.az_deg.push(r2(v.earth.az) % 360);
  });
}
var out = {
  schema_version: '1.0', fake: true,
  _comment: 'FAKE DATA for building the interface. Old Meeus ephemeris, 120 m-only horizons, placeholder coordinates. Do not use for any result.',
  generated_utc: new Date().toISOString().slice(0, 19) + 'Z', generator: 'web/tools/make_fake_data.js (FAKE fixture, not precompute/build.py)',
  constants: { moon_radius_km: 1737.4 },
  ephemeris: { software: 'FAKE: ephem.js truncated Meeus', kernels: [], frame: 'mean-Earth/polar axis (approximate)', corrections: 'geometric, no light-time, no refraction' },
  time: { start_utc: '2027-01-01T00:00:00Z', step_s: 3600, count: COUNT },
  horizon_grid: { n_az: 720, step_deg: 0.5, bin0_center_deg: 0.0, sampling: 'single ray at bin centre' },
  bodies: { sun: { diam_deg: sunD }, earth: { diam_deg: earthD } },
  sites: sites
};
var json = JSON.stringify(out), dir = path.join(ROOT, 'web', 'data');
fs.writeFileSync(path.join(dir, 'navigator-data.fake.json'), json + '\n');
fs.writeFileSync(path.join(dir, 'navigator-data.fake.js'), '/* FAKE DATA fixture. Generated by web/tools/make_fake_data.js. Do not edit by hand. */\nvar NAV_DATA = ' + json + ';\n');
console.log('wrote navigator-data.fake.json/.js, ' + (json.length / 1e6).toFixed(2) + ' MB');
