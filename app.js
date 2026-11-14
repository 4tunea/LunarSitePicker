(function () {
  var SUN_R = 0.266, H = 3600000, DAY = 86400000, MARGIN = 336, MIN_SHARE = 75;
  var NS = 'http://www.w3.org/2000/svg';
  var HZ = (typeof HORIZONS !== 'undefined' && HORIZONS) || {};
  var HZ_SRC = (typeof HORIZON_SOURCE !== 'undefined' && HORIZON_SOURCE) || 'terrain';
  var $ = function (id) { return document.getElementById(id); };
  var state = { date: new Date().toISOString().slice(0, 10), days: 10, site: null, hour: 0, tech: false, side: window.innerWidth >= 900, custom: null, home: null };
  try {
    var saved = JSON.parse(localStorage.getItem('lunarNav') || '{}');
    if (/^\d{4}-\d\d-\d\d$/.test(saved.date || '')) state.date = saved.date;
    if (saved.days >= 1 && saved.days <= 60) state.days = Math.round(saved.days);
    if (typeof saved.tech === 'boolean') state.tech = saved.tech;
    if (typeof saved.side === 'boolean' && window.innerWidth >= 900) state.side = saved.side;
  } catch (e) {}
  function save() { try { localStorage.setItem('lunarNav', JSON.stringify({ date: state.date, days: state.days, tech: state.tech, side: state.side })); } catch (e) {} }
  var cache = { key: null, states: null, evals: {} }, ranked = { ok: [], no: [] }, pins = [], playing = null;

  /* ---------- helpers ---------- */
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
  function t0() { return Date.parse(state.date + 'T00:00:00Z'); }
  function M() { return state.days * 24; }          // mission length in hours
  function L() { return M() + MARGIN; }             // hours computed (mission plus two weeks)
  function dur(hours) {
    if (hours < 1) return Math.max(1, Math.round(hours * 60)) + ' min';
    var d = Math.floor(hours / 24), h = Math.round(hours - d * 24);
    if (h === 24) { d += 1; h = 0; }
    return d ? d + ' d ' + h + ' h' : h + ' h';
  }
  function coord(lat, lon) {
    return Math.abs(lat).toFixed(2) + '° ' + (lat < 0 ? 'S' : 'N') + ', ' + Math.abs(lon).toFixed(2) + '° ' + (lon < 0 ? 'W' : 'E');
  }
  function lonText(lon) { lon = ((lon + 540) % 360) - 180; return Math.abs(lon).toFixed(1) + '° ' + (lon < 0 ? 'W' : 'E'); }
  function fmtTime(ms) { return new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'; }
  function shortDate(ms) { return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }); }
  function longDate() { return new Date(t0()).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }); }
  function deg(v) { return (v < 0 ? '−' : '') + Math.abs(v).toFixed(2) + '°'; }

  /* ---------- model ---------- */
  // Height of the skyline (degrees) in a compass direction. Zero without terrain data.
  function skyline(site, az) {
    var h = HZ[site.id];
    if (!h) return 0;
    var n = h.el.length, i = (((az % 360) + 360) % 360) / 360 * n, a = Math.floor(i) % n, f = i - Math.floor(i);
    return h.el[a] * (1 - f) + h.el[(a + 1) % n] * f;
  }
  function prepare() {
    var key = state.date + '|' + L();
    if (cache.key === key) return;
    var s = [], start = t0();
    for (var h = 0; h <= L(); h++) s.push(Ephem.state(start + h * H));
    cache = { key: key, states: s, evals: {} };
  }
  function evaluate(site) {
    prepare();
    var key = site.id + ':' + site.lat + ',' + site.lon;
    if (cache.evals[key]) return cache.evals[key];
    var m = M(), n = L();
    var e = { site: site, sunEl: [], sunAz: [], earthEl: [], earthAz: [], sunUp: [], earthUp: [], sunSky: [], terrain: !!HZ[site.id] };
    var sun = 0, earth = 0, both = 0, win = -1, sunrise = -1, anyEarth = false;
    for (var h = 0; h <= n; h++) {
      var v = Ephem.at(cache.states[h], site.lat, site.lon);
      var ss = skyline(site, v.sun.az), a = v.sun.el + SUN_R > ss, b = v.earth.el > skyline(site, v.earth.az);
      e.sunEl.push(v.sun.el); e.sunAz.push(v.sun.az); e.earthEl.push(v.earth.el); e.earthAz.push(v.earth.az);
      e.sunUp.push(a); e.earthUp.push(b); e.sunSky.push(ss);
      if (h <= m) { if (a) sun++; if (b) earth++; if (a && b) both++; }
      if (a && sunrise < 0) sunrise = h;
      if (b) anyEarth = true;
      if (win < 0 && !(a && b)) win = h;
    }
    e.sunPct = Math.round(100 * sun / (m + 1)); e.earthPct = Math.round(100 * earth / (m + 1));
    e.score = Math.round(100 * both / (m + 1));
    e.whole = win < 0; e.window = e.whole ? n : Math.max(0, win - 1);
    e.spare = e.window >= m ? e.window - m : -1;
    e.ok = e.sunUp[0] && e.earthUp[0] && e.score >= MIN_SHARE;
    if (e.ok && e.spare >= 0) e.why = 'Sun and Earth for the whole stay, ' + (e.whole ? 'over 14 d' : dur(e.spare)) + ' to spare';
    else if (e.ok) e.why = 'Sun and Earth for ' + e.score + '% of the stay';
    else if (!anyEarth) e.why = 'Earth does not come into view. Needs a relay satellite.';
    else if (!e.sunUp[0]) e.why = sunrise < 0 ? 'The Sun stays down for the whole stay.' : 'The Sun is down at landing. Sunrise in ' + dur(sunrise) + '.';
    else if (!e.earthUp[0]) e.why = 'Earth is out of view at landing.';
    else e.why = 'Sun and Earth for only ' + e.score + '% of the stay.';
    cache.evals[key] = e;
    return e;
  }
  function rank() {
    var list = SITES.slice(); if (state.custom) list.push(state.custom);
    var all = list.map(evaluate).sort(function (a, b) { return b.score - a.score || b.window - a.window || b.sunPct - a.sunPct; });
    ranked = { ok: all.filter(function (e) { return e.ok; }), no: all.filter(function (e) { return !e.ok; }) };
    ranked.ok.forEach(function (e, i) { e.rank = i + 1; });
    ranked.no.forEach(function (e) { e.rank = 0; });
  }
  function nextFlip(arr, hour) {
    for (var i = hour + 1; i < arr.length; i++) if (arr[i] !== arr[hour]) return i - hour - 0.5;
    return null;
  }
  function runs(arr, upto) {
    var out = [], start = -1;
    for (var i = 0; i <= upto; i++) {
      if (arr[i] && start < 0) start = i;
      if ((!arr[i] || i === upto) && start >= 0) { out.push([start, arr[i] ? i : i - 1]); start = -1; }
    }
    return out;
  }

  /* ---------- sidebar and pins ---------- */
  function listItem(e) {
    var li = html('li'), b = html('button', 'item' + (state.site && state.site.id === e.site.id ? ' on' : '')); b.type = 'button';
    b.appendChild(html('span', 'n', e.rank ? String(e.rank) : '–'));
    b.appendChild(html('span', '', e.site.name));
    b.appendChild(html('span', 'why', e.why));
    var meta = html('small', '', e.site.note || coord(e.site.lat, e.site.lon));
    meta.appendChild(html('span', 'score', 'Score ' + e.score + ', Sun ' + e.sunPct + '%, Earth ' + e.earthPct + '%, ' + (e.terrain ? 'terrain horizon' : 'smooth horizon')));
    b.appendChild(meta);
    b.addEventListener('click', function () { select(e.site); });
    li.appendChild(b);
    return li;
  }
  function renderList() {
    $('sideSub').textContent = ranked.ok.length + ' of ' + (ranked.ok.length + ranked.no.length) + ' sites suit a ' + state.days + '-day stay from ' + longDate() + '. Best first.';
    var a = $('rank'), b = $('notRank'); clear(a); clear(b);
    ranked.ok.forEach(function (e) { a.appendChild(listItem(e)); });
    ranked.no.forEach(function (e) { b.appendChild(listItem(e)); });
    if (!ranked.ok.length) a.appendChild(html('li', 'hint', 'No site suits this mission. Try another landing date or a shorter stay.'));
    $('notHead').hidden = !ranked.no.length;
  }
  function renderPins() {
    var wrap = $('pins'); clear(wrap); pins = [];
    var show = ranked.ok.slice();
    if (state.site) { var sel = evaluate(state.site); if (!sel.ok) show.push(sel); }
    show.forEach(function (e) {
      var on = state.site && state.site.id === e.site.id;
      var b = html('button', 'pin' + (e.rank && e.rank <= 3 ? ' top' : '') + (on ? ' on' : '') + (e.ok ? '' : ' offpin'), e.rank ? String(e.rank) : '');
      b.type = 'button'; b.style.zIndex = String(50 - (e.rank || 50));
      b.setAttribute('aria-label', e.site.name + (e.rank ? ', pick ' + e.rank : ', not recommended'));
      b.appendChild(html('span', 'lbl', e.site.name));
      b.addEventListener('click', function () { select(e.site); });
      wrap.appendChild(b); pins.push({ node: b, lat: e.site.lat, lon: e.site.lon });
    });
    if (state.tech) {
      var s = cache.states[state.hour];
      [['s', 'Sun overhead', s.subSun], ['e', 'Earth overhead', s.subEarth]].forEach(function (m) {
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
    prepare();
    var s = cache.states[state.hour];
    Globe.set({ sun: Globe.dir(s.subSun.lat, s.subSun.lon), earth: Globe.dir(s.subEarth.lat, s.subEarth.lon), grid: state.tech });
  }

  /* ---------- whole-Moon technical panel ---------- */
  function renderMoonTech() {
    $('moonTech').hidden = !state.tech || !!state.site;
    if ($('moonTech').hidden) return;
    var s = cache.states[0], a = Globe.dir(s.subSun.lat, s.subSun.lon), b = Globe.dir(s.subEarth.lat, s.subEarth.lon);
    var k = (1 + a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / 2;
    var waxing = (((s.subSun.lon - s.subEarth.lon) + 540) % 360) - 180 > 0;
    var name = k < 0.03 ? 'New Moon' : k > 0.97 ? 'Full Moon' : Math.abs(k - 0.5) < 0.04 ? (waxing ? 'First quarter' : 'Last quarter') :
      (waxing ? 'Waxing ' : 'Waning ') + (k < 0.5 ? 'crescent' : 'gibbous');
    var sl = s.subSun.lat;
    rows($('moonTable'), [
      ['Phase seen from Earth', name + ', ' + Math.round(k * 100) + '% lit'],
      ['Sun overhead at', coord(s.subSun.lat, s.subSun.lon)],
      ['Earth overhead at (libration)', coord(s.subEarth.lat, s.subEarth.lon)],
      ['Sunrise line', lonText(s.subSun.lon - 90)],
      ['Sunset line', lonText(s.subSun.lon + 90)],
      ['South pole season', (sl < 0 ? 'Summer' : 'Winter') + ', Sun ' + Math.abs(sl).toFixed(2) + '° ' + (sl < 0 ? 'south' : 'north')],
      ['Earth distance', Math.round(s.dist).toLocaleString('en-US') + ' km']
    ]);
    $('ruleNote').textContent = 'The score is the share of the ' + state.days + '-day stay with both sunlight and Earth in view. A site is recommended when both are there at landing and the score is at least ' + MIN_SHARE + '. Ties go to the site that keeps both longest after take-off. Sites marked T use real terrain for the skyline; the others use a smooth sphere. Slopes and landing hazards are not included.';
    var t = $('rankTable'); clear(t);
    var head = html('tr'); ['Site', 'Score', 'Sun', 'Earth', 'Spare'].forEach(function (h) { head.appendChild(html('th', '', h)); });
    t.appendChild(head);
    ranked.ok.concat(ranked.no).forEach(function (e) {
      var tr = html('tr', e.ok ? '' : 'no');
      [(e.rank ? e.rank + '. ' : '') + e.site.name + (e.terrain ? ' (T)' : ''), e.score, e.sunPct + '%', e.earthPct + '%',
       e.spare < 0 ? 'None' : e.whole ? '14 d+' : dur(e.spare)].forEach(function (c) { tr.appendChild(html('td', '', String(c))); });
      t.appendChild(tr);
    });
  }

  /* ---------- site inspector ---------- */
  function renderSky(e, v) {
    var svg = $('sky'); clear(svg);
    var W = 800, TOP = 16, BOT = 250, m = M(), site = e.site, i;
    var peak = -90, ridge = 0;
    for (i = 0; i <= m; i++) peak = Math.max(peak, e.sunEl[i], e.earthEl[i]);
    for (i = 0; i < 360; i += 2) ridge = Math.max(ridge, skyline(site, i));
    var elMax = Math.min(90, Math.max(12, Math.ceil(Math.max(peak, ridge) + 5))), elMin = -Math.max(6, elMax * 0.3);
    var X = function (az) { return ((az + 180) % 360) / 360 * W; };
    var Y = function (a) { return TOP + (elMax - a) / (elMax - elMin) * (BOT - TOP); };
    for (i = 0; i < 70; i++) {
      var r1 = Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1, r2 = Math.abs(Math.sin(i * 78.233) * 12543.123) % 1;
      svg.appendChild(el('circle', { cx: (r1 * W).toFixed(0), cy: (r2 * (Y(0) - 6)).toFixed(0), r: r1 > 0.8 ? 1.1 : 0.6, fill: '#8f9ac0', opacity: 0.6 }));
    }
    var step = elMax <= 20 ? 5 : elMax <= 50 ? 10 : 20;
    for (var g = step; g < elMax; g += step) {
      svg.appendChild(el('line', { x1: 0, x2: W, y1: Y(g), y2: Y(g), stroke: '#1d2548', 'stroke-width': 1 }));
      svg.appendChild(el('text', { x: 8, y: Y(g) - 4, fill: '#7d88ad', 'font-size': 11 }, g + '°'));
    }
    function trace(az, elv, color) {
      var d = '', px = null;
      for (var j = 0; j <= m; j++) {
        var x = X(az[j]), y = Y(Math.max(elMin, elv[j]));
        d += (px == null || Math.abs(x - px) > W / 2 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1); px = x;
      }
      svg.appendChild(el('path', { d: d, fill: 'none', stroke: color, 'stroke-width': 1.5, opacity: 0.45 }));
    }
    trace(e.sunAz, e.sunEl, '#f5c64f'); trace(e.earthAz, e.earthEl, '#6cb0ee');
    function body(p, up, color, r, name) {
      var x = X(p.az), y = Y(Math.max(elMin * 0.55, p.el)), a = { cx: x, cy: y, r: r };
      if (up) a.fill = color; else { a.fill = 'none'; a.stroke = color; a['stroke-width'] = 1.5; a['stroke-dasharray'] = '3 3'; }
      svg.appendChild(el('circle', a));
      var right = x < W - 70;
      svg.appendChild(el('text', { x: x + (right ? r + 6 : -r - 6), y: y + 4, fill: color, 'font-size': 13, 'font-weight': 600, 'text-anchor': right ? 'start' : 'end' }, name));
    }
    var sunUp = v.sun.el + SUN_R > skyline(site, v.sun.az), earthUp = v.earth.el > skyline(site, v.earth.az);
    // bodies that are up go behind nothing; the ground is drawn after so it hides anything below the skyline
    if (earthUp) body(v.earth, true, '#6cb0ee', 12, 'Earth');
    if (sunUp) body(v.sun, true, '#f5c64f', 7, 'Sun');
    var d = 'M0 ' + BOT;
    for (i = -180; i <= 180; i += 2) d += 'L' + ((i + 180) / 360 * W).toFixed(1) + ' ' + Y(skyline(site, i)).toFixed(1);
    svg.appendChild(el('path', { d: d + 'L' + W + ' ' + BOT + 'Z', fill: '#4a4e5c', stroke: '#b9bdc9', 'stroke-width': 1.2 }));
    if (!earthUp) body(v.earth, false, '#6cb0ee', 12, 'Earth');
    if (!sunUp) body(v.sun, false, '#f5c64f', 7, 'Sun');
    [['South', 0], ['West', 200], ['North', 400], ['East', 600], ['South', 800]].forEach(function (c) {
      svg.appendChild(el('text', { x: c[1], y: BOT - 7, fill: '#d6d9e3', 'font-size': 12,
        'text-anchor': c[1] === 0 ? 'start' : c[1] === 800 ? 'end' : 'middle', dx: c[1] === 0 ? 8 : c[1] === 800 ? -8 : 0 }, c[0]));
    });
    $('skyCap').textContent = 'The view from the surface, all the way around the lander. ' +
      (e.terrain ? 'The skyline is real terrain (' + HZ_SRC + ').' : 'No terrain data for this spot, so the horizon is a smooth sphere.') +
      ' Faint lines show where the Sun and Earth travel during the stay.';
  }
  function renderStrips(e) {
    var svg = $('strips'); clear(svg);
    var m = M(), k = 800 / m;
    [[e.sunUp, '#f5c64f', 2], [e.earthUp, '#6cb0ee', 27]].forEach(function (row) {
      svg.appendChild(el('rect', { x: 0, y: row[2], width: 800, height: 20, fill: '#1f2a4d' }));
      runs(row[0], m).forEach(function (r) {
        svg.appendChild(el('rect', { x: r[0] * k, y: row[2], width: Math.max(1, (r[1] - r[0]) * k), height: 20, fill: row[1] }));
      });
    });
    svg.appendChild(el('line', { x1: state.hour * k, x2: state.hour * k, y1: 0, y2: 50, stroke: '#fff', 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke' }));
    var sc = $('tlScale'); clear(sc);
    [0, 0.25, 0.5, 0.75, 1].forEach(function (f) {
      sc.appendChild(html('span', '', f === 0 ? 'Landing ' + shortDate(t0()) : f === 1 ? 'Take-off ' + shortDate(t0() + m * H) : '+' + dur(m * f)));
    });
  }
  function renderSiteTech(e, v, now) {
    $('siteTech').hidden = !state.tech;
    if (!state.tech) return;
    var s = v.state, site = e.site, m = M(), hz = HZ[site.id];
    rows($('techTable'), [
      ['Time', fmtTime(now)], ['Site', coord(site.lat, site.lon)],
      ['Sun elevation', deg(v.sun.el)], ['Sun azimuth', v.sun.az.toFixed(1) + '°'],
      ['Skyline toward the Sun', deg(skyline(site, v.sun.az))],
      ['Earth elevation', deg(v.earth.el)], ['Earth azimuth', v.earth.az.toFixed(1) + '°'],
      ['Skyline toward Earth', deg(skyline(site, v.earth.az))],
      ['Ground height', hz ? hz.ground.toLocaleString('en-US') + ' m' : 'No terrain data'],
      ['Sun overhead at', coord(s.subSun.lat, s.subSun.lon)], ['Earth overhead at', coord(s.subEarth.lat, s.subEarth.lon)],
      ['Earth distance', Math.round(s.dist).toLocaleString('en-US') + ' km'],
      ['Score', e.score + ' of 100' + (e.rank ? ' (pick ' + e.rank + ')' : ' (not recommended)')],
      ['Sun and Earth from landing', e.window ? (e.whole ? 'More than ' + dur(L()) : dur(e.window)) : 'None']
    ]);
    var svg = $('elChart'); clear(svg);
    var Lx = 38, Rt = 470, T = 10, Bt = 195, i;
    var lo = -2, hi = 2;
    for (i = 0; i <= m; i++) { lo = Math.min(lo, e.sunEl[i], e.earthEl[i]); hi = Math.max(hi, e.sunEl[i], e.earthEl[i], e.sunSky[i]); }
    var pad = (hi - lo) * 0.06; lo -= pad; hi += pad;
    var X = function (h) { return Lx + h / m * (Rt - Lx); }, Y = function (a) { return T + (hi - a) / (hi - lo) * (Bt - T); };
    var step = (hi - lo) > 80 ? 30 : (hi - lo) > 30 ? 10 : (hi - lo) > 10 ? 5 : 1;
    for (var g = Math.ceil(lo / step) * step; g <= hi; g += step) {
      svg.appendChild(el('line', { x1: Lx, x2: Rt, y1: Y(g), y2: Y(g), stroke: g === 0 ? '#b9bdc9' : '#2a3460', 'stroke-width': 1 }));
      svg.appendChild(el('text', { x: Lx - 6, y: Y(g) + 4, fill: '#a3acc8', 'font-size': 11, 'text-anchor': 'end' }, g + '°'));
    }
    svg.appendChild(el('text', { x: Lx, y: Bt + 16, fill: '#a3acc8', 'font-size': 11 }, 'Landing'));
    svg.appendChild(el('text', { x: Rt, y: Bt + 16, fill: '#a3acc8', 'font-size': 11, 'text-anchor': 'end' }, 'Take-off'));
    function line(arr, color, dash) {
      var pts = '';
      for (var j = 0; j <= m; j++) pts += X(j).toFixed(1) + ',' + Y(arr[j]).toFixed(1) + ' ';
      var a = { points: pts, fill: 'none', stroke: color, 'stroke-width': dash ? 1.2 : 2 };
      if (dash) a['stroke-dasharray'] = '4 3';
      svg.appendChild(el('polyline', a));
    }
    if (e.terrain) line(e.sunSky, '#f5c64f', true);
    line(e.sunEl, '#f5c64f'); line(e.earthEl, '#6cb0ee');
    svg.appendChild(el('text', { x: Rt + 6, y: Y(e.sunEl[m]) + 4, fill: '#f5c64f', 'font-size': 12, 'font-weight': 600 }, 'Sun'));
    svg.appendChild(el('text', { x: Rt + 6, y: Y(e.earthEl[m]) + 4, fill: '#6cb0ee', 'font-size': 12, 'font-weight': 600 }, 'Earth'));
    svg.appendChild(el('line', { x1: X(state.hour), x2: X(state.hour), y1: T, y2: Bt, stroke: '#fff', 'stroke-width': 1 }));
  }
  function renderSite() {
    var open = !!state.site;
    $('sitePanel').hidden = !open; $('stage').classList.toggle('insite', open); $('backHint').hidden = !open;
    if (!open) return;
    var site = state.site, e = evaluate(site), now = t0() + state.hour * H, h = state.hour;
    var v = Ephem.at(cache.states[h], site.lat, site.lon);
    $('siteName').textContent = site.name;
    $('siteMeta').textContent = (site.note ? site.note + ', ' : '') + coord(site.lat, site.lon);
    var badge = $('badge');
    badge.className = 'badge' + (e.ok ? '' : ' no');
    badge.textContent = e.ok ? 'Pick ' + e.rank + ' of ' + ranked.ok.length + ' for this mission' : 'Not recommended for this mission';
    var ds = nextFlip(e.sunUp, h), de = nextFlip(e.earthUp, h), s, t;
    if (e.sunUp[h]) s = ds == null ? 'The Sun is up and stays up well past take-off.' : 'The Sun is up. It sets in ' + dur(ds) + '.';
    else s = ds == null ? 'The Sun is down and does not rise during the stay.' : 'The Sun is down. It rises in ' + dur(ds) + '.';
    if (e.earthUp[h]) t = de == null ? 'Earth is in view and stays in view.' : 'Earth is in view. It sets in ' + dur(de) + '.';
    else t = de == null ? 'Earth does not come into view here. Talking to Earth needs a relay satellite.' : 'Earth is out of view. It rises in ' + dur(de) + '.';
    var box = $('verdict'); clear(box);
    box.appendChild(html('p', 's' + (e.sunUp[h] ? '' : ' off'), s)); box.appendChild(html('p', 'e' + (e.earthUp[h] ? '' : ' off'), t));
    var st = $('stats'); clear(st);
    [['Stay with both Sun and Earth', e.score + '%'], ['Stay in sunlight', e.sunPct + '%'], ['Stay with Earth in view', e.earthPct + '%'],
     ['Spare time after take-off', e.spare < 0 ? 'None' : e.whole ? 'Over 14 d' : dur(e.spare)],
     ['Skyline', e.terrain ? 'Real terrain' : 'Smooth sphere']].forEach(function (r) {
      var d = html('div'); d.appendChild(html('span', '', r[0])); d.appendChild(html('b', '', r[1])); st.appendChild(d);
    });
    renderSky(e, v); renderStrips(e);
    $('clock').textContent = fmtTime(now) + ', mission day ' + (Math.min(state.days, Math.floor(h / 24) + 1));
    $('scrub').max = M(); $('scrub').value = h;
    renderSiteTech(e, v, now);
  }

  /* ---------- flow ---------- */
  function fields() {
    $('date').value = state.date; $('days').value = state.days;
    $('takeoff').value = new Date(t0() + state.days * DAY).toISOString().slice(0, 10);
    $('takeoff').min = new Date(t0() + DAY).toISOString().slice(0, 10);
    $('techToggle').checked = state.tech;
    $('sideToggle').setAttribute('aria-pressed', String(state.side));
    $('app').classList.toggle('noside', !state.side);
  }
  function refresh() {
    document.body.classList.toggle('tech', state.tech);
    if (state.hour > M()) state.hour = 0;
    fields(); save();
    prepare(); rank(); lightGlobe(); renderList(); renderPins(); renderMoonTech(); renderSite();
  }
  function tick() { lightGlobe(); renderPins(); renderSite(); }
  function stop() { if (playing) { clearInterval(playing); playing = null; $('play').textContent = 'Play'; } }
  function play() {
    if (playing) { stop(); return; }
    if (state.hour >= M()) state.hour = 0;
    $('play').textContent = 'Pause';
    var stepH = Math.max(1, Math.round(M() / 200));
    playing = setInterval(function () { state.hour = Math.min(M(), state.hour + stepH); tick(); if (state.hour >= M()) stop(); }, 60);
  }
  function select(site) {
    stop();
    if (!state.site) state.home = Globe.view();
    state.site = site; state.hour = 0;
    refresh();
    Globe.flyTo(site.lon, site.lat, 1.5);
    $('sitePanel').scrollTop = 0;
  }
  function back() {
    if (!state.site) return;
    stop(); state.site = null; state.hour = 0; refresh();
    var h = state.home || { lon: 15, lat: -40, dist: 4.2 };
    Globe.flyTo(h.lon, h.lat, Math.max(h.dist, 3));
  }
  function setMission(date, days) {
    stop();
    state.date = date; state.days = Math.max(1, Math.min(60, Math.round(days) || 1)); state.hour = 0;
    refresh();
  }
  function shiftDay(n) { setMission(new Date(t0() + n * DAY).toISOString().slice(0, 10), state.days); }

  $('date').addEventListener('change', function () { if (this.value) setMission(this.value, state.days); else fields(); });
  $('days').addEventListener('change', function () { setMission(state.date, +this.value); });
  $('takeoff').addEventListener('change', function () {
    if (!this.value) { fields(); return; }
    setMission(state.date, (Date.parse(this.value + 'T00:00:00Z') - t0()) / DAY);
  });
  $('prevDay').addEventListener('click', function () { shiftDay(-1); });
  $('nextDay').addEventListener('click', function () { shiftDay(1); });
  $('techToggle').addEventListener('change', function () { state.tech = this.checked; refresh(); });
  $('sideToggle').addEventListener('click', function () { state.side = !state.side; refresh(); });
  $('back').addEventListener('click', back);
  $('viewAll').addEventListener('click', function () { Globe.flyTo(15, -20, 4.2); });
  $('viewPole').addEventListener('click', function () { Globe.flyTo(0, -80, 2.4); });
  $('zoomIn').addEventListener('click', function () { Globe.zoom(0.8); });
  $('zoomOut').addEventListener('click', function () { Globe.zoom(1.25); });
  $('play').addEventListener('click', play);
  $('scrub').addEventListener('input', function () { stop(); state.hour = +this.value; tick(); });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') { back(); return; }
    if (/^(INPUT|BUTTON|SELECT|TEXTAREA)$/.test(ev.target.tagName)) return;
    if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
      var sign = ev.key === 'ArrowLeft' ? -1 : 1;
      if (state.site) { stop(); state.hour = Math.max(0, Math.min(M(), state.hour + sign * 3)); tick(); } else shiftDay(sign);
      ev.preventDefault();
    } else if (ev.key === ' ' && state.site) { play(); ev.preventDefault(); }
  });
  $('hzBtn').addEventListener('click', function () {
    var msg = $('hzMsg'), out = $('hzOut'), site = state.site;
    if (location.protocol === 'file:') { msg.textContent = 'This check needs the local server. Run "python server.py" in this folder, then open http://localhost:8000.'; return; }
    var now = t0() + state.hour * H;
    msg.textContent = 'Asking JPL Horizons…'; out.hidden = true;
    fetch('/horizons?lat=' + site.lat + '&lon=' + site.lon + '&start=' + encodeURIComponent(new Date(now).toISOString().slice(0, 16)))
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j.error) { msg.textContent = 'Horizons could not be reached: ' + j.error; return; }
        var v = Ephem.look(site.lat, site.lon, now);
        msg.textContent = 'Horizons rows list azimuth then elevation, hourly from the selected time.';
        out.textContent = 'This tool at ' + fmtTime(now) + '\n  Sun   az ' + v.sun.az.toFixed(3) + '  el ' + v.sun.el.toFixed(3) +
          '\n  Earth az ' + v.earth.az.toFixed(3) + '  el ' + v.earth.el.toFixed(3) + '\n\nJPL Horizons, Sun\n' + j.sun + '\n\nJPL Horizons, Earth\n' + j.earth;
        out.hidden = false;
      })
      .catch(function () { msg.textContent = 'The local server did not answer. Start it with "python server.py".'; });
  });

  /* ---------- surface map ---------- */
  function surface(text) { $('stSurface').textContent = 'Surface: ' + text; }
  // NASA Moon Trek tiles of the LRO wide-angle camera mosaic, stitched into one map.
  function liveTiles(z) {
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
    surface('generated (no NASA map loaded)');
    if (typeof MOON_TEXTURE === 'string' && MOON_TEXTURE) {
      var img = new Image();
      img.onload = function () { if (Globe.setTexture(img)) surface((typeof MOON_TEXTURE_SOURCE === 'string' && MOON_TEXTURE_SOURCE) || 'NASA map'); else liveTiles(2); };
      img.onerror = function () { liveTiles(2); };
      img.src = MOON_TEXTURE;
    } else liveTiles(2);
  }

  /* ---------- start ---------- */
  var nTerrain = Object.keys(HZ).length;
  $('stHorizon').textContent = nTerrain ? 'Skyline: ' + HZ_SRC + ' at ' + nTerrain + ' sites' : 'Skyline: smooth sphere (run build_data.py for terrain)';
  $('stCursor').textContent = 'Cursor off the Moon';
  var ok = Globe.init($('globe'), {
    draw: placePins,
    hover: function (pt) { $('stCursor').textContent = pt ? 'Cursor ' + coord(pt.lat, pt.lon) : 'Cursor off the Moon'; },
    click: function () { if (state.site) back(); },
    pick: function (pt) {
      if (state.site) return;
      state.custom = { id: 'custom', name: 'Your spot', note: '', lat: +pt.lat.toFixed(2), lon: +pt.lon.toFixed(2) };
      select(state.custom);
    }
  });
  $('noGl').hidden = ok;
  if (ok) loadSurface();
  if (window.ResizeObserver) new ResizeObserver(function () { Globe.resize(); }).observe($('globeWrap'));
  window.addEventListener('resize', function () { Globe.resize(); });
  refresh();
})();
