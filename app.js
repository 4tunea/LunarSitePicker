/* Lunar Site Navigator: interface.
   All Sun, Earth and skyline numbers come from NAV_DATA (docs/data-contract.md).
   Visibility is derived here, following contract section 7, so the rules stay user-settable. */
(function () {
  var NS = 'http://www.w3.org/2000/svg', RAD = Math.PI / 180;
  var $ = function (id) { return document.getElementById(id); };
  var D = window.NAV_DATA;
  if (!D || !D.sites || !D.sites.length) {
    $('globeLoad').classList.remove('on');
    var msg = Object.assign(document.createElement('p'), { className: 'nogl', textContent: 'No data file loaded. Expected web/data/navigator-data.js (written by precompute/build.py).' });
    $('globeWrap').appendChild(msg);
    return;
  }
  $('globeLoad').classList.add('on');

  /* ================= data layer (the only part that knows the file format) ================= */
  var T0 = Date.parse(D.time.start_utc), STEP = D.time.step_s * 1000, N = D.time.count;
  var SPD = Math.round(86400 / D.time.step_s);                // samples per day
  var NAZ = D.horizon_grid.n_az, AZSTEP = D.horizon_grid.step_deg, RKM = D.constants.moon_radius_km;
  var MASTS = D.sites[0].horizons.map(function (h) { return h.mast_height_m; });
  var LAST_DAY = Math.floor((N - 1) / SPD);
  var TER = null;                                             // coarse terrain grid for spots south of 80 S, once decoded

  function basis(lat, lon) {
    var a = lat * RAD, o = lon * RAD;
    return { up: [Math.cos(a) * Math.cos(o), Math.cos(a) * Math.sin(o), Math.sin(a)],
             east: [-Math.sin(o), Math.cos(o), 0],
             north: [-Math.sin(a) * Math.cos(o), -Math.sin(a) * Math.sin(o), Math.cos(a)] };
  }
  // Moon-fixed Sun direction and Earth position for every sample, recovered from the first site's
  // angles. They let us place the Sun and Earth for any other point without a second ephemeris.
  var SUN = new Float64Array(3 * N), EARTH = new Float64Array(3 * N);
  (function () {
    var s = D.sites[0], b = basis(s.lat_deg, s.lon_deg), r0 = RKM + s.ground_elev_m / 1000;
    function dir(alt, az) {
      var ca = Math.cos(alt * RAD), n = ca * Math.cos(az * RAD), e = ca * Math.sin(az * RAD), u = Math.sin(alt * RAD);
      return [n * b.north[0] + e * b.east[0] + u * b.up[0], n * b.north[1] + e * b.east[1] + u * b.up[1], n * b.north[2] + e * b.east[2] + u * b.up[2]];
    }
    for (var k = 0; k < N; k++) {
      var d = dir(s.sun.alt_deg[k], s.sun.az_deg[k]);
      SUN[3 * k] = d[0]; SUN[3 * k + 1] = d[1]; SUN[3 * k + 2] = d[2];
      var e = dir(s.earth.alt_deg[k], s.earth.az_deg[k]), dist = 6371.0 / Math.sin(D.bodies.earth.diam_deg[k] * RAD / 2);
      for (var i = 0; i < 3; i++) EARTH[3 * k + i] = r0 * b.up[i] + dist * e[i];
    }
  })();
  function subPoint(arr, k) {
    var x = arr[3 * k], y = arr[3 * k + 1], z = arr[3 * k + 2], l = Math.hypot(x, y, z);
    return { lat: Math.asin(z / l) / RAD, lon: Math.atan2(y, x) / RAD, dist: l };
  }

  // group: 'pole' = analysed south-pole site, 'past' = past landing, 'pin' = the user's own coordinates
  function makeSite(kind, group, o) {
    return { kind: kind, group: group, id: o.id, name: o.name, note: o.note || '', lat: o.lat, lon: o.lon, src: o.src || null,
             ser: null, hz: null, ground: null, vis: null, visKey: '' };
  }
  var ANALYSED = D.sites.map(function (s) {
    return makeSite('analysed', 'pole', { id: s.id, name: s.name, note: 'South pole' + (s.pgda_site ? ' · PGDA ' + s.pgda_site : ''), lat: s.lat_deg, lon: s.lon_deg, src: s });
  });
  var PAST = (window.PAST_LANDINGS || []).map(function (p) { return makeSite('past', 'past', p); });
  var PINS = [], pinSeq = 0;
  function allSites() { return ANALYSED.concat(PAST, PINS); }
  var GROUP_TEXT = { pole: 'South pole', past: 'Past landing', pin: 'My pin' };

  // Sun and Earth angles for a site: straight from the file for analysed sites, derived otherwise.
  function series(site) {
    if (site.ser) return site.ser;
    if (site.src) return (site.ser = { sunAlt: site.src.sun.alt_deg, sunAz: site.src.sun.az_deg, earthAlt: site.src.earth.alt_deg, earthAz: site.src.earth.az_deg });
    var b = basis(site.lat, site.lon), r = RKM + (site.ground || 0) / 1000;
    var s = { sunAlt: new Float32Array(N), sunAz: new Float32Array(N), earthAlt: new Float32Array(N), earthAz: new Float32Array(N) };
    function dot(a, x, y, z) { return a[0] * x + a[1] * y + a[2] * z; }
    for (var k = 0; k < N; k++) {
      var x = SUN[3 * k], y = SUN[3 * k + 1], z = SUN[3 * k + 2];
      s.sunAlt[k] = Math.asin(dot(b.up, x, y, z)) / RAD;
      s.sunAz[k] = (Math.atan2(dot(b.east, x, y, z), dot(b.north, x, y, z)) / RAD + 360) % 360;
      x = EARTH[3 * k] - r * b.up[0]; y = EARTH[3 * k + 1] - r * b.up[1]; z = EARTH[3 * k + 2] - r * b.up[2];
      var l = Math.hypot(x, y, z);
      s.earthAlt[k] = Math.asin(dot(b.up, x, y, z) / l) / RAD;
      s.earthAz[k] = (Math.atan2(dot(b.east, x, y, z), dot(b.north, x, y, z)) / RAD + 360) % 360;
    }
    return (site.ser = s);
  }
  // 'dem' = horizons from the data file, 'coarse' = built here from the low-resolution grid, 'sphere' = none.
  function terrainOf(site) {
    if (site.src) return site.src.terrain === 'dem' ? 'dem' : 'sphere';
    if (site.hz === null) {
      site.hz = false;
      if (TER && site.lat <= -80) {
        var h = Terrain.horizon(TER, site.lat, site.lon, MASTS, { nAz: NAZ, maxRange: 150000 });
        if (h && h.complete) { site.hz = h.elev; site.ground = h.ground; site.ser = null; }
      }
    }
    return site.hz ? 'coarse' : 'sphere';
  }
  function horizonArr(site) {
    var mi = Math.max(0, MASTS.indexOf(set.mast));
    if (site.src) return site.src.terrain === 'dem' ? site.src.horizons[mi].elev_deg : null;
    return terrainOf(site) === 'coarse' ? site.hz[mi] : null;
  }
  // Skyline height at any azimuth: linear between bins, wrapping (contract section 2).
  function skyline(site, az) {
    var arr = horizonArr(site);
    if (!arr) return Terrain.dip(set.mast);
    var i = (((az % 360) + 360) % 360) / AZSTEP, a = Math.floor(i) % NAZ, f = i - Math.floor(i);
    return arr[a] * (1 - f) + arr[(a + 1) % NAZ] * f;
  }
  // Share of a disc of radius r above a flat horizon line 'clear' degrees below its centre (section 7).
  function fraction(clear, r) {
    var x = Math.max(-1, Math.min(1, clear / r));
    return 1 - (Math.acos(x) - x * Math.sqrt(1 - x * x)) / Math.PI;
  }
  // Per-sample visibility for the whole data period, cached until a rule changes.
  function vis(site) {
    var key = [set.mast, set.sun, set.earth].join('|') + (TER ? 't' : '');
    terrainOf(site);
    if (site.vis && site.visKey === key) return site.vis;
    var s = series(site), v = { sun: new Uint8Array(N), earth: new Uint8Array(N), frac: new Float32Array(N), sunSky: new Float32Array(N), earthSky: new Float32Array(N), pre: new Int32Array(N + 1) };
    for (var k = 0; k < N; k++) {
      var hs = skyline(site, s.sunAz[k]), he = skyline(site, s.earthAz[k]);
      v.sunSky[k] = hs; v.earthSky[k] = he;
      v.frac[k] = fraction(s.sunAlt[k] - hs, D.bodies.sun.diam_deg[k] / 2);
      v.sun[k] = v.frac[k] >= set.sun ? 1 : 0;
      v.earth[k] = s.earthAlt[k] - he > set.earth ? 1 : 0;
      v.pre[k + 1] = v.pre[k] + (v.sun[k] & v.earth[k]);
    }
    site.vis = v; site.visKey = key;
    return v;
  }
  // Verdict for landing at sample k0 and staying m samples.
  function status(site, k0, m) {
    var v = vis(site), s = series(site), end = Math.min(N - 1, k0 + m), total = Math.max(1, end - k0);
    var both = v.pre[k0 + total] - v.pre[k0], st = { k0: k0, both: both, total: total, share: both / total, cut: k0 + m > N - 1 };
    st.sunNow = !!v.sun[k0]; st.earthNow = !!v.earth[k0];
    st.ok = st.sunNow && st.earthNow && st.share >= set.share;
    var dipNow = Terrain.dip(set.mast);
    if (st.ok) st.why = 'Sun and Earth for ' + hrs(both) + ' of the ' + hrs(total) + ' stay';
    else if (!st.sunNow) st.why = s.sunAlt[k0] + D.bodies.sun.diam_deg[k0] / 2 > dipNow ? 'The Sun is behind terrain at landing' : 'The Sun is below the horizon at landing';
    else if (!st.earthNow) st.why = s.earthAlt[k0] > dipNow ? 'Earth is behind terrain at landing' : 'Earth is below the horizon at landing';
    else st.why = 'Sun and Earth for only ' + Math.round(st.share * 100) + '% of the stay';
    return st;
  }
  // First later landing day (same hour) on which the site works, in days from k0. Null if none in the data.
  function nextWindow(site, k0, m) {
    for (var d = 1; k0 + d * SPD + m <= N - 1; d++) if (status(site, k0 + d * SPD, m).ok) return d;
    return null;
  }
  // Longest run of 0s (or of 1s when 'want' is 1) in arr[a..b), in samples.
  function longestRun(arr, a, b, want) {
    var best = 0, run = 0;
    for (var i = a; i < b; i++) { run = arr[i] === want ? run + 1 : 0; if (run > best) best = run; }
    return best;
  }
  // Samples until arr changes value after k, or null if it never does within the data.
  function flip(arr, k) { for (var i = k + 1; i < N; i++) if (arr[i] !== arr[k]) return i - k - 0.5; return null; }

  /* ================= state ================= */
  var set = { mast: MASTS[0], sun: 0.5, earth: 0, share: 0.5 };
  var gopt = { stars: true, lod: true, grid: false, marks: true, relief: 1.6 };      // globe display
  var sopt = {};                                                                       // 3D horizon display (overrides)
  var state = { plan: 0, slip: 0, days: 14, site: null, cur: 0, tech: false, view: '3d', filter: 'all', infoW: 420, home: null,
                picking: false, sel: [], cmpOpen: false, showEarth: true };
  var hadPlan = false;
  try {
    var sv = JSON.parse(localStorage.getItem('lunarNav3') || '{}');
    if (sv.data === D.time.start_utc + D.generator) {
      if (sv.plan >= 0 && sv.plan <= LAST_DAY) { state.plan = sv.plan | 0; hadPlan = true; }
      if (sv.slip >= 0) state.slip = Math.min(sv.slip | 0, LAST_DAY - state.plan);
      if (sv.days >= 1 && sv.days <= 60) state.days = sv.days | 0;
      if (sv.set && MASTS.indexOf(sv.set.mast) >= 0) set = sv.set;
    }
    if (typeof sv.tech === 'boolean') state.tech = sv.tech;
    if (['all', 'pole', 'past', 'pin'].indexOf(sv.filter) >= 0) state.filter = sv.filter;
    if (sv.infoW >= 300 && sv.infoW <= 1400) state.infoW = sv.infoW;
    if (sv.gopt) for (var gk in gopt) if (typeof sv.gopt[gk] === typeof gopt[gk]) gopt[gk] = sv.gopt[gk];
    if (sv.sopt) sopt = sv.sopt;
    if (typeof sv.showEarth === 'boolean') state.showEarth = sv.showEarth;
  } catch (e) {}
  function save() {
    try { localStorage.setItem('lunarNav3', JSON.stringify({ data: D.time.start_utc + D.generator, plan: state.plan, slip: state.slip, days: state.days,
      tech: state.tech, filter: state.filter, showEarth: state.showEarth, infoW: state.infoW, set: set, gopt: gopt, sopt: sopt })); } catch (e) {}
  }
  var planK = function () { return state.plan * SPD; }, landK = function () { return Math.min(N - 1, (state.plan + state.slip) * SPD); };
  var M = function () { return state.days * SPD; };
  var spanK = function () { return Math.min(N - 1 - planK(), Math.max(56, state.slip + state.days + 14) * SPD); };   // timeline length
  var curK = function () { return Math.min(N - 1, planK() + state.cur); };
  // Opening scenario: the first site works on the planned date, fails three weeks later, and another site still works then.
  function findDemo() {
    var hero = ANALYSED[0], m = M(), first = -1;
    for (var d = 0; (d + 21) * SPD + m < N; d++) {
      if (!status(hero, d * SPD, m).ok) continue;
      if (first < 0) first = d;
      var k2 = (d + 21) * SPD;
      if (!status(hero, k2, m).ok && ANALYSED.some(function (s) { return s !== hero && status(s, k2, m).ok; })) return d;
    }
    return Math.max(0, first);
  }
  if (!hadPlan) state.plan = findDemo();
  var pins = [], marks = [], playing = null, ranked = [];

  /* ================= helpers ================= */
  function el(tag, attrs, text) {
    var n = document.createElementNS(NS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    return n;
  }
  function html(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function rows(table, data) {
    clear(table);
    data.forEach(function (r) { var tr = html('tr'); tr.appendChild(html('td', '', r[0])); tr.appendChild(html('td', '', r[1])); table.appendChild(tr); });
  }
  function ms(k) { return T0 + k * STEP; }
  function hrs(samples) { var h = samples * STEP / 3600000, d = Math.round(h / 2.4) / 10; return h >= 48 ? d + ' d' : Math.round(h) + ' h'; }
  function dur(samples) {
    var h = samples * STEP / 3600000;
    if (h < 1) return Math.max(1, Math.round(h * 60)) + ' min';
    var d = Math.floor(h / 24), r = Math.round(h - d * 24);
    if (r === 24) { d += 1; r = 0; }
    return d ? d + ' d ' + r + ' h' : r + ' h';
  }
  function coord(lat, lon) {
    return Math.abs(lat).toFixed(3) + '° ' + (lat < 0 ? 'S' : 'N') + ', ' + Math.abs(lon).toFixed(3) + '° ' + (lon < 0 ? 'W' : 'E');
  }
  function lonText(lon) { lon = ((lon + 540) % 360) - 180; return Math.abs(lon).toFixed(1) + '° ' + (lon < 0 ? 'W' : 'E'); }
  function fmtTime(k) { return new Date(ms(k)).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'; }
  function dayText(k, year) {
    var o = { day: 'numeric', month: 'short', timeZone: 'UTC' }; if (year) o.year = 'numeric';
    return new Date(ms(k)).toLocaleDateString('en-GB', o);
  }
  function isoDay(day) { return new Date(T0 + day * 86400000).toISOString().slice(0, 10); }
  function deg(v) { return (v < 0 ? '−' : '') + Math.abs(v).toFixed(2) + '°'; }
  function deg1(v) { return (v < 0 ? '−' : '') + Math.abs(v).toFixed(1) + '°'; }
  function pct(x) { return Math.round(x * 100) + '%'; }
  var TERRAIN_TEXT = { dem: 'Analysed terrain (LOLA 5 m + 120 m)', coarse: 'Coarse terrain, 720 m grid', sphere: 'Smooth sphere, no terrain data' };
  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = src; s.async = true;
      s.onload = function () { res(); }; s.onerror = function () { rej(new Error('Could not load ' + src)); };
      document.body.appendChild(s);
    });
  }
  function decodeImg(url) {
    return new Promise(function (res, rej) { var i = new Image(); i.onload = function () { res(i); }; i.onerror = rej; i.src = url; });
  }

  /* ================= lists and pins ================= */
  function rank() {
    var k = landK(), m = M();
    ranked = allSites().map(function (s) { return { site: s, st: status(s, k, m), was: state.slip ? status(s, planK(), m) : null }; })
      .sort(function (a, b) { return (b.st.ok - a.st.ok) || (b.st.both - a.st.both) || (a.site.name < b.site.name ? -1 : 1); });
    var n = 0;
    ranked.forEach(function (e) { e.rank = e.st.ok ? ++n : 0; });
  }
  function isSel(s) { return state.sel.indexOf(s) >= 0; }
  function activate(s) { if (state.picking) toggleSel(s); else select(s); }
  function listItem(e) {
    var s = e.site, li = html('li');
    li.style.position = 'relative';
    var b = html('button', 'item' + (e.st.ok ? '' : ' bad') + (state.site === s ? ' on' : '') + (isSel(s) ? ' sel' : '')); b.type = 'button';
    b.appendChild(html('span', 'n', state.picking ? '' : e.rank ? String(e.rank) : '!'));
    b.appendChild(html('span', 'nm', s.name));
    b.appendChild(html('span', 'tag', GROUP_TEXT[s.group]));
    b.appendChild(html('span', 'why', e.st.why));
    if (e.was && e.was.ok && !e.st.ok) b.appendChild(html('span', 'was', 'Worked on the planned date'));
    b.appendChild(html('small', '', (s.note ? s.note + ' · ' : '') + coord(s.lat, s.lon)));
    b.appendChild(html('span', 'score', pct(e.st.share) + ' of the stay · ' + TERRAIN_TEXT[terrainOf(s)].toLowerCase()));
    b.setAttribute('aria-label', s.name + ', ' + (e.st.ok ? 'available' : 'not available') + (state.picking ? (isSel(s) ? ', selected' : ', not selected') : ''));
    b.addEventListener('click', function () { activate(s); });
    li.appendChild(b);
    if (s.group === 'pin') {
      var del = html('button', 'del', 'Remove'); del.type = 'button';
      del.setAttribute('aria-label', 'Remove ' + s.name);
      del.addEventListener('click', function (ev) { ev.stopPropagation(); removePin(s); });
      li.appendChild(del);
    }
    return li;
  }
  function renderList() {
    var good = ranked.filter(function (e) { return e.st.ok; }).length;
    $('sideSub').textContent = good + ' of ' + ranked.length + ' available for landing on ' + dayText(landK(), true) + ', ' + state.days + '-day stay.';
    var counts = { all: ranked.length, pole: 0, past: 0, pin: 0 };
    ranked.forEach(function (e) { counts[e.site.group]++; });
    counts.pole += counts.pin; counts.past += counts.pin;
    Array.prototype.forEach.call(document.querySelectorAll('#filters .chip'), function (c) {
      var f = c.getAttribute('data-f');
      c.setAttribute('aria-selected', String(state.filter === f));
      if (!c.dataset.label) c.dataset.label = c.textContent;
      clear(c); c.appendChild(document.createTextNode(c.dataset.label)); c.appendChild(html('small', '', String(counts[f])));
    });
    var a = $('rank'); clear(a);
    a.classList.toggle('picking', state.picking);
    $('side').classList.toggle('picking', state.picking);
    var shown = ranked.filter(function (e) { return state.filter === 'all' || e.site.group === state.filter || e.site.group === 'pin'; });   // your pins always show
    shown.forEach(function (e) { a.appendChild(listItem(e)); });
    if (!shown.length) a.appendChild(html('li', 'empty', state.filter === 'pin' ? 'No pins yet. Add coordinates below, or double-click the Moon.' : 'No sites.'));
  }
  function renderPins() {
    var wrap = $('pins'); clear(wrap); pins = [];
    ranked.slice().reverse().forEach(function (e) {
      var s = e.site, on = state.site === s, small = s.group === 'past';
      var b = html('button', 'pin' + (e.st.ok ? '' : ' bad') + (small ? ' small' : '') + (s.group === 'pin' ? ' user' : '') +
        (s.group === 'pole' && e.rank && e.rank <= 3 ? ' top' : '') + (on ? ' on' : '') + (isSel(s) ? ' sel' : ''), small ? '' : e.rank ? String(e.rank) : '!');
      b.type = 'button'; b.style.zIndex = String(on ? 100 : (e.st.ok ? 60 : 20) - (small ? 10 : 0));
      b.setAttribute('aria-label', s.name + (e.st.ok ? ', available' : ', not available'));
      b.appendChild(html('span', 'lbl', s.name));
      b.addEventListener('click', function (ev) { ev.stopPropagation(); activate(s); });
      wrap.appendChild(b); pins.push({ node: b, lat: s.lat, lon: s.lon });
    });
    marks = [];
    [['s', 'Sun overhead'], ['e', 'Earth overhead']].forEach(function (m) {
      var d = html('div', 'mark ' + m[0]); d.appendChild(html('span', '', m[1])); d.hidden = !gopt.marks;
      wrap.appendChild(d); marks.push({ node: d, lat: 0, lon: 0 });
    });
    renderMarks();
  }
  function renderMarks() {
    if (marks.length < 2) return;
    var k = state.site ? curK() : landK(), s = subPoint(SUN, k), e = subPoint(EARTH, k);
    marks[0].lat = s.lat; marks[0].lon = s.lon; marks[1].lat = e.lat; marks[1].lon = e.lon;
    marks.forEach(function (m) { m.node.hidden = !gopt.marks; });
    placePins();
  }
  function placePins() {
    pins.concat(marks).forEach(function (p) {
      if (p.node.hidden) return;
      var q = Globe.project(p.lat, p.lon);
      p.node.style.display = q.visible ? '' : 'none';
      if (q.visible) p.node.style.transform = 'translate(' + q.x.toFixed(1) + 'px,' + q.y.toFixed(1) + 'px)';
    });
  }
  function lightGlobe() {
    var k = state.site ? curK() : landK(), s = subPoint(SUN, k), e = subPoint(EARTH, k);
    Globe.set({ sun: Globe.dir(s.lat, s.lon), earth: Globe.dir(e.lat, e.lon), grid: gopt.grid, relief: gopt.relief, stars: gopt.stars, lod: gopt.lod });
  }

  /* ================= whole-Moon technical panel ================= */
  function renderMoonTech() {
    $('moonTech').hidden = !state.tech || !!state.site;
    if ($('moonTech').hidden) return;
    var k = landK(), s = subPoint(SUN, k), e = subPoint(EARTH, k), a = Globe.dir(s.lat, s.lon), b = Globe.dir(e.lat, e.lon);
    var lit = (1 + a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / 2, waxing = (((s.lon - e.lon) + 540) % 360) - 180 > 0;
    var name = lit < 0.03 ? 'New Moon' : lit > 0.97 ? 'Full Moon' : Math.abs(lit - 0.5) < 0.04 ? (waxing ? 'First quarter' : 'Last quarter') :
      (waxing ? 'Waxing ' : 'Waning ') + (lit < 0.5 ? 'crescent' : 'gibbous');
    rows($('moonTable'), [
      ['Landing', fmtTime(k)],
      ['Phase seen from Earth', name + ', ' + Math.round(lit * 100) + '% lit'],
      ['Sun overhead at', coord(s.lat, s.lon)], ['Earth overhead at (libration)', coord(e.lat, e.lon)],
      ['Sunrise line', lonText(s.lon - 90)], ['Sunset line', lonText(s.lon + 90)],
      ['South pole season', (s.lat < 0 ? 'Summer' : 'Winter') + ', Sun ' + Math.abs(s.lat).toFixed(2) + '° ' + (s.lat < 0 ? 'south' : 'north')],
      ['Earth distance', Math.round(e.dist).toLocaleString('en-US') + ' km']
    ]);
    var t = $('rankTable'); clear(t);
    var head = html('tr'); ['Site', 'Both', 'Share', 'Next window'].forEach(function (h) { head.appendChild(html('th', '', h)); });
    t.appendChild(head);
    ranked.forEach(function (r) {
      var tr = html('tr', r.st.ok ? '' : 'no'), nw = r.st.ok ? 'Now' : nextWindow(r.site, k, M());
      [(r.rank ? r.rank + '. ' : '') + r.site.name, hrs(r.st.both), pct(r.st.share), nw === 'Now' ? nw : nw == null ? 'None' : '+' + nw + ' d']
        .forEach(function (c) { tr.appendChild(html('td', '', String(c))); });
      t.appendChild(tr);
    });
    rows($('dataTable'), [
      ['Generator', D.generator], ['Generated', D.generated_utc],
      ['Positions', D.ephemeris.software + ', ' + D.ephemeris.frame], ['Corrections', D.ephemeris.corrections],
      ['Covers', dayText(0, true) + ' to ' + dayText(N - 1, true)], ['Skyline bins', NAZ + ' (' + AZSTEP + '°)']
    ]);
  }
  function fillRules() {
    var sel = $('setMast'); clear(sel);
    MASTS.forEach(function (m) { var o = html('option', '', m + ' m'); o.value = m; sel.appendChild(o); });
    sel.value = set.mast; $('setSun').value = Math.round(set.sun * 100); $('setEarth').value = set.earth; $('setShare').value = Math.round(set.share * 100);
  }
  // Display settings live in the technical panel that is showing (whole Moon or site).
  function placeDisplay() {
    var box = $('displayBox'), slot = state.site ? $('siteDisplaySlot') : $('moonDisplaySlot');
    box.hidden = !state.tech;
    if (box.parentNode !== slot) slot.appendChild(box);
  }
  function fillDisplay() {
    var so = hasSurface && SURF.getOptions ? Object.assign(SURF.getOptions(), sopt) : sopt;
    Array.prototype.forEach.call(document.querySelectorAll('#displayBox [data-g]'), function (i) {
      var k = i.getAttribute('data-g');
      if (i.type === 'checkbox') i.checked = !!gopt[k]; else i.value = gopt[k];
    });
    Array.prototype.forEach.call(document.querySelectorAll('#displayBox [data-s]'), function (i) {
      var k = i.getAttribute('data-s');
      if (!(k in so)) return;
      if (i.type === 'checkbox') i.checked = !!so[k]; else i.value = so[k];
    });
    Array.prototype.forEach.call(document.querySelectorAll('#displayBox output[data-o]'), function (o) {
      var k = o.getAttribute('data-o'), v = k === 'relief' ? gopt.relief : so[k];
      o.textContent = v == null ? '' : (+v).toFixed(k === 'exp' ? 2 : 1) + '×';
    });
  }

  /* ================= site inspector ================= */
  function renderOptions(site, st) {
    var box = $('options'); clear(box);
    box.hidden = st.ok;
    if (st.ok) return;
    var k = landK(), m = M();
    box.appendChild(html('h3', '', 'Two ways to recover'));
    box.appendChild(html('h4', '', 'Switch site, keep ' + dayText(k)));
    var alts = ranked.filter(function (r) { return r.st.ok && r.site !== site; }).slice(0, 3);
    if (!alts.length) box.appendChild(html('p', '', 'No site in the list works on this date.'));
    alts.forEach(function (r) {
      var b = html('button', 'opt'); b.type = 'button';
      b.appendChild(html('b', '', r.site.name)); b.appendChild(html('small', '', hrs(r.st.both) + ' of ' + hrs(r.st.total) + ' with Sun and Earth'));
      b.addEventListener('click', function () { select(r.site); });
      box.appendChild(b);
    });
    box.appendChild(html('h4', '', 'Keep ' + site.name + ', land later'));
    var d = nextWindow(site, k, m);
    if (d == null) box.appendChild(html('p', '', 'No later window before the data ends on ' + dayText(N - 1, true) + '.'));
    else {
      var nb = html('button', 'opt'); nb.type = 'button';
      nb.appendChild(html('b', '', 'Land on ' + dayText(k + d * SPD, true))); nb.appendChild(html('small', '', d + (d === 1 ? ' day' : ' days') + ' later'));
      nb.addEventListener('click', function () { setMission(state.plan, state.slip + d, state.days); });
      box.appendChild(nb);
    }
  }
  function runs(arr, a, b, both) {
    var out = [], start = -1;
    for (var i = a; i <= b; i++) {
      var on = both ? arr[i] && both[i] : arr[i];
      if (on && start < 0) start = i;
      if ((!on || i === b) && start >= 0) { out.push([start, on ? i : i - 1]); start = -1; }
    }
    return out;
  }
  function stripSvg(svg, v, p, span, W, H, cur, win) {
    clear(svg);
    var k = W / span, h = (H - 6) / 3;
    [[v.sun, null, '#F5A524', 0], [v.earth, null, '#5AA9FF', 1], [v.sun, v.earth, '#3DD6B0', 2]].forEach(function (row) {
      var y = 1 + row[3] * (h + 2);
      svg.appendChild(el('rect', { x: 0, y: y, width: W, height: h, fill: '#1d212b' }));
      runs(row[0], p, Math.min(N - 1, p + span), row[1]).forEach(function (r) {
        svg.appendChild(el('rect', { x: (r[0] - p) * k, y: y, width: Math.max(1, (r[1] - r[0]) * k), height: h, fill: row[2] }));
      });
    });
    if (win) svg.appendChild(el('rect', { x: win[0] * k, y: 0.5, width: Math.max(1, (win[1] - win[0]) * k), height: H - 1, fill: 'none', stroke: '#e9ecf2', 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke' }));
    if (cur != null) svg.appendChild(el('line', { x1: cur * k, x2: cur * k, y1: 0, y2: H, stroke: '#fff', 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke' }));
  }
  function renderStrips(site) {
    var svg = $('strips'), v = vis(site), p = planK(), span = spanK();
    stripSvg(svg, v, p, span, 800, 62, state.cur, [landK() - p, Math.min(span, landK() + M() - p)]);
    if (state.slip) svg.appendChild(el('line', { x1: 0.5, x2: 0.5, y1: 0, y2: 62, stroke: '#fff', 'stroke-width': 1.5, 'stroke-dasharray': '4 3', 'vector-effect': 'non-scaling-stroke' }));
    var sc = $('tlScale'); clear(sc);
    [0, 0.25, 0.5, 0.75, 1].forEach(function (f) { sc.appendChild(html('span', '', (f === 0 && state.slip ? 'Planned ' : '') + dayText(p + Math.round(span * f)))); });
  }
  // Landing-date explorer: one cell per landing day in the data; colour = verdict, strength = share of the stay
  // with Sun and Earth. Click a day to land then.
  var calKey = '';
  function renderCal(site) {
    var key = site.id + '|' + landK() + '|' + planK() + '|' + M() + '|' + site.visKey + '|' + set.share;
    if (key === calKey) return;
    calKey = key;
    var svg = $('cal'); clear(svg);
    var nd = LAST_DAY + 1, w = 800 / nd, m = M(), hour = landK() % SPD;
    for (var d = 0; d < nd; d++) {
      var k0 = Math.min(N - 1, d * SPD + hour), st = status(site, k0, m);
      var fill = st.ok ? 'rgba(61,214,176,' + (0.35 + 0.65 * st.share).toFixed(2) + ')' : st.share > 0 ? 'rgba(240,138,75,' + (0.18 + 0.5 * st.share).toFixed(2) + ')' : '#1d212b';
      var r = el('rect', { x: (d * w).toFixed(2), y: 6, width: Math.max(0.6, w - 0.4).toFixed(2), height: 34, fill: fill });
      r.appendChild(el('title', {}, dayText(k0, true) + ': ' + (st.ok ? 'available' : 'not available') + ', Sun and Earth ' + pct(st.share) + ' of the stay' + (st.cut ? ' (data ends)' : '')));
      r.setAttribute('data-d', d);
      svg.appendChild(r);
    }
    var lx = (state.plan + state.slip + 0.5) * w, px = (state.plan + 0.5) * w;
    if (state.slip) svg.appendChild(el('line', { x1: px, x2: px, y1: 0, y2: 46, stroke: '#e9ecf2', 'stroke-width': 1.5, 'stroke-dasharray': '3 3', 'vector-effect': 'non-scaling-stroke' }));
    svg.appendChild(el('line', { x1: lx, x2: lx, y1: 0, y2: 46, stroke: '#fff', 'stroke-width': 2.5, 'vector-effect': 'non-scaling-stroke' }));
    var sc = $('calScale'); clear(sc);
    var every = ($('cal').clientWidth || 800) < 560 ? 2 : 1, mi = 0;
    for (var dd = 0; dd < nd; dd++) {
      var dt = new Date(T0 + dd * 86400000);
      if (dt.getUTCDate() !== 1) continue;
      if (mi++ % every) continue;
      var o = { month: 'short', timeZone: 'UTC' }; if (dt.getUTCMonth() === 0) o.year = '2-digit';
      var sp = html('span', '', dt.toLocaleDateString('en-GB', o));
      sp.style.left = (dd / nd * 100).toFixed(2) + '%';
      sc.appendChild(sp);
    }
    $('calHint').textContent = 'Each column is a landing day. Green: available. Click a day to land then.';
  }
  // 2D horizon: the unrolled 360 degree skyline with the Sun and Earth paths over the stay.
  var panoKey = '', panoGeom = null;
  function renderPano(site) {
    var svg = $('pano'), L = 54, R = 990, T = 12, B = 258;
    var k0 = landK(), k1 = Math.min(N - 1, k0 + M()), s = series(site), v = vis(site);
    var key = site.id + '|' + k0 + '|' + k1 + '|' + site.visKey + '|' + set.mast + '|' + state.showEarth;
    if (key !== panoKey) {
      panoKey = key; clear(svg);
      var sky = [], skyMin = 90, skyMax = -90, a, i, k;
      for (i = 0; i <= 720; i++) { a = i * 0.5; var hh = skyline(site, a); sky.push(hh); if (hh < skyMin) skyMin = hh; if (hh > skyMax) skyMax = hh; }
      var hi = skyMax;
      for (k = k0; k <= k1; k++) { hi = Math.max(hi, s.sunAlt[k], s.earthAlt[k]); }
      var top = Math.min(90, hi + Math.max(1, (hi - skyMin) * 0.08));
      var lo = Math.min(skyMin, Terrain.dip(set.mast)) - Math.max(1, (top - skyMin) * 0.1);
      var X = function (az) { return L + az / 360 * (R - L); }, Y = function (al) { return T + (top - al) / (top - lo) * (B - T); };
      panoGeom = { X: X, Y: Y, lo: lo, top: top };
      var defs = el('defs', {}), cp = el('clipPath', { id: 'panoClip' });
      cp.appendChild(el('rect', { x: L, y: T, width: R - L, height: B - T })); defs.appendChild(cp); svg.appendChild(defs);
      svg.appendChild(el('rect', { x: L, y: T, width: R - L, height: B - T, fill: '#06080d' }));
      var g = el('g', { 'clip-path': 'url(#panoClip)' }); svg.appendChild(g);
      var span = top - lo, step = span > 120 ? 30 : span > 50 ? 10 : span > 20 ? 5 : span > 8 ? 2 : 1;
      for (var e = Math.ceil(lo / step) * step; e <= top; e += step) {
        g.appendChild(el('line', { x1: L, x2: R, y1: Y(e), y2: Y(e), stroke: e === 0 ? '#5d6579' : '#1c2029', 'stroke-width': 1, 'stroke-dasharray': e === 0 ? '5 4' : '' }));
        svg.appendChild(el('text', { x: L - 8, y: Y(e) + 5, fill: '#8e97aa', 'font-size': 15, 'text-anchor': 'end' }, e + '°'));
      }
      ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'N'].forEach(function (t, j) {
        var x = X(j * 45);
        g.appendChild(el('line', { x1: x, x2: x, y1: T, y2: B, stroke: '#1c2029', 'stroke-width': 1 }));
        svg.appendChild(el('text', { x: x, y: B + 22, fill: j % 2 ? '#8e97aa' : '#c0c7d4', 'font-size': 15, 'font-weight': j % 2 ? 400 : 650, 'text-anchor': 'middle' }, t));
      });
      var pts = L + ',' + B;
      for (i = 0; i <= 720; i++) pts += ' ' + X(i * 0.5).toFixed(1) + ',' + Y(sky[i]).toFixed(1);
      pts += ' ' + R + ',' + B;
      g.appendChild(el('polygon', { points: pts, fill: '#232834', stroke: '#9aa3b6', 'stroke-width': 1.2, 'stroke-linejoin': 'round' }));
      // paths over the stay: solid where above the skyline, dashed where terrain hides the body
      function path(alt, az, col) {
        var segs = [], cur = null;
        for (var kk = k0; kk <= k1; kk++) {
          var x = X(az[kk]), y = Y(alt[kk]), up = alt[kk] > skyline(site, az[kk]);
          var jump = cur && Math.abs(az[kk] - cur.az) > 180;
          if (!cur || jump || cur.up !== up) {
            if (cur && !jump) cur.pts.push([x, y]);
            cur = { up: up, pts: [[x, y]], az: az[kk] }; segs.push(cur);
          } else { cur.pts.push([x, y]); cur.az = az[kk]; }
        }
        segs.forEach(function (sg) {
          if (sg.pts.length < 2) return;
          g.appendChild(el('polyline', { points: sg.pts.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' '), fill: 'none', stroke: col,
            'stroke-width': sg.up ? 2.2 : 1.6, 'stroke-dasharray': sg.up ? '' : '5 4', opacity: sg.up ? 1 : 0.75, 'stroke-linejoin': 'round' }));
        });
        for (var dk = k0; dk <= k1; dk += SPD) g.appendChild(el('circle', { cx: X(az[dk]), cy: Y(alt[dk]), r: 2.4, fill: col }));
      }
      if (state.showEarth) path(s.earthAlt, s.earthAz, '#5AA9FF');
      path(s.sunAlt, s.sunAz, '#F5A524');
      svg.appendChild(el('rect', { x: L, y: T, width: R - L, height: B - T, fill: 'none', stroke: '#262b37' }));
      svg.appendChild(el('g', { id: 'panoNow' }));
    }
    // current Sun and Earth
    var now = svg.querySelector('#panoNow'); clear(now);
    var k = curK(), G = panoGeom;
    (state.showEarth ? [['Earth', s.earthAlt[k], s.earthAz[k], '#5AA9FF', !!v.earth[k], 7]] : []).concat([['Sun', s.sunAlt[k], s.sunAz[k], '#F5A524', !!v.sun[k], 8]]).forEach(function (b) {
      var x = G.X(b[2]), y = G.Y(Math.max(G.lo + 0.02 * (G.top - G.lo), Math.min(G.top, b[1]))), below = b[1] < G.lo;
      now.appendChild(el('circle', b[4] ? { cx: x, cy: y, r: b[5], fill: b[3], stroke: '#06080d', 'stroke-width': 1.5 }
        : { cx: x, cy: y, r: b[5], fill: 'rgba(6,8,13,.6)', stroke: b[3], 'stroke-width': 2, 'stroke-dasharray': '3 2.5' }));
      var tx = x > 900 ? x - 12 : x + 12, anchor = x > 900 ? 'end' : 'start';
      now.appendChild(el('text', { x: tx, y: y - 11, fill: b[3], 'font-size': 16, 'font-weight': 650, 'text-anchor': anchor, stroke: '#06080d', 'stroke-width': 4, 'paint-order': 'stroke' },
        b[0] + ' ' + deg1(b[1]) + (below ? ' ↓' : '') + (b[4] ? '' : ' (hidden)')));
    });
  }
  // Plain-language reasons: why this site behaves the way it does.
  function renderWhy(site, st) {
    var box = $('why'); clear(box);
    var s = series(site), v = vis(site), k0 = landK(), k1 = Math.min(N - 1, k0 + M()), maxA = -90, minA = 90, eMax = -90, eMin = 90;
    for (var k = k0; k <= k1; k++) { maxA = Math.max(maxA, s.sunAlt[k]); minA = Math.min(minA, s.sunAlt[k]); eMax = Math.max(eMax, s.earthAlt[k]); eMin = Math.min(eMin, s.earthAlt[k]); }
    box.appendChild(html('h3', '', 'Why it works this way'));
    function para(parts) { var p = html('p'); parts.forEach(function (x) { p.appendChild(typeof x === 'string' ? document.createTextNode(x) : x); }); box.appendChild(p); }
    var B = function (t) { return html('b', '', t); };
    if (Math.abs(site.lat) >= 80) {
      var ridge = Math.round(10000 * Math.tan(Math.max(0.05, maxA) * RAD));
      para(['Near the pole the Sun does not rise and set each day: it circles the horizon once every 29.5 days. During this stay it never climbs above ',
        B(deg1(maxA)), '. A ridge just ', B(ridge.toLocaleString('en-US') + ' m'), ' high, 10 km away, is enough to hide it, so local terrain decides when there is power.']);
      para(['The Sun moves about ', B('12° of azimuth per day'), ' around the sky. A slip of a few days points it at a different stretch of skyline, which is why a short delay can switch a site from available to not available.']);
    } else {
      para(['Here the Sun rises and sets once per lunar day: about ', B('14.8 Earth days of light'), ', then 14.8 days of night, when the surface drops to about −170 °C. During this stay the Sun reaches ',
        B(deg1(maxA)), (minA < 0 ? ' and sets below the horizon.' : '.'), ' Landing soon after local sunrise gives the longest working time.']);
    }
    var earthEver = false, earthAlways = true;
    for (k = 0; k < N; k += 6) { if (s.earthAlt[k] > Terrain.dip(set.mast)) earthEver = true; else earthAlways = false; }
    if (!earthEver) para(['Earth never rises here. The Moon keeps one face towards Earth, so ', B('far-side sites need a relay satellite'), ' to talk to Earth.']);
    else if (earthAlways && eMin > 5) para(['Earth hangs almost still in the sky, moving only a few degrees as the Moon wobbles (libration). It stays between ', B(deg1(eMin)), ' and ', B(deg1(eMax)), ' during this stay.']);
    else para(['Earth sits near the horizon here and drifts by several degrees as the Moon wobbles (libration): between ', B(deg1(eMin)), ' and ', B(deg1(eMax)), ' during this stay, so terrain can cut the radio link for days at a time.']);
  }
  function tile(box, cls, k, v, sub) {
    var t = html('div', 'tile' + (cls ? ' ' + cls : ''));
    t.appendChild(html('div', 'tk', k)); t.appendChild(html('div', 'tv', v)); if (sub) t.appendChild(html('div', 'ts', sub));
    box.appendChild(t);
  }
  function renderSiteTech(site, st, k) {
    $('siteTech').hidden = !state.tech;
    if (!state.tech) return;
    var s = series(site), v = vis(site), src = site.src, t = terrainOf(site);
    var data = [
      ['Time', fmtTime(k)], ['Site', coord(site.lat, site.lon)],
      ['Ground height', src ? src.ground_elev_m.toLocaleString('en-US') + ' m' : site.ground != null ? Math.round(site.ground).toLocaleString('en-US') + ' m' : 'Not known'],
      ['Sun elevation', deg(s.sunAlt[k])], ['Sun azimuth', s.sunAz[k].toFixed(1) + '°'],
      ['Skyline toward the Sun', deg(v.sunSky[k])], ['Sun disc showing', Math.round(v.frac[k] * 100) + '%'],
      ['Earth elevation', deg(s.earthAlt[k])], ['Earth azimuth', s.earthAz[k].toFixed(1) + '°'],
      ['Skyline toward Earth', deg(v.earthSky[k])], ['Earth above the skyline by', deg(s.earthAlt[k] - v.earthSky[k])],
      ['Sun and Earth diameters', D.bodies.sun.diam_deg[k].toFixed(3) + '°, ' + D.bodies.earth.diam_deg[k].toFixed(3) + '°'],
      ['Mast height', set.mast + ' m'], ['Terrain', TERRAIN_TEXT[t]]
    ];
    if (src) {
      data.push(['Coordinate source', src.coord_source.ref]);
      data.push(['Elevation files', src.dem.map(function (d) { return d.file; }).join(', ') || 'None']);
    }
    rows($('techTable'), data);
    $('siteNote').textContent = (src && src.coord_source.note ? src.coord_source.note + ' ' : '') +
      (src ? '' : 'This point is not in the data file. Its Sun and Earth angles are derived here from the first analysed site\'s angles' + (t === 'coarse' ? ', and its skyline from a 720 m grid of the LOLA 75° S elevation model.' : ', and it has no terrain data: the horizon is a smooth sphere.') + ' ') +
      'The Sun counts as up when at least ' + Math.round(set.sun * 100) + '% of its disc clears the skyline, Earth when its centre is more than ' + set.earth + '° above it.';
    var svg = $('elChart'); clear(svg);
    var a0 = landK(), a1 = Math.min(N - 1, a0 + M()), m = Math.max(1, a1 - a0), Lx = 38, Rt = 470, T = 10, Bt = 195, i;
    var lo = -1, hi = 1;
    for (i = a0; i <= a1; i++) { lo = Math.min(lo, s.sunAlt[i], s.earthAlt[i], v.sunSky[i]); hi = Math.max(hi, s.sunAlt[i], s.earthAlt[i], v.sunSky[i], v.earthSky[i]); }
    var pad = (hi - lo) * 0.06; lo -= pad; hi += pad;
    var X = function (j) { return Lx + (j - a0) / m * (Rt - Lx); }, Y = function (a) { return T + (hi - a) / (hi - lo) * (Bt - T); };
    var step = (hi - lo) > 80 ? 30 : (hi - lo) > 30 ? 10 : (hi - lo) > 10 ? 5 : 1;
    for (var g = Math.ceil(lo / step) * step; g <= hi; g += step) {
      svg.appendChild(el('line', { x1: Lx, x2: Rt, y1: Y(g), y2: Y(g), stroke: g === 0 ? '#8e97aa' : '#262b37', 'stroke-width': 1 }));
      svg.appendChild(el('text', { x: Lx - 6, y: Y(g) + 4, fill: '#8e97aa', 'font-size': 11, 'text-anchor': 'end' }, g + '°'));
    }
    svg.appendChild(el('text', { x: Lx, y: Bt + 16, fill: '#8e97aa', 'font-size': 11 }, 'Landing'));
    svg.appendChild(el('text', { x: Rt, y: Bt + 16, fill: '#8e97aa', 'font-size': 11, 'text-anchor': 'end' }, 'Take-off'));
    function line(arr, color, dash) {
      var pts = '';
      for (var j = a0; j <= a1; j++) pts += X(j).toFixed(1) + ',' + Y(arr[j]).toFixed(1) + ' ';
      var a = { points: pts, fill: 'none', stroke: color, 'stroke-width': dash ? 1.1 : 2 };
      if (dash) a['stroke-dasharray'] = '4 3';
      svg.appendChild(el('polyline', a));
    }
    line(v.sunSky, '#F5A524', true); line(v.earthSky, '#5AA9FF', true);
    line(s.sunAlt, '#F5A524'); line(s.earthAlt, '#5AA9FF');
    svg.appendChild(el('text', { x: Rt + 6, y: Y(s.sunAlt[a1]) + 4, fill: '#F5A524', 'font-size': 12, 'font-weight': 600 }, 'Sun'));
    svg.appendChild(el('text', { x: Rt + 6, y: Y(s.earthAlt[a1]) + 4, fill: '#5AA9FF', 'font-size': 12, 'font-weight': 600 }, 'Earth'));
    if (k >= a0 && k <= a1) svg.appendChild(el('line', { x1: X(k), x2: X(k), y1: T, y2: Bt, stroke: '#fff', 'stroke-width': 1 }));
  }
  function renderSite() {
    var open = !!state.site;
    $('sitePanel').hidden = !open;
    if (!open) return;
    var site = state.site, k0 = landK(), m = M(), st = status(site, k0, m), k = curK(), v = vis(site), s = series(site);
    $('view3d').setAttribute('aria-pressed', String(state.view === '3d')); $('view2d').setAttribute('aria-pressed', String(state.view === '2d'));
    $('siteName').textContent = site.name;
    $('siteMeta').textContent = GROUP_TEXT[site.group] + (site.note && site.group !== 'pole' ? ' · ' + site.note : site.src && site.src.pgda_site ? ' · PGDA ' + site.src.pgda_site : '') + ' · ' + coord(site.lat, site.lon);
    var badge = $('badge');
    badge.className = 'badge' + (st.ok ? '' : ' no');
    badge.textContent = (st.ok ? 'Available' : 'Not available') + ' for landing on ' + dayText(k0, true);
    var line = '';
    if (state.slip) {
      var was = status(site, planK(), m);
      line = 'On the planned date, ' + dayText(planK()) + ', this site ' + (was.ok ? 'worked' : 'did not work') + '. After a ' + state.slip + '-day slip it ' +
        (st.ok ? (was.ok ? 'still works.' : 'works.') : (was.ok ? 'no longer works: ' : 'still does not: ') + st.why.replace(/^The /, 'the ') + '.');
    } else if (!st.ok) line = st.why + '.';
    if (st.cut) line += ' The data ends on ' + dayText(N - 1, true) + ', so only ' + hrs(st.total) + ' of the stay are covered.';
    $('slipLine').textContent = line;
    renderOptions(site, st);
    var ds = flip(v.sun, k), de = flip(v.earth, k), a, b;
    if (v.sun[k]) a = ds == null ? 'The Sun is up for the rest of the data.' : 'The Sun is up. It sets in ' + dur(ds) + '.';
    else a = ds == null ? 'The Sun is down for the rest of the data.' : 'The Sun is down. It rises in ' + dur(ds) + '.';
    if (v.earth[k]) b = de == null ? 'Earth is in view and stays in view.' : 'Earth is in view. It sets in ' + dur(de) + '.';
    else b = de == null ? 'Earth does not come into view here. Talking to Earth needs a relay satellite.' : 'Earth is out of view. It rises in ' + dur(de) + '.';
    var box = $('verdict'); clear(box);
    box.appendChild(html('p', 's' + (v.sun[k] ? '' : ' off'), a)); box.appendChild(html('p', 'e' + (v.earth[k] ? '' : ' off'), b));
    var sunH = 0, earthH = 0, maxSun = -90;
    for (var i = k0; i < k0 + st.total; i++) { sunH += v.sun[i]; earthH += v.earth[i]; if (s.sunAlt[i] > maxSun) maxSun = s.sunAlt[i]; }
    var dark = longestRun(v.sun, k0, k0 + st.total, 0);
    var tb = $('tiles'); clear(tb);
    var sc = s.sunAlt[k] - v.sunSky[k], ec = s.earthAlt[k] - v.earthSky[k];
    tile(tb, 'sun', 'Sun elevation', deg1(s.sunAlt[k]), (sc >= 0 ? deg1(sc) + ' above' : deg1(-sc) + ' below') + ' the skyline');
    tile(tb, 'earth', 'Earth elevation', deg1(s.earthAlt[k]), (ec >= 0 ? deg1(ec) + ' above' : deg1(-ec) + ' below') + ' the skyline');
    tile(tb, 'sun', v.sun[k] ? 'Sunset in' : 'Sunrise in', ds == null ? '—' : dur(ds), v.sun[k] ? 'Power until then' : 'No solar power until then');
    tile(tb, 'earth', v.earth[k] ? 'Earthset in' : 'Earthrise in', de == null ? '—' : dur(de), v.earth[k] ? 'Direct link until then' : 'No direct link until then');
    tile(tb, '', 'Sun + Earth', hrs(st.both), pct(st.share) + ' of the stay');
    tile(tb, '', 'Longest dark', dark ? dur(dark) : 'None', 'during the stay');
    tile(tb, '', 'Sunlight', pct(sunH / st.total), 'highest Sun ' + deg1(maxSun));
    tile(tb, '', 'Earth in view', pct(earthH / st.total), 'of the stay');
    $('panoBox').hidden = state.view !== '2d';
    if (state.view === '2d') renderPano(site);
    renderStrips(site); renderCal(site); renderWhy(site, st);
    syncSurface();
    var rel = k - k0;
    $('clock').textContent = fmtTime(k) + (rel < 0 ? ', ' + dur(-rel) + ' before landing' : rel > m ? ', ' + dur(rel - m) + ' after take-off' : ', day ' + (Math.floor(rel / SPD) + 1) + ' of the stay');
    $('scrub').max = spanK(); $('scrub').value = state.cur;
    renderSiteTech(site, st, k);
  }

  /* ================= compare ================= */
  function evaluate(site) {
    var k0 = landK(), m = M(), st = status(site, k0, m), v = vis(site), s = series(site), end = k0 + st.total;
    var sunH = 0, earthH = 0, maxSun = -90;
    for (var i = k0; i < end; i++) { sunH += v.sun[i]; earthH += v.earth[i]; if (s.sunAlt[i] > maxSun) maxSun = s.sunAlt[i]; }
    var ds = v.sun[k0] ? flip(v.sun, k0) : null, de = v.earth[k0] ? flip(v.earth, k0) : null;
    return { site: site, st: st, sunP: sunH / st.total, earthP: earthH / st.total, dark: longestRun(v.sun, k0, end, 0), gap: longestRun(v.earth, k0, end, 0),
      sun0: s.sunAlt[k0], earth0: s.earthAlt[k0], maxSun: maxSun, sunset: v.sun[k0] ? (ds == null ? Infinity : ds) : 0, earthset: v.earth[k0] ? (de == null ? Infinity : de) : 0,
      next: st.ok ? 0 : nextWindow(site, k0, m), terrain: terrainOf(site) };
  }
  function better(a, b) { return (b.st.ok - a.st.ok) || (b.st.share - a.st.share) || (a.dark - b.dark) || (b.sunP - a.sunP) || (b.earthP - a.earthP); }
  function renderCompare() {
    var panel = $('comparePanel');
    panel.hidden = !state.cmpOpen;
    if (!state.cmpOpen) return;
    var ev = state.sel.map(evaluate), order = ev.slice().sort(better), best = order[0], second = order[1];
    $('cmpSub').textContent = 'Landing ' + dayText(landK(), true) + ', ' + state.days + '-day stay, ' + set.mast + ' m mast. Change the date, slip or stay at the top and this updates.';
    var win = $('cmpWin'); clear(win);
    win.className = 'cmp-win' + (best.st.ok ? '' : ' none');
    if (best.st.ok) {
      win.appendChild(html('h3', '', 'Better landing site: ' + best.site.name));
      var p = html('p');
      p.appendChild(html('b', '', best.site.name));
      var why = ' has Sun and Earth together for ' + hrs(best.st.both) + ' (' + pct(best.st.share) + ') of the stay';
      if (second) {
        why += second.st.ok ? ', against ' + hrs(second.st.both) + ' (' + pct(second.st.share) + ') at ' + second.site.name : ', while ' + second.site.name + ' is not available (' + second.st.why.toLowerCase() + ')';
        if (best.dark < second.dark) why += '. Its longest dark stretch is ' + (best.dark ? dur(best.dark) : 'zero') + ' against ' + dur(second.dark);
      }
      p.appendChild(document.createTextNode(why + '.'));
      win.appendChild(p);
    } else {
      win.appendChild(html('h3', '', 'None of these sites is available on ' + dayText(landK(), true)));
      var soon = ev.filter(function (e) { return e.next != null; }).sort(function (a, b) { return a.next - b.next; })[0];
      win.appendChild(html('p', '', soon ? 'Closest option: ' + soon.site.name + ', landing ' + soon.next + (soon.next === 1 ? ' day' : ' days') + ' later (' + dayText(landK() + soon.next * SPD, true) + '). Highest share now: ' + best.site.name + ' with ' + pct(best.st.share) + '.'
        : 'No later window for these sites before the data ends.'));
    }
    var t = $('cmpTable'); clear(t);
    var thead = html('thead'), hr = html('tr'); hr.appendChild(html('th', '', ''));
    ev.forEach(function (e) {
      var th = html('th', e === best && best.st.ok ? 'win' : '', e.site.name);
      th.appendChild(html('small', '', GROUP_TEXT[e.site.group] + ' · ' + coord(e.site.lat, e.site.lon)));
      hr.appendChild(th);
    });
    thead.appendChild(hr); t.appendChild(thead);
    var tb = html('tbody'); t.appendChild(tb);
    function row(label, fn, fmt, pick) {
      var tr = html('tr'); tr.appendChild(html('th', '', label));
      var vals = ev.map(fn), bestV = null;
      if (pick) vals.forEach(function (x) { if (x == null || !isFinite(x) && x !== Infinity) return; if (bestV == null || (pick === 'max' ? x > bestV : x < bestV)) bestV = x; });
      var nBest = vals.filter(function (x) { return x === bestV; }).length;
      vals.forEach(function (x, i) {
        var td = html('td', pick && x === bestV && nBest < vals.length ? 'best' : '');
        var f = fmt(x, ev[i]);
        if (f instanceof Node) td.appendChild(f); else td.textContent = f;
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    }
    row('Verdict', function (e) { return e.st.ok ? 1 : 0; }, function (x, e) { var d = html('div'); d.appendChild(html('span', x ? 'ok' : 'no', x ? 'Available' : 'Not available')); d.appendChild(html('div', 'hint', e.st.why)); return d; });
    row('Sun + Earth together', function (e) { return e.st.share; }, function (x, e) { return hrs(e.st.both) + ' (' + pct(x) + ')'; }, 'max');
    row('Sunlight (power)', function (e) { return e.sunP; }, pct, 'max');
    row('Earth in view (link)', function (e) { return e.earthP; }, pct, 'max');
    row('Longest dark stretch', function (e) { return e.dark; }, function (x) { return x ? dur(x) : 'None'; }, 'min');
    row('Longest Earth outage', function (e) { return e.gap; }, function (x) { return x ? dur(x) : 'None'; }, 'min');
    row('Sun elevation at landing', function (e) { return e.sun0; }, deg1, 'max');
    row('Highest Sun in the stay', function (e) { return e.maxSun; }, deg1, 'max');
    row('Earth elevation at landing', function (e) { return e.earth0; }, deg1, 'max');
    row('Sunset after landing', function (e) { return e.sunset; }, function (x) { return x === 0 ? 'Sun down at landing' : x === Infinity ? 'Not before the data ends' : 'in ' + dur(x); }, 'max');
    row('Earthset after landing', function (e) { return e.earthset; }, function (x) { return x === 0 ? 'Earth down at landing' : x === Infinity ? 'Not before the data ends' : 'in ' + dur(x); }, 'max');
    row('Next available landing', function (e) { return e.next; }, function (x) { return x === 0 ? 'This date' : x == null ? 'None in the data' : '+' + x + ' d, ' + dayText(landK() + x * SPD); }, 'min');
    row('Skyline data', function (e) { return e.terrain; }, function (x) { return TERRAIN_TEXT[x]; });
    row('Timeline (stay)', function (e) { return e; }, function (e) {
      var svg = el('svg', { viewBox: '0 0 300 30', preserveAspectRatio: 'none' });
      stripSvg(svg, vis(e.site), landK(), Math.max(1, e.st.total), 300, 30, null, null);
      return svg;
    });
    row('', function (e) { return e; }, function (e) {
      var b = html('button', 'btn small open', 'Open site'); b.type = 'button';
      b.addEventListener('click', function () { state.cmpOpen = false; select(e.site); });
      return b;
    });
  }
  function toggleSel(s) {
    var i = state.sel.indexOf(s);
    if (i >= 0) state.sel.splice(i, 1); else if (state.sel.length < 6) state.sel.push(s);
    refresh();
  }
  function renderCmpBar() {
    $('cmpBar').hidden = !state.picking;
    $('compareBtn').setAttribute('aria-pressed', String(state.picking || state.cmpOpen));
    var n = state.sel.length;
    $('cmpCount').textContent = n < 2 ? 'Pick ' + (2 - n) + ' more site' + (2 - n === 1 ? '' : 's') + ' on the Moon or in the list (up to 6)' : n + ' sites selected';
    $('cmpGo').disabled = n < 2;
  }
  function startPicking() {
    if (state.site) back();
    state.cmpOpen = false; state.picking = true;
    state.sel = state.sel.filter(function (s) { return allSites().indexOf(s) >= 0; });
    refresh();
  }
  function stopPicking() { state.picking = false; refresh(); }

  /* ================= 3D horizon (web/moonsky/moon-sky.js) =================
     Opening a site zooms the globe down onto it and cross-fades into a first-person view from the surface.
     The view takes its Sun/Earth angles and its skyline from this file's data layer, so what it shows
     always agrees with the verdict; only stars and Earth's rotation come from its own ephemeris. */
  var SURF = $('surface'), surfTok = 0, surfSite = null, surfBuilt = null;
  var hasSurface = !!(SURF && typeof SURF.setSite === 'function');
  function azLerp(a, b, f) { return (a + (((b - a + 540) % 360) - 180) * f + 360) % 360; }   // unwraps 359 -> 0
  if (hasSurface) SURF.configure({
    sky: function (t) {                                         // contract section 4: linear between hourly samples
      var site = surfSite, x = (t - T0) / STEP;
      if (!site || !(x >= 0 && x <= N - 1)) return null;
      var s = series(site), i = Math.min(N - 2, Math.floor(x)), f = x - i, j = i + 1;
      var L = function (a) { return a[i] + (a[j] - a[i]) * f; };
      return { sun: { alt: L(s.sunAlt), az: azLerp(s.sunAz[i], s.sunAz[j], f), diam: L(D.bodies.sun.diam_deg) },
               earth: { alt: L(s.earthAlt), az: azLerp(s.earthAz[i], s.earthAz[j], f), diam: L(D.bodies.earth.diam_deg) } };
    },
    skyline: function (az) { return surfSite && horizonArr(surfSite) ? skyline(surfSite, az) : null; },
    height: function (lat, lon) { return TER && lat < -75 ? Terrain.heightAt(TER, lat, lon) : null; }
  });
  if (hasSurface && SURF.setOption) { for (var so in sopt) SURF.setOption(so, sopt[so]); SURF.setOption('earth', state.showEarth); }
  function loadScreen(site) {
    $('slName').textContent = site.name; $('slCoord').textContent = coord(site.lat, site.lon);
    $('slErr').hidden = true; $('slBack').hidden = true;
    loadProgress('Zooming in', 0);
  }
  function loadProgress(label, frac) {
    $('slStage').textContent = label + (frac > 0 && frac < 1 ? '… ' + Math.round(frac * 100) + '%' : frac < 1 ? '…' : '');
    $('slBar').style.width = Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%';
  }
  function loadError(err) {
    var wrap = $('globeWrap');
    wrap.classList.remove('surface-loading', 'surface-wait'); wrap.classList.add('surface-error');
    $('slStage').textContent = '';
    $('slErr').textContent = 'The 3D horizon could not open: ' + ((err && err.message) || err) + ' The 2D horizon still works.';
    $('slErr').hidden = false; $('slBack').hidden = false;
  }
  if (hasSurface) SURF.addEventListener('moonsky-progress', function (e) {
    if ($('globeWrap').classList.contains('surface-loading')) loadProgress(e.detail.label, e.detail.frac);
  });
  function syncSurface() {                                      // the panel's clock drives the view
    if (!hasSurface || !state.site || state.site !== surfSite) return;
    SURF.setWindow(ms(landK()), ms(Math.min(N - 1, landK() + M())), ms(planK()), ms(Math.min(N - 1, planK() + spanK())));
    SURF.setTime(ms(curK()));
  }
  function openSurface(site) {
    if (!hasSurface) { Globe.flyTo(site.lon, site.lat, 1.5); return; }
    var wrap = $('globeWrap');
    if (surfBuilt === site && !wrap.classList.contains('surface-error')) {        // already built: just show it
      surfSite = site; syncSurface();
      wrap.classList.remove('surface-loading', 'surface-wait'); wrap.classList.add('surface-on');
      if (playing) SURF.setTracking(true);
      return;
    }
    var tok = ++surfTok;
    surfBuilt = null;
    wrap.classList.remove('surface-on', 'surface-error', 'surface-wait'); wrap.classList.add('surface-loading');
    loadScreen(site);
    surfSite = site;
    SURF.setTracking(false); SURF.setEyeHeight(set.mast);
    syncSurface();
    var flown = new Promise(function (res) { Globe.flyTo(site.lon, site.lat, 1.07, res, 1000); setTimeout(res, 1500); });
    flown.then(function () { if (tok === surfTok && wrap.classList.contains('surface-loading')) wrap.classList.add('surface-wait'); });
    var built = SURF.setSite(site.lat, site.lon, site.name).then(function () { return null; }, function (e) { return e; });
    Promise.all([flown, built]).then(function (r) {
      if (tok !== surfTok) return;
      if (r[1]) { loadError(r[1]); return; }
      surfBuilt = site;
      loadProgress('Ready', 1);
      wrap.classList.remove('surface-loading', 'surface-wait');
      syncSurface();
      wrap.classList.add('surface-on');
      if (playing) SURF.setTracking(true);
    });
  }
  function closeSurface() {
    surfTok++;
    var wrap = $('globeWrap');
    if (wrap.classList.contains('surface-loading') || wrap.classList.contains('surface-error')) surfBuilt = null;   // unfinished build
    wrap.classList.remove('surface-on', 'surface-loading', 'surface-wait', 'surface-error');
    if (hasSurface) SURF.setTracking(false);
  }

  /* ================= flow ================= */
  function fields() {
    $('date').min = isoDay(0); $('date').max = isoDay(LAST_DAY);
    $('date').value = isoDay(state.plan); $('days').value = state.days;
    var maxSlip = Math.max(0, LAST_DAY - state.plan);
    $('slip').max = Math.min(maxSlip, Math.max(56, state.slip)); $('slip').value = state.slip;
    $('slipOut').textContent = state.slip ? '+' + state.slip + (state.slip === 1 ? ' day' : ' days') : 'None';
    $('slipOut').className = state.slip ? 'on' : '';
    var out = $('missionOut'); clear(out);
    out.appendChild(document.createTextNode('Lands ')); out.appendChild(html('b', '', dayText(landK(), true)));
    out.appendChild(document.createTextNode(', leaves ')); out.appendChild(html('b', '', dayText(Math.min(N - 1, landK() + M()), true)));
    $('techToggle').checked = state.tech;
  }
  function layout() {
    var st = $('stage'), open = !!state.site;
    st.classList.toggle('insite', open); st.classList.toggle('v3d', state.view === '3d'); st.classList.toggle('v2d', state.view === '2d');
    $('split').hidden = !(open && state.view === '3d');
    document.documentElement.style.setProperty('--info-w', state.infoW + 'px');
  }
  function refresh() {
    document.body.classList.toggle('tech', state.tech);
    state.cur = Math.max(0, Math.min(spanK(), state.cur));
    layout(); fields(); save();
    rank(); lightGlobe(); renderList(); renderPins(); renderMoonTech(); placeDisplay(); renderSite(); renderCmpBar(); renderCompare();
    starFrame();
  }
  function tick() { lightGlobe(); renderMarks(); renderSite(); }
  function stop() {
    if (playing) { clearInterval(playing); playing = null; $('play').textContent = 'Play'; }
    if (hasSurface) SURF.setTracking(false);
  }
  function play() {
    if (playing) { stop(); return; }
    var a = landK() - planK(), b = Math.min(spanK(), a + M());
    if (state.cur < a || state.cur >= b) state.cur = a;
    $('play').textContent = 'Pause';
    if (hasSurface && state.view === '3d' && $('globeWrap').classList.contains('surface-on')) SURF.setTracking(true);   // keep the Sun centred
    var stepK = Math.max(1, Math.round(M() / 200));
    playing = setInterval(function () { state.cur = Math.min(b, state.cur + stepK); tick(); if (state.cur >= b) stop(); }, 60);
  }
  function select(site) {
    stop();
    if (!state.site) state.home = Globe.view();
    state.picking = false; state.cmpOpen = false;
    state.site = site; state.cur = landK() - planK();
    panoKey = ''; calKey = '';
    refresh();
    if (state.view === '3d') openSurface(site);
    else { closeSurface(); Globe.flyTo(site.lon, site.lat, 1.5); }
    $('sitePanel').scrollTop = 0;
  }
  function back() {
    if (!state.site) return;
    stop(); closeSurface(); state.site = null; refresh();
    var h = state.home || { lon: 15, lat: -40, dist: 4.2 };
    Globe.flyTo(h.lon, h.lat, Math.max(h.dist, 1.15));
  }
  function setView(v) {
    if (v === state.view) return;
    state.view = v; panoKey = '';
    if (!state.site) { refresh(); return; }
    stop(); refresh();
    if (v === '3d') openSurface(state.site); else closeSurface();
  }
  function setMission(plan, slip, days) {
    stop();
    state.plan = Math.max(0, Math.min(LAST_DAY, plan)); state.slip = Math.max(0, Math.min(LAST_DAY - state.plan, slip));
    state.days = Math.max(1, Math.min(60, Math.round(days) || 1));
    state.cur = landK() - planK();
    refresh();
  }
  // A permanent pin (until the page is reloaded) at the given coordinates.
  function addPin(lat, lon) {
    lat = Math.max(-90, Math.min(90, lat)); lon = ((lon + 540) % 360) - 180;
    if (lon === 180) lon = -180;
    pinSeq++;
    var p = makeSite('custom', 'pin', { id: 'pin-' + pinSeq, name: 'Pin ' + pinSeq, note: '', lat: +lat.toFixed(4), lon: +lon.toFixed(4) });
    PINS.push(p);
    $('cLat').value = p.lat; $('cLon').value = p.lon;
    if (state.picking) { if (state.sel.length < 6) state.sel.push(p); refresh(); }
    else select(p);
  }
  function removePin(p) {
    var i = PINS.indexOf(p); if (i < 0) return;
    PINS.splice(i, 1);
    state.sel = state.sel.filter(function (s) { return s !== p; });
    if (state.site === p) back(); else refresh();
  }

  $('date').addEventListener('change', function () {
    var d = Math.round((Date.parse(this.value + 'T00:00:00Z') - T0) / 86400000);
    if (this.value && isFinite(d)) setMission(d, state.slip, state.days); else fields();
  });
  $('slip').addEventListener('input', function () { setMission(state.plan, +this.value, state.days); });
  $('days').addEventListener('change', function () { setMission(state.plan, state.slip, +this.value); });
  $('techToggle').addEventListener('change', function () { state.tech = this.checked; refresh(); });
  Array.prototype.forEach.call(document.querySelectorAll('#filters .chip'), function (c) {
    c.addEventListener('click', function () { state.filter = c.getAttribute('data-f'); refresh(); });
  });
  $('showEarth').checked = state.showEarth;
  $('showEarth').addEventListener('change', function () {
    state.showEarth = this.checked; panoKey = '';
    if (hasSurface && SURF.setOption) SURF.setOption('earth', state.showEarth);
    save(); renderSite();
  });
  $('play').addEventListener('click', play);
  $('backBtn').addEventListener('click', back);
  $('slBack').addEventListener('click', back);
  $('view3d').addEventListener('click', function () { setView('3d'); });
  $('view2d').addEventListener('click', function () { setView('2d'); });
  $('scrub').addEventListener('input', function () { stop(); state.cur = +this.value; tick(); });
  $('cal').addEventListener('click', function (ev) {
    var d = ev.target && ev.target.getAttribute && ev.target.getAttribute('data-d');
    if (d == null) return;
    d = +d;
    if (d >= state.plan) setMission(state.plan, d - state.plan, state.days); else setMission(d, 0, state.days);
  });
  ['setMast', 'setSun', 'setEarth', 'setShare'].forEach(function (id) {
    $(id).addEventListener('change', function () {
      set.mast = +$('setMast').value;
      set.sun = Math.max(0.01, Math.min(1, (+$('setSun').value || 50) / 100));
      set.earth = Math.max(0, +$('setEarth').value || 0);
      set.share = Math.max(0, Math.min(1, (+$('setShare').value || 0) / 100));
      fillRules(); panoKey = ''; calKey = ''; refresh();
      if (hasSurface && state.site) SURF.setEyeHeight(set.mast);        // new mast -> new skyline in the 3D view
    });
  });
  $('coordForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var lat = parseFloat($('cLat').value), lon = parseFloat($('cLon').value);
    if (isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90) addPin(lat, lon);
  });
  $('compareBtn').addEventListener('click', function () {
    if (state.picking) stopPicking();
    else if (state.cmpOpen) { state.cmpOpen = false; refresh(); }
    else startPicking();
  });
  $('cmpCancel').addEventListener('click', stopPicking);
  $('cmpGo').addEventListener('click', function () { if (state.sel.length >= 2) { state.picking = false; state.cmpOpen = true; refresh(); $('comparePanel').scrollTop = 0; } });
  $('cmpClose').addEventListener('click', function () { state.cmpOpen = false; refresh(); });
  $('zoomIn').addEventListener('click', function () { Globe.zoom(0.55); });
  $('zoomOut').addEventListener('click', function () { Globe.zoom(1 / 0.55); });
  $('zoomPole').addEventListener('click', function () { Globe.flyTo(0, -89.9, 1.35, null, 1100); });
  // display settings
  Array.prototype.forEach.call(document.querySelectorAll('#displayBox [data-g]'), function (i) {
    i.addEventListener(i.type === 'range' ? 'input' : 'change', function () {
      var k = i.getAttribute('data-g'); gopt[k] = i.type === 'checkbox' ? i.checked : +i.value;
      fillDisplay(); save(); lightGlobe(); renderMarks();
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll('#displayBox [data-s]'), function (i) {
    i.addEventListener(i.type === 'range' ? 'input' : 'change', function () {
      var k = i.getAttribute('data-s'), v = i.type === 'checkbox' ? i.checked : +i.value;
      sopt[k] = v; if (hasSurface && SURF.setOption) SURF.setOption(k, v);
      fillDisplay(); save();
    });
  });
  // resizable info panel in the 3D horizon layout
  (function () {
    var sp = $('split'), drag = false;
    function setW(w) {
      var max = Math.max(320, $('stage').clientWidth - 340);
      state.infoW = Math.round(Math.max(300, Math.min(max, w)));
      document.documentElement.style.setProperty('--info-w', state.infoW + 'px');
    }
    sp.addEventListener('pointerdown', function (ev) { drag = true; sp.setPointerCapture(ev.pointerId); sp.classList.add('drag'); document.body.classList.add('resizing'); });
    sp.addEventListener('pointermove', function (ev) { if (drag) setW(ev.clientX - $('stage').getBoundingClientRect().left); });
    function up() { if (!drag) return; drag = false; sp.classList.remove('drag'); document.body.classList.remove('resizing'); save(); }
    sp.addEventListener('pointerup', up); sp.addEventListener('pointercancel', up);
    sp.addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') { setW(state.infoW + (ev.key === 'ArrowLeft' ? -24 : 24)); save(); ev.preventDefault(); }
    });
  })();
  document.addEventListener('keydown', function (ev) {
    if (wiz) return;                                         // the setup wizard handles its own keys
    if (ev.key === 'Escape') {
      if (state.cmpOpen) { state.cmpOpen = false; refresh(); } else if (state.picking) stopPicking(); else back();
      return;
    }
    if (/^(INPUT|BUTTON|SELECT|TEXTAREA|SUMMARY)$/.test(ev.target.tagName)) return;
    if (ev.target.tagName === 'MOON-SKY' && ev.key.indexOf('Arrow') === 0) return;   // arrows look around in the 3D view
    if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
      var sign = ev.key === 'ArrowLeft' ? -1 : 1;
      if (state.site) { stop(); state.cur = Math.max(0, Math.min(spanK(), state.cur + sign * 3)); tick(); } else setMission(state.plan, state.slip + sign, state.days);
      ev.preventDefault();
    } else if (ev.key === ' ' && state.site) { play(); ev.preventDefault(); }
  });

  /* ================= surface map, relief, stars and coarse terrain ================= */
  function surface(text) { $('stSurface').textContent = 'Surface: ' + text; }
  var baseSurface = '';
  function globeStage(t) { $('globeLoadStage').textContent = t; }
  function globeReady() { $('globeLoad').classList.remove('on'); }
  function liveTiles(z, done) {                             // NASA Moon Trek tiles of the LRO wide-angle mosaic
    var cols = Math.pow(2, z + 1), rowsN = Math.pow(2, z), left = cols * rowsN, dead = false;
    var c = document.createElement('canvas'); c.width = cols * 256; c.height = rowsN * 256;
    var ctx = c.getContext('2d');
    for (var r = 0; r < rowsN; r++) for (var q = 0; q < cols; q++) (function (r, q) {
      var img = new Image(); img.crossOrigin = 'anonymous';
      img.onload = function () {
        if (dead) return;
        ctx.drawImage(img, q * 256, r * 256, 256, 256);
        if (--left === 0) { if (Globe.setTexture(c)) { baseSurface = 'NASA LRO camera mosaic, live from Moon Trek'; surface(baseSurface); } if (done) done(); }
      };
      img.onerror = function () { if (!dead) { dead = true; if (done) done(); } };
      img.src = 'https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/default/default028mm/' + z + '/' + r + '/' + q + '.jpg';
    })(r, q);
  }
  function loadSurface() {
    baseSurface = 'generated, no NASA map loaded'; surface(baseSurface);
    globeStage('Loading the NASA LRO colour map');
    var relief = function () {
      globeReady();                                   // the globe is usable now; relief streams in behind it
      surface(baseSurface + ' · loading LOLA terrain relief…');
      loadScript('web/data/moon-relief.js').then(function () {
        var R = window.MOON_RELIEF;
        return Promise.all([decodeImg(R.global.url), decodeImg(R.polar.url)]).then(function (im) {
          Globe.setRelief(R, im[0], im[1]);
          baseSurface += ' · relief: ' + R.global.source + ', pole ' + R.polar.source.replace(/^LRO /, '');
          surface(baseSurface);
        });
      }).catch(function () { surface(baseSurface); });
    };
    loadScript('moon-texture.js').then(function () { return decodeImg(MOON_TEXTURE); }).then(function (img) {
      if (Globe.setTexture(img)) { baseSurface = ((typeof MOON_TEXTURE_SOURCE === 'string' && MOON_TEXTURE_SOURCE) || 'NASA map') + ', ' + img.naturalWidth + ' px'; surface(baseSurface); relief(); }
      else liveTiles(2, relief);
    }).catch(function () { liveTiles(2, relief); });
  }
  Globe.onLod(function (info) {
    if (!info) { surface(baseSurface); return; }
    if (info.loading) surface(baseSurface + ' · loading sharper Moon Trek imagery…');
    else if (info.error) surface(baseSurface + ' · Moon Trek imagery unavailable (offline?)');
    else surface(baseSurface + ' · zoomed area: NASA Moon Trek LRO WAC mosaic, about ' + info.mpp + ' m per pixel');
  });
  // Star map: Yale Bright Star Catalogue from the 3D-view data, oriented with DE421 (Moon-fixed <- ICRF).
  function loadStars() {
    if (!window.MoonSkyData || !MoonSkyData.load) return;
    MoonSkyData.load('stars').then(function (b64) {
      var bin = atob(b64), n = bin.length / 8, u = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      var dv = new DataView(u.buffer), out = new Float32Array(n * 4);
      for (var k = 0; k < n; k++) {
        var o = k * 8;
        out[4 * k] = dv.getInt16(o, true) / 32767; out[4 * k + 1] = dv.getInt16(o + 2, true) / 32767; out[4 * k + 2] = dv.getInt16(o + 4, true) / 32767;
        out[4 * k + 3] = dv.getUint8(o + 6) / 30 - 2;
      }
      Globe.setStars(out);
      starFrame();
    }).catch(function () {});
  }
  var starDay = -1;
  function starFrame() {
    if (!hasSurface || !SURF.frameAt) return;
    var k = state.site ? curK() : landK(), day = Math.floor(k / SPD);
    if (day === starDay) return;
    starDay = day;
    SURF.frameAt(ms(k)).then(function (m) { if (m) Globe.set({ starM: m }); }).catch(function () {});
  }
  function loadTerrain() {
    loadScript('web/data/terrain-lowres.js').then(function () {
      var t = window.TERRAIN_LOWRES;
      if (!t || !window.DecompressionStream) return;
      var bin = atob(t.deflate_b64), bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer().then(function (buf) {
        TER = Terrain.fromDeltas(t.n, t.px_m, t.quant_m, new Uint8Array(buf));
        PAST.concat(PINS).forEach(function (s) { s.hz = null; s.vis = null; s.ser = null; });
        panoKey = ''; calKey = '';
        refresh();
        if (hasSurface && state.site && state.site === surfSite && state.site.group !== 'pole' && state.view === '3d') SURF.rebuild();   // finer polar terrain + skyline now known
      });
    }).catch(function () {});
  }

  /* ================= setup wizard =================
     Five steps: mission type -> dates -> requirements -> sites -> review. Works on a draft; nothing changes
     until Finish. The review shows a live preview computed with the same verdict code as the app. */
  var PRESETS = [
    { id: 'robotic', name: 'Robotic lander', text: 'A solar-powered lander that needs sunlight and a direct radio link for most of a two-week stay.',
      days: 14, mast: MASTS[0], sun: 50, earth: 0, share: 50 },
    { id: 'crewed', name: 'Crewed surface stay', text: 'A short stay with stricter rules: the full Sun disc in view and Earth clearly above the skyline for most of the time.',
      days: 7, mast: MASTS[0], sun: 100, earth: 0.5, share: 80 },
    { id: 'long', name: 'Long-duration / rover', text: 'A month-long mission on a taller mast. It must ride through some darkness, so less of the stay needs both.',
      days: 28, mast: MASTS[MASTS.length - 1], sun: 50, earth: 0, share: 40 },
    { id: 'custom', name: 'Custom', text: 'Start from your current settings and set every value yourself.' }
  ];
  var WSTEPS = ['Mission', 'Dates', 'Requirements', 'Sites', 'Review'];
  var wiz = null;                                              // draft while the wizard is open
  function wizDraft() {
    return { step: 0, preset: 'custom', plan: state.plan, slip: state.slip, days: state.days, mast: set.mast,
             sun: Math.round(set.sun * 100), earth: set.earth, share: Math.round(set.share * 100),
             scope: state.filter === 'pin' ? 'all' : state.filter, pins: [], sel: state.sel.slice(), after: 'list', returnFocus: document.activeElement };
  }
  function applyPreset(id) {
    var p = PRESETS.filter(function (x) { return x.id === id; })[0];
    wiz.preset = id;
    if (!p || id === 'custom') return;
    wiz.days = p.days; wiz.mast = p.mast; wiz.sun = p.sun; wiz.earth = p.earth; wiz.share = p.share;
  }
  // Run fn with the draft's rules in place, then put the real rules back (vis() caches by rule set).
  function withDraft(fn) {
    var old = { mast: set.mast, sun: set.sun, earth: set.earth, share: set.share };
    set.mast = wiz.mast; set.sun = Math.max(0.01, wiz.sun / 100); set.earth = wiz.earth; set.share = wiz.share / 100;
    try { return fn(); } finally { set.mast = old.mast; set.sun = old.sun; set.earth = old.earth; set.share = old.share; }
  }
  function wizSites() {
    var list = ANALYSED.concat(PAST, PINS, wiz.pins);
    return wiz.scope === 'all' ? list : list.filter(function (s) { return s.group === wiz.scope || s.group === 'pin'; });
  }
  function wizLand() { return Math.min(N - 1, (wiz.plan + wiz.slip) * SPD); }
  function wizEval() {
    var k = wizLand(), m = wiz.days * SPD;
    return withDraft(function () {
      return wizSites().map(function (s) { return { site: s, st: status(s, k, m) }; })
        .sort(function (a, b) { return (b.st.ok - a.st.ok) || (b.st.both - a.st.both); });
    });
  }
  function wfield(label, help, control) {
    var f = html('div', 'wf'), l = html('label', 'wl', label);
    var target = control.focusTarget || control;
    if (target.id) l.htmlFor = target.id;
    f.appendChild(l); f.appendChild(control);
    if (help) f.appendChild(html('p', 'wh', help));
    return f;
  }
  function winput(type, id, attrs, onInput) {
    var i = html('input'); i.type = type; i.id = id;
    for (var k in attrs) i.setAttribute(k, attrs[k]);
    i.addEventListener(type === 'range' ? 'input' : 'change', function () { onInput(i); });
    return i;
  }
  function wrange(id, min, max, step, value, unit, onInput) {
    var row = html('div', 'wrange'), out = html('output', '', value + unit);
    var r = winput('range', id, { min: min, max: max, step: step, value: value }, function (i) { out.textContent = i.value + unit; onInput(+i.value); });
    row.appendChild(r); row.appendChild(out);
    row.focusTarget = r;
    return row;
  }
  function landLine() {
    return 'Lands ' + dayText(wizLand(), true) + ', leaves ' + dayText(Math.min(N - 1, wizLand() + wiz.days * SPD), true) +
      (wizLand() + wiz.days * SPD > N - 1 ? ' (the data ends first, so only part of the stay is covered)' : '') + '.';
  }
  function renderWizard() {
    var box = $('wizBody'); clear(box);
    var steps = $('wizSteps'); clear(steps);
    WSTEPS.forEach(function (name, i) {
      var b = html('button', 'wstep' + (i === wiz.step ? ' on' : i < wiz.step ? ' done' : ''));
      b.type = 'button'; b.disabled = i > wiz.step;
      b.appendChild(html('span', 'wn', i < wiz.step ? '✓' : String(i + 1))); b.appendChild(html('span', 'wt', name));
      if (i === wiz.step) b.setAttribute('aria-current', 'step');
      b.addEventListener('click', function () { if (i < wiz.step) { wiz.step = i; renderWizard(); } });
      steps.appendChild(b);
    });
    var s = wiz.step;
    if (s === 0) {
      box.appendChild(html('h3', 'wq', 'What are you planning?'));
      box.appendChild(html('p', 'wh', 'Pick the closest mission type. It only fills in starting values for the next steps; you can change every one of them.'));
      var grid = html('div', 'wcards'); grid.setAttribute('role', 'radiogroup'); grid.setAttribute('aria-label', 'Mission type');
      PRESETS.forEach(function (p) {
        var c = html('button', 'wcard' + (wiz.preset === p.id ? ' on' : '')); c.type = 'button';
        c.setAttribute('role', 'radio'); c.setAttribute('aria-checked', String(wiz.preset === p.id));
        c.appendChild(html('b', '', p.name)); c.appendChild(html('span', '', p.text));
        if (p.days) c.appendChild(html('small', '', p.days + '-day stay · ' + p.mast + ' m mast · Sun disc ≥ ' + p.sun + '% · both for ≥ ' + p.share + '% of the stay'));
        c.addEventListener('click', function () { applyPreset(p.id); renderWizard(); var f = $('wizBody').querySelector('.wcard.on'); if (f) f.focus(); });
        grid.appendChild(c);
      });
      box.appendChild(grid);
    } else if (s === 1) {
      box.appendChild(html('h3', 'wq', 'When do you land, and for how long?'));
      var d = winput('date', 'wDate', { min: isoDay(0), max: isoDay(LAST_DAY), value: isoDay(wiz.plan) }, function (i) {
        var day = Math.round((Date.parse(i.value + 'T00:00:00Z') - T0) / 86400000);
        if (isFinite(day)) { wiz.plan = Math.max(0, Math.min(LAST_DAY, day)); wiz.slip = Math.min(wiz.slip, LAST_DAY - wiz.plan); }
        renderWizard(); $('wDate').focus();
      });
      box.appendChild(wfield('Planned landing (UTC)', 'The data covers ' + dayText(0, true) + ' to ' + dayText(N - 1, true) + '.', d));
      var sl = wrange('wSlip', 0, Math.max(0, Math.min(90, LAST_DAY - wiz.plan)), 1, wiz.slip, ' d', function (v) { wiz.slip = v; $('wLandOut').textContent = landLine(); });
      box.appendChild(wfield('Launch slip', 'Days the launch might move. Start with 0; on the main screen you can drag the slip later and watch what a delay does.', sl));
      var st = winput('number', 'wDays', { min: 1, max: 60, step: 1, value: wiz.days }, function (i) {
        wiz.days = Math.max(1, Math.min(60, Math.round(+i.value) || 1)); i.value = wiz.days; wiz.preset = 'custom'; $('wLandOut').textContent = landLine();
      });
      box.appendChild(wfield('Stay on the surface (days)', 'A lunar day lasts about 29.5 Earth days, so away from the poles a stay longer than about two weeks includes a night.', st));
      var lo = html('p', 'wsum'); lo.id = 'wLandOut'; lo.textContent = landLine(); box.appendChild(lo);
    } else if (s === 2) {
      box.appendChild(html('h3', 'wq', 'What does the site need to give you?'));
      var ms = html('select'); ms.id = 'wMast';
      MASTS.forEach(function (m) { var o = html('option', '', m + ' m'); o.value = m; ms.appendChild(o); });
      ms.value = wiz.mast; ms.addEventListener('change', function () { wiz.mast = +ms.value; wiz.preset = 'custom'; });
      box.appendChild(wfield('Height of the solar panels and antenna', 'Higher sees over more terrain. The analysed skylines were computed for these heights.', ms));
      box.appendChild(wfield('Sun disc that must be visible', 'Power: 50% means at least half of the Sun must clear the skyline; 100% means all of it.',
        wrange('wSun', 10, 100, 5, wiz.sun, '%', function (v) { wiz.sun = v; wiz.preset = 'custom'; })));
      box.appendChild(wfield('Earth clearance above the skyline', 'Direct radio link: how far the centre of Earth must be above the terrain. 0° means just above it.',
        wrange('wEarth', 0, 5, 0.1, wiz.earth, '°', function (v) { wiz.earth = v; wiz.preset = 'custom'; })));
      box.appendChild(wfield('Share of the stay with both', 'A site counts as available if the Sun and Earth are both up at landing and for at least this share of the stay.',
        wrange('wShare', 0, 100, 5, wiz.share, '%', function (v) { wiz.share = v; wiz.preset = 'custom'; })));
    } else if (s === 3) {
      box.appendChild(html('h3', 'wq', 'Which sites should be considered?'));
      var sc = html('div', 'wseg'); sc.setAttribute('role', 'radiogroup'); sc.setAttribute('aria-label', 'Sites to consider');
      [['all', 'All sites'], ['pole', 'South pole only'], ['past', 'Past landings only']].forEach(function (o) {
        var b = html('button', '', o[1]); b.type = 'button'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(wiz.scope === o[0]));
        b.addEventListener('click', function () { wiz.scope = o[0]; wiz.sel = wiz.sel.filter(function (x) { return wizSites().indexOf(x) >= 0; }); renderWizard(); });
        sc.appendChild(b);
      });
      box.appendChild(sc);
      var pf = html('form', 'wpin');
      var la = winput('number', 'wLat', { min: -90, max: 90, step: 'any', placeholder: 'Latitude °', 'aria-label': 'Latitude in degrees' }, function () {});
      var lo2 = winput('number', 'wLon', { min: -180, max: 360, step: 'any', placeholder: 'Longitude °E', 'aria-label': 'Longitude in degrees east' }, function () {});
      var ab = html('button', 'btn small', 'Add pin'); ab.type = 'submit';
      var err = html('span', 'werr');
      pf.appendChild(html('span', 'wl', 'Your own coordinates')); pf.appendChild(la); pf.appendChild(lo2); pf.appendChild(ab); pf.appendChild(err);
      pf.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var lat = parseFloat(la.value), lon = parseFloat(lo2.value);
        if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90) { err.textContent = 'Enter a latitude between −90 and 90 and a longitude.'; return; }
        lon = ((lon + 540) % 360) - 180; if (lon === 180) lon = -180;
        pinSeq++;
        var p = makeSite('custom', 'pin', { id: 'pin-' + pinSeq, name: 'Pin ' + pinSeq, note: '', lat: +lat.toFixed(4), lon: +lon.toFixed(4) });
        wiz.pins.push(p); if (wiz.sel.length < 6) wiz.sel.push(p);
        renderWizard(); $('wLat').focus();
      });
      box.appendChild(pf);
      box.appendChild(html('p', 'wh', 'Optional: tick 2–6 sites to compare side by side when you finish. Verdicts use the settings from the previous steps.'));
      var ev = wizEval(), ul = html('ul', 'wlist');
      ev.forEach(function (e) {
        var li = html('li'), lab = html('label'), cb = html('input'); cb.type = 'checkbox';
        cb.checked = wiz.sel.indexOf(e.site) >= 0;
        cb.disabled = !cb.checked && wiz.sel.length >= 6;
        cb.setAttribute('data-id', e.site.id);
        cb.addEventListener('change', function () {
          var i = wiz.sel.indexOf(e.site);
          if (cb.checked && i < 0 && wiz.sel.length < 6) wiz.sel.push(e.site); else if (!cb.checked && i >= 0) wiz.sel.splice(i, 1);
          var top = $('wizBody').scrollTop;
          renderWizard(); $('wizBody').scrollTop = top;
          var again = $('wizBody').querySelector('[data-id="' + e.site.id + '"]'); if (again) again.focus();
        });
        lab.appendChild(cb); lab.appendChild(html('span', 'nm', e.site.name));
        lab.appendChild(html('span', 'tag', GROUP_TEXT[e.site.group]));
        lab.appendChild(html('span', e.st.ok ? 'v ok' : 'v no', e.st.ok ? 'Available' : 'Not available'));
        li.appendChild(lab); ul.appendChild(li);
      });
      box.appendChild(ul);
      box.appendChild(html('p', 'wh', wiz.sel.length + ' selected for comparison.'));
    } else {
      box.appendChild(html('h3', 'wq', 'Review'));
      var ev2 = wizEval(), good = ev2.filter(function (e) { return e.st.ok; });
      var pre = PRESETS.filter(function (p) { return p.id === wiz.preset; })[0];
      var dl = html('dl', 'wreview');
      [['Mission', pre ? pre.name : 'Custom'],
       ['Landing', dayText(wizLand(), true) + (wiz.slip ? ' (planned ' + dayText(wiz.plan * SPD, true) + ', +' + wiz.slip + ' d slip)' : '')],
       ['Stay', wiz.days + ' days, leaving ' + dayText(Math.min(N - 1, wizLand() + wiz.days * SPD), true)],
       ['Rules', wiz.mast + ' m mast · Sun disc ≥ ' + wiz.sun + '% · Earth ≥ ' + wiz.earth + '° above the skyline · both for ≥ ' + wiz.share + '% of the stay'],
       ['Sites', { all: 'All sites', pole: 'South pole only', past: 'Past landings only' }[wiz.scope] + (wiz.pins.length ? ' + ' + wiz.pins.length + ' new pin' + (wiz.pins.length > 1 ? 's' : '') : '')]
      ].forEach(function (r) { dl.appendChild(html('dt', '', r[0])); dl.appendChild(html('dd', '', r[1])); });
      box.appendChild(dl);
      var pv = html('div', 'wpreview' + (good.length ? '' : ' none'));
      pv.appendChild(html('b', '', good.length + ' of ' + ev2.length + ' sites are available with these settings.'));
      pv.appendChild(html('span', '', good.length ? 'Best: ' + good.slice(0, 3).map(function (e) { return e.site.name + ' (' + pct(e.st.share) + ' of the stay)'; }).join(', ') + '.'
        : 'Try a later date, a shorter stay or looser rules (go back with the steps above).'));
      box.appendChild(pv);
      box.appendChild(html('p', 'wl', 'When you finish'));
      var opts = [['list', 'Show the ranked site list'], ['best', good.length ? 'Open the best site: ' + good[0].site.name : null],
                  ['compare', wiz.sel.length >= 2 ? 'Compare the ' + wiz.sel.length + ' selected sites' : null]].filter(function (o) { return o[1]; });
      if (!opts.some(function (o) { return o[0] === wiz.after; })) wiz.after = 'list';
      var og = html('div', 'wafter'); og.setAttribute('role', 'radiogroup'); og.setAttribute('aria-label', 'When you finish');
      opts.forEach(function (o) {
        var l = html('label'), r = html('input'); r.type = 'radio'; r.name = 'wAfter'; r.value = o[0]; r.checked = wiz.after === o[0];
        r.addEventListener('change', function () { wiz.after = o[0]; });
        l.appendChild(r); l.appendChild(document.createTextNode(o[1])); og.appendChild(l);
      });
      box.appendChild(og);
    }
    $('wizBack').hidden = s === 0;
    $('wizNext').textContent = s === WSTEPS.length - 1 ? 'Finish' : 'Next';
    $('wizCount').textContent = 'Step ' + (s + 1) + ' of ' + WSTEPS.length;
  }
  function openWizard() {
    stop();
    wiz = wizDraft();
    $('wizard').hidden = false; document.body.classList.add('wiz-open');
    renderWizard();
    setTimeout(function () { var f = $('wizBody').querySelector('.wcard.on') || $('wizBody').querySelector('button, input, select'); if (f) f.focus(); }, 30);
  }
  function closeWizard(done) {
    if (!wiz) return;
    var rf = wiz.returnFocus;
    $('wizard').hidden = true; document.body.classList.remove('wiz-open');
    wiz = null;
    try { localStorage.setItem('lunarNavWizard', '1'); } catch (e) {}
    if (rf && rf.focus && !done) rf.focus();
  }
  function finishWizard() {
    var w = wiz;
    set.mast = w.mast; set.sun = Math.max(0.01, w.sun / 100); set.earth = w.earth; set.share = w.share / 100;
    w.pins.forEach(function (p) { PINS.push(p); });
    state.filter = w.scope; state.sel = w.sel.slice();
    closeWizard(true);
    if (state.site) { stop(); closeSurface(); state.site = null; }
    state.picking = false; state.cmpOpen = false;
    fillRules(); panoKey = ''; calKey = '';
    if (hasSurface) SURF.setEyeHeight(set.mast);
    setMission(w.plan, w.slip, w.days);                       // applies the dates and refreshes everything
    if (w.after === 'compare' && state.sel.length >= 2) { state.cmpOpen = true; refresh(); }
    else if (w.after === 'best') {
      var b = ranked.filter(function (e) { return e.st.ok && (state.filter === 'all' || e.site.group === state.filter || e.site.group === 'pin'); })[0];
      if (b) select(b.site);
    }
  }
  $('setupBtn').addEventListener('click', openWizard);
  $('wizClose').addEventListener('click', function () { closeWizard(); });
  $('wizSkip').addEventListener('click', function () { closeWizard(); });
  $('wizBack').addEventListener('click', function () { if (wiz && wiz.step > 0) { wiz.step--; renderWizard(); $('wizNext').focus(); } });
  $('wizNext').addEventListener('click', function () {
    if (!wiz) return;
    if (wiz.step < WSTEPS.length - 1) { wiz.step++; renderWizard(); $('wizNext').focus(); } else finishWizard();
  });
  $('wizard').addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') { ev.stopPropagation(); closeWizard(); return; }
    if (ev.key === 'Tab') {                                  // keep focus inside the dialog
      var f = Array.prototype.filter.call($('wizard').querySelectorAll('button, input, select'), function (x) { return !x.disabled && x.offsetParent !== null; });
      if (!f.length) return;
      if (ev.shiftKey && document.activeElement === f[0]) { f[f.length - 1].focus(); ev.preventDefault(); }
      else if (!ev.shiftKey && document.activeElement === f[f.length - 1]) { f[0].focus(); ev.preventDefault(); }
    }
  });
  $('wizard').addEventListener('click', function (ev) { if (ev.target === $('wizard')) closeWizard(); });

  /* ================= start ================= */
  $('stData').textContent = 'Data: ' + D.generator + ', ' + D.ephemeris.software;
  $('stCursor').textContent = 'Cursor off the Moon';
  fillRules(); fillDisplay();
  var ok = Globe.init($('globe'), {
    draw: placePins,
    hover: function (pt) { $('stCursor').textContent = pt ? 'Cursor ' + coord(pt.lat, pt.lon) : 'Cursor off the Moon'; },
    click: function () { if (state.site && state.view === '3d') back(); },
    pick: function (pt) { if (!state.site) addPin(pt.lat, pt.lon); }
  });
  $('noGl').hidden = ok;
  if (ok) { loadSurface(); loadStars(); } else globeReady();
  loadTerrain();
  if (window.ResizeObserver) new ResizeObserver(function () { Globe.resize(); }).observe($('globeWrap'));
  window.addEventListener('resize', function () { Globe.resize(); });
  refresh();
  try { if (!localStorage.getItem('lunarNavWizard')) openWizard(); } catch (e) {}
  window.NAV_DEBUG = { status: status, sites: allSites, series: series, state: state, set: set, select: select, addPin: addPin, setView: setView, evaluate: evaluate, openWizard: openWizard };
})();
