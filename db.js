/* =====================================================================
   db.js — tiny storage layer for game results.
   Uses Supabase REST if configured in config.js, otherwise localStorage.
   No SDK, no build step, no dependencies.
   ===================================================================== */

window.DB = (function () {
  var C = window.CONFIG || {};

  /* Supabase shows the endpoint as ".../rest/v1/" in its dashboard, so that's
     what gets pasted. We add the API path ourselves, so strip it if present —
     otherwise every request 404s on a doubled path. */
  var URL_ = (C.SUPABASE_URL || "")
    .replace(/\/+$/, "")
    .replace(/\/(rest|auth|storage|realtime)\/v\d+$/, "");
  var KEY = C.SUPABASE_KEY || "";
  var TABLE = C.GAMES_TABLE || "dutch_blitz_games";
  var LS_KEY = "dutchblitz.games.v1";

  var cloud = !!(URL_ && KEY);

  /* A rejected fetch (DNS, offline, refused connection) surfaces as a bare
     TypeError("Failed to fetch"). That tells the page nothing — translate it
     into the one thing that is usually wrong: the project URL in config.js
     points somewhere that doesn't exist. HTTP errors pass through as-is. */
  function unreachable(e) {
    if (e instanceof TypeError) {
      throw new Error(
        "Could not reach Supabase at " + URL_ +
        ". Check SUPABASE_URL in config.js and that the project still exists."
      );
    }
    throw e;
  }

  function headers(extra) {
    var h = {
      apikey: KEY,
      Authorization: "Bearer " + (sessionToken() || KEY),
      "Content-Type": "application/json"
    };
    for (var k in extra || {}) h[k] = extra[k];
    return h;
  }

  /* auth.js keeps the sign-in here ("home.session.v1"). When it holds a live
     access token, send it instead of the anon key — the database's delete
     rule only recognises signed-in users, so without this every delete is
     anonymous and silently removes nothing. Expired sessions are ignored so
     a stale token can't turn working anonymous reads into 401s. */
  var LS_SESSION = "home.session.v1";
  function session() {
    try {
      var s = JSON.parse(localStorage.getItem(LS_SESSION) || "null");
      if (s && s.access_token && s.expires_at && s.expires_at * 1000 > Date.now() + 60000) return s;
    } catch (e) {}
    return null;
  }
  function sessionToken() {
    var s = session();
    return s ? s.access_token : null;
  }
  function sessionUserId() {
    var s = session();
    return s && s.user && s.user.id ? s.user.id : null;
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
      }).catch(unreachable);
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
      /* stamp ownership while signed in, so the "delete your own games"
         rule can tell who recorded what (legacy rows stay null, which the
         rule also lets signed-in users delete) */
      var uid = sessionUserId();
      if (uid && !game.created_by) game.created_by = uid;
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
      }).catch(unreachable);
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
      }).catch(unreachable);
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
