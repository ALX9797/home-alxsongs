/* =====================================================================
   games.js — the Dutch Blitz ledger.
   ---------------------------------------------------------------------
   A live game lives in localStorage so a refresh (or a flat battery)
   never loses a round. Finished games go to Supabase when it's
   configured, and to this browser when it isn't — db.js decides.
   ===================================================================== */

(function () {
  "use strict";

  var $ = H.$, esc = H.esc;

  var LIVE_KEY = "dutchblitz.live.v1";
  var live = null;      // {players, target, mode, rounds:[[…]], started}
  var games = [];       // finished games, newest first
  var tab = "board";

  /* One colour per seat, cycling through the palette's accents so the
     chart, the table and the entry form all agree on who is who. */
  var PC = [
    "var(--acid)", "var(--ice)", "var(--hot)", "var(--amber)",
    "color-mix(in srgb, var(--acid) 45%, var(--ink))",
    "color-mix(in srgb, var(--ice) 45%, var(--ink))",
    "color-mix(in srgb, var(--hot) 45%, var(--ink))",
    "color-mix(in srgb, var(--amber) 45%, var(--ink))"
  ];
  function pc(i){ return PC[i % PC.length]; }

  /* ---------------- storage mode ---------------- */
  var cloud = DB.isCloud();
  if ($("storeMode")){
    $("storeMode").textContent = cloud ? "cloud sync" : "this device only";
    if (cloud) $("storeMode").classList.add("cloud");
  }
  if ($("footMode")) $("footMode").textContent = cloud ? "supabase" : "local storage";

  /* ---------------- modal ---------------- */
  function openModal(markup){
    $("modal").innerHTML = markup;
    $("modalBg").classList.add("open");
  }
  function closeModal(){ $("modalBg").classList.remove("open"); }

  $("modalBg").addEventListener("click", function(e){
    if (e.target === $("modalBg")) closeModal();
  });
  document.addEventListener("keydown", function(e){ if (e.key === "Escape") closeModal(); });

  /* =====================================================================
     NEW GAME
     ===================================================================== */
  function suggestNames(){
    var freq = {};
    games.forEach(function(g){
      (g.players || []).forEach(function(p){ freq[p] = (freq[p] || 0) + 1; });
    });
    return Object.keys(freq).sort(function(a,b){ return freq[b] - freq[a]; });
  }

  function newGameModal(){
    var counts = [2,3,4,5,6,7,8];
    var targets = [75, 100, 150, 200];

    openModal(
      '<h3>New game</h3>' +
      '<div class="tag">set it up, then start dealing</div>' +

      '<label class="f">How many players?</label>' +
      '<div class="chipbar" id="pcount">' +
        counts.map(function(n){ return '<button class="chip' + (n===4?" on":"") + '" data-n="' + n + '">' + n + '</button>'; }).join("") +
      '</div>' +

      '<label class="f">Winning score</label>' +
      '<div class="chipbar" id="tsel">' +
        targets.map(function(n){ return '<button class="chip' + (n===75?" on":"") + '" data-t="' + n + '">' + n + '</button>'; }).join("") +
      '</div>' +
      '<input type="number" id="tcustom" placeholder="or type your own" style="margin-top:8px">' +

      '<label class="f">Scoring style</label>' +
      '<div class="chipbar" id="msel">' +
        '<button class="chip on" data-m="detail">Centre &amp; Blitz</button>' +
        '<button class="chip" data-m="simple">Round total only</button>' +
      '</div>' +

      '<label class="f">Player names</label>' +
      '<div class="namegrid" id="names"></div>' +

      '<div style="display:flex;gap:8px;margin-top:24px">' +
        '<button class="btn acid lg" id="startGame" style="flex:1"><span>Start game</span></button>' +
        '<button class="btn lg" id="cancelGame"><span>Cancel</span></button>' +
      '</div>'
    );

    var n = 4, target = 75, mode = "detail";

    function drawNames(){
      var prev = H.$$("input", $("names")).map(function(i){ return i.value; });
      var suggested = suggestNames();
      var out = "";
      for (var i = 0; i < n; i++){
        var v = prev[i] || suggested[i] || "";
        out += '<div class="nrow" style="--pc:' + pc(i) + '"><i></i>' +
          '<input type="text" placeholder="Player ' + (i+1) + '" value="' + esc(v) + '" maxlength="18"></div>';
      }
      $("names").innerHTML = out;
    }

    function chipGroup(wrap, attr, cb){
      $(wrap).addEventListener("click", function(e){
        var b = e.target.closest(".chip");
        if (!b) return;
        H.$$(".chip", this).forEach(function(c){ c.classList.remove("on"); });
        b.classList.add("on");
        cb(b.getAttribute(attr));
      });
    }

    chipGroup("pcount", "data-n", function(v){ n = +v; drawNames(); });
    chipGroup("tsel", "data-t", function(v){ target = +v; $("tcustom").value = ""; });
    chipGroup("msel", "data-m", function(v){ mode = v; });

    $("tcustom").addEventListener("input", function(){
      var v = parseInt(this.value, 10);
      if (v > 0){
        target = v;
        H.$$(".chip", $("tsel")).forEach(function(c){ c.classList.remove("on"); });
      }
    });

    drawNames();

    $("cancelGame").addEventListener("click", closeModal);
    $("startGame").addEventListener("click", function(){
      var players = H.$$("input", $("names")).map(function(inp, i){
        return (inp.value || "").trim() || ("Player " + (i+1));
      });
      /* de-duplicate names so the leaderboard stays sane */
      var seen = {};
      players = players.map(function(p){
        var key = p.toLowerCase();
        if (seen[key]){ seen[key]++; return p + " " + seen[key]; }
        seen[key] = 1;
        return p;
      });

      live = { players:players, target:target, mode:mode, rounds:[], started:new Date().toISOString() };
      persistLive();
      closeModal();
      renderLive();
      if (window.FX) FX.play("coin");
      $("liveCard").scrollIntoView({ behavior:"smooth", block:"start" });
    });
  }

  /* =====================================================================
     LIVE GAME
     ===================================================================== */
  function persistLive(){
    try{
      if (live) localStorage.setItem(LIVE_KEY, JSON.stringify(live));
      else localStorage.removeItem(LIVE_KEY);
    }catch(e){}
  }

  function totals(){
    if (!live) return [];
    return live.players.map(function(_, i){
      return live.rounds.reduce(function(s, r){ return s + (r[i] || 0); }, 0);
    });
  }

  function winnerIndex(){
    var t = totals(), best = -Infinity, idx = -1;
    t.forEach(function(v, i){ if (v > best){ best = v; idx = i; } });
    return best >= live.target ? idx : -1;
  }

  /* running totals after each round, for the chart */
  function cumulative(){
    return live.players.map(function(_, i){
      var s = 0;
      return [0].concat(live.rounds.map(function(r){ s += (r[i] || 0); return s; }));
    });
  }

  /* The chart is drawn in real pixels rather than a fixed viewBox: a
     200-unit box stretched to a 1100px card would be six times too tall,
     and preserveAspectRatio="none" would smear the strokes. Measure,
     draw 1:1, redraw on resize. */
  function renderChart(){
    if (!live || live.rounds.length < 2) return "";

    var host = $("liveChart");
    var W = Math.max(280, Math.round((host && host.clientWidth) || 720));
    var Hh = Math.round(Math.min(260, Math.max(150, W * 0.24)));
    var padL = 12, padR = 78, padT = 14, padB = 22;

    var series = cumulative();
    var flat = series.reduce(function(a,b){ return a.concat(b); }, [0, live.target]);
    var hi = Math.max.apply(null, flat), lo = Math.min.apply(null, flat.concat([0]));
    var span = Math.max(1, hi - lo);

    function x(i){ return padL + (i / live.rounds.length) * (W - padL - padR); }
    function y(v){ return padT + (1 - (v - lo) / span) * (Hh - padT - padB); }

    var lines = series.map(function(s, i){
      var pts = s.map(function(v, j){ return [x(j), y(v)]; });
      var d = "M" + pts.map(function(p){ return p[0].toFixed(1) + " " + p[1].toFixed(1); }).join(" L");
      /* dash length just needs to exceed the path, for the draw-in */
      var len = Math.round(W + Hh) * 2;
      var dots = pts.map(function(p){
        return '<circle class="pt" cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) +
               '" style="fill:' + pc(i) + '"/>';
      }).join("");
      var last = pts[pts.length - 1];
      var label = '<text class="lbl" x="' + (last[0] + 8).toFixed(1) + '" y="' + (last[1] + 3).toFixed(1) +
                  '" style="fill:' + pc(i) + '">' + esc(live.players[i]) + ' ' + s[s.length-1] + '</text>';
      return '<path class="ln" d="' + d + '" style="stroke:' + pc(i) + ';--len:' + len + ';--n:' + i + '"/>' +
             dots + label;
    }).join("");

    var goal = live.target <= hi
      ? '<line class="goal" x1="' + padL + '" y1="' + y(live.target).toFixed(1) +
        '" x2="' + (W - padR) + '" y2="' + y(live.target).toFixed(1) + '"/>' +
        '<text class="lbl" x="' + padL + '" y="' + (y(live.target) - 5).toFixed(1) + '">TARGET ' + live.target + '</text>'
      : "";

    var ticks = live.rounds.map(function(_, i){
      return '<text class="lbl" x="' + x(i+1).toFixed(1) + '" y="' + (Hh - 6) +
             '" text-anchor="middle">R' + (i+1) + '</text>';
    }).join("");

    return '<div class="chart"><svg viewBox="0 0 ' + W + ' ' + Hh + '" width="' + W + '" height="' + Hh +
        '" role="img" aria-label="Score progression by round">' +
        '<line class="axis" x1="' + padL + '" y1="' + y(0).toFixed(1) + '" x2="' + (W-padR) + '" y2="' + y(0).toFixed(1) + '"/>' +
        goal + ticks + lines +
      '</svg></div>';
  }

  /* keep the chart honest when the window changes shape */
  var chartResize = null;
  window.addEventListener("resize", function(){
    if (!live || live.rounds.length < 2) return;
    clearTimeout(chartResize);
    chartResize = setTimeout(function(){ $("liveChart").innerHTML = renderChart(); }, 200);
  });

  function renderLive(){
    if (!live){
      $("liveCard").style.display = "none";
      $("resumeBtn").style.display = "none";
      return;
    }
    $("liveCard").style.display = "";
    $("resumeBtn").style.display = "none";
    $("liveTitle").textContent = live.players.length + " players · first to " + live.target;

    var t = totals();
    var win = winnerIndex();
    var maxT = Math.max.apply(null, t.concat([0]));

    var head = '<thead><tr><th>Player</th>' +
      live.rounds.map(function(_, i){ return '<th class="num">R' + (i+1) + '</th>'; }).join("") +
      '<th class="num">Total</th></tr></thead>';

    var body = '<tbody>' + live.players.map(function(p, i){
      var pctv = Math.max(0, Math.min(100, (t[i] / live.target) * 100));
      return '<tr class="' + (t[i] === maxT && maxT > 0 ? "lead" : "") + '" style="--pc:' + pc(i) + '">' +
        '<td><div class="pname"><i></i>' + esc(p) + (win === i ? " 👑" : "") + '</div>' +
          '<div class="meter" style="margin-top:6px"><i style="width:' + pctv.toFixed(0) + '%;background:' + pc(i) + '"></i></div></td>' +
        live.rounds.map(function(r){
          var v = r[i] || 0;
          return '<td class="num ' + (v < 0 ? "delta-down" : (v > 0 ? "delta-up" : "")) + '">' +
            (v > 0 ? "+" : "") + v + '</td>';
        }).join("") +
        '<td class="num tot">' + t[i] + '</td>' +
      '</tr>';
    }).join("") + '</tbody>';

    $("liveTable").innerHTML = head + body;
    $("liveChart").innerHTML = renderChart();

    $("roundHint").textContent = live.mode === "detail"
      ? "round " + (live.rounds.length + 1) + " · centre cards − (2 × blitz left)"
      : "round " + (live.rounds.length + 1);

    $("undoRound").style.display = live.rounds.length ? "" : "none";

    if (win >= 0){
      $("winBanner").innerHTML =
        '<div class="win-banner"><div class="k"><span>' + esc(live.players[win]) + '</span> takes it.</div>' +
        '<div class="tag" style="margin-top:10px">' + t[win] + ' points in ' + live.rounds.length + ' rounds</div>' +
        '<div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">' +
          '<button class="btn acid" id="saveWin"><span>Save to ledger</span></button>' +
          '<button class="btn" id="keepPlaying"><span>Keep playing</span></button>' +
        '</div></div>';
      $("addRound").style.display = "none";
      $("saveWin").addEventListener("click", function(){ finishGame(win); });
      $("keepPlaying").addEventListener("click", function(){
        live.target = Math.max.apply(null, t) + 25;
        persistLive(); renderLive();
      });
      if (window.FX) FX.play("coin");
    } else {
      $("winBanner").innerHTML = "";
      $("addRound").style.display = "";
    }
  }

  function addRoundModal(){
    if (!live) return;
    var detail = live.mode === "detail";

    openModal(
      '<h3>Round ' + (live.rounds.length + 1) + '</h3>' +
      '<div class="tag">' + (detail ? "cards played to the centre, and cards left in the blitz pile"
                                    : "just the round score for each player") + '</div>' +
      '<div class="entry" id="entry" style="margin-top:18px">' +
        live.players.map(function(p, i){
          return '<div style="margin-bottom:14px;--pc:' + pc(i) + '">' +
            '<span class="mini"><i></i>' + esc(p) + '</span>' +
            (detail
              ? '<div class="pair">' +
                  '<input type="number" data-c="' + i + '" placeholder="centre" inputmode="numeric">' +
                  '<input type="number" data-b="' + i + '" placeholder="blitz" inputmode="numeric">' +
                  '<div class="pv" id="pv' + i + '">= 0</div></div>'
              : '<input type="number" data-s="' + i + '" placeholder="score" inputmode="numeric">') +
          '</div>';
        }).join("") +
      '</div>' +
      '<div style="display:flex;gap:8px;margin-top:14px">' +
        '<button class="btn acid lg" id="saveRound" style="flex:1"><span>Save round</span></button>' +
        '<button class="btn lg" id="cancelRound"><span>Cancel</span></button>' +
      '</div>'
    );

    function preview(){
      if (!detail) return;
      live.players.forEach(function(_, i){
        var c = +($("entry").querySelector('[data-c="' + i + '"]').value || 0);
        var b = +($("entry").querySelector('[data-b="' + i + '"]').value || 0);
        var v = c - 2*b;
        var el = $("pv" + i);
        el.textContent = "= " + (v > 0 ? "+" : "") + v;
        el.style.color = v < 0 ? "var(--hot)" : "var(--acid)";
      });
    }
    $("entry").addEventListener("input", preview);
    preview();

    var first = $("entry").querySelector("input");
    if (first) first.focus();

    /* Enter moves to the next box, and saves from the last one */
    $("entry").addEventListener("keydown", function(e){
      if (e.key !== "Enter") return;
      e.preventDefault();
      var inputs = H.$$("input", this);
      var i = inputs.indexOf(e.target);
      if (i > -1 && i < inputs.length - 1) inputs[i+1].focus();
      else $("saveRound").click();
    });

    $("cancelRound").addEventListener("click", closeModal);
    $("saveRound").addEventListener("click", function(){
      var row = live.players.map(function(_, i){
        if (detail){
          var c = +($("entry").querySelector('[data-c="' + i + '"]').value || 0);
          var b = +($("entry").querySelector('[data-b="' + i + '"]').value || 0);
          return c - 2*b;
        }
        return +($("entry").querySelector('[data-s="' + i + '"]').value || 0);
      });
      live.rounds.push(row);
      persistLive();
      closeModal();
      renderLive();
    });
  }

  function finishGame(win){
    var t = totals();
    var scores = {};
    live.players.forEach(function(p, i){ scores[p] = t[i]; });

    var game = {
      played_at: new Date().toISOString(),
      target_score: live.target,
      players: live.players,
      winner: live.players[win],
      final_scores: scores,
      rounds: live.rounds
    };

    var btn = $("saveWin");
    if (btn){ btn.disabled = true; btn.innerHTML = "<span>Saving…</span>"; }

    DB.save(game).then(function(saved){
      games.unshift(saved || game);
      live = null; persistLive();
      renderLive();
      renderTab();
      renderTotals();
      H.toast("Saved to the ledger");
      window.scrollTo({ top:0, behavior:"smooth" });
    }).catch(function(err){
      alert("Couldn't save to the cloud: " + err.message + "\n\nThe game has been kept so you can try again.");
      if (btn){ btn.disabled = false; btn.innerHTML = "<span>Save to ledger</span>"; }
    });
  }

  /* =====================================================================
     STATS
     ===================================================================== */
  function buildStats(){
    var s = {};
    function ensure(p){
      if (!s[p]) s[p] = { name:p, games:0, wins:0, points:0, best:-Infinity, bestRound:-Infinity, streak:0 };
      return s[p];
    }

    games.forEach(function(g){
      var fs = g.final_scores || {};
      (g.players || []).forEach(function(p){
        var e = ensure(p);
        e.games++;
        var sc = fs[p];
        if (typeof sc === "number"){
          e.points += sc;
          if (sc > e.best) e.best = sc;
        }
        if (g.winner === p) e.wins++;
      });
      var idx = {};
      (g.players || []).forEach(function(p, i){ idx[i] = p; });
      (g.rounds || []).forEach(function(r){
        r.forEach(function(v, i){
          var p = idx[i];
          if (p && typeof v === "number" && v > s[p].bestRound) s[p].bestRound = v;
        });
      });
    });

    /* current win streak: walk back from the newest game each player was in */
    Object.keys(s).forEach(function(p){
      var run = 0;
      for (var i = 0; i < games.length; i++){
        var g = games[i];
        if ((g.players || []).indexOf(p) === -1) continue;
        if (g.winner === p) run++; else break;
      }
      s[p].streak = run;
    });

    return Object.keys(s).map(function(k){ return s[k]; }).sort(function(a,b){
      if (b.wins !== a.wins) return b.wins - a.wins;
      return (b.wins / b.games) - (a.wins / a.games);
    });
  }

  function renderTotals(){
    var el = $("gmStats");
    if (!el) return;

    var rounds = games.reduce(function(n, g){ return n + ((g.rounds || []).length); }, 0);
    var bestRound = -Infinity, bestRoundBy = "—";
    var biggestWin = 0, biggestWinBy = "—";

    games.forEach(function(g){
      var idx = {};
      (g.players || []).forEach(function(p, i){ idx[i] = p; });
      (g.rounds || []).forEach(function(r){
        r.forEach(function(v, i){
          if (typeof v === "number" && v > bestRound){ bestRound = v; bestRoundBy = idx[i] || "—"; }
        });
      });
      var fs = g.final_scores || {};
      var vals = (g.players || []).map(function(p){ return typeof fs[p] === "number" ? fs[p] : 0; }).sort(function(a,b){ return b-a; });
      if (vals.length > 1 && (vals[0] - vals[1]) > biggestWin){
        biggestWin = vals[0] - vals[1];
        biggestWinBy = g.winner || "—";
      }
    });

    el.innerHTML =
      '<div><div class="k">Games</div><div class="v"><b id="stGames">0</b></div></div>' +
      '<div><div class="k">Rounds dealt</div><div class="v"><b id="stRounds">0</b></div></div>' +
      '<div><div class="k">Best round</div><div class="v"><b>' +
        (isFinite(bestRound) ? bestRound : "—") + '</b> <small>' + esc(bestRoundBy.toUpperCase()) + '</small></div></div>' +
      '<div><div class="k">Biggest win by</div><div class="v"><b>' +
        (biggestWin || "—") + '</b> <small>' + esc(biggestWinBy.toUpperCase()) + '</small></div></div>';

    if (window.FX){
      FX.count($("stGames"), games.length, { duration:800 });
      FX.count($("stRounds"), rounds, { duration:900 });
    }
  }

  function renderBoard(){
    var rows = buildStats();
    if (!rows.length){
      return '<div class="state">No games recorded yet. Hit <b style="color:var(--acid)">+ New game</b> and make some history.</div>';
    }
    return '<div class="scroll-x"><table><thead><tr>' +
      '<th></th><th>Player</th><th class="num">Wins</th><th class="num">Played</th>' +
      '<th class="num">Win %</th><th class="num">Streak</th><th class="num">Best game</th><th class="num">Best round</th>' +
      '</tr></thead><tbody>' +
      rows.map(function(r, i){
        return '<tr>' +
          '<td class="rank' + (i === 0 ? " gold" : "") + '">' + (i+1) + '</td>' +
          '<td class="pname">' + esc(r.name) + (i === 0 ? " 👑" : "") + '</td>' +
          '<td class="num wins">' + r.wins + '</td>' +
          '<td class="num">' + r.games + '</td>' +
          '<td class="num">' + Math.round((r.wins / r.games) * 100) + '%</td>' +
          '<td class="num streak">' + (r.streak > 1 ? r.streak + "🔥" : r.streak) + '</td>' +
          '<td class="num">' + (isFinite(r.best) ? r.best : "—") + '</td>' +
          '<td class="num">' + (isFinite(r.bestRound) ? r.bestRound : "—") + '</td>' +
        '</tr>';
      }).join("") + '</tbody></table></div>';
  }

  function renderHistory(){
    if (!games.length) return '<div class="state">Nothing in the ledger yet.</div>';

    return games.map(function(g){
      var d = new Date(g.played_at);
      var fs = g.final_scores || {};
      var line = (g.players || []).map(function(p){
        return esc(p) + " " + (fs[p] != null ? fs[p] : "—");
      }).join("  ·  ");
      return '<div class="hist">' +
        '<div><div class="w"><span>' + esc(g.winner || "?") + '</span> won — to ' + (g.target_score || "?") + '</div>' +
          '<div class="sc">' + line + '</div>' +
          '<div class="d">' + d.toLocaleDateString() + " " +
            d.toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" }) +
            ' · ' + ((g.rounds || []).length) + ' rounds</div></div>' +
        '<button class="btn ghost hot" data-del="' + esc(g.id) + '"><span>✕</span></button>' +
      '</div>';
    }).join("");
  }

  /* who beats whom, across every game the pair have shared */
  function renderH2H(){
    var names = {};
    games.forEach(function(g){ (g.players || []).forEach(function(p){ names[p] = true; }); });
    var list = Object.keys(names);

    if (list.length < 2) return '<div class="state">Two players and one finished game, and this table fills itself in.</div>';

    var rec = {};
    list.forEach(function(a){ rec[a] = {}; list.forEach(function(b){ rec[a][b] = [0,0]; }); });

    games.forEach(function(g){
      var ps = g.players || [];
      var w = g.winner;
      if (!w) return;
      ps.forEach(function(p){
        if (p === w) return;
        rec[w][p][0]++;   // wins for w over p
        rec[p][w][1]++;   // losses for p to w
      });
    });

    return '<div class="scroll-x"><table class="h2h"><thead><tr><th></th>' +
      list.map(function(b){ return '<th class="num rot">' + esc(b) + '</th>'; }).join("") +
      '</tr></thead><tbody>' +
      list.map(function(a){
        return '<tr><td class="pname">' + esc(a) + '</td>' +
          list.map(function(b){
            if (a === b) return '<td class="num self">—</td>';
            var r = rec[a][b];
            if (!r[0] && !r[1]) return '<td class="num" style="color:var(--ink-faint)">·</td>';
            var cls = r[0] > r[1] ? "won" : (r[0] < r[1] ? "lost" : "");
            return '<td class="num ' + cls + '">' + r[0] + '–' + r[1] + '</td>';
          }).join("") +
        '</tr>';
      }).join("") + '</tbody></table></div>' +
      '<div class="state" style="padding-top:12px">Read across: how often the player on the left has ' +
      'beaten the player on top, in games they both played.</div>';
  }

  function renderTab(){
    var titles = { board:"Leaderboard", history:"History", h2h:"Head to head" };
    $("tabTitle").textContent = titles[tab];
    $("tabBody").innerHTML = tab === "board" ? renderBoard()
                           : tab === "history" ? renderHistory()
                           : renderH2H();
  }

  /* =====================================================================
     WIRING
     ===================================================================== */
  $("tabs").addEventListener("click", function(e){
    var b = e.target.closest("[data-tab]");
    if (!b) return;
    H.$$("button", this).forEach(function(x){ x.classList.remove("on"); });
    b.classList.add("on");
    tab = b.getAttribute("data-tab");
    renderTab();
  });

  $("tabBody").addEventListener("click", function(e){
    var b = e.target.closest("[data-del]");
    if (!b) return;
    var id = b.getAttribute("data-del");
    if (!confirm("Delete this game from the ledger?")) return;
    DB.remove(id).then(function(){
      games = games.filter(function(g){ return String(g.id) !== id; });
      renderTab(); renderTotals();
      H.toast("Removed from the ledger");
    }).catch(function(err){ alert(err.message); });
  });

  $("newGame").addEventListener("click", function(){
    if (live && live.rounds.length){
      if (!confirm("There's a game in progress. Start a new one and discard it?")) return;
    }
    live = null; persistLive();
    newGameModal();
  });
  $("addRound").addEventListener("click", addRoundModal);
  $("undoRound").addEventListener("click", function(){
    if (!live || !live.rounds.length) return;
    live.rounds.pop(); persistLive(); renderLive();
  });
  $("abandon").addEventListener("click", function(){
    if (!confirm("Bin this game without saving it?")) return;
    live = null; persistLive(); renderLive();
  });
  $("resumeBtn").addEventListener("click", renderLive);

  /* keyboard: N for a new game, R for a round */
  document.addEventListener("keydown", function(e){
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    if ($("modalBg").classList.contains("open")) return;
    var k = (e.key || "").toLowerCase();
    if (k === "n"){ e.preventDefault(); $("newGame").click(); }
    if (k === "r" && live && winnerIndex() < 0){ e.preventDefault(); addRoundModal(); }
  });

  if (window.FX && FX.register){
    FX.register([
      { id:"gm-new", group:"Actions", label:"New Dutch Blitz game", icon:"＋", hint:"N",
        run:function(){ $("newGame").click(); } },
      { id:"gm-round", group:"Actions", label:"Add a round", icon:"＋", hint:"R",
        run:function(){ if (live) addRoundModal(); else H.toast("No game in progress"); } },
      { id:"gm-board", group:"View", label:"Leaderboard", icon:"≡",
        run:function(){ tab = "board"; syncTabs(); renderTab(); } },
      { id:"gm-hist", group:"View", label:"Game history", icon:"≡",
        run:function(){ tab = "history"; syncTabs(); renderTab(); } },
      { id:"gm-h2h", group:"View", label:"Head to head", icon:"≡",
        run:function(){ tab = "h2h"; syncTabs(); renderTab(); } }
    ]);
  }

  function syncTabs(){
    H.$$("button", $("tabs")).forEach(function(b){
      b.classList.toggle("on", b.getAttribute("data-tab") === tab);
    });
  }

  /* =====================================================================
     BOOT
     ===================================================================== */
  try{
    var raw = localStorage.getItem(LIVE_KEY);
    if (raw){
      live = JSON.parse(raw);
      $("resumeBtn").style.display = "";
    }
  }catch(e){}

  DB.list().then(function(rows){
    games = rows || [];
    renderTab();
    renderTotals();
    if (live) renderLive();
  }).catch(function(err){
    $("tabBody").innerHTML = '<div class="state err">Could not load the ledger: ' + esc(err.message) + '</div>';
    if (live) renderLive();
  });
})();
