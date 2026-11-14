#!/usr/bin/env node
/* End-to-end checks of the real app in a headless Chromium (Edge or Chrome). From the repo root:

     node web/tools/test_app.js              (set NAV_BROWSER=<path to msedge or chrome> if none is found)

   1. node --check on every JavaScript file the page loads and on the tools.
   2. Opens index.html (a temporary copy with a test script injected, deleted afterwards) and checks:
      - the six analysed sites' horizons and sample angles are unchanged (checksums below),
      - the demo numbers at Connecting Ridge: 2027-08-19 available, 2027-09-09 Earth down, next window,
      - no reference point (past landing or pin) is ranked among or above the analysed sites in the list,
        the compare table or the setup wizard, and the header counts the analysed sites on their own,
      - the badge and the 3D view use the same skyline for a sphere point (Apollo 11), a coarse point
        (IM-2 Athena) and a pin between 75 S and 80 S, and sphere points never say "behind terrain".
   Prints one line per check ("ok" / "FAIL") and exits 1 on any failure. Needs WebGL through SwiftShader,
   which headless Edge/Chrome provide. */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), { spawnSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');

// Fingerprint of web/data/navigator-data.js as built from git 645d65f (sum of all skyline bins; sum of every 97th
// Sun + Earth altitude), per site in file order. Regenerating the file must leave these six unchanged.
const EXPECTED_SUMS = [
  { id: 'connecting-ridge', hz: -2911.89, ae: -69.31 }, { id: 'shackleton-rim', hz: -2102.03, ae: -44.6 },
  { id: 'malapert-massif', hz: -3268.26, ae: 454.99 }, { id: 'haworth', hz: -2707.21, ae: 377.29 },
  { id: 'nobile-rim-2', hz: 34.51, ae: 377.74 }, { id: 'connecting-ridge-lower', hz: -1053.63, ae: -67.5 }];
const EXPECTED_NEXT_DAYS = 4;          // app rule: first later landing day (same hour) that works after 2027-09-09 = 2027-09-13

let fails = 0;
function check(name, ok, detail) { console.log((ok ? 'ok    ' : 'FAIL  ') + name + (detail ? '  [' + detail + ']' : '')); if (!ok) fails++; }

// ---- 1. syntax -------------------------------------------------------------------------------------------------
function listJs() {
  const out = [];
  const add = (dir, recurse) => {
    for (const f of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = path.posix.join(dir, f.name);
      if (f.isDirectory()) { if (recurse) add(rel, true); }
      else if (/\.js$/.test(f.name)) out.push(rel);
    }
  };
  // web/moonsky/dem and ephem hold about 1,750 generated data tiles: included only with --all-js (about 2 min)
  add('.', false); add('web', false); add('web/moonsky', process.argv.indexOf('--all-js') >= 0); add('web/tools', false); add('web/data', false);
  return out;
}
const jsFiles = listJs();
let synBad = [];
for (const f of jsFiles) { const r = spawnSync(process.execPath, ['--check', path.join(ROOT, f)], { encoding: 'utf8' }); if (r.status !== 0) synBad.push(f + ': ' + (r.stderr || '').split('\n')[0]); }
check('node --check on ' + jsFiles.length + ' JS files', synBad.length === 0, synBad.join('; '));

// ---- 2. the app in a headless browser ------------------------------------------------------------------------------
function findBrowser() {
  const c = [process.env.NAV_BROWSER,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'].filter(Boolean);
  return c.find(p => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } });
}

// Runs inside the page. Results go into <pre id="navTest"> as base64 JSON, read back from --dump-dom.
const PAGE = String.raw`
(function () {
  var out = { checks: {} }, S;
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function until(fn, ms) { var t0 = performance.now(); return new Promise(function (res, rej) { (function poll() { var v; try { v = fn(); } catch (e) {} if (v) return res(v); if (performance.now() - t0 > ms) return rej(new Error('timeout waiting')); setTimeout(poll, 100); })(); }); }
  function finish() { var p = document.createElement('pre'); p.id = 'navTest'; p.textContent = btoa(unescape(encodeURIComponent(JSON.stringify(out)))); document.body.appendChild(p); }
  function texts(sel, fn) { return Array.prototype.map.call(document.querySelectorAll(sel), fn || function (n) { return n.textContent; }); }
  async function run() {
    await until(function () { return window.NAV_DEBUG && NAV_DEBUG.started(); }, 90000);
    var D = NAV_DEBUG, N = NAV_DATA, T0 = Date.parse(N.time.start_utc), STEP = N.time.step_s * 1000, SPD = Math.round(86400000 / STEP);
    try { document.getElementById('wizSkip').click(); } catch (e) {}
    out.terState = D.terState();
    var sites = D.sites(), by = function (id) { return sites.filter(function (s) { return s.id === id; })[0]; };
    var kOf = function (iso) { return Math.round((Date.parse(iso) - T0) / STEP); }, m = 14 * SPD;
    out.sums = N.sites.map(function (s) { var t = 0, u = 0; s.horizons.forEach(function (h) { h.elev_deg.forEach(function (v) { t += v; }); }); for (var i = 0; i < s.sun.alt_deg.length; i += 97) u += s.sun.alt_deg[i] + s.earth.alt_deg[i]; return { id: s.id, hz: Math.round(t * 100) / 100, ae: Math.round(u * 100) / 100 }; });
    var cr = by('connecting-ridge'), kA = kOf('2027-08-19T00:00:00Z'), kB = kOf('2027-09-09T00:00:00Z');
    var a = D.status(cr, kA, m), b = D.status(cr, kB, m);
    out.demo = { aug19: a.ok, aug19why: a.why, sep9: b.ok, sep9why: b.why, next: D.nextWindow(cr, kB, m) };
    var planDay = Math.round(kA / SPD);
    D.setMission(planDay, 0, 14);
    var r = D.ranked();
    out.rank = { tiers: r.map(function (e) { return e.tier; }), head: document.getElementById('sideSub').textContent, analysed: r.filter(function (e) { return !e.tier; }).length,
      first: r.slice(0, 7).map(function (e) { return e.site.id; }), groups: texts('#rank li.grp'), listTags: texts('#rank .item .tag'),
      globeNumbers: texts('#pins .pin', function (p) { var nm = p.querySelector('.lbl').textContent, s = sites.filter(function (x) { return x.name === nm; })[0];
        return { num: p.firstChild && p.firstChild.nodeType === 3 ? p.firstChild.textContent : '', name: nm, tier: s ? D.tier(s) : -1 }; }) };
    out.nSites = N.sites.length;
    var ap = by('apollo-11'), bad = [];
    for (var k = 0; k + m < N.time.count; k += SPD) { var st = D.status(ap, k, m); if (/behind terrain/.test(st.why)) bad.push(st.why); }
    out.sphereWhy = { behind: bad.length, label: D.terrainLabel(ap), terrain: D.terrainOf(ap) };
    D.state.sel = [ap, cr]; D.state.cmpOpen = true; D.setMission(planDay, 0, 14);
    out.compare = { cols: texts('#cmpTable thead th', function (t) { return t.firstChild ? t.firstChild.textContent : ''; }).slice(1), win: (document.querySelector('#cmpWin h3') || {}).textContent || '',
      skyline: texts('#cmpTable tbody tr', function (tr) { return tr.firstChild.textContent === 'Skyline data' ? texts.call(null, 'td', null) && Array.prototype.map.call(tr.querySelectorAll('td'), function (td) { return td.textContent; }).join(' | ') : null; }).filter(Boolean)[0] };
    D.state.cmpOpen = false; D.state.sel = []; D.setMission(planDay, 0, 14);
    D.openWizard(); for (var i = 0; i < 3; i++) document.getElementById('wizNext').click();
    out.wizard = { tags: texts('.wlist label .tag'), groups: texts('.wlist li.grp'), labels: texts('.wlist .nm small.ter').slice(0, 8) };
    document.getElementById('wizNext').click();
    out.wizard.review = (document.querySelector('.wpreview') || {}).textContent || '';
    document.getElementById('wizClose').click();
    S = document.getElementById('surface');
    out.agree = [];
    async function agree(site, name) {
      var wrap = document.getElementById('globeWrap');
      D.setView('3d'); D.select(site);
      var res = { name: name, id: site.id, lat: site.lat, lon: site.lon, terrain: D.terrainOf(site), label: D.terrainLabel(site), complete: site.complete };
      try {
        await until(function () { return wrap.classList.contains('surface-on') || wrap.classList.contains('surface-error'); }, 150000);
        await sleep(800);
        res.error = wrap.classList.contains('surface-error') ? document.getElementById('slErr').textContent : null;
        var maxDiff = 0, azMax = 0;
        for (var az = 0; az < 360; az += 0.5) { var d = Math.abs(S.horizonAt(az) - D.skyline(site, az)); if (d > maxDiff) { maxDiff = d; azMax = az; } }
        res.maxDiffDeg = Math.round(maxDiff * 10000) / 10000; res.azMax = azMax;
        var k = D.state.plan * SPD + D.state.cur, v = D.vis(site);
        res.appFrac = v.frac[k]; res.appSunUp = !!v.sun[k]; res.appEarthUp = !!v.earth[k];
        res.viewFrac = S.state ? S.state.sunVis : null; res.viewEarthVis = S.state ? S.state.earthVis : null; res.viewSphere = S.sphere;
        res.sunLabel = (S.shadowRoot && S.shadowRoot.querySelector('.l.b.sun') || {}).textContent || '';
        res.earthLabel = (S.shadowRoot && S.shadowRoot.querySelector('.l.b.earth') || {}).textContent || '';
        res.badge = document.getElementById('badge').textContent; res.note = document.getElementById('surfNote').textContent;
        res.meta = document.getElementById('siteMeta').textContent; res.tiles = texts('#tiles .tile .ts').slice(0, 2);
      } catch (e) { res.error = String(e && e.message || e); }
      out.agree.push(res);
    }
    await agree(ap, 'sphere point, Apollo 11');
    await agree(by('im-2'), 'coarse point, IM-2 Athena');
    D.addPin(-77.5, 30);
    var pin = D.sites().filter(function (s) { return s.group === 'pin'; })[0];
    await agree(pin, 'pin at 77.5 S, 30 E');
    D.setView('2d'); D.select(ap);
    out.pano = { cap: document.getElementById('panoCap').textContent, dash: document.getElementById('panoDash').textContent, why: (document.getElementById('why') || {}).textContent || '' };
    D.addPin(0, 88);                                           // a sphere point with Earth near the horizon (libration branch of "why")
    var limb = D.sites().filter(function (s) { return s.group === 'pin'; }).slice(-1)[0];
    D.select(limb);
    out.limbWhy = { terrain: D.terrainOf(limb), why: (document.getElementById('why') || {}).textContent || '' };
  }
  run().catch(function (e) { out.fatal = String(e && e.stack || e); }).then(finish);
})();
`;

function runBrowser() {
  const browser = findBrowser();
  if (!browser) { check('headless browser found (set NAV_BROWSER)', false); return null; }
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  if (html.split('</body>').length !== 2) { check('index.html has one </body>', false); return null; }
  const tmpHtml = path.join(ROOT, '_test_app.tmp.html');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'navtest-'));
  fs.writeFileSync(tmpHtml, html.replace('</body>', '<script>' + PAGE + '</script></body>'));
  let dom = '';
  try {
    const url = 'file:///' + tmpHtml.replace(/\\/g, '/').replace(/^\//, '');
    const r = spawnSync(browser, ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1400,1000', '--virtual-time-budget=240000',
      '--user-data-dir=' + profile, '--no-first-run', '--dump-dom', url], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, timeout: 15 * 60 * 1000 });
    dom = r.stdout || '';
    if (r.error) check('browser run', false, String(r.error));
  } finally {
    try { fs.unlinkSync(tmpHtml); } catch (e) {}
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }
  const m = dom.match(/<pre id="navTest">([^<]*)<\/pre>/);
  if (!m) { check('test script produced a result (page loaded, NAV_DEBUG started)', false, 'no <pre id="navTest"> in the DOM dump'); return null; }
  return JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'));
}

const res = runBrowser();
if (res) {
  if (res.fatal) check('page script completed', false, res.fatal.split('\n')[0]);
  check('coarse terrain grid loaded (terState = ready)', res.terState === 'ready', res.terState);
  // data unchanged
  const sumsOk = res.sums && res.sums.length >= 6 && EXPECTED_SUMS.every((e, i) => res.sums[i] && res.sums[i].id === e.id && Math.abs(res.sums[i].hz - e.hz) < 0.011 && Math.abs(res.sums[i].ae - e.ae) < 0.011);
  check('six analysed sites unchanged (horizon + angle checksums, file order)', sumsOk, JSON.stringify(res.sums));
  // demo numbers
  const d = res.demo || {};
  check('Connecting Ridge available on 2027-08-19', d.aug19 === true, d.aug19why);
  check('Connecting Ridge not available on 2027-09-09, Earth down', d.sep9 === false && /^Earth is (below the horizon|behind terrain)/.test(d.sep9why || ''), d.sep9why);
  check('next window after 2027-09-09 is +' + EXPECTED_NEXT_DAYS + ' d (2027-09-13 by the app\'s day rule)', d.next === EXPECTED_NEXT_DAYS, 'got +' + d.next + ' d');
  // ranking
  const rk = res.rank || { tiers: [] };
  const monotone = rk.tiers.every((t, i) => i === 0 || t >= rk.tiers[i - 1]);
  const nA = res.nSites || 6;
  check('no reference point ranked among or above analysed sites (ranked[] tiers)', monotone && rk.analysed === nA, 'first: ' + (rk.first || []).join(', '));
  check('header counts analysed sites on their own', new RegExp('^\\d+ of ' + nA + ' analysed sites available').test(rk.head || '') && /Reference points: \d+ of \d+/.test(rk.head || ''), rk.head);
  const tags = rk.listTags || [], firstRef = tags.findIndex(t => t !== 'South pole');
  check('list: analysed group first, then reference points', (rk.groups || []).length === 2 && /^Analysed sites/.test(rk.groups[0]) && (firstRef < 0 || tags.slice(firstRef).every(t => t !== 'South pole')), (rk.groups || []).join(' / '));
  const nums = (rk.globeNumbers || []).filter(x => /^\d+$/.test(x.num));
  check('globe pins: rank numbers only on analysed sites', nums.length > 0 && nums.every(x => x.tier === 0), nums.map(x => x.num + ' ' + x.name).join(', '));
  // sphere wording
  const sw = res.sphereWhy || {};
  check('sphere point never says "behind terrain" (Apollo 11, every landing day)', sw.behind === 0 && sw.terrain === 'sphere', JSON.stringify(sw));
  // compare
  const cp = res.compare || {};
  check('compare: analysed column first, analysed site wins', (cp.cols || [])[0] === 'Connecting Ridge' && /^Better landing site: Connecting Ridge/.test(cp.win || ''), (cp.cols || []).join(' | ') + ' ; ' + cp.win);
  // wizard
  const wz = res.wizard || {};
  const wtags = wz.tags || [], wFirstRef = wtags.findIndex(t => t !== 'South pole');
  check('wizard list: analysed sites first, groups labelled', (wz.groups || []).length === 2 && /^Analysed sites/.test(wz.groups[0]) && (wFirstRef < 0 || wtags.slice(wFirstRef).every(t => t !== 'South pole')), (wz.groups || []).join(' / '));
  check('wizard list rows carry a terrain label', (wz.labels || []).length > 0 && wz.labels.every(l => /terrain horizon|coarse terrain|smooth sphere/.test(l)), (wz.labels || []).slice(0, 3).join(' | '));
  check('wizard review counts analysed sites on their own', new RegExp('of ' + nA + ' analysed sites are available').test(wz.review || '') && /Reference points: \d+ of \d+/.test(wz.review || ''), (wz.review || '').slice(0, 160));
  // badge vs 3D
  const want = { 'apollo-11': 'sphere', 'im-2': 'coarse' };
  for (const g of res.agree || []) {
    const exp = want[g.id] || 'coarse', tag = g.name + ' (' + g.terrain + ')';
    check(tag + ': 3D view built', !g.error, g.error);
    check(tag + ': terrain kind = ' + exp, g.terrain === exp, g.label);
    check(tag + ': 3D horizonAt == app skyline at every 0.5 deg', g.maxDiffDeg != null && g.maxDiffDeg < 0.01, 'max diff ' + g.maxDiffDeg + ' deg at az ' + g.azMax);
    check(tag + ': Sun disc fraction agrees (3D vs verdict)', g.viewFrac != null && Math.abs(g.viewFrac - g.appFrac) < 0.05 && (g.viewFrac >= 0.5) === g.appSunUp, '3D ' + (g.viewFrac == null ? 'null' : g.viewFrac.toFixed(3)) + ' vs app ' + (g.appFrac == null ? 'null' : g.appFrac.toFixed(3)));
    check(tag + ': badge, header and 3D note carry the label', (g.badge || '').indexOf(g.label) >= 0 && (g.meta || '').indexOf(g.label) >= 0 && (g.note || '').length > 0, g.note);
    if (exp === 'sphere') {
      check(tag + ': 3D note is the sphere sentence', g.note === 'No terrain data: smooth-sphere horizon. Landscape is illustrative.', g.note);
      check(tag + ': 3D labels never say "behind the skyline"', g.viewSphere === true && !/behind/.test(g.sunLabel + g.earthLabel), g.sunLabel + ' / ' + g.earthLabel);
      check(tag + ': tiles say smooth-sphere horizon', (g.tiles || []).every(t => /smooth-sphere horizon/.test(t)), (g.tiles || []).join(' | '));
    }
    if (g.id !== 'apollo-11' && g.id !== 'im-2') check(tag + ': labelled incomplete (grid edge within 150 km)', g.complete === false && /incomplete/.test(g.label), g.label);
    if (g.id === 'im-2') check(tag + ': complete coarse horizon', g.complete === true && !/incomplete/.test(g.label), g.label);
  }
  check('three badge-vs-3D cases ran', (res.agree || []).length === 3, String((res.agree || []).length));
  // 2D
  const pn = res.pano || {};
  check('2D view: caption carries the label, legend says "below the horizon" for a sphere point', /smooth sphere, no terrain/.test(pn.cap || '') && pn.dash === 'below the horizon', pn.cap + ' ; ' + pn.dash);
  check('"Why it works" never mentions local terrain for a sphere point (Apollo 11)', (pn.why || '').length > 0 && !/local terrain|terrain can cut/.test(pn.why || ''), (pn.why || '').slice(0, 120));
  const lw = res.limbWhy || {};
  check('"Why it works" for a sphere pin at 0 N, 88 E says no terrain data is used', lw.terrain === 'sphere' && /No terrain data is used/.test(lw.why || '') && !/local terrain|terrain can cut/.test(lw.why || ''), (lw.why || '').slice(-140));
}
console.log(fails ? '\n' + fails + ' check(s) FAILED' : '\nall checks passed');
process.exit(fails ? 1 : 0);
