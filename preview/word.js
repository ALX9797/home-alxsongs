/* =====================================================================
   word.js — Not-Wordle.
   ---------------------------------------------------------------------
   The answer comes from the Worker, so it is never in the page source
   and nobody can peek. One go per day, kept in this browser; results
   sync to Supabase when you're signed in, for the leaderboard.
   ===================================================================== */

(function () {
  "use strict";

  var $ = H.$, esc = H.esc;
  var ROWS = 6, COLS = 5;

  var answer = null, day = null, number = null;
  var guesses = [], current = "", finished = false;
  var VALID = null;
  var revealRow = -1;

  /* ---------------- storage: one go per day, per browser ---------------- */
  function key(d){ return "notwordle." + (d || day); }

  function saveLocal(solved){
    try{
      localStorage.setItem(key(), JSON.stringify({
        guesses: guesses, finished: finished,
        solved: typeof solved === "boolean" ? solved : (finished && guesses[guesses.length-1] === answer),
        number: number
      }));
    }catch(e){}
  }
  function loadLocal(){
    try{
      var s = JSON.parse(localStorage.getItem(key()) || "null");
      if (s && Array.isArray(s.guesses)){ guesses = s.guesses; finished = !!s.finished; }
    }catch(e){}
  }

  /* every day this browser has ever played, for the personal record card */
  function history(){
    var out = [];
    try{
      for (var i = 0; i < localStorage.length; i++){
        var k = localStorage.key(i);
        if (k.indexOf("notwordle.") !== 0) continue;
        var v = JSON.parse(localStorage.getItem(k) || "null");
        if (!v || !Array.isArray(v.guesses) || !v.finished) continue;
        /* older saves predate the explicit flag — under six guesses can
           only mean the word was found */
        var solved = typeof v.solved === "boolean" ? v.solved : v.guesses.length < ROWS;
        out.push({ day: k.slice(10), n: v.guesses.length, solved: solved });
      }
    }catch(e){}
    return out.sort(function(a,b){ return a.day < b.day ? 1 : -1; });
  }

  /* ---------------- scoring ----------------
     Two passes: exact matches first, so a repeated letter can't be marked
     "close" when its only copy has already been placed. */
  function score(guess, target){
    var out = new Array(COLS).fill("miss");
    var left = {}, i;
    for (i = 0; i < COLS; i++){
      if (guess[i] === target[i]) out[i] = "exact";
      else left[target[i]] = (left[target[i]] || 0) + 1;
    }
    for (i = 0; i < COLS; i++){
      if (out[i] === "exact") continue;
      var c = guess[i];
      if (left[c] > 0){ out[i] = "close"; left[c]--; }
    }
    return out;
  }

  /* ---------------- board ---------------- */
  function drawBoard(){
    var out = "";
    for (var r = 0; r < ROWS; r++){
      var g = guesses[r];
      var typing = (!finished && r === guesses.length) ? current : null;
      var flipping = r === revealRow;
      out += '<div class="brow" data-row="' + r + '">';
      for (var c = 0; c < COLS; c++){
        var cls = "tile", ch = "";
        if (g){
          ch = g[c];
          /* while a row is flipping the colour is applied per tile, mid-turn */
          if (!flipping) cls += " " + score(g, answer)[c];
          else cls += " filled flip";
        } else if (typing != null && typing[c]){
          ch = typing[c];
          cls += " filled";
        }
        out += '<div class="' + cls + '" style="--c:' + c + '">' + esc(ch) + '</div>';
      }
      out += '</div>';
    }
    $("board").innerHTML = out;

    if (flippingNeeded()){
      var row = $("board").querySelector('[data-row="' + revealRow + '"]');
      var marks = score(guesses[revealRow], answer);
      [].forEach.call(row.children, function(tile, c){
        setTimeout(function(){
          tile.classList.remove("filled");
          tile.classList.add(marks[c]);
        }, c * 110 + 230);
      });
      var done = COLS * 110 + 400;
      setTimeout(function(){
        revealRow = -1;
        drawKeys();
        if (finished) finish(guesses[guesses.length-1] === answer);
      }, done);
    }
  }
  function flippingNeeded(){ return revealRow >= 0 && guesses[revealRow]; }

  var KEYS = ["qwertyuiop", "asdfghjkl", "@zxcvbnm<"];

  function drawKeys(){
    var best = {}, rank = { miss:0, close:1, exact:2 };
    guesses.forEach(function(g, r){
      if (r === revealRow) return;
      var s = score(g, answer);
      for (var i = 0; i < COLS; i++){
        var c = g[i];
        if (best[c] == null || rank[s[i]] > rank[best[c]]) best[c] = s[i];
      }
    });

    $("keys").innerHTML = KEYS.map(function(row){
      return '<div class="krow">' + row.split("").map(function(k){
        if (k === "@") return '<button class="key wide" data-k="enter">Enter</button>';
        if (k === "<") return '<button class="key wide" data-k="back">Del</button>';
        return '<button class="key ' + (best[k] || "") + '" data-k="' + k + '">' + k + '</button>';
      }).join("") + '</div>';
    }).join("");
  }

  function toast(text){
    var el = $("toast");
    el.textContent = text;
    el.classList.add("on");
    clearTimeout(toast._t);
    toast._t = setTimeout(function(){ el.classList.remove("on"); }, 1800);
  }

  function shake(){
    var row = $("board").querySelector('[data-row="' + guesses.length + '"]');
    if (!row) return;
    row.classList.add("shake");
    if (window.FX) FX.play("down");
    setTimeout(function(){ row.classList.remove("shake"); }, 440);
  }

  /* ---------------- play ---------------- */
  function type(ch){
    if (finished || revealRow >= 0 || current.length >= COLS) return;
    current += ch;
    drawBoard();
  }
  function back(){
    if (finished || revealRow >= 0) return;
    current = current.slice(0, -1);
    drawBoard();
  }

  function submit(){
    if (finished || revealRow >= 0) return;
    if (current.length < COLS){ toast("Not enough letters"); return shake(); }
    if (VALID && !VALID.has(current)){ toast("Not in word list"); return shake(); }

    guesses.push(current);
    var won = current === answer;
    current = "";
    if (won || guesses.length >= ROWS) finished = true;

    revealRow = guesses.length - 1;
    saveLocal(finished ? won : undefined);
    drawBoard();
    if (window.FX) FX.play(won ? "coin" : "press");
  }

  function shareGrid(){
    var sq = { exact:"🟩", close:"🟦", miss:"⬛" };
    return guesses.map(function(g){
      return score(g, answer).map(function(s){ return sq[s]; }).join("");
    }).join("\n");
  }

  function finish(won){
    $("game").hidden = true;
    $("done").hidden = false;

    var grid = shareGrid();
    $("done").innerHTML =
      '<div class="result">' +
        '<div class="big">' + (won
          ? 'Got it in <span>' + guesses.length + '</span>'
          : 'Out of goes — it was <span>' + esc(answer.toUpperCase()) + '</span>') + '</div>' +
        '<div class="grid-share">' + grid.split("\n").join("<br>") + '</div>' +
        '<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">' +
          '<button class="btn acid" id="shareBtn"><span>Copy result</span></button>' +
          '<a class="btn" href="index.html"><span>← Dashboard</span></a>' +
        '</div>' +
        '<div class="tag" style="margin-top:16px">next word at midnight</div>' +
      '</div>';

    $("shareBtn").addEventListener("click", function(){
      var text = "Not-Wordle #" + number + " " + (won ? guesses.length : "X") + "/6\n\n" + grid;
      if (navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(text).then(
          function(){ toast("Copied"); H.toast("Result copied"); },
          function(){ window.prompt("Copy:", text); });
      } else window.prompt("Copy:", text);
    });

    renderRecord();
    saveResult(won);
  }

  /* ---------------- personal record (local, no account needed) ------- */
  function renderRecord(){
    var box = $("record");
    if (!box) return;

    var h = history();
    if (!h.length){
      H.state(box, "Play a few days and your own record builds up here — no account needed.");
      if ($("recordMeta")) $("recordMeta").textContent = "";
      return;
    }

    var played = h.length;
    var solved = h.filter(function(x){ return x.solved; }).length;

    /* streak: consecutive most-recent days solved */
    var streak = 0;
    for (var i = 0; i < h.length; i++){ if (h[i].solved) streak++; else break; }

    var dist = [0,0,0,0,0,0];
    h.forEach(function(x){ if (x.solved) dist[x.n - 1]++; });
    var peak = Math.max.apply(null, dist.concat([1]));
    var todayN = (finished && guesses[guesses.length-1] === answer) ? guesses.length : 0;

    box.innerHTML =
      '<div class="kv" style="margin-bottom:18px">' +
        '<div><div class="k">Played</div><div class="v">' + played + '</div></div>' +
        '<div><div class="k">Solved</div><div class="v">' + solved + '</div></div>' +
        '<div><div class="k">Win rate</div><div class="v">' + Math.round(solved/played*100) + '%</div></div>' +
        '<div><div class="k">Streak</div><div class="v hot">' + streak + '</div></div>' +
      '</div>' +
      '<div class="eyebrow">guess distribution</div>' +
      '<div class="dist">' +
        dist.map(function(n, i){
          return '<div class="dist-row' + (i + 1 === todayN ? " on" : "") + '">' +
            '<span class="n">' + (i+1) + '</span>' +
            '<span class="b" style="width:' + Math.max(8, (n/peak)*100).toFixed(0) + '%">' + n + '</span>' +
          '</div>';
        }).join("") +
      '</div>';

    if ($("recordMeta")) $("recordMeta").textContent = "this browser";
  }

  /* ---------------- input ---------------- */
  document.addEventListener("keydown", function(e){
    if (finished) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    if (e.key === "Enter"){ e.preventDefault(); return submit(); }
    if (e.key === "Backspace"){ e.preventDefault(); return back(); }
    var k = (e.key || "").toLowerCase();
    if (/^[a-z]$/.test(k)) type(k);
  });

  $("keys").addEventListener("click", function(e){
    var b = e.target.closest("[data-k]");
    if (!b) return;
    var k = b.getAttribute("data-k");
    if (k === "enter") return submit();
    if (k === "back") return back();
    type(k);
  });

  /* ---------------- leaderboard ---------------- */
  function sb(){
    var a = window.AUTH;
    return (a && a.signedIn) ? a : null;
  }

  function saveResult(won){
    var a = sb();
    if (!a) return;
    fetch(a.url + "/rest/v1/word_results", {
      method: "POST",
      headers: {
        apikey: a.key, Authorization: "Bearer " + a.token,
        "Content-Type": "application/json", Prefer: "return=minimal"
      },
      body: JSON.stringify({
        user_id: a.user.id, day: day, number: number,
        guesses: guesses.length, solved: won, pattern: shareGrid()
      })
    }).then(loadLeaderboard).catch(function(){});
  }

  function loadLeaderboard(){
    var a = sb();
    if (!a){
      H.state($("leaderboard"), "Sign in on the dashboard to join the leaderboard.");
      if ($("lbMeta")) $("lbMeta").textContent = "";
      return;
    }
    fetch(a.url + "/rest/v1/rpc/word_leaderboard", {
      method: "POST",
      headers: { apikey: a.key, Authorization: "Bearer " + a.token, "Content-Type": "application/json" },
      body: "{}"
    })
    .then(function(r){ return r.ok ? r.json() : []; })
    .then(function(rows){
      rows = rows || [];
      if (!rows.length){
        H.state($("leaderboard"), "Nobody has played yet. Be first.");
        if ($("lbMeta")) $("lbMeta").textContent = "";
        return;
      }
      if ($("lbMeta")) $("lbMeta").textContent = rows.length + " player" + (rows.length === 1 ? "" : "s");
      $("leaderboard").innerHTML = '<div class="scroll-x"><table><thead><tr>' +
        '<th></th><th>Player</th><th class="num">Solved</th><th class="num">Played</th>' +
        '<th class="num">Avg</th><th class="num">Streak</th><th class="num">Best</th>' +
        '</tr></thead><tbody>' +
        rows.map(function(r, i){
          return '<tr>' +
            '<td class="rank' + (i === 0 ? " gold" : "") + '">' + (i+1) + '</td>' +
            '<td class="pname">' + esc(r.display_name) + (i === 0 ? " 👑" : "") + '</td>' +
            '<td class="num wins">' + r.wins + '</td>' +
            '<td class="num">' + r.played + '</td>' +
            '<td class="num">' + (r.avg_guesses == null ? "—" : r.avg_guesses) + '</td>' +
            '<td class="num streak">' + (r.current_streak || 0) + '</td>' +
            '<td class="num">' + (r.best_streak || 0) + '</td>' +
          '</tr>';
        }).join("") + '</tbody></table></div>';
    })
    .catch(function(){
      H.state($("leaderboard"), "Couldn't load the leaderboard.", true);
    });
  }

  window.addEventListener("auth:changed", loadLeaderboard);

  /* ---------------- boot ---------------- */
  function start(){
    VALID = new Set(window.WORD_GUESSES || []);
    if (answer) VALID.add(answer);

    loadLocal();
    $("puzzleNo").textContent = "Puzzle #" + number + " · " + day;
    drawBoard();
    drawKeys();
    renderRecord();

    if (finished) finish(guesses[guesses.length - 1] === answer);
    loadLeaderboard();

    if (window.FX && FX.register){
      FX.register([
        { id:"wd-share", group:"Actions", label:"Copy today's result", icon:"⧉",
          run:function(){ var b = $("shareBtn"); if (b) b.click(); else H.toast("Finish the puzzle first"); } }
      ]);
    }
  }

  if (!H.PROXY){
    H.state($("game"), "Needs the Worker — set FLIGHT_PROXY in config.js.", true);
  } else {
    H.getJSON(H.PROXY + "/word", 10000)
      .then(function(j){
        answer = String(j.word || "").toLowerCase();
        day = j.day; number = j.number;
        start();
      })
      .catch(function(){
        H.state($("game"), "Couldn't fetch today's word. Try refreshing.", true);
      });
  }
})();
