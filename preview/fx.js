/* =====================================================================
   fx.js — the shared experience layer.
   ---------------------------------------------------------------------
   Purely presentational and progressive: if this file never loads, every
   page still renders and works. It adds

     • six swappable palettes incl. a light one   (persisted per browser)
     • CRT / scanline toggle
     • optional 8-bit sound
     • scroll reveals, pointer spotlight, card sheen
     • a command palette (⌘K / Ctrl-K) other pages can extend
     • toasts, animated counters, a scroll progress rail

   State lives in localStorage under "home.fx.*". No network, no deps.
   Loaded from <head> so the palette is applied before first paint.
   ===================================================================== */

(function () {
  "use strict";

  var root = document.documentElement;
  var LS = { palette:"home.fx.palette", crt:"home.fx.crt", sound:"home.fx.sound" };

  var PALETTES = [
    { id:"acid",    name:"Acid",     bg:"#08090b", a:"#d8ff3e", b:"#ff3d7f" },
    { id:"ultra",   name:"Ultra",    bg:"#04060d", a:"#5b8cff", b:"#7fe0d4" },
    { id:"vapor",   name:"Vapor",    bg:"#0d0620", a:"#67e8f9", b:"#ff5db1" },
    { id:"gameboy", name:"Game Boy", bg:"#081204", a:"#b6e02a", b:"#82d05a" },
    { id:"amber",   name:"Amber",    bg:"#080500", a:"#ffb020", b:"#ff7a3d" },
    { id:"paper",   name:"Paper",    bg:"#f4f3ef", a:"#4d6b00", b:"#c81e5c" }
  ];
  var IDS = PALETTES.map(function(p){ return p.id; });

  function get(k, d){ try{ var v = localStorage.getItem(k); return v == null ? d : v; }catch(e){ return d; } }
  function set(k, v){ try{ localStorage.setItem(k, v); }catch(e){} }

  /* ---- apply the saved look immediately, before first paint ---- */
  root.classList.add("js");

  var palette = get(LS.palette, "acid");
  if (IDS.indexOf(palette) === -1) palette = "acid";
  applyPalette(palette, true);

  if (get(LS.crt, "off") === "on") root.setAttribute("data-crt", "on");

  var soundOn = get(LS.sound, "off") === "on";
  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function applyPalette(id, silent){
    palette = id;
    if (id === "acid") root.removeAttribute("data-palette");
    else root.setAttribute("data-palette", id);
    set(LS.palette, id);
    /* keep the browser UI in step with the page */
    var meta = document.querySelector('meta[name="theme-color"]');
    var def = PALETTES.filter(function(p){ return p.id === id; })[0];
    if (meta && def) meta.setAttribute("content", def.bg);
    if (!silent) window.dispatchEvent(new CustomEvent("fx:palette", { detail: id }));
  }

  /* =====================================================================
     8-bit sound — square-wave blips, built on demand
     ===================================================================== */
  var actx = null;
  function audio(){
    if (actx) return actx;
    try{ actx = new (window.AudioContext || window.webkitAudioContext)(); }catch(e){ actx = null; }
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
  function press(){ blip(440, .06, "square", .045); }
  function sel(){ blip(660, .05, "square", .05); setTimeout(function(){ blip(880, .05, "square", .045); }, 45); }
  function up(){ blip(520, .05, "square", .05); setTimeout(function(){ blip(780, .07, "square", .05); }, 55); }
  function down(){ blip(600, .05, "square", .05); setTimeout(function(){ blip(360, .08, "square", .05); }, 55); }
  function coin(){ blip(988, .06, "square", .05); setTimeout(function(){ blip(1319, .22, "square", .045); }, 60); }
  var SOUNDS = { press:press, select:sel, up:up, down:down, coin:coin };

  /* =====================================================================
     Toasts
     ===================================================================== */
  var toastHost = null;
  function toast(text, ms){
    if (!document.body) return;
    if (!toastHost){
      toastHost = document.createElement("div");
      toastHost.className = "toasts";
      toastHost.setAttribute("aria-live", "polite");
      document.body.appendChild(toastHost);
    }
    var el = document.createElement("div");
    el.className = "toast";
    el.textContent = text;
    toastHost.appendChild(el);
    setTimeout(function(){
      el.classList.add("out");
      setTimeout(function(){ el.remove(); }, 300);
    }, ms || 2200);
  }

  /* =====================================================================
     Animated counters — respects reduced-motion by jumping to the value
     ===================================================================== */
  function count(el, to, opts){
    opts = opts || {};
    var from = typeof opts.from === "number" ? opts.from : 0;
    var dp = opts.decimals || 0;
    var suffix = opts.suffix || "";
    var prefix = opts.prefix || "";
    var dur = opts.duration || 900;
    if (reduced || !el){
      if (el) el.textContent = prefix + to.toFixed(dp) + suffix;
      return;
    }
    var t0 = performance.now();
    (function step(now){
      var p = Math.min(1, (now - t0) / dur);
      var e = 1 - Math.pow(1 - p, 3);
      el.textContent = prefix + (from + (to - from) * e).toFixed(dp) + suffix;
      if (p < 1) requestAnimationFrame(step);
    })(t0);
  }

  /* =====================================================================
     Command palette
     ===================================================================== */
  var commands = [];
  var cmdBg = null, cmdInput = null, cmdList = null, cmdIdx = 0, cmdShown = [];

  function register(list){
    (list || []).forEach(function(c){
      /* replacing by id keeps re-registration idempotent */
      commands = commands.filter(function(x){ return x.id !== c.id; });
      commands.push(c);
    });
  }

  function buildPalette(){
    if (cmdBg) return;
    cmdBg = document.createElement("div");
    cmdBg.className = "cmdk-bg";
    cmdBg.innerHTML =
      '<div class="cmdk" role="dialog" aria-modal="true" aria-label="Command palette">' +
        '<div class="cmdk-in"><span>&gt;</span>' +
          '<input type="text" id="cmdkInput" placeholder="Jump to, or run something…" ' +
            'autocomplete="off" spellcheck="false" aria-label="Command"></div>' +
        '<div class="cmdk-list" id="cmdkList"></div>' +
        '<div class="cmdk-foot"><span class="kbd">↑↓</span> move ' +
          '<span class="kbd">↵</span> run <span class="kbd">esc</span> close</div>' +
      '</div>';
    document.body.appendChild(cmdBg);
    cmdInput = cmdBg.querySelector("#cmdkInput");
    cmdList = cmdBg.querySelector("#cmdkList");

    cmdBg.addEventListener("click", function(e){ if (e.target === cmdBg) closePalette(); });
    cmdInput.addEventListener("input", function(){ cmdIdx = 0; drawPalette(); });
    cmdInput.addEventListener("keydown", function(e){
      if (e.key === "ArrowDown"){ e.preventDefault(); cmdIdx = Math.min(cmdIdx + 1, cmdShown.length - 1); drawPalette(true); }
      else if (e.key === "ArrowUp"){ e.preventDefault(); cmdIdx = Math.max(cmdIdx - 1, 0); drawPalette(true); }
      else if (e.key === "Enter"){ e.preventDefault(); runIdx(cmdIdx); }
    });
    cmdList.addEventListener("click", function(e){
      var it = e.target.closest("[data-i]");
      if (it) runIdx(+it.getAttribute("data-i"));
    });
  }

  function score(cmd, q){
    if (!q) return 1;
    var hay = (cmd.label + " " + (cmd.group || "") + " " + (cmd.keywords || "")).toLowerCase();
    if (hay.indexOf(q) !== -1) return 3;
    /* loose subsequence match, so "dbz" finds "Dutch Blitz" */
    var i = 0;
    for (var j = 0; j < hay.length && i < q.length; j++) if (hay[j] === q[i]) i++;
    return i === q.length ? 1 : 0;
  }

  function drawPalette(keepQuery){
    var q = (cmdInput.value || "").trim().toLowerCase();
    cmdShown = commands
      .map(function(c){ return { c:c, s:score(c, q) }; })
      .filter(function(x){ return x.s > 0; })
      .sort(function(a,b){ return b.s - a.s; })
      .map(function(x){ return x.c; });

    if (cmdIdx >= cmdShown.length) cmdIdx = Math.max(0, cmdShown.length - 1);

    if (!cmdShown.length){
      cmdList.innerHTML = '<div class="cmdk-grp">no match</div>';
      return;
    }
    var html = "", group = null;
    cmdShown.forEach(function(c, i){
      if (c.group !== group){ group = c.group; html += '<div class="cmdk-grp">' + group + '</div>'; }
      html += '<div class="cmdk-it' + (i === cmdIdx ? " sel" : "") + '" data-i="' + i + '">' +
        '<span class="ic">' + (c.icon || "•") + '</span>' +
        '<span class="lb">' + c.label + '</span>' +
        (c.hint ? '<span class="hint">' + c.hint + '</span>' : "") +
      '</div>';
    });
    cmdList.innerHTML = html;
    var selEl = cmdList.querySelector(".cmdk-it.sel");
    if (selEl && keepQuery) selEl.scrollIntoView({ block:"nearest" });
  }

  function runIdx(i){
    var c = cmdShown[i];
    if (!c) return;
    closePalette();
    sel();
    try{ c.run(); }catch(e){ toast("That didn't work"); }
  }

  function openPalette(){
    buildPalette();
    cmdBg.classList.add("open");
    cmdInput.value = ""; cmdIdx = 0;
    drawPalette();
    setTimeout(function(){ cmdInput.focus(); }, 20);
  }
  function closePalette(){ if (cmdBg) cmdBg.classList.remove("open"); }
  function togglePalette(){
    if (cmdBg && cmdBg.classList.contains("open")) closePalette(); else openPalette();
  }

  /* =====================================================================
     Reveal on scroll
     ===================================================================== */
  var io = null;
  function observe(els){
    els = [].slice.call(els);
    if (!els.length) return;
    els.forEach(function(el){ el.classList.add("reveal"); });
    if (reduced || !("IntersectionObserver" in window)){
      els.forEach(function(el){ el.classList.add("in"); });
      return;
    }
    if (!io){
      io = new IntersectionObserver(function(entries){
        entries.forEach(function(en){
          if (en.isIntersecting){ en.target.classList.add("in"); io.unobserve(en.target); }
        });
      }, { rootMargin: "0px 0px -6% 0px", threshold: .04 });
    }
    els.forEach(function(el){ io.observe(el); });
  }

  /* =====================================================================
     Public hook
     ===================================================================== */
  window.FX = {
    sound: function(){ return soundOn; },
    play: function(n){ (SOUNDS[n] || press)(); },
    toast: toast,
    count: count,
    reveal: observe,
    register: register,
    openPalette: openPalette,
    palette: function(){ return palette; },
    setPalette: function(id){ if (IDS.indexOf(id) !== -1){ applyPalette(id); paintSwatches(); } },
    palettes: PALETTES,
    reduced: function(){ return reduced; }
  };

  var paintSwatches = function(){};

  /* =====================================================================
     Boot
     ===================================================================== */
  function boot(){
    if (!document.body) return;

    /* ---- ambient layers ---- */
    ["bg-grid","bg-aurora","bg-grain","bg-spot"].forEach(function(cls){
      var d = document.createElement("div");
      d.className = "bg-layer " + cls;
      d.setAttribute("aria-hidden","true");
      document.body.insertBefore(d, document.body.firstChild);
    });

    var crt = document.createElement("div");
    crt.className = "crt"; crt.setAttribute("aria-hidden","true");
    document.body.appendChild(crt);

    var bar = document.createElement("div");
    bar.className = "progress"; bar.setAttribute("aria-hidden","true");
    document.body.appendChild(bar);

    /* ---- dock ---- */
    var dock = document.createElement("div");
    dock.className = "dock";
    dock.innerHTML =
      '<div class="dock-label" id="fxLabel"></div>' +
      '<div class="swatches hide" id="fxSwatches"></div>' +
      '<div class="dock-panel" id="fxPanel">' +
        '<button data-fx="palette" aria-label="Colour palette" title="Colour palette">◧</button>' +
        '<button data-fx="crt" aria-label="CRT scanlines" title="CRT scanlines">▦</button>' +
        '<button data-fx="sound" aria-label="8-bit sound" title="8-bit sound">♪</button>' +
        '<button data-fx="cmd" aria-label="Command palette" title="Command palette (Ctrl K)">⌘</button>' +
      '</div>' +
      '<button class="dock-toggle" aria-label="Display options" title="Display options">✦</button>';
    document.body.appendChild(dock);

    var panel = dock.querySelector("#fxPanel");
    var swWrap = dock.querySelector("#fxSwatches");
    var label = dock.querySelector("#fxLabel");
    var bCrt = dock.querySelector('[data-fx="crt"]');
    var bSound = dock.querySelector('[data-fx="sound"]');

    swWrap.innerHTML = PALETTES.map(function(p){
      return '<button class="sw" data-pal="' + p.id + '" title="' + p.name + '" aria-label="' + p.name + '">' +
        '<i style="background:' + p.bg + '"></i>' +
        '<i style="background:' + p.a + ';left:auto;right:0;width:38%"></i>' +
        '<i style="background:' + p.b + ';left:auto;right:0;width:38%;top:auto;height:40%"></i>' +
      '</button>';
    }).join("");

    paintSwatches = function(){
      [].forEach.call(swWrap.querySelectorAll(".sw"), function(b){
        b.classList.toggle("on", b.getAttribute("data-pal") === palette);
      });
    };
    paintSwatches();

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
      labelTimer = setTimeout(function(){ label.classList.remove("show"); }, 1500);
    }

    function toggleCrt(){
      var on = root.getAttribute("data-crt") !== "on";
      if (on) root.setAttribute("data-crt","on"); else root.removeAttribute("data-crt");
      set(LS.crt, on ? "on" : "off");
      flash("CRT " + (on ? "on" : "off"));
      if (on) up(); else down();
      reflect();
    }
    function toggleSound(){
      soundOn = !soundOn;
      set(LS.sound, soundOn ? "on" : "off");
      reflect();
      if (soundOn){ audio(); up(); flash("Sound on"); } else flash("Sound off");
    }

    dock.addEventListener("click", function(e){
      var b = e.target.closest("[data-fx], .dock-toggle, [data-pal]");
      if (!b) return;

      if (b.hasAttribute("data-pal")){
        applyPalette(b.getAttribute("data-pal"));
        paintSwatches();
        flash("Palette · " + PALETTES.filter(function(p){ return p.id === palette; })[0].name);
        sel();
        return;
      }
      if (b.classList.contains("dock-toggle")){
        panel.classList.toggle("hide");
        swWrap.classList.add("hide");   /* swatches never outlive the panel */
        press();
        return;
      }
      var fx = b.getAttribute("data-fx");
      if (fx === "palette"){ swWrap.classList.toggle("hide"); press(); }
      else if (fx === "crt") toggleCrt();
      else if (fx === "sound") toggleSound();
      else if (fx === "cmd") openPalette();
    });

    /* ---- sound on general interactions ---- */
    document.addEventListener("pointerdown", function(e){
      if (!soundOn) return;
      if (e.target.closest(".dock")) return;
      var el = e.target.closest(".btn, .navchip, .chip, .key, .icobtn, .seg button, .lp");
      if (!el) return;
      if (el.classList.contains("navchip") || el.classList.contains("lp")) sel(); else press();
    });

    /* ---- reveals ---- */
    /* the ticker is deliberately left out: it starts hidden and is only
       unhidden once headlines arrive, which the observer would miss */
    observe(document.querySelectorAll(".card, .pagehead, .hero .statrail"));

    var hero = document.querySelector(".hero");
    if (hero){
      /* split the greeting into masked words so it can roll up on load */
      var greet = hero.querySelector(".greet");
      if (greet && !greet.dataset.split){
        greet.dataset.split = "1";
        var wi = 0;
        [].forEach.call(greet.childNodes, function(node){
          if (node.nodeType !== 3) return;
          var frag = document.createDocumentFragment();
          node.textContent.split(/(\s+)/).forEach(function(part){
            if (!part.trim()){ frag.appendChild(document.createTextNode(part)); return; }
            var w = document.createElement("span");
            w.className = "w"; w.style.setProperty("--wi", wi++);
            var inner = document.createElement("span");
            inner.textContent = part;
            w.appendChild(inner);
            frag.appendChild(w);
          });
          node.parentNode.replaceChild(frag, node);
        });
        [].forEach.call(greet.querySelectorAll("em, .caret"), function(el, i){
          if (el.classList.contains("caret")) return;
          var w = document.createElement("span");
          w.className = "w"; w.style.setProperty("--wi", wi++);
          el.parentNode.insertBefore(w, el);
          w.appendChild(el);
        });
      }
      requestAnimationFrame(function(){ hero.classList.add("in"); });
      observe([hero]);
    }

    /* ---- pointer spotlight + per-card sheen ---- */
    var fine = window.matchMedia && window.matchMedia("(pointer: fine)").matches;
    if (fine && !reduced){
      root.classList.add("pointer-fine");
      var raf = null, mx = 0, my = 0;
      window.addEventListener("pointermove", function(e){
        mx = e.clientX; my = e.clientY;
        if (raf) return;
        raf = requestAnimationFrame(function(){
          raf = null;
          root.style.setProperty("--mx", mx + "px");
          root.style.setProperty("--my", my + "px");
          var card = document.elementFromPoint(mx, my);
          card = card && card.closest ? card.closest(".card") : null;
          if (card){
            var r = card.getBoundingClientRect();
            card.style.setProperty("--cx", (mx - r.left) + "px");
            card.style.setProperty("--cy", (my - r.top) + "px");
          }
        });
      }, { passive:true });
    }

    /* ---- scroll state + fallback progress ---- */
    var supportsScrollTL = CSS && CSS.supports && CSS.supports("animation-timeline: scroll()");
    var sraf = null;
    window.addEventListener("scroll", function(){
      if (sraf) return;
      sraf = requestAnimationFrame(function(){
        sraf = null;
        root.setAttribute("data-scrolled", window.scrollY > 8 ? "1" : "0");
        if (!supportsScrollTL){
          var h = document.documentElement.scrollHeight - window.innerHeight;
          bar.style.setProperty("--p", h > 0 ? (window.scrollY / h) : 0);
        }
      });
    }, { passive:true });

    /* ---- global commands ---- */
    var here = location.pathname.split("/").pop() || "index.html";
    var nav = [
      { id:"go-home",  label:"Dashboard",   icon:"⌂", file:"index.html" },
      { id:"go-blitz", label:"Dutch Blitz ledger", icon:"♠", file:"games.html", keywords:"cards score game" },
      { id:"go-word",  label:"Not-Wordle",  icon:"▦", file:"word.html", keywords:"puzzle daily letters" },
      { id:"go-admin", label:"Admin centre", icon:"⚙", file:"admin.html", keywords:"invites users" }
    ];
    register(nav.filter(function(n){ return n.file !== here; }).map(function(n){
      return { id:n.id, group:"Go to", label:n.label, icon:n.icon, keywords:n.keywords,
               hint:n.file, run:function(){ location.href = n.file; } };
    }));

    register(PALETTES.map(function(p){
      return { id:"pal-" + p.id, group:"Appearance", label:"Palette · " + p.name, icon:"◧",
               keywords:"theme colour color", run:function(){ applyPalette(p.id); paintSwatches(); toast("Palette · " + p.name); } };
    }));
    register([
      { id:"fx-crt", group:"Appearance", label:"Toggle CRT scanlines", icon:"▦", run:toggleCrt },
      { id:"fx-sound", group:"Appearance", label:"Toggle 8-bit sound", icon:"♪", run:toggleSound },
      { id:"fx-top", group:"Navigate", label:"Back to top", icon:"↑",
        run:function(){ window.scrollTo({ top:0, behavior:"smooth" }); } }
    ]);

    /* ---- keyboard ---- */
    document.addEventListener("keydown", function(e){
      var k = (e.key || "").toLowerCase();
      if ((e.metaKey || e.ctrlKey) && k === "k"){ e.preventDefault(); togglePalette(); return; }
      if (k === "escape"){ closePalette(); return; }
      /* bare shortcuts only when not typing */
      var t = e.target;
      var typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (k === "/"){ e.preventDefault(); openPalette(); }
      else if (k === "t"){ /* next palette */
        applyPalette(IDS[(IDS.indexOf(palette) + 1) % IDS.length]);
        paintSwatches();
        toast("Palette · " + PALETTES.filter(function(p){ return p.id === palette; })[0].name);
      }
    });

    /* keep other tabs of the site in sync */
    window.addEventListener("storage", function(e){
      if (e.key === LS.palette && e.newValue && IDS.indexOf(e.newValue) !== -1){
        applyPalette(e.newValue, true); paintSwatches();
      }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
