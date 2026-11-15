/* AI (SI) tool use: written with AI assistance (Anthropic Claude). Displayed values come from NASA data, not from a model. See AI_USE.md. */
/* Terrain horizon from a south-polar elevation grid. Used in the browser for picked
   spots (coarse grid) and by web/tools/make_fake_data.js (full 120 m grid).
   Grid: square, south polar stereographic, 0 deg longitude up, 90 deg E right,
   heights in metres relative to the 1737.4 km sphere. Bilinear sampling.
   Elevation angle uses the exact spherical form, no refraction. */
var Terrain = (function () {
  var R = 1737400, RAD = Math.PI / 180;

  // grid = { n, px (metres per pixel), at(i) -> height in metres at flat index i }
  function height(g, ux, uy, uz) {
    var k = 2 * R / (1 - uz) / g.px, half = g.n / 2;
    var fx = half + k * uy - 0.5, fy = half - k * ux - 0.5;
    var x0 = Math.floor(fx), y0 = Math.floor(fy);
    if (x0 < 0 || y0 < 0 || x0 >= g.n - 1 || y0 >= g.n - 1) return null;
    var tx = fx - x0, ty = fy - y0, i = y0 * g.n + x0;
    return (g.at(i) * (1 - tx) + g.at(i + 1) * tx) * (1 - ty) + (g.at(i + g.n) * (1 - tx) + g.at(i + g.n + 1) * tx) * ty;
  }
  function unit(lat, lon) { var a = lat * RAD, o = lon * RAD; return [Math.cos(a) * Math.cos(o), Math.cos(a) * Math.sin(o), Math.sin(a)]; }
  function heightAt(g, lat, lon) { var u = unit(lat, lon); return height(g, u[0], u[1], u[2]); }

  // Skyline elevation angle (degrees) per azimuth bin, clockwise from north, for each mast height.
  // Returns null when the site is off the grid. opts: nAz (720), maxRange metres (150000).
  function horizon(g, lat, lon, masts, opts) {
    opts = opts || {};
    var nAz = opts.nAz || 720, maxRange = opts.maxRange || 150000;
    var a = lat * RAD, o = lon * RAD, up = unit(lat, lon);
    var east = [-Math.sin(o), Math.cos(o), 0];
    var north = [-Math.sin(a) * Math.cos(o), -Math.sin(a) * Math.sin(o), Math.cos(a)];
    var ground = height(g, up[0], up[1], up[2]);
    if (ground == null) return null;
    var dists = [], d = g.px / 2;
    while (d < maxRange) { dists.push(d); d += Math.max(g.px / 2, d * 0.005); }
    var cs = dists.map(function (x) { return Math.cos(x / R); }), sn = dists.map(function (x) { return Math.sin(x / R); });
    var out = masts.map(function () { return new Array(nAz); }), complete = true;
    for (var b = 0; b < nAz; b++) {
      var az = b * (360 / nAz) * RAD, ca = Math.cos(az), sa = Math.sin(az);
      var tx = ca * north[0] + sa * east[0], ty = ca * north[1] + sa * east[1], tz = ca * north[2] + sa * east[2];
      var best = masts.map(function () { return -Math.PI / 2; });
      for (var j = 0; j < dists.length; j++) {
        var c = cs[j], s = sn[j];
        var h = height(g, c * up[0] + s * tx, c * up[1] + s * ty, c * up[2] + s * tz);
        if (h == null) { complete = false; break; }
        var r1 = R + h;
        for (var m = 0; m < masts.length; m++) {
          var e = Math.atan2(r1 * c - (R + ground + masts[m]), r1 * s);
          if (e > best[m]) best[m] = e;
        }
      }
      for (m = 0; m < masts.length; m++) out[m][b] = best[m] / RAD;
    }
    return { ground: ground, elev: out, complete: complete };
  }

  // Smooth-sphere horizon dip for an observer h metres above the sphere (degrees, negative).
  function dip(h) { return -Math.acos(R / (R + h)) / RAD; }

  // Rebuild a grid from delta-coded, quantised int16 values (see web/tools/build_terrain.py).
  function fromDeltas(n, px, quant, bytes) {
    var v = new Int16Array(bytes.buffer, bytes.byteOffset, n * n), acc = 0;
    var data = new Int16Array(n * n);
    for (var i = 0; i < data.length; i++) { acc += v[i]; data[i] = acc; }
    return { n: n, px: px, at: function (i) { return data[i] * quant; } };
  }
  return { height: height, heightAt: heightAt, horizon: horizon, dip: dip, fromDeltas: fromDeltas, R: R };
})();
if (typeof module !== 'undefined') module.exports = Terrain;
