/* =====================================================================
   otd.js — On This Day, from Wikipedia's feed API.
   Science and discovery float to the top, because that's the good stuff.
   ===================================================================== */

(function () {
  "use strict";

  var $ = H.$, esc = H.esc, pad = H.pad;

  var SCI = /(discover|scientist|physic|chemist|biolog|astronom|astronaut|cosmonaut|telescope|spacecraft|space |satellite|orbit|launch|rocket|NASA|probe|comet|eclipse|planet|moon|element|vaccine|genome|DNA|patent|invent|experiment|theory|particle|atom|quantum|nuclear|computer|electric|engineer|mathematic|medicine|surgery|antibiotic|fossil|dinosaur|species|evolution|archaeolog|expedition|summit|Antarctic|mission|laboratory|Nobel|X-ray|laser|transistor|internet|microscope|aviation|aircraft|first flight|climate)/i;

  var FALLBACK = [
    { year:1928, text:"Alexander Fleming returned from holiday to find a stray mould had killed the bacteria in a forgotten petri dish — the accident that became penicillin." },
    { year:1969, text:"Apollo 11's crew splashed down in the Pacific, ending the first mission to land humans on another world." },
    { year:1953, text:"Franklin's Photo 51 and the Watson–Crick model gave biology the double helix, and with it the language of heredity." },
    { year:1990, text:"The Hubble Space Telescope opened its eye above the atmosphere and quietly rewrote the age of the universe." },
    { year:1962, text:"Mariner 2 set off for Venus and became the first spacecraft to successfully visit another planet." },
    { year:1687, text:"Newton published the Principia, in which gravity stopped being a mystery and started being an equation." }
  ];

  var pool = [], idx = 0;

  /* A short digit scramble on the year — the one flourish this card gets. */
  function scramble(el, target){
    if (!el) return;
    var s = String(target);
    if (window.FX && FX.reduced()){ el.textContent = s; return; }
    var frames = 9, n = 0;
    var t = setInterval(function(){
      n++;
      el.textContent = s.split("").map(function(ch, i){
        if (n >= frames || i < Math.floor((n / frames) * s.length)) return ch;
        return String(Math.floor(Math.random() * 10));
      }).join("");
      if (n >= frames) clearInterval(t);
    }, 34);
  }

  function render(animate){
    var box = $("otd");
    if (!box) return;

    if (!pool.length){
      H.state(box, "Could not reach the history feed. Try again later.", true);
      return;
    }

    var it = pool[idx % pool.length];
    var isSci = SCI.test(it.text);
    var dots = pool.slice(0, Math.min(8, pool.length)).map(function(_, i){
      return '<i class="' + (i === (idx % pool.length) ? "on" : "") + '" data-jump="' + i + '"></i>';
    }).join("");

    box.innerHTML =
      '<div class="otd-inner' + (animate ? " otd-swap" : "") + '">' +
        '<span class="otd-year" id="otdYear">' + esc(it.year) + '</span>' +
        '<div>' +
          '<span class="badge ' + (isSci ? "sci" : "hist") + '">' +
            (isSci ? "science &amp; discovery" : "moment in history") + '</span>' +
          '<div class="otd-text">' + esc(it.text) + '</div>' +
          '<div class="otd-foot">' +
            (it.url ? '<a class="btn" href="' + esc(it.url) + '" target="_blank" rel="noopener">read more ↗</a>' : "") +
            '<span class="mono-sm">' + ((idx % pool.length) + 1) + ' / ' + pool.length + '</span>' +
            '<span class="otd-dots">' + dots + '</span>' +
          '</div>' +
        '</div>' +
      '</div>';

    if (animate) scramble($("otdYear"), it.year);

    var dotWrap = box.querySelector(".otd-dots");
    if (dotWrap) dotWrap.addEventListener("click", function(e){
      var d = e.target.closest("[data-jump]");
      if (!d) return;
      idx = +d.getAttribute("data-jump");
      render(true);
    });
  }

  function shuffle(a){
    for (var i = a.length - 1; i > 0; i--){
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function load(){
    var d = new Date();
    var url = "https://en.wikipedia.org/api/rest_v1/feed/onthisday/all/" +
      pad(d.getMonth() + 1) + "/" + pad(d.getDate());

    H.getJSON(url, 10000, { headers: { "Api-User-Agent": "home.alxsongs.com/2.0" } })
      .then(function(j){
        var items = [].concat(j.selected || [], j.events || []);
        var mapped = items.filter(function(e){ return e && e.text && e.year; }).map(function(e){
          var page = (e.pages && e.pages[0]) || null;
          return {
            year: e.year, text: e.text,
            url: page && page.content_urls && page.content_urls.desktop
              ? page.content_urls.desktop.page : null
          };
        });
        pool = shuffle(mapped.filter(function(e){ return SCI.test(e.text); }))
          .concat(shuffle(mapped.filter(function(e){ return !SCI.test(e.text); })));
        if (!pool.length) pool = FALLBACK.slice();
        idx = 0;
        render(false);
        if ($("otdMeta")) $("otdMeta").textContent = pool.length + " entries";
      })
      .catch(function(){
        pool = shuffle(FALLBACK.slice());
        idx = 0;
        render(false);
        if ($("otdMeta")) $("otdMeta").textContent = "offline set";
      });
  }

  function next(){ idx++; render(true); }

  function mount(){
    var b = $("otdShuffle");
    if (b) b.addEventListener("click", next);
    load();
  }

  H.otd = { mount: mount, next: next, refresh: load };
})();
