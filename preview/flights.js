/* =====================================================================
   flights.js — Overhead.
   ---------------------------------------------------------------------
   flights : adsb.lol / adsb.fi   (live ADS-B, community run, no key)
   routes  : adsbdb.com           (callsign -> origin / destination)
   photos  : planespotters.net    (mode-s hex -> photo)

   Map and radar are two views of the same poll. Selecting an aircraft
   anywhere selects it everywhere, and leaves a trail behind it.
   ===================================================================== */

(function () {
  "use strict";

  var $ = H.$, esc = H.esc, compass = H.compass;

  /* Type codes worth spelling out. Anything missing falls back to the
     feed's own description, then to the raw code. */
  var TYPES = {
    A319:"Airbus A319", A320:"Airbus A320", A20N:"Airbus A320neo", A321:"Airbus A321",
    A21N:"Airbus A321neo", A332:"Airbus A330-200", A333:"Airbus A330-300",
    A339:"Airbus A330-900", A343:"Airbus A340-300", A346:"Airbus A340-600",
    A359:"Airbus A350-900", A35K:"Airbus A350-1000", A388:"Airbus A380",
    B733:"Boeing 737-300", B738:"Boeing 737-800", B739:"Boeing 737-900",
    B38M:"Boeing 737 MAX 8", B39M:"Boeing 737 MAX 9", B752:"Boeing 757-200",
    B763:"Boeing 767-300", B772:"Boeing 777-200", B77L:"Boeing 777-200LR",
    B77W:"Boeing 777-300ER", B788:"Boeing 787-8", B789:"Boeing 787-9",
    B78X:"Boeing 787-10", B744:"Boeing 747-400", B748:"Boeing 747-8",
    BCS1:"Airbus A220-100", BCS3:"Airbus A220-300",
    E170:"Embraer 170", E190:"Embraer 190", E195:"Embraer 195",
    E75L:"Embraer 175", CRJ2:"Bombardier CRJ200", CRJ9:"Bombardier CRJ900",
    DH8D:"Dash 8 Q400", AT72:"ATR 72", AT76:"ATR 72-600",
    C172:"Cessna 172", C152:"Cessna 152", PA28:"Piper Cherokee",
    P28R:"Piper Arrow", SR22:"Cirrus SR22", DA42:"Diamond DA42",
    GLEX:"Bombardier Global", GL5T:"Global 5000", CL35:"Challenger 350",
    G280:"Gulfstream G280", C56X:"Citation Excel", E55P:"Phenom 300",
    EC35:"Airbus H135", EC45:"Airbus H145", A139:"AgustaWestland AW139",
    B06:"Bell 206", R44:"Robinson R44", S76:"Sikorsky S-76",
    D328:"Dornier 328", P68:"Partenavia P68"
  };

  var lat = null, lon = null;
  var radius = 20;
  var aircraft = [];        // latest poll, sorted
  var seen = {};            // hex -> true, so new arrivals can animate in
  var trails = {};          // hex -> [[lat,lon], …]
  var selected = null;
  var routes = {};          // callsign -> route | null (null = looked up, nothing found)
  var photos = {};          // hex -> photo | null
  var sortBy = "dst";
  var map = null, markers = {}, meMarker = null, rangeRing = null, trailLine = null;
  var view = "map";
  var pollTimer = null, retryTimer = null;

  /* ---------------- persisted radius ---------------- */
  try{
    var savedR = parseInt(localStorage.getItem("home.flightRadius"), 10);
    if (savedR >= 5 && savedR <= 100) radius = savedR;
  }catch(e){}
  if (!radius) radius = H.CONFIG.FLIGHT_RADIUS_NM || 20;

  /* ---------------- providers ----------------
     Community feeds, tried in order; whichever answers first is kept for
     next time. Same response shape either way — adsb.fi additionally
     gives us "desc" and "ownOp". */
  var PROVIDERS = H.PROXY
    ? [ { name:"proxy", url:function(la,lo,r){ return H.PROXY + "?lat=" + la + "&lon=" + lo + "&dist=" + r; } } ]
    : [ { name:"adsb.lol", url:function(la,lo,r){ return "https://api.adsb.lol/v2/lat/"+la+"/lon/"+lo+"/dist/"+r; } },
        { name:"adsb.fi",  url:function(la,lo,r){ return "https://opendata.adsb.fi/api/v3/lat/"+la+"/lon/"+lo+"/dist/"+r; } } ];
  var provider = 0;

  /* ---------------- naming ---------------- */
  function typeName(a){
    if (typeof a === "string") return TYPES[a] || a || "Unknown type";
    if (TYPES[a.t]) return TYPES[a.t];
    if (a.desc) return H.titleCase(a.desc);
    return a.t || "Unknown type";
  }
  function callOf(a){ return (a.flight || "").trim() || a.r || (a.hex || "").toUpperCase(); }
  function cleanOp(s){ return s ? String(s).replace(/\s*\[[^\]]*\]\s*/g, "").trim() : null; }
  function operatorOf(a){
    var rt = routeFor(a);
    return (rt && rt.airline) || cleanOp(a.ownOp) || null;
  }
  function altOf(a){ return typeof a.alt_baro === "number" ? Math.round(a.alt_baro).toLocaleString() + " ft" : "—"; }

  /* ---------------- routes ---------------- */
  function routeFor(a){
    var cs = (a.flight || "").trim();
    if (!cs) return null;
    return routes[cs] || null;
  }

  function fetchRoutes(list){
    var todo = list.slice(0, 12).map(function(a){ return (a.flight||"").trim(); })
      .filter(function(cs){ return cs && !(cs in routes); });
    if (!todo.length) return;

    todo.forEach(function(cs){
      routes[cs] = undefined;   // in flight; don't request twice
      H.fetchTimeout("https://api.adsbdb.com/v0/callsign/" + encodeURIComponent(cs), 8000)
        .then(function(r){ return r.ok ? r.json() : null; })
        .then(function(j){
          var fr = j && j.response && j.response.flightroute;
          routes[cs] = fr ? {
            airline: fr.airline ? fr.airline.name : null,
            radio:   fr.airline ? fr.airline.callsign : null,
            from: fr.origin ? {
              code: fr.origin.iata_code || fr.origin.icao_code,
              city: fr.origin.municipality, name: fr.origin.name, country: fr.origin.country_name
            } : null,
            to: fr.destination ? {
              code: fr.destination.iata_code || fr.destination.icao_code,
              city: fr.destination.municipality, name: fr.destination.name, country: fr.destination.country_name
            } : null
          } : null;
          renderList();
          if (selected) renderDetail();
        })
        .catch(function(){ routes[cs] = null; });
    });
  }

  /* ---------------- photos ---------------- */
  function fetchPhoto(hex){
    if (hex in photos) return Promise.resolve(photos[hex]);
    photos[hex] = undefined;
    return H.fetchTimeout("https://api.planespotters.net/pub/photos/hex/" + hex, 8000)
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(j){
        var p = j && j.photos && j.photos[0];
        photos[hex] = p ? {
          src: (p.thumbnail_large && p.thumbnail_large.src) || p.thumbnail.src,
          by: p.photographer, link: p.link
        } : null;
        return photos[hex];
      })
      .catch(function(){ photos[hex] = null; return null; });
  }

  /* ---------------- map ---------------- */
  function accent(){
    return getComputedStyle(document.documentElement).getPropertyValue("--acid").trim() || "#d8ff3e";
  }

  function planeIcon(a, isSel){
    var rot = (a.track != null ? a.track : 0);
    return L.divIcon({
      className: "plane-ico" + (isSel ? " sel" : ""),
      html: '<svg width="22" height="22" viewBox="-11 -11 22 22" style="transform:rotate(' + rot.toFixed(0) + 'deg)">' +
              '<path d="M0 -9 L2.9 2.5 L0 0.9 L-2.9 2.5 Z"/></svg>' +
            '<span class="tag-lbl">' + esc(callOf(a)) + '</span>',
      iconSize: [22,22], iconAnchor: [11,11]
    });
  }

  function initMap(){
    if (map || typeof L === "undefined" || !$("map")) return;
    map = L.map("map", {
      center: [lat, lon], zoom: 9, zoomControl: true,
      attributionControl: true, scrollWheelZoom: true
    });
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: "&copy; OpenStreetMap &copy; CARTO", subdomains: "abcd", maxZoom: 18
    }).addTo(map);

    meMarker = L.circleMarker([lat, lon], {
      radius: 4, color: accent(), fillColor: accent(), fillOpacity: 1, weight: 0
    }).addTo(map);

    fitToRadius();
  }

  function fitToRadius(){
    if (!map) return;
    if (rangeRing) map.removeLayer(rangeRing);
    rangeRing = L.circle([lat, lon], {
      radius: radius * 1852, color: accent(), weight: 1,
      opacity: .3, fillOpacity: .02, dashArray: "3 5"
    }).addTo(map);
    map.fitBounds(rangeRing.getBounds(), { padding: [12,12] });
  }

  function syncMarkers(){
    if (!map) return;
    var live = {};
    aircraft.forEach(function(a){
      if (typeof a.lat !== "number" || typeof a.lon !== "number") return;
      live[a.hex] = true;
      var isSel = selected === a.hex;
      if (markers[a.hex]){
        markers[a.hex].setLatLng([a.lat, a.lon]);
        markers[a.hex].setIcon(planeIcon(a, isSel));
      } else {
        var m = L.marker([a.lat, a.lon], { icon: planeIcon(a, isSel) }).addTo(map);
        m.on("click", function(){ select(a.hex); });
        markers[a.hex] = m;
      }
    });
    Object.keys(markers).forEach(function(h){
      if (!live[h]){ map.removeLayer(markers[h]); delete markers[h]; }
    });
    drawTrail();
  }

  /* the breadcrumb behind whichever aircraft is selected */
  function drawTrail(){
    if (!map) return;
    if (trailLine){ map.removeLayer(trailLine); trailLine = null; }
    var pts = selected && trails[selected];
    if (!pts || pts.length < 2) return;
    trailLine = L.polyline(pts, {
      color: accent(), weight: 1.6, opacity: .65, dashArray: "1 4", lineCap: "round"
    }).addTo(map);
  }

  /* ---------------- radar ---------------- */
  function drawBlips(){
    var host = $("blips");
    if (!host) return;
    var out = "";
    aircraft.slice(0, 40).forEach(function(a){
      var r = Math.min(a.dst / radius, 1) * 88;
      var th = (a.dir || 0) * Math.PI / 180;
      var x = 100 + Math.sin(th) * r;
      var y = 100 - Math.cos(th) * r;
      var cls = "blip" + (selected === a.hex ? " sel" : (a.dst < radius/3 ? " near" : ""));
      out += '<g transform="translate(' + x.toFixed(1) + ',' + y.toFixed(1) + ') rotate(' + (a.track||0).toFixed(0) + ')" ' +
             'data-hex="' + esc(a.hex) + '">' +
             '<path class="' + cls + '" d="M0 -4 L2.6 3 L0 1.4 L-2.6 3 Z"><title>' +
             esc(callOf(a)) + ' · ' + a.dst.toFixed(1) + ' nm</title></path></g>';
    });
    host.innerHTML = out;
  }

  /* ---------------- list ---------------- */
  function sorted(){
    var list = aircraft.slice();
    if (sortBy === "alt")  list.sort(function(a,b){ return (b.alt_baro||0) - (a.alt_baro||0); });
    else if (sortBy === "gs") list.sort(function(a,b){ return (b.gs||0) - (a.gs||0); });
    else list.sort(function(a,b){ return a.dst - b.dst; });
    return list;
  }

  function renderStats(){
    var el = $("ohStats");
    if (!el) return;
    if (!aircraft.length){ el.innerHTML = ""; return; }
    var closest = aircraft.reduce(function(m,a){ return a.dst < m.dst ? a : m; });
    var highest = aircraft.reduce(function(m,a){ return (a.alt_baro||0) > (m.alt_baro||0) ? a : m; });
    var fastest = aircraft.reduce(function(m,a){ return (a.gs||0) > (m.gs||0) ? a : m; });
    el.innerHTML =
      '<div><div class="k">In range</div><div class="v">' + aircraft.length + '</div></div>' +
      '<div><div class="k">Closest</div><div class="v">' + closest.dst.toFixed(1) + ' <small>NM</small></div></div>' +
      '<div><div class="k">Highest</div><div class="v">' +
        (typeof highest.alt_baro === "number" ? Math.round(highest.alt_baro/100) : "—") + ' <small>FL</small></div></div>' +
      '<div><div class="k">Fastest</div><div class="v">' +
        (fastest.gs ? Math.round(fastest.gs) : "—") + ' <small>KT</small></div></div>';
  }

  function renderList(){
    var box = $("flights");
    if (!box) return;

    if (!aircraft.length){
      box.innerHTML = '<div class="state">Quiet skies. Nothing airborne within ' + radius + ' nm.</div>';
      H.emit("overhead", 0);
      renderStats();
      return;
    }
    H.emit("overhead", aircraft.length);
    renderStats();

    box.innerHTML = sorted().slice(0, 16).map(function(a){
      var rt = routeFor(a);
      var op = operatorOf(a);
      var routeLine = rt && rt.from && rt.to
        ? '<div class="fl-route">' + esc(rt.from.code) + ' <span class="ar">→</span> ' + esc(rt.to.code) +
          '<span class="ar"> · ' + esc(rt.to.city || "") + '</span></div>'
        : "";
      var climb = a.baro_rate > 300 ? " ↑" : (a.baro_rate < -300 ? " ↓" : "");
      var fresh = seen[a.hex] ? "" : " fl-new";
      seen[a.hex] = true;

      return '<div class="fl-row' + (selected === a.hex ? " sel" : "") + fresh + '" data-hex="' + esc(a.hex) + '">' +
        '<div>' +
          '<div class="fl-call">' + esc(callOf(a)) + '</div>' +
          (op ? '<div class="fl-op">' + esc(op) + '</div>' : "") +
          routeLine +
          '<div class="fl-sub">' + esc(typeName(a)) + ' · ' + a.dst.toFixed(1) + ' nm ' + compass(a.dir || 0) + '</div>' +
        '</div>' +
        '<div class="fl-alt">' + altOf(a) + climb +
          '<span>' + (a.gs ? Math.round(a.gs) + " kt" : "") + '</span></div>' +
      '</div>';
    }).join("");
  }

  /* ---------------- detail ---------------- */
  function byHex(hex){
    for (var i = 0; i < aircraft.length; i++) if (aircraft[i].hex === hex) return aircraft[i];
    return null;
  }

  function select(hex){
    selected = hex;
    renderDetail();
    renderList();
    drawBlips();
    syncMarkers();
    var a = byHex(hex);
    if (map && a && typeof a.lat === "number") map.panTo([a.lat, a.lon]);
    if (window.FX) FX.play("select");
  }

  function deselect(){
    selected = null;
    var side = $("ohSide"), det = $("detail");
    if (side) side.classList.remove("detail-on");
    if (det) det.classList.remove("on");
    renderList(); drawBlips(); syncMarkers();
  }

  function stat(k, v){ return '<div><div class="k">' + k + '</div><div class="v">' + v + '</div></div>'; }

  function renderDetail(){
    var a = byHex(selected);
    if (!a){ deselect(); return; }

    $("ohSide").classList.add("detail-on");
    $("detail").classList.add("on");

    var rt = routeFor(a);
    var op = operatorOf(a);
    var ph = photos[a.hex];

    var routeBlock = rt && rt.from && rt.to
      ? '<div class="d-route">' +
          '<div><div class="code">' + esc(rt.from.code) + '</div><div class="place">' +
            esc(rt.from.city || "") + '<br>' + esc(rt.from.country || "") + '</div></div>' +
          '<div class="mid">→</div>' +
          '<div class="to"><div class="code">' + esc(rt.to.code) + '</div><div class="place">' +
            esc(rt.to.city || "") + '<br>' + esc(rt.to.country || "") + '</div></div>' +
        '</div>'
      : (rt === null
          ? '<div class="state" style="padding:10px 0">No published route for this callsign.</div>'
          : '<div class="state" style="padding:10px 0">Looking up route…</div>');

    var photoBlock = ph
      ? '<div class="d-photo"><img src="' + esc(ph.src) + '" alt="" loading="lazy">' +
        '<div class="cred">photo: ' + esc(ph.by || "unknown") + ' · planespotters.net</div></div>'
      : "";

    var vs = typeof a.baro_rate === "number"
      ? (a.baro_rate > 0 ? "+" : "") + Math.round(a.baro_rate) + " fpm" : "—";
    var trailLen = (trails[a.hex] || []).length;

    $("detail").innerHTML =
      '<button class="btn ghost d-back" id="dBack"><span>← all aircraft</span></button>' +
      '<div class="d-call">' + esc(callOf(a)) + '</div>' +
      (op ? '<div class="d-op">' + esc(op) + '</div>' : "") +
      ((rt && rt.radio) ? '<div class="d-radio">radio: ' + esc(rt.radio) + '</div>' : "") +
      photoBlock +
      routeBlock +
      '<div class="kv">' +
        stat("Aircraft", esc(typeName(a))) +
        stat("Registration", esc(a.r || "—")) +
        stat("Altitude", altOf(a)) +
        stat("Vertical", vs) +
        stat("Ground speed", a.gs ? Math.round(a.gs) + " kt" : "—") +
        stat("Heading", a.track != null ? Math.round(a.track) + "° " + compass(a.track) : "—") +
        stat("Distance", a.dst.toFixed(1) + " nm") +
        stat("Bearing", compass(a.dir || 0) + " " + Math.round(a.dir || 0) + "°") +
        stat("Squawk", esc(a.squawk || "—")) +
        stat("Mode S", esc((a.hex || "").toUpperCase())) +
      '</div>' +
      '<div class="d-foot">' +
        '<a class="btn" target="_blank" rel="noopener" href="https://globe.adsb.lol/?icao=' + esc(a.hex) +
          '"><span>track on adsb.lol ↗</span></a>' +
        (trailLen > 1 ? '<span class="mono-sm" style="align-self:center">' + trailLen + ' fixes tracked</span>' : "") +
      '</div>';

    $("dBack").addEventListener("click", deselect);

    if (!(a.hex in photos)){
      fetchPhoto(a.hex).then(function(){ if (selected === a.hex) renderDetail(); });
    }
  }

  /* ---------------- polling ---------------- */
  function applyFlights(j){
    aircraft = (j.ac || []).filter(function(a){
      return a.alt_baro !== "ground" && typeof a.dst === "number" && a.t !== "TWR";
    }).sort(function(a,b){ return a.dst - b.dst; });

    /* remember where everything has been, capped so memory stays flat */
    var liveHex = {};
    aircraft.forEach(function(a){
      liveHex[a.hex] = true;
      if (typeof a.lat !== "number" || typeof a.lon !== "number") return;
      var t = trails[a.hex] || (trails[a.hex] = []);
      var last = t[t.length - 1];
      if (!last || last[0] !== a.lat || last[1] !== a.lon) t.push([a.lat, a.lon]);
      if (t.length > 40) t.shift();
    });
    Object.keys(trails).forEach(function(h){
      if (!liveHex[h] && h !== selected) delete trails[h];
    });

    fetchRoutes(aircraft);
    renderList();
    drawBlips();
    syncMarkers();
    if (selected) renderDetail();
  }

  /* Upstreams throttle intermittently, so a single miss isn't worth
     showing anyone. Retry twice, quickly, before admitting defeat. */
  var RETRY_MS = [1500, 4000];

  function load(attemptNo){
    if (lat == null) return;
    attemptNo = attemptNo || 0;
    clearTimeout(retryTimer);

    var la = lat.toFixed(4), lo = lon.toFixed(4);
    var tried = [];

    var order = [provider];
    PROVIDERS.forEach(function(_, i){ if (i !== provider) order.push(i); });

    function giveUp(){
      /* already showing aircraft? keep them and say so quietly rather than
         blanking a working card over a transient blip */
      if (aircraft.length){
        if ($("flSource")) $("flSource").textContent = "reconnecting…";
        return;
      }
      if ($("flSource")) $("flSource").textContent = "";
      var hint = H.PROXY
        ? "Check the Worker is deployed and that FLIGHT_PROXY in config.js matches its URL."
        : "No FLIGHT_PROXY set in config.js. If you have already set one, you are seeing " +
          "a cached config.js — hard refresh (Ctrl/Cmd+Shift+R).";
      $("flights").innerHTML =
        '<div class="state err">No flight feed reachable.</div>' +
        '<div class="state" style="padding-top:4px">' +
          tried.map(function(t){ return esc(t.name) + " — " + esc(t.why); }).join("<br>") +
        '</div>' +
        '<div class="state" style="padding-top:8px;color:var(--ink-dim)">' + hint + '</div>';
    }

    function attempt(n){
      if (n >= order.length){
        if (attemptNo < RETRY_MS.length){
          if (!aircraft.length) H.state($("flights"), "Feed busy, retrying…");
          else if ($("flSource")) $("flSource").textContent = "retrying…";
          retryTimer = setTimeout(function(){ load(attemptNo + 1); }, RETRY_MS[attemptNo]);
          return;
        }
        giveUp();
        return;
      }

      var i = order[n], p = PROVIDERS[i];
      H.fetchTimeout(p.url(la, lo, radius), 9000)
        .then(function(r){
          if (!r.ok){ var e = new Error("http"); e.status = r.status; throw e; }
          /* the Worker tells us which upstream served it, and how old it is */
          var upstream = null, cacheState = null, fetchedAt = null;
          try{
            upstream   = r.headers.get("X-Source");
            cacheState = r.headers.get("X-Cache");
            fetchedAt  = r.headers.get("X-Fetched-At");
          }catch(err){}
          return r.json().then(function(j){
            return { data:j, upstream:upstream, cacheState:cacheState, fetchedAt:fetchedAt };
          });
        })
        .then(function(res){
          provider = i;
          var label = "via " + (res.upstream || p.name);
          if (res.cacheState === "STALE"){
            var age = res.fetchedAt ? Math.round((Date.now() - new Date(res.fetchedAt).getTime())/1000) : null;
            label += age ? " · " + (age < 90 ? age + "s" : Math.round(age/60) + "m") + " old" : " · cached";
          }
          if ($("flSource")) $("flSource").textContent = label;
          applyFlights(res.data);
        })
        .catch(function(e){
          tried.push({ name:p.name, why:H.describeErr(e) });
          attempt(n + 1);
        });
    }

    attempt(0);
  }

  /* ---------------- controls ---------------- */
  function setRadius(r, save){
    radius = r;
    if ($("radiusSlider")) $("radiusSlider").value = r;
    if ($("radiusVal")) $("radiusVal").textContent = r + " nm";
    if ($("rng1")) $("rng1").textContent = Math.round(r * 0.67) + "nm";
    if ($("rng2")) $("rng2").textContent = r + "nm";
    if (save !== false){ try{ localStorage.setItem("home.flightRadius", r); }catch(e){} }
  }

  function mount(){
    setRadius(radius, false);

    var slideTimer = null;
    var slider = $("radiusSlider");
    if (slider) slider.addEventListener("input", function(){
      setRadius(+this.value);
      clearTimeout(slideTimer);
      slideTimer = setTimeout(function(){ fitToRadius(); load(); }, 350);
    });

    var tog = $("viewtog");
    if (tog) tog.addEventListener("click", function(e){
      var b = e.target.closest("[data-view]");
      if (!b) return;
      H.$$("button", this).forEach(function(c){ c.classList.remove("on"); });
      b.classList.add("on");
      view = b.getAttribute("data-view");
      $("radarView").classList.toggle("on", view === "radar");
      $("map").classList.toggle("off", view === "radar");
      if (view === "map" && map) setTimeout(function(){ map.invalidateSize(); fitToRadius(); }, 30);
    });

    var sortTog = $("sorttog");
    if (sortTog) sortTog.addEventListener("click", function(e){
      var b = e.target.closest("[data-sort]");
      if (!b) return;
      H.$$("button", this).forEach(function(c){ c.classList.remove("on"); });
      b.classList.add("on");
      sortBy = b.getAttribute("data-sort");
      renderList();
    });

    var ref = $("flRefresh");
    if (ref) ref.addEventListener("click", function(){
      this.classList.remove("spin"); void this.offsetWidth; this.classList.add("spin");
      load();
    });

    var list = $("flights");
    if (list) list.addEventListener("click", function(e){
      var row = e.target.closest("[data-hex]");
      if (row) select(row.getAttribute("data-hex"));
    });

    var blips = $("blips");
    if (blips) blips.addEventListener("click", function(e){
      var g = e.target.closest("[data-hex]");
      if (g) select(g.getAttribute("data-hex"));
    });

    /* the map's accent colour follows the palette */
    window.addEventListener("fx:palette", function(){
      if (!map) return;
      if (meMarker) meMarker.setStyle({ color: accent(), fillColor: accent() });
      fitToRadius();
      drawTrail();
    });
  }

  function locate(la, lo){
    lat = la; lon = lo;
    initMap();
    load();
    clearInterval(pollTimer);
    pollTimer = setInterval(load, 30000);
  }

  H.flights = {
    mount: mount,
    locate: locate,
    refresh: function(){ load(); },
    setRadius: function(r){ setRadius(r); fitToRadius(); load(); },
    radius: function(){ return radius; },
    count: function(){ return aircraft.length; }
  };
})();
