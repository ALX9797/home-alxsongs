/* =====================================================================
   db.js — tiny storage layer for game results.
   Uses Supabase REST if configured in config.js, otherwise localStorage.
   No SDK, no build step, no dependencies.
   ===================================================================== */

window.DB = (function () {
  var C = window.CONFIG || {};
  var URL_ = (C.SUPABASE_URL || "").replace(/\/+$/, "");
  var KEY = C.SUPABASE_KEY || "";
  var TABLE = C.GAMES_TABLE || "dutch_blitz_games";
  var LS_KEY = "dutchblitz.games.v1";

  var cloud = !!(URL_ && KEY);

  function headers(extra) {
    var h = {
      apikey: KEY,
      Authorization: "Bearer " + KEY,
      "Content-Type": "application/json"
    };
    for (var k in extra || {}) h[k] = extra[k];
    return h;
  }

  function localAll() {
    try {
      return JSON.parse(localStorage.getItem(LS_KEY) || "[]");
    } catch (e) {
      return [];
    }
  }
  function localWrite(arr) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(arr));
    } catch (e) {}
  }

  return {
    isCloud: function () {
      return cloud;
    },

    mode: function () {
      return cloud ? "cloud" : "local";
    },

    /* returns array of games, newest first */
    list: function () {
      if (!cloud) {
        return Promise.resolve(
          localAll().sort(function (a, b) {
            return (b.played_at || "").localeCompare(a.played_at || "");
          })
        );
      }
      return fetch(
        URL_ + "/rest/v1/" + TABLE + "?select=*&order=played_at.desc&limit=500",
        { headers: headers() }
      ).then(function (r) {
        if (!r.ok) throw new Error("Supabase read failed (" + r.status + ")");
        return r.json();
      });
    },

    /* game = {played_at, target_score, players, winner, final_scores, rounds} */
    save: function (game) {
      if (!cloud) {
        var all = localAll();
        game.id = "local-" + Date.now();
        all.push(game);
        localWrite(all);
        return Promise.resolve(game);
      }
      return fetch(URL_ + "/rest/v1/" + TABLE, {
        method: "POST",
        headers: headers({ Prefer: "return=representation" }),
        body: JSON.stringify(game)
      }).then(function (r) {
        if (!r.ok) {
          return r.text().then(function (t) {
            throw new Error("Supabase write failed (" + r.status + "): " + t);
          });
        }
        return r.json().then(function (rows) {
          return rows[0];
        });
      });
    },

    remove: function (id) {
      if (!cloud) {
        localWrite(
          localAll().filter(function (g) {
            return g.id !== id;
          })
        );
        return Promise.resolve();
      }
      return fetch(
        URL_ + "/rest/v1/" + TABLE + "?id=eq." + encodeURIComponent(id),
        { method: "DELETE", headers: headers() }
      ).then(function (r) {
        if (!r.ok) throw new Error("Delete failed (" + r.status + ")");
      });
    },

    /* any games sitting in this browser that could be pushed to the cloud */
    localPending: function () {
      return localAll();
    },
    clearLocal: function () {
      localWrite([]);
    }
  };
})();
