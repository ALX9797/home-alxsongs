/* =====================================================================
   The Dutch Blitz ledger — the sheet half of db.js
   ---------------------------------------------------------------------
   Paste this whole file into the Apps Script editor that belongs to your
   sheet:  Extensions → Apps Script → delete what's there → paste → Save.

   Then Deploy → New deployment → gear icon → "Web app":
        Description   : ledger
        Execute as    : Me
        Who has access: Anyone
   → Deploy → Authorise (it will ask; it's your own script) → copy the
   /exec URL. That URL goes in config.js as SHEET_API.

   Why "Anyone": the page is a static file with no server of its own, so
   the browser posts straight here. Keep the URL to yourselves — it is
   the only key to the ledger. Anything that goes wrong is recoverable:
   the sheet keeps a version history (File → Version history).

   The sheet needs no formatting: the first write creates the "Games" tab
   and its header row.
   ===================================================================== */

var SHEET_NAME = "Games";
var HEADERS = ["id", "played_at", "target_score", "players", "final_scores", "winner", "rounds", "created_at"];

function ledger_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sh) sh = SpreadsheetApp.getActiveSpreadsheet().insertSheet(SHEET_NAME);
  if (sh.getLastRow() === 0) {
    sh.appendRow(HEADERS);
    sh.getRange(1, 1, 1, HEADERS.length).setFontWeight("bold");
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 300);
    sh.setColumnWidth(4, 220);
    sh.setColumnWidth(5, 220);
  }
  return sh;
}

function reply_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function parse_(v, fallback) {
  if (v === null || v === undefined || v === "") return fallback;
  if (typeof v === "object") return v;
  try { return JSON.parse(v); } catch (e) { return fallback; }
}

function iso_(v) {
  if (v instanceof Date) return v.toISOString();
  return String(v || "");
}

function findRow_(sh, id) {
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }
  return 0;
}

/* the page asks for the lot and sorts it itself */
function doGet() {
  try {
    var sh = ledger_();
    var last = sh.getLastRow();
    var games = [];
    if (last > 1) {
      var rows = sh.getRange(2, 1, last - 1, HEADERS.length).getValues();
      games = rows.filter(function (r) { return String(r[0]) !== ""; }).map(function (r) {
        return {
          id: String(r[0]),
          played_at: iso_(r[1]),
          target_score: Number(r[2]) || 0,
          players: parse_(r[3], []),
          final_scores: parse_(r[4], {}),
          winner: String(r[5] || ""),
          rounds: parse_(r[6], []),
          created_at: iso_(r[7])
        };
      });
    }
    return reply_({ ok: true, games: games, count: games.length });
  } catch (e) {
    return reply_({ ok: false, error: String(e) });
  }
}

function doPost(e) {
  var body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || "{}"); }
  catch (err) { return reply_({ ok: false, error: "Could not read the request body." }); }

  try {
    var sh = ledger_();

    if (body.action === "save" && body.game) {
      var g = body.game;
      var values = [
        String(g.id || ""),
        g.played_at || new Date().toISOString(),
        Number(g.target_score) || 0,
        JSON.stringify(g.players || []),
        JSON.stringify(g.final_scores || {}),
        String(g.winner || ""),
        JSON.stringify(g.rounds || []),
        new Date().toISOString()
      ];
      /* same id twice = the browser retried a write whose reply it never
         saw, so overwrite rather than duplicate */
      var row = findRow_(sh, values[0]);
      if (row > 0) sh.getRange(row, 1, 1, values.length).setValues([values]);
      else sh.appendRow(values);
      return reply_({ ok: true, id: values[0] });
    }

    if (body.action === "remove" && body.id) {
      var at = findRow_(sh, body.id);
      if (at > 0) sh.deleteRow(at);
      return reply_({ ok: true, removed: at > 0 });
    }

    return reply_({ ok: false, error: "Unknown action: " + body.action });
  } catch (e2) {
    return reply_({ ok: false, error: String(e2) });
  }
}
