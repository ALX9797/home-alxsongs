/* =====================================================================
   fx.js — the "modern pixel" layer, shared by every page.
   ---------------------------------------------------------------------
   Purely presentational and progressive: if this file fails to load,
   the site looks and works exactly as before. It adds

     • swappable CRT palettes          (persisted per browser)
     • a scanline / CRT toggle
     • optional 8-bit sound effects
     • scroll-reveal for cards          (respects reduced-motion)

   All state lives in localStorage under "home.fx.*". No network, no deps.
   Loaded from <head> so the palette applies before first paint.
   ===================================================================== */

(function () {
  "use strict";

  var root = document.documentElement;
  var LS = {
    palette: "home.fx.palette",
    crt:     "home.fx.crt",
    sound:   "home.fx.sound"
  };
  var PALETTES = ["acid", "gameboy", "vapor", "amber"];
  var PAL_NAME = { acid: "Acid", gameboy: "Game Boy", vapor: "Vapor", amber: "Amber" };

  function get(k, d){ try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
  function set(k, v){ try { localStorage.setItem(k, v); } catch (e) {} }

  /* ---- apply saved look immediately (runs in <head>, pre-paint) ---- */
  root.classList.add("js");

  var palette = get(LS.palette, "acid");
  if (PALETTES.indexOf(palette) === -1) palette = "acid";
  if (palette !== "acid") root.setAttribute("data-palette", palette);

  if (get(LS.crt, "off") === "on") root.setAttribute("data-crt", "on");

  var soundOn = get(LS.sound, "off") === "on";
  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* =====================================================================
     8-bit sound — tiny square-wave blips, built on demand
     ===================================================================== */
  var actx = null;
  function audio(){
    if (actx) return actx;
    try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = null; }
    return actx;
  }
  function blip(freq, dur, type, vol){
    if (!soundOn) return;
    var ac = audio(); if (!ac) return;
    if (ac.state === "suspended") ac.resume();
    var o = ac.createOscillator(), g = ac.createGain();
    o.type = type || "square";
    o.frequency.value = freq;
    var t = ac.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.05, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (dur || 0.08));
    o.connect(g); g.connect(ac.destination);
    o.start(t); o.stop(t + (dur || 0.08) + 0.02);
  }
  function press(){ blip(440, 0.06, "square", 0.045); }
  function select(){ blip(660, 0.05, "square", 0.05); setTimeout(function(){ blip(880, 0.05, "square", 0.045); }, 45); }
  function chirpUp(){ blip(520, 0.05, "square", 0.05); setTimeout(function(){ blip(780, 0.07, "square", 0.05); }, 55); }
  function chirpDown(){ blip(600, 0.05, "square", 0.05); setTimeout(function(){ blip(360, 0.08, "square", 0.05); }, 55); }

  /* expose a minimal hook other scripts may use (optional) */
  window.FX = {
    sound: function(){ return soundOn; },
    play: function(name){ ({ press: press, select: select, up: chirpUp, down: chirpDown }[name] || press)(); }
  };

  /* =====================================================================
     DOM setup — dock, CRT overlay, reveals, sound wiring
     ===================================================================== */
  function boot(){
    if (!document.body) return;

    /* --- CRT overlay --- */
    var crt = document.createElement("div");
    crt.className = "crt";
    crt.setAttribute("aria-hidden", "true");
    document.body.appendChild(crt);

    /* --- control dock --- */
    var dock = document.createElement("div");
    dock.className = "dock";
    dock.innerHTML =
      '<div class="dock-label" id="fxLabel"></div>' +
      '<div class="dock-panel" id="fxPanel">' +
        '<button data-fx="palette" aria-label="Cycle colour palette" title="Colour palette">◧</button>' +
        '<button data-fx="crt" aria-label="Toggle CRT scanlines" title="CRT scanlines">▦</button>' +
        '<button data-fx="sound" aria-label="Toggle 8-bit sound" title="8-bit sound">♪</button>' +
      '</div>' +
      '<button class="dock-toggle" aria-label="Display options" title="Display options">✦</button>';
    document.body.appendChild(dock);

    var panel  = dock.querySelector("#fxPanel");
    var label  = dock.querySelector("#fxLabel");
    var bCrt   = dock.querySelector('[data-fx="crt"]');
    var bSound = dock.querySelector('[data-fx="sound"]');
    var toggle = dock.querySelector(".dock-toggle");

    function reflect(){
      bCrt.classList.toggle("on", root.getAttribute("data-crt") === "on");
      bSound.classList.toggle("on", soundOn);
    }
    reflect();

    var labelTimer = null;
    function flash(text){
      label.textContent = text;
      label.classList.add("show");
      clearTimeout(labelTimer);
      labelTimer = setTimeout(function(){ label.classList.remove("show"); }, 1400);
    }

    dock.addEventListener("click", function (e) {
      var b = e.target.closest("[data-fx], .dock-toggle");
      if (!b) return;

      if (b.classList.contains("dock-toggle")) {
        panel.classList.toggle("hide");
        press();
        return;
      }

      var fx = b.getAttribute("data-fx");
      if (fx === "palette") {
        var i = (PALETTES.indexOf(palette) + 1) % PALETTES.length;
        palette = PALETTES[i];
        if (palette === "acid") root.removeAttribute("data-palette");
        else root.setAttribute("data-palette", palette);
        set(LS.palette, palette);
        flash("Palette · " + PAL_NAME[palette]);
        select();
      } else if (fx === "crt") {
        var on = root.getAttribute("data-crt") !== "on";
        if (on) root.setAttribute("data-crt", "on"); else root.removeAttribute("data-crt");
        set(LS.crt, on ? "on" : "off");
        flash("CRT " + (on ? "on" : "off"));
        on ? chirpUp() : chirpDown();
        reflect();
      } else if (fx === "sound") {
        soundOn = !soundOn;
        set(LS.sound, soundOn ? "on" : "off");
        reflect();
        if (soundOn) { audio(); chirpUp(); flash("Sound on"); }
        else flash("Sound off");
      }
    });

    /* --- sound on general interactions --- */
    document.addEventListener("pointerdown", function (e) {
      if (!soundOn) return;
      if (e.target.closest(".dock")) return;   // dock plays its own
      var el = e.target.closest(".btn, .navchip, .chip, .key");
      if (!el) return;
      if (el.classList.contains("navchip")) select(); else press();
    });

    /* --- scroll reveal --- */
    var items = [].slice.call(document.querySelectorAll(".card, .hero, .pagehead"));
    items.forEach(function (el, i) {
      el.classList.add("reveal");
      el.style.setProperty("--i", (i % 6));
    });

    function revealAll(){ items.forEach(function (el) { el.classList.add("in"); }); }

    if (reduced || !("IntersectionObserver" in window)) {
      revealAll();
    } else {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
        });
      }, { rootMargin: "0px 0px -8% 0px", threshold: 0.06 });
      items.forEach(function (el) { io.observe(el); });
      /* safety net: never leave content hidden if the observer is starved */
      setTimeout(revealAll, 1600);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
