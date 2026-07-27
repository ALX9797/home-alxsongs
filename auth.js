/* =====================================================================
   auth.js — sign-in and per-user preferences
   ---------------------------------------------------------------------
   Sign-in is by magic link, so no password is ever typed, sent or stored.
   Sign-up is invite-only, enforced in the database (see supabase-schema.sql).

   Works fine signed out: preferences fall back to this browser's local
   storage, so the site stays usable without an account.

   Exposes:
     window.PREFS                 current preferences
     event "prefs:changed"        fired on window whenever they change
   ===================================================================== */

(function () {
  "use strict";

  var C = window.CONFIG || {};

  /* Accept either the bare project URL or the ".../rest/v1/" form the Supabase
     dashboard displays — we append the API path ourselves. */
  var URL_ = (C.SUPABASE_URL || "")
    .replace(/\/+$/, "")
    .replace(/\/(rest|auth|storage|realtime)\/v\d+$/, "");
  var KEY = C.SUPABASE_KEY || "";
  var enabled = !!(URL_ && KEY);

  var LS_PREFS = "home.prefs.v1";
  var LS_SESSION = "home.session.v1";

  var DEFAULTS = {
    topics: ["music", "science", "tech", "world"],
    games: ["lol", "cs2"],
    flight_radius: 20,
    cards: { onthisday: true, overhead: true, feeds: true, esports: true }
  };

  var session = null;    // { access_token, refresh_token, expires_at, user }
  var profile = null;

  /* ---------------- helpers ---------------- */

  function $(id){ return document.getElementById(id); }
  function esc(s){
    return String(s == null ? "" : s).replace(/[&<>"]/g, function(c){
      return ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;" })[c];
    });
  }

  function clone(o){ return JSON.parse(JSON.stringify(o)); }

  function merged(p){
    var out = clone(DEFAULTS);
    if (!p) return out;
    if (Array.isArray(p.topics) && p.topics.length) out.topics = p.topics.slice();
    if (Array.isArray(p.games)) out.games = p.games.slice();
    if (typeof p.flight_radius === "number") out.flight_radius = p.flight_radius;
    if (p.cards && typeof p.cards === "object"){
      Object.keys(out.cards).forEach(function(k){
        if (typeof p.cards[k] === "boolean") out.cards[k] = p.cards[k];
      });
    }
    return out;
  }

  function readLocalPrefs(){
    try { return merged(JSON.parse(localStorage.getItem(LS_PREFS) || "null")); }
    catch (e) { return clone(DEFAULTS); }
  }
  function writeLocalPrefs(p){
    try { localStorage.setItem(LS_PREFS, JSON.stringify(p)); } catch (e) {}
  }

  /* Deferred by a tick on purpose: the page script registers its listener
     after this file runs, so a synchronous dispatch would be missed and the
     dashboard would sit waiting on its fallback timer. */
  function announce(){
    setTimeout(function(){
      window.dispatchEvent(new CustomEvent("prefs:changed", { detail: window.PREFS }));
    }, 0);
  }

  /* Shared auth state, for the admin page and anything else that needs it.
     isAdmin is a UI hint only — the database enforces it independently, so
     faking it here gets you a nicer-looking page and nothing more. */
  function publish(){
    window.AUTH = {
      enabled: enabled,
      signedIn: !!(session && session.user),
      user: (session && session.user) ? { id: session.user.id, email: session.user.email } : null,
      profile: profile,
      isAdmin: !!(profile && profile.is_admin),
      token: session ? session.access_token : null,
      url: URL_,
      key: KEY,
      signIn: function(){ signInModal(); },
      signOut: function(){ saveSession(null); profile = null; renderChip(); publish(); }
    };
    setTimeout(function(){
      window.dispatchEvent(new CustomEvent("auth:changed", { detail: window.AUTH }));
    }, 0);
  }

  function setPrefs(p, alsoLocal){
    window.PREFS = merged(p);
    if (alsoLocal !== false) writeLocalPrefs(window.PREFS);
    announce();
  }

  /* start from whatever this browser remembers */
  window.PREFS = readLocalPrefs();

  /* ---------------- supabase REST ---------------- */

  function api(path, opts){
    opts = opts || {};
    var h = {
      apikey: KEY,
      "Content-Type": "application/json"
    };
    h.Authorization = "Bearer " + ((session && session.access_token) || KEY);
    for (var k in (opts.headers || {})) h[k] = opts.headers[k];
    return fetch(URL_ + path, {
      method: opts.method || "GET",
      headers: h,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
  }

  function saveSession(s){
    session = s;
    try {
      if (s) localStorage.setItem(LS_SESSION, JSON.stringify(s));
      else localStorage.removeItem(LS_SESSION);
    } catch (e) {}
  }

  function loadSession(){
    try {
      var s = JSON.parse(localStorage.getItem(LS_SESSION) || "null");
      if (s && s.expires_at && s.expires_at * 1000 > Date.now() + 60000) return s;
      return s || null;   // expired sessions are refreshed below
    } catch (e) { return null; }
  }

  function refreshIfNeeded(){
    if (!session || !session.refresh_token) return Promise.resolve(false);
    var stillGood = session.expires_at && session.expires_at * 1000 > Date.now() + 60000;
    if (stillGood) return Promise.resolve(true);

    return fetch(URL_ + "/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      headers: { apikey: KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: session.refresh_token })
    }).then(function(r){
      if (!r.ok) throw new Error("refresh failed");
      return r.json();
    }).then(function(j){
      saveSession({
        access_token: j.access_token,
        refresh_token: j.refresh_token,
        expires_at: j.expires_at || Math.floor(Date.now()/1000) + (j.expires_in || 3600),
        user: j.user
      });
      return true;
    }).catch(function(){
      saveSession(null);
      return false;
    });
  }

  /* magic-link callback arrives as #access_token=...&refresh_token=... */
  function consumeHashSession(){
    var h = window.location.hash || "";
    if (h.indexOf("access_token=") === -1) return false;
    var p = new URLSearchParams(h.replace(/^#/, ""));
    var at = p.get("access_token");
    if (!at) return false;
    saveSession({
      access_token: at,
      refresh_token: p.get("refresh_token"),
      expires_at: Math.floor(Date.now()/1000) + parseInt(p.get("expires_in") || "3600", 10),
      user: null
    });
    /* don't leave tokens sitting in the address bar */
    history.replaceState(null, "", window.location.pathname + window.location.search);
    return true;
  }

  function fetchUser(){
    return api("/auth/v1/user").then(function(r){
      if (!r.ok) throw new Error("no user");
      return r.json();
    }).then(function(u){
      if (session) { session.user = u; saveSession(session); }
      return u;
    });
  }

  function fetchPrefs(){
    if (!session || !session.user) return Promise.resolve(null);
    return api("/rest/v1/preferences?select=*&user_id=eq." + session.user.id)
      .then(function(r){ return r.ok ? r.json() : []; })
      .then(function(rows){ return rows[0] || null; });
  }

  function fetchProfile(){
    if (!session || !session.user) return Promise.resolve(null);
    return api("/rest/v1/profiles?select=*&id=eq." + session.user.id)
      .then(function(r){ return r.ok ? r.json() : []; })
      .then(function(rows){ profile = rows[0] || null; return profile; });
  }

  function savePrefsRemote(p){
    if (!session || !session.user) return Promise.resolve();
    var row = {
      user_id: session.user.id,
      topics: p.topics,
      games: p.games,
      flight_radius: p.flight_radius,
      cards: p.cards,
      updated_at: new Date().toISOString()
    };
    return api("/rest/v1/preferences?on_conflict=user_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: row
    });
  }

  /* ---------------- UI ---------------- */

  function nameOf(){
    if (profile && profile.display_name) return profile.display_name;
    if (session && session.user && session.user.email) return session.user.email.split("@")[0];
    return "account";
  }

  function renderChip(){
    var slot = $("authSlot");
    if (!slot) return;
    if (!enabled){ slot.innerHTML = ""; return; }

    if (session && session.user){
      var admin = profile && profile.is_admin
        ? '<a class="navchip" href="admin.html" title="Admin">Admin</a>' : "";
      slot.innerHTML = admin + '<button class="navchip" id="acctBtn" title="' +
        esc(session.user.email) + '">' + esc(nameOf()) + '</button>';
      $("acctBtn").addEventListener("click", accountModal);
    } else {
      slot.innerHTML = '<button class="navchip" id="signInBtn">Sign in</button>';
      $("signInBtn").addEventListener("click", signInModal);
    }
  }

  function openModal(html){
    var bg = $("authModalBg");
    $("authModal").innerHTML = html;
    bg.classList.add("open");
  }
  function closeModal(){ $("authModalBg").classList.remove("open"); }

  function signInModal(){
    openModal(
      '<h3>Sign in</h3>' +
      '<div class="tag">invite only · no password needed</div>' +
      '<label class="f">Email address</label>' +
      '<input type="text" id="authEmail" placeholder="you@example.com" autocomplete="email">' +
      '<div class="state" id="authMsg" style="padding:10px 0 0"></div>' +
      '<div style="display:flex;gap:8px;margin-top:18px">' +
        '<button class="btn acid lg" id="authGo" style="flex:1;justify-content:center">Email me a link</button>' +
        '<button class="btn lg" id="authCancel">Cancel</button>' +
      '</div>' +
      '<div class="state" style="padding-top:14px;color:var(--ink-faint);font-size:11px">' +
      'We send a one-time link. Clicking it signs you in — there is no password to ' +
      'choose, forget or leak.</div>'
    );

    $("authCancel").addEventListener("click", closeModal);
    var input = $("authEmail");
    input.focus();
    input.addEventListener("keydown", function(e){ if (e.key === "Enter") go(); });
    $("authGo").addEventListener("click", go);

    function go(){
      var email = (input.value || "").trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){
        $("authMsg").className = "state err";
        $("authMsg").textContent = "That doesn't look like an email address.";
        return;
      }
      $("authGo").disabled = true;
      $("authMsg").className = "state";
      $("authMsg").textContent = "Sending…";

      fetch(URL_ + "/auth/v1/otp", {
        method: "POST",
        headers: { apikey: KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email,
          create_user: true,
          options: { email_redirect_to: window.location.origin + window.location.pathname }
        })
      }).then(function(r){
        if (r.ok){
          $("authMsg").className = "state";
          $("authMsg").innerHTML = 'Check <b style="color:var(--acid)">' + esc(email) +
            '</b> for a sign-in link. It expires in an hour.';
          $("authGo").textContent = "Sent";
          return;
        }
        return r.json().catch(function(){ return {}; }).then(function(j){
          $("authMsg").className = "state err";
          /* the invite trigger surfaces here */
          $("authMsg").textContent = /invited/i.test(j.msg || j.error_description || j.message || "")
            ? "That address hasn't been invited to this site."
            : (j.msg || j.error_description || j.message || "Couldn't send the link. Try again.");
          $("authGo").disabled = false;
        });
      }).catch(function(){
        $("authMsg").className = "state err";
        $("authMsg").textContent = "Network error. Try again.";
        $("authGo").disabled = false;
      });
    }
  }

  function accountModal(){
    var p = window.PREFS;
    var topicNames = { music:"Music & industry", science:"Science & space", tech:"Tech", world:"UK & World" };
    var gameNames = { lol:"League of Legends", cs2:"Counter-Strike 2" };
    var cardNames = { onthisday:"On This Day", overhead:"Overhead", feeds:"Feeds", esports:"Esports" };

    function chips(obj, selected, attr){
      return Object.keys(obj).map(function(k){
        var on = selected.indexOf(k) !== -1;
        return '<button class="chip' + (on ? " on" : "") + '" data-' + attr + '="' + k + '">' +
          esc(obj[k]) + '</button>';
      }).join("");
    }

    openModal(
      '<h3>' + esc(nameOf()) + '</h3>' +
      '<div class="tag">' + esc((session && session.user && session.user.email) || "") + '</div>' +

      '<label class="f">News topics</label>' +
      '<div class="chipbar" id="prefTopics">' + chips(topicNames, p.topics, "topic") + '</div>' +

      '<label class="f">Esports</label>' +
      '<div class="chipbar" id="prefGames">' + chips(gameNames, p.games, "game") + '</div>' +

      '<label class="f">Sections to show</label>' +
      '<div class="chipbar" id="prefCards">' +
        Object.keys(cardNames).map(function(k){
          return '<button class="chip' + (p.cards[k] ? " on" : "") + '" data-card="' + k + '">' +
            esc(cardNames[k]) + '</button>';
        }).join("") +
      '</div>' +

      '<label class="f">Flight radius — <span id="prefRadiusVal">' + p.flight_radius + ' nm</span></label>' +
      '<input type="range" id="prefRadius" min="5" max="100" step="5" value="' + p.flight_radius + '" style="width:100%">' +

      '<div class="state" id="prefMsg" style="padding:12px 0 0"></div>' +

      '<div style="display:flex;gap:8px;margin-top:14px">' +
        '<button class="btn acid lg" id="prefSave" style="flex:1;justify-content:center">Save</button>' +
        '<button class="btn lg" id="prefClose">Close</button>' +
      '</div>' +
      '<div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--line)">' +
        '<button class="btn ghost hot" id="signOut">Sign out</button>' +
      '</div>'
    );

    var draft = clone(p);

    function toggler(wrap, attr, list){
      $(wrap).addEventListener("click", function(e){
        var b = e.target.closest("[data-" + attr + "]");
        if (!b) return;
        var k = b.getAttribute("data-" + attr);
        var i = list.indexOf(k);
        if (i === -1) list.push(k); else list.splice(i, 1);
        b.classList.toggle("on");
      });
    }
    toggler("prefTopics", "topic", draft.topics);
    toggler("prefGames", "game", draft.games);

    $("prefCards").addEventListener("click", function(e){
      var b = e.target.closest("[data-card]");
      if (!b) return;
      var k = b.getAttribute("data-card");
      draft.cards[k] = !draft.cards[k];
      b.classList.toggle("on", draft.cards[k]);
    });

    $("prefRadius").addEventListener("input", function(){
      draft.flight_radius = +this.value;
      $("prefRadiusVal").textContent = draft.flight_radius + " nm";
    });

    $("prefClose").addEventListener("click", closeModal);
    $("signOut").addEventListener("click", function(){
      saveSession(null);
      profile = null;
      renderChip();
      closeModal();
    });

    $("prefSave").addEventListener("click", function(){
      if (!draft.topics.length){
        $("prefMsg").className = "state err";
        $("prefMsg").textContent = "Pick at least one news topic.";
        return;
      }
      $("prefSave").disabled = true;
      $("prefMsg").className = "state";
      $("prefMsg").textContent = "Saving…";
      setPrefs(draft);
      savePrefsRemote(draft).then(function(){
        $("prefMsg").textContent = "Saved.";
        setTimeout(closeModal, 500);
      }).catch(function(){
        $("prefMsg").className = "state err";
        $("prefMsg").textContent = "Saved on this device, but syncing failed.";
        $("prefSave").disabled = false;
      });
    });
  }

  /* preferences are editable signed-out too — same modal, local only */
  function localPrefsModal(){ accountModal(); }
  window.openPreferences = function(){
    if (session && session.user) accountModal();
    else if (enabled) signInModal();
    else localPrefsModal();
  };

  /* ---------------- boot ---------------- */

  function boot(){
    var bg = $("authModalBg");
    if (bg){
      bg.addEventListener("click", function(e){ if (e.target === bg) closeModal(); });
    }
    document.addEventListener("keydown", function(e){
      if (e.key === "Escape") closeModal();
    });

    if (!enabled){ renderChip(); publish(); announce(); return; }

    var fromLink = consumeHashSession();
    if (!fromLink) session = loadSession();

    if (!session){ renderChip(); publish(); announce(); return; }

    refreshIfNeeded()
      .then(function(okToGo){
        if (!okToGo && !session) throw new Error("no session");
        return fetchUser();
      })
      .then(function(){
        renderChip();
        return Promise.all([fetchProfile(), fetchPrefs()]);
      })
      .then(function(res){
        renderChip();
        publish();
        if (res[1]) setPrefs(res[1]); else announce();
      })
      .catch(function(){
        saveSession(null);
        renderChip();
        publish();
        announce();
      });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
