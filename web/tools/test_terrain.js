/* Checks for web/terrain.js. Run: node web/tools/test_terrain.js
   (a) flat sphere gives the analytic dip -acos(R/(R+h));
   (b) a synthetic wall of known height and distance gives the analytic angle;
   (c) azimuth convention: a wall due east shows up in the 90 degree bin. */
var T = require('../terrain.js');
var R = T.R, RAD = Math.PI / 180, fail = 0;
function check(name, got, want, tol) {
  var ok = Math.abs(got - want) <= tol; if (!ok) fail++;
  console.log((ok ? 'ok   ' : 'FAIL ') + name + ': got ' + got.toFixed(4) + ', expected ' + want.toFixed(4) + ' (tolerance ' + tol + ')');
}
function grid(n, px, fn) {
  var d = new Float32Array(n * n), half = n / 2;
  for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) d[y * n + x] = fn((x + 0.5 - half) * px, (half - y - 0.5) * px);
  return { n: n, px: px, at: function (i) { return d[i]; } };
}
// (a) flat sphere, two mast heights
var flat = grid(3000, 120, function () { return 0; });
var h = T.horizon(flat, -88, 40, [2, 10], { maxRange: 150000 });
check('flat sphere, 2 m mast, north', h.elev[0][0], T.dip(2), 0.003);
check('flat sphere, 2 m mast, south-west', h.elev[0][450], T.dip(2), 0.003);
check('flat sphere, 10 m mast', h.elev[1][100], T.dip(10), 0.003);
// (b) wall: everything farther than 20 km from the site is 1500 m high
var lat = -88, lon = 40;
var r = 2 * R * Math.tan((90 + lat) * RAD / 2), sx = r * Math.sin(lon * RAD), sy = r * Math.cos(lon * RAD);
var wall = grid(3000, 120, function (x, y) { return Math.hypot(x - sx, y - sy) > 20000 ? 1500 : 0; });
var hw = T.horizon(wall, lat, lon, [2], { maxRange: 150000 });
var th = 20000 / R, want = Math.atan2((R + 1500) * Math.cos(th) - (R + 2), (R + 1500) * Math.sin(th)) / RAD;
check('ring wall 1500 m at 20 km, north', hw.elev[0][0], want, 0.06);
check('ring wall 1500 m at 20 km, azimuth 200', hw.elev[0][400], want, 0.06);
// (c) wall only on the east side (larger longitude side at a south-polar site)
var e = [-Math.sin(lon * RAD), Math.cos(lon * RAD)];            // east unit vector, equatorial plane (x toward lon 0, y toward lon 90)
var eastWall = grid(3000, 120, function (x, y) {
  // map x = r sin(lon) -> body y; map y = r cos(lon) -> body x
  var dx = y - sy, dy = x - sx, along = dx * e[0] + dy * e[1];
  return along > 20000 ? 1500 : 0;
});
var he = T.horizon(eastWall, lat, lon, [2], { maxRange: 150000 });
check('east wall seen at azimuth 90', he.elev[0][180], want, 0.06);
check('east wall not seen at azimuth 270', he.elev[0][540], T.dip(2), 0.003);
console.log(fail ? fail + ' check(s) FAILED' : 'all checks passed');
process.exit(fail ? 1 : 0);
