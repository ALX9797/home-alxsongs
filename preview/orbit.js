/* =====================================================================
   orbit.js — Orbit. Where the International Space Station is right now.
   ---------------------------------------------------------------------
   Source: wheretheiss.at (free, keyless, CORS-friendly). We plot it on
   an equirectangular graticule with the real day/night terminator drawn
   from the subsolar point the API hands back — no basemap, no tiles, no
   third-party rendering. Ground track comes from the same API's
   positions endpoint, ten fixes ahead.
   ===================================================================== */

(function () {
  "use strict";

  var $ = H.$, esc = H.esc;

  var API = "https://api.wheretheiss.at/v1/satellites/25544";
  var lat = null, lon = null, timer = null, track = [];

  /* equirectangular projection into a 360 × 180 viewBox */
  function px(lo){ return lo + 180; }
  function py(la){ return 90 - la; }

  /* ---- night side: the great circle 90° from the subsolar point ---- */
  function terminator(sLat, sLon){
    var r = Math.PI / 180;
    var tanS = Math.tan(sLat * r);
    if (Math.abs(tanS) < 1e-4) tanS = tanS < 0 ? -1e-4 : 1e-4;

    var pts = [];
    for (var lo = -180; lo <= 180; lo += 3){
      var phi = Math.atan(-Math.cos((lo - sLon) * r) / tanS) / r;
      pts.push([px(lo), py(phi)]);
    }
    /* the unlit hemisphere is the one away from the sun */
    var edge = sLat > 0 ? 180 : 0;
    var d = "M" + pts.map(function(p){ return p[0].toFixed(1) + " " + p[1].toFixed(1); }).join(" L");
    d += " L360 " + edge + " L0 " + edge + " Z";
    return d;
  }

  /* ---- ground track, split wherever it crosses the antimeridian ---- */
  function trackPaths(list){
    var runs = [], run = [];
    list.forEach(function(p, i){
      if (i && Math.abs(p.longitude - list[i-1].longitude) > 180){
        runs.push(run); run = [];
      }
      run.push([px(p.longitude), py(p.latitude)]);
    });
    if (run.length) runs.push(run);
    return runs.filter(function(r){ return r.length > 1; }).map(function(r){
      return '<path class="track" d="M' +
        r.map(function(p){ return p[0].toFixed(1) + " " + p[1].toFixed(1); }).join(" L") + '"/>';
    }).join("");
  }

  function graticule(){
    var out = "";
    for (var lo = -150; lo <= 150; lo += 30) out += '<line class="grat" x1="' + px(lo) + '" y1="0" x2="' + px(lo) + '" y2="180"/>';
    for (var la = -60; la <= 60; la += 30) out += '<line class="grat" x1="0" y1="' + py(la) + '" x2="360" y2="' + py(la) + '"/>';
    out += '<line class="grat" x1="0" y1="90" x2="360" y2="90" stroke-width=".5"/>';
    out += '<rect class="grat" x="0" y="0" width="360" height="180" fill="none"/>';
    return out;
  }

  function render(d){
    var box = $("orbit");
    if (!box) return;

    var here = (lat != null)
      ? '<circle class="home" cx="' + px(lon).toFixed(1) + '" cy="' + py(lat).toFixed(1) + '" r="1.8"/>'
      : "";

    var dist = (lat != null) ? H.haversine(lat, lon, d.latitude, d.longitude) : null;
    var overhead = dist != null && d.footprint && dist < d.footprint / 2;

    var svg =
      '<svg viewBox="0 0 360 180" role="img" aria-label="ISS ground position">' +
        graticule() +
        (d.solar_lat != null ? '<path class="night" d="' + terminator(d.solar_lat, d.solar_lon) + '"/>' : "") +
        trackPaths(track) +
        here +
        '<circle class="halo" cx="' + px(d.longitude).toFixed(1) + '" cy="' + py(d.latitude).toFixed(1) + '" r="2"/>' +
        '<circle class="iss" cx="' + px(d.longitude).toFixed(1) + '" cy="' + py(d.latitude).toFixed(1) + '" r="2.4"/>' +
      '</svg>';

    box.innerHTML =
      '<div class="orbit-wrap">' +
        '<div class="orbit-map">' + svg + '</div>' +
        '<div class="kv">' +
          k("Latitude", d.latitude.toFixed(2) + "°") +
          k("Longitude", d.longitude.toFixed(2) + "°") +
          k("Altitude", Math.round(d.altitude) + " km") +
          k("Speed", Math.round(d.velocity).toLocaleString() + " km/h") +
          k("Sunlight", d.visibility === "daylight" ? "in daylight" : "in eclipse", d.visibility === "daylight" ? "hot" : "ice") +
          k("From you", dist == null ? "—" : Math.round(dist).toLocaleString() + " km", overhead ? "hot" : "") +
        '</div>' +
        (overhead
          ? '<div class="tag hot">Above your horizon right now — look up.</div>'
          : '<div class="tag">Below your horizon · ' +
            (dist == null ? "" : Math.round(dist).toLocaleString() + " km away") + '</div>') +
      '</div>';

    if ($("orbitMeta")) $("orbitMeta").textContent = "updated " + H.hm(new Date());
  }

  function k(key, val, cls){
    return '<div><div class="k">' + esc(key) + '</div><div class="v ' + (cls || "") + '">' + esc(val) + '</div></div>';
  }

  /* Ten fixes, five minutes apart — roughly half an orbit ahead. */
  function loadTrack(){
    var now = Math.floor(Date.now() / 1000);
    var stamps = [];
    for (var i = 0; i < 10; i++) stamps.push(now + i * 300);
    return H.getJSON(API + "/positions?timestamps=" + stamps.join(",") + "&units=kilometers", 9000)
      .then(function(list){ track = list || []; })
      .catch(function(){ track = []; });
  }

  function load(){
    H.getJSON(API + "?units=kilometers", 9000)
      .then(function(d){
        render(d);
        H.emit("iss", d);
      })
      .catch(function(){
        var box = $("orbit");
        if (box && !box.querySelector(".orbit-map")) H.state(box, "Couldn't reach the ISS feed.", true);
      });
  }

  function mount(){
    H.skeleton($("orbit"), 3);
    loadTrack().then(load);
    clearInterval(timer);
    timer = setInterval(load, 15000);
    setInterval(function(){ loadTrack(); }, 300000);

    var b = $("orbitRefresh");
    if (b) b.addEventListener("click", function(){
      this.classList.remove("spin"); void this.offsetWidth; this.classList.add("spin");
      loadTrack().then(load);
    });
  }

  H.orbit = {
    mount: mount,
    locate: function(la, lo){ lat = la; lon = lo; },
    refresh: load
  };
})();
