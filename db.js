/* =====================================================================
   db.js — where the Dutch Blitz games live.

   A Google Sheet, reached through a small Apps Script deployed from the
   sheet itself (see SETUP.md, "Where the games live"). Sheets don't
   sleep, don't need keys, and you can open the ledger and read it.

   Same API as before, so games.html and the dashboard don't care where
   the data comes from:

     DB.list()      -> Promise of games, newest first
     DB.save(game)  -> Promise of the saved game
     DB.remove(id)  -> Promise
     DB.isCloud()   -> true when a sheet is configured
     DB.mode()      -> "sheet" | "local"

   With no SHEET_API configured it quietly keeps games in this browser,
   exactly as it always did.
   ===================================================================== */

window.DB = (function () {
  var C = window.CONFIG || {};
  var API = (C.SHEET_API || "").trim();
  var LS_KEY = "dutchblitz.games.v1";
  var cloud = !!API;

  function localAll() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || "[]"); }
    catch (e) { return []; }
  }
  function localWrite(arr) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(arr)); } catch (e) {}
  }
  function newestFirst(a, b) {
    return String(b.played_at || "").localeCompare(String(a.played_at || ""));
  }
  function newId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "g-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
  }

  /* Apps Script cannot answer a CORS preflight, so writes are sent as a
     "simple request": text/plain, no custom headers. The reply still
     arrives as JSON. */
  function send(payload) {
    return fetch(API, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    }).then(function (r) {
      if (!r.ok) throw new Error("Sheet write failed (HTTP " + r.status + ")");
      return r.json();
    });
  }

  function readSheet() {
    return fetch(API, { method: "GET" })
      .then(function (r) {
        if (!r.ok) throw new Error("Sheet read failed (HTTP " + r.status + ")");
        return r.json();
      })
      .then(function (j) {
        if (!j || !j.ok) throw new Error((j && j.error) || "The sheet script refused the request.");
        return (j.games || []).sort(newestFirst);
      });
  }

  return {
    isCloud: function () { return cloud; },
    mode: function () { return cloud ? "sheet" : "local"; },

    /* every game, newest first */
    list: function () {
      if (!cloud) return Promise.resolve(localAll().sort(newestFirst));
      return readSheet();
    },

    /* game = {played_at, target_score, players, winner, final_scores, rounds} */
    save: function (game) {
      if (!cloud) {
        var all = localAll();
        game.id = game.id || "local-" + Date.now();
        all.push(game);
        localWrite(all);
        return Promise.resolve(game);
      }
      /* the id is minted here, before the request: it makes a retry safe
         (the script overwrites a row with the same id rather than adding
         a second one) and lets us confirm a write whose reply we could
         not read. */
      if (!game.id) game.id = newId();
      return send({ action: "save", game: game })
        .then(function (j) {
          if (!j.ok) throw new Error(j.error || "The sheet script could not save that game.");
          return game;
        })
        .catch(function (err) {
          /* A browser can be refused the *reply* while the write itself
             landed. Ask the sheet before telling anyone it failed. */
          return readSheet().then(function (games) {
            var found = games.some(function (g) { return String(g.id) === String(game.id); });
            if (found) return game;
            throw err;
          }, function () { throw err; });
        });
    },

    remove: function (id) {
      if (!cloud) {
        localWrite(localAll().filter(function (g) { return g.id !== id; }));
        return Promise.resolve();
      }
      return send({ action: "remove", id: id }).then(function (j) {
        if (!j.ok) throw new Error(j.error || "The sheet script could not remove that game.");
      });
    },

    /* any games sitting in this browser that could be pushed to the sheet */
    localPending: function () { return localAll(); },
    clearLocal: function () { localWrite([]); }
  };
})();
