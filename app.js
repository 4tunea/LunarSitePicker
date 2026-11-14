/* Lunar landing site navigator: interface.
   All Sun, Earth and skyline numbers come from NAV_DATA (docs/data-contract.md).
   Visibility is derived here, following contract section 7, so the rules stay user-settable. */
(function () {
  var NS = 'http://www.w3.org/2000/svg', RAD = Math.PI / 180;
  var $ = function (id) { return document.getElementById(id); };
  var D = window.NAV_DATA;
  if (!D || !D.sites || !D.sites.length) {
    document.body.insertBefore(Object.assign(document.createElement('p'), { className: 'fake', textContent: 'No data file loaded. Expected web/data/navigator-data.js (or the .fake.js fixture).' }), document.body.firstChild.nextSibling);
    return;
  }

  /* ================= data layer (the only part that knows the file format) ================= */
  var T0 = Date.parse(D.time.start_utc), STEP = D.time.step_s * 1000, N = D.time.count;
  var SPD = Math.round(86400 / D.time.step_s);                // samples per day
  var NAZ = D.horizon_grid.n_az, AZSTEP = D.horizon_grid.step_deg, RKM = D.constants.moon_radius_km;
  var MASTS = D.sites[0].horizons.map(function (h) { return h.mast_height_m; });
  var TER = null;                                             // coarse terrain grid for picked spots, once decoded

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

  function makeSite(kind, o) {
    return { kind: kind, id: o.id, name: o.name, note: o.note || '', lat: o.lat, lon: o.lon, src: o.src || null, ser: null, hz: null, ground: null, vis: null, visKey: '' };
  }
  var ANALYSED = D.sites.map(function (s) {
    return makeSite('analysed', { id: s.id, name: s.name, note: s.pgda_site ? 'PGDA ' + s.pgda_site : '', lat: s.lat_deg, lon: s.lon_deg, src: s });
  });
  var PAST = (window.PAST_LANDINGS || []).map(function (p) { return makeSite('past', p); });

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

  /* ================= state ================= */
  var set = { mast: MASTS[0], sun: 0.5, earth: 0, share: 0.5 };
  var state = { plan: 0, slip: 0, days: 14, site: null, cur: 0, tech: false, side: window.innerWidth >= 900, custom: null, home: null };
  var hadPlan = false;
  try {
    var sv = JSON.parse(localStorage.getItem('lunarNav2') || '{}');
    if (sv.data === D.time.start_utc + D.generator) {
      if (sv.plan >= 0 && sv.plan < N / SPD) { state.plan = sv.plan | 0; hadPlan = true; }
      if (sv.slip >= 0) state.slip = sv.slip | 0;
      if (sv.days >= 1 && sv.days <= 60) state.days = sv.days | 0;
      if (sv.set && MASTS.indexOf(sv.set.mast) >= 0) set = sv.set;
    }
    if (typeof sv.tech === 'boolean') state.tech = sv.tech;
    if (typeof sv.side === 'boolean' && window.innerWidth >= 900) state.side = sv.side;
  } catch (e) {}
  function save() {
    try { localStorage.setItem('lunarNav2', JSON.stringify({ data: D.time.start_utc + D.generator, plan: state.plan, slip: state.slip, days: state.days, tech: state.tech, side: state.side, set: set })); } catch (e) {}
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
  var pins = [], playing = null, ranked = [], pastRanked = [];

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
  var TERRAIN_TEXT = { dem: 'Analysed terrain', coarse: 'Coarse terrain, 720 m grid', sphere: 'Smooth sphere, no terrain' };

  /* ================= lists and pins ================= */
  function rank() {
    var k = landK(), m = M();
    function order(list) {
      return list.map(function (s) { return { site: s, st: status(s, k, m), was: state.slip ? status(s, planK(), m) : null }; })
        .sort(function (a, b) { return (b.st.ok - a.st.ok) || (b.st.both - a.st.both); });
    }
    ranked = order(ANALYSED);
    ranked.forEach(function (e, i) { e.rank = e.st.ok ? i + 1 : 0; });
    pastRanked = $('pastBox').open ? order(PAST) : [];
  }
  function listItem(e) {
    var s = e.site, ref = s.kind !== 'analysed';
    var li = html('li'), b = html('button', 'item' + (e.st.ok ? '' : ' bad') + (ref ? ' ref' : '') + (state.site === s ? ' on' : '')); b.type = 'button';
    b.appendChild(html('span', 'n', ref ? (e.st.ok ? '✓' : '–') : e.rank ? String(e.rank) : '!'));
    b.appendChild(html('span', '', s.name));
    b.appendChild(html('span', 'why', e.st.why));
    if (e.was && e.was.ok && !e.st.ok) b.appendChild(html('span', 'was', 'Worked on the planned date'));
    var meta = html('small', '', s.note || coord(s.lat, s.lon));
    meta.appendChild(html('span', 'score', Math.round(e.st.share * 100) + '% of the stay, ' + TERRAIN_TEXT[terrainOf(s)].toLowerCase()));
    b.appendChild(meta);
    b.addEventListener('click', function () { select(s); });
    li.appendChild(b);
    return li;
  }
  function renderList() {
    var good = ranked.filter(function (e) { return e.st.ok; }).length;
    $('sideSub').textContent = good + ' of ' + ranked.length + ' work for landing on ' + dayText(landK(), true) + ' and a ' + state.days + '-day stay.';
    var a = $('rank'); clear(a);
    ranked.forEach(function (e) { a.appendChild(listItem(e)); });
    $('pastSum').textContent = 'Past landings (' + PAST.length + '), for reference';
    var p = $('pastList'); clear(p);
    pastRanked.forEach(function (e) { p.appendChild(listItem(e)); });
  }
  function renderPins() {
    var wrap = $('pins'); clear(wrap); pins = [];
    function add(e, ref) {
      var s = e.site, on = state.site === s;
      var b = html('button', 'pin' + (ref ? ' ref' : e.st.ok ? '' : ' bad') + (!ref && e.rank && e.rank <= 3 ? ' top' : '') + (on ? ' on' : ''), ref ? '' : e.rank ? String(e.rank) : '!');
      b.type = 'button'; b.style.zIndex = String(ref ? 5 : 50 - (e.rank || 40));
      b.setAttribute('aria-label', s.name + (e.st.ok ? ', available' : ', not available'));
      b.appendChild(html('span', 'lbl', s.name));
      b.addEventListener('click', function () { select(s); });
      wrap.appendChild(b); pins.push({ node: b, lat: s.lat, lon: s.lon });
    }
    pastRanked.forEach(function (e) { add(e, true); });
    ranked.forEach(function (e) { add(e, false); });
    if (state.site && state.site.kind !== 'analysed' && !pastRanked.some(function (e) { return e.site === state.site; }))
      add({ site: state.site, st: status(state.site, landK(), M()), rank: 0 }, false);
    if (state.tech) {
      var k = state.site ? curK() : landK();
      [['s', 'Sun overhead', subPoint(SUN, k)], ['e', 'Earth overhead', subPoint(EARTH, k)]].forEach(function (m) {
        var d = html('div', 'mark ' + m[0]); d.appendChild(html('span', '', m[1]));
        wrap.appendChild(d); pins.push({ node: d, lat: m[2].lat, lon: m[2].lon });
      });
    }
    placePins();
  }
  function placePins() {
    pins.forEach(function (p) {
      var q = Globe.project(p.lat, p.lon);
      p.node.style.display = q.visible ? '' : 'none';
      if (q.visible) p.node.style.transform = 'translate(' + q.x.toFixed(1) + 'px,' + q.y.toFixed(1) + 'px)';
    });
  }
  function lightGlobe() {
    var k = state.site ? curK() : landK(), s = subPoint(SUN, k), e = subPoint(EARTH, k);
    Globe.set({ sun: Globe.dir(s.lat, s.lon), earth: Globe.dir(e.lat, e.lon), grid: state.tech });
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
      [(r.rank ? r.rank + '. ' : '') + r.site.name, hrs(r.st.both), Math.round(r.st.share * 100) + '%', nw === 'Now' ? nw : nw == null ? 'None' : '+' + nw + ' d']
        .forEach(function (c) { tr.appendChild(html('td', '', String(c))); });
      t.appendChild(tr);
    });
    rows($('dataTable'), [
      ['Status', D.fake ? 'FAKE fixture' : 'Precomputed'], ['Generator', D.generator], ['Generated', D.generated_utc],
      ['Positions', D.ephemeris.software], ['Corrections', D.ephemeris.corrections],
      ['Covers', dayText(0, true) + ' to ' + dayText(N - 1, true)], ['Skyline bins', NAZ + ' (' + AZSTEP + '°)']
    ]);
  }
  function fillRules() {
    var sel = $('setMast'); clear(sel);
    MASTS.forEach(function (m) { var o = html('option', '', m + ' m'); o.value = m; sel.appendChild(o); });
    sel.value = set.mast; $('setSun').value = Math.round(set.sun * 100); $('setEarth').value = set.earth; $('setShare').value = Math.round(set.share * 100);
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
    if (!alts.length) box.appendChild(html('p', '', 'No analysed site works on this date.'));
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
  // Caption for the 3D surface view (web/moonsky/moon-sky.js), which replaced the flat SVG panorama.
  function renderSurfCap(site) {
    var t = terrainOf(site);
    $('surfCap').textContent = 'Above: the view from the surface at this spot. Drag to look around; Play keeps the Sun centred, ' +
      'and a yellow ring marks it when terrain hides it. ' +
      (t === 'dem' ? 'The skyline is the analysed terrain horizon.' : t === 'coarse' ? 'The skyline is coarse terrain from a 720 m grid, good for mountains only.' :
        'This spot has no analysed skyline, so the verdict uses a smooth sphere; the 3D terrain is NASA LOLA at about 1.9 km.') +
      ' Sun and Earth positions are the ones used for the verdict.';
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
  function renderStrips(site) {
    var svg = $('strips'); clear(svg);
    var v = vis(site), p = planK(), span = spanK(), k = 800 / span;
    [[v.sun, null, '#F5A524', 2], [v.earth, null, '#5AA9FF', 20], [v.sun, v.earth, '#3DD6B0', 38]].forEach(function (row) {
      svg.appendChild(el('rect', { x: 0, y: row[3], width: 800, height: row[1] ? 20 : 15, fill: '#1f2a4d' }));
      runs(row[0], p, p + span, row[1]).forEach(function (r) {
        svg.appendChild(el('rect', { x: (r[0] - p) * k, y: row[3], width: Math.max(1, (r[1] - r[0]) * k), height: row[1] ? 20 : 15, fill: row[2] }));
      });
    });
    var x0 = (landK() - p) * k, x1 = Math.min(800, (landK() + M() - p) * k);
    svg.appendChild(el('rect', { x: x0, y: 0.5, width: Math.max(1, x1 - x0), height: 59, fill: 'none', stroke: '#fff', 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke' }));
    if (state.slip) svg.appendChild(el('line', { x1: 0.5, x2: 0.5, y1: 0, y2: 62, stroke: '#fff', 'stroke-width': 1.5, 'stroke-dasharray': '4 3', 'vector-effect': 'non-scaling-stroke' }));
    svg.appendChild(el('line', { x1: state.cur * k, x2: state.cur * k, y1: 0, y2: 62, stroke: '#fff', 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke' }));
    var sc = $('tlScale'); clear(sc);
    [0, 0.25, 0.5, 0.75, 1].forEach(function (f) { sc.appendChild(html('span', '', (f === 0 && state.slip ? 'Planned ' : '') + dayText(p + Math.round(span * f)))); });
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
      (src ? '' : 'This point is not in the data file. Its Sun and Earth angles are derived here from the first analysed site\'s angles' + (t === 'coarse' ? ', and its skyline from a 720 m grid of the LOLA 75° S elevation model.' : ', and it has no terrain.') + ' ') +
      'The Sun counts as up when at least ' + Math.round(set.sun * 100) + '% of its disc clears the skyline, Earth when its centre is more than ' + set.earth + '° above it.';
    var svg = $('elChart'); clear(svg);
    var a0 = landK(), a1 = Math.min(N - 1, a0 + M()), m = Math.max(1, a1 - a0), Lx = 38, Rt = 470, T = 10, Bt = 195, i;
    var lo = -1, hi = 1;
    for (i = a0; i <= a1; i++) { lo = Math.min(lo, s.sunAlt[i], s.earthAlt[i], v.sunSky[i]); hi = Math.max(hi, s.sunAlt[i], s.earthAlt[i], v.sunSky[i], v.earthSky[i]); }
    var pad = (hi - lo) * 0.06; lo -= pad; hi += pad;
    var X = function (j) { return Lx + (j - a0) / m * (Rt - Lx); }, Y = function (a) { return T + (hi - a) / (hi - lo) * (Bt - T); };
    var step = (hi - lo) > 80 ? 30 : (hi - lo) > 30 ? 10 : (hi - lo) > 10 ? 5 : 1;
    for (var g = Math.ceil(lo / step) * step; g <= hi; g += step) {
      svg.appendChild(el('line', { x1: Lx, x2: Rt, y1: Y(g), y2: Y(g), stroke: g === 0 ? '#b9bdc9' : '#2a3460', 'stroke-width': 1 }));
      svg.appendChild(el('text', { x: Lx - 6, y: Y(g) + 4, fill: '#a3acc8', 'font-size': 11, 'text-anchor': 'end' }, g + '°'));
    }
    svg.appendChild(el('text', { x: Lx, y: Bt + 16, fill: '#a3acc8', 'font-size': 11 }, 'Landing'));
    svg.appendChild(el('text', { x: Rt, y: Bt + 16, fill: '#a3acc8', 'font-size': 11, 'text-anchor': 'end' }, 'Take-off'));
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
  function flip(arr, k) { for (var i = k + 1; i < N; i++) if (arr[i] !== arr[k]) return i - k - 0.5; return null; }
  function renderSite() {
    var open = !!state.site;
    $('sitePanel').hidden = !open; $('stage').classList.toggle('insite', open);
    if (!open) return;
    var site = state.site, k0 = landK(), m = M(), st = status(site, k0, m), k = curK(), v = vis(site);
    $('siteName').textContent = site.name;
    $('siteMeta').textContent = (site.note ? site.note + ', ' : '') + coord(site.lat, site.lon);
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
    var end = Math.min(N - 1, k0 + m), sunH = 0, earthH = 0, dark = 0, run = 0;
    for (var i = k0; i < k0 + st.total; i++) { sunH += v.sun[i]; earthH += v.earth[i]; run = v.sun[i] ? 0 : run + 1; if (run > dark) dark = run; }
    var stEl = $('stats'); clear(stEl);
    [['Stay with both Sun and Earth', hrs(st.both) + ' (' + Math.round(st.share * 100) + '%)'],
     ['Stay in sunlight', Math.round(100 * sunH / st.total) + '%'], ['Stay with Earth in view', Math.round(100 * earthH / st.total) + '%'],
     ['Longest dark stretch', dark ? dur(dark) : 'None'], ['Skyline', TERRAIN_TEXT[terrainOf(site)]]].forEach(function (r) {
      var d = html('div'); d.appendChild(html('span', '', r[0])); d.appendChild(html('b', '', r[1])); stEl.appendChild(d);
    });
    renderSurfCap(site); renderStrips(site); syncSurface();
    var rel = k - k0;
    $('clock').textContent = fmtTime(k) + (rel < 0 ? ', ' + dur(-rel) + ' before landing' : rel > m ? ', ' + dur(rel - m) + ' after take-off' : ', day ' + (Math.floor(rel / SPD) + 1) + ' of the stay');
    $('scrub').max = spanK(); $('scrub').value = state.cur;
    renderSiteTech(site, st, k);
  }

  /* ================= 3D surface view (web/moonsky/moon-sky.js) =================
     Opening a site zooms the globe down onto it and cross-fades into a first-person view from the surface.
     The view takes its Sun/Earth angles and its skyline from this file's data layer, so what it shows
     always agrees with the verdict; only stars and Earth's rotation come from its own ephemeris. */
  var SURF = $('surface'), surfTok = 0, surfSite = null;
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
  // Loading screen (#surfLoad). Shown (.surface-wait) only if the view is still loading when the zoom-in
  // ends, and on errors (.surface-error). Progress comes from the view's 'moonsky-progress' events.
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
    $('slErr').textContent = 'The surface view could not open: ' + ((err && err.message) || err);
    $('slErr').hidden = false; $('slBack').hidden = false;
  }
  if (hasSurface) SURF.addEventListener('moonsky-progress', function (e) {
    if ($('globeWrap').classList.contains('surface-loading')) loadProgress(e.detail.label, e.detail.frac);
  });
  function syncSurface() {                                      // the panel's clock drives the view
    if (!hasSurface || !state.site || state.site !== surfSite) return;
    SURF.setWindow(ms(landK()), ms(Math.min(N - 1, landK() + M())));
    SURF.setTime(ms(curK()));
  }
  function openSurface(site) {
    if (!hasSurface) { Globe.flyTo(site.lon, site.lat, 1.5); return; }
    var tok = ++surfTok, wrap = $('globeWrap');
    wrap.classList.remove('surface-on', 'surface-error', 'surface-wait'); wrap.classList.add('surface-loading');
    loadScreen(site);
    surfSite = site;
    SURF.setTracking(false); SURF.setEyeHeight(set.mast);
    syncSurface();
    var flown = new Promise(function (res) { Globe.flyTo(site.lon, site.lat, 1.07, res, 1100); setTimeout(res, 1600); });
    flown.then(function () { if (tok === surfTok && wrap.classList.contains('surface-loading')) wrap.classList.add('surface-wait'); });
    var built = SURF.setSite(site.lat, site.lon, site.name).then(function () { return null; }, function (e) { return e; });
    Promise.all([flown, built]).then(function (r) {
      if (tok !== surfTok) return;
      if (r[1]) { loadError(r[1]); return; }
      loadProgress('Ready', 1);
      wrap.classList.remove('surface-loading', 'surface-wait');
      syncSurface();
      wrap.classList.add('surface-on');
      if (playing) SURF.setTracking(true);
    });
  }
  function closeSurface() {
    surfTok++;
    $('globeWrap').classList.remove('surface-on', 'surface-loading', 'surface-wait', 'surface-error');
    if (hasSurface) SURF.setTracking(false);
  }

  /* ================= flow ================= */
  function fields() {
    $('date').min = isoDay(0); $('date').max = isoDay(Math.floor((N - 1) / SPD));
    $('date').value = isoDay(state.plan); $('days').value = state.days;
    var maxSlip = Math.max(0, Math.floor((N - 1) / SPD) - state.plan);
    $('slip').max = Math.min(maxSlip, Math.max(56, state.slip)); $('slip').value = state.slip;
    $('slipOut').textContent = state.slip ? '+' + state.slip + (state.slip === 1 ? ' day' : ' days') : 'None';
    $('slipOut').className = state.slip ? 'on' : '';
    var out = $('missionOut'); clear(out);
    out.appendChild(document.createTextNode('Lands ')); out.appendChild(html('b', '', dayText(landK(), true)));
    out.appendChild(document.createTextNode(', leaves ')); out.appendChild(html('b', '', dayText(Math.min(N - 1, landK() + M()), true)));
    $('techToggle').checked = state.tech;
    $('sideToggle').setAttribute('aria-pressed', String(state.side));
    $('app').classList.toggle('noside', !state.side);
  }
  function refresh() {
    document.body.classList.toggle('tech', state.tech);
    state.cur = Math.max(0, Math.min(spanK(), state.cur));
    fields(); save();
    rank(); lightGlobe(); renderList(); renderPins(); renderMoonTech(); renderSite();
  }
  function tick() { lightGlobe(); renderPins(); renderSite(); }
  function stop() {
    if (playing) { clearInterval(playing); playing = null; $('play').textContent = 'Play'; }
    if (hasSurface) SURF.setTracking(false);
  }
  function play() {
    if (playing) { stop(); return; }
    var a = landK() - planK(), b = Math.min(spanK(), a + M());
    if (state.cur < a || state.cur >= b) state.cur = a;
    $('play').textContent = 'Pause';
    if (hasSurface && $('globeWrap').classList.contains('surface-on')) SURF.setTracking(true);   // keep the Sun centred
    var stepK = Math.max(1, Math.round(M() / 200));
    playing = setInterval(function () { state.cur = Math.min(b, state.cur + stepK); tick(); if (state.cur >= b) stop(); }, 60);
  }
  function select(site) {
    stop();
    if (!state.site) state.home = Globe.view();
    state.site = site; state.cur = landK() - planK();
    refresh();
    openSurface(site);
    $('sitePanel').scrollTop = 0;
  }
  function back() {
    if (!state.site) return;
    stop(); closeSurface(); state.site = null; refresh();
    var h = state.home || { lon: 15, lat: -40, dist: 4.2 };
    Globe.flyTo(h.lon, h.lat, Math.max(h.dist, 3));
  }
  function setMission(plan, slip, days) {
    stop();
    var last = Math.floor((N - 1) / SPD);
    state.plan = Math.max(0, Math.min(last, plan)); state.slip = Math.max(0, Math.min(last - state.plan, slip));
    state.days = Math.max(1, Math.min(60, Math.round(days) || 1));
    state.cur = landK() - planK();
    refresh();
  }
  function inspect(lat, lon) {
    lat = Math.max(-90, Math.min(90, lat)); lon = ((lon + 540) % 360) - 180;
    state.custom = makeSite('custom', { id: 'custom', name: 'Picked spot', note: '', lat: +lat.toFixed(4), lon: +lon.toFixed(4) });
    $('cLat').value = state.custom.lat; $('cLon').value = state.custom.lon;
    select(state.custom);
  }

  $('date').addEventListener('change', function () {
    var d = Math.round((Date.parse(this.value + 'T00:00:00Z') - T0) / 86400000);
    if (this.value && isFinite(d)) setMission(d, state.slip, state.days); else fields();
  });
  $('slip').addEventListener('input', function () { setMission(state.plan, +this.value, state.days); });
  $('days').addEventListener('change', function () { setMission(state.plan, state.slip, +this.value); });
  $('techToggle').addEventListener('change', function () { state.tech = this.checked; refresh(); });
  $('sideToggle').addEventListener('click', function () { state.side = !state.side; refresh(); });
  $('pastBox').addEventListener('toggle', refresh);
  $('play').addEventListener('click', play);
  $('surfBack').addEventListener('click', back);
  $('slBack').addEventListener('click', back);
  $('scrub').addEventListener('input', function () { stop(); state.cur = +this.value; tick(); });
  ['setMast', 'setSun', 'setEarth', 'setShare'].forEach(function (id) {
    $(id).addEventListener('change', function () {
      set.mast = +$('setMast').value;
      set.sun = Math.max(0.01, Math.min(1, (+$('setSun').value || 50) / 100));
      set.earth = Math.max(0, +$('setEarth').value || 0);
      set.share = Math.max(0, Math.min(1, (+$('setShare').value || 0) / 100));
      fillRules(); refresh();
      if (hasSurface && state.site) SURF.setEyeHeight(set.mast);        // new mast -> new skyline in the 3D view
    });
  });
  $('coordForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var lat = parseFloat($('cLat').value), lon = parseFloat($('cLon').value);
    if (isFinite(lat) && isFinite(lon)) inspect(lat, lon);
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') { back(); return; }
    if (/^(INPUT|BUTTON|SELECT|TEXTAREA|SUMMARY)$/.test(ev.target.tagName)) return;
    if (ev.target.tagName === 'MOON-SKY' && ev.key.indexOf('Arrow') === 0) return;   // arrows look around in the 3D view
    if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
      var sign = ev.key === 'ArrowLeft' ? -1 : 1;
      if (state.site) { stop(); state.cur = Math.max(0, Math.min(spanK(), state.cur + sign * 3)); tick(); } else setMission(state.plan, state.slip + sign, state.days);
      ev.preventDefault();
    } else if (ev.key === ' ' && state.site) { play(); ev.preventDefault(); }
  });

  /* ================= surface map and coarse terrain ================= */
  function surface(text) { $('stSurface').textContent = 'Surface: ' + text; }
  function liveTiles(z) {                                   // NASA Moon Trek tiles of the LRO wide-angle mosaic
    var cols = Math.pow(2, z + 1), rowsN = Math.pow(2, z), left = cols * rowsN, dead = false;
    var c = document.createElement('canvas'); c.width = cols * 256; c.height = rowsN * 256;
    var ctx = c.getContext('2d');
    for (var r = 0; r < rowsN; r++) for (var q = 0; q < cols; q++) (function (r, q) {
      var img = new Image(); img.crossOrigin = 'anonymous';
      img.onload = function () {
        if (dead) return;
        ctx.drawImage(img, q * 256, r * 256, 256, 256);
        if (--left === 0 && Globe.setTexture(c)) { surface('NASA LRO camera mosaic, live from Moon Trek'); if (z < 3) liveTiles(3); }
      };
      img.onerror = function () { dead = true; };
      img.src = 'https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/default/default028mm/' + z + '/' + r + '/' + q + '.jpg';
    })(r, q);
  }
  function loadSurface() {
    surface('generated, no NASA map loaded');
    if (typeof MOON_TEXTURE === 'string' && MOON_TEXTURE) {
      var img = new Image();
      img.onload = function () { if (Globe.setTexture(img)) surface(((typeof MOON_TEXTURE_SOURCE === 'string' && MOON_TEXTURE_SOURCE) || 'NASA map') + ', ' + img.naturalWidth + ' px'); else liveTiles(2); };
      img.onerror = function () { liveTiles(2); };
      img.src = MOON_TEXTURE;
    } else liveTiles(2);
  }
  function loadTerrain() {
    var t = window.TERRAIN_LOWRES;
    if (!t || !window.DecompressionStream) return;
    var bin = atob(t.deflate_b64), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer().then(function (buf) {
      TER = Terrain.fromDeltas(t.n, t.px_m, t.quant_m, new Uint8Array(buf));
      PAST.concat(state.custom ? [state.custom] : []).forEach(function (s) { s.hz = null; s.vis = null; });
      refresh();
      if (hasSurface && state.site && state.site === surfSite) SURF.rebuild();   // finer polar terrain + skyline now known
    }).catch(function () {});
  }

  /* ================= start ================= */
  $('fakeBanner').hidden = !D.fake;
  $('stData').textContent = 'Data: ' + (D.fake ? 'FAKE fixture' : D.generator);
  $('stCursor').textContent = 'Cursor off the Moon';
  fillRules();
  var ok = Globe.init($('globe'), {
    draw: placePins,
    hover: function (pt) { $('stCursor').textContent = pt ? 'Cursor ' + coord(pt.lat, pt.lon) : 'Cursor off the Moon'; },
    click: function () { if (state.site) back(); },
    pick: function (pt) { if (!state.site) inspect(pt.lat, pt.lon); }
  });
  $('noGl').hidden = ok;
  if (ok) loadSurface();
  loadTerrain();
  if (window.ResizeObserver) new ResizeObserver(function () { Globe.resize(); }).observe($('globeWrap'));
  window.addEventListener('resize', function () { Globe.resize(); });
  refresh();
  window.NAV_DEBUG = { status: status, sites: ANALYSED, series: series, state: state, set: set };
})();
