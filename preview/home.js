/* =====================================================================
   home.js — the dashboard conductor.
   ---------------------------------------------------------------------
   Owns the clock, the greeting, the status rail and the one thing every
   card needs: a location. Each card module does its own work; this file
   just tells them where they are and when preferences change.
   ===================================================================== */

(function () {
  "use strict";

  var $ = H.$, esc = H.esc, pad = H.pad;
  var C = H.CONFIG;

  /* =====================================================================
     CLOCK + GREETING
     ===================================================================== */
  function tick(){
    var d = new Date();
    if ($("clock")) $("clock").textContent = pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
    if ($("datestr")) $("datestr").textContent =
      (H.DAYS[d.getDay()].slice(0,3) + " " + d.getDate() + " " + H.MONTHS[d.getMonth()].slice(0,3)).toUpperCase();
  }

  function greetingFor(h){
    if (h < 5)  return "Still up";
    if (h < 12) return "Morning";
    if (h < 18) return "Afternoon";
    if (h < 22) return "Evening";
    return "Late one";
  }

  /* Whoever is signed in, else the site owner. */
  function greetName(){
    var a = window.AUTH;
    if (a && a.signedIn){
      if (a.profile && a.profile.display_name) return a.profile.display_name;
      if (a.user && a.user.email) return a.user.email.split("@")[0];
    }
    return C.OWNER_NAME || "you";
  }

  function paintGreeting(){
    if ($("greeting")) $("greeting").textContent = greetingFor(new Date().getHours());
    if ($("owner")) $("owner").textContent = greetName();
  }

  /* =====================================================================
     STATUS RAIL
     ===================================================================== */
  function paintRail(){
    var now = new Date();
    if ($("daynum")) $("daynum").textContent = H.DAYS[now.getDay()] + " " + now.getDate() + " " + H.MONTHS[now.getMonth()];
    if ($("weeknum")) $("weeknum").textContent = "W" + H.weekNumber(now);

    /* how far through the year we are — a small, oddly satisfying number */
    var start = new Date(now.getFullYear(), 0, 1);
    var end = new Date(now.getFullYear() + 1, 0, 1);
    var pct = ((now - start) / (end - start)) * 100;
    if ($("yearpct") && window.FX) FX.count($("yearpct"), pct, { decimals:1, suffix:"%", duration:1100 });
    else if ($("yearpct")) $("yearpct").textContent = pct.toFixed(1) + "%";
  }

  H.on("overhead", function(n){
    var el = $("ohmeta");
    if (!el) return;
    el.textContent = n;
    var lbl = $("ohmetaUnit");
    if (lbl) lbl.textContent = n === 1 ? "AIRCRAFT" : "AIRCRAFT IN RANGE";
  });

  H.on("iss", function(d){
    var el = $("issmeta");
    if (el) el.textContent = Math.round(d.altitude) + " km";
  });

  /* =====================================================================
     LOCATION
     ===================================================================== */
  var located = false;

  function startAt(la, lo, label){
    if (located) return;
    located = true;
    if ($("posmeta")) $("posmeta").textContent = label;
    H.sky.locate(la, lo);
    H.weather.locate(la, lo);
    H.orbit.locate(la, lo);
    H.flights.locate(la, lo);
  }

  function locate(){
    if (!navigator.geolocation){
      startAt(C.FALLBACK_LAT, C.FALLBACK_LON, C.FALLBACK_LABEL || "default location");
      return;
    }
    if ($("posmeta")) $("posmeta").textContent = "locating…";
    navigator.geolocation.getCurrentPosition(
      function(p){
        startAt(p.coords.latitude, p.coords.longitude,
                p.coords.latitude.toFixed(2) + "°, " + p.coords.longitude.toFixed(2) + "°");
      },
      function(){
        startAt(C.FALLBACK_LAT, C.FALLBACK_LON, C.FALLBACK_LABEL || "default location");
      },
      { enableHighAccuracy:false, timeout:8000, maximumAge:600000 }
    );
  }

  /* =====================================================================
     PREFERENCES
     ===================================================================== */
  function applyPrefs(){
    var p = H.prefs();

    H.$$("[data-card]").forEach(function(el){
      var key = el.getAttribute("data-card");
      el.hidden = p.cards[key] === false;
    });

    if (p.flight_radius !== H.flights.radius()) H.flights.setRadius(p.flight_radius);
  }

  /* Hold the first feed fetch until preferences have settled, otherwise a
     signed-in user briefly sees everyone's default columns and we pay for
     two round trips. auth.js always announces once, even signed out. */
  var booted = false, lastKey = "";

  function bootFeeds(){
    if (booted) return;
    booted = true;
    var p = H.prefs();
    lastKey = p.topics.join(",") + "|" + p.games.join(",");
    H.feeds.loadAll();
  }

  /* =====================================================================
     COMMANDS
     ===================================================================== */
  function registerCommands(){
    if (!window.FX || !FX.register) return;

    var cards = [
      ["onthisday","On This Day"], ["sky","Sky"], ["weather","Weather"],
      ["overhead","Overhead"], ["feeds","Feeds"], ["esports","Esports"],
      ["orbit","Orbit"], ["links","Launchpad"], ["notes","Notes"]
    ];

    FX.register(cards.map(function(c){
      return {
        id: "jump-" + c[0], group:"Jump to", label: c[1], icon:"→", keywords:"card section scroll",
        run: function(){
          var el = document.querySelector('[data-card="' + c[0] + '"]');
          if (!el || el.hidden) return H.toast(c[1] + " is hidden in your preferences");
          el.scrollIntoView({ behavior:"smooth", block:"start" });
        }
      };
    }));

    FX.register([
      { id:"act-refresh-all", group:"Actions", label:"Refresh everything", icon:"↻",
        run: function(){
          H.otd.refresh(); H.weather.refresh(); H.flights.refresh();
          H.orbit.refresh(); H.feeds.loadAll(); H.sky.refresh();
          H.toast("Refreshing every card");
        } },
      { id:"act-otd", group:"Actions", label:"Another moment in history", icon:"↻",
        keywords:"on this day", run: function(){ H.otd.next(); } },
      { id:"act-news", group:"Actions", label:"Refresh headlines", icon:"↻",
        run: function(){ H.feeds.loadNews(); H.toast("Fetching headlines"); } },
      { id:"act-flights", group:"Actions", label:"Refresh aircraft", icon:"↻",
        keywords:"overhead planes", run: function(){ H.flights.refresh(); H.toast("Polling the sky"); } },
      { id:"act-note", group:"Actions", label:"New note", icon:"✎",
        keywords:"write todo", run: function(){ H.panels.focusNote(); } },
      { id:"act-prefs", group:"Actions", label:"Preferences", icon:"⚙",
        keywords:"account settings topics", run: function(){
          if (window.openPreferences) window.openPreferences();
          else H.toast("Sign-in isn't configured");
        } }
    ]);
  }

  /* =====================================================================
     BOOT
     ===================================================================== */
  paintGreeting();
  paintRail();
  tick();
  setInterval(tick, 1000);
  setInterval(paintRail, 60000);

  window.addEventListener("auth:changed", paintGreeting);

  window.addEventListener("prefs:changed", function(){
    var p = H.prefs();
    applyPrefs();
    if (!booted){ bootFeeds(); return; }

    /* afterwards, only re-fetch when the selection actually changed */
    var key = p.topics.join(",") + "|" + p.games.join(",");
    if (key !== lastKey){
      lastKey = key;
      H.feeds.loadAll();
    }
  });

  H.otd.mount();
  H.flights.mount();
  H.feeds.mount();
  H.orbit.mount();
  H.panels.mount();
  registerCommands();

  applyPrefs();
  locate();

  /* safety net: if auth.js is missing or errors, don't leave the cards empty */
  setTimeout(bootFeeds, 1500);
})();
