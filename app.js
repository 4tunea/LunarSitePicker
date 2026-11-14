(function () {
  var HOURS = 708, SUN_THR = -0.266, EARTH_THR = 0, H = 3600000, MIN_WINDOW = 120, CAP = 336;
  var NS = 'http://www.w3.org/2000/svg';
  var $ = function (id) { return document.getElementById(id); };
  var state = { date: new Date().toISOString().slice(0, 10), site: null, hour: 0, tech: false, custom: null, home: null };
  var cache = { date: null, states: null, evals: {} }, ranked = { ok: [], no: [] }, pins = [], playing = null;

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
  function longDate() { return new Date(t0()).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }); }
  function deg(v) { return (v < 0 ? '−' : '') + Math.abs(v).toFixed(2) + '°'; }

  /* ---------- model ---------- */
  function prepare() {
    if (cache.date === state.date) return;
    var s = [], start = t0();
    for (var h = 0; h <= HOURS; h++) s.push(Ephem.state(start + h * H));
    cache = { date: state.date, states: s, evals: {} };
  }
  function evaluate(site) {
    prepare();
    var key = site.id + ':' + site.lat + ',' + site.lon;
    if (cache.evals[key]) return cache.evals[key];
    var e = { site: site, sunEl: [], sunAz: [], earthEl: [], earthAz: [] };
    var sun = 0, earth = 0, run = 0, best = 0, win = -1, sunrise = -1;
    for (var h = 0; h <= HOURS; h++) {
      var v = Ephem.at(cache.states[h], site.lat, site.lon);
      e.sunEl.push(v.sun.el); e.sunAz.push(v.sun.az); e.earthEl.push(v.earth.el); e.earthAz.push(v.earth.az);
      var a = v.sun.el > SUN_THR, b = v.earth.el > EARTH_THR;
      if (a) { sun++; if (sunrise < 0) sunrise = h; }
      if (b) earth++;
      run = a && b ? run + 1 : 0; if (run > best) best = run;
      if (win < 0 && !(a && b)) win = h;
    }
    e.sunPct = Math.round(100 * sun / (HOURS + 1)); e.earthPct = Math.round(100 * earth / (HOURS + 1));
    e.bothHours = Math.max(0, best - 1);
    e.whole = win < 0;
    e.window = e.whole ? HOURS : Math.max(0, win - 1);
    e.sunNow = e.sunEl[0] > SUN_THR; e.earthNow = e.earthEl[0] > EARTH_THR;
    e.score = Math.round(60 * Math.min(e.window, CAP) / CAP + 0.2 * e.sunPct + 0.2 * e.earthPct);
    e.ok = e.sunNow && e.earthNow && e.window >= MIN_WINDOW;
    if (e.ok) e.why = e.whole ? 'Sunlight and Earth contact for the whole lunar day' : dur(e.window) + ' of sunlight and Earth contact after landing';
    else if (e.earthPct === 0) e.why = 'Earth is never in view. Needs a relay satellite.';
    else if (!e.sunNow) e.why = sunrise < 0 ? 'The Sun stays down all lunar day.' : 'The Sun is down. Sunrise comes in ' + dur(sunrise) + '.';
    else if (!e.earthNow) e.why = 'Earth is out of view on this date.';
    else e.why = 'Only ' + dur(e.window) + ' of sunlight and Earth contact after landing.';
    cache.evals[key] = e;
    return e;
  }
  function rank() {
    var list = SITES.slice(); if (state.custom) list.push(state.custom);
    var all = list.map(evaluate).sort(function (a, b) { return b.score - a.score || b.bothHours - a.bothHours; });
    ranked = { ok: all.filter(function (e) { return e.ok; }), no: all.filter(function (e) { return !e.ok; }) };
    ranked.ok.forEach(function (e, i) { e.rank = i + 1; });
    ranked.no.forEach(function (e) { e.rank = 0; });
  }
  function nextChange(site, body, ms) {
    var thr = body === 'sun' ? SUN_THR : EARTH_THR;
    var up = function (t) { return Ephem.look(site.lat, site.lon, t)[body].el > thr; };
    var now = up(ms);
    for (var h = 1; h <= 720; h++) {
      if (up(ms + h * H) !== now) {
        var lo = ms + (h - 1) * H, hi = ms + h * H;
        while (hi - lo > 60000) { var mid = (lo + hi) / 2; if (up(mid) === now) lo = mid; else hi = mid; }
        return (hi - ms) / H;
      }
    }
    return null;
  }
  function runs(arr, thr) {
    var out = [], start = -1;
    for (var i = 0; i < arr.length; i++) {
      if (arr[i] > thr && start < 0) start = i;
      if ((arr[i] <= thr || i === arr.length - 1) && start >= 0) { out.push([start, arr[i] > thr ? i : i - 1]); start = -1; }
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
    meta.appendChild(html('span', 'score', '  Score ' + e.score + ', Sun ' + e.sunPct + '%, Earth ' + e.earthPct + '%'));
    b.appendChild(meta);
    b.addEventListener('click', function () { select(e.site); });
    li.appendChild(b);
    return li;
  }
  function renderList() {
    $('sideSub').textContent = ranked.ok.length + ' of ' + (ranked.ok.length + ranked.no.length) + ' sites suit a landing on ' + longDate() + '. Best first.';
    var a = $('rank'), b = $('notRank'); clear(a); clear(b);
    ranked.ok.forEach(function (e) { a.appendChild(listItem(e)); });
    ranked.no.forEach(function (e) { b.appendChild(listItem(e)); });
    if (!ranked.ok.length) a.appendChild(html('li', 'hint', 'No site suits this date. Try another day.'));
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
    var t = $('rankTable'); clear(t);
    var head = html('tr'); ['Site', 'Score', 'Both after landing', 'Sun', 'Earth'].forEach(function (h) { head.appendChild(html('th', '', h)); });
    t.appendChild(head);
    ranked.ok.concat(ranked.no).forEach(function (e) {
      var tr = html('tr', e.ok ? '' : 'no');
      [(e.rank ? e.rank + '. ' : '') + e.site.name, e.score, e.window ? dur(e.window) : 'None', e.sunPct + '%', e.earthPct + '%']
        .forEach(function (c) { tr.appendChild(html('td', '', String(c))); });
      t.appendChild(tr);
    });
  }

  /* ---------- site panel ---------- */
  function renderSky(e, v) {
    var svg = $('sky'); clear(svg);
    var W = 800, TOP = 16, BOT = 250;
    var peak = Math.max.apply(null, e.sunEl.concat(e.earthEl));
    var elMax = Math.min(90, Math.max(12, Math.ceil(peak + 6))), elMin = -Math.max(6, elMax * 0.3);
    var X = function (az) { return ((az + 180) % 360) / 360 * W; };
    var Y = function (a) { return TOP + (elMax - a) / (elMax - elMin) * (BOT - TOP); };
    for (var i = 0; i < 70; i++) {
      var r1 = Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1, r2 = Math.abs(Math.sin(i * 78.233) * 12543.123) % 1;
      svg.appendChild(el('circle', { cx: (r1 * W).toFixed(0), cy: (r2 * (Y(0) - 6)).toFixed(0), r: r1 > 0.8 ? 1.1 : 0.6, fill: '#8f9ac0', opacity: 0.6 }));
    }
    var step = elMax <= 20 ? 5 : elMax <= 50 ? 10 : 20;
    for (var g = step; g < elMax; g += step) {
      svg.appendChild(el('line', { x1: 0, x2: W, y1: Y(g), y2: Y(g), stroke: '#1d2548', 'stroke-width': 1 }));
      svg.appendChild(el('text', { x: 8, y: Y(g) - 4, fill: '#7d88ad', 'font-size': 11 }, g + '°'));
    }
    svg.appendChild(el('rect', { x: 0, y: Y(0), width: W, height: BOT - Y(0), fill: '#4a4e5c' }));
    svg.appendChild(el('line', { x1: 0, x2: W, y1: Y(0), y2: Y(0), stroke: '#b9bdc9', 'stroke-width': 1.5 }));
    [['South', 0], ['West', 200], ['North', 400], ['East', 600], ['South', 800]].forEach(function (c) {
      svg.appendChild(el('text', { x: c[1], y: BOT - 7, fill: '#d6d9e3', 'font-size': 12,
        'text-anchor': c[1] === 0 ? 'start' : c[1] === 800 ? 'end' : 'middle', dx: c[1] === 0 ? 8 : c[1] === 800 ? -8 : 0 }, c[0]));
    });
    function trace(az, elv, color) {
      var d = '', px = null;
      for (var j = 0; j < az.length; j++) {
        var x = X(az[j]), y = Y(Math.max(elMin, elv[j]));
        d += (px == null || Math.abs(x - px) > W / 2 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1); px = x;
      }
      svg.appendChild(el('path', { d: d, fill: 'none', stroke: color, 'stroke-width': 1.5, opacity: 0.4 }));
    }
    trace(e.sunAz, e.sunEl, '#f5c64f'); trace(e.earthAz, e.earthEl, '#6cb0ee');
    function body(p, up, color, r, name) {
      var x = X(p.az), y = Y(Math.max(elMin * 0.55, p.el)), a = { cx: x, cy: y, r: r };
      if (up) a.fill = color; else { a.fill = '#4a4e5c'; a.stroke = color; a['stroke-width'] = 1.5; a['stroke-dasharray'] = '3 3'; }
      svg.appendChild(el('circle', a));
      var right = x < W - 70;
      svg.appendChild(el('text', { x: x + (right ? r + 6 : -r - 6), y: y + 4, fill: color, 'font-size': 13, 'font-weight': 600, 'text-anchor': right ? 'start' : 'end' }, name));
    }
    body(v.earth, v.earth.el > EARTH_THR, '#6cb0ee', 12, 'Earth');
    body(v.sun, v.sun.el > SUN_THR, '#f5c64f', 7, 'Sun');
  }
  function renderStrips(e) {
    var svg = $('strips'); clear(svg);
    var k = 800 / HOURS;
    [[e.sunEl, SUN_THR, '#f5c64f', 2], [e.earthEl, EARTH_THR, '#6cb0ee', 27]].forEach(function (row) {
      svg.appendChild(el('rect', { x: 0, y: row[3], width: 800, height: 20, fill: '#222d54' }));
      runs(row[0], row[1]).forEach(function (r) {
        svg.appendChild(el('rect', { x: r[0] * k, y: row[3], width: Math.max(1, (r[1] - r[0]) * k), height: 20, fill: row[2] }));
      });
    });
    svg.appendChild(el('line', { x1: state.hour * k, x2: state.hour * k, y1: 0, y2: 50, stroke: '#fff', 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke' }));
  }
  function renderSiteTech(e, v, now) {
    $('siteTech').hidden = !state.tech;
    if (!state.tech) return;
    var s = v.state;
    rows($('techTable'), [
      ['Time', fmtTime(now)], ['Site', coord(e.site.lat, e.site.lon)],
      ['Sun elevation', deg(v.sun.el)], ['Sun azimuth', v.sun.az.toFixed(1) + '°'],
      ['Earth elevation', deg(v.earth.el)], ['Earth azimuth', v.earth.az.toFixed(1) + '°'],
      ['Highest Sun this lunar day', deg(Math.max.apply(null, e.sunEl))],
      ['Highest Earth this lunar day', deg(Math.max.apply(null, e.earthEl))],
      ['Sun overhead at', coord(s.subSun.lat, s.subSun.lon)], ['Earth overhead at', coord(s.subEarth.lat, s.subEarth.lon)],
      ['Earth distance', Math.round(s.dist).toLocaleString('en-US') + ' km'],
      ['Ranking score', e.score + ' of 100' + (e.rank ? ' (pick ' + e.rank + ')' : ' (not recommended)')],
      ['Sun and Earth after landing', e.window ? dur(e.window) : 'None']
    ]);
    var svg = $('elChart'); clear(svg);
    var L = 38, Rt = 470, T = 10, Bt = 195;
    var all = e.sunEl.concat(e.earthEl);
    var lo = Math.min(-2, Math.min.apply(null, all)), hi = Math.max(2, Math.max.apply(null, all));
    var pad = (hi - lo) * 0.06; lo -= pad; hi += pad;
    var X = function (h) { return L + h / HOURS * (Rt - L); }, Y = function (a) { return T + (hi - a) / (hi - lo) * (Bt - T); };
    var step = (hi - lo) > 80 ? 30 : (hi - lo) > 30 ? 10 : (hi - lo) > 10 ? 5 : 1;
    for (var g = Math.ceil(lo / step) * step; g <= hi; g += step) {
      svg.appendChild(el('line', { x1: L, x2: Rt, y1: Y(g), y2: Y(g), stroke: g === 0 ? '#b9bdc9' : '#2a3460', 'stroke-width': 1 }));
      svg.appendChild(el('text', { x: L - 6, y: Y(g) + 4, fill: '#a3acc8', 'font-size': 11, 'text-anchor': 'end' }, g + '°'));
    }
    for (var d = 0; d <= 28; d += 7) svg.appendChild(el('text', { x: X(d * 24), y: Bt + 16, fill: '#a3acc8', 'font-size': 11, 'text-anchor': d ? 'middle' : 'start' }, d ? '+' + d + ' d' : 'Landing'));
    [[e.sunEl, '#f5c64f', 'Sun'], [e.earthEl, '#6cb0ee', 'Earth']].forEach(function (row) {
      var pts = row[0].map(function (a, h) { return X(h).toFixed(1) + ',' + Y(a).toFixed(1); }).join(' ');
      svg.appendChild(el('polyline', { points: pts, fill: 'none', stroke: row[1], 'stroke-width': 2 }));
      svg.appendChild(el('text', { x: Rt + 6, y: Y(row[0][HOURS]) + 4, fill: row[1], 'font-size': 12, 'font-weight': 600 }, row[2]));
    });
    svg.appendChild(el('line', { x1: X(state.hour), x2: X(state.hour), y1: T, y2: Bt, stroke: '#fff', 'stroke-width': 1 }));
  }
  function renderSite() {
    var open = !!state.site;
    $('sitePanel').hidden = !open; $('stage').classList.toggle('insite', open);
    if (!open) return;
    var site = state.site, e = evaluate(site), now = t0() + state.hour * H;
    var v = Ephem.at(cache.states[state.hour], site.lat, site.lon);
    $('siteName').textContent = site.name;
    $('siteMeta').textContent = (site.note ? site.note + ', ' : '') + coord(site.lat, site.lon);
    var badge = $('badge');
    badge.className = 'badge' + (e.ok ? '' : ' no');
    badge.textContent = e.ok ? 'Pick ' + e.rank + ' of ' + ranked.ok.length + ' for ' + longDate() : 'Not recommended for ' + longDate();
    var sunUp = v.sun.el > SUN_THR, earthUp = v.earth.el > EARTH_THR;
    var ds = nextChange(site, 'sun', now), de = nextChange(site, 'earth', now), s, t;
    if (sunUp) s = ds == null ? 'The Sun is up and does not set in the next 30 days.' : 'The Sun is up. It sets in ' + dur(ds) + '.';
    else s = ds == null ? 'The Sun is down and does not rise in the next 30 days.' : 'The Sun is down. It rises in ' + dur(ds) + '.';
    if (earthUp) t = de == null ? 'Earth is in view and stays in view.' : 'Earth is in view. It sets in ' + dur(de) + '.';
    else t = de == null ? 'Earth never comes into view here. Talking to Earth needs a relay satellite.' : 'Earth is out of view. It rises in ' + dur(de) + '.';
    var box = $('verdict'); clear(box);
    box.appendChild(html('p', 's' + (sunUp ? '' : ' off'), s)); box.appendChild(html('p', 'e' + (earthUp ? '' : ' off'), t));
    var st = $('stats'); clear(st);
    [['Sunlight and Earth contact after landing', e.window ? dur(e.window) : 'None'], ['Lunar day in sunlight', e.sunPct + '%'],
     ['Lunar day with Earth in view', e.earthPct + '%']].forEach(function (r) {
      var d = html('div'); d.appendChild(html('span', '', r[0])); d.appendChild(html('b', '', r[1])); st.appendChild(d);
    });
    renderSky(e, v); renderStrips(e);
    $('clock').textContent = fmtTime(now) + (state.hour ? ', ' + dur(state.hour) + ' after landing' : '');
    $('scrub').value = state.hour;
    renderSiteTech(e, v, now);
  }

  /* ---------- flow ---------- */
  function refresh() {
    document.body.classList.toggle('tech', state.tech);
    prepare(); rank(); lightGlobe(); renderList(); renderPins(); renderMoonTech(); renderSite();
  }
  function tick() { lightGlobe(); renderPins(); renderSite(); }
  function stop() { if (playing) { clearInterval(playing); playing = null; $('play').textContent = 'Play'; } }
  function select(site) {
    stop();
    if (!state.site) state.home = Globe.view();
    state.site = site; state.hour = 0;
    refresh();
    Globe.flyTo(site.lon, site.lat, 1.5);
    $('sitePanel').scrollTop = 0;
  }
  function back() {
    stop(); state.site = null; state.hour = 0; refresh();
    var h = state.home || { lon: 15, lat: -40, dist: 4.2 };
    Globe.flyTo(h.lon, h.lat, Math.max(h.dist, 3));
  }
  function shiftDay(n) {
    var d = new Date(t0() + n * 86400000).toISOString().slice(0, 10);
    $('date').value = d; setDate(d);
  }
  function setDate(d) { stop(); state.date = d; state.hour = 0; refresh(); }

  $('date').addEventListener('change', function () { if (this.value) setDate(this.value); });
  $('prevDay').addEventListener('click', function () { shiftDay(-1); });
  $('nextDay').addEventListener('click', function () { shiftDay(1); });
  $('techToggle').addEventListener('change', function () { state.tech = this.checked; refresh(); });
  $('hideSide').addEventListener('click', function () { $('app').classList.add('noside'); $('showSide').hidden = false; });
  $('showSide').addEventListener('click', function () { $('app').classList.remove('noside'); $('showSide').hidden = true; });
  $('back').addEventListener('click', back);
  $('viewAll').addEventListener('click', function () { Globe.flyTo(15, -20, 4.2); });
  $('viewPole').addEventListener('click', function () { Globe.flyTo(0, -80, 2.4); });
  $('zoomIn').addEventListener('click', function () { Globe.zoom(0.8); });
  $('zoomOut').addEventListener('click', function () { Globe.zoom(1.25); });
  $('play').addEventListener('click', function () {
    if (playing) { stop(); return; }
    if (state.hour >= HOURS) state.hour = 0;
    $('play').textContent = 'Pause';
    playing = setInterval(function () { state.hour = Math.min(HOURS, state.hour + 3); tick(); if (state.hour >= HOURS) stop(); }, 60);
  });
  $('scrub').addEventListener('input', function () { stop(); state.hour = +this.value; tick(); });
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
        out.textContent = 'This page at ' + fmtTime(now) + '\n  Sun   az ' + v.sun.az.toFixed(3) + '  el ' + v.sun.el.toFixed(3) +
          '\n  Earth az ' + v.earth.az.toFixed(3) + '  el ' + v.earth.el.toFixed(3) + '\n\nJPL Horizons, Sun\n' + j.sun + '\n\nJPL Horizons, Earth\n' + j.earth;
        out.hidden = false;
      })
      .catch(function () { msg.textContent = 'The local server did not answer. Start it with "python server.py".'; });
  });

  $('date').value = state.date;
  if (window.innerWidth < 900) { $('app').classList.add('noside'); $('showSide').hidden = false; }
  var ok = Globe.init($('globe'), placePins, function (pt) {
    state.custom = { id: 'custom', name: 'Your spot', note: '', lat: +pt.lat.toFixed(2), lon: +pt.lon.toFixed(2) };
    select(state.custom);
  });
  $('noGl').hidden = ok;
  if (window.ResizeObserver) new ResizeObserver(function () { Globe.resize(); }).observe($('globeWrap'));
  window.addEventListener('resize', function () { Globe.resize(); });
  refresh();
})();
