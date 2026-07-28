/* =====================================================================
   util.js — the small shared vocabulary every dashboard module speaks.
   Loaded before every other page script. No dependencies.
   ===================================================================== */

window.H = (function () {
  "use strict";

  var C = window.CONFIG || {};
  var PROXY = (C.FLIGHT_PROXY || "").replace(/\/+$/, "");

  /* ---------------- DOM ---------------- */
  function $(id){ return document.getElementById(id); }
  function $$(sel, root){ return [].slice.call((root || document).querySelectorAll(sel)); }

  function esc(s){
    return String(s == null ? "" : s).replace(/[&<>"]/g, function(c){
      return ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;" })[c];
    });
  }

  function html(el, markup){ if (el) el.innerHTML = markup; return el; }

  /* Standard placeholders, so every card fails and loads the same way. */
  function skeleton(el, lines){
    if (!el) return;
    var w = [100, 78, 88, 62];
    var out = "";
    for (var i = 0; i < (lines || 3); i++) out += '<div class="skel" style="width:' + w[i % 4] + '%"></div>';
    el.innerHTML = out;
  }
  function state(el, text, bad){
    if (el) el.innerHTML = '<div class="state' + (bad ? " err" : "") + '">' + esc(text) + '</div>';
  }

  /* ---------------- numbers + time ---------------- */
  function pad(n){ return n < 10 ? "0" + n : "" + n; }
  function hm(d){ return pad(d.getHours()) + ":" + pad(d.getMinutes()); }

  function dur(ms){
    var m = Math.max(0, Math.round(ms / 60000));
    return Math.floor(m / 60) + "h " + pad(m % 60) + "m";
  }

  function ago(ts){
    if (!ts) return "";
    var s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 3600) return Math.max(1, Math.round(s / 60)) + "m ago";
    if (s < 86400) return Math.round(s / 3600) + "h ago";
    return Math.round(s / 86400) + "d ago";
  }

  var MONTHS = ["January","February","March","April","May","June",
                "July","August","September","October","November","December"];
  var DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

  function weekNumber(d){
    var t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    var day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    var start = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    return Math.ceil((((t - start) / 86400000) + 1) / 7);
  }

  function compass(deg){
    var pts = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
    return pts[Math.round(((deg % 360) / 22.5)) % 16];
  }

  /* "PILATUS PC-24" -> "Pilatus PC-24"  (model codes stay shouty) */
  function titleCase(s){
    return String(s).toLowerCase().split(" ").map(function(w){
      if (/\d/.test(w)) return w.toUpperCase();
      return w.replace(/^[a-z]/, function(c){ return c.toUpperCase(); });
    }).join(" ");
  }

  /* great-circle distance in km */
  function haversine(la1, lo1, la2, lo2){
    var R = 6371, r = Math.PI / 180;
    var dLa = (la2 - la1) * r, dLo = (lo2 - lo1) * r;
    var a = Math.sin(dLa/2) * Math.sin(dLa/2) +
            Math.cos(la1*r) * Math.cos(la2*r) * Math.sin(dLo/2) * Math.sin(dLo/2);
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  /* ---------------- network ---------------- */

  /* fetch with a hard timeout, so one dead upstream can't stall a chain */
  function fetchTimeout(url, ms, opts){
    if (typeof AbortController === "undefined") return fetch(url, opts);
    var ctrl = new AbortController();
    var t = setTimeout(function(){ ctrl.abort(); }, ms || 9000);
    var o = {};
    for (var k in (opts || {})) o[k] = opts[k];
    o.signal = ctrl.signal;
    return fetch(url, o).then(
      function(r){ clearTimeout(t); return r; },
      function(e){ clearTimeout(t); throw e; }
    );
  }

  function getJSON(url, ms, opts){
    return fetchTimeout(url, ms, opts).then(function(r){
      if (!r.ok){ var e = new Error("http"); e.status = r.status; throw e; }
      return r.json();
    });
  }

  /* A rejection with no HTTP status is nearly always CORS, an offline
     network, or a blocking extension — worth saying so plainly. */
  function describeErr(e){
    if (e && e.name === "AbortError") return "timed out";
    if (e && e.status) return "HTTP " + e.status;
    return "blocked or unreachable (CORS / network)";
  }

  /* ---------------- preferences ---------------- */
  var PREF_DEFAULTS = {
    topics: ["music","science","tech","world"],
    games: ["lol","cs2"],
    flight_radius: 20,
    cards: { onthisday:true, sky:true, weather:true, overhead:true,
             feeds:true, esports:true, orbit:true, links:true, notes:true }
  };

  /* Always read preferences through this — a missing key must never be
     able to break a card. */
  function prefs(){
    var p = window.PREFS || {};
    return {
      topics: (p.topics && p.topics.length) ? p.topics : PREF_DEFAULTS.topics,
      games: p.games || PREF_DEFAULTS.games,
      flight_radius: p.flight_radius || PREF_DEFAULTS.flight_radius,
      cards: p.cards || PREF_DEFAULTS.cards
    };
  }

  /* ---------------- local storage ---------------- */
  function lsGet(key, fallback){
    try{
      var v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    }catch(e){ return fallback; }
  }
  function lsSet(key, value){
    try{ localStorage.setItem(key, JSON.stringify(value)); }catch(e){}
  }

  /* ---------------- weather codes ---------------- */
  var WMO = {
    0:["Clear","☀"], 1:["Mostly clear","🌤"], 2:["Partly cloudy","⛅"], 3:["Overcast","☁"],
    45:["Fog","🌫"], 48:["Freezing fog","🌫"],
    51:["Light drizzle","🌦"], 53:["Drizzle","🌦"], 55:["Heavy drizzle","🌦"],
    56:["Freezing drizzle","🌧"], 57:["Freezing drizzle","🌧"],
    61:["Light rain","🌦"], 63:["Rain","🌧"], 65:["Heavy rain","🌧"],
    66:["Freezing rain","🌧"], 67:["Freezing rain","🌧"],
    71:["Light snow","🌨"], 73:["Snow","🌨"], 75:["Heavy snow","❄"], 77:["Snow grains","🌨"],
    80:["Showers","🌦"], 81:["Showers","🌧"], 82:["Heavy showers","⛈"],
    85:["Snow showers","🌨"], 86:["Snow showers","🌨"],
    95:["Thunderstorms","⛈"], 96:["Thunderstorms","⛈"], 99:["Thunderstorms","⛈"]
  };
  function wxFor(code){ return WMO[code] || ["—","•"]; }

  /* ---------------- tiny pub/sub for module wiring ---------------- */
  var subs = {};
  function on(name, fn){ (subs[name] = subs[name] || []).push(fn); }
  function emit(name, payload){
    (subs[name] || []).forEach(function(fn){
      try{ fn(payload); }catch(e){ /* one broken card must not stop the rest */ }
    });
  }

  function toast(t){ if (window.FX && FX.toast) FX.toast(t); }

  return {
    CONFIG: C, PROXY: PROXY,
    $: $, $$: $$, esc: esc, html: html, skeleton: skeleton, state: state,
    pad: pad, hm: hm, dur: dur, ago: ago, weekNumber: weekNumber,
    MONTHS: MONTHS, DAYS: DAYS,
    compass: compass, titleCase: titleCase, haversine: haversine,
    fetchTimeout: fetchTimeout, getJSON: getJSON, describeErr: describeErr,
    prefs: prefs, PREF_DEFAULTS: PREF_DEFAULTS,
    lsGet: lsGet, lsSet: lsSet,
    wxFor: wxFor,
    on: on, emit: emit, toast: toast
  };
})();
