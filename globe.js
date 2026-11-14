/* Dependency-free WebGL2 Moon: a ray-traced sphere lit from the real Sun direction, in front of a
   real star map.
   - Surface colour: setTexture() (equirectangular image or canvas, 0 deg longitude in the centre).
   - Relief: setRelief() takes slope maps built from NASA LOLA (web/tools/build_relief.py), so craters
     and massifs are lit by the real Sun (no baked-in shadows). A polar map takes over south of 80 S.
   - Zooming in loads sharper NASA Moon Trek imagery (LRO WAC mosaic tiles) for the area in view.
   - Stars: setStars() takes the Yale Bright Star Catalogue (ICRF); set({ starM }) orients it
     (Moon-fixed <- ICRF), so the background is the real sky behind the Moon.
   Until a texture is set, a generated surface is drawn. */
var Globe = (function () {
  var RAD = Math.PI / 180, TANF = Math.tan(17.5 * RAD), MIN_D = 1.004, MAX_D = 6;
  var canvas, gl, prog, sprog, U = {}, SU = {}, raf = 0, anim = null, tex = null, cb = {};
  var cam = { lon: 15, lat: -40, dist: 4.2 }, goal = { dist: 4.2 }, spin = null;
  var opt = { sun: [1, 0, 0], earth: [1, 0, 0], grid: 0, relief: 1.6, stars: true, lod: true,
              starM: [1, 0, 0, 0, 1, 0, 0, 0, 1] }, hasTex = 0;
  var relG = null, relP = null, relInfo = null, patchTex = null, patch = null, starBuf = null, nStars = 0;
  var baseLum = null;                                    // CPU copy of the colour map (luminance) to match tile brightness
  var MARIA = [[33,-16,17],[28,17,10],[8,31,12],[17,59,7.5],[-8,51,9],[-15,35,5.5],[18,-57,22],
               [0,-45,14],[-21,-17,10],[-24,-39,6.5],[56,-20,7],[56,20,7],[-19,-93,4.5],[27,148,4.5]];

  var VS = '#version 300 es\nin vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
  var FS = [
    '#version 300 es', 'precision highp float;',
    'uniform vec2 uRes;uniform vec3 uCam,uRight,uUp,uFwd,uSun,uEarth;',
    'uniform float uTanF,uGrid,uHasTex,uRelief,uHasRelG,uHasRelP,uRelGS,uRelPS,uPolH,uPatchOn,uPatchW,uPatchGain;',
    'uniform vec3 uPC,uPE,uPN;',
    'uniform vec4 uMaria[14];uniform sampler2D uTex,uRelG,uRelP,uPatch;out vec4 o;',
    'float h1(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}',
    'vec3 h3(vec3 p){return fract(sin(vec3(dot(p,vec3(127.1,311.7,74.7)),dot(p,vec3(269.5,183.3,246.1)),dot(p,vec3(113.5,271.9,124.6))))*43758.5453);}',
    'float vn(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);',
    ' return mix(mix(mix(h1(i),h1(i+vec3(1,0,0)),f.x),mix(h1(i+vec3(0,1,0)),h1(i+vec3(1,1,0)),f.x),f.y),',
    '  mix(mix(h1(i+vec3(0,0,1)),h1(i+vec3(1,0,1)),f.x),mix(h1(i+vec3(0,1,1)),h1(i+vec3(1,1,1)),f.x),f.y),f.z);}',
    'float fbm(vec3 p){float a=.5,s=0.;for(int i=0;i<5;i++){s+=a*vn(p);p*=2.03;a*=.5;}return s;}',
    'void main(){',
    ' vec2 uv=(gl_FragCoord.xy*2.-uRes)/uRes.y;',
    ' vec3 rd=normalize(uFwd+uv.x*uTanF*uRight+uv.y*uTanF*uUp);',
    ' float b=dot(uCam,rd),c=dot(uCam,uCam)-1.,h=b*b-c;',
    ' if(h<0.||b>0.)discard;',
    ' vec3 n=uCam+(-b-sqrt(h))*rd;',
    ' float lon=atan(n.y,n.x),lat=asin(clamp(n.z,-1.,1.));',
    ' vec2 tuv=vec2(lon/6.2831853+.5,.5-lat/3.14159265);',
    // seam-free derivatives: take the x-derivative from a copy of u whose seam is on the other side
    ' vec2 tu2=vec2(fract(tuv.x+.5),tuv.y),a1=dFdx(tuv),b1=dFdy(tuv),a2=dFdx(tu2),b2=dFdy(tu2);',
    ' vec2 gX=vec2(abs(a1.x)<abs(a2.x)?a1.x:a2.x,a1.y),gY=vec2(abs(b1.x)<abs(b2.x)?b1.x:b2.x,b1.y);',
    // albedo: colour map, sharper Moon Trek tiles where loaded, generated surface as the last resort
    ' float alb;',
    ' if(uHasTex>.5){vec3 t=textureGrad(uTex,tuv,gX,gY).rgb;alb=dot(t,vec3(.333))*1.05;}',
    ' else{alb=.6+.3*(fbm(n*3.)-.5)+.14*(fbm(n*13.)-.5);float mare=0.,w=.07*(fbm(n*6.)-.5);',
    '  for(int i=0;i<14;i++)mare=max(mare,smoothstep(uMaria[i].w-.02,uMaria[i].w+.03,dot(n,uMaria[i].xyz)+w));',
    '  alb*=mix(1.,.52,mare);}',
    ' if(uPatchOn>.5){float d=dot(n,uPC);if(d>.05){vec2 g=vec2(dot(n,uPE),dot(n,uPN))/d/uPatchW;float m=max(abs(g.x),abs(g.y));',
    '  if(m<1.){vec4 pt=texture(uPatch,g*.5+.5);alb=mix(alb,pt.r*uPatchGain,pt.a*(1.-smoothstep(.86,1.,m)));}}}',
    // relief: tilt the normal by the LOLA slopes (global map in east/north, polar map in its own grid)
    ' vec3 N=n;',
    ' vec3 ea=vec3(-sin(lon),cos(lon),0.),no=cross(n,ea);',
    ' vec2 gG=vec2(0.);',
    ' if(uHasRelG>.5)gG=(textureGrad(uRelG,tuv,gX,gY).rg*255.-128.)/127.*uRelGS;',
    ' vec3 tilt=gG.x*ea+gG.y*no;',
    ' if(uHasRelP>.5&&n.z<-.97){',
    '  vec2 ps=vec2(n.y,n.x)*2./(1.-n.z);vec2 pu=vec2(ps.x/uPolH*.5+.5,.5-ps.y/uPolH*.5);',
    '  if(max(abs(pu.x-.5),abs(pu.y-.5))<.5){',
    '   vec2 gP=(texture(uRelP,pu).rg*255.-128.)/127.*uRelPS;',
    '   vec3 tY=normalize(vec3(0.,1.,0.)-n*n.y),tX=normalize(vec3(1.,0.,0.)-n*n.x);',
    '   float wP=(1.-smoothstep(-80.,-79.2,degrees(lat)))*(1.-smoothstep(.47,.5,max(abs(pu.x-.5),abs(pu.y-.5))));',
    '   tilt=mix(tilt,gP.x*tY+gP.y*tX,wP);}}',
    ' N=normalize(n-tilt*uRelief);',
    ' float mu=dot(n,uSun),dif=max(dot(N,uSun),0.)*smoothstep(-.015,.03,mu);',
    ' float lit=pow(dif,.85);',
    ' vec3 col=alb*vec3(1.,.985,.96)*lit+alb*vec3(.03,.04,.065)*(1.+1.4*max(dot(N,uEarth),0.));',
    ' if(uGrid>.5){float a=degrees(lon)/30.,e=degrees(lat)/30.;',
    '  float gd=min(abs(fract(a-.5)-.5)/fwidth(a),abs(fract(e-.5)-.5)/fwidth(e));',
    '  col=mix(col,vec3(.62,.66,.78),(1.-min(gd,1.))*.35);}',
    ' o=vec4(col,smoothstep(0.,.004*dot(uCam,uCam),h));}'
  ].join('\n');

  // star points: Moon-fixed directions projected with the same camera as the sphere
  var SVS = ['#version 300 es',
    'in vec3 aD;in float aM;uniform mat3 uSM;uniform vec3 uR,uU,uF;uniform float uT,uAsp,uPx;out float vA;',
    'void main(){vec3 d=uSM*aD;float z=dot(d,uF);',
    ' if(z<=.01){gl_Position=vec4(2.,2.,2.,1.);gl_PointSize=0.;vA=0.;return;}',
    ' gl_Position=vec4(dot(d,uR)/z/uT/uAsp,dot(d,uU)/z/uT,0.,1.);',
    ' gl_PointSize=clamp(4.4-.6*aM,1.3,5.5)*uPx;vA=clamp(.38+.62*pow(10.,-.2*(aM-1.)),.3,1.);}'].join('\n');
  var SFS = ['#version 300 es', 'precision mediump float;in float vA;out vec4 o;',
    'void main(){vec2 c=gl_PointCoord-.5;float a=exp(-dot(c,c)*14.)*vA;if(a<.02)discard;o=vec4(vec3(.86,.9,1.)*a,1.);}'].join('\n');

  function dir(lat, lon) { return [Math.cos(lat * RAD) * Math.cos(lon * RAD), Math.cos(lat * RAD) * Math.sin(lon * RAD), Math.sin(lat * RAD)]; }
  function basis() {
    var d = dir(cam.lat, cam.lon), f = [-d[0], -d[1], -d[2]], rl = Math.hypot(f[0], f[1]);
    var r = [f[1] / rl, -f[0] / rl, 0];
    var u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    return { c: [d[0] * cam.dist, d[1] * cam.dist, d[2] * cam.dist], f: f, r: r, u: u };
  }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function norm(a) { var l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

  function mkProg(vs, fs, names, into) {
    var mk = function (type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    var p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    names.forEach(function (n) { into[n] = gl.getUniformLocation(p, n); });
    return p;
  }
  function init(el, callbacks) {
    canvas = el; cb = callbacks;
    gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
    if (gl) {
      try {
        prog = mkProg(VS, FS, ['uRes','uCam','uRight','uUp','uFwd','uSun','uEarth','uTanF','uGrid','uHasTex','uMaria','uTex',
          'uRelief','uHasRelG','uHasRelP','uRelGS','uRelPS','uPolH','uRelG','uRelP','uPatch','uPatchOn','uPatchW','uPatchGain','uPC','uPE','uPN'], U);
        sprog = mkProg(SVS, SFS, ['uSM','uR','uU','uF','uT','uAsp','uPx'], SU);
        gl.useProgram(prog);
        prog.buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, prog.buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        var m = [];
        MARIA.forEach(function (a) { var d = dir(a[0], a[1]); m.push(d[0], d[1], d[2], Math.cos(a[2] * RAD)); });
        gl.uniform4fv(U.uMaria, new Float32Array(m));
        gl.uniform1i(U.uTex, 0); gl.uniform1i(U.uRelG, 1); gl.uniform1i(U.uRelP, 2); gl.uniform1i(U.uPatch, 3);
      } catch (e) { console.warn('globe:', e); gl = null; }
    }
    // pointer: drag rotates (with a little inertia), wheel / pinch zooms smoothly, double-click picks
    var drag = null, moved = 0, ptrs = new Map(), pinch = 0;
    function local(ev) { var box = canvas.getBoundingClientRect(); return pick(ev.clientX - box.left, ev.clientY - box.top); }
    function rate() { return 150 / canvas.clientHeight * (cam.dist - 1) / 3.2; }
    canvas.addEventListener('pointerdown', function (ev) {
      ptrs.set(ev.pointerId, [ev.clientX, ev.clientY]);
      drag = { x: ev.clientX, y: ev.clientY, t: performance.now(), vx: 0, vy: 0 }; moved = 0; anim = null; spin = null;
      canvas.setPointerCapture(ev.pointerId);
    });
    canvas.addEventListener('pointermove', function (ev) {
      if (!drag) { if (cb.hover) cb.hover(local(ev)); return; }
      if (ptrs.has(ev.pointerId)) ptrs.set(ev.pointerId, [ev.clientX, ev.clientY]);
      if (ptrs.size === 2) {
        var pp = Array.from(ptrs.values()), d = Math.hypot(pp[0][0] - pp[1][0], pp[0][1] - pp[1][1]);
        if (pinch) zoomBy(pinch / d); pinch = d; moved = 99; return;
      }
      var dx = ev.clientX - drag.x, dy = ev.clientY - drag.y, now = performance.now(), dt = Math.max(1, now - drag.t);
      moved += Math.abs(dx) + Math.abs(dy);
      if (moved < 4) return;
      var k = rate();
      cam.lon -= dx * k; cam.lat = Math.max(-89.9, Math.min(89.9, cam.lat + dy * k));
      drag.vx = 0.7 * drag.vx + 0.3 * (-dx * k / dt); drag.vy = 0.7 * drag.vy + 0.3 * (dy * k / dt);
      drag.x = ev.clientX; drag.y = ev.clientY; drag.t = now; request();
    });
    function end(ev) {
      ptrs.delete(ev.pointerId); if (ptrs.size < 2) pinch = 0;
      if (!drag) return;
      if (ev.type === 'pointerup' && moved < 4 && cb.click) cb.click(local(ev));
      if (moved >= 4 && performance.now() - drag.t < 80 && Math.hypot(drag.vx, drag.vy) > 1e-4) { spin = { vx: drag.vx, vy: drag.vy, t: performance.now() }; request(); }
      if (!ptrs.size) drag = null;
    }
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('pointerleave', function () { if (cb.hover) cb.hover(null); });
    canvas.addEventListener('wheel', function (ev) {
      ev.preventDefault(); anim = null;
      var dy = ev.deltaMode === 1 ? ev.deltaY * 33 : ev.deltaY;
      zoomBy(Math.exp(Math.max(-300, Math.min(300, dy)) * 0.0015));
    }, { passive: false });
    canvas.addEventListener('dblclick', function (ev) { var pt = local(ev); if (pt && cb.pick) cb.pick(pt); });
    resize();
    return !!gl;
  }
  // Zoom works on the height above the surface, so steps feel the same far out and close in.
  function zoomBy(f) {
    var alt = Math.max(MIN_D - 1, (goal.dist || cam.dist) - 1) * f;
    goal.dist = Math.max(MIN_D, Math.min(MAX_D, 1 + alt)); request();
  }
  function zoom(f) { zoomBy(f); }
  function resize() {
    if (!canvas) return;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    request();
  }
  function request() { if (!raf) raf = requestAnimationFrame(draw); }
  var lodTimer = 0, lastView = '';
  function draw() {
    raf = 0;
    var now = performance.now(), more = false;
    if (anim) {
      var k = Math.min(1, (now - anim.t0) / anim.ms); if (!(k >= 0)) k = 0;   // same clock as t0
      var e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      cam.lon = anim.a.lon + anim.dlon * e; cam.lat = anim.a.lat + (anim.b.lat - anim.a.lat) * e;
      cam.dist = anim.a.dist + (anim.b.dist - anim.a.dist) * e; goal.dist = cam.dist;
      if (k >= 1) { var done = anim.done; anim = null; if (done) setTimeout(done, 0); } else more = true;
    } else {
      if (Math.abs(goal.dist - cam.dist) > 1e-5 * cam.dist) {                 // eased zoom
        cam.dist += (goal.dist - cam.dist) * 0.22; more = true;
      } else cam.dist = goal.dist;
      if (spin) {                                                               // drag inertia
        var dt = Math.min(50, now - spin.t); spin.t = now;
        cam.lon += spin.vx * dt; cam.lat = Math.max(-89.9, Math.min(89.9, cam.lat + spin.vy * dt));
        var fall = Math.pow(0.004, dt / 1000); spin.vx *= fall; spin.vy *= fall;
        if (Math.hypot(spin.vx, spin.vy) < 2e-6) spin = null; else more = true;
      }
    }
    if (more) request();
    if (gl) {
      var B = basis();
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0.012, 0.016, 0.027, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      if (opt.stars && nStars) {
        gl.useProgram(sprog); gl.blendFunc(gl.ONE, gl.ONE);
        gl.bindBuffer(gl.ARRAY_BUFFER, starBuf);
        var la = gl.getAttribLocation(sprog, 'aD'), lm = gl.getAttribLocation(sprog, 'aM');
        gl.enableVertexAttribArray(la); gl.vertexAttribPointer(la, 3, gl.FLOAT, false, 16, 0);
        gl.enableVertexAttribArray(lm); gl.vertexAttribPointer(lm, 1, gl.FLOAT, false, 16, 12);
        var M = opt.starM;                                                      // row-major -> GL column-major
        gl.uniformMatrix3fv(SU.uSM, false, [M[0], M[3], M[6], M[1], M[4], M[7], M[2], M[5], M[8]]);
        gl.uniform3fv(SU.uR, B.r); gl.uniform3fv(SU.uU, B.u); gl.uniform3fv(SU.uF, B.f);
        gl.uniform1f(SU.uT, TANF); gl.uniform1f(SU.uAsp, canvas.width / canvas.height);
        gl.uniform1f(SU.uPx, Math.min(2, window.devicePixelRatio || 1));
        gl.drawArrays(gl.POINTS, 0, nStars);
        gl.disableVertexAttribArray(la); gl.disableVertexAttribArray(lm);
      }
      gl.useProgram(prog); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindBuffer(gl.ARRAY_BUFFER, prog.buf);
      var loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      gl.uniform2f(U.uRes, canvas.width, canvas.height);
      gl.uniform3fv(U.uCam, B.c); gl.uniform3fv(U.uRight, B.r); gl.uniform3fv(U.uUp, B.u); gl.uniform3fv(U.uFwd, B.f);
      gl.uniform3fv(U.uSun, opt.sun); gl.uniform3fv(U.uEarth, opt.earth);
      gl.uniform1f(U.uTanF, TANF); gl.uniform1f(U.uGrid, opt.grid ? 1 : 0); gl.uniform1f(U.uHasTex, hasTex);
      gl.uniform1f(U.uRelief, opt.relief); gl.uniform1f(U.uHasRelG, relG ? 1 : 0); gl.uniform1f(U.uHasRelP, relP ? 1 : 0);
      if (relInfo) { gl.uniform1f(U.uRelGS, relInfo.global.scale); gl.uniform1f(U.uRelPS, relInfo.polar.scale); gl.uniform1f(U.uPolH, relInfo.polar.half_m / 1737400); }
      var pOn = !!(patch && opt.lod && patch.ready);
      gl.uniform1f(U.uPatchOn, pOn ? 1 : 0);
      if (pOn) { gl.uniform3fv(U.uPC, patch.c); gl.uniform3fv(U.uPE, patch.e); gl.uniform3fv(U.uPN, patch.n); gl.uniform1f(U.uPatchW, patch.w); gl.uniform1f(U.uPatchGain, patch.gain); }
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, relG);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, relP);
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, pOn ? patchTex : null);
      gl.activeTexture(gl.TEXTURE0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    if (cb.draw) cb.draw();
    var vk = cam.lon.toFixed(4) + cam.lat.toFixed(4) + cam.dist.toFixed(5) + canvas.width + 'x' + canvas.height;
    if (vk !== lastView) { lastView = vk; clearTimeout(lodTimer); lodTimer = setTimeout(lodUpdate, 350); }
  }
  // Screen position (CSS pixels) of a surface point, and whether it faces the camera.
  function project(lat, lon) {
    var B = basis(), p = dir(lat, lon), rel = [p[0] - B.c[0], p[1] - B.c[1], p[2] - B.c[2]];
    var z = dot(rel, B.f), w = canvas.clientWidth, h = canvas.clientHeight;
    return { x: w / 2 + dot(rel, B.r) / (z * TANF) * h / 2, y: h / 2 - dot(rel, B.u) / (z * TANF) * h / 2,
             visible: !!gl && z > 0 && dot(p, B.c) > 1.0005 };
  }
  function pick(x, y) {
    var B = basis(), w = canvas.clientWidth, h = canvas.clientHeight;
    var ux = (2 * x - w) / h * TANF, uy = (h - 2 * y) / h * TANF;
    var rd = [B.f[0] + ux * B.r[0] + uy * B.u[0], B.f[1] + ux * B.r[1] + uy * B.u[1], B.f[2] + ux * B.r[2] + uy * B.u[2]];
    var l = Math.hypot(rd[0], rd[1], rd[2]); rd = [rd[0] / l, rd[1] / l, rd[2] / l];
    var b = dot(B.c, rd), hh = b * b - (dot(B.c, B.c) - 1);
    if (hh < 0) return null;
    var t = -b - Math.sqrt(hh), n = [B.c[0] + t * rd[0], B.c[1] + t * rd[1], B.c[2] + t * rd[2]];
    return { lat: Math.asin(Math.max(-1, Math.min(1, n[2]))) / RAD, lon: Math.atan2(n[1], n[0]) / RAD };
  }
  // Animate the camera to look straight down on lon/lat from 'dist' Moon radii. 'done' runs when it arrives
  // (not if the user grabs the globe first). 'ms' overrides the default 900 ms.
  function flyTo(lon, lat, dist, done, ms) {
    var still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var dlon = ((lon - cam.lon + 540) % 360) - 180;
    spin = null;
    anim = { a: { lon: cam.lon, lat: cam.lat, dist: cam.dist }, b: { lat: Math.max(-89.9, Math.min(89.9, lat)), dist: dist },
             dlon: dlon, t0: performance.now(), ms: still ? 1 : ms || 900, done: done };
    request();
  }
  function texFrom(source, mip) {
    var t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (mip) { gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); }
    else { gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return t;
  }
  // Use a real surface map. Returns false if the browser refuses the image (cross-origin).
  function setTexture(source) {
    if (!gl) return false;
    try {
      var t = texFrom(source, true);
      if (tex) gl.deleteTexture(tex);
      tex = t; hasTex = 1;
      try {                                                                    // small luminance copy for tile matching
        var c = document.createElement('canvas'); c.width = 1024; c.height = 512;
        var x = c.getContext('2d'); x.drawImage(source, 0, 0, 1024, 512);
        var px = x.getImageData(0, 0, 1024, 512).data, L = new Float32Array(1024 * 512);
        for (var i = 0; i < L.length; i++) L[i] = (px[4 * i] + px[4 * i + 1] + px[4 * i + 2]) / 765;
        baseLum = L;
      } catch (e) { baseLum = null; }
      request(); return true;
    } catch (e) { if (tex) gl.bindTexture(gl.TEXTURE_2D, tex); return false; }
  }
  // Relief slope maps: { global: {scale}, polar: {scale, half_m} } plus the two decoded images.
  function setRelief(info, globalImg, polarImg) {
    if (!gl) return false;
    try {
      relInfo = info;
      if (globalImg) { gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE); relG = texFrom(globalImg, true); }
      if (polarImg) { relP = texFrom(polarImg, true); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); }
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL);
      request(); return true;
    } catch (e) { return false; }
  }
  // Stars: Float32Array of [x, y, z, magnitude] per star (unit ICRF directions).
  function setStars(arr) {
    if (!gl) return;
    starBuf = starBuf || gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, starBuf); gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
    nStars = arr.length / 4; request();
  }

  /* ---------- sharper imagery when zoomed in: NASA Moon Trek LRO WAC mosaic tiles ----------
     The area in view is resampled from equirectangular tiles into a gnomonic patch centred on the view,
     which works the same at the equator and at the poles. Tiles are cached; the patch is rebuilt after
     the view settles. Brightness is matched to the colour map. */
  var TREK = 'https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/default/default028mm/';
  var P = 1536, tiles = new Map(), lodSeq = 0, lodState = '', onLod = null;
  function tileKey(z, r, c) { return z + '/' + r + '/' + c; }
  function getTile(z, r, c) {
    var key = tileKey(z, r, c), t = tiles.get(key);
    if (t) return t.p;
    var p = new Promise(function (res) {
      var img = new Image(); img.crossOrigin = 'anonymous';
      img.onload = function () {
        try {
          var cv = document.createElement('canvas'); cv.width = cv.height = 256;
          var x = cv.getContext('2d'); x.drawImage(img, 0, 0);
          res(x.getImageData(0, 0, 256, 256).data);
        } catch (e) { res(null); }
      };
      img.onerror = function () { res(null); };
      img.src = TREK + key + '.jpg';
    });
    tiles.set(key, { p: p });
    if (tiles.size > 900) { var first = tiles.keys().next().value; tiles.delete(first); }
    return p;
  }
  function lodUpdate() {
    if (!gl || !opt.lod || !hasTex) return;
    var alt = cam.dist - 1;
    // The equirectangular mosaic is smeared near the poles; there the LOLA polar relief is sharper, so skip it.
    if (alt > 1.1 || Math.abs(cam.lat) > 72) { if (patch) { patch.ready = false; request(); } lodState = ''; if (onLod) onLod(null); return; }
    var c = dir(cam.lat, cam.lon);
    // angular radius of the surface in view (small-angle estimate, capped at the limb)
    var asp = canvas.clientWidth / Math.max(1, canvas.clientHeight);
    var rho = Math.min(Math.acos(1 / cam.dist) * 0.98, Math.atan(alt * TANF * Math.max(1, asp) * 1.15));
    rho = Math.max(rho, 0.0015);
    var w = Math.tan(rho), texel = 2 * rho / P, z = 3;
    while (z < 8 && Math.PI / (256 * Math.pow(2, z)) > texel * 1.15) z++;
    var e = Math.abs(c[2]) > 0.99999 ? [0, 1, 0] : norm(cross([0, 0, 1], c)), n = cross(c, e);
    function ll(u, v) { var p = norm([c[0] + (u * e[0] + v * n[0]) * w, c[1] + (u * e[1] + v * n[1]) * w, c[2] + (u * e[2] + v * n[2]) * w]);
      return [Math.asin(Math.max(-1, Math.min(1, p[2]))) / RAD, Math.atan2(p[1], p[0]) / RAD]; }
    function need(z) {
      var set = new Set(), cols = Math.pow(2, z + 1), rows = Math.pow(2, z);
      for (var i = 0; i <= 40; i++) for (var j = 0; j <= 40; j++) {
        var q = ll(i / 20 - 1, j / 20 - 1), r = Math.min(rows - 1, Math.floor((90 - q[0]) / 180 * rows)), cc = Math.floor((q[1] + 180) / 360 * cols) % cols;
        set.add(r * 4096 + cc);
      }
      return set;
    }
    var set = need(z);
    while (set.size > 72 && z > 3) { z--; set = need(z); }
    var key = z + ':' + c.map(function (v) { return v.toFixed(3); }).join(',') + ':' + w.toPrecision(2);
    if (key === lodState) return;
    if (patch && patch.ready && patch.z === z && dot(c, patch.c) > Math.cos(rho * 0.25) && w <= patch.w && w > patch.w * 0.6) return;
    lodState = key;
    var seq = ++lodSeq, list = Array.from(set);
    if (onLod) onLod({ loading: true, z: z, n: list.length });
    Promise.all(list.map(function (k) { return getTile(z, Math.floor(k / 4096), k % 4096); })).then(function (datas) {
      if (seq !== lodSeq) return;
      var map = new Map(); list.forEach(function (k, i) { map.set(k, datas[i]); });
      var ok = datas.filter(Boolean).length;
      if (!ok) { if (onLod) onLod({ error: true }); return; }
      var cols = Math.pow(2, z + 1), rows = Math.pow(2, z), out = new Uint8Array(P * P * 4), sumT = 0, sumB = 0, nS = 0;
      for (var y = 0; y < P; y++) {
        var v = (y + 0.5) / P * 2 - 1;
        for (var x = 0; x < P; x++) {
          var u = (x + 0.5) / P * 2 - 1;
          var px = c[0] + (u * e[0] + v * n[0]) * w, py = c[1] + (u * e[1] + v * n[1]) * w, pz = c[2] + (u * e[2] + v * n[2]) * w;
          var l = Math.sqrt(px * px + py * py + pz * pz), lat = Math.asin(pz / l) / RAD, lon = Math.atan2(py, px) / RAD;
          var fy = (90 - lat) / 180 * rows * 256, fx = (lon + 180) / 360 * cols * 256;
          var r = Math.min(rows - 1, Math.floor(fy / 256)), cc = Math.floor(fx / 256) % cols, d = map.get(r * 4096 + cc), o = 4 * (y * P + x);
          if (!d) continue;
          var iy = Math.min(255, Math.floor(fy - r * 256)), ix = Math.min(255, Math.floor(fx - Math.floor(fx / 256) * 256));
          var g = d[4 * (iy * 256 + ix)], fadeA = Math.max(0, Math.min(1, (75 - Math.abs(lat)) / 4));
          out[o] = out[o + 1] = out[o + 2] = g; out[o + 3] = Math.round(255 * fadeA);
          if (!fadeA) continue;
          if (baseLum && (x & 7) === 0 && (y & 7) === 0) {
            var bx = Math.min(1023, Math.floor((lon / 360 + 0.5) * 1024)), by = Math.min(511, Math.floor((0.5 - lat / 180) * 512));
            sumT += g / 255; sumB += baseLum[by * 1024 + bx] * 1.05; nS++;
          }
        }
      }
      if (!patchTex) patchTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, patchTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, P, P, 0, gl.RGBA, gl.UNSIGNED_BYTE, out);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      var gain = nS && sumT > 0 ? Math.max(0.5, Math.min(2.2, sumB / sumT)) : 1;
      patch = { c: c, e: e, n: n, w: w, z: z, gain: gain, ready: true };
      if (onLod) onLod({ z: z, n: list.length, ok: ok, mpp: Math.round(1737400 * Math.PI / (256 * Math.pow(2, z))) });
      request();
    });
  }

  function set(o) {
    var relod = 'lod' in o && o.lod !== opt.lod;
    for (var k in o) opt[k] = o[k];
    if (relod) { lodState = ''; if (opt.lod) lodUpdate(); else if (onLod) onLod(null); }
    request();
  }
  function view() { return { lon: cam.lon, lat: cam.lat, dist: cam.dist }; }
  return { init: init, resize: resize, request: request, project: project, flyTo: flyTo, set: set, zoom: zoom, view: view, dir: dir,
           setTexture: setTexture, setRelief: setRelief, setStars: setStars, onLod: function (f) { onLod = f; } };
})();
