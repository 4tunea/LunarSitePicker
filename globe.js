/* Dependency-free WebGL2 Moon: a ray-traced sphere lit from the real Sun direction.
   The surface comes from setTexture() (an equirectangular image or canvas, 0 deg
   longitude in the centre). Until one is set, a generated surface is drawn. */
var Globe = (function () {
  var RAD = Math.PI / 180, TANF = Math.tan(17.5 * RAD);
  var canvas, gl, prog, U = {}, raf = 0, anim = null, tex = null, cb = {};
  var cam = { lon: 15, lat: -40, dist: 4.2 };
  var opt = { sun: [1, 0, 0], earth: [1, 0, 0], grid: 0 }, hasTex = 0;
  var MARIA = [[33,-16,17],[28,17,10],[8,31,12],[17,59,7.5],[-8,51,9],[-15,35,5.5],[18,-57,22],
               [0,-45,14],[-21,-17,10],[-24,-39,6.5],[56,-20,7],[56,20,7],[-19,-93,4.5],[27,148,4.5]];

  var VS = '#version 300 es\nin vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
  var FS = [
    '#version 300 es', 'precision highp float;',
    'uniform vec2 uRes;uniform vec3 uCam,uRight,uUp,uFwd,uSun,uEarth;',
    'uniform float uTanF,uGrid,uHasTex;uniform vec4 uMaria[14];uniform sampler2D uTex;out vec4 o;',
    'float h1(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}',
    'vec3 h3(vec3 p){return fract(sin(vec3(dot(p,vec3(127.1,311.7,74.7)),dot(p,vec3(269.5,183.3,246.1)),dot(p,vec3(113.5,271.9,124.6))))*43758.5453);}',
    'float vn(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);',
    ' return mix(mix(mix(h1(i),h1(i+vec3(1,0,0)),f.x),mix(h1(i+vec3(0,1,0)),h1(i+vec3(1,1,0)),f.x),f.y),',
    '  mix(mix(h1(i+vec3(0,0,1)),h1(i+vec3(1,0,1)),f.x),mix(h1(i+vec3(0,1,1)),h1(i+vec3(1,1,1)),f.x),f.y),f.z);}',
    'float fbm(vec3 p){float a=.5,s=0.;for(int i=0;i<5;i++){s+=a*vn(p);p*=2.03;a*=.5;}return s;}',
    'vec2 craters(vec3 n,float f,vec3 sunT){vec3 p=n*f,ip=floor(p);float alb=0.,rel=0.;',
    ' for(int x=-1;x<=1;x++)for(int y=-1;y<=1;y++)for(int z=-1;z<=1;z++){',
    '  vec3 cell=ip+vec3(x,y,z);vec3 h=h3(cell);if(h.z<.45)continue;',
    '  float r=.14+.3*fract(h.x*7.31);vec3 v=p-(cell+.2+.6*h);float l=length(v),d=l/r;',
    '  if(d<1.3){alb+=-.08*smoothstep(1.,.5,d)+.09*smoothstep(.7,1.,d)*smoothstep(1.3,1.,d);',
    '   rel+=-dot(v/max(l,1e-4),sunT)*smoothstep(.15,.8,d)*smoothstep(1.1,.9,d);}}',
    ' return vec2(alb,rel);}',
    'void main(){',
    ' vec2 uv=(gl_FragCoord.xy*2.-uRes)/uRes.y;',
    ' vec3 rd=normalize(uFwd+uv.x*uTanF*uRight+uv.y*uTanF*uUp);',
    ' float b=dot(uCam,rd),c=dot(uCam,uCam)-1.,h=b*b-c;',
    ' vec3 bg=vec3(.027,.039,.086);',
    ' if(h<0.||b>0.){o=vec4(bg,1.);return;}',
    ' vec3 n=uCam+(-b-sqrt(h))*rd;',
    ' float lon=atan(n.y,n.x),lat=asin(clamp(n.z,-1.,1.));',
    ' float diff=max(dot(n,uSun),0.);vec3 sunT=normalize(uSun-n*dot(uSun,n)+1e-5);',
    ' float alb,rel=0.;',
    ' if(uHasTex>.5){vec3 t=texture(uTex,vec2(lon/6.2831853+.5,.5-lat/3.14159265)).rgb;alb=dot(t,vec3(.333))*1.05;}',
    ' else{alb=.6+.3*(fbm(n*3.)-.5)+.14*(fbm(n*13.)-.5);float mare=0.,w=.07*(fbm(n*6.)-.5);',
    '  for(int i=0;i<14;i++)mare=max(mare,smoothstep(uMaria[i].w-.02,uMaria[i].w+.03,dot(n,uMaria[i].xyz)+w));',
    '  alb*=mix(1.,.52,mare);vec2 c1=craters(n,7.,sunT),c2=craters(n,19.,sunT);',
    '  alb+=(c1.x+.6*c2.x)*mix(1.,.5,mare);rel=c1.y+.6*c2.y;}',
    ' float lit=pow(diff,.8)*clamp(1.+.9*rel*(1.-diff),.25,1.8);',
    ' vec3 col=alb*vec3(1.,.98,.94)*lit+alb*vec3(.035,.045,.075)*(1.+1.2*max(dot(n,uEarth),0.));',
    ' if(uGrid>.5){float a=degrees(lon)/30.,e=degrees(lat)/30.;',
    '  float g=min(abs(fract(a-.5)-.5)/fwidth(a),abs(fract(e-.5)-.5)/fwidth(e));',
    '  col=mix(col,vec3(.5,.68,.95),(1.-min(g,1.))*.4);}',
    ' col=mix(bg,col,smoothstep(0.,.004*dot(uCam,uCam),h));',
    ' o=vec4(col,1.);}'
  ].join('\n');

  function dir(lat, lon) { return [Math.cos(lat * RAD) * Math.cos(lon * RAD), Math.cos(lat * RAD) * Math.sin(lon * RAD), Math.sin(lat * RAD)]; }
  function basis() {
    var d = dir(cam.lat, cam.lon), f = [-d[0], -d[1], -d[2]], rl = Math.hypot(f[0], f[1]);
    var r = [f[1] / rl, -f[0] / rl, 0];
    var u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    return { c: [d[0] * cam.dist, d[1] * cam.dist, d[2] * cam.dist], f: f, r: r, u: u };
  }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

  function init(el, callbacks) {
    canvas = el; cb = callbacks;
    gl = canvas.getContext('webgl2', { antialias: false });
    if (gl) {
      var mk = function (type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
      try {
        prog = gl.createProgram(); gl.attachShader(prog, mk(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, FS));
        gl.linkProgram(prog); gl.useProgram(prog);
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        var loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        ['uRes','uCam','uRight','uUp','uFwd','uSun','uEarth','uTanF','uGrid','uHasTex','uMaria','uTex'].forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });
        var m = [];
        MARIA.forEach(function (a) { var d = dir(a[0], a[1]); m.push(d[0], d[1], d[2], Math.cos(a[2] * RAD)); });
        gl.uniform4fv(U.uMaria, new Float32Array(m));
      } catch (e) { gl = null; }
    }
    var drag = null, moved = 0;
    function local(ev) { var box = canvas.getBoundingClientRect(); return pick(ev.clientX - box.left, ev.clientY - box.top); }
    canvas.addEventListener('pointerdown', function (ev) { drag = { x: ev.clientX, y: ev.clientY }; moved = 0; anim = null; canvas.setPointerCapture(ev.pointerId); });
    canvas.addEventListener('pointermove', function (ev) {
      if (!drag) { if (cb.hover) cb.hover(local(ev)); return; }
      var dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
      moved += Math.abs(dx) + Math.abs(dy);
      if (moved < 4) return;
      var k = 150 / canvas.clientHeight * (cam.dist - 1) / 3.2;
      cam.lon -= dx * k; cam.lat = Math.max(-88, Math.min(88, cam.lat + dy * k));
      drag = { x: ev.clientX, y: ev.clientY }; request();
    });
    canvas.addEventListener('pointerup', function (ev) { if (drag && moved < 4 && cb.click) cb.click(local(ev)); drag = null; });
    canvas.addEventListener('pointercancel', function () { drag = null; });
    canvas.addEventListener('pointerleave', function () { if (cb.hover) cb.hover(null); });
    canvas.addEventListener('wheel', function (ev) { ev.preventDefault(); anim = null; zoom(Math.exp(ev.deltaY * 0.0012)); }, { passive: false });
    canvas.addEventListener('dblclick', function (ev) { var pt = local(ev); if (pt && cb.pick) cb.pick(pt); });
    resize();
    return !!gl;
  }
  function zoom(f) { cam.dist = Math.max(1.2, Math.min(6, cam.dist * f)); request(); }
  function resize() {
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    request();
  }
  function request() { if (!raf) raf = requestAnimationFrame(draw); }
  function draw(now) {
    raf = 0;
    if (anim) {
      var k = Math.min(1, (now - anim.t0) / anim.ms); if (!(k >= 0)) k = 0;
      var e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      cam.lon = anim.a.lon + anim.dlon * e; cam.lat = anim.a.lat + (anim.b.lat - anim.a.lat) * e;
      cam.dist = anim.a.dist + (anim.b.dist - anim.a.dist) * e;
      if (k >= 1) anim = null; else request();
    }
    if (gl) {
      var B = basis();
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(U.uRes, canvas.width, canvas.height);
      gl.uniform3fv(U.uCam, B.c); gl.uniform3fv(U.uRight, B.r); gl.uniform3fv(U.uUp, B.u); gl.uniform3fv(U.uFwd, B.f);
      gl.uniform3fv(U.uSun, opt.sun); gl.uniform3fv(U.uEarth, opt.earth);
      gl.uniform1f(U.uTanF, TANF); gl.uniform1f(U.uGrid, opt.grid ? 1 : 0); gl.uniform1f(U.uHasTex, hasTex);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    if (cb.draw) cb.draw();
  }
  // Screen position (CSS pixels) of a surface point, and whether it faces the camera.
  function project(lat, lon) {
    var B = basis(), p = dir(lat, lon), rel = [p[0] - B.c[0], p[1] - B.c[1], p[2] - B.c[2]];
    var z = dot(rel, B.f), w = canvas.clientWidth, h = canvas.clientHeight;
    return { x: w / 2 + dot(rel, B.r) / (z * TANF) * h / 2, y: h / 2 - dot(rel, B.u) / (z * TANF) * h / 2,
             visible: !!gl && dot(p, B.c) > 1.03 };
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
  function flyTo(lon, lat, dist) {
    var still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var dlon = ((lon - cam.lon + 540) % 360) - 180;
    anim = { a: { lon: cam.lon, lat: cam.lat, dist: cam.dist }, b: { lat: Math.max(-88, Math.min(88, lat)), dist: dist },
             dlon: dlon, t0: performance.now(), ms: still ? 1 : 900 };
    request();
  }
  // Use a real surface map. Returns false if the browser refuses the image (cross-origin).
  function setTexture(source) {
    if (!gl) return false;
    try {
      var t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, source);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      if (tex) gl.deleteTexture(tex);
      tex = t; hasTex = 1; request(); return true;
    } catch (e) { if (tex) gl.bindTexture(gl.TEXTURE_2D, tex); return false; }
  }
  function set(o) { for (var k in o) opt[k] = o[k]; request(); }
  function view() { return { lon: cam.lon, lat: cam.lat, dist: cam.dist }; }
  return { init: init, resize: resize, request: request, project: project, flyTo: flyTo, set: set, zoom: zoom, view: view, dir: dir, setTexture: setTexture };
})();
