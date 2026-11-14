/*
 * <moon-sky> - first-person view from a point on the lunar surface (WebGL2, no dependencies).
 * Classic script, so the page also works when opened from file://. Data files are scripts in this
 * folder (built by web/tools/build_moonsky_data.py) and are loaded on demand with <script> tags.
 *
 *   <moon-sky embedded></moon-sky>
 *   el.configure({ sky, skyline, height })     optional hooks (see below)
 *   el.setSite(lat, lon, label)                 -> Promise, resolves when the terrain is ready
 *   el.setWindow(t0ms, t1ms); el.setTime(ms)    path span and current time (UTC ms)
 *   el.setTracking(true|false)                  keep the Sun centred (drag is locked meanwhile)
 *   el.setEyeHeight(m); el.lookAt(az, alt, fov)
 *
 * Hooks let a host app stay the single source of truth:
 *   sky(t)      -> { sun:{alt,az,diam}, earth:{alt,az,diam} } in degrees, or null (then the built-in
 *                  Skyfield/DE421 ephemeris is used). Stars and Earth's rotation always use it.
 *   skyline(az) -> terrain horizon elevation (deg) at azimuth az, or null. When given, the far terrain
 *                  is bent so the drawn skyline matches it, nothing nearer pokes above it, and
 *                  visibility (labels, the hidden-Sun ring) uses it.
 *   height(lat, lon) -> ground height (m, 1737.4 km sphere) or null (then LOLA LDEM_16 is used).
 *
 * Event 'moonsky-progress' (detail: { label, frac 0..1 }) is fired while a site is being built, so a host
 * can show a loading screen.
 *
 * Without 'embedded' it is a standalone viewer with its own location, date and time controls.
 */
(function () {
'use strict';
const SCRIPT_BASE = ((document.currentScript && document.currentScript.src) || '').replace(/[^/]*$/, '');

const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const MOON_R = 1737400;          // m, LOLA reference sphere
const EYE_H = 1.7;               // m
const RMAX = 200000;             // terrain radius around the observer (m)
const SEGS = 360;                // azimuth segments of the terrain mesh (1 deg)
const HM_N = 1024;               // coarse shadow heightmap (+-RMAX)
const HM1_N = 1024, HM1_L = 1500; // fine shadow heightmap (+-1.5 km, ~3 m)
const NEAR = 0.3, FAR = 450000;

const PRESETS = [
  ['Apollo 11 · Tranquility Base', 0.674, 23.473], ['Apollo 12 · Ocean of Storms', -3.012, -23.422],
  ['Apollo 14 · Fra Mauro', -3.645, -17.471], ['Apollo 15 · Hadley–Apennine', 26.132, 3.634],
  ['Apollo 16 · Descartes', -8.973, 15.5], ['Apollo 17 · Taurus–Littrow', 20.191, 30.772],
  ['Copernicus crater (floor)', 9.62, -20.08], ['Tycho crater (floor)', -43.31, -11.36],
  ['Shackleton rim · south pole', -89.45, -137.0], ['Malapert massif · south pole', -86.0, 0.0],
  ['North pole region', 89.5, 0.0], ['Mare Smythii · east limb', -1.3, 87.0],
  ["Chang'e 4 · far side", -45.457, 177.588], ['Far side centre', 0.0, 180.0],
];

// ------------------------------------------------------------------ math helpers
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len3 = a => Math.hypot(a[0], a[1], a[2]);
const norm3 = a => { const l = len3(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
// 3x3 matrices are row-major arrays of 9
const m3mul = (a, b) => { const o = []; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o.push(a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]); return o; };
const m3vec = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
const m3T = m => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];   // transpose (= GL column-major)
const quatToM3 = ([w, x, y, z]) => [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
  2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
const m4mul = (a, b) => { const o = new Float32Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]; return o; };
const persp = (fovY, asp, n, f) => { const t = 1 / Math.tan(fovY / 2); return new Float32Array([t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, 2 * f * n / (n - f), 0]); };
const dirAltAz = (alt, az) => { const a = alt * D2R, z = az * D2R; return [Math.cos(a) * Math.sin(z), Math.cos(a) * Math.cos(z), Math.sin(a)]; };
const altAz = d => [Math.asin(clamp(d[2], -1, 1)) * R2D, (Math.atan2(d[0], d[1]) * R2D + 360) % 360];
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const compass = az => COMPASS[Math.round(((az % 360) + 360) % 360 / 22.5) % 16];
const fmtUTC = ms => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
const fmtLat = v => `${Math.abs(v).toFixed(2)}°${v >= 0 ? 'N' : 'S'}`;
const fmtLon = v => { v = ((v + 540) % 360) - 180; return `${Math.abs(v).toFixed(2)}°${v >= 0 ? 'E' : 'W'}`; };

// ------------------------------------------------------------------ data access (script tags, works on file://)
const REG = {}, WAIT = {};
if (!window.MoonSkyData) window.MoonSkyData = {
  put(key, val) { REG[key] = val; const w = WAIT[key]; if (w) { delete WAIT[key]; w.forEach(p => p.res(val)); } },
};
function loadJS(base, key) {
  if (key in REG) return Promise.resolve(REG[key]);
  return new Promise((res, rej) => {
    if (WAIT[key]) { WAIT[key].push({ res, rej }); return; }
    WAIT[key] = [{ res, rej }];
    const sc = document.createElement('script');
    sc.async = true; sc.src = base + key + '.js';
    const fail = msg => { const w = WAIT[key]; delete WAIT[key]; (w || []).forEach(p => p.rej(new Error(msg))); };
    sc.onload = () => { sc.remove(); if (WAIT[key]) fail('Bad data file ' + sc.src); };
    sc.onerror = () => { sc.remove(); fail('Missing data file ' + sc.src); };
    document.head.appendChild(sc);
  });
}
// Lets a host page share the same data files (e.g. the star catalogue for a background star map).
window.MoonSkyData.load = key => loadJS(SCRIPT_BASE, key);
const b64bytes = str => { const bin = atob(str), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
const inflate = u8 => new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer();

class MoonData {
  constructor(base) {
    this.base = base && !base.endsWith('/') ? base + '/' : base;
    this.years = new Map(); this.yearP = new Map(); this.tiles = new Map();
    this.heightHook = null;
  }
  async init() {
    try { this.meta = await loadJS(this.base, 'meta'); }
    catch (e) { throw new Error('3D view data not found (' + this.base + 'meta.js). Run web/tools/build_moonsky_data.py.'); }
    this.E = this.meta.ephem; this.D = this.meta.dem;
  }
  loadYear(y) {
    if (y < this.E.first || y > this.E.last) return Promise.reject(new Error(`Built-in ephemeris covers ${this.E.first}-${this.E.last} only`));
    if (!this.yearP.has(y)) this.yearP.set(y, loadJS(this.base, 'ephem/' + y).then(b => { this.years.set(y, new DataView(b64bytes(b).buffer)); }));
    return this.yearP.get(y);
  }
  ensureRange(t0, t1) {
    const p = [];
    for (let y = new Date(t0).getUTCFullYear(); y <= new Date(t1).getUTCFullYear(); y++) p.push(this.loadYear(y).catch(() => null));
    return Promise.all(p);
  }
  /** Sun/Earth vectors (km, Moon ME frame, from Moon centre) + ME<-ICRF quaternion at time t (ms). */
  ephem(t) {
    const y = new Date(t).getUTCFullYear(), dv = this.years.get(y);
    if (!dv) return null;
    const E = this.E, x = (t - Date.UTC(y, 0, 1)) / 864e5 + E.pad, i = Math.floor(x), f = x - i;
    const w = [-f * (f - 1) * (f - 2) / 6, (f + 1) * (f - 1) * (f - 2) / 2, -(f + 1) * f * (f - 2) / 2, (f + 1) * f * (f - 1) / 6];
    const a = new Float64Array(12);
    for (let k = 0; k < 4; k++) {
      const o = (i - 1 + k) * E.rec;
      for (let j = 0; j < 10; j++) a[j] += w[k] * dv.getInt16(o + 2 * j, true);
      a[10] += w[k] * dv.getUint16(o + 20, true); a[11] += w[k] * dv.getUint16(o + 22, true);
    }
    const ds = E.sun_d0 + a[10] * E.sun_ds, de = E.earth_d0 + a[11] * E.earth_ds;
    const su = norm3([a[0], a[1], a[2]]), eu = norm3([a[3], a[4], a[5]]), ql = Math.hypot(a[6], a[7], a[8], a[9]);
    return { sun: su.map(c => c * ds), earth: eu.map(c => c * de), q: [a[6] / ql, a[7] / ql, a[8] / ql, a[9] / ql] };
  }
  // ---- elevation: host hook first (e.g. a finer polar grid), else LOLA LDEM_16, bilinear on the re-gridded bands
  _idx(lat, lon) {
    const D = this.D, rows = 180 * D.ppd, y = (90 - lat) * D.ppd - 0.5, r0 = Math.floor(y);
    return [clamp(r0, 0, rows - 1), clamp(r0 + 1, 0, rows - 1), y - r0, ((lon % 360) + 360) % 360];
  }
  _row(r, lonE, need) {
    const D = this.D, b = (r / D.band_rows) | 0, B = D.bands[b], lr = r - b * D.band_rows;
    const x = lonE / 360 * B.n - 0.5, x0 = Math.floor(x), f = x - x0;
    const c0 = ((x0 % B.n) + B.n) % B.n, c1 = (c0 + 1) % B.n, s0 = (c0 / B.w) | 0, s1 = (c1 / B.w) | 0;
    if (need) { need.add(b * 1000 + s0); need.add(b * 1000 + s1); return 0; }
    const t0 = this.tiles.get(b * 1000 + s0), t1 = this.tiles.get(b * 1000 + s1);
    const v0 = t0 ? t0[lr * B.w + c0 - s0 * B.w] : 0, v1 = t1 ? t1[lr * B.w + c1 - s1 * B.w] : 0;
    return v0 + (v1 - v0) * f;
  }
  need(set, lat, lon) { const [ra, rb, , l] = this._idx(lat, lon); this._row(ra, l, set); this._row(rb, l, set); }
  height(lat, lon) {
    if (this.heightHook) { const h = this.heightHook(lat, lon); if (h != null && isFinite(h)) return h; }
    const [ra, rb, f, l] = this._idx(lat, lon); const a = this._row(ra, l), b = this._row(rb, l); return a + (b - a) * f;
  }
  async loadTiles(set, onTile) {
    const todo = [...set].filter(k => !this.tiles.has(k));
    let next = 0, done = 0;
    const worker = async () => {
      while (next < todo.length) {
        const k = todo[next++], b = Math.floor(k / 1000), s = k % 1000, B = this.D.bands[b];
        const a = new Int16Array(await inflate(b64bytes(await loadJS(this.base, `dem/${b}-${s}`))));
        for (let r = 0; r < this.D.band_rows; r++) { const o = r * B.w; for (let c = 1; c < B.w; c++) a[o + c] += a[o + c - 1]; }
        this.tiles.set(k, a);
        if (onTile) onTile(++done, todo.length);
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
  }
}

// Give the browser a frame to paint (loading screens) between heavy synchronous steps.
const yieldUI = () => new Promise(res => {
  let done = false; const go = () => { if (!done) { done = true; res(); } };
  requestAnimationFrame(() => setTimeout(go, 0)); setTimeout(go, 60);
});

// small-scale synthetic roughness (below the 1.9 km DEM resolution) — optional
function makeDetail(seed) {
  const hash = (x, y) => {
    let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) & 0xffff) / 65535 - 0.5;
  };
  const noise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  // small craters on a jittered grid at several scales (never one under the observer's feet)
  const hash3 = (x, y, s) => hash(x * 7 + s * 1013, y * 13 - s * 7919) + 0.5;
  const CELLS = [24, 80, 260];
  const craters = (x, y) => {
    let h = 0;
    for (let s = 0; s < CELLS.length; s++) {
      const c = CELLS[s], ix = Math.floor(x / c), iy = Math.floor(y / c);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const gx = ix + dx, gy = iy + dy;
        if (hash3(gx, gy, s) > 0.55) continue;
        const r = c * (0.12 + 0.3 * hash3(gy, gx, s + 9)), cx = (gx + hash3(gx, gy, s + 3)) * c, cy = (gy + hash3(gx, gy, s + 5)) * c;
        if (Math.hypot(cx, cy) < 1.3 * r + 2) continue;
        const d = Math.hypot(x - cx, y - cy) / r;
        if (d >= 3) continue;
        const age = 0.3 + 0.7 * hash3(gx, gy, s + 7), depth = 0.17 * r * age, rim = 0.035 * r * age;
        h += d < 1 ? depth * (d * d - 1) + rim : rim * (1 / (d * d * d) - 1 / 27) * (27 / 26);
      }
    }
    return h;
  };
  return (x, y) => { let s = 0, lam = 1024, amp = 7; for (let o = 0; o < 8; o++) { s += amp * noise(x / lam + o * 17.3, y / lam - o * 9.1); lam /= 2; amp *= 0.5; } return s + craters(x, y); };
}

// ------------------------------------------------------------------ shaders
const LOGDEPTH = 'gl_FragDepth = log2(vW) * uLogF * 0.5;';
const SH = {
  terrainV: `#version 300 es
    in vec3 aPos; in vec3 aNor; uniform mat4 uVP; out vec3 vP; out vec3 vN; out float vW;
    void main(){ vP=aPos; vN=aNor; gl_Position=uVP*vec4(aPos,1.); vW=1.+gl_Position.w; }`,
  terrainF: `#version 300 es
    precision highp float;
    in vec3 vP; in vec3 vN; in float vW;
    uniform vec3 uSun, uEarth, uEye; uniform float uSunI, uEarthI, uL, uL1, uExp, uLogF, uSunRad, uHMax, uShadow, uAmb;
    uniform sampler2D uHM, uHM1; out vec4 o;
    // two heightmaps: fine (~10 m) near the observer, coarse (~390 m) out to the horizon
    float hAt(vec2 xy, out float bias){
      if (abs(xy.x)<uL1 && abs(xy.y)<uL1) { bias = .6; return texture(uHM1, xy/(2.*uL1)+.5).r; }
      bias = 15.; return texture(uHM, xy/(2.*uL)+.5).r;
    }
    float shadow(vec3 p){
      bool far = abs(p.x)>uL1 || abs(p.y)>uL1;
      float k = 1., t = far ? 400. : 1.5, b;
      for (int i=0; i<170; i++){
        vec3 q = p + uSun*t;
        if (abs(q.x)>uL || abs(q.y)>uL || q.z>uHMax) break;
        float h = hAt(q.xy, b);
        k = min(k, (q.z - h + b)/t);
        if (k < -uSunRad) return 0.;
        t += max(1.5, t*.07);
      }
      return smoothstep(-uSunRad, uSunRad, k);
    }
    void main(){
      vec3 n = normalize(vN), v = normalize(uEye - vP);
      float mu0 = dot(n,uSun), mu = max(dot(n,v),0.), lit = 0.;
      if (uSunI>0. && mu0>0.) {
        float s = uShadow>.5 ? shadow(vP + n*1.5) : 1.;
        lit = uSunI*s*(.35*mu0 + .65*mu0/(mu0+mu+.05));      // Lambert + Lommel-Seeliger (regolith)
      }
      float es = uEarthI*max(dot(n,uEarth),0.);
      vec3 c = .6*(vec3(1.,.98,.95)*lit + vec3(.72,.84,1.)*es + uAmb);   // uAmb: faint fill so shadowed ridges stay visible against the black sky
      c = 1. - exp(-c*uExp);
      o = vec4(pow(c, vec3(1./2.2)), 1.);
      ${LOGDEPTH}
    }`,
  starV: `#version 300 es
    in vec3 aDir; in vec2 aMB; uniform mat4 uVP; uniform mat3 uM; uniform float uPx, uA; out vec3 vC; out float vA;
    void main(){
      gl_Position = uVP*vec4(uM*aDir,1.);
      float m = aMB.x, bv = clamp(aMB.y,-.4,2.);
      gl_PointSize = clamp(4.4-.6*m, 1.3, 7.)*uPx;
      vA = clamp(.3+.7*pow(10.,-.2*(m-1.)), .2, 1.)*uA;
      float t = (bv+.4)/2.4;
      vC = mix(vec3(.65,.75,1.), vec3(1.,.97,.9), smoothstep(0.,.4,t));
      vC = mix(vC, vec3(1.,.7,.45), smoothstep(.4,1.,t));
    }`,
  starF: `#version 300 es
    precision mediump float; in vec3 vC; in float vA; out vec4 o;
    void main(){ vec2 c=gl_PointCoord-.5; float a=exp(-dot(c,c)*16.); if(a<.03) discard; o=vec4(vC*a*vA,1.); }`,
  // thick screen-space lines; aS = arc length (radians) at each end, for dashes
  lineV: `#version 300 es
    in vec3 aA; in vec3 aB; in vec2 aC; in vec2 aS; uniform mat4 uVP; uniform vec2 uRes; uniform float uW; out float vS;
    void main(){
      vec4 a=uVP*vec4(aA,1.), b=uVP*vec4(aB,1.);
      vS = aC.x<.5 ? aS.x : aS.y;
      if (a.w<1e-3 || b.w<1e-3) { gl_Position=vec4(0.,0.,-2.,1.); return; }
      vec2 d=(b.xy/b.w-a.xy/a.w)*uRes; float l=length(d); d = l>1e-6 ? d/l : vec2(1.,0.);
      vec4 c = aC.x<.5 ? a : b;
      c.xy += vec2(-d.y,d.x)*aC.y*uW/uRes*c.w;
      gl_Position=c;
    }`,
  lineF: `#version 300 es
    precision highp float; uniform vec4 uCol; uniform float uDash; in float vS; out vec4 o;
    void main(){ if (uDash>0. && fract(vS/uDash)>.55) discard; o=uCol; }`,
  dotV: `#version 300 es
    in vec3 aA; uniform mat4 uVP; uniform float uPx; void main(){ gl_Position=uVP*vec4(aA,1.); gl_PointSize=uPx; }`,
  dotF: `#version 300 es
    precision mediump float; uniform vec4 uCol; out vec4 o;
    void main(){ if(length(gl_PointCoord-.5)>.5) discard; o=uCol; }`,
  bbV: `#version 300 es
    in vec2 aC; uniform mat4 uVP; uniform vec3 uDir; uniform vec2 uSize; out vec2 vUV;
    void main(){ vec4 c=uVP*vec4(uDir,1.); if(c.w<1e-3){gl_Position=vec4(0.,0.,-2.,1.);return;}
      c.xy += aC*uSize*c.w; gl_Position=c; vUV=aC; }`,
  sunF: `#version 300 es
    precision mediump float; in vec2 vUV; uniform float uG, uD, uV; out vec4 o;
    void main(){ float r=length(vUV)*uG;
      float disc = 1.-smoothstep(uD-.8, uD+.8, r);
      float glow = .55*exp(-max(r-uD,0.)/(uD*1.2+5.))*(1.-smoothstep(uG*.6,uG,r));
      o = vec4(vec3(1.,.97,.9)*(disc + glow*(1.-disc))*uV, 1.); }`,
  earthF: `#version 300 es
    precision highp float; in vec2 vUV; uniform mat3 uCam, uEF; uniform vec3 uSun; uniform sampler2D uTex; uniform float uRing; out vec4 o;
    void main(){ vec2 p=vUV*1.1; float r2=dot(p,p);
      if(r2>1.){ float r=sqrt(r2), a=uRing*exp(-pow((r-1.)/.025,2.)); if(a<.01) discard;   // sunlight refracted by Earth's atmosphere
        o=vec4(vec3(1.,.38,.16)*a, a); return; }
      vec2 q=p;
      vec3 nv=vec3(q,sqrt(1.-r2)), nw=uCam*nv, e=uEF*nw;
      float l=dot(nw,uSun), day=smoothstep(-.04,.1,l);
      vec2 uv=vec2(atan(e.y,e.x)/6.2831853+.5, .5-asin(clamp(e.z,-1.,1.))/3.1415927);
      vec3 c=texture(uTex,uv).rgb*(.25+.95*max(l,0.))*day;
      c += vec3(.3,.5,1.)*pow(1.-nv.z,3.)*day*.7;
      float edge = 1.-smoothstep(.96,1.,sqrt(r2));
      o=vec4(c*edge + vec3(.004,.006,.01)*(1.-day)*edge, edge); }`,
};

// ------------------------------------------------------------------ template
const TPL = `
<style>
:host{display:block;position:relative;height:480px;background:#000;color:#e6eaf4;overflow:hidden;
  font:12px/1.35 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;contain:content;user-select:none}
canvas{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;cursor:grab;outline:none}
canvas.drag{cursor:grabbing}
.lbls{position:absolute;inset:0;pointer-events:none;overflow:hidden}
.l{position:absolute;transform:translate(-50%,-50%);white-space:nowrap;text-shadow:0 0 3px #000,0 0 2px #000}
.l.c{font-weight:600;color:#cfd6e6}.l.c.m{font-weight:400;color:#8b94a8;font-size:10px}
.l.b{font-weight:600;transform:translate(-50%,-160%)}.l.sun{color:#fdc43a}.l.earth{color:#6fb4ff}
.l.d{font-size:10px;transform:translate(5px,-50%);opacity:.85}
.so,.eo{position:absolute;transform:translate(-50%,-50%);border:2px dashed #fdc43a;border-radius:50%;box-sizing:border-box;
  box-shadow:0 0 6px rgba(253,196,58,.45);pointer-events:none}
.eo{border-color:#6fb4ff;box-shadow:0 0 6px rgba(111,180,255,.45)}
.p{position:absolute;background:rgba(14,18,30,.84);border:1px solid rgba(140,155,190,.25);border-radius:8px;backdrop-filter:blur(4px)}
.top{top:8px;left:8px;right:8px;display:flex;gap:6px;align-items:center;padding:5px 6px;flex-wrap:wrap}
.top .w{flex:1;min-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-left:2px}
.top .w b{font-weight:600}
button,select,input{font:inherit;color:inherit;background:#161d30;border:1px solid rgba(140,155,190,.3);border-radius:5px;padding:4px 7px}
button{cursor:pointer}button:hover{background:#222b44}button.on{background:#2b4a85;border-color:#3d66ad}
.info{top:52px;right:8px;width:230px;padding:8px 10px;font-variant-numeric:tabular-nums}
.info .k{color:#8f99ad}.info .r{margin-top:5px}.dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:5px}
.panel{top:52px;left:8px;width:260px;max-height:calc(100% - 110px);overflow:hidden auto;padding:8px 10px;display:none}
.panel.open{display:block}
.panel h4{margin:8px 0 4px;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#8f99ad}
.panel h4:first-child{margin-top:0}
.row{display:flex;gap:6px;margin:4px 0}.row>*{flex:1;min-width:0}
.panel label.ck{display:flex;gap:6px;align-items:center;margin:3px 0;cursor:pointer}
.panel input[type=range]{width:100%;padding:0}
.cred{color:#7c869b;font-size:10px;margin-top:8px;line-height:1.4}
.bar{left:8px;right:8px;bottom:8px;display:flex;gap:8px;align-items:center;padding:5px 8px}
.bar input[type=range]{flex:1;padding:0;min-width:60px}
.bar .t{font-variant-numeric:tabular-nums;min-width:118px;text-align:right}
:host([embedded]) .bar,:host([embedded]) .info,:host([embedded]) .loc,
:host([embedded]) .panel,:host([embedded]) [data-a="menu"]{display:none}
:host([embedded]) .top{left:auto;background:rgba(12,14,19,.78)}
:host([embedded]) .top .w{display:none}
.msg{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;
  font-size:14px;background:rgba(0,0,0,.35);text-align:center;padding:20px}
.msg[hidden]{display:none}.err{color:#ff8a98}
@media (max-width:620px){.info{top:auto;bottom:52px;width:auto;left:8px;right:8px;font-size:11px}.panel{width:auto;right:8px}}
</style>
<canvas tabindex="0"></canvas>
<div class="lbls"></div>
<div class="p top">
  <button data-a="menu" title="Location, date & display">☰</button>
  <span class="w"></span>
  <button data-a="earth">Earth</button><button data-a="sun">Sun</button><button data-a="hor">Horizon</button>
</div>
<div class="p info"></div>
<div class="p panel">
  <div class="loc">
  <h4>Position on the Moon</h4>
  <select data-i="preset"></select>
  <div class="row"><input data-i="lat" type="number" step="0.01" min="-90" max="90" title="Latitude °N">
    <input data-i="lon" type="number" step="0.01" title="Longitude °E"></div>
  <div class="row"><button data-a="go">Go</button></div>
  <h4>Time (UTC)</h4>
  <input data-i="date" type="datetime-local" style="width:100%">
  <div class="row"><select data-i="span">
    <option value="1">1 day</option><option value="7">7 days</option><option value="29.53">1 lunar day (29.5 d)</option>
    <option value="365.25">1 year</option></select><button data-a="now">Now</button></div>
  </div>
  <h4>Display</h4>
  <label class="ck"><input type="checkbox" data-i="paths" checked>Sun &amp; Earth paths</label>
  <label class="ck"><input type="checkbox" data-i="stars" checked>Stars</label>
  <label class="ck"><input type="checkbox" data-i="grid">Alt/az grid</label>
  <label class="ck"><input type="checkbox" data-i="labels" checked>Labels</label>
  <label class="ck"><input type="checkbox" data-i="shadows" checked>Terrain shadows</label>
  <label class="ck"><input type="checkbox" data-i="detail" checked>Synthetic detail &lt; 2 km</label>
  <div>Sun/Earth size <span data-o="scale">1×</span></div><input data-i="scale" type="range" min="1" max="10" step="0.5" value="1">
  <div>Exposure</div><input data-i="exp" type="range" min="0.3" max="3" step="0.05" value="1">
  <div class="cred">Terrain: NASA LRO LOLA LDEM_16 (~1.9 km/px).<br>Sun &amp; Earth: JPL DE421 via Skyfield.<br>
    Stars: Yale Bright Star Cat. Earth: NASA Blue Marble.<br>Drag to look · wheel/pinch zoom · arrow keys</div>
</div>
<div class="p bar">
  <button data-a="play" title="Play / pause">▶</button>
  <select data-i="speed"><option value="1">1 h/s</option><option value="6" selected>6 h/s</option>
    <option value="24">1 d/s</option><option value="96">4 d/s</option><option value="720">30 d/s</option></select>
  <input data-i="time" type="range" min="0" max="10000" step="1" value="0">
  <span class="t"></span>
</div>
<div class="msg">Loading…</div>`;

// ------------------------------------------------------------------ component
class MoonSky extends HTMLElement {
  static observedAttributes = ['lat', 'lon', 'date', 'span'];

  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
    this.root.innerHTML = TPL;
    this.q = s => this.root.querySelector(s);
    this.i = n => this.q(`[data-i="${n}"]`);
    this.view = { yaw: 180, pitch: 10, fov: 70 };
    this.opt = { paths: true, stars: true, grid: false, labels: true, shadows: true, detail: true, skyline: true, earth: true, scale: 1, exp: 1 };   // earth: draw Earth, its path and labels
    this.dirty = true;
    this.eyeH = EYE_H;
    this.hooks = {};
    this.tracking = false;
    this._readyP = new Promise(r => { this._readyRes = r; });
  }
  get embedded() { return this.hasAttribute('embedded'); }

  connectedCallback() { if (!this._started) { this._started = true; this._init().catch(e => this._msg(e.message || String(e), true)); } }
  disconnectedCallback() { this._ro && this._ro.disconnect(); cancelAnimationFrame(this._raf); this._started = false; }
  attributeChangedCallback(name, _, v) {
    if (!this.ready || v == null) return;
    if (name === 'lat' || name === 'lon') this.setLocation(+this.getAttribute('lat'), +this.getAttribute('lon'));
    if (name === 'date') this.setTime(Date.parse(v));
    if (name === 'span') this._setWindow(this.win[0], +v);
  }

  _progress(label, frac) {
    this.dispatchEvent(new CustomEvent('moonsky-progress', { detail: { label, frac } }));
    if (!this.embedded && frac < 1) this._msg(`${label}… ${Math.round(frac * 100)}%`);
  }
  _msg(text, err) { const m = this.q('.msg'); m.hidden = !text; m.innerHTML = text ? `<span class="${err ? 'err' : ''}">${text}</span>` : ''; }

  async _init() {
    if (!('DecompressionStream' in window)) throw new Error('This browser is too old (no DecompressionStream).');
    const cv = this.q('canvas');
    const gl = cv.getContext('webgl2', { antialias: true, alpha: false });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl; this.cv = cv;
    this.floatLinear = !!gl.getExtension('OES_texture_float_linear');
    this._initGL();
    this._initUI();

    this.data = new MoonData(this.getAttribute('src') || SCRIPT_BASE);
    if (this.hooks.height) this.data.heightHook = this.hooks.height;
    this._msg('Loading data…');
    await this.data.init();
    this._loadStars(); this._loadEarthTex();
    this._ro = new ResizeObserver(() => { this.dirty = true; });
    this._ro.observe(this);

    const a = n => this.getAttribute(n);
    if (this.embedded && a('lat') == null) {        // the host calls setSite() / setWindow() / setTime()
      this.t = Date.now(); this.win = [this.t, this.t + 864e5]; this.span = 1;
      this._msg('');
      this.ready = true; this._readyRes();
      this._loop();
      return;
    }
    const lat = a('lat') != null ? +a('lat') : PRESETS[3][1], lon = a('lon') != null ? +a('lon') : PRESETS[3][2];
    let t0 = a('date') ? Date.parse(a('date')) : Date.now();
    if (!isFinite(t0)) t0 = Date.now();
    t0 = Math.floor(t0 / 36e5) * 36e5;
    this.span = +(a('span') || 29.53);
    this.i('span').value = String(this.span);
    this.t = t0; this.win = [t0, t0 + this.span * 864e5];
    if (a('az') != null) this.view.yaw = +a('az');
    if (a('alt') != null) this.view.pitch = +a('alt');
    if (a('fov') != null) this.view.fov = +a('fov');
    this.ready = true; this._readyRes();
    await this.setLocation(lat, lon, a('az') == null);
    this._loop();
  }

  // ---------------------------------------------------------------- public API
  async setLocation(lat, lon, faceTarget = true) {
    lat = clamp(+lat, -90, 90); lon = ((+lon + 540) % 360) - 180;
    if (!isFinite(lat) || !isFinite(lon)) return;
    const my = (this._locReq = (this._locReq || 0) + 1);
    this.site = { lat, lon };
    this.i('lat').value = lat.toFixed(3); this.i('lon').value = lon.toFixed(3);
    const p = PRESETS.findIndex(x => Math.abs(x[1] - lat) < 1e-3 && Math.abs(x[2] - lon) < 1e-3);
    this.i('preset').value = String(p);
    if (!this.embedded) this._msg('Loading elevation…');
    this._lastErr = null;
    try {
      await this._buildTerrain(my);
      if (my !== this._locReq) return;
      this._progress('Tracing the Sun and Earth paths', 0.96); await yieldUI();
      if (my !== this._locReq) return;
      this._pathsFor = my;
      await this._setWindow(this.win[0], this.embedded ? (this.win[1] - this.win[0]) / 864e5 : this.span, true);
      if (faceTarget) this._faceDefault();
      this._msg('');
      this._progress('Ready', 1);
    } catch (e) { if (my === this._locReq) { this._lastErr = e; this._msg(e.message || String(e), true); } }
  }
  async setTime(t) {
    t = typeof t === 'number' ? t : +new Date(t);
    if (!isFinite(t)) return;
    if (this.embedded) {                              // the host owns the window; just move the clock
      if (t === this.t) return;
      this.t = t; this._syncTime();
      if (!this.data.years.has(new Date(t).getUTCFullYear())) this.data.ensureRange(t, t).then(() => { this.dirty = true; });
      return;
    }
    if (t < this.win[0] || t > this.win[1]) await this._setWindow(t, this.span);
    this.t = clamp(t, this.win[0], this.win[1]); this._syncTime();
  }
  lookAt(az, alt, fov) { this._anim(az, alt, fov); }

  // ---- host integration (embedded mode)
  /** hooks: { sky(t), skyline(az), height(lat, lon) } - see the header comment */
  configure(hooks) {
    this.hooks = Object.assign({}, this.hooks, hooks || {});
    if (this.data) this.data.heightHook = this.hooks.height || null;
  }
  /** Stand at lat/lon. Resolves once the terrain is built (or rejects with the reason). */
  async setSite(lat, lon, label, opts) {
    await this._readyP;
    this.label = label || '';
    this._facePref = (opts && opts.face) || 'sun';
    await this.setLocation(lat, lon, !(opts && opts.keepView));
    if (this._lastErr) throw this._lastErr;
  }
  /** Stay window t0..t1 (drawn bright) and, optionally, a longer span p0..p1 for the paths (drawn dim
   *  outside the stay), all UTC ms. Parts of a path behind the terrain are drawn dashed. */
  async setWindow(t0, t1, p0, p1) {
    await this._readyP;
    p0 = Math.min(t0, p0 == null ? t0 : p0); p1 = Math.max(t1, p1 == null ? t1 : p1);
    const same = this.win && this.win[0] === t0 && this.win[1] === t1 && this.pathWin && this.pathWin[0] === p0 && this.pathWin[1] === p1;
    if (same && this._pathsFor === this._locReq) return;
    this.win = [t0, t1]; this.pathWin = [p0, p1];
    if (this.F) { this._pathsFor = this._locReq; await this._setWindow(t0, (t1 - t0) / 864e5, true); }
  }
  /** Display options: paths, stars, grid, labels, shadows, detail (booleans), scale (1-10), exp (0.3-3). */
  setOption(name, value) {
    if (!(name in this.opt) || this.opt[name] === value) return;
    this.opt[name] = value;
    if (name === 'detail') { if (this.site) this.rebuild(); }
    else this.dirty = true;
  }
  getOptions() { return Object.assign({}, this.opt); }
  /** Rotation Moon-fixed (ME) <- ICRF at time t as a row-major 3x3, from the built-in DE421 ephemeris.
   *  Resolves null outside the ephemeris years. */
  async frameAt(t) {
    await this._readyP;
    if (!this.data || !this.data.E) return null;
    await this.data.ensureRange(t, t);
    const e = this.data.ephem(t);
    return e ? quatToM3(e.q) : null;
  }
  /** Keep the Sun centred (true) or give the view back to the user (false). */
  setTracking(on) {
    this.tracking = !!on;
    this._following = this.tracking || !!this.playing;
    if (this._following) this._followTarget(true);
  }
  /** Observer eye / mast height in metres (rebuilds the horizon). */
  setEyeHeight(m) {
    if (!(m > 0) || m === this.eyeH) return;
    this.eyeH = m;
    if (this.site) this.rebuild();
  }
  /** Rebuild the terrain (e.g. after the host's skyline or height data changed). */
  rebuild() { if (this.site) return this.setLocation(this.site.lat, this.site.lon, false); }

  // ---------------------------------------------------------------- geometry
  _frame() {
    const { lat, lon } = this.site, la = lat * D2R, lo = lon * D2R;
    const up = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
    const east = [-Math.sin(lo), Math.cos(lo), 0], north = cross3(up, east);
    return { up, M: [...east, ...north, ...up] };   // ENU <- ME
  }
  /** topocentric sky state at time t: the host's angles when it has them, else the built-in ephemeris */
  sky(t) {
    const F = this.F, e = this.data.ephem(t);
    let own = null;
    if (e) {
      const obs = F.up.map(c => c * (MOON_R + this.h0) / 1000);
      const s = m3vec(F.M, sub3(e.sun, obs)), ea = m3vec(F.M, sub3(e.earth, obs));
      const toSun = sub3(e.sun, e.earth), toObs = sub3(obs, e.earth);
      own = { sun: norm3(s), earth: norm3(ea), sunDist: len3(s), earthDist: len3(ea), q: e.q, src: 'ephem',
        phase: 0.5 * (1 + dot3(toSun, toObs) / (len3(toSun) * len3(toObs))), enuIcrf: m3mul(F.M, quatToM3(e.q)) };
    }
    const h = this.hooks.sky && this.hooks.sky(t);
    if (h) {
      const sun = dirAltAz(h.sun.alt, h.sun.az), earth = dirAltAz(h.earth.alt, h.earth.az);
      return { sun, earth, src: 'host',
        sunDist: 695700 / Math.sin((h.sun.diam || 0.533) * D2R / 2), earthDist: 6371 / Math.sin((h.earth.diam || 1.9) * D2R / 2),
        phase: (1 - dot3(sun, earth)) / 2, enuIcrf: own ? own.enuIcrf : [1, 0, 0, 0, 1, 0, 0, 0, 1] };
    }
    return own;
  }
  horizonAt(az) {
    az = ((az % 360) + 360) % 360;
    if (this.auth) { const x = az / 0.5, i = Math.floor(x) % 720, f = x - Math.floor(x); return this.auth[i] * (1 - f) + this.auth[(i + 1) % 720] * f; }
    const h = this.horizon; if (!h) return 0;
    const x = az / (360 / SEGS), i = Math.floor(x) % SEGS, f = x - Math.floor(x);
    return h[i] * (1 - f) + h[(i + 1) % SEGS] * f;
  }

  async _buildTerrain(my) {
    const D = this.data, { lat, lon } = this.site;
    this._progress('Planning the terrain grid', 0.02); await yieldUI();
    const la = lat * D2R, lo = lon * D2R, sLa = Math.sin(la), cLa = Math.cos(la);
    const dest = (d, sa, ca, out, o) => {          // great-circle destination
      const th = d / MOON_R, st = Math.sin(th), ct = Math.cos(th);
      const sl = clamp(sLa * ct + cLa * st * ca, -1, 1);
      out[o] = Math.asin(sl) * R2D; out[o + 1] = (lo + Math.atan2(sa * st * cLa, ct - sLa * sl)) * R2D;
    };
    const radii = [0];
    for (let r = 0; r < RMAX;) { r += Math.max(2, r * 0.03); radii.push(Math.min(r, RMAX)); }
    const NR = radii.length, nv = 1 + (NR - 1) * SEGS;
    const sA = new Float64Array(SEGS), cA = new Float64Array(SEGS);
    for (let j = 0; j < SEGS; j++) { sA[j] = Math.sin(j * 2 * Math.PI / SEGS); cA[j] = Math.cos(j * 2 * Math.PI / SEGS); }
    const LL = new Float64Array(nv * 2); LL[0] = lat; LL[1] = lon;
    for (let i = 1; i < NR; i++) for (let j = 0; j < SEGS; j++) dest(radii[i], sA[j], cA[j], LL, 2 * (1 + (i - 1) * SEGS + j));
    const N = HM_N, cell = 2 * RMAX / N, HLL = new Float64Array(N * N * 2), inside = new Uint8Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const px = -RMAX + (x + 0.5) * cell, py = -RMAX + (y + 0.5) * cell, d = Math.hypot(px, py), k = y * N + x;
      if (d > RMAX || d < 1) continue;
      inside[k] = 1; dest(d, px / d, py / d, HLL, 2 * k);
    }
    const need = new Set();
    for (let v = 0; v < nv; v++) D.need(need, LL[2 * v], LL[2 * v + 1]);
    this._progress('Loading NASA LOLA elevation', 0.06);
    await D.loadTiles(need, (d, n) => this._progress(`Loading NASA LOLA elevation (${d} of ${n} tiles)`, 0.06 + 0.5 * d / n));
    if (my !== this._locReq) return;
    this._progress('Building the 3D terrain', 0.58); await yieldUI();
    if (my !== this._locReq) return;

    this.F = this._frame();
    const det = this.opt.detail ? makeDetail((Math.round(lat * 100) * 7919 + Math.round(lon * 100) * 104729) | 0) : () => 0;
    const fade = r => (r < 3000 ? 1 : r > 9000 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * (r - 3000) / 6000));
    this.h0 = D.height(lat, lon);
    const base = MOON_R + this.h0 + det(0, 0);
    const pos = new Float32Array(nv * 3), horizon = new Float32Array(SEGS).fill(-90);
    for (let i = 1; i < NR; i++) {
      const r = radii[i], th = r / MOON_R, st = Math.sin(th), ct = Math.cos(th), fr = fade(r);
      for (let j = 0; j < SEGS; j++) {
        const v = 1 + (i - 1) * SEGS + j, x0 = r * sA[j], y0 = r * cA[j];
        const R = MOON_R + D.height(LL[2 * v], LL[2 * v + 1]) + (fr > 0 ? det(x0, y0) * fr : 0);
        const hz = R * st, z = R * ct - base;
        pos[3 * v] = hz * sA[j]; pos[3 * v + 1] = hz * cA[j]; pos[3 * v + 2] = z;
      }
    }
    // Host skyline (the analysed terrain horizon): bend the far terrain so the drawn skyline matches it
    // per 1-degree segment, and keep anything nearer from poking above it.
    const eye = this.eyeH, W0 = 1500, W1 = 5000;
    const blend = r => (r <= W0 ? 0 : r >= W1 ? 1 : (r - W0) / (W1 - W0));
    let auth = null;
    if (this.hooks.skyline) {
      auth = new Float32Array(720);
      for (let b = 0; b < 720 && auth; b++) { const h = this.hooks.skyline(b * 0.5); if (h == null || !isFinite(h)) auth = null; else auth[b] = h; }
    }
    this.auth = auth;
    const authAt = az => { const x = (((az % 360) + 360) % 360) / 0.5, i = Math.floor(x) % 720, f = x - Math.floor(x); return auth[i] * (1 - f) + auth[(i + 1) % 720] * f; };
    const shift = new Float64Array(SEGS);                   // tan(delta elevation) per segment
    if (auth) {
      const far = new Float64Array(SEGS).fill(-89);
      for (let i = 1; i < NR; i++) {
        if (radii[i] <= W0) continue;
        for (let j = 0; j < SEGS; j++) {
          const v = 1 + (i - 1) * SEGS + j, hz = Math.hypot(pos[3 * v], pos[3 * v + 1]);
          const a = Math.atan2(pos[3 * v + 2] - eye, hz) * R2D; if (a > far[j]) far[j] = a;
        }
      }
      for (let j = 0; j < SEGS; j++) shift[j] = Math.tan((authAt(j) - far[j]) * D2R);
    }
    const shiftAt = az => { const x = ((az % 360) + 360) % 360, i = Math.floor(x) % SEGS, f = x - Math.floor(x); return shift[i] * (1 - f) + shift[(i + 1) % SEGS] * f; };
    const conform = (z, hz, r, az) => {
      if (!auth) return z;
      z += hz * shiftAt(az) * blend(r);
      if (r > 8) z = Math.min(z, eye + hz * Math.tan(authAt(az) * D2R));
      return z;
    };
    for (let i = 1; i < NR; i++) {
      for (let j = 0; j < SEGS; j++) {
        const v = 1 + (i - 1) * SEGS + j, hz = Math.hypot(pos[3 * v], pos[3 * v + 1]);
        pos[3 * v + 2] = conform(pos[3 * v + 2], hz, radii[i], j);
        if (radii[i] > 25) { const a = Math.atan2(pos[3 * v + 2] - eye, hz) * R2D; if (a > horizon[j]) horizon[j] = a; }
      }
    }
    this.horizon = horizon;
    // indices + normals
    const idx = new Uint32Array(SEGS * 3 + (NR - 2) * SEGS * 6);
    let k = 0;
    for (let j = 0; j < SEGS; j++) { idx[k++] = 0; idx[k++] = 1 + j; idx[k++] = 1 + (j + 1) % SEGS; }
    for (let i = 1; i < NR - 1; i++) {
      const r0 = 1 + (i - 1) * SEGS, r1 = r0 + SEGS;
      for (let j = 0; j < SEGS; j++) {
        const j2 = (j + 1) % SEGS;
        idx[k++] = r0 + j; idx[k++] = r1 + j; idx[k++] = r0 + j2;
        idx[k++] = r0 + j2; idx[k++] = r1 + j; idx[k++] = r1 + j2;
      }
    }
    const nor = new Float32Array(nv * 3);
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
      for (const p of [a, b, c]) { nor[p] += nx; nor[p + 1] += ny; nor[p + 2] += nz; }
    }
    this._progress('Computing terrain shadows', 0.74); await yieldUI();
    if (my !== this._locReq) return;
    // shadow heightmap
    const hm = new Float32Array(N * N); let hmax = -1e9;
    for (let q = 0; q < N * N; q++) {
      if (!inside[q]) { hm[q] = -1e6; continue; }
      const px = -RMAX + ((q % N) + 0.5) * cell, py = -RMAX + (Math.floor(q / N) + 0.5) * cell, d = Math.hypot(px, py);
      const z = conform((MOON_R + D.height(HLL[2 * q], HLL[2 * q + 1])) * Math.cos(d / MOON_R) - base, d, d, Math.atan2(px, py) * R2D);
      hm[q] = z; if (z > hmax) hmax = z;
    }
    this._progress('Computing close-up shadows', 0.86); await yieldUI();
    if (my !== this._locReq) return;
    // fine heightmap near the observer, including the synthetic detail (matches the mesh)
    const N1 = HM1_N, c1 = 2 * HM1_L / N1, hm1 = new Float32Array(N1 * N1), tmp = [lat, lon];
    for (let q = 0; q < N1 * N1; q++) {
      const px = -HM1_L + ((q % N1) + 0.5) * c1, py = -HM1_L + (Math.floor(q / N1) + 0.5) * c1, d = Math.hypot(px, py);
      if (d > 0.5) dest(d, px / d, py / d, tmp, 0); else { tmp[0] = lat; tmp[1] = lon; }
      const z = conform((MOON_R + D.height(tmp[0], tmp[1]) + det(px, py) * fade(d)) * Math.cos(d / MOON_R) - base, d, d, Math.atan2(px, py) * R2D);
      hm1[q] = z; if (z > hmax) hmax = z;
    }
    this.hmax = hmax + 5;
    // skyline outline (the authoritative skyline when the host gives one), drawn over the terrain
    { const sk = []; for (let a = 0; a <= 360; a += 0.5) sk.push(dirAltAz(this.horizonAt(a), a)); this._setLines(this.skyLine, sk); }
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.tPos); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.tNor); gl.bufferData(gl.ARRAY_BUFFER, nor, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.tIdx); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    this.tCount = idx.length;
    gl.bindTexture(gl.TEXTURE_2D, this.hmTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, N, N, 0, gl.RED, gl.FLOAT, hm);
    const filt = this.floatLinear ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filt); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filt);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, this.hm1Tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, N1, N1, 0, gl.RED, gl.FLOAT, hm1);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filt); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filt);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this._buildGrid();
    this.dirty = true;
  }

  // ---------------------------------------------------------------- time window, paths, events
  async _setWindow(start, spanDays, keepT) {
    this.span = spanDays;
    const end = start + spanDays * 864e5;
    if (!this.embedded || !this.pathWin) this.pathWin = [start, end];
    const p0 = Math.min(start, this.pathWin[0]), p1 = Math.max(end, this.pathWin[1]);
    try { await this.data.ensureRange(p0 - 864e5, p1 + 864e5); }
    catch (e) { this._msg(e.message, true); setTimeout(() => this._msg(''), 3500); return; }
    this.win = [start, end];
    if (!this.embedded && (!keepT || this.t < start || this.t > end)) this.t = start;
    this.i('date').value = new Date(start).toISOString().slice(0, 16);
    if (!this.F) return;
    this._buildPaths(start, end, p0, p1);
    // daily marks
    const every = Math.max(1, Math.ceil(spanDays / 31)), marks = [];
    let c = 0;
    for (let m = Math.ceil(start / 864e5) * 864e5; m <= end; m += 864e5, c++) {
      if (c % every) continue;
      const s = this.sky(m);
      marks.push({ t: m, sun: s.sun, earth: s.earth, lab: c % (every * 2) === 0 || spanDays <= 8 });
    }
    this.marks = marks;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.markSun.buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(marks.flatMap(m => m.sun)), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.markEarth.buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(marks.flatMap(m => m.earth)), gl.STATIC_DRAW);
    this.markSun.n = this.markEarth.n = marks.length;
    this._dayLabels(marks, spanDays);
    // rise / set over the real terrain horizon
    const ev = [], stepE = clamp((end - start) / 6000, 5 * 6e4, 36e5);
    let prev = null;
    for (let t = start; t <= end + 1; t += stepE) {
      const s = this.sky(t), cur = {};
      for (const b of ['sun', 'earth']) { const [al, az] = altAz(s[b]); cur[b] = [al - this.horizonAt(az), az]; }
      if (prev) for (const b of ['sun', 'earth']) {
        if (Math.sign(prev[b][0]) !== Math.sign(cur[b][0])) {
          const f = prev[b][0] / (prev[b][0] - cur[b][0]);
          ev.push({ b, kind: cur[b][0] > 0 ? 'rise' : 'set', t: t - stepE + f * stepE, az: cur[b][1] });
        }
      }
      prev = cur;
    }
    this.events = ev;
    this._syncTime();
  }

  _syncTime() {
    const [a, b] = this.win;
    this.i('time').value = String(Math.round((this.t - a) / (b - a) * 10000));
    this.q('.bar .t').textContent = fmtUTC(this.t) + ' UTC';
    this.dirty = true;
    this._lastInfo = '';
  }

  _faceDefault() {
    const s = this.sky(this.t); if (!s) return;
    const [ea, ez] = altAz(s.earth), [sa, sz] = altAz(s.sun);
    let az = 90, alt = 8;
    const sunUp = sa > this.horizonAt(sz), earthUp = ea > this.horizonAt(ez);
    if (this._facePref === 'sun') { az = sz; alt = sunUp ? clamp(sa - 12, 2, 32) : clamp(sa + 6, 2, 32); }
    else if (earthUp) { az = ez; alt = clamp(ea - 29, 4, 32); }
    else if (sunUp) { az = sz; alt = clamp(sa - 29, 4, 32); }
    this.view.yaw = az; this.view.pitch = alt; this.view.fov = 70; this.dirty = true;
  }

  // ---------------------------------------------------------------- GL setup
  _prog(vs, fs) {
    const gl = this.gl, p = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Shader: ' + gl.getShaderInfoLog(s));
      gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Link: ' + gl.getProgramInfoLog(p));
    const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let k = 0; k < n; k++) { const nm = gl.getActiveUniform(p, k).name; u[nm] = gl.getUniformLocation(p, nm); }
    return { p, u, a: nm => gl.getAttribLocation(p, nm) };
  }
  _initGL() {
    const gl = this.gl;
    this.P = {
      terrain: this._prog(SH.terrainV, SH.terrainF), star: this._prog(SH.starV, SH.starF),
      line: this._prog(SH.lineV, SH.lineF), dot: this._prog(SH.dotV, SH.dotF),
      sun: this._prog(SH.bbV, SH.sunF), earth: this._prog(SH.bbV, SH.earthF),
    };
    this.tPos = gl.createBuffer(); this.tNor = gl.createBuffer(); this.tIdx = gl.createBuffer();
    this.hmTex = gl.createTexture(); this.hm1Tex = gl.createTexture();
    const mkLine = () => ({ buf: gl.createBuffer(), n: 0 });
    this.sunLine = [mkLine(), mkLine(), mkLine(), mkLine()]; this.earthLine = [mkLine(), mkLine(), mkLine(), mkLine()];
    this.gridLine = mkLine(); this.skyLine = mkLine();
    this.markSun = mkLine(); this.markEarth = mkLine();
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
    this.starBuf = gl.createBuffer(); this.nStars = 0;
    this.earthTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.earthTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([30, 70, 140, 255]));
  }
  // segs: flat list of [A, B, sA, sB] (unit directions, arc length in radians at each end)
  _setSegs(L, segs) {
    const v = new Float32Array(segs.length * 6 * 10);
    let o = 0;
    for (const [A, B, sA, sB] of segs) {
      for (const [e, s] of [[0, -1], [1, -1], [1, 1], [0, -1], [1, 1], [0, 1]]) {
        v[o++] = A[0]; v[o++] = A[1]; v[o++] = A[2]; v[o++] = B[0]; v[o++] = B[1]; v[o++] = B[2];
        v[o++] = e; v[o++] = s; v[o++] = sA; v[o++] = sB;
      }
    }
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, L.buf); gl.bufferData(gl.ARRAY_BUFFER, v, gl.STATIC_DRAW);
    L.n = segs.length * 6;
  }
  _setLines(L, pts, breakAt) {
    const segs = []; let s = 0;
    for (let k = 0; k + 1 < pts.length; k++) {
      const A = pts[k], B = pts[k + 1], d = Math.acos(clamp(dot3(A, B), -1, 1));
      if (!(breakAt && breakAt(k))) segs.push([A, B, s, s + d]);
      s += d;
    }
    this._setSegs(L, segs);
  }
  /** Sun and Earth paths over p0..p1, split four ways: inside / outside the stay (start..end) and
   *  above / behind the skyline. Each piece is cut exactly where the body crosses the skyline. */
  _buildPaths(start, end, p0, p1) {
    const hours = (p1 - p0) / 36e5, n = clamp(Math.round(hours * 4), 240, 16000), dt = (p1 - p0) / (n - 1);
    const ts = [];
    for (let k = 0; k < n; k++) ts.push(p0 + k * dt);
    for (const t of [start, end]) if (t > p0 && t < p1) ts.push(t);
    ts.sort((a, b) => a - b);
    const samples = ts.map(t => this.sky(t));
    for (const b of ['sun', 'earth']) {
      const cat = [[], [], [], []];                 // stay+visible, stay+hidden, other+visible, other+hidden
      let s = 0, prev = null;
      for (let k = 0; k < ts.length; k++) {
        const sk = samples[k];
        if (!sk) { prev = null; continue; }
        const d = sk[b], [al, az] = altAz(d), cur = { d, c: al - this.horizonAt(az), t: ts[k] };
        if (prev) {
          const inStay = (prev.t + cur.t) / 2 >= start && (prev.t + cur.t) / 2 <= end;
          const seg = (A, B, cA) => {
            const len = Math.acos(clamp(dot3(A, B), -1, 1));
            cat[(inStay ? 0 : 2) + (cA ? 0 : 1)].push([A, B, s, s + len]); s += len;
          };
          if ((prev.c > 0) !== (cur.c > 0)) {          // crosses the skyline: split at the crossing
            const f = prev.c / (prev.c - cur.c);
            const m = norm3([prev.d[0] + (cur.d[0] - prev.d[0]) * f, prev.d[1] + (cur.d[1] - prev.d[1]) * f, prev.d[2] + (cur.d[2] - prev.d[2]) * f]);
            seg(prev.d, m, prev.c > 0); seg(m, cur.d, cur.c > 0);
          } else seg(prev.d, cur.d, cur.c > 0);
        }
        prev = cur;
      }
      const L = b === 'sun' ? this.sunLine : this.earthLine;
      cat.forEach((c, i) => this._setSegs(L[i], c));
    }
  }
  _buildGrid() {
    const pts = [], brk = new Set();
    const seg = arr => { if (pts.length) brk.add(pts.length - 1); pts.push(...arr); };
    for (const a of [0, 15, 30, 45, 60, 75]) { const r = []; for (let z = 0; z <= 360; z += 2) r.push(dirAltAz(a, z)); seg(r); }
    for (let z = 0; z < 360; z += 30) { const r = []; for (let a = 0; a <= 90; a += 2) r.push(dirAltAz(a, z)); seg(r); }
    this._setLines(this.gridLine, pts, k => brk.has(k));
  }
  async _loadStars() {
    try {
      const u8 = b64bytes(await loadJS(this.data.base, 'stars')), dv = new DataView(u8.buffer), n = u8.length / 8;
      const f = new Float32Array(n * 5);
      for (let k = 0; k < n; k++) {
        const o = k * 8;
        f.set([dv.getInt16(o, true) / 32767, dv.getInt16(o + 2, true) / 32767, dv.getInt16(o + 4, true) / 32767,
          dv.getUint8(o + 6) / 30 - 2, dv.getInt8(o + 7) / 60], k * 5);
      }
      const gl = this.gl; gl.bindBuffer(gl.ARRAY_BUFFER, this.starBuf); gl.bufferData(gl.ARRAY_BUFFER, f, gl.STATIC_DRAW);
      this.nStars = n; this.dirty = true;
    } catch (e) { console.warn('moon-sky: stars', e); }
  }
  async _loadEarthTex() {
    let url;
    try { url = await loadJS(this.data.base, 'earth'); } catch (e) { return; }   // keeps the plain blue fallback
    const img = new Image();
    img.onload = () => {
      const gl = this.gl; gl.bindTexture(gl.TEXTURE_2D, this.earthTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      this.dirty = true;
    };
    img.src = url;                                   // data: URL, so WebGL accepts it even on file://
  }

  // ---------------------------------------------------------------- rendering
  _matrices() {
    const { yaw, pitch, fov } = this.view, y = yaw * D2R, p = pitch * D2R;
    const f = [Math.cos(p) * Math.sin(y), Math.cos(p) * Math.cos(y), Math.sin(p)];
    const r = [Math.cos(y), -Math.sin(y), 0], u = cross3(r, f);
    const W = this.cv.width, H = this.cv.height, asp = W / H;
    // rows r, u, -f; translation = -R * eye, eye = (0, 0, ez)
    const view = ez => new Float32Array([r[0], u[0], -f[0], 0, r[1], u[1], -f[1], 0, r[2], u[2], -f[2], 0, -r[2] * ez, -u[2] * ez, f[2] * ez, 1]);
    const Vs = view(0), V = view(this.eyeH);
    return { f, r, u, asp, W, H, VPs: m4mul(persp(fov * D2R, asp, 0.01, 10), Vs), VP: m4mul(persp(fov * D2R, asp, NEAR, FAR), V) };
  }
  _attr(prog, name, size, stride, off) {
    const gl = this.gl, loc = prog.a(name); if (loc < 0) return;
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, off);
  }
  // dashPx > 0 draws dashes about that many CSS pixels long (kept constant on screen while zooming)
  _drawLine(L, M, col, w, dashPx) {
    if (!L.n) return;
    const gl = this.gl, P = this.P.line; gl.useProgram(P.p);
    gl.bindBuffer(gl.ARRAY_BUFFER, L.buf);
    this._attr(P, 'aA', 3, 40, 0); this._attr(P, 'aB', 3, 40, 12); this._attr(P, 'aC', 2, 40, 24); this._attr(P, 'aS', 2, 40, 32);
    gl.uniformMatrix4fv(P.u.uVP, false, M.VPs); gl.uniform2f(P.u.uRes, M.W / 2, M.H / 2);
    gl.uniform1f(P.u.uW, w * this.dpr / 2); gl.uniform4fv(P.u.uCol, col);
    gl.uniform1f(P.u.uDash, dashPx ? 2 * dashPx * this.view.fov * D2R / this.cv.clientHeight : 0);
    gl.drawArrays(gl.TRIANGLES, 0, L.n);
    this._off(P, ['aA', 'aB', 'aC', 'aS']);
  }
  _off(P, names) { for (const n of names) { const l = P.a(n); if (l >= 0) this.gl.disableVertexAttribArray(l); } }

  _render() {
    const gl = this.gl, cv = this.cv, dpr = this.dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(cv.clientWidth * dpr)), h = Math.max(1, Math.round(cv.clientHeight * dpr));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 1); gl.depthMask(true); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!this.F || !this.tCount) return;
    const s = this.sky(this.t); if (!s) return;
    const M = this._matrices(), o = this.opt;
    const [sAlt, sAz] = altAz(s.sun), [eAlt, eAz] = altAz(s.earth);
    const sunAR = Math.atan(696000 / s.sunDist), earthAR = Math.atan(6371 / s.earthDist);
    const radPerPx = this.view.fov * D2R / h;
    // eclipse of the Sun by the Earth, and Sun visibility above the terrain horizon
    const sep = Math.acos(clamp(dot3(s.sun, s.earth), -1, 1));
    const occ = sep >= earthAR + sunAR ? 0 : sep <= earthAR - sunAR ? 1 : (earthAR + sunAR - sep) / (2 * sunAR);
    // share of the disc above the skyline, same formula as the app (data contract section 7)
    const discFrac = (clearDeg, rRad) => { const x = clamp(clearDeg * D2R / rRad, -1, 1); return 1 - (Math.acos(x) - x * Math.sqrt(1 - x * x)) / Math.PI; };
    const sunVis = discFrac(sAlt - this.horizonAt(sAz), sunAR);
    const earthVis = discFrac(eAlt - this.horizonAt(eAz), earthAR);
    const sunI = sAlt > -3 ? 1 - occ : 0;
    const night = 1 - sunVis * (1 - occ);
    this.state = { s, sAlt, sAz, eAlt, eAz, sunAR, earthAR, occ, sunVis, earthVis };

    gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND);
    // stars
    if (o.stars && this.nStars) {
      const P = this.P.star; gl.useProgram(P.p); gl.blendFunc(gl.ONE, gl.ONE);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.starBuf);
      this._attr(P, 'aDir', 3, 20, 0); this._attr(P, 'aMB', 2, 20, 12);
      gl.uniformMatrix4fv(P.u.uVP, false, M.VPs); gl.uniformMatrix3fv(P.u.uM, false, m3T(s.enuIcrf));
      gl.uniform1f(P.u.uPx, dpr); gl.uniform1f(P.u.uA, 0.55 + 0.45 * night);
      gl.drawArrays(gl.POINTS, 0, this.nStars); this._off(P, ['aDir', 'aMB']);
    }
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    if (o.grid) this._drawLine(this.gridLine, M, [0.6, 0.7, 0.9, 0.28], 1);
    // Sun
    const tanH = Math.tan(this.view.fov * D2R / 2);
    {
      const P = this.P.sun; gl.useProgram(P.p); gl.blendFunc(gl.ONE, gl.ONE);
      const Dpx = Math.max(sunAR * o.scale / radPerPx, 3 * dpr), Gpx = Math.max(Dpx * 8, 60 * dpr);
      const ry = Math.tan(Gpx * radPerPx) / tanH;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quad); this._attr(P, 'aC', 2, 8, 0);
      gl.uniformMatrix4fv(P.u.uVP, false, M.VPs); gl.uniform3fv(P.u.uDir, s.sun); gl.uniform2f(P.u.uSize, ry / M.asp, ry);
      gl.uniform1f(P.u.uG, Gpx); gl.uniform1f(P.u.uD, Dpx); gl.uniform1f(P.u.uV, 1);
      gl.drawArrays(gl.TRIANGLES, 0, 6); this._off(P, ['aC']);
    }
    // Earth (lit by the Sun -> real phase; oriented by Earth rotation angle)
    if (o.earth) {
      const P = this.P.earth; gl.useProgram(P.p); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      const ar = Math.max(earthAR * o.scale, 3 * dpr * radPerPx), ry = 1.1 * Math.tan(ar) / tanH;
      const jd = this.t / 864e5 + 2440587.5, era = 2 * Math.PI * (0.779057273264 + 1.00273781191135448 * (jd - 2451545));
      const ce = Math.cos(era), se = Math.sin(era);
      const efIcrf = [ce, se, 0, -se, ce, 0, 0, 0, 1];                       // Earth-fixed <- ICRF
      const ef = m3mul(efIcrf, m3T(s.enuIcrf));                              // Earth-fixed <- ENU
      const back = [-M.f[0], -M.f[1], -M.f[2]];
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quad); this._attr(P, 'aC', 2, 8, 0);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.earthTex); gl.uniform1i(P.u.uTex, 0);
      gl.uniformMatrix4fv(P.u.uVP, false, M.VPs); gl.uniform3fv(P.u.uDir, s.earth); gl.uniform2f(P.u.uSize, ry / M.asp, ry);
      gl.uniformMatrix3fv(P.u.uCam, false, [...M.r, ...M.u, ...back]);
      gl.uniformMatrix3fv(P.u.uEF, false, m3T(ef)); gl.uniform3fv(P.u.uSun, s.sun);
      gl.uniform1f(P.u.uRing, clamp(occ * 1.5, 0, 1));
      gl.drawArrays(gl.TRIANGLES, 0, 6); this._off(P, ['aC']);
    }
    // terrain
    gl.disable(gl.BLEND); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
    {
      const P = this.P.terrain; gl.useProgram(P.p);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.tPos); this._attr(P, 'aPos', 3, 12, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.tNor); this._attr(P, 'aNor', 3, 12, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.tIdx);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.hmTex); gl.uniform1i(P.u.uHM, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.hm1Tex); gl.uniform1i(P.u.uHM1, 2);
      gl.uniformMatrix4fv(P.u.uVP, false, M.VP);
      gl.uniform3fv(P.u.uSun, s.sun); gl.uniform3fv(P.u.uEarth, s.earth); gl.uniform3f(P.u.uEye, 0, 0, this.eyeH);
      gl.uniform1f(P.u.uSunI, sunI); gl.uniform1f(P.u.uEarthI, 0.02 * s.phase * clamp(eAlt + 1, 0, 1));
      gl.uniform1f(P.u.uL, RMAX); gl.uniform1f(P.u.uL1, HM1_L); gl.uniform1f(P.u.uExp, 1.4 * o.exp * (1 + 24 * night));
      gl.uniform1f(P.u.uLogF, 2 / Math.log2(FAR + 1)); gl.uniform1f(P.u.uSunRad, sunAR);
      gl.uniform1f(P.u.uHMax, this.hmax); gl.uniform1f(P.u.uShadow, o.shadows ? 1 : 0);
      gl.uniform1f(P.u.uAmb, 0.012 / (1 + 24 * night));
      gl.drawElements(gl.TRIANGLES, this.tCount, gl.UNSIGNED_INT, 0);
      this._off(P, ['aPos', 'aNor']);
    }
    // Sun and Earth paths on top of the terrain: solid where the body is above the skyline, dashed where
    // terrain hides it; bright during the stay, dim before and after it.
    gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    if (o.skyline) this._drawLine(this.skyLine, M, [0.78, 0.81, 0.88, 0.55], 1.2);
    if (o.paths) {
      const SUN = [1, 0.76, 0.15], EARTH = [0.42, 0.7, 1];
      for (const [L, c] of (o.earth ? [[this.earthLine, EARTH]] : []).concat([[this.sunLine, SUN]])) {
        this._drawLine(L[3], M, [...c, 0.32], 1.5, 5);
        this._drawLine(L[2], M, [...c, 0.45], 1.5);
        this._drawLine(L[1], M, [...c, 0.85], 2, 7);
        this._drawLine(L[0], M, [...c, 1], 2.5);
      }
      const P = this.P.dot; gl.useProgram(P.p);
      for (const [L, col] of [[this.markSun, [1, 0.82, 0.35, 1]]].concat(o.earth ? [[this.markEarth, [0.55, 0.78, 1, 1]]] : [])) {
        if (!L.n) continue;
        gl.bindBuffer(gl.ARRAY_BUFFER, L.buf); this._attr(P, 'aA', 3, 12, 0);
        gl.uniformMatrix4fv(P.u.uVP, false, M.VPs); gl.uniform1f(P.u.uPx, 5 * dpr); gl.uniform4fv(P.u.uCol, col);
        gl.drawArrays(gl.POINTS, 0, L.n);
      }
      this._off(P, ['aA']);
      gl.disable(gl.BLEND);
    }
    this._labels(M);
    this._info();
  }

  // ---------------------------------------------------------------- overlay labels & info
  _project(M, d) {
    const m = M.VPs, x = m[0] * d[0] + m[4] * d[1] + m[8] * d[2] + m[12], y = m[1] * d[0] + m[5] * d[1] + m[9] * d[2] + m[13], w = m[3] * d[0] + m[7] * d[1] + m[11] * d[2] + m[15];
    if (w < 1e-3) return null;
    const nx = x / w, ny = y / w;
    if (Math.abs(nx) > 1.1 || Math.abs(ny) > 1.1) return null;
    return [(nx + 1) / 2 * this.cv.clientWidth, (1 - ny) / 2 * this.cv.clientHeight];
  }
  _place(el, M, d, show) {
    const p = show ? this._project(M, d) : null;
    if (!p) { el.style.display = 'none'; return; }
    el.style.display = ''; el.style.left = p[0] + 'px'; el.style.top = p[1] + 'px';
  }
  _dayLabels(marks, span) {
    this.dayEls && this.dayEls.forEach(e => e.el.remove());
    const box = this.q('.lbls'); this.dayEls = [];
    for (const m of marks) {
      if (!m.lab) continue;
      for (const b of ['sun', 'earth']) {
        const el = document.createElement('div'); el.className = `l d ${b}`;
        el.textContent = new Date(m.t).toISOString().slice(span > 200 ? 0 : 5, span > 200 ? 7 : 10);
        box.appendChild(el); this.dayEls.push({ el, d: m[b], b });
      }
    }
  }
  _labels(M) {
    const box = this.q('.lbls'), show = this.opt.labels;
    if (!this.cEls) {
      this.cEls = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'].map((t, k) => {
        const el = document.createElement('div'); el.className = 'l c' + (k % 2 ? ' m' : ''); el.textContent = t; box.appendChild(el); return { el, az: k * 45 };
      });
      this.sunEl = Object.assign(document.createElement('div'), { className: 'l b sun' });
      this.earthEl = Object.assign(document.createElement('div'), { className: 'l b earth' });
      this.sunRing = Object.assign(document.createElement('div'), { className: 'so' });
      this.earthRing = Object.assign(document.createElement('div'), { className: 'eo' });
      box.append(this.sunRing, this.earthRing, this.sunEl, this.earthEl);
    }
    for (const c of this.cEls) this._place(c.el, M, dirAltAz(this.horizonAt(c.az) + 1.3, c.az), show);
    const st = this.state;
    const hidden = st.sunVis < 0.999, eHidden = st.earthVis < 0.999;
    this.sunEl.textContent = st.occ > 0 ? (st.occ >= 1 ? 'Sun — eclipsed by Earth' : 'Sun — partial eclipse')
      : st.sunVis <= 0.001 ? 'Sun (behind the skyline)' : hidden ? `Sun (${Math.round(st.sunVis * 100)}% of disc above the skyline)` : 'Sun';
    // dashed outlines where the Sun / Earth are when terrain or the Moon's horizon hides them
    const pxPerRad = this.cv.clientHeight / (this.view.fov * D2R);
    const ringPx = Math.max(2 * st.sunAR * this.opt.scale * pxPerRad, 14);
    this.sunRing.style.width = this.sunRing.style.height = ringPx + 'px';
    this._place(this.sunRing, M, st.s.sun, hidden);
    const eRingPx = Math.max(2 * st.earthAR * this.opt.scale * pxPerRad, 14);
    this.earthRing.style.width = this.earthRing.style.height = eRingPx + 'px';
    this._place(this.earthRing, M, st.s.earth, eHidden && this.opt.earth);
    this.earthEl.textContent = `Earth ${Math.round(st.s.phase * 100)}% lit` +
      // same rule as the host app: Earth counts as in view when its centre is above the skyline
      (st.eAlt - this.horizonAt(st.eAz) < 0 ? ' (behind the skyline)' : eHidden ? ' (edge behind the skyline)' : '');
    this._place(this.sunEl, M, st.s.sun, show);
    this._place(this.earthEl, M, st.s.earth, show && this.opt.earth);
    const showD = show && this.opt.paths;
    for (const d of this.dayEls || []) {
      const [al, az] = altAz(d.d);
      this._place(d.el, M, d.d, showD && (d.b !== 'earth' || this.opt.earth) && al > this.horizonAt(az));
    }
  }
  _info() {
    const st = this.state, s = st.s, t = this.t;
    const next = b => (this.events || []).find(e => e.b === b && e.t > t);
    const ns = next('sun'), ne = next('earth');
    const vis = v => (v >= 1 ? 'visible' : v <= 0 ? 'below terrain horizon' : 'partly behind terrain');
    const html = `<div><b>${fmtUTC(t)} UTC</b></div>
      <div class="k">Ground ${Math.round(this.h0).toLocaleString()} m (LOLA) · ${st.sunVis > 0 && st.occ < 1 ? 'lunar day' : 'lunar night'}</div>
      <div class="r"><span class="dot" style="background:#fdc43a"></span><b>Sun</b> ${st.sAlt.toFixed(2)}° · ${st.sAz.toFixed(1)}° ${compass(st.sAz)}<br>
      <span class="k">${vis(st.sunVis)}${st.occ > 0 ? ' · ECLIPSE' : ''}${ns ? `<br>${ns.kind === 'rise' ? 'rises' : 'sets'} ${fmtUTC(ns.t)}` : ''}</span></div>
      <div class="r"><span class="dot" style="background:#6fb4ff"></span><b>Earth</b> ${st.eAlt.toFixed(2)}° · ${st.eAz.toFixed(1)}° ${compass(st.eAz)}<br>
      <span class="k">${Math.round(s.phase * 100)}% lit · ${Math.round(s.earthDist).toLocaleString()} km · ${vis(st.earthVis)}${ne ? `<br>${ne.kind === 'rise' ? 'rises' : 'sets'} ${fmtUTC(ne.t)}` : ''}</span></div>`;
    if (html !== this._lastInfo) {
      this.q('.info').innerHTML = html; this._lastInfo = html;
      const pr = this.label ? [this.label] : PRESETS[+this.i('preset').value];
      const w = this.q('.top .w'); w.textContent = '';
      if (pr) w.appendChild(Object.assign(document.createElement('b'), { textContent: pr[0] })).after(' · ');
      w.append(`${fmtLat(this.site.lat)} ${fmtLon(this.site.lon)}`);
      this.dispatchEvent(new CustomEvent('moonsky-change', { detail: { lat: this.site.lat, lon: this.site.lon, time: t,
        sun: { alt: st.sAlt, az: st.sAz }, earth: { alt: st.eAlt, az: st.eAz, phase: s.phase } } }));
    }
  }

  // ---------------------------------------------------------------- loop & input
  _loop() {
    let last = performance.now();
    const tick = now => {
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      if (this._animF) this._animF(now);
      this._keys(dt);
      if (this.playing) {
        this.t += dt * +this.i('speed').value * 36e5;
        if (this.t >= this.win[1]) { this.t = this.win[1]; this._play(false); }
        this._syncTime();
      }
      if (this._following && !this._animF && this.F) this._followTarget(false);
      if (this.dirty) { this.dirty = false; this._render(); }
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }
  _anim(az, alt, fov) {
    const v = this.view, from = { ...v }, dy = ((az - v.yaw) % 360 + 540) % 360 - 180;
    const to = { yaw: v.yaw + dy, pitch: clamp(alt, -89, 89), fov: fov ?? v.fov }, t0 = performance.now();
    this._animF = () => {                            // own clock: rAF timestamps can lag performance.now()
      const w = clamp((performance.now() - t0) / 600, 0, 1), e = w < 0.5 ? 2 * w * w : 1 - (-2 * w + 2) ** 2 / 2;
      v.yaw = ((from.yaw + (to.yaw - from.yaw) * e) % 360 + 360) % 360; v.pitch = from.pitch + (to.pitch - from.pitch) * e; v.fov = from.fov + (to.fov - from.fov) * e;
      this.dirty = true; if (w >= 1) this._animF = null;
    };
  }
  _keys(dt) {
    const k = this._kd; if (!k || !k.size) return;
    const v = this.view, sp = v.fov * 0.9 * dt, look = !this._following;
    if (look && k.has('ArrowLeft')) v.yaw = (v.yaw - sp + 360) % 360;
    if (look && k.has('ArrowRight')) v.yaw = (v.yaw + sp) % 360;
    if (look && k.has('ArrowUp')) v.pitch = clamp(v.pitch + sp, -89, 89);
    if (look && k.has('ArrowDown')) v.pitch = clamp(v.pitch - sp, -89, 89);
    if (k.has('+') || k.has('=')) v.fov = clamp(v.fov * (1 - dt), 1, 100);
    if (k.has('-')) v.fov = clamp(v.fov * (1 + dt), 1, 100);
    this.dirty = true;
  }
  _play(on) {
    this.playing = on ?? !this.playing;
    if (this.playing && this.t >= this.win[1]) this.t = this.win[0];
    this.q('[data-a="play"]').textContent = this.playing ? '❚❚' : '▶';
    this._following = this.playing || this.tracking;
    if (this._following) this._followTarget(true);
  }
  /** keep the Sun centred (when it is hidden, its yellow outline is shown through the terrain) */
  _followTarget(smooth) {
    if (!this.F) return;
    const s = this.sky(this.t);
    if (!s) return;
    const [al, az] = altAz(s.sun), alt = Math.max(al, -85);
    if (smooth) this._anim(az, alt);
    else { this.view.yaw = az; this.view.pitch = clamp(alt, -89, 89); this.dirty = true; }
  }

  _initUI() {
    const cv = this.q('canvas'), v = this.view, ptr = new Map();
    let pinch = 0;
    cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); ptr.set(e.pointerId, [e.clientX, e.clientY]); cv.classList.add('drag'); if (!this._following) this._animF = null; });
    cv.addEventListener('pointermove', e => {
      if (!ptr.has(e.pointerId)) return;
      const [px, py] = ptr.get(e.pointerId); ptr.set(e.pointerId, [e.clientX, e.clientY]);
      if (ptr.size === 2) { const [a, b] = [...ptr.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch) v.fov = clamp(v.fov * pinch / d, 1, 100); pinch = d; this.dirty = true; return; }
      if (this._following) return;                    // view is locked on the Sun while time plays
      const k = v.fov / cv.clientHeight;
      v.yaw = (v.yaw - (e.clientX - px) * k + 360) % 360; v.pitch = clamp(v.pitch + (e.clientY - py) * k, -89, 89); this.dirty = true;
    });
    const up = e => { ptr.delete(e.pointerId); pinch = 0; if (!ptr.size) cv.classList.remove('drag'); };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', e => { e.preventDefault(); v.fov = clamp(v.fov * Math.exp(e.deltaY * 0.0012), 1, 100); this.dirty = true; }, { passive: false });
    this._kd = new Set();
    cv.addEventListener('keydown', e => {
      if (e.key === ' ') {                            // embedded: the host's Play owns time (its document handler gets it)
        e.preventDefault(); if (!this.embedded) this._play(); return;
      }
      if (e.key.startsWith('Arrow')) e.preventDefault();
      this._kd.add(e.key);
    });
    cv.addEventListener('keyup', e => this._kd.delete(e.key));
    cv.addEventListener('blur', () => this._kd.clear());

    const sel = this.i('preset');
    sel.innerHTML = '<option value="-1">— custom location —</option>' + PRESETS.map((p, k) => `<option value="${k}">${p[0]}</option>`).join('');
    sel.onchange = () => { const p = PRESETS[+sel.value]; if (p) this.setLocation(p[1], p[2]); };
    const go = () => this.setLocation(+this.i('lat').value, +this.i('lon').value);
    for (const n of ['lat', 'lon']) this.i(n).addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    this.i('date').addEventListener('change', e => { const t = Date.parse(e.target.value + 'Z'); if (isFinite(t)) this._setWindow(t, this.span); });
    this.i('span').onchange = e => this._setWindow(this.win[0], +e.target.value, true);
    this.i('time').addEventListener('input', e => { this.t = this.win[0] + (+e.target.value / 10000) * (this.win[1] - this.win[0]); this._syncTime(); });
    for (const n of ['paths', 'stars', 'grid', 'labels', 'shadows']) this.i(n).onchange = e => { this.opt[n] = e.target.checked; this.dirty = true; };
    this.i('detail').onchange = e => { this.opt.detail = e.target.checked; this.setLocation(this.site.lat, this.site.lon, false); };
    this.i('scale').oninput = e => { this.opt.scale = +e.target.value; this.q('[data-o="scale"]').textContent = e.target.value + '×'; this.dirty = true; };
    this.i('exp').oninput = e => { this.opt.exp = +e.target.value; this.dirty = true; };

    const lookBody = b => { const s = this.sky(this.t); if (s) { const [al, az] = altAz(s[b]); this._anim(az, al, b === 'earth' ? 12 : 25); } };
    const actions = {
      menu: () => { this.q('.panel').classList.toggle('open'); this.q('[data-a="menu"]').classList.toggle('on'); },
      earth: () => lookBody('earth'), sun: () => lookBody('sun'),
      hor: () => this._anim(v.yaw, 4, 70),
      go, now: () => this._setWindow(Math.floor(Date.now() / 36e5) * 36e5, this.span),
      play: () => this._play(),
    };
    this.root.addEventListener('click', e => { const b = e.target.closest('[data-a]'); if (b && actions[b.dataset.a]) actions[b.dataset.a](); });
  }
}

if (!customElements.get('moon-sky')) customElements.define('moon-sky', MoonSky);
window.MoonSky = MoonSky;
})();
