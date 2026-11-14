/* Approximate Sun and Earth positions as seen from the lunar surface.
   Method: truncated Meeus lunar theory (Astronomical Algorithms ch. 47),
   low-precision Sun (ch. 25), optical librations via Cassini's laws (ch. 53).
   Smooth-sphere horizon, no terrain, no physical librations.
   Expected error: roughly 0.05-0.1 degrees. Not for flight use. */
var Ephem = (function () {
  var RAD = Math.PI / 180, R_MOON = 1737.4, AU = 149597870.7, INCL = 1.54242 * RAD;
  // [D, M, M', F, lon coeff (1e-6 deg), dist coeff (1e-3 km)]
  var LR = [
    [0,0,1,0,6288774,-20905355],[2,0,-1,0,1274027,-3699111],[2,0,0,0,658314,-2955968],
    [0,0,2,0,213618,-569925],[0,1,0,0,-185116,48888],[0,0,0,2,-114332,-3149],
    [2,0,-2,0,58793,246158],[2,-1,-1,0,57066,-152138],[2,0,1,0,53322,-170733],
    [2,-1,0,0,45758,-204586],[0,1,-1,0,-40923,-129620],[1,0,0,0,-34720,108743],
    [0,1,1,0,-30383,104755],[2,0,0,-2,15327,10321],[0,0,1,2,-12528,0],
    [0,0,1,-2,10980,79661],[4,0,-1,0,10675,-34782],[0,0,3,0,10034,-23210],
    [4,0,-2,0,8548,-21636],[2,1,-1,0,-7888,24208],[2,1,0,0,-6766,30824],
    [1,0,-1,0,-5163,-8379],[1,1,0,0,4987,-16675],[2,-1,1,0,4036,0],
    [2,0,2,0,3994,0],[4,0,0,0,3861,0],[2,0,-3,0,3665,0]
  ];
  // [D, M, M', F, lat coeff (1e-6 deg)]
  var B = [
    [0,0,0,1,5128122],[0,0,1,1,280602],[0,0,1,-1,277693],[2,0,0,-1,173237],
    [2,0,-1,1,55413],[2,0,-1,-1,46271],[2,0,0,1,32573],[0,0,2,1,17198],
    [2,0,1,-1,9266],[0,0,2,-1,8822],[2,-1,0,-1,8216],[2,0,-2,-1,4324],
    [2,0,1,1,4200],[2,1,0,-1,-3359],[2,-1,-1,1,2463],[2,-1,0,1,2211],
    [2,-1,-1,-1,2065],[0,1,-1,-1,-1870],[4,0,-1,-1,1828],[0,1,0,1,-1794]
  ];
  function norm180(d) { d = ((d + 180) % 360 + 360) % 360 - 180; return d; }

  // ms: JS timestamp (UTC). Returns sub-Earth and sub-solar points and distances.
  function state(ms) {
    var jde = ms / 86400000 + 2440587.5 + 69 / 86400;
    var T = (jde - 2451545) / 36525;
    var Lp = 218.3164477 + 481267.88123421 * T,
        D = (297.8501921 + 445267.1114034 * T) * RAD,
        M = (357.5291092 + 35999.0502909 * T) * RAD,
        Mp = (134.9633964 + 477198.8675055 * T) * RAD,
        F = (93.2720950 + 483202.0175233 * T) * RAD,
        Om = (125.0445479 - 1934.1362891 * T) * RAD,
        E = 1 - 0.002516 * T - 0.0000074 * T * T;
    var A1 = (119.75 + 131.849 * T) * RAD, A2 = (53.09 + 479264.290 * T) * RAD,
        A3 = (313.45 + 481266.484 * T) * RAD, LpR = Lp * RAD;
    var sl = 0, sr = 0, sb = 0, i, t, a, e;
    for (i = 0; i < LR.length; i++) {
      t = LR[i]; a = t[0] * D + t[1] * M + t[2] * Mp + t[3] * F;
      e = t[1] === 0 ? 1 : E;
      sl += t[4] * e * Math.sin(a); sr += t[5] * e * Math.cos(a);
    }
    for (i = 0; i < B.length; i++) {
      t = B[i]; a = t[0] * D + t[1] * M + t[2] * Mp + t[3] * F;
      sb += t[4] * (t[1] === 0 ? 1 : E) * Math.sin(a);
    }
    sl += 3958 * Math.sin(A1) + 1962 * Math.sin(LpR - F) + 318 * Math.sin(A2);
    sb += -2235 * Math.sin(LpR) + 382 * Math.sin(A3) + 175 * Math.sin(A1 - F) +
          175 * Math.sin(A1 + F) + 127 * Math.sin(LpR - Mp) - 115 * Math.sin(LpR + Mp);
    var lam = Lp + sl / 1e6, bet = sb / 1e6, dist = 385000.56 + sr / 1000;

    // Sun (geocentric ecliptic longitude and distance)
    var C = (1.914602 - 0.004817 * T) * Math.sin(M) + 0.019993 * Math.sin(2 * M) +
            0.000289 * Math.sin(3 * M);
    var sunLam = 280.46646 + 36000.76983 * T + C;
    var ecc = 0.016708634 - 0.000042037 * T;
    var sunR = 1.000001018 * (1 - ecc * ecc) / (1 + ecc * Math.cos(M + C * RAD)) * AU;

    function lib(lamDeg, betDeg) {
      var W = lamDeg * RAD - Om, b = betDeg * RAD;
      var A = Math.atan2(Math.sin(W) * Math.cos(b) * Math.cos(INCL) - Math.sin(b) * Math.sin(INCL),
                         Math.cos(W) * Math.cos(b));
      return {
        lon: norm180((A - F) / RAD),
        lat: Math.asin(-Math.sin(W) * Math.cos(b) * Math.sin(INCL) - Math.sin(b) * Math.cos(INCL)) / RAD
      };
    }
    var ratio = dist / sunR;
    var lamH = sunLam + 180 + ratio * 57.296 * Math.cos(bet * RAD) * Math.sin((sunLam - lam) * RAD);
    var betH = ratio * bet;
    return { lam: lam, bet: bet, dist: dist, sunDist: sunR,
             subEarth: lib(lam, bet), subSun: lib(lamH, betH) };
  }

  function topo(sub, bodyDist, lat, lon) {
    var p = lat * RAD, l = lon * RAD, bl = sub.lon * RAD, bb = sub.lat * RAD;
    var up = [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)];
    var east = [-Math.sin(l), Math.cos(l), 0];
    var north = [-Math.sin(p) * Math.cos(l), -Math.sin(p) * Math.sin(l), Math.cos(p)];
    var v = [bodyDist * Math.cos(bb) * Math.cos(bl) - R_MOON * up[0],
             bodyDist * Math.cos(bb) * Math.sin(bl) - R_MOON * up[1],
             bodyDist * Math.sin(bb) - R_MOON * up[2]];
    var n = Math.hypot(v[0], v[1], v[2]);
    var dot = function (a) { return (v[0] * a[0] + v[1] * a[1] + v[2] * a[2]) / n; };
    var az = Math.atan2(dot(east), dot(north)) / RAD;
    return { el: Math.asin(dot(up)) / RAD, az: (az + 360) % 360 };
  }

  // Elevation and azimuth of Sun and Earth at a site (degrees; azimuth clockwise from north).
  function at(s, lat, lon) {
    return { sun: topo(s.subSun, s.sunDist, lat, lon),
             earth: topo(s.subEarth, s.dist, lat, lon), state: s };
  }
  function look(lat, lon, ms) { return at(state(ms), lat, lon); }
  return { state: state, look: look, at: at };
})();
if (typeof module !== 'undefined') module.exports = Ephem;
