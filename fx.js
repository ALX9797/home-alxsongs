/* =====================================================================
   fx.js — the homepage's party tricks, none of them load-bearing:
     ⌘K / Ctrl+K / "/"   command palette: jump anywhere, flip any switch
     scroll              sections arrive; their headings decrypt
     pointer             the sky has depth (stars, moon and clouds drift)
     ↑↑↓↓←→←→BA          hyperspace, straight into Godseye
   ===================================================================== */
(function(){
"use strict";
var $ = function(id){ return document.getElementById(id); };
var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
function esc(s){
  return String(s == null ? "" : s).replace(/[&<>"]/g, function(c){
    return ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;" })[c];
  });
}
function click(sel){ var el = document.querySelector(sel); if (el) el.click(); }
function jump(id){ var el = $(id); if (el) el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" }); }
function ge(opts){ if (window.GODSEYE) window.GODSEYE.open(opts); }

/* ---------------------------------------------------------------- palette */
var CMDS = [
  { i:"◉", t:"Enter Godseye", s:"G", k:"globe planet 3d world map live", run:function(){ ge(); } },
  { i:"▶", t:"Godseye: tour the last 24 hours", s:"T", k:"world tour news storms fires launches earthquakes today show demo screensaver", run:function(){ ge({ world:true }); } },
  { i:"✦", t:"Hyperspace", s:"secret", k:"warp konami party overdrive fun", run:function(){ warp(); } },
  { i:"↓", t:"On this day", s:"jump", k:"fact history wikipedia", run:function(){ jump("fact"); } },
  { i:"↓", t:"The wire", s:"jump", k:"news headlines", run:function(){ jump("wire"); } },
  { i:"↓", t:"Olwen’s notes", s:"jump", k:"sport football f1 lol olwen", run:function(){ jump("olwen"); } },
  { i:"↓", t:"What’s overhead", s:"jump", k:"flights aircraft planes map radar", run:function(){ jump("window"); } },
  { i:"↓", t:"The scoreboard", s:"jump", k:"esports scores matches", run:function(){ jump("scores"); } },
  { i:"↓", t:"The ledger", s:"jump", k:"dutch blitz word games", run:function(){ jump("ledger"); } },
  { i:"→", t:"Dutch Blitz ledger", s:"page", k:"games cards scores", run:function(){ location.href = "games.html"; } },
  { i:"→", t:"Not-Wordle", s:"page", k:"word game daily", run:function(){ location.href = "word.html"; } },
  { i:"→", t:"Classic dashboard", s:"page", k:"old previous index", run:function(){ location.href = "index-classic.html"; } },
  { i:"↻", t:"Another fact", s:"action", k:"random history next", run:function(){ click("#otdNext"); jump("fact"); } },
  { i:"↻", t:"Refresh the wire", s:"action", k:"reload news", run:function(){ click("#newsRefresh"); } },
  { i:"⎘", t:"Copy link to this page", s:"action", k:"share url", run:function(){
      var u = location.origin + location.pathname;
      if (navigator.clipboard) navigator.clipboard.writeText(u); } }
];
["auto","dawn","day","dusk","night"].forEach(function(k){
  CMDS.push({ i:"☼", t:"Sky: " + k, s:"sky", k:"sky light time " + k, run:function(){ click('#console [data-sky="' + k + '"]'); } });
});
[["off","Off","0"],["nvg","Night vision","1"],["thermal","Thermal","2"],["noir","Noir","3"],["crt","CRT","4"]].forEach(function(m){
  CMDS.push({ i:"◐", t:"Sensor: " + m[1], s:m[2], k:"sensor filter mode " + m[0], run:function(){ click('#console [data-sensor="' + m[0] + '"]'); } });
});

var pal = null, palIdx = 0, palHits = [];
function score(q, c){
  if (!q) return 1;
  var hay = (c.t + " " + c.k).toLowerCase(), i = 0, j = 0, s = 0, run = 0;
  if (hay.indexOf(q) !== -1) return 100 - hay.indexOf(q);
  for (; i < q.length; i++){
    var f = hay.indexOf(q[i], j);
    if (f === -1) return 0;
    run = f === j ? run + 1 : 0;
    s += 1 + run; j = f + 1;
  }
  return s;
}
function buildPalette(){
  pal = document.createElement("div");
  pal.className = "cmdk";
  pal.setAttribute("role", "dialog");
  pal.setAttribute("aria-label", "Command palette");
  pal.innerHTML =
    '<div class="cmdk-box">' +
      '<div class="cmdk-in"><span>›</span><input id="cmdkQ" type="text" placeholder="Jump, switch, or launch…" autocomplete="off" spellcheck="false" aria-label="Command"></div>' +
      '<div class="cmdk-list" id="cmdkList" role="listbox"></div>' +
      '<div class="cmdk-foot"><span>↑↓ choose</span><span>↵ run</span><span>esc close</span></div>' +
    '</div>';
  document.body.appendChild(pal);
  pal.addEventListener("click", function(e){
    if (e.target === pal) return closePalette();
    var b = e.target.closest("[data-i]");
    if (b) runCmd(+b.getAttribute("data-i"));
  });
  pal.addEventListener("pointermove", function(e){
    var b = e.target.closest("[data-i]");
    if (b && +b.getAttribute("data-i") !== palIdx){ palIdx = +b.getAttribute("data-i"); paintList(); }
  });
  $("cmdkQ").addEventListener("input", filter);
  $("cmdkQ").addEventListener("keydown", function(e){
    if (e.key === "ArrowDown"){ e.preventDefault(); palIdx = Math.min(palHits.length - 1, palIdx + 1); paintList(); }
    else if (e.key === "ArrowUp"){ e.preventDefault(); palIdx = Math.max(0, palIdx - 1); paintList(); }
    else if (e.key === "Enter"){ e.preventDefault(); runCmd(palIdx); }
    else if (e.key === "Escape"){ e.preventDefault(); closePalette(); }
  });
}
function filter(){
  var q = $("cmdkQ").value.trim().toLowerCase();
  palHits = CMDS.map(function(c){ return { c:c, s:score(q, c) }; })
    .filter(function(x){ return x.s > 0; })
    .sort(function(a, b){ return b.s - a.s; })
    .map(function(x){ return x.c; });
  palIdx = 0;
  paintList();
}
function paintList(){
  var box = $("cmdkList");
  box.innerHTML = palHits.length ? palHits.map(function(c, i){
    return '<button class="cmdk-it' + (i === palIdx ? " on" : "") + '" data-i="' + i + '" role="option" aria-selected="' + (i === palIdx) + '">' +
      '<i>' + esc(c.i) + '</i><span>' + esc(c.t) + '</span><small>' + esc(c.s) + '</small></button>';
  }).join("") : '<div class="cmdk-empty">nothing matches — try “godseye”, “night” or “ledger”</div>';
  var on = box.querySelector(".on");
  if (on && on.scrollIntoView) on.scrollIntoView({ block: "nearest" });
}
function openPalette(){
  if (!pal) buildPalette();
  pal.classList.add("on");
  $("cmdkQ").value = "";
  filter();
  setTimeout(function(){ $("cmdkQ").focus(); }, 10);
}
function closePalette(){ if (pal) pal.classList.remove("on"); }
function runCmd(i){
  var c = palHits[i]; if (!c) return;
  closePalette();
  setTimeout(c.run, 60);
}
document.addEventListener("keydown", function(e){
  var t = (e.target && e.target.tagName) || "";
  var typing = t === "INPUT" || t === "TEXTAREA" || t === "SELECT" || (e.target && e.target.isContentEditable);
  if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")){
    if (window.GODSEYE && window.GODSEYE.isOpen()) return;
    e.preventDefault();
    pal && pal.classList.contains("on") ? closePalette() : openPalette();
    return;
  }
  if (!typing && e.key === "/" && !(window.GODSEYE && window.GODSEYE.isOpen())){
    e.preventDefault(); openPalette();
  }
});

/* ---------------------------------------------------------------- reveal */
var GLYPHS = "!<>-_\\/[]{}—=+*^?#ABCDEFXYZ01";
function decrypt(el){
  var text = el.getAttribute("data-text") || el.textContent;
  el.setAttribute("data-text", text);
  if (reduce) return;
  var f = 0, total = 22;
  var iv = setInterval(function(){
    f++;
    el.textContent = text.split("").map(function(ch, i){
      if (ch === " " || f / total > i / text.length) return ch;
      return GLYPHS[(Math.random() * GLYPHS.length) | 0];
    }).join("");
    if (f >= total){ clearInterval(iv); el.textContent = text; }
  }, 34);
}
if ("IntersectionObserver" in window && !reduce){
  var io = new IntersectionObserver(function(entries){
    entries.forEach(function(en){
      if (!en.isIntersecting) return;
      en.target.classList.add("seen");
      var h = en.target.querySelector(".head h2");
      if (h && !h._done){ h._done = true; decrypt(h); }
      io.unobserve(en.target);
    });
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.06 });
  [].forEach.call(document.querySelectorAll(".ground > section"), function(s){
    /* anything already on screen stays put; only what's below arrives */
    if (s.getBoundingClientRect().top < window.innerHeight * 0.9) return;
    s.classList.add("reveal");
    io.observe(s);
  });
}

/* ---------------------------------------------------------------- parallax */
if (!reduce && window.matchMedia && window.matchMedia("(pointer: fine)").matches){
  var layers = [[".stars", 7], [".moon", 14], [".clouds", 22], [".glow", 10]]
    .map(function(l){ return { el: document.querySelector(l[0]), d: l[1] }; })
    .filter(function(l){ return l.el; });
  var tx = 0, ty = 0, cx = 0, cy = 0, running = false;
  window.addEventListener("pointermove", function(e){
    tx = (e.clientX / window.innerWidth - 0.5) * 2;
    ty = (e.clientY / window.innerHeight - 0.5) * 2;
    if (!running){ running = true; requestAnimationFrame(step); }
  }, { passive: true });
  function step(){
    cx += (tx - cx) * 0.06; cy += (ty - cy) * 0.06;
    layers.forEach(function(l){ l.el.style.translate = (-cx * l.d).toFixed(2) + "px " + (-cy * l.d * 0.6).toFixed(2) + "px"; });
    if (Math.abs(tx - cx) > 0.001 || Math.abs(ty - cy) > 0.001) requestAnimationFrame(step);
    else running = false;
  }
}

/* ---------------------------------------------------------------- konami */
var KONAMI = ["ArrowUp","ArrowUp","ArrowDown","ArrowDown","ArrowLeft","ArrowRight","ArrowLeft","ArrowRight","b","a"], kIdx = 0;
document.addEventListener("keydown", function(e){
  var k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  kIdx = k === KONAMI[kIdx] ? kIdx + 1 : (k === KONAMI[0] ? 1 : 0);
  if (kIdx === KONAMI.length){ kIdx = 0; warp(); }
});

function warp(){
  if (document.querySelector(".warp")) return;
  if (window.GODSEYE && window.GODSEYE.isOpen()){ window.GODSEYE.party(); return; }
  if (reduce){ if (window.GODSEYE) window.GODSEYE.party(); return; }
  var c = document.createElement("canvas");
  c.className = "warp";
  var W = c.width = window.innerWidth, H = c.height = window.innerHeight;
  document.body.appendChild(c);
  var g = c.getContext("2d"), stars = [], t0 = performance.now(), D = 2400;
  for (var i = 0; i < 700; i++) stars.push({ a: Math.random() * Math.PI * 2, r: Math.random() * 40, v: 0.4 + Math.random() * 1.6, h: Math.random() * 360 });
  if (window.GODSEYE) window.GODSEYE.preload();
  (function frame(now){
    var t = (now - t0) / D;
    g.fillStyle = "rgba(1,2,7," + (0.18 + t * 0.5).toFixed(2) + ")";
    g.fillRect(0, 0, W, H);
    var speed = Math.pow(t, 2.4) * 90 + 2;
    stars.forEach(function(s){
      var r0 = s.r, r1 = s.r + s.v * speed;
      s.r = r1;
      if (s.r > Math.hypot(W, H)){ s.r = Math.random() * 20; }
      g.strokeStyle = "hsla(" + (t > 0.5 ? s.h : 200) + ",100%," + (70 + t * 25) + "%," + Math.min(1, 0.3 + t) + ")";
      g.lineWidth = 1 + t * 2;
      g.beginPath();
      g.moveTo(W / 2 + Math.cos(s.a) * r0, H / 2 + Math.sin(s.a) * r0);
      g.lineTo(W / 2 + Math.cos(s.a) * r1, H / 2 + Math.sin(s.a) * r1);
      g.stroke();
    });
    if (t > 0.86){ g.fillStyle = "rgba(255,255,255," + ((t - 0.86) / 0.14).toFixed(2) + ")"; g.fillRect(0, 0, W, H); }
    if (t < 1) requestAnimationFrame(frame);
    else {
      if (window.GODSEYE) window.GODSEYE.party();
      c.style.transition = "opacity .6s ease"; c.style.opacity = "0";
      setTimeout(function(){ c.remove(); }, 700);
    }
  })(t0);
}
})();
