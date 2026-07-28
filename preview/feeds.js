/* =====================================================================
   feeds.js — headlines and esports, both served by the Worker.
   ---------------------------------------------------------------------
   The Worker does the RSS fetching, merging and de-duplication so the
   browser only ever sees clean JSON. Headlines also feed the marquee
   ticker under the hero.
   ===================================================================== */

(function () {
  "use strict";

  var $ = H.$, esc = H.esc, ago = H.ago;

  /* =====================================================================
     NEWS
     ===================================================================== */
  var TOPIC_LABEL = { music:"Music", science:"Science", tech:"Tech", world:"UK & World" };
  var TOPIC_ORDER = ["music","science","tech","world"];
  var PER_TOPIC = 5;

  function renderTicker(topics){
    var host = $("ticker");
    if (!host) return;

    /* one from each topic, round-robin, so the strip stays varied */
    var flat = [], i = 0, more = true;
    while (more && flat.length < 16){
      more = false;
      TOPIC_ORDER.forEach(function(t){
        var list = topics[t] || [];
        if (list[i]){ flat.push(list[i]); more = true; }
      });
      i++;
    }
    /* an empty bordered strip reads as a bug, so stay hidden until there
       is actually something to say */
    host.hidden = !flat.length;
    if (!flat.length){ host.innerHTML = ""; return; }

    var run = flat.map(function(it){
      return '<a href="' + esc(it.link) + '" target="_blank" rel="noopener">' +
        '<span class="tk-src">' + esc(it.source) + '</span>' +
        '<span class="tk-dot">/</span>' +
        '<span>' + esc(it.title) + '</span></a>';
    }).join("");

    /* duplicated once so the -50% translate loops seamlessly */
    host.innerHTML = '<div class="ticker-track">' + run + run + '</div>';
  }

  function renderNews(j){
    var box = $("news");
    if (!box) return;

    var topics = j.topics || {};
    var wanted = H.prefs().topics;
    var cols = TOPIC_ORDER.filter(function(t){
      return wanted.indexOf(t) !== -1 && (topics[t] || []).length;
    });

    if (!cols.length){
      H.state(box, "No headlines came back.", true);
      return;
    }

    box.innerHTML = '<div class="news-grid">' + cols.map(function(t){
      return '<div class="news-col ' + t + '">' +
        '<h3><span>' + esc(TOPIC_LABEL[t] || t) + '</span>' +
          '<span class="mono-sm">' + (topics[t].length) + '</span></h3>' +
        topics[t].slice(0, PER_TOPIC).map(function(it){
          /* onerror: if the image 404s, drop the thumb and reflow to text-only */
          var thumb = it.img
            ? '<div class="nw-img"><img src="' + esc(it.img) + '" alt="" loading="lazy" ' +
              'onerror="this.closest(\'.nw\').classList.remove(\'has-img\');this.parentNode.remove();"></div>'
            : "";
          return '<a class="nw' + (it.img ? " has-img" : "") + '" href="' + esc(it.link) +
            '" target="_blank" rel="noopener">' + thumb + '<div>' +
            '<div class="nw-t">' + esc(it.title) + '</div>' +
            '<div class="nw-m">' + esc(it.source) + (it.ts ? " · " + ago(it.ts) : "") + '</div>' +
          '</div></a>';
        }).join("") +
      '</div>';
    }).join("") + '</div>';

    renderTicker(topics);

    /* quietly surface any feeds that are refusing, so they can be pruned */
    var f = j.feeds || {};
    var n = (f.ok || []).length;
    if ($("newsMeta")){
      $("newsMeta").textContent = n + " source" + (n === 1 ? "" : "s") +
        ((f.failed || []).length ? " · " + f.failed.length + " down" : "");
      $("newsMeta").title = (f.failed || []).length ? "Not responding:\n" + f.failed.join("\n") : "";
    }
  }

  function loadNews(){
    var box = $("news");
    if (!H.PROXY){
      H.state(box, "Headlines need the Worker — set FLIGHT_PROXY in config.js.");
      return;
    }
    H.getJSON(H.PROXY + "/news?topics=" + H.prefs().topics.join(","), 15000)
      .then(renderNews)
      .catch(function(){
        H.state(box, "Couldn't load headlines. Try the refresh button.", true);
      });
  }

  /* =====================================================================
     ESPORTS
     ===================================================================== */
  var GAME_ORDER = ["lol","cs2"];

  function kickoff(iso){
    if (!iso) return "TBC";
    var t = new Date(iso).getTime();
    var mins = Math.round((t - Date.now()) / 60000);
    if (mins < 0) return "now";
    if (mins < 60) return "in " + mins + "m";
    if (mins < 60 * 24){
      var h = Math.floor(mins / 60), m = mins % 60;
      return "in " + h + "h" + (m ? " " + m + "m" : "");
    }
    return new Date(iso).toLocaleDateString([], { weekday:"short" }) + " " +
           new Date(iso).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" });
  }

  function teamRow(t, score, isWinning){
    return '<div class="es-team' + (isWinning ? " win" : "") + '">' +
      (t.logo ? '<img src="' + esc(t.logo) + '" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'">'
              : '<img alt="">') +
      '<span class="nm">' + esc(t.name) + '</span>' +
      (score != null ? '<span class="sc">' + score + '</span>' : "") +
    '</div>';
  }

  function matchRow(m, isLive){
    var a = m.teams[0] || { name:"TBD" }, b = m.teams[1] || { name:"TBD" };
    var sa = m.scores[0], sb = m.scores[1];
    var meta = [];
    if (isLive) meta.push('<span class="live-dot"><i></i>LIVE</span>');
    else meta.push('<span class="es-when">' + esc(kickoff(m.begin_at)) + '</span>');
    if (m.league) meta.push(esc(m.league));
    if (m.best_of) meta.push("BO" + m.best_of);

    var open = m.stream || null;
    var tag = open
      ? 'a href="' + esc(open) + '" target="_blank" rel="noopener" class="es-m"'
      : 'div class="es-m"';
    return '<' + tag + '>' +
      teamRow(a, sa, sa != null && sb != null && sa > sb) +
      teamRow(b, sb, sa != null && sb != null && sb > sa) +
      '<div class="es-meta">' + meta.join("") + '</div>' +
    '</' + (open ? "a" : "div") + '>';
  }

  function renderEsports(j){
    var box = $("esports");
    if (!box) return;

    if (j.configured === false){
      box.innerHTML =
        '<div class="state">Esports needs a free PandaScore key.</div>' +
        '<div class="state" style="padding-top:4px;color:var(--ink-dim)">' +
        'Sign up at pandascore.co, then add it to the Worker as an environment ' +
        'variable named PANDASCORE_TOKEN.</div>';
      if ($("esMeta")) $("esMeta").textContent = "not configured";
      return;
    }

    var games = j.games || {};
    var wanted = H.prefs().games;
    var cols = GAME_ORDER.filter(function(g){ return wanted.indexOf(g) !== -1 && games[g]; });
    var liveCount = 0;

    if (!cols.length){
      H.state(box, "No games selected. Pick some in your account preferences.");
      if ($("esMeta")) $("esMeta").textContent = "";
      return;
    }

    box.innerHTML = '<div class="es-grid">' + cols.map(function(g){
      var d = games[g];
      var live = d.live || [], next = d.next || [];
      liveCount += live.length;

      var body = "";
      if (live.length){
        body += '<div class="es-sub">Live now</div>' + live.map(function(m){ return matchRow(m, true); }).join("");
      }
      if (next.length){
        body += '<div class="es-sub">Next up</div>' + next.map(function(m){ return matchRow(m, false); }).join("");
      }
      if (!body) body = '<div class="state">Nothing scheduled.</div>';

      return '<div class="es-col ' + g + '"><h3><span>' + esc(d.label || g) + '</span>' +
        (live.length ? '<span class="live-dot"><i></i>' + live.length + " live</span>" : "") +
        '</h3>' + body + '</div>';
    }).join("") + '</div>';

    if ($("esMeta")){
      $("esMeta").textContent = liveCount ? liveCount + " live now" : "no live matches";
      $("esMeta").title = (j.problems || []).length ? j.problems.join("\n") : "";
    }
  }

  function loadEsports(){
    var box = $("esports");
    if (!H.PROXY){
      H.state(box, "Esports needs the Worker — set FLIGHT_PROXY in config.js.");
      return;
    }
    H.getJSON(H.PROXY + "/esports?games=" + (H.prefs().games.join(",") || "lol,cs2"), 15000)
      .then(renderEsports)
      .catch(function(){
        H.state(box, "Couldn't load matches. Try the refresh button.", true);
      });
  }

  /* =====================================================================
     MOUNT
     ===================================================================== */
  function mount(){
    var nr = $("newsRefresh");
    if (nr) nr.addEventListener("click", function(){
      this.classList.remove("spin"); void this.offsetWidth; this.classList.add("spin");
      H.skeleton($("news"), 3);
      loadNews();
    });

    var er = $("esRefresh");
    if (er) er.addEventListener("click", function(){
      this.classList.remove("spin"); void this.offsetWidth; this.classList.add("spin");
      H.skeleton($("esports"), 2);
      loadEsports();
    });

    setInterval(loadEsports, 180000);   /* live scores tick over every 3 min */
  }

  H.feeds = {
    mount: mount,
    loadNews: loadNews,
    loadEsports: loadEsports,
    loadAll: function(){ loadNews(); loadEsports(); }
  };
})();
