/* =====================================================================
   admin.js — who can get in, who actually has, and the ledger.
   ---------------------------------------------------------------------
   Everything here is enforced by row-level security in the database as
   well. This page is only the friendly way in: faking isAdmin in the
   console gets you a nicer-looking page and nothing else.
   ===================================================================== */

(function () {
  "use strict";

  var $ = H.$, esc = H.esc;
  var A = null;                 // window.AUTH once resolved
  var invites = [], users = [], gameRows = [];

  function when(iso){
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString([], { day:"2-digit", month:"short", year:"2-digit" });
  }
  function msg(el, text, bad){
    $(el).innerHTML = text
      ? '<div class="state' + (bad ? " err" : "") + '" style="padding:6px 0 12px">' + esc(text) + '</div>'
      : "";
  }

  /* ---------------- supabase ---------------- */
  function rest(path, opts){
    opts = opts || {};
    return fetch(A.url + path, {
      method: opts.method || "GET",
      headers: {
        apikey: A.key,
        Authorization: "Bearer " + A.token,
        "Content-Type": "application/json",
        Prefer: opts.prefer || "return=representation"
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function(r){
      if (!r.ok){
        return r.json().catch(function(){ return {}; }).then(function(j){
          throw new Error(j.message || j.hint || ("request failed (" + r.status + ")"));
        });
      }
      return r.status === 204 ? null : r.json();
    });
  }
  function rpc(fn, args){ return rest("/rest/v1/rpc/" + fn, { method:"POST", body: args || {} }); }

  /* ---------------- overview ---------------- */
  function renderOverview(){
    var joined = {};
    users.forEach(function(u){ joined[(u.email || "").toLowerCase()] = true; });
    var pending = invites.filter(function(i){ return !joined[(i.email || "").toLowerCase()]; }).length;
    var admins = users.filter(function(u){ return u.is_admin; }).length;

    $("adStats").innerHTML =
      '<div><div class="k">Accounts</div><div class="v"><b>' + users.length + '</b></div></div>' +
      '<div><div class="k">Admins</div><div class="v"><b>' + admins + '</b></div></div>' +
      '<div><div class="k">Invited</div><div class="v"><b>' + invites.length + '</b></div></div>' +
      '<div><div class="k">Not yet joined</div><div class="v"><b>' + pending + '</b></div></div>' +
      '<div><div class="k">Games logged</div><div class="v"><b>' + gameRows.length + '</b></div></div>';
  }

  /* ---------------- invites ---------------- */
  function renderInvites(){
    var box = $("invites");
    if (!invites.length){
      H.state(box, "Nobody invited yet.");
      $("inviteMeta").textContent = "0 invited";
      renderOverview();
      return;
    }
    $("inviteMeta").textContent = invites.length + " invited";

    var joined = {};
    users.forEach(function(u){ joined[(u.email || "").toLowerCase()] = true; });

    box.innerHTML = '<table><thead><tr>' +
      '<th>Email</th><th>Note</th><th>Status</th><th>Invited</th><th></th>' +
      '</tr></thead><tbody>' +
      invites.map(function(i){
        var has = joined[(i.email || "").toLowerCase()];
        return '<tr>' +
          '<td>' + esc(i.email) + '</td>' +
          '<td class="mono-sm">' + esc(i.note || "") + '</td>' +
          '<td><span class="pill ' + (has ? "joined" : "pending") + '">' + (has ? "signed up" : "not yet") + '</span></td>' +
          '<td class="mono-sm">' + when(i.created_at) + '</td>' +
          '<td class="act">' +
            (has ? "" : '<button class="btn ghost" data-copy="' + esc(i.email) + '"><span>Copy invite</span></button> ') +
            '<button class="btn ghost hot" data-revoke="' + esc(i.email) + '"><span>Revoke</span></button>' +
          '</td>' +
        '</tr>';
      }).join("") + '</tbody></table>';

    renderOverview();
  }

  function loadInvites(){
    return rest("/rest/v1/allowed_emails?select=*&order=created_at.desc")
      .then(function(rows){ invites = rows || []; renderInvites(); })
      .catch(function(e){ H.state($("invites"), e.message, true); });
  }

  $("addInvite").addEventListener("click", function(){
    var email = ($("newEmail").value || "").trim().toLowerCase();
    var note = ($("newNote").value || "").trim();

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return msg("inviteMsg", "That doesn't look like an email address.", true);
    if (invites.some(function(i){ return (i.email || "").toLowerCase() === email; })){
      return msg("inviteMsg", "That address is already invited.", true);
    }

    this.disabled = true;
    msg("inviteMsg", "Adding…");
    rest("/rest/v1/allowed_emails", { method:"POST", body:{ email:email, note: note || null } })
      .then(function(){
        $("newEmail").value = ""; $("newNote").value = "";
        msg("inviteMsg", "");
        H.toast("Access granted to " + email);
        return loadInvites();
      })
      .catch(function(e){ msg("inviteMsg", e.message, true); })
      .then(function(){ $("addInvite").disabled = false; });
  });

  /* Hands you a ready-made message to paste wherever you actually talk. */
  function inviteText(email){
    return "You've got access to my dashboard: " + window.location.origin + "\n\n" +
      "Click Sign in, then Create account, and use this email: " + email + "\n" +
      "Pick any password you like — it only works for that address.";
  }

  $("invites").addEventListener("click", function(e){
    var copy = e.target.closest("[data-copy]");
    if (copy){
      var text = inviteText(copy.getAttribute("data-copy"));
      if (navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(text).then(
          function(){ H.toast("Invite copied"); },
          function(){ window.prompt("Copy this:", text); });
      } else window.prompt("Copy this:", text);
      return;
    }

    var b = e.target.closest("[data-revoke]");
    if (!b) return;
    var email = b.getAttribute("data-revoke");
    if (!confirm("Revoke the invite for " + email + "?\n\nIf they already have an account it keeps working — remove it under Accounts.")) return;
    rest("/rest/v1/allowed_emails?email=eq." + encodeURIComponent(email), { method:"DELETE", prefer:"return=minimal" })
      .then(loadInvites)
      .catch(function(err){ msg("inviteMsg", err.message, true); });
  });

  /* ---------------- accounts ---------------- */
  function renderUsers(){
    var box = $("users");
    if (!users.length){
      H.state(box, "No accounts yet.");
      $("userMeta").textContent = "0 accounts";
      return;
    }
    $("userMeta").textContent = users.length + " account" + (users.length === 1 ? "" : "s");

    box.innerHTML = '<table><thead><tr>' +
      '<th>Person</th><th>Email</th><th>Joined</th><th>Last seen</th><th></th>' +
      '</tr></thead><tbody>' +
      users.map(function(u){
        var me = A.user && u.id === A.user.id;
        return '<tr>' +
          '<td><span style="font-weight:500">' + esc(u.display_name || "—") + '</span>' +
            (u.is_admin ? ' <span class="pill admin">admin</span>' : "") +
            (me ? ' <span class="mono-sm">(you)</span>' : "") + '</td>' +
          '<td class="mono-sm">' + esc(u.email) + '</td>' +
          '<td class="mono-sm">' + when(u.created_at) + '</td>' +
          '<td class="mono-sm">' + when(u.last_sign_in_at) + '</td>' +
          '<td class="act">' +
            (me ? "" :
              '<button class="btn ghost" data-admin="' + esc(u.id) + '" data-make="' + (u.is_admin ? "0" : "1") + '">' +
                '<span>' + (u.is_admin ? "Remove admin" : "Make admin") + '</span></button> ' +
              '<button class="btn ghost hot" data-del="' + esc(u.id) + '" data-email="' + esc(u.email) + '">' +
                '<span>Delete</span></button>') +
          '</td>' +
        '</tr>';
      }).join("") + '</tbody></table>';
  }

  function loadUsers(){
    return rpc("admin_list_users")
      .then(function(rows){ users = rows || []; renderUsers(); renderInvites(); })
      .catch(function(e){ H.state($("users"), e.message, true); });
  }

  $("users").addEventListener("click", function(e){
    var mk = e.target.closest("[data-admin]");
    if (mk){
      var make = mk.getAttribute("data-make") === "1";
      if (!confirm(make ? "Give this person full admin rights?" : "Remove admin rights?")) return;
      rpc("admin_set_admin", { target: mk.getAttribute("data-admin"), make_admin: make })
        .then(loadUsers)
        .catch(function(err){ msg("userMsg", err.message, true); });
      return;
    }

    var del = e.target.closest("[data-del]");
    if (del){
      var email = del.getAttribute("data-email");
      var typed = prompt("This permanently deletes " + email + " and their saved settings.\n\nType the email address to confirm:");
      if (!typed || typed.trim().toLowerCase() !== email.toLowerCase()){
        if (typed !== null) msg("userMsg", "Didn't match — nothing was deleted.", true);
        return;
      }
      msg("userMsg", "Deleting…");
      rpc("admin_delete_user", { target: del.getAttribute("data-del") })
        .then(function(){ msg("userMsg", ""); return loadUsers(); })
        .catch(function(err){ msg("userMsg", err.message, true); });
    }
  });

  /* ---------------- dutch blitz ---------------- */
  function loadGames(){
    return rest("/rest/v1/dutch_blitz_games?select=*&order=played_at.desc&limit=100")
      .then(function(rows){
        gameRows = rows || [];
        $("gameMeta").textContent = gameRows.length + " game" + (gameRows.length === 1 ? "" : "s");
        renderOverview();

        if (!gameRows.length){ H.state($("games"), "No games recorded yet."); return; }

        $("games").innerHTML = '<table><thead><tr>' +
          '<th>Played</th><th>Winner</th><th>Players</th><th class="num">Target</th><th></th>' +
          '</tr></thead><tbody>' +
          gameRows.map(function(g){
            return '<tr>' +
              '<td class="mono-sm">' + when(g.played_at) + '</td>' +
              '<td style="color:var(--acid);font-weight:500">' + esc(g.winner) + '</td>' +
              '<td class="mono-sm">' + esc((g.players || []).join(", ")) + '</td>' +
              '<td class="num mono-sm">' + esc(g.target_score) + '</td>' +
              '<td class="act"><button class="btn ghost hot" data-game="' + esc(g.id) + '"><span>Delete</span></button></td>' +
            '</tr>';
          }).join("") + '</tbody></table>';
      })
      .catch(function(e){ H.state($("games"), e.message, true); });
  }

  $("games").addEventListener("click", function(e){
    var b = e.target.closest("[data-game]");
    if (!b) return;
    if (!confirm("Delete this game from the ledger?")) return;
    rest("/rest/v1/dutch_blitz_games?id=eq." + encodeURIComponent(b.getAttribute("data-game")),
         { method:"DELETE", prefer:"return=minimal" })
      .then(loadGames)
      .catch(function(err){ msg("gameMsg", err.message, true); });
  });

  /* ---------------- gate ---------------- */
  function showGate(title, body, withSignIn){
    $("adminBody").hidden = true;
    $("gate").hidden = false;
    $("gate").innerHTML =
      '<h2>' + esc(title) + '</h2><p>' + esc(body) + '</p>' +
      (withSignIn ? '<button class="btn acid lg" id="gateSignIn"><span>Sign in</span></button>' : "") +
      '<div style="margin-top:18px"><a class="btn" href="index.html"><span>← Back to the dashboard</span></a></div>';
    if (withSignIn && window.AUTH && window.AUTH.signIn){
      $("gateSignIn").addEventListener("click", window.AUTH.signIn);
    }
  }

  function start(auth){
    A = auth;
    $("whoami").textContent = A.signedIn ? A.user.email : "";

    if (!A.enabled) return showGate("Not configured", "Supabase isn't set up yet, so there's nothing to administer.", false);
    if (!A.signedIn) return showGate("Sign in required", "This page is for site admins.", true);
    if (!A.isAdmin) return showGate("No access", "Your account doesn't have admin rights.", false);

    $("gate").hidden = true;
    $("adminBody").hidden = false;
    loadUsers().then(loadInvites).then(loadGames);
  }

  window.addEventListener("auth:changed", function(e){ start(e.detail); });
  if (window.AUTH) start(window.AUTH);
})();
