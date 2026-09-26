/* =====================================================================
   GODSEYE — the whole planet, live, from your kitchen.

   A fullscreen 3D globe that knows where the sun actually is (real
   day/night terminator and city lights), what is flying over you (ADS-B,
   dead-reckoned between polls, with arcs to where each flight is really
   going), what is orbiting (SGP4-propagated satellites, the ISS and its
   next pass over you) and what just shook (USGS). Four sensor modes are
   shaders, not filters. Sound is synthesised; nothing is downloaded.

   Loads nothing heavy until it is opened: the render core (globe.gl,
   vendored in ./vendor) and SGP4 arrive during the boot log, which is a
   real log of those requests.

   Public API: window.GODSEYE.open(), .close(), .toggle(), .preload()
   Reads the homepage through window.OVERHEAD when it is present.
   ===================================================================== */
(function(){
"use strict";

var C = window.CONFIG || {};
var PROXY = (C.FLIGHT_PROXY || "").replace(/\/+$/, "");
var SCRIPT = document.currentScript;
var BASE = SCRIPT && SCRIPT.src ? SCRIPT.src.replace(/[^\/]*$/, "") : "godseye/";
var RAD = Math.PI / 180, R_KM = 6371, GR = 100;             /* globe.gl's radius */
var RANGE_NM = Math.max(20, Math.min(250, +C.GODSEYE_RADIUS_NM || 150));
var ALT_X = 7;                                               /* aircraft altitude exaggeration */
var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
var MODES = ["optic","holo","nvg","thermal"];
var MODE_LABEL = { optic:"Optic", holo:"Holo", nvg:"NVG", thermal:"Thermal" };
var ATMO = { optic:"#6fb4ff", holo:"#4de3ff", nvg:"#39ff14", thermal:"#ff6a1a" };
var ACC  = { optic:"#d8ff3e", holo:"#4de3ff", nvg:"#39ff14", thermal:"#ff8a1f" };

/* ---------------------------------------------------------------- utils */
function $(id){ return document.getElementById(id); }
function esc(s){
  return String(s == null ? "" : s).replace(/[&<>"]/g, function(c){
    return ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;" })[c];
  });
}
function pad(n){ return n < 10 ? "0" + n : "" + n; }
function clamp(v, a, b){ return v < a ? a : v > b ? b : v; }
function lerp(a, b, t){ return a + (b - a) * t; }
function ease(t){ return t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3) / 2; }
function fmt(n){ return Math.round(n).toLocaleString("en-GB"); }
function wrapLng(l){ return ((l + 540) % 360) - 180; }
function fmtLL(lat, lng){
  return Math.abs(lat).toFixed(2) + "°" + (lat >= 0 ? "N" : "S") + " " +
         Math.abs(lng).toFixed(2) + "°" + (lng >= 0 ? "E" : "W");
}
function compass(deg){
  var pts = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
  return pts[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}
function ago(ms){
  var s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 90) return s + "s ago";
  if (s < 5400) return Math.round(s / 60) + " min ago";
  return Math.round(s / 3600) + " h ago";
}
var LS = {
  get: function(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } },
  set: function(k, v){ try{ localStorage.setItem(k, v); }catch(e){} }
};

/* sphere maths, in globe.gl's own axes */
function xyz(lat, lng){
  var phi = (90 - lat) * RAD, th = (90 - lng) * RAD;
  return [Math.sin(phi) * Math.cos(th), Math.cos(phi), Math.sin(phi) * Math.sin(th)];
}
function toLL(v){
  var n = Math.hypot(v[0], v[1], v[2]) || 1;
  return { lat: 90 - Math.acos(clamp(v[1] / n, -1, 1)) / RAD, lng: wrapLng(90 - Math.atan2(v[2], v[0]) / RAD) };
}
function dot(a, b){ return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }
function slerp(a, b, t){
  var d = clamp(dot(a, b), -1, 1), w = Math.acos(d);
  if (w < 1e-5) return a;
  var s = Math.sin(w), ka = Math.sin((1 - t) * w) / s, kb = Math.sin(t * w) / s;
  return [a[0]*ka + b[0]*kb, a[1]*ka + b[1]*kb, a[2]*ka + b[2]*kb];
}
function arcRad(la1, lo1, la2, lo2){ return Math.acos(clamp(dot(xyz(la1, lo1), xyz(la2, lo2)), -1, 1)); }
function distKm(la1, lo1, la2, lo2){ return arcRad(la1, lo1, la2, lo2) * R_KM; }
function bearing(la1, lo1, la2, lo2){
  var p1 = la1 * RAD, p2 = la2 * RAD, dl = (lo2 - lo1) * RAD;
  var y = Math.sin(dl) * Math.cos(p2), x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(y, x) / RAD) + 360) % 360;
}

/* where the sun is directly overhead (same almanac as the hero sky) */
function subsolar(date){
  var d = date.getTime() / 86400000 - 10957.5;
  var L = 280.460 + 0.9856474 * d, g = (357.528 + 0.9856003 * d) * RAD;
  var lam = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * RAD;
  var eps = (23.439 - 0.0000004 * d) * RAD;
  var dec = Math.asin(Math.sin(eps) * Math.sin(lam));
  var ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam));
  var gmst = ((18.697374558 + 24.06570982441908 * d) % 24 + 24) % 24;
  return { lat: dec / RAD, lng: wrapLng(ra / RAD - gmst * 15) };
}
function sunAltAt(lat, lng, date){
  var s = subsolar(date || new Date());
  return 90 - arcRad(lat, lng, s.lat, s.lng) / RAD;
}

function fetchTimeout(url, ms, opts){
  if (typeof AbortController === "undefined") return fetch(url, opts);
  var ctrl = new AbortController(), t = setTimeout(function(){ ctrl.abort(); }, ms || 10000);
  var o = opts || {}; o.signal = ctrl.signal;
  return fetch(url, o).then(function(r){ clearTimeout(t); return r; }, function(e){ clearTimeout(t); throw e; });
}
function getJSON(url, ms){
  return fetchTimeout(url, ms).then(function(r){ if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); });
}
var scripts = {};
function loadScript(src){
  if (scripts[src]) return scripts[src];
  scripts[src] = new Promise(function(ok, fail){
    var s = document.createElement("script");
    s.src = src; s.async = true;
    s.onload = ok;
    s.onerror = function(){ delete scripts[src]; fail(new Error("could not load " + src.split("/").pop())); };
    document.head.appendChild(s);
  });
  return scripts[src];
}
function timeout(p, ms){
  return Promise.race([p, new Promise(function(_, no){ setTimeout(function(){ no(new Error("slow")); }, ms); })]);
}

/* the homepage's flight state, when we're on it */
function OH(){ return window.OVERHEAD || null; }
function home(){
  var oh = OH(), p = oh && oh.pos ? oh.pos() : null;
  if (p && isFinite(p.lat) && isFinite(p.lon)) return { lat: p.lat, lng: p.lon, label: p.label || "" };
  return { lat: +C.FALLBACK_LAT || 51.5072, lng: +C.FALLBACK_LON || -0.1276, label: C.FALLBACK_LABEL || "default" };
}

/* =====================================================================
   SOUND — Web Audio, synthesised on the spot. One master gain; muting
   is remembered. Everything is quiet by design: it's a room tone, not
   a soundtrack.
   ===================================================================== */
var SND = (function(){
  var ctx = null, master = null, drone = null, noiseBuf = null;
  var on = LS.get("home.ge.sound") !== "0";
  function init(){
    if (ctx) { if (ctx.state === "suspended") ctx.resume(); return; }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try{ ctx = new AC(); }catch(e){ return; }
    master = ctx.createGain();
    master.gain.value = on ? 0.55 : 0;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  function tone(f, dur, type, vol, when, slide){
    if (!ctx || !on) return;
    var t = ctx.currentTime + (when || 0);
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || "sine";
    o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.05, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.03);
  }
  function whoosh(dur, vol){
    if (!ctx || !on) return;
    var t = ctx.currentTime, src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noiseBuf; src.loop = true;
    f.type = "bandpass"; f.Q.value = 1.4;
    f.frequency.setValueAtTime(180, t);
    f.frequency.exponentialRampToValueAtTime(2400, t + dur * 0.55);
    f.frequency.exponentialRampToValueAtTime(260, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.09, t + dur * 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t); src.stop(t + dur + 0.05);
  }
  function startDrone(){
    if (!ctx || drone) return;
    var t = ctx.currentTime, out = ctx.createGain(), lp = ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 210; lp.Q.value = 3;
    var lfo = ctx.createOscillator(), lfoG = ctx.createGain();
    lfo.frequency.value = 0.06; lfoG.gain.value = 90;
    lfo.connect(lfoG); lfoG.connect(lp.frequency);
    var oscs = [[49, "sawtooth"], [49.37, "sawtooth"], [98.2, "sine"], [146.8, "sine"]].map(function(p){
      var o = ctx.createOscillator(); o.type = p[1]; o.frequency.value = p[0]; o.connect(lp); return o;
    });
    lp.connect(out); out.connect(master);
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(0.05, t + 3);
    oscs.forEach(function(o){ o.start(t); }); lfo.start(t);
    drone = { out: out, oscs: oscs.concat([lfo]) };
  }
  function stopDrone(){
    if (!ctx || !drone) return;
    var d = drone, t = ctx.currentTime;
    drone = null;
    d.out.gain.cancelScheduledValues(t);
    d.out.gain.setValueAtTime(Math.max(0.0001, d.out.gain.value), t);
    d.out.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
    d.oscs.forEach(function(o){ try{ o.stop(t + 0.9); }catch(e){} });
  }
  return {
    init: init, startDrone: startDrone, stopDrone: stopDrone, whoosh: whoosh,
    isOn: function(){ return on; },
    setOn: function(v){
      on = !!v; LS.set("home.ge.sound", on ? "1" : "0");
      if (master && ctx) master.gain.setTargetAtTime(on ? 0.55 : 0, ctx.currentTime, 0.05);
    },
    tick:  function(){ tone(2400 + Math.random() * 400, 0.018, "square", 0.012); },
    hover: function(){ tone(1320, 0.04, "sine", 0.018); },
    blip:  function(){ tone(880, 0.09, "sine", 0.05); tone(1760, 0.06, "sine", 0.02, 0.05); },
    ok:    function(){ tone(660, 0.05, "square", 0.02); tone(990, 0.07, "square", 0.02, 0.05); },
    ping:  function(){ tone(1180, 0.5, "sine", 0.03); },
    lock:  function(){ [0, 0.07, 0.14].forEach(function(w, i){ tone(740 * Math.pow(1.335, i), 0.1, "triangle", 0.05, w); }); tone(1980, 0.35, "sine", 0.03, 0.22); },
    mode:  function(){ tone(220, 0.25, "sawtooth", 0.03, 0, 880); },
    out:   function(){ tone(700, 0.3, "sine", 0.04, 0, 140); },
    party: function(){ [0,4,7,12,16,19,24].forEach(function(s, i){ tone(330 * Math.pow(2, s/12), 0.16, "square", 0.03, i * 0.07); }); }
  };
})();

/* =====================================================================
   STATE
   ===================================================================== */
var S = {
  built:false, open:false, booted:false, booting:false, failed:false,
  globe:null, mat:null, U:null, mode: MODES.indexOf(LS.get("home.ge.mode")) >= 0 ? LS.get("home.ge.mode") : "optic",
  filter:"all", aircraft:[], acIndex:{}, acFetchedAt:0, acSource:"",
  sats:[], iss:null, issStatic:null, orbitPath:[], nextPass:null,
  quakes:[], target:null, fly:null, follow:null, tour:null,
  lastInput: Date.now(), raf:0, timers:[], dirtyList:true, dirtyArcs:true,
  party:0, arcW:0.16
};

/* =====================================================================
   DOM
   ===================================================================== */
function build(){
  if (S.built) return;
  S.built = true;
  var root = document.createElement("div");
  root.id = "ge";
  root.className = "ge";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", "Godseye — live globe");
  root.setAttribute("aria-hidden", "true");
  root.setAttribute("data-mode", S.mode);
  root.tabIndex = -1;
  root.innerHTML =
    '<div class="ge-stage" id="geStage"></div>' +
    '<div class="ge-tags" id="geTags"></div>' +
    '<div class="ge-fx" aria-hidden="true"></div>' +
    '<div class="ge-frame" aria-hidden="true"><i></i><i></i><i></i><i></i></div>' +
    '<div class="ge-reticle" id="geReticle" aria-hidden="true"><i></i><i></i><i></i><i></i><b></b><span id="geRetLbl"></span></div>' +
    '<div class="ge-bars" aria-hidden="true"><div class="ge-bar-t"></div><div class="ge-bar-b"></div></div>' +

    '<header class="ge-top">' +
      '<div class="ge-brand"><span class="ge-eye"></span><b>Godseye</b><span class="ge-sub">live planet · home.alxsongs</span></div>' +
      '<div class="ge-tele">' +
        '<span>UTC <b id="geUtc">--:--:--</b></span>' +
        '<span class="ge-hide-s">LOCAL <b id="geLocal">--:--</b></span>' +
        '<span class="ge-hide-s">CAM <b id="geCam">—</b></span>' +
      '</div>' +
      '<button class="ge-x" id="geExit" title="Exit (Esc)">Exit <kbd>esc</kbd></button>' +
    '</header>' +

    '<aside class="ge-panel ge-left" id="geLeft" aria-label="Targets">' +
      '<div class="ge-ph"><span>Targets</span><b id="geCount">—</b></div>' +
      '<div class="ge-filters" id="geFilters" role="tablist">' +
        '<button data-f="all" class="on" role="tab">All</button>' +
        '<button data-f="air" role="tab">Air</button>' +
        '<button data-f="orbit" role="tab">Orbit</button>' +
        '<button data-f="seismic" role="tab">Seismic</button>' +
      '</div>' +
      '<div class="ge-list" id="geList"></div>' +
      '<div class="ge-radar" id="geRadarBox" title="Local radar — click a blip">' +
        '<canvas id="geRadar" width="220" height="220"></canvas>' +
        '<span class="ge-radar-l" id="geRadarL">' + RANGE_NM + ' nm</span>' +
      '</div>' +
    '</aside>' +

    '<aside class="ge-panel ge-right" id="geDossier" aria-live="polite"></aside>' +

    '<div class="ge-cap" id="geCap"><span class="ge-cap-k" id="geCapK"></span><span class="ge-cap-t" id="geCapT"></span><div class="ge-dots" id="geDots"></div></div>' +

    '<nav class="ge-dock" id="geDock" aria-label="Godseye controls">' +
      '<button class="ge-only-s" data-act="list" title="Targets">☰</button>' +
      '<span class="ge-modes" id="geModes">' +
        MODES.map(function(m, i){
          return '<button data-mode="' + m + '" title="' + MODE_LABEL[m] + ' (' + (i + 1) + ')"><kbd>' + (i + 1) + '</kbd>' + MODE_LABEL[m] + '</button>';
        }).join("") +
      '</span>' +
      '<span class="ge-sep"></span>' +
      '<button data-act="tour" id="geTourBtn" title="Cinematic tour (T)">▶ Tour</button>' +
      '<button data-act="home" title="Back home (H)">⌂</button>' +
      '<button data-act="space" title="Pull back to orbit (O)">◎</button>' +
      '<button data-act="sound" id="geSndBtn" title="Sound (M)">♪</button>' +
      '<button data-act="share" id="geShareBtn" title="Copy a link to this view">⎘</button>' +
      '<button data-act="help" title="Shortcuts (?)">?</button>' +
    '</nav>' +

    '<div class="ge-boot" id="geBoot"><div class="ge-boot-in"><div class="ge-boot-eye"></div><pre id="geLog"></pre></div></div>' +

    '<div class="ge-help" id="geHelp" hidden><div class="ge-help-in">' +
      '<h3>Godseye · controls</h3>' +
      '<dl>' +
        '<dt><kbd>drag</kbd> <kbd>scroll</kbd></dt><dd>spin and zoom the planet</dd>' +
        '<dt><kbd>click</kbd></dt><dd>lock onto anything: aircraft, satellites, quakes, the sun</dd>' +
        '<dt><kbd>T</kbd></dt><dd>cinematic tour (starts by itself if you leave it alone)</dd>' +
        '<dt><kbd>space</kbd> / <kbd>N</kbd></dt><dd>next target</dd>' +
        '<dt><kbd>1</kbd>–<kbd>4</kbd></dt><dd>optic · holo · night vision · thermal</dd>' +
        '<dt><kbd>H</kbd> <kbd>O</kbd></dt><dd>home · pull back to orbit</dd>' +
        '<dt><kbd>F</kbd></dt><dd>follow the locked target</dd>' +
        '<dt><kbd>M</kbd></dt><dd>sound on / off</dd>' +
        '<dt><kbd>esc</kbd> / <kbd>G</kbd></dt><dd>back to the homepage</dd>' +
      '</dl>' +
      '<p>Aircraft: live ADS-B within ' + RANGE_NM + ' nm, dead-reckoned between polls, altitude ×' + ALT_X + '. ' +
      'Satellites: CelesTrak elements, SGP4. Quakes: USGS, past 24 h. Terminator and city lights: computed for this second.</p>' +
      '<button class="ge-btn" data-act="help">Got it</button>' +
    '</div></div>';
  document.body.appendChild(root);
  S.root = root;

  paintModeButtons();
  paintSoundButton();

  $("geExit").addEventListener("click", close);
  $("geDock").addEventListener("click", function(e){
    var b = e.target.closest("button"); if (!b) return;
    if (b.hasAttribute("data-mode")) return setMode(b.getAttribute("data-mode"));
    act(b.getAttribute("data-act"));
  });
  $("geHelp").addEventListener("click", function(e){
    if (e.target === this || e.target.closest("[data-act=help]")) act("help");
  });
  $("geFilters").addEventListener("click", function(e){
    var b = e.target.closest("[data-f]"); if (!b) return;
    S.filter = b.getAttribute("data-f");
    [].forEach.call(this.children, function(x){ x.classList.toggle("on", x === b); });
    SND.blip();
    applyFilter();
  });
  $("geList").addEventListener("click", function(e){
    var b = e.target.closest("[data-t]"); if (!b) return;
    stopTour();
    select(parseT(b.getAttribute("data-t")), { fly:true });
    if (window.innerWidth < 760) S.root.classList.remove("list-open");
  });
  $("geList").addEventListener("pointerover", function(e){
    var b = e.target.closest("[data-t]");
    if (b && b !== S.lastHover){ S.lastHover = b; SND.hover(); }
  });
  $("geTags").addEventListener("click", function(e){
    var b = e.target.closest("[data-t]"); if (!b) return;
    e.stopPropagation();
    stopTour();
    select(parseT(b.getAttribute("data-t")), { fly:true });
  });
  $("geDossier").addEventListener("click", function(e){
    var b = e.target.closest("[data-act]"); if (!b) return;
    act(b.getAttribute("data-act"));
  });
  $("geRadar").addEventListener("click", radarClick);

  /* any real input resets the idle clock that starts the screensaver tour */
  ["pointerdown","wheel","keydown","touchstart"].forEach(function(ev){
    root.addEventListener(ev, function(){ S.lastInput = Date.now(); }, { passive:true });
  });
  /* a deep link opens without a click; audio may only start after one */
  root.addEventListener("pointerdown", function(){ SND.init(); }, { passive:true });
  $("geStage").addEventListener("pointerdown", function(){
    /* grabbing the planet takes the camera back from the autopilot */
    S.fly = null; S.follow = null;
    if (S.tour) stopTour();
    setAutoRotate(false);
  });
  window.addEventListener("resize", resize);
}

function paintModeButtons(){
  if (!S.root) return;
  S.root.setAttribute("data-mode", S.mode);
  [].forEach.call($("geModes").children, function(b){ b.classList.toggle("on", b.getAttribute("data-mode") === S.mode); });
}
function paintSoundButton(){
  var b = $("geSndBtn"); if (!b) return;
  b.classList.toggle("on", SND.isOn());
  b.textContent = SND.isOn() ? "♪" : "♪̸";
  b.setAttribute("aria-pressed", SND.isOn() ? "true" : "false");
}

/* =====================================================================
   BOOT LOG — honest: each line is a real request resolving
   ===================================================================== */
function logLine(label, promise, ms){
  var pre = $("geLog");
  var row = document.createElement("div");
  row.className = "ge-ln";
  var dots = new Array(Math.max(3, 26 - label.length)).join(".");
  row.innerHTML = '<span class="st">[ .. ]</span> ' + esc(label) + ' <span class="dd">' + dots + '</span> <span class="val"></span>';
  pre.appendChild(row);
  SND.tick();
  var st = row.querySelector(".st"), val = row.querySelector(".val");
  var spin = ["|","/","-","\\"], i = 0;
  var sp = setInterval(function(){ st.textContent = "[ " + spin[i++ % 4] + "  ]"; }, 90);
  function done(cls, text){
    clearInterval(sp);
    st.textContent = cls === "ok" ? "[ OK ]" : cls === "wait" ? "[ .. ]" : "[FAIL]";
    row.classList.add(cls);
    typeInto(val, text, 10);
    if (cls === "ok") SND.ok();
  }
  var p = ms ? timeout(promise, ms) : promise;
  return p.then(function(text){ done("ok", text); return true; }, function(e){
    if (e && e.message === "slow"){
      done("wait", "still listening…");
      promise.then(function(text){ row.className = "ge-ln ok"; st.textContent = "[ OK ]"; val.textContent = text; }, function(){});
      return true;
    }
    done("fail", (e && e.message) || "no answer");
    return false;
  });
}
function typeInto(el, text, speed, withSound){
  text = String(text || "");
  clearInterval(el._type);
  if (reduce || !speed){ el.textContent = text; return; }
  var i = 0;
  el.textContent = "";
  el._type = setInterval(function(){
    i += 1 + (text.length > 60 ? 1 : 0);
    el.textContent = text.slice(0, i);
    if (withSound && i % 3 === 0) SND.tick();
    if (i >= text.length) clearInterval(el._type);
  }, speed);
}

function boot(){
  S.booting = true;
  $("geBoot").classList.add("on");
  var pre = $("geLog"); pre.innerHTML = "";
  var h = home();
  var head = document.createElement("div");
  head.className = "ge-ln head";
  head.textContent = "GODSEYE // live planet — " + new Date().toISOString().replace("T", " ").slice(0, 19) + "Z";
  pre.appendChild(head);

  /* everything starts at once; the log reveals them in order */
  var pCore = loadScript(BASE + "vendor/globe.gl.min.js").then(initGlobe);
  var pSgp = loadScript(BASE + "vendor/satellite.min.js");
  var pAir = loadAircraft();
  var pOrb = pSgp.then(loadOrbits);
  var pQk = loadQuakes();
  var gap = function(ms){ return new Promise(function(r){ setTimeout(r, reduce ? 0 : ms); }); };

  gap(220)
    .then(function(){ return logLine("render core", pCore); })
    .then(function(ok){
      if (!ok){ fail(); throw new Error("stop"); }
      return gap(140).then(function(){ return logLine("uplink", Promise.resolve(fmtLL(h.lat, h.lng) + (h.label && h.label.indexOf("°") < 0 ? " · " + h.label : ""))); });
    })
    .then(function(){ return gap(140).then(function(){ return logLine("ads-b transponders", pAir, 2600); }); })
    .then(function(){ return gap(120).then(function(){ return logLine("orbital elements", pOrb, 2200); }); })
    .then(function(){ return gap(120).then(function(){ return logLine("seismic network", pQk, 1800); }); })
    .then(function(){
      var s = subsolar(new Date());
      return gap(120).then(function(){ return logLine("solar ephemeris", Promise.resolve("sun overhead " + fmtLL(s.lat, s.lng))); });
    })
    .then(function(){ return gap(260); })
    .then(function(){
      var fin = document.createElement("div");
      fin.className = "ge-ln fin";
      pre.appendChild(fin);
      typeInto(fin, "> handing you the planet", 26, true);
      return gap(900);
    })
    .then(reveal)
    .catch(function(e){ if (!e || e.message !== "stop") { console.error(e); fail(); } });
}
function fail(){
  S.failed = true; S.booting = false;
  var pre = $("geLog");
  var row = document.createElement("div");
  row.className = "ge-ln fail";
  row.innerHTML = "> this device won't draw the globe (WebGL is off or unsupported).<br>> the homepage has everything else. <button class='ge-btn' id='geFailX'>back</button>";
  pre.appendChild(row);
  $("geFailX").addEventListener("click", close);
}

function reveal(){
  S.booting = false; S.booted = true;
  var h = home();
  $("geBoot").classList.add("out");
  setTimeout(function(){ $("geBoot").classList.remove("on", "out"); }, 900);
  S.root.classList.add("live");
  applyFilter();
  /* start deep in space above the day side, then fall towards home */
  var s = subsolar(new Date());
  S.globe.pointOfView({ lat: lerp(s.lat, h.lat, 0.4), lng: wrapLng(h.lng + 70), altitude: 9 }, 0);
  SND.whoosh(3.4, 0.1);
  SND.startDrone();
  flyTo({ lat: h.lat - 8, lng: h.lng }, 1.9, 3600, function(){
    caption("Live", "Your planet, this second. Click anything to lock on — or press T for the tour.", true);
    setAutoRotate(true);
    applyHash();
    afterOpen();
  }, 0.6);
}
/* things asked for before the planet was ready: a tour, or overdrive */
function afterOpen(){
  if (S.pendingParty){ S.pendingParty = false; startParty(); }
  if (S.pendingTour){ S.pendingTour = false; setTimeout(startTour, S.target ? 0 : 900); }
}
function startParty(){
  S.party = Date.now() + 12000;
  stopTour(); deselect();
  var h = home();
  flyTo({ lat: h.lat - 10, lng: h.lng }, 2.6, 1600, function(){ setAutoRotate(true); });
  SND.party();
  caption("Overdrive", "↑↑↓↓←→←→BA — you found it. Hold on.", true);
}

/* =====================================================================
   GLOBE
   ===================================================================== */
/* The sky sphere is magnified a lot on screen, so the stars are drawn
   at single-texel size on a big canvas: pinpricks, not blobs. */
function starfield(){
  var W = 4096, H = 2048;
  var c = document.createElement("canvas"); c.width = W; c.height = H;
  var g = c.getContext("2d");
  g.fillStyle = "#010207"; g.fillRect(0, 0, W, H);
  var seed = 7;
  function rnd(){ seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
  /* a faint galactic band, then stars */
  var band = g.createLinearGradient(0, H * 0.3, 0, H * 0.7);
  band.addColorStop(0, "rgba(60,80,140,0)"); band.addColorStop(0.5, "rgba(70,90,150,.09)"); band.addColorStop(1, "rgba(60,80,140,0)");
  g.save(); g.translate(W / 2, H / 2); g.rotate(-0.35); g.translate(-W / 2, -H / 2); g.fillStyle = band; g.fillRect(-800, H * 0.3, W + 1600, H * 0.4); g.restore();
  for (var i = 0; i < 7000; i++){
    var x = rnd() * W, y = rnd() * H, big = rnd() < 0.02, a = 0.2 + Math.pow(rnd(), 1.6) * 0.8;
    var hue = rnd() < 0.12 ? "255,214,186" : rnd() < 0.25 ? "196,214,255" : "236,241,255";
    g.fillStyle = "rgba(" + hue + "," + a.toFixed(2) + ")";
    if (big){ g.beginPath(); g.arc(x, y, 1 + rnd() * 0.8, 0, Math.PI * 2); g.fill(); }
    else g.fillRect(x | 0, y | 0, 1, 1);
  }
  return c.toDataURL("image/jpeg", 0.9);
}

/* The shader. globe.gl hands us a MeshPhongMaterial; we keep its vertex
   work and replace the final colour with our own: real sun direction,
   night lights, ocean glint — or one of three sensor looks. */
var GE_VERT_HEAD = "varying vec3 vGeN;\nvarying vec3 vGeW;\n";
var GE_VERT_BODY = "\nvGeW = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvGeN = normalize(mat3(modelMatrix) * objectNormal);\n";
var GE_FRAG_HEAD = [
  "uniform sampler2D uNight; uniform sampler2D uWater;",
  "uniform vec3 uSun; uniform float uMode; uniform float uPrev; uniform float uBlend; uniform float uTime; uniform float uParty; uniform float uRows;",
  "varying vec3 vGeN; varying vec3 vGeW;",
  "float geHash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }",
  "vec3 geHeat(float t){ t = clamp(t, 0.0, 1.0);",
  "  vec3 c = mix(vec3(0.01,0.0,0.05), vec3(0.28,0.0,0.5), smoothstep(0.0,0.22,t));",
  "  c = mix(c, vec3(0.85,0.03,0.25), smoothstep(0.22,0.48,t));",
  "  c = mix(c, vec3(1.0,0.5,0.0), smoothstep(0.48,0.72,t));",
  "  return mix(c, vec3(1.0,1.0,0.75), smoothstep(0.72,1.0,t)); }",
  "vec3 geShade(float mode, vec3 dayC, vec3 nightC, float water, vec2 uv){",
  "  vec3 n = normalize(vGeN); vec3 v = normalize(cameraPosition - vGeW);",
  "  float d = dot(n, uSun); float day = smoothstep(-0.10, 0.16, d);",
  "  float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);",
  "  float lights = dot(nightC, vec3(0.3333));",
  "  vec3 lit = dayC * (0.06 + 1.18 * max(d, 0.0));",
  "  float spec = pow(max(dot(reflect(-uSun, n), v), 0.0), 55.0) * water * 0.9;",
  "  vec3 optic = mix(nightC * vec3(1.0,0.74,0.42) * 2.1 + dayC * 0.012, lit + spec * vec3(1.0,0.9,0.75), day);",
  "  optic += vec3(1.0,0.38,0.1) * exp(-pow(d / 0.055, 2.0)) * 0.09;",
  "  optic += vec3(0.28,0.56,1.0) * fres * (0.10 + 0.40 * day);",
  "  if (mode < 0.5) return optic;",
  "  if (mode < 1.5){",
  "    float rows = uRows; float ry = floor(uv.y * rows); float cy = (ry + 0.5) / rows;",
  "    float clat = (cy - 0.5) * 3.14159265; float cols = max(3.0, floor(rows * 2.0 * cos(clat)));",
  "    vec2 cuv = vec2((floor(uv.x * cols) + 0.5) / cols, cy);",
  "    vec2 f = vec2(fract(uv.x * cols) - 0.5, fract(uv.y * rows) - 0.5);",
  "    float land = step(texture2D(uWater, cuv).r, 0.5);",
  "    float dotm = smoothstep(0.36, 0.16, length(f)) * land;",
  "    float cl = dot(texture2D(uNight, cuv).rgb, vec3(0.3333));",
  "    vec3 c = vec3(0.002,0.012,0.03) + vec3(0.03,0.16,0.3) * fres * 1.6;",
  "    c += dotm * mix(vec3(0.02,0.18,0.3), vec3(0.2,0.85,1.0), day);",
  "    c += dotm * vec3(1.0,0.16,0.42) * smoothstep(0.06, 0.45, cl) * (1.0 - day) * 2.4;",
  "    float lon = uv.x * 360.0; float la = (uv.y - 0.5) * 180.0;",
  "    float gx = abs(fract(lon / 15.0 + 0.5) - 0.5) * 15.0; float gy = abs(fract(la / 15.0 + 0.5) - 0.5) * 15.0;",
  "    float gw = fwidth(lon) * 1.1 + 0.001;",
  "    float grid = max(1.0 - smoothstep(0.0, gw, gx), 1.0 - smoothstep(0.0, gw, gy));",
  "    c += vec3(0.05,0.35,0.5) * grid * 0.35;",
  "    float scan = mod(uTime * 9.0, 240.0) - 120.0;",
  "    c += vec3(0.75,1.0,0.2) * exp(-pow((la - scan) / 1.6, 2.0)) * (0.10 + dotm * 0.8);",
  "    c += vec3(0.75,1.0,0.2) * exp(-pow(d / 0.012, 2.0)) * 0.6;",
  "    return c;",
  "  }",
  "  float L = dot(optic, vec3(0.299,0.587,0.114));",
  "  if (mode < 2.5){",
  "    float g = pow(clamp(L * 3.2 + lights * 1.2, 0.0, 1.0), 0.7);",
  "    float nz = geHash(floor(gl_FragCoord.xy) + fract(uTime * 7.0) * 311.0) * 0.14;",
  "    float sl = 0.86 + 0.14 * sin(gl_FragCoord.y * 1.7);",
  "    return vec3(0.1,1.0,0.28) * (g * 0.9 + nz) * sl + vec3(0.1,0.7,0.2) * fres * 0.6;",
  "  }",
  "  float heat = mix(0.2, 0.46, 1.0 - water) * (0.3 + 0.7 * day) + max(d, 0.0) * 0.22 + lights * 1.5 * (1.0 - day) - abs(uv.y - 0.5) * 0.5;",
  "  return geHeat(heat) + vec3(0.55,0.08,0.35) * fres * 0.5;",
  "}",
  ""
].join("\n");
var GE_FRAG_BODY = [
  "#ifdef USE_MAP",
  "  vec2 geUv = vMapUv; vec3 geDay = texture2D(map, geUv).rgb;",
  "#else",
  "  vec2 geUv = vec2(0.5); vec3 geDay = vec3(0.0);",
  "#endif",
  "  vec3 geNight = texture2D(uNight, geUv).rgb; float geWater = texture2D(uWater, geUv).r;",
  "  vec3 geC = geShade(uMode, geDay, geNight, geWater, geUv);",
  "  if (uBlend < 0.999) geC = mix(geShade(uPrev, geDay, geNight, geWater, geUv), geC, uBlend);",
  "  if (uParty > 0.0){ vec3 rb = 0.5 + 0.5 * cos(6.2831 * (uTime * 0.35 + geUv.x * 2.0 + geUv.y + vec3(0.0, 0.33, 0.67)));",
  "    geC = mix(geC, rb * (0.25 + 1.6 * dot(geC, vec3(0.3, 0.59, 0.11))) + rb * 0.08, uParty); }",
  "  gl_FragColor = vec4(geC, diffuseColor.a);"
].join("\n");

function initGlobe(){
  if (S.globe) return "WebGL · ready";
  var probe = document.createElement("canvas");
  var gl2 = probe.getContext("webgl2");
  if (!gl2 && !probe.getContext("webgl")) throw new Error("WebGL unavailable");
  if (typeof window.Globe !== "function") throw new Error("render core missing");

  var stage = $("geStage");
  var G = new window.Globe(stage, {
    animateIn: false, waitForGlobeReady: false,
    rendererConfig: { antialias: true, alpha: false, powerPreference: "high-performance", preserveDrawingBuffer: false }
  });
  S.globe = G;
  G.width(window.innerWidth).height(window.innerHeight)
    .backgroundColor("#010207")
    .backgroundImageUrl(starfield())
    .globeImageUrl(BASE + "earth-day.jpg")
    .showAtmosphere(true).atmosphereColor(ATMO[S.mode]).atmosphereAltitude(0.2)
    .showGraticules(false);
  try{ G.renderer().setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); }catch(e){}

  var ctl = G.controls();
  ctl.enableDamping = true; ctl.dampingFactor = 0.08;
  ctl.minDistance = GR * 1.035; ctl.maxDistance = GR * 11;
  ctl.autoRotate = false; ctl.autoRotateSpeed = 0.35;
  ctl.zoomSpeed = 0.9;

  /* the uniforms our shader reads; shared objects so we can drive them */
  S.U = {
    uNight: { value: null }, uWater: { value: null }, uSun: { value: [1, 0, 0] },
    uMode: { value: MODES.indexOf(S.mode) }, uPrev: { value: MODES.indexOf(S.mode) },
    uBlend: { value: 1 }, uTime: { value: 0 }, uParty: { value: 0 }, uRows: { value: 160 }
  };
  patchMaterial();
  setupLayers();
  var s = subsolar(new Date()), v = xyz(s.lat, s.lng);
  S.U.uSun.value = v;
  G.pauseAnimation();
  return (gl2 ? "WebGL2" : "WebGL") + " · three r" + ((window.THREE && window.THREE.REVISION) || "186");
}

/* Wait for the day texture to land (it tells us the Texture class and the
   colour space), then hang the night lights and ocean mask beside it. */
function patchMaterial(){
  var mat = S.globe.globeMaterial();
  S.mat = mat;
  var night = new Image(), water = new Image(), left = 2;
  night.crossOrigin = water.crossOrigin = "anonymous";
  function go(){
    if (--left > 0) return;
    (function wait(){
      if (!mat.map || !mat.map.image) return setTimeout(wait, 60);
      var T = mat.map.constructor, aniso = 4;
      try{ aniso = S.globe.renderer().capabilities.getMaxAnisotropy(); }catch(e){}
      var tn = new T(night); tn.colorSpace = mat.map.colorSpace; tn.anisotropy = aniso; tn.needsUpdate = true;
      var tw = new T(water); tw.needsUpdate = true;
      mat.map.anisotropy = aniso; mat.map.needsUpdate = true;
      S.U.uNight.value = tn; S.U.uWater.value = tw;
      mat.onBeforeCompile = function(sh){
        Object.keys(S.U).forEach(function(k){ sh.uniforms[k] = S.U[k]; });
        sh.vertexShader = GE_VERT_HEAD + sh.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>" + GE_VERT_BODY);
        sh.fragmentShader = sh.fragmentShader
          .replace("#include <common>", "#include <common>\n" + GE_FRAG_HEAD)
          .replace("#include <opaque_fragment>", GE_FRAG_BODY);
      };
      mat.customProgramCacheKey = function(){ return "godseye-v1"; };
      mat.needsUpdate = true;
      S.shaderReady = true;
    })();
  }
  night.onload = water.onload = go;
  night.onerror = water.onerror = function(){ /* plain day texture is still a planet */ };
  night.src = BASE + "earth-night.jpg";
  water.src = BASE + "earth-water.jpg";
}

function setupLayers(){
  var G = S.globe;
  /* flight arcs: from where each flight left to where it's going */
  G.arcStartLat("sLat").arcStartLng("sLng").arcEndLat("eLat").arcEndLng("eLng")
    .arcColor(function(d){ return d.sel ? ["rgba(255,61,127,.35)", "rgba(255,61,127,1)"] : ["rgba(77,227,255,.08)", "rgba(216,255,62,.85)"]; })
    .arcStroke(function(d){ return S.arcW * (d.sel ? 2.6 : 1); })
    .arcAltitudeAutoScale(0.32)
    .arcDashLength(function(d){ return d.sel ? 0.5 : 0.28; }).arcDashGap(0.12)
    .arcDashInitialGap(function(d){ return d.gap; })
    .arcDashAnimateTime(function(d){ return d.sel ? 1800 : 3400; })
    .arcsTransitionDuration(reduce ? 0 : 900)
    .onArcClick(function(d){ stopTour(); select({ kind:"ac", id:d.hex }, { fly:true }); });

  /* rings: home beacon + quakes */
  G.ringLat("lat").ringLng("lng").ringAltitude(0.002)
    .ringMaxRadius("maxR").ringPropagationSpeed("speed").ringRepeatPeriod("period")
    .ringColor(function(d){ return function(t){ return "rgba(" + d.rgb + "," + (1 - t).toFixed(3) + ")"; }; });

  /* quake spikes */
  G.pointLat("lat").pointLng("lng").pointAltitude(function(q){ return 0.004 + Math.max(0, q.mag - 2) * 0.018; })
    .pointRadius(function(q){ return 0.06 + q.mag * 0.014; })
    .pointColor(function(q){ return q.mag >= 6 ? "#ff3d7f" : q.mag >= 4.5 ? "#ffb020" : "#ffd98a"; })
    .pointsMerge(false).pointsTransitionDuration(reduce ? 0 : 700)
    .onPointClick(function(q){ stopTour(); select({ kind:"quake", id:q.id }, { fly:true }); });

  /* satellite swarm */
  G.particlesList(function(d){ return d; })
    .particleLat("lat").particleLng("lng").particleAltitude("alt")
    .particlesSize(2.2).particlesSizeAttenuation(false)
    .particlesColor(function(){ return "rgba(170,236,255,.9)"; })
    .onParticleClick(function(p){ stopTour(); select({ kind:"sat", id:p.id }, { fly:true }); });

  /* the ISS's orbit */
  G.pathPoints("pts").pathPointLat(function(p){ return p[0]; }).pathPointLng(function(p){ return p[1]; })
    .pathPointAlt(function(p){ return p[2]; })
    .pathColor(function(){ return ["rgba(216,255,62,.05)", "rgba(216,255,62,.75)", "rgba(216,255,62,.05)"]; })
    .pathStroke(null).pathResolution(1).pathTransitionDuration(0)
    .pathDashLength(0.012).pathDashGap(0.006).pathDashAnimateTime(reduce ? 0 : 60000);
}

function resize(){
  if (!S.globe || !S.open) return;
  S.globe.width(window.innerWidth).height(window.innerHeight);
  sizeRadar();
}

function setAutoRotate(on){
  if (!S.globe) return;
  S.globe.controls().autoRotate = !!on && !reduce;
}

/* A flight with a shape: lift off, swing along the great circle, land.
   pointOfView's own tween is a straight lerp, which skims the surface. */
function flyTo(to, alt, ms, done, humpScale){
  if (!S.globe) return;
  var from = S.globe.pointOfView();
  var a = xyz(from.lat, from.lng), b = xyz(to.lat, to.lng);
  var ang = Math.acos(clamp(dot(a, b), -1, 1));
  var dur = ms || clamp(1300 + ang * 1500, 1300, 4200);
  if (reduce) dur = 1;
  var hump = Math.min(2.4, ang * 1.15) * (humpScale == null ? 1 : humpScale);
  if (Math.max(from.altitude, alt) > hump) hump *= 0.35;
  S.follow = null;
  setAutoRotate(false);
  S.fly = { a:a, b:b, a0:from.altitude, a1:alt, hump:hump, t0:performance.now(), dur:dur, done:done };
  if (ang > 0.35 && !reduce) SND.whoosh(Math.min(3, dur / 1000), 0.06);
}

/* =====================================================================
   DATA — aircraft
   ===================================================================== */
function typeName(a){
  var oh = OH();
  if (oh && oh.typeName) return oh.typeName(a);
  return a.desc || a.t || "Unknown type";
}
function cleanOp(s){ return s ? String(s).replace(/\s*\[[^\]]*\]\s*/g, "").trim() : null; }
function routes(){ var oh = OH(); return (oh && oh.routes) ? oh.routes() : {}; }
/* undefined = still asking, null = there is no published route */
function routeOf(ac){ return ac.call ? routes()[ac.call] : null; }

function loadAircraft(){
  var h = home(), la = h.lat.toFixed(4), lo = h.lng.toFixed(4);
  var urls = PROXY
    ? [PROXY + "?lat=" + la + "&lon=" + lo + "&dist=" + RANGE_NM]
    : ["https://api.adsb.lol/v2/lat/" + la + "/lon/" + lo + "/dist/" + RANGE_NM,
       "https://opendata.adsb.fi/api/v3/lat/" + la + "/lon/" + lo + "/dist/" + RANGE_NM];
  var i = 0;
  function next(){
    if (i >= urls.length) return Promise.reject(new Error(PROXY ? "flight worker unreachable" : "no feed (set FLIGHT_PROXY)"));
    var u = urls[i++];
    return fetchTimeout(u, 12000).then(function(r){
      if (!r.ok) throw new Error("HTTP " + r.status);
      var src = null; try{ src = r.headers.get("X-Source"); }catch(e){}
      return r.json().then(function(j){ S.acSource = src || u.split("/")[2]; return j; });
    }).catch(next);
  }
  /* seed from the homepage so the planet isn't empty while we ask */
  var oh = OH();
  if (!S.aircraft.length && oh && oh.aircraft) ingest({ ac: oh.aircraft() }, true);
  return next().then(function(j){
    ingest(j, false);
    var air = S.aircraft.filter(function(a){ return !a.ground; }).length;
    return air + " airborne · " + (S.aircraft.length - air) + " on the ground · ≤" + RANGE_NM + " nm";
  });
}

function ingest(j, seeded){
  var now = Date.now(), seen = {}, h = home();
  (j.ac || []).forEach(function(r){
    if (typeof r.lat !== "number" || typeof r.lon !== "number" || !r.hex) return;
    if (r.t === "TWR" || r.t === "GND") return;
    var a = S.acIndex[r.hex];
    if (!a){ a = S.acIndex[r.hex] = { hex: r.hex, trail: [] }; S.dirtyArcs = true; }
    var age = (typeof r.seen_pos === "number" ? r.seen_pos : 0) * 1000;
    a.raw = r;
    a.call = (r.flight || "").trim();
    a.label = a.call || r.r || r.hex.toUpperCase();
    a.lat0 = r.lat; a.lon0 = r.lon; a.t0 = now - age;
    a.ground = r.alt_baro === "ground";
    a.altFt = typeof r.alt_baro === "number" ? r.alt_baro : (typeof r.alt_geom === "number" ? r.alt_geom : 0);
    a.gs = typeof r.gs === "number" ? r.gs : 0;
    a.trk = typeof r.track === "number" ? r.track : (typeof r.true_heading === "number" ? r.true_heading : 0);
    a.vs = typeof r.baro_rate === "number" ? r.baro_rate : (typeof r.geom_rate === "number" ? r.geom_rate : null);
    a.sq = r.squawk || null; a.reg = r.r || null; a.type = typeName(r); a.op = cleanOp(r.ownOp);
    a.emerg = /^(7500|7600|7700)$/.test(a.sq || "");
    a.dist = distKm(h.lat, h.lng, r.lat, r.lon) / 1.852;
    a.trail.push([r.lat, r.lon]);
    if (a.trail.length > 30) a.trail.shift();
    seen[r.hex] = true;
  });
  if (!seeded){
    Object.keys(S.acIndex).forEach(function(k){
      if (!seen[k]){
        dropTag("ac:" + k);
        delete S.acIndex[k];
        S.dirtyArcs = true;
      }
    });
    S.acFetchedAt = now;
  }
  S.aircraft = Object.keys(S.acIndex).map(function(k){ return S.acIndex[k]; })
    .sort(function(a, b){ return a.dist - b.dist; });
  S.dirtyList = true;
  var oh = OH();
  if (oh && oh.fetchRoutes) oh.fetchRoutes(S.aircraft.filter(function(a){ return a.call && !a.ground; }).map(function(a){ return a.raw; }), 36);
}

/* dead reckoning: where it is now, not where it was at the last poll */
function acPos(a, now){
  var dt = Math.min(90, Math.max(0, ((now || Date.now()) - a.t0) / 1000));
  if (a.ground || !a.gs) return { lat: a.lat0, lng: a.lon0 };
  var dNm = a.gs * dt / 3600;
  var lat = a.lat0 + (dNm * Math.cos(a.trk * RAD)) / 60;
  var lng = a.lon0 + (dNm * Math.sin(a.trk * RAD)) / (60 * Math.max(0.2, Math.cos(a.lat0 * RAD)));
  return { lat: lat, lng: wrapLng(lng) };
}
function acAlt(a){ return a.ground ? 0.0015 : 0.002 + (a.altFt * 0.0003048 / R_KM) * ALT_X; }

/* =====================================================================
   DATA — orbit (CelesTrak → wheretheiss → the Worker's /space)
   ===================================================================== */
var TLE_KEY = "home.ge.tle.v1";
function parseTLE(txt){
  var lines = String(txt || "").split(/\r?\n/).map(function(l){ return l.replace(/\s+$/, ""); }).filter(Boolean);
  var out = [];
  for (var i = 0; i + 2 < lines.length + 1; i++){
    if (lines[i + 1] && lines[i + 1].charAt(0) === "1" && lines[i + 2] && lines[i + 2].charAt(0) === "2"){
      out.push({ name: lines[i].trim(), l1: lines[i + 1], l2: lines[i + 2] });
      i += 2;
    }
  }
  return out;
}
function prettySat(n){
  var s = n.replace(/\s+/g, " ").trim();
  if (/^ISS\b/.test(s)) return "ISS";
  if (/CSS \(TIANHE\)|TIANHE/.test(s)) return "Tiangong";
  if (/^HST$/.test(s)) return "Hubble";
  return s;
}
function loadOrbits(){
  var sat = window.satellite;
  if (!sat) throw new Error("SGP4 missing");
  var cached = null;
  try{ cached = JSON.parse(LS.get(TLE_KEY) || "null"); }catch(e){}
  var fresh = cached && cached.at && (Date.now() - cached.at) < 6 * 3600e3 && cached.list && cached.list.length;
  var p = fresh ? Promise.resolve(cached.list) :
    fetchTimeout("https://celestrak.org/NORAD/elements/gp.php?GROUP=visual&FORMAT=tle", 9000)
      .then(function(r){ if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
      .then(function(t){
        var list = parseTLE(t);
        if (list.length < 5) throw new Error("empty");
        LS.set(TLE_KEY, JSON.stringify({ at: Date.now(), list: list }));
        return list;
      })
      .catch(function(){
        if (cached && cached.list && cached.list.length) return cached.list;      /* stale beats nothing */
        return getJSON("https://api.wheretheiss.at/v1/satellites/25544/tles", 8000).then(function(j){
          return [{ name: "ISS (ZARYA)", l1: j.line1, l2: j.line2 }];
        });
      });
  return p.then(function(list){
    S.sats = [];
    list.forEach(function(t){
      try{
        var rec = sat.twoline2satrec(t.l1, t.l2);
        var id = t.l1.substr(2, 5).trim();
        var o = { id: id, name: prettySat(t.name), rec: rec, lat: 0, lng: 0, alt: 0, km: 0, kmh: 0 };
        if (!propagate(o, new Date())) return;
        S.sats.push(o);
        if (id === "25544") S.iss = o;
      }catch(e){}
    });
    if (!S.sats.length) throw new Error("no usable elements");
    if (S.iss){ buildOrbitPath(); setTimeout(computeNextPass, 400); }
    S.dirtyList = true;
    applyFilter();
    return S.sats.length + " objects" + (S.iss ? " · ISS " + Math.round(S.iss.km) + " km" : "");
  }).catch(function(){
    /* last resort: the Worker's static ISS fix */
    if (!PROXY) throw new Error("unreachable");
    return getJSON(PROXY + "/space", 8000).then(function(j){
      if (j.iss && isFinite(j.iss.lat)){
        S.issStatic = { id: "25544", name: "ISS", lat: j.iss.lat, lng: j.iss.lon, km: j.iss.alt || 408,
          alt: (j.iss.alt || 408) / R_KM, kmh: j.iss.vel || 27600, static: true };
        S.sats = [S.issStatic]; S.iss = S.issStatic;
      }
      if (!S.quakes.length && j.quakes) setQuakes(j.quakes.map(function(q, i){
        return { id: "w" + i, lat: q.lat, lng: q.lon, mag: q.mag, place: q.place, time: q.time || null, depth: q.depth || null };
      }));
      if (!S.iss) throw new Error("unreachable");
      return "ISS (position only)";
    });
  });
}
function propagate(o, date){
  var sat = window.satellite;
  if (!sat || !o.rec) return !!o.static;
  var pv = sat.propagate(o.rec, date);
  if (!pv || !pv.position || typeof pv.position === "boolean") return false;
  var gmst = sat.gstime(date), gd = sat.eciToGeodetic(pv.position, gmst);
  o.lat = sat.degreesLat(gd.latitude); o.lng = sat.degreesLong(gd.longitude);
  o.km = gd.height; o.alt = gd.height / R_KM;
  var v = pv.velocity; o.kmh = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) * 3600;
  o.eci = pv.position; o.gmst = gmst;
  return isFinite(o.lat) && isFinite(o.lng) && o.km > 80;
}
function buildOrbitPath(){
  if (!S.iss || S.iss.static) return;
  var pts = [], now = Date.now(), tmp = { rec: S.iss.rec };
  for (var m = -12; m <= 96; m += 0.75){
    if (propagate(tmp, new Date(now + m * 60000))) pts.push([tmp.lat, tmp.lng, tmp.alt]);
  }
  S.orbitPath = pts;
}
/* next time the ISS climbs 10° above your horizon, in the next day */
function computeNextPass(){
  var sat = window.satellite;
  if (!sat || !S.iss || S.iss.static) return;
  var h = home(), obs = { latitude: h.lat * RAD, longitude: h.lng * RAD, height: 0.03 };
  var now = Date.now(), inPass = false, pass = null;
  for (var s = 0; s < 86400; s += 20){
    var d = new Date(now + s * 1000), pv = sat.propagate(S.iss.rec, d);
    if (!pv || !pv.position) continue;
    var ecf = sat.eciToEcf(pv.position, sat.gstime(d));
    var el = sat.ecfToLookAngles(obs, ecf).elevation / RAD;
    if (el > 10 && !inPass){ inPass = true; pass = { start: d, max: el, maxAt: d }; }
    else if (inPass && el > pass.max){ pass.max = el; pass.maxAt = d; }
    else if (inPass && el <= 10){ pass.end = d; break; }
  }
  S.nextPass = pass;
}

/* =====================================================================
   DATA — quakes (USGS directly; the Worker as backup)
   ===================================================================== */
function setQuakes(list){
  S.quakes = list.filter(function(q){ return isFinite(q.lat) && isFinite(q.lng) && isFinite(q.mag); })
    .sort(function(a, b){ return b.mag - a.mag; }).slice(0, 80);
  S.dirtyList = true;
  applyFilter();
}
function loadQuakes(){
  return getJSON("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson", 9000)
    .then(function(j){
      setQuakes((j.features || []).map(function(f){
        var p = f.properties || {}, c = (f.geometry || {}).coordinates || [];
        return { id: f.id, lat: c[1], lng: c[0], depth: c[2], mag: +(p.mag || 0).toFixed(1),
                 place: p.place || "somewhere", time: p.time, url: p.url, tsunami: !!p.tsunami };
      }));
      var top = S.quakes[0];
      return S.quakes.length + " events · 24 h" + (top ? " · strongest M" + top.mag : "");
    });
}

/* =====================================================================
   LAYERS — push data into the globe (cheap, and not every frame)
   ===================================================================== */
function show(kind){
  var f = S.filter;
  return f === "all" || (f === "air" && kind === "air") || (f === "orbit" && kind === "orbit") || (f === "seismic" && kind === "seismic");
}
function applyFilter(){
  if (!S.globe) return;
  var h = home();
  var rings = [{ lat: h.lat, lng: h.lng, maxR: 1.6, speed: 0.9, period: 1600, rgb: "216,255,62" }];
  if (show("seismic")) S.quakes.slice(0, 14).forEach(function(q){
    if (q.mag >= 4) rings.push({ lat: q.lat, lng: q.lng, maxR: q.mag * 0.9, speed: q.mag * 0.5, period: 2600 - q.mag * 180,
      rgb: q.mag >= 6 ? "255,61,127" : "255,176,32" });
  });
  S.globe.ringsData(rings);
  S.globe.pointsData(show("seismic") ? S.quakes : []);
  S.globe.pathsData(show("orbit") && S.orbitPath.length ? [{ pts: S.orbitPath }] : []);
  S.dirtyArcs = true;
  updateSats(true);
  S.dirtyList = true;
}
function updateArcs(){
  if (!S.globe) return;
  S.dirtyArcs = false;
  if (!show("air")){ S.globe.arcsData([]); return; }
  var rt = routes(), arcs = [], selHex = S.target && S.target.kind === "ac" ? S.target.id : null;
  S.aircraft.forEach(function(a){
    if (a.ground || !a.call) return;
    var r = rt[a.call];
    if (!r || !r.from || !r.to || !isFinite(r.from.lat) || !isFinite(r.to.lat)) return;
    if (arcs.length > 40 && a.hex !== selHex) return;
    if (!a.arc) a.arc = { hex: a.hex, gap: Math.random() };
    a.arc.sLat = r.from.lat; a.arc.sLng = r.from.lon; a.arc.eLat = r.to.lat; a.arc.eLng = r.to.lon;
    a.arc.sel = a.hex === selHex;
    arcs.push(a.arc);
  });
  S.globe.arcsData(arcs);
}
var satTick = 0;
function updateSats(force){
  if (!S.globe) return;
  var now = Date.now();
  if (!force && now - satTick < 250) return;
  satTick = now;
  var d = new Date(now);
  S.sats.forEach(function(o){ if (!o.static) propagate(o, d); });
  var pts = show("orbit") ? S.sats.filter(function(o){ return o !== S.iss; }) : [];
  S.globe.particlesData(pts.length ? [pts] : []);
}

/* =====================================================================
   TAGS — our own DOM overlay: projected every frame, dead-reckoned,
   occluded by the planet, and level-of-detailed by camera height.
   ===================================================================== */
S.tags = {};
var PLANE = '<svg viewBox="-12 -12 24 24" aria-hidden="true"><path d="M0 -10 L1.6 -3 L9 1.8 L9 3.4 L1.6 1.6 L1.2 7 L3.6 8.8 L3.6 10 L0 9 L-3.6 10 L-3.6 8.8 L-1.2 7 L-1.6 1.6 L-9 3.4 L-9 1.8 L-1.6 -3 Z"/></svg>';
function tagFor(key, cls, html){
  var t = S.tags[key];
  if (!t){
    var el = document.createElement("button");
    el.className = "ge-tag " + cls;
    el.setAttribute("data-t", key);
    el.innerHTML = html;
    $("geTags").appendChild(el);
    t = S.tags[key] = { el: el, vis: null, lbl: null };
  }
  return t;
}
function dropTag(key){
  var t = S.tags[key];
  if (t){ if (t.el.parentNode) t.el.parentNode.removeChild(t.el); delete S.tags[key]; }
}
/* is a point at (lat,lng,alt) on our side of the planet? */
function visible(lat, lng, alt, cam){
  var p = xyz(lat, lng), r = 1 + alt, D = 1 + cam.altitude;
  var c = xyz(cam.lat, cam.lng);
  var th = Math.acos(clamp(dot(p, c), -1, 1));
  return th < Math.acos(1 / r) + Math.acos(1 / D) - 0.01;
}
function place(t, x, y, on, rot){
  if (on !== t.vis){ t.el.style.display = on ? "" : "none"; t.vis = on; }
  if (!on) return;
  t.el.style.transform = "translate3d(" + x.toFixed(1) + "px," + y.toFixed(1) + "px,0)";
  if (rot != null && t.svg) t.svg.style.transform = "rotate(" + rot.toFixed(0) + "deg)";
}
function setClass(t, cls, on){
  var k = "c_" + cls;
  if (t[k] === on) return;
  t[k] = on; t.el.classList.toggle(cls, on);
}

function drawTags(now){
  var G = S.globe, cam = G.pointOfView(), W = window.innerWidth, H = window.innerHeight;
  var A = cam.altitude, nowMs = Date.now(), selKey = S.target ? tkey(S.target) : null;
  var h = home();
  var n = 0;

  /* home */
  var ht = tagFor("home", "home", '<i></i><span></span>');
  var hlbl = A > 2.4 ? "You · " + S.aircraft.length + " aircraft" : "You";
  if (ht.lbl !== hlbl){ ht.el.querySelector("span").textContent = hlbl; ht.lbl = hlbl; }
  var hs = G.getScreenCoords(h.lat, h.lng, 0.003);
  place(ht, hs.x, hs.y, visible(h.lat, h.lng, 0.003, cam));
  setClass(ht, "sel", selKey === "home");

  /* aircraft: place every icon, then hand out labels greedily (locked
     target first, then nearest to home) so no label lands on another */
  var showAir = show("air"), cand = [];
  S.aircraft.forEach(function(a, i){
    var key = "ac:" + a.hex;
    var t = S.tags[key];
    var isSel = key === selKey;
    var want = showAir && (isSel || A < 2.6);
    if (!want){ if (t) place(t, 0, 0, false); return; }
    if (!t){
      t = tagFor(key, "ac", PLANE + "<span></span>");
      t.svg = t.el.querySelector("svg");
      a.el = t.el;
    }
    var p = acPos(a, nowMs), alt = acAlt(a);
    a.lat = p.lat; a.lng = p.lng;
    var on = visible(p.lat, p.lng, alt, cam);
    if (!on){ place(t, 0, 0, false); return; }
    var s = G.getScreenCoords(p.lat, p.lng, alt);
    if (s.x < -60 || s.y < -60 || s.x > W + 60 || s.y > H + 60){ place(t, 0, 0, false); return; }
    var ahead = G.getScreenCoords(p.lat + 0.05 * Math.cos(a.trk * RAD), p.lng + 0.05 * Math.sin(a.trk * RAD) / Math.max(0.2, Math.cos(p.lat * RAD)), alt);
    var rot = Math.atan2(ahead.y - s.y, ahead.x - s.x) / RAD + 90;
    place(t, s.x, s.y, true, rot);
    setClass(t, "dot", A > 1.3 && !isSel);
    setClass(t, "sel", isSel);
    setClass(t, "gnd", a.ground);
    setClass(t, "emerg", a.emerg);
    if (t.lbl !== a.label){ t.el.querySelector("span").textContent = a.label; t.lbl = a.label; }
    cand.push({ t: t, a: a, x: s.x, y: s.y, sel: isSel, i: i });
    n++;
  });
  cand.sort(function(p, q){ return (q.sel - p.sel) || (p.i - q.i); });
  var boxes = [];
  cand.forEach(function(c){
    var lab = false;
    if (c.sel || A < 1.1){
      var x0 = c.x + 9, y0 = c.y - 9, x1 = x0 + c.a.label.length * 6.4 + 6, y1 = y0 + 16;
      lab = true;
      for (var b = 0; b < boxes.length && !c.sel; b++){
        var B = boxes[b];
        if (x0 < B[2] && x1 > B[0] && y0 < B[3] && y1 > B[1]){ lab = false; break; }
      }
      if (lab) boxes.push([x0, y0, x1, y1]);
    }
    setClass(c.t, "lab", lab);
  });

  /* ISS and named stations */
  var showOrb = show("orbit");
  S.sats.forEach(function(o){
    var named = o === S.iss || /^(Tiangong|Hubble)$/.test(o.name);
    var key = "sat:" + o.id;
    if (!named && key !== selKey){ if (S.tags[key]) place(S.tags[key], 0, 0, false); return; }
    var t = tagFor(key, "sat" + (o === S.iss ? " iss" : ""), '<i></i><span>' + esc(o.name) + '</span>');
    if (!showOrb && key !== selKey){ place(t, 0, 0, false); return; }
    if (o === S.iss && !o.static) propagate(o, new Date(nowMs));
    var on = visible(o.lat, o.lng, o.alt, cam);
    var s = on ? G.getScreenCoords(o.lat, o.lng, o.alt) : null;
    place(t, s ? s.x : 0, s ? s.y : 0, on);
    setClass(t, "sel", key === selKey);
  });

  /* the biggest quakes get names */
  var showQ = show("seismic");
  S.quakes.forEach(function(q, i){
    var key = "quake:" + q.id;
    var want = showQ && (i < 6 || key === selKey) && (q.mag >= 4.5 || key === selKey);
    var t = S.tags[key];
    if (!want){ if (t) place(t, 0, 0, false); return; }
    t = tagFor(key, "quake", '<span>M' + q.mag.toFixed(1) + '</span>');
    var alt = 0.004 + Math.max(0, q.mag - 2) * 0.018;
    var on = visible(q.lat, q.lng, alt, cam);
    var s = on ? G.getScreenCoords(q.lat, q.lng, alt) : null;
    place(t, s ? s.x : 0, s ? s.y : 0, on);
    setClass(t, "sel", key === selKey);
  });

  /* the sun, where it stands overhead */
  var sun = subsolar(new Date(nowMs));
  var st = tagFor("sun", "sun", '<i></i><span>Sun overhead</span>');
  var son = visible(sun.lat, sun.lng, 0.01, cam);
  var ss = son ? G.getScreenCoords(sun.lat, sun.lng, 0.01) : null;
  place(st, ss ? ss.x : 0, ss ? ss.y : 0, son);
  setClass(st, "sel", selKey === "sun");

  S.visibleAir = n;
}

/* =====================================================================
   TARGETS
   ===================================================================== */
function tkey(t){ return t.kind === "home" || t.kind === "sun" ? t.kind : t.kind + ":" + t.id; }
function parseT(k){
  if (k === "home" || k === "sun") return { kind: k };
  var i = k.indexOf(":");
  return { kind: k.slice(0, i), id: k.slice(i + 1) };
}
function resolve(t){
  if (!t) return null;
  if (t.kind === "ac") return S.acIndex[t.id] || null;
  if (t.kind === "sat"){ for (var i = 0; i < S.sats.length; i++) if (S.sats[i].id === t.id) return S.sats[i]; return null; }
  if (t.kind === "quake"){ for (var j = 0; j < S.quakes.length; j++) if (S.quakes[j].id === t.id) return S.quakes[j]; return null; }
  if (t.kind === "home") return home();
  if (t.kind === "sun") return subsolar(new Date());
  return null;
}
function tpos(t){
  var o = resolve(t); if (!o) return null;
  if (t.kind === "ac"){ var p = acPos(o); return { lat: p.lat, lng: p.lng, alt: acAlt(o) }; }
  if (t.kind === "sat"){ if (!o.static) propagate(o, new Date()); return { lat: o.lat, lng: o.lng, alt: o.alt }; }
  if (t.kind === "quake") return { lat: o.lat, lng: o.lng, alt: 0.01 };
  if (t.kind === "home") return { lat: o.lat, lng: o.lng, alt: 0.003 };
  if (t.kind === "sun") return { lat: o.lat, lng: o.lng, alt: 0.01 };
  return null;
}
var VIEW_ALT = { ac: 0.2, sat: 0.75, quake: 0.8, home: 0.3, sun: 2.3 };

function select(t, opt){
  opt = opt || {};
  var o = resolve(t);
  if (!o) return;
  var prev = S.target && tkey(S.target);
  S.target = t;
  if (prev !== tkey(t)){
    SND.lock();
    var r = $("geReticle"); r.classList.remove("lock"); void r.offsetWidth; r.classList.add("lock");
  }
  if (t.kind === "ac" || prev && prev.indexOf("ac:") === 0) S.dirtyArcs = true;
  S.dirtyList = true;
  renderDossier(true);
  if (opt.fly){
    var p = tpos(t), alt = opt.alt || VIEW_ALT[t.kind] || 0.5;
    var follows = t.kind === "ac" || t.kind === "sat";
    flyTo(p, alt, opt.ms, function(){ if (follows) S.follow = t; });
  }
  if (t.kind === "ac"){
    var oh = OH();
    if (oh && oh.fetchPhoto) oh.fetchPhoto(t.id).then(function(){ if (S.target && tkey(S.target) === tkey(t)) renderDossier(false); });
  }
  writeHash();
}
function deselect(){
  S.target = null; S.follow = null;
  S.dirtyArcs = true; S.dirtyList = true;
  renderDossier(true);
  writeHash();
}

/* ordered, so space bar can walk through them */
function targetOrder(){
  var out = [];
  if (show("air")) S.aircraft.slice(0, 25).forEach(function(a){ out.push({ kind: "ac", id: a.hex }); });
  if (show("orbit")){
    if (S.iss) out.push({ kind: "sat", id: S.iss.id });
    S.sats.filter(function(o){ return o !== S.iss; }).slice(0, 8).forEach(function(o){ out.push({ kind: "sat", id: o.id }); });
  }
  if (show("seismic")) S.quakes.slice(0, 8).forEach(function(q){ out.push({ kind: "quake", id: q.id }); });
  return out;
}
function nextTarget(dir){
  var list = targetOrder(); if (!list.length) return;
  var cur = S.target ? tkey(S.target) : null, i = -1;
  for (var k = 0; k < list.length; k++) if (tkey(list[k]) === cur){ i = k; break; }
  var n = list[(i + (dir || 1) + list.length) % list.length];
  select(n, { fly: true });
}

/* =====================================================================
   LIST
   ===================================================================== */
function row(key, name, sub, extra){
  var sel = S.target && tkey(S.target) === key;
  return '<button class="ge-row' + (sel ? " sel" : "") + (extra ? " " + extra : "") + '" data-t="' + esc(key) + '">' +
    '<span class="nm">' + esc(name) + '</span><span class="sb">' + esc(sub) + '</span></button>';
}
function renderList(){
  S.dirtyList = false;
  var out = "", rt = routes();
  var air = S.aircraft.filter(function(a){ return !a.ground; });
  $("geCount").textContent = (show("air") ? air.length : 0) + (show("orbit") ? S.sats.length : 0) + (show("seismic") ? S.quakes.length : 0);
  if (show("air")){
    out += '<div class="ge-grp"><span>Aircraft</span><b>' + air.length + '</b></div>';
    var lim = S.filter === "air" ? 60 : 14;
    out += air.slice(0, lim).map(function(a){
      var r = rt[a.call];
      var sub = (r && r.from && r.to ? r.from.code + "→" + r.to.code + " · " : "") +
        (Math.round(a.altFt / 100) * 100).toLocaleString("en-GB") + " ft · " + a.dist.toFixed(0) + " nm";
      return row("ac:" + a.hex, a.label, sub, a.emerg ? "emerg" : "");
    }).join("") || '<div class="ge-empty">quiet skies</div>';
  }
  if (show("orbit")){
    out += '<div class="ge-grp"><span>Orbit</span><b>' + S.sats.length + '</b></div>';
    var sats = S.sats.slice().sort(function(a, b){ return (b === S.iss) - (a === S.iss) || a.km - b.km; });
    out += sats.slice(0, S.filter === "orbit" ? 60 : 6).map(function(o){
      return row("sat:" + o.id, o.name, fmt(o.km) + " km · " + fmt(o.kmh) + " km/h");
    }).join("") || '<div class="ge-empty">no elements yet</div>';
  }
  if (show("seismic")){
    out += '<div class="ge-grp"><span>Seismic · 24 h</span><b>' + S.quakes.length + '</b></div>';
    out += S.quakes.slice(0, S.filter === "seismic" ? 60 : 6).map(function(q){
      return row("quake:" + q.id, "M" + q.mag.toFixed(1), q.place, q.mag >= 6 ? "emerg" : "");
    }).join("") || '<div class="ge-empty">the ground is still</div>';
  }
  $("geList").innerHTML = out;
}

/* =====================================================================
   DOSSIER — the lock-on card
   ===================================================================== */
function stat(k, v, cls){ return '<div class="ge-st' + (cls ? " " + cls : "") + '"><span>' + k + '</span><b>' + v + '</b></div>'; }
function renderDossier(fresh){
  var box = $("geDossier"), t = S.target, o = resolve(t);
  if (!t || !o){ box.classList.remove("on"); box.innerHTML = ""; box.removeAttribute("data-k"); $("geReticle").classList.remove("on"); return; }
  var h = home(), html = "", kind = t.kind;
  /* html = the head; dyn = numbers that move; tail = photo, links, buttons.
     Only dyn is rewritten every second, so the photo never flickers. */
  var dyn = "", tail = "";
  var head = function(kick, title, sub){
    return '<div class="ge-dk"><span class="ge-lock">◉ Locked</span><span>' + kick + '</span><button data-act="unlock" title="Release">✕</button></div>' +
      '<div class="ge-dt" data-scr="' + esc(title) + '">' + esc(title) + '</div>' + (sub ? '<div class="ge-ds">' + sub + '</div>' : "");
  };
  if (kind === "ac"){
    var p = acPos(o), r = routeOf(o), oh = OH();
    var op = (r && r.airline) || o.op;
    html += head(o.ground ? "Aircraft · on the ground" : "Aircraft", o.label, esc(op || "Private or unlisted operator") + (r && r.radio ? ' · radio <i>' + esc(r.radio) + '</i>' : ""));
    if (r && r.from && r.to){
      var total = distKm(r.from.lat, r.from.lon, r.to.lat, r.to.lon), done = distKm(r.from.lat, r.from.lon, p.lat, p.lng);
      var pct = clamp(done / Math.max(1, total), 0, 1);
      dyn += '<div class="ge-route"><b>' + esc(r.from.code) + '</b><div class="ge-prog"><i style="width:' + (pct * 100).toFixed(1) + '%"></i><em style="left:' + (pct * 100).toFixed(1) + '%">✈</em></div><b>' + esc(r.to.code) + '</b></div>' +
        '<div class="ge-rsub"><span>' + esc(r.from.city || "") + '</span><span>' + Math.round(pct * 100) + '% · ' + fmt(Math.max(0, total - done)) + ' km to go</span><span>' + esc(r.to.city || "") + '</span></div>';
    } else if (r === null){
      dyn += '<div class="ge-note">No published route for this callsign.</div>';
    }
    var d = distKm(h.lat, h.lng, p.lat, p.lng) / 1.852, b = bearing(h.lat, h.lng, p.lat, p.lng);
    dyn += '<div class="ge-grid">' +
      stat("Altitude", o.ground ? "ground" : fmt(o.altFt) + " ft") +
      stat("Speed", o.gs ? fmt(o.gs) + " kt" : "—") +
      stat("Track", fmt(o.trk) + "° " + compass(o.trk)) +
      stat("Vertical", o.vs == null ? "—" : (o.vs > 0 ? "+" : "") + fmt(o.vs) + " fpm", o.vs > 300 ? "up" : o.vs < -300 ? "down" : "") +
      stat("From you", d.toFixed(1) + " nm " + compass(b)) +
      stat("Squawk", esc(o.sq || "—"), o.emerg ? "emerg" : "") +
      stat("Type", esc(o.type)) +
      stat("Reg", esc(o.reg || "—")) +
      '</div>';
    var ph = oh && oh.photos ? oh.photos()[o.hex] : null;
    if (ph) tail += '<a class="ge-photo" href="' + esc(ph.link || "#") + '" target="_blank" rel="noopener"><img src="' + esc(ph.src) + '" alt="' + esc(o.label) + '"><span>photo · ' + esc(ph.by || "unknown") + ' · planespotters.net</span></a>';
  } else if (kind === "sat"){
    var isISS = o === S.iss;
    html += head(isISS ? "Crewed station" : "Satellite · NORAD " + esc(o.id), o.name, isISS ? "International Space Station" : "");
    dyn += '<div class="ge-grid">' +
      stat("Altitude", fmt(o.km) + " km") +
      stat("Velocity", fmt(o.kmh) + " km/h") +
      stat("Over", fmtLL(o.lat, o.lng)) +
      stat("Orbit", o.rec ? (1440 / (o.rec.no * 1440 / (2 * Math.PI))).toFixed(1) + " min" : "~92 min") +
      '</div>';
    var from = distKm(h.lat, h.lng, o.lat, o.lng);
    dyn += '<div class="ge-note">' + fmt(from) + ' km from you along the ground. It laps the planet in the time it takes to watch a film.</div>';
    if (isISS && S.nextPass){
      var np = S.nextPass, when = np.start;
      dyn += '<div class="ge-pass"><span>Next over you</span><b>' + pad(when.getHours()) + ":" + pad(when.getMinutes()) +
        '</b><em>' + (when.toDateString() === new Date().toDateString() ? "today" : "tomorrow") + ' · peaks ' + Math.round(np.max) + '° up</em></div>';
    } else if (isISS && !o.static){
      dyn += '<div class="ge-pass"><span>Next over you</span><b>—</b><em>not in the next 24 h</em></div>';
    }
  } else if (kind === "quake"){
    html += head("Earthquake · " + (o.time ? ago(o.time) : "past 24 h"), "M" + o.mag.toFixed(1), esc(o.place));
    dyn += '<div class="ge-grid">' +
      stat("Magnitude", o.mag.toFixed(1), o.mag >= 6 ? "emerg" : "") +
      stat("Depth", o.depth != null ? fmt(o.depth) + " km" : "—") +
      stat("Where", fmtLL(o.lat, o.lng)) +
      stat("From you", fmt(distKm(h.lat, h.lng, o.lat, o.lng)) + " km") +
      '</div>';
    var energy = Math.pow(10, 1.5 * (o.mag - 4));
    dyn += '<div class="ge-note">≈ ' + (energy >= 1 ? fmt(energy) + "×" : (energy * 100).toFixed(0) + "% of") + ' the energy of an M4.0.' + (o.tsunami ? " Tsunami flag raised." : "") + '</div>';
    if (o.url) tail += '<a class="ge-btn" href="' + esc(o.url) + '" target="_blank" rel="noopener">USGS event page ↗</a>';
  } else if (kind === "home"){
    var sa = sunAltAt(h.lat, h.lng);
    html += head("Ground zero", "You", fmtLL(h.lat, h.lng));
    dyn += '<div class="ge-grid">' +
      stat("Aircraft", S.aircraft.filter(function(a){ return !a.ground; }).length + " up") +
      stat("Sun", sa.toFixed(1) + "° " + (sa > 0 ? "up" : "down")) +
      stat("Radar", RANGE_NM + " nm") +
      stat("Nearest", S.aircraft[0] ? esc(S.aircraft[0].label) + " · " + S.aircraft[0].dist.toFixed(1) + " nm" : "—") +
      '</div>';
    if (S.nextPass) dyn += '<div class="ge-pass"><span>ISS over you next</span><b>' + pad(S.nextPass.start.getHours()) + ":" + pad(S.nextPass.start.getMinutes()) + '</b><em>peaks ' + Math.round(S.nextPass.max) + '° up</em></div>';
  } else if (kind === "sun"){
    var ha = sunAltAt(h.lat, h.lng);
    html += head("Subsolar point", "The sun", "directly overhead at " + fmtLL(o.lat, o.lng));
    dyn += '<div class="ge-grid">' +
      stat("Your sun", ha.toFixed(1) + "° " + (ha > 0 ? "above" : "below")) +
      stat("Moving", "1,670 km/h west") +
      '</div>';
    dyn += '<div class="ge-note">Everywhere on the bright side of the line is daytime this second. The line itself is sunrise on one side, sunset on the other.</div>';
  }
  tail += '<div class="ge-dact"><button class="ge-btn" data-act="follow">' + (S.follow ? "■ Unfollow" : "◎ Follow") + ' <kbd>F</kbd></button><button class="ge-btn" data-act="next">Next <kbd>␣</kbd></button></div>';
  var key = tkey(t) + "|" + tail.length + "|" + (S.follow ? 1 : 0);
  var live = box.querySelector(".ge-dyn");
  if (!fresh && live && box.getAttribute("data-k") === key){
    if (live._last !== dyn){ live.innerHTML = dyn; live._last = dyn; }
    return;
  }
  box.innerHTML = html + '<div class="ge-dyn">' + dyn + '</div>' + tail;
  box.querySelector(".ge-dyn")._last = dyn;
  box.setAttribute("data-k", key);
  box.classList.add("on");
  if (fresh){
    box.classList.remove("in"); void box.offsetWidth; box.classList.add("in");
    var tt = box.querySelector(".ge-dt");
    if (tt) scramble(tt, tt.getAttribute("data-scr"));
  }
  $("geRetLbl").textContent = kind === "ac" ? o.label : kind === "sat" ? o.name : kind === "quake" ? "M" + o.mag.toFixed(1) : kind === "home" ? "You" : "Sun";
  $("geReticle").classList.add("on");
}
var GLYPHS = "!<>-_\\/[]{}—=+*^?#01ABCDEFXYZ";
function scramble(el, text){
  if (reduce){ el.textContent = text; return; }
  var f = 0, total = 16;
  clearInterval(el._scr);
  el._scr = setInterval(function(){
    f++;
    el.textContent = text.split("").map(function(ch, i){
      if (ch === " ") return " ";
      return f / total > i / text.length ? ch : GLYPHS[(Math.random() * GLYPHS.length) | 0];
    }).join("");
    if (f >= total){ clearInterval(el._scr); el.textContent = text; }
  }, 32);
}

/* =====================================================================
   CAPTION
   ===================================================================== */
function caption(k, t, sound){
  var cap = $("geCap");
  $("geCapK").textContent = k;
  typeInto($("geCapT"), t, 16, sound);
  cap.classList.add("on");
}

/* =====================================================================
   RADAR — a PPI scope with phosphor persistence
   ===================================================================== */
var radar = { size: 220, period: 4200 };
function sizeRadar(){
  var c = $("geRadar"); if (!c) return;
  var css = c.clientWidth || 220, dpr = Math.min(2, window.devicePixelRatio || 1);
  radar.size = css;
  c.width = Math.round(css * dpr); c.height = Math.round(css * dpr);
  radar.dpr = dpr;
}
function drawRadar(now){
  var c = $("geRadar"); if (!c || !c.offsetParent) return;
  var g = c.getContext("2d"), dpr = radar.dpr || 1, sz = radar.size, R = sz / 2 - 6, cx = sz / 2, cy = sz / 2;
  var acc = ACC[S.mode];
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, sz, sz);
  g.fillStyle = "rgba(2,8,10,.72)"; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
  g.strokeStyle = "rgba(255,255,255,.10)"; g.lineWidth = 1;
  [0.33, 0.66, 1].forEach(function(f){ g.beginPath(); g.arc(cx, cy, R * f, 0, Math.PI * 2); g.stroke(); });
  g.beginPath(); g.moveTo(cx - R, cy); g.lineTo(cx + R, cy); g.moveTo(cx, cy - R); g.lineTo(cx, cy + R); g.stroke();
  var sweep = ((now % radar.period) / radar.period) * Math.PI * 2;       /* 0 = north, clockwise */
  /* the beam: a fading wedge behind the sweep line */
  for (var i = 0; i < 28; i++){
    var a0 = sweep - (i + 1) * 0.035, a1 = sweep - i * 0.035;
    g.fillStyle = hexA(acc, 0.20 * (1 - i / 28));
    g.beginPath(); g.moveTo(cx, cy);
    g.arc(cx, cy, R, a0 - Math.PI / 2, a1 - Math.PI / 2); g.closePath(); g.fill();
  }
  g.strokeStyle = hexA(acc, 0.9); g.lineWidth = 1.4;
  g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.sin(sweep) * R, cy - Math.cos(sweep) * R); g.stroke();

  var h = home(), selHex = S.target && S.target.kind === "ac" ? S.target.id : null;
  radar.blips = [];
  S.aircraft.forEach(function(a){
    var p = acPos(a);
    var dnm = distKm(h.lat, h.lng, p.lat, p.lng) / 1.852;
    if (dnm > RANGE_NM) return;
    var br = bearing(h.lat, h.lng, p.lat, p.lng) * RAD;
    var rr = (dnm / RANGE_NM) * R;
    var x = cx + Math.sin(br) * rr, y = cy - Math.cos(br) * rr;
    var since = ((sweep - br) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    var glow = Math.exp(-since / 2.4);
    var sel = a.hex === selHex;
    if (sel && since < 0.07 && now - (radar.lastPing || 0) > 1500){ radar.lastPing = now; SND.ping(); }
    g.fillStyle = sel ? "rgba(255,61,127," + (0.5 + glow * 0.5).toFixed(2) + ")" : hexA(acc, 0.18 + glow * 0.82);
    g.beginPath(); g.arc(x, y, sel ? 3.6 : a.ground ? 1.4 : 2.2, 0, Math.PI * 2); g.fill();
    if (sel){ g.strokeStyle = "rgba(255,61,127,.9)"; g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.stroke(); }
    radar.blips.push({ x: x, y: y, hex: a.hex });
  });
  g.fillStyle = acc; g.beginPath(); g.arc(cx, cy, 2.4, 0, Math.PI * 2); g.fill();
  g.fillStyle = "rgba(255,255,255,.4)"; g.font = "9px 'JetBrains Mono', monospace"; g.textAlign = "center";
  g.fillText("N", cx, cy - R + 11);
}
function hexA(hex, a){
  var m = hex.replace("#", "");
  if (m.length === 3) m = m.split("").map(function(c){ return c + c; }).join("");
  var n = parseInt(m, 16);
  return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + clamp(a, 0, 1).toFixed(3) + ")";
}
function radarClick(e){
  var c = $("geRadar"), r = c.getBoundingClientRect();
  var x = e.clientX - r.left, y = e.clientY - r.top, best = null, bd = 14;
  (radar.blips || []).forEach(function(b){
    var d = Math.hypot(b.x - x, b.y - y);
    if (d < bd){ bd = d; best = b; }
  });
  if (best){ stopTour(); select({ kind: "ac", id: best.hex }, { fly: true }); }
}

/* =====================================================================
   TOUR — a director that picks the best shots from live data
   ===================================================================== */
function tourSteps(){
  var h = home(), sun = subsolar(new Date()), steps = [];
  var air = S.aircraft.filter(function(a){ return !a.ground; });
  steps.push({ k: "Orbit", t: "Earth, live. The sun is directly overhead at " + fmtLL(sun.lat, sun.lng) + " — everything on the bright side is daytime this second.",
    go: function(){ deselect(); flyTo({ lat: lerp(sun.lat, h.lat, 0.5), lng: wrapLng(sun.lng + 25) }, 2.7, 3200); setTimeout(function(){ if (S.tour) setAutoRotate(true); }, 3300); }, ms: 8000 });
  steps.push({ k: "Ground zero", t: "This is you. " + air.length + " aircraft are in the air within " + RANGE_NM + " nautical miles right now.",
    go: function(){ select({ kind: "home" }, { fly: true, alt: 0.42 }); }, ms: 7500 });
  if (air.length){
    var hi = air.slice().sort(function(a, b){ return b.altFt - a.altFt; })[0];
    steps.push({ k: "Highest", t: hi.label + " is the highest thing flying near you: " + fmt(hi.altFt) + " ft, " + (hi.altFt * 0.0003048).toFixed(1) + " km straight up.",
      go: function(){ select({ kind: "ac", id: hi.hex }, { fly: true }); }, ms: 7500 });
    var fast = air.slice().sort(function(a, b){ return b.gs - a.gs; })[0];
    if (fast && fast !== hi) steps.push({ k: "Fastest", t: fast.label + " is doing " + fmt(fast.gs) + " knots over the ground — " + fmt(fast.gs * 1.852) + " km/h.",
      go: function(){ select({ kind: "ac", id: fast.hex }, { fly: true }); }, ms: 7000 });
    var rt = routes(), far = null, farD = 0;
    air.forEach(function(a){
      var r = rt[a.call];
      if (r && r.from && r.to && isFinite(r.from.lat) && isFinite(r.to.lat)){
        var d = distKm(r.from.lat, r.from.lon, r.to.lat, r.to.lon);
        if (d > farD){ farD = d; far = { a: a, r: r }; }
      }
    });
    if (far) steps.push({ k: "Longest journey", t: far.a.label + " is flying " + (far.r.from.city || far.r.from.code) + " → " + (far.r.to.city || far.r.to.code) + ": " + fmt(farD) + " km, over your head.",
      go: function(){
        select({ kind: "ac", id: far.a.hex }, { fly: false });
        var mid = toLL(slerp(xyz(far.r.from.lat, far.r.from.lon), xyz(far.r.to.lat, far.r.to.lon), 0.5));
        flyTo(mid, clamp(farD / 4200, 0.9, 3), 3400);
      }, ms: 9000 });
  }
  if (S.iss && !S.iss.static) steps.push({ k: "Low orbit", t: "The International Space Station: " + fmt(S.iss.km) + " km up, " + fmt(S.iss.kmh) + " km/h. " +
      (S.nextPass ? "It next passes over you at " + pad(S.nextPass.start.getHours()) + ":" + pad(S.nextPass.start.getMinutes()) + "." : "Seven people live there."),
    go: function(){ select({ kind: "sat", id: S.iss.id }, { fly: true, alt: 0.6 }); }, ms: 10000 });
  var others = S.sats.filter(function(o){ return o !== S.iss; }).length;
  if (others > 10) steps.push({ k: "The swarm", t: others + " satellites bright enough to see with your own eyes, every one of them where it actually is.",
    go: function(){ deselect(); flyTo({ lat: h.lat, lng: h.lng }, 4.2, 3000); setTimeout(function(){ if (S.tour) setAutoRotate(true); }, 3100); }, ms: 8000 });
  var q = S.quakes[0];
  if (q) steps.push({ k: "Underground", t: "The strongest shake in the last day: M" + q.mag.toFixed(1) + ", " + q.place + (q.time ? ", " + ago(q.time) : "") + ".",
    go: function(){ select({ kind: "quake", id: q.id }, { fly: true }); }, ms: 7500 });
  var dawn = { lat: 0, lng: wrapLng(sun.lng - 90) };
  steps.push({ k: "Sunrise", t: "It is sunrise right here, right now. The line sweeps west at 1,670 km/h at the equator — it never stops.",
    go: function(){ deselect(); flyTo(dawn, 1.4, 3400); }, ms: 8000 });
  steps.push({ k: "Home", t: "Back where you started. The loop runs until you touch something.",
    go: function(){ select({ kind: "home" }, { fly: true, alt: 0.9 }); }, ms: 6500 });
  return steps;
}
function startTour(){
  if (!S.globe) return;
  S.tour = { steps: tourSteps(), i: -1, timer: 0 };
  $("geTourBtn").classList.add("on");
  $("geTourBtn").textContent = "■ Stop";
  SND.blip();
  tourNext();
}
function tourNext(){
  var T = S.tour; if (!T) return;
  T.i = (T.i + 1) % T.steps.length;
  if (T.i === 0 && T.steps._built) T.steps = tourSteps();      /* fresh data each lap */
  T.steps._built = true;
  var s = T.steps[T.i];
  setAutoRotate(false);
  s.go();
  caption(s.k, s.t, true);
  $("geDots").innerHTML = T.steps.map(function(_, i){ return '<i class="' + (i === T.i ? "on" : i < T.i ? "past" : "") + '"></i>'; }).join("");
  clearTimeout(T.timer);
  T.timer = setTimeout(tourNext, reduce ? s.ms + 2000 : s.ms);
}
function stopTour(){
  if (!S.tour) return;
  clearTimeout(S.tour.timer);
  S.tour = null;
  $("geTourBtn").classList.remove("on");
  $("geTourBtn").textContent = "▶ Tour";
  $("geDots").innerHTML = "";
}

/* =====================================================================
   MODES, ACTIONS, KEYS
   ===================================================================== */
function setMode(m){
  if (MODES.indexOf(m) < 0 || m === S.mode) return;
  var prev = S.mode;
  S.mode = m;
  LS.set("home.ge.mode", m);
  paintModeButtons();
  SND.mode();
  if (S.U){
    S.U.uPrev.value = MODES.indexOf(prev);
    S.U.uMode.value = MODES.indexOf(m);
    S.U.uBlend.value = reduce ? 1 : 0;
    S.modeT0 = performance.now();
  }
  if (S.globe) S.globe.atmosphereColor(ATMO[m]);
  caption("Sensor", { optic: "Optic — true colour, real sunlight, city lights on the night side.",
    holo: "Holo — the planet as a dot-matrix hologram. The bright line is the terminator.",
    nvg: "Night vision — light amplified a few thousand times.",
    thermal: "Thermal — land, day side and cities run hot." }[m]);
}
function act(a){
  if (a === "tour") return S.tour ? stopTour() : startTour();
  if (a === "home"){ stopTour(); return select({ kind: "home" }, { fly: true }); }
  if (a === "space"){ stopTour(); deselect(); var h = home(); flyTo({ lat: h.lat, lng: h.lng }, 3.2); setTimeout(function(){ setAutoRotate(true); }, 2500); return; }
  if (a === "sound"){ SND.setOn(!SND.isOn()); SND.init(); if (SND.isOn()){ SND.startDrone(); SND.blip(); } else SND.stopDrone(); paintSoundButton(); return; }
  if (a === "help"){ var hp = $("geHelp"); hp.hidden = !hp.hidden; SND.blip(); return; }
  if (a === "list"){ S.root.classList.toggle("list-open"); return; }
  if (a === "unlock"){ stopTour(); deselect(); SND.out(); return; }
  if (a === "next"){ stopTour(); nextTarget(1); return; }
  if (a === "follow"){
    if (S.follow){ S.follow = null; }
    else if (S.target){ var p = tpos(S.target); if (p) flyTo(p, Math.min(S.globe.pointOfView().altitude, VIEW_ALT[S.target.kind] || 0.5), 900, function(){ S.follow = S.target; }); }
    SND.blip(); renderDossier(false); return;
  }
  if (a === "share") return share();
}
function share(){
  writeHash();
  var url = location.href, b = $("geShareBtn");
  var done = function(){ b.textContent = "✓"; SND.ok(); setTimeout(function(){ b.textContent = "⎘"; }, 1500); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function(){ window.prompt("Copy this link:", url); });
  else window.prompt("Copy this link:", url);
}
function writeHash(){
  if (!S.open) return;
  var h = "#godseye" + (S.target && S.target.kind !== "home" ? "/" + tkey(S.target) : "");
  try{ history.replaceState(null, "", location.pathname + location.search + h); }catch(e){}
}
function applyHash(){
  var m = (location.hash || "").match(/^#godseye\/(.+)$/);
  if (!m) return;
  var t = parseT(decodeURIComponent(m[1]));
  var tries = 0;
  (function attempt(){
    if (resolve(t)) return select(t, { fly: true });
    if (++tries < 12) setTimeout(attempt, 1000);
  })();
}

function onKey(e){
  var tag = (e.target && e.target.tagName) || "";
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (e.target && e.target.isContentEditable)) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (document.querySelector(".cmdk.on, #authModalBg.open")) return;
  var k = e.key;
  if (!S.open){
    if (k === "g" || k === "G"){ e.preventDefault(); open(); }
    return;
  }
  if (S.booting && k !== "Escape") return;
  if (k === "Escape"){
    e.preventDefault();
    if (!$("geHelp").hidden){ $("geHelp").hidden = true; return; }
    if (S.root.classList.contains("list-open")){ S.root.classList.remove("list-open"); return; }
    return close();
  }
  if (k === "g" || k === "G") return close();
  if (k >= "1" && k <= "4") return setMode(MODES[+k - 1]);
  if (k === "t" || k === "T") return act("tour");
  if (k === "h" || k === "H") return act("home");
  if (k === "o" || k === "O") return act("space");
  if (k === "m" || k === "M") return act("sound");
  if (k === "f" || k === "F") return act("follow");
  if (k === "?" || k === "/") { e.preventDefault(); return act("help"); }
  if (k === " " || k === "n" || k === "N" || k === "ArrowRight"){ e.preventDefault(); stopTour(); return nextTarget(1); }
  if (k === "ArrowLeft" || k === "p" || k === "P"){ e.preventDefault(); stopTour(); return nextTarget(-1); }
}
document.addEventListener("keydown", onKey);

/* =====================================================================
   FRAME LOOP (ours; globe.gl runs its own render loop alongside)
   ===================================================================== */
var lastCam = 0, lastDossier = 0, lastSlow = 0;
function frame(now){
  if (!S.open) return;
  S.raf = requestAnimationFrame(frame);
  var G = S.globe; if (!G) return;

  if (S.U){
    S.U.uTime.value = now / 1000;
    if (S.U.uBlend.value < 1) S.U.uBlend.value = clamp((now - (S.modeT0 || 0)) / 700, 0, 1);
    S.U.uParty.value = S.party > Date.now() ? Math.min(1, (S.party - Date.now()) / 1500) : 0;
  }

  /* camera: autopilot flight, then follow */
  if (S.fly){
    var f = S.fly, t = clamp((now - f.t0) / f.dur, 0, 1), e = ease(t);
    var ll = toLL(slerp(f.a, f.b, e));
    G.pointOfView({ lat: ll.lat, lng: ll.lng, altitude: lerp(f.a0, f.a1, e) + f.hump * Math.sin(Math.PI * e) }, 0);
    if (t >= 1){ var d = f.done; S.fly = null; if (d) d(); }
  } else if (S.follow){
    var p = tpos(S.follow);
    if (p){
      var cur = G.pointOfView();
      /* ease towards it rather than snapping: feels like a camera operator */
      var v = slerp(xyz(cur.lat, cur.lng), xyz(p.lat, p.lng), 0.12), q = toLL(v);
      G.pointOfView({ lat: q.lat, lng: q.lng, altitude: cur.altitude }, 0);
    } else S.follow = null;
  }

  var alt = G.pointOfView().altitude;
  if (S.U){
    var rows = 160 * Math.pow(2, Math.round(Math.log(clamp(2.4 / alt, 1, 16)) / Math.LN2));
    if (rows !== S.U.uRows.value) S.U.uRows.value = rows;
  }
  var aw = alt < 0.35 ? 0.035 : alt < 0.9 ? 0.07 : alt < 1.8 ? 0.11 : 0.16;
  if (aw !== S.arcW){ S.arcW = aw; S.dirtyArcs = true; }

  if (S.party > Date.now()) G.controls().autoRotateSpeed = 6;
  else if (G.controls().autoRotateSpeed !== 0.35) G.controls().autoRotateSpeed = 0.35;

  drawTags(now);
  updateSats(false);
  drawRadar(now);

  /* the reticle rides on the target */
  if (S.target){
    var tp = tpos(S.target), ret = $("geReticle");
    var camp = G.pointOfView();
    if (tp && visible(tp.lat, tp.lng, tp.alt, camp)){
      var sc = G.getScreenCoords(tp.lat, tp.lng, tp.alt);
      ret.style.transform = "translate3d(" + sc.x.toFixed(1) + "px," + sc.y.toFixed(1) + "px,0)";
      ret.classList.remove("behind");
    } else ret.classList.add("behind");
  }

  if (now - lastCam > 120){
    lastCam = now;
    var c = G.pointOfView(), d = new Date();
    $("geCam").textContent = fmtLL(c.lat, c.lng) + " · " + fmt(c.altitude * R_KM) + " km";
    $("geUtc").textContent = d.toISOString().slice(11, 19);
    $("geLocal").textContent = pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  if (now - lastDossier > 1000 && S.target){ lastDossier = now; renderDossier(false); }
  if (now - lastSlow > 5000){
    lastSlow = now;
    var s = subsolar(new Date());
    if (S.U) S.U.uSun.value = xyz(s.lat, s.lng);
    if (S.iss && Date.now() - (S.orbitAt || 0) > 60000){ S.orbitAt = Date.now(); buildOrbitPath(); if (show("orbit") && S.orbitPath.length) G.pathsData([{ pts: S.orbitPath }]); }
    /* screensaver: leave it alone for 45 s and it starts showing off */
    if (!S.tour && !S.booting && !S.fly && Date.now() - S.lastInput > 45000 && $("geHelp").hidden) startTour();
  }
  if (S.dirtyArcs) updateArcs();
  if (S.dirtyList) renderList();
}

/* =====================================================================
   OPEN / CLOSE
   ===================================================================== */
function open(opts){
  if (opts && opts.tour) S.pendingTour = true;
  if (S.open){ if (S.booted) afterOpen(); return; }
  build();
  S.open = true;
  S.lastInput = Date.now();
  document.documentElement.classList.add("ge-open");
  S.root.classList.add("on");
  S.root.setAttribute("aria-hidden", "false");
  S.prevFocus = document.activeElement;
  setTimeout(function(){ try{ S.root.focus({ preventScroll: true }); }catch(e){} }, 50);
  SND.init();
  writeHash();
  window.dispatchEvent(new CustomEvent("godseye:open"));
  sizeRadar();
  if (S.booted){
    resize();
    S.globe.resumeAnimation();
    SND.startDrone();
    SND.whoosh(1.2, 0.05);
    setAutoRotate(!S.target);
    refresh();
    afterOpen();
  } else if (!S.booting && !S.failed){
    boot();
    var wait = setInterval(function(){
      if (S.globe){ clearInterval(wait); S.globe.resumeAnimation(); }
      if (S.failed) clearInterval(wait);
    }, 50);
  } else if (S.failed){
    $("geBoot").classList.add("on");
  }
  S.raf = requestAnimationFrame(frame);
  S.timers.push(setInterval(refresh, 20000));
  S.timers.push(setInterval(function(){ loadQuakes().catch(function(){}); }, 300000));
}
function refresh(){
  loadAircraft().catch(function(){});
}
function close(){
  if (!S.open) return;
  S.open = false;
  stopTour();
  S.fly = null; S.follow = null;
  cancelAnimationFrame(S.raf);
  S.timers.forEach(clearInterval); S.timers = [];
  if (S.globe) S.globe.pauseAnimation();
  SND.out(); SND.stopDrone();
  S.root.classList.remove("on", "list-open");
  S.root.setAttribute("aria-hidden", "true");
  document.documentElement.classList.remove("ge-open");
  try{ history.replaceState(null, "", location.pathname + location.search); }catch(e){}
  if (S.prevFocus && S.prevFocus.focus) try{ S.prevFocus.focus({ preventScroll: true }); }catch(e){}
  window.dispatchEvent(new CustomEvent("godseye:close"));
}

/* routes resolve on the homepage's schedule; redraw arcs when they land */
window.addEventListener("overhead:routes", function(){ S.dirtyArcs = true; S.dirtyList = true; });

window.GODSEYE = {
  open: open, close: close,
  toggle: function(){ S.open ? close() : open(); },
  isOpen: function(){ return S.open; },
  /* warm the cache on hover so the boot is quick */
  preload: function(){ loadScript(BASE + "vendor/globe.gl.min.js").catch(function(){}); },
  party: function(){
    if (S.open && S.booted) return startParty();
    S.pendingParty = true;
    open();
  }
};

/* deep link straight in */
if (/^#godseye/.test(location.hash || "")){
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function(){ setTimeout(open, 300); });
  else setTimeout(open, 300);
}
})();
