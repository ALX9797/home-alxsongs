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

  /* Email links come back as a URL fragment — either tokens, or an error.
     Returns "session", "recovery", "error" or false. */
  var hashError = null, isRecovery = false;

  function clearHash(){
    history.replaceState(null, "", window.location.pathname + window.location.search);
  }

  function consumeHashSession(){
    var h = window.location.hash || "";
    if (!h || h.length < 2) return false;
    var p = new URLSearchParams(h.replace(/^#/, ""));

    if (p.get("error")){
      var code = p.get("error_code") || "";
      hashError = /expired/i.test(code)
        ? "That link has expired or was already used. Sign in with your password below, or request a new link."
        : (p.get("error_description") || "That link didn't work.").replace(/\+/g, " ");
      clearHash();
      return "error";
    }

    var at = p.get("access_token");
    if (!at) return false;

    saveSession({
      access_token: at,
      refresh_token: p.get("refresh_token"),
      expires_at: Math.floor(Date.now()/1000) + parseInt(p.get("expires_in") || "3600", 10),
      user: null
    });
    isRecovery = p.get("type") === "recovery";
    clearHash();   /* don't leave tokens sitting in the address bar */
    return isRecovery ? "recovery" : "session";
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

  function saveName(name){
    if (!session || !session.user) return Promise.resolve();
    if (profile && profile.display_name === name) return Promise.resolve();
    return api("/rest/v1/profiles?id=eq." + session.user.id, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: { display_name: name }
    }).then(function(r){
      if (!r.ok) throw new Error("couldn't save name");
      if (profile) profile.display_name = name;
      return true;
    });
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

  /* Everything that has to happen once we hold a valid session. */
  function hydrate(){
    return fetchUser()
      .then(function(){
        renderChip();
        return Promise.all([fetchProfile(), fetchPrefs()]);
      })
      .then(function(res){
        renderChip();
        publish();
        if (res[1]) setPrefs(res[1]); else announce();
      });
  }

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
      $("signInBtn").addEventListener("click", function(){ signInModal("signin"); });
    }
  }

  function openModal(html){
    var bg = $("authModalBg");
    $("authModal").innerHTML = html;
    bg.classList.add("open");
  }
  function closeModal(){ $("authModalBg").classList.remove("open"); }

  var MIN_PW = 8;

  /* Turns GoTrue's terse errors into something a person can act on. */
  function readError(j, fallback){
    var m = (j && (j.msg || j.error_description || j.message)) || "";
    if (/invited/i.test(m)) return "That address hasn't been invited to this site.";
    if (/rate limit|too many/i.test(m)) return "Too many emails sent recently. Wait an hour, or sign in with your password.";
    if (/invalid login|invalid credentials/i.test(m)) return "Wrong email or password.";
    if (/already registered|already been registered/i.test(m)) return "That account already exists — sign in instead.";
    if (/password/i.test(m) && /short|least/i.test(m)) return "Password must be at least " + MIN_PW + " characters.";
    if (/not confirmed/i.test(m)) return "Check your email and confirm the address first.";
    return m || fallback;
  }

  function say(text, bad){
    var el = $("authMsg");
    if (!el) return;
    el.className = "state" + (bad ? " err" : "");
    el.innerHTML = text;
  }

  function tokenFrom(j){
    return {
      access_token: j.access_token,
      refresh_token: j.refresh_token,
      expires_at: j.expires_at || Math.floor(Date.now()/1000) + (j.expires_in || 3600),
      user: j.user || null
    };
  }

  function signInModal(mode){
    /* guard: this is used directly as a click handler in places, so the
       argument can arrive as an Event rather than a mode string */
    if (typeof mode !== "string" || !/^(signin|signup|reset)$/.test(mode)) mode = "signin";

    var titles = { signin:"Sign in", signup:"Create your account", reset:"Reset password" };
    var pwField = '<label class="f">Password</label>' +
      '<input type="password" id="authPw" autocomplete="' +
      (mode === "signup" ? "new-password" : "current-password") + '">';

    openModal(
      '<h3>' + titles[mode] + '</h3>' +
      '<div class="tag">invite only</div>' +

      (mode === "signup"
        ? '<label class="f">Your name</label>' +
          '<input type="text" id="authName" placeholder="what should the site call you?" ' +
          'autocomplete="given-name" maxlength="24">'
        : "") +

      '<label class="f">Email address</label>' +
      '<input type="text" id="authEmail" placeholder="you@example.com" autocomplete="email">' +

      (mode === "reset" ? "" : pwField) +
      (mode === "signup"
        ? '<label class="f">Confirm password</label>' +
          '<input type="password" id="authPw2" autocomplete="new-password">'
        : "") +

      '<div class="state" id="authMsg" style="padding:10px 0 0"></div>' +

      '<div style="display:flex;gap:8px;margin-top:18px">' +
        '<button class="btn acid lg" id="authGo" style="flex:1;justify-content:center">' +
          (mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Email reset link") +
        '</button>' +
        '<button class="btn lg" id="authCancel">Cancel</button>' +
      '</div>' +

      '<div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--line);' +
           'display:flex;gap:14px;flex-wrap:wrap">' +
        (mode !== "signin" ? '<button class="btn ghost" data-mode="signin">← Sign in</button>' : "") +
        (mode === "signin" ? '<button class="btn ghost" data-mode="signup">Create account</button>' : "") +
        (mode === "signin" ? '<button class="btn ghost" data-mode="reset">Forgot password?</button>' : "") +
        (mode === "signin" ? '<button class="btn ghost" id="authMagic">Email me a link</button>' : "") +
      '</div>'
    );

    if (hashError){ say(esc(hashError), true); hashError = null; }

    $("authCancel").addEventListener("click", closeModal);
    /* mode switching is delegated once, in boot() — binding it here would
       stack a fresh listener every time the modal is reopened */

    var emailEl = $("authEmail");
    emailEl.focus();
    [emailEl, $("authPw"), $("authPw2")].forEach(function(el){
      if (el) el.addEventListener("keydown", function(e){ if (e.key === "Enter") go(); });
    });
    $("authGo").addEventListener("click", go);
    if ($("authMagic")) $("authMagic").addEventListener("click", magicLink);

    function creds(){
      return {
        name: $("authName") ? ($("authName").value || "").trim() : "",
        email: (emailEl.value || "").trim().toLowerCase(),
        pw: $("authPw") ? $("authPw").value : "",
        pw2: $("authPw2") ? $("authPw2").value : ""
      };
    }
    function validEmail(e){ return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e); }

    function go(){
      var c = creds();
      if (!validEmail(c.email)) return say("That doesn't look like an email address.", true);

      if (mode === "reset") return sendReset(c.email);

      if (!c.pw) return say("Enter your password.", true);
      if (mode === "signup"){
        if (!c.name) return say("What should the site call you?", true);
        if (c.pw.length < MIN_PW) return say("Password must be at least " + MIN_PW + " characters.", true);
        if (c.pw !== c.pw2) return say("The two passwords don't match.", true);
        return signUp(c.email, c.pw, c.name);
      }
      return passwordSignIn(c.email, c.pw);
    }

    function busy(text){ $("authGo").disabled = true; say(text); }
    function free(){ $("authGo").disabled = false; }

    function passwordSignIn(email, pw){
      busy("Signing in…");
      fetch(URL_ + "/auth/v1/token?grant_type=password", {
        method: "POST",
        headers: { apikey: KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ email: email, password: pw })
      })
      .then(function(r){ return r.json().then(function(j){ return { ok:r.ok, j:j }; }); })
      .then(function(res){
        if (!res.ok){ say(esc(readError(res.j, "Couldn't sign you in.")), true); free(); return; }
        saveSession(tokenFrom(res.j));
        say("Signed in.");
        return hydrate().then(closeModal);
      })
      .catch(function(){ say("Network error. Try again.", true); free(); });
    }

    function signUp(email, pw, name){
      busy("Creating your account…");
      /* display_name goes into user metadata, which the handle_new_user
         trigger copies into the profiles row on sign-up */
      fetch(URL_ + "/auth/v1/signup", {
        method: "POST",
        headers: { apikey: KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email,
          password: pw,
          data: { display_name: name }
        })
      })
      .then(function(r){ return r.json().then(function(j){ return { ok:r.ok, j:j }; }); })
      .then(function(res){
        if (!res.ok){ say(esc(readError(res.j, "Couldn't create the account.")), true); free(); return; }

        /* With email confirmation off, Supabase returns a session straight away.
           With it on, it returns the user and expects them to confirm first. */
        if (res.j.access_token){
          saveSession(tokenFrom(res.j));
          say("Account created.");
          return hydrate().then(closeModal);
        }
        say('Account created. Check <b style="color:var(--acid)">' + esc(email) +
            '</b> to confirm your address, then sign in.');
        $("authGo").textContent = "Done";
      })
      .catch(function(){ say("Network error. Try again.", true); free(); });
    }

    function sendReset(email){
      busy("Sending…");
      var back = window.location.origin + window.location.pathname;
      fetch(URL_ + "/auth/v1/recover?redirect_to=" + encodeURIComponent(back), {
        method: "POST",
        headers: { apikey: KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ email: email })
      })
      .then(function(r){
        if (r.ok){
          say('If that address has an account, a reset link is on its way to <b style="color:var(--acid)">' +
              esc(email) + '</b>.');
          $("authGo").textContent = "Sent";
          return;
        }
        return r.json().catch(function(){ return {}; }).then(function(j){
          say(esc(readError(j, "Couldn't send the reset link.")), true); free();
        });
      })
      .catch(function(){ say("Network error. Try again.", true); free(); });
    }

    function magicLink(){
      var c = creds();
      if (!validEmail(c.email)) return say("Enter your email address first.", true);
      busy("Sending…");
      /* redirect_to is a query parameter on the REST endpoint — the
         options.emailRedirectTo body field is JS-SDK-only and is ignored
         here, falling back to the project's Site URL. */
      var back = window.location.origin + window.location.pathname;
      fetch(URL_ + "/auth/v1/otp?redirect_to=" + encodeURIComponent(back), {
        method: "POST",
        headers: { apikey: KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ email: c.email, create_user: true })
      })
      .then(function(r){
        if (r.ok){
          say('Check <b style="color:var(--acid)">' + esc(c.email) +
              '</b> for a sign-in link. Use it within the hour — each link works once.');
          return;
        }
        return r.json().catch(function(){ return {}; }).then(function(j){
          say(esc(readError(j, "Couldn't send the link.")), true); free();
        });
      })
      .catch(function(){ say("Network error. Try again.", true); free(); });
    }
  }

  /* After a recovery link: set a new password on the temporary session. */
  function newPasswordModal(){
    openModal(
      '<h3>Choose a new password</h3>' +
      '<div class="tag">you are signed in from the reset link</div>' +
      '<label class="f">New password</label>' +
      '<input type="password" id="authPw" autocomplete="new-password">' +
      '<label class="f">Confirm</label>' +
      '<input type="password" id="authPw2" autocomplete="new-password">' +
      '<div class="state" id="authMsg" style="padding:10px 0 0"></div>' +
      '<div style="display:flex;gap:8px;margin-top:18px">' +
        '<button class="btn acid lg" id="authGo" style="flex:1;justify-content:center">Save password</button>' +
      '</div>'
    );
    $("authPw").focus();
    $("authGo").addEventListener("click", function(){
      var pw = $("authPw").value, pw2 = $("authPw2").value;
      if (pw.length < MIN_PW) return say("Password must be at least " + MIN_PW + " characters.", true);
      if (pw !== pw2) return say("The two passwords don't match.", true);
      $("authGo").disabled = true;
      say("Saving…");
      updatePassword(pw).then(function(){
        say("Password saved.");
        setTimeout(closeModal, 600);
      }).catch(function(e){
        say(esc(e.message), true);
        $("authGo").disabled = false;
      });
    });
  }

  function updatePassword(pw){
    return api("/auth/v1/user", { method: "PUT", body: { password: pw } })
      .then(function(r){
        if (!r.ok){
          return r.json().catch(function(){ return {}; }).then(function(j){
            throw new Error(readError(j, "Couldn't save the password."));
          });
        }
        return true;
      });
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

      '<label class="f">Display name</label>' +
      '<input type="text" id="prefName" maxlength="24" value="' +
        esc((profile && profile.display_name) || "") + '">' +

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
      '<div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--line);' +
           'display:flex;gap:10px;flex-wrap:wrap">' +
        '<button class="btn ghost" id="changePw">Change password</button>' +
        '<button class="btn ghost hot" id="signOut">Sign out</button>' +
      '</div>'
    );

    $("changePw").addEventListener("click", function(){
      openModal(
        '<h3>Change password</h3>' +
        '<div class="tag">' + esc((session && session.user && session.user.email) || "") + '</div>' +
        '<label class="f">New password</label>' +
        '<input type="password" id="authPw" autocomplete="new-password">' +
        '<label class="f">Confirm</label>' +
        '<input type="password" id="authPw2" autocomplete="new-password">' +
        '<div class="state" id="authMsg" style="padding:10px 0 0"></div>' +
        '<div style="display:flex;gap:8px;margin-top:18px">' +
          '<button class="btn acid lg" id="authGo" style="flex:1;justify-content:center">Save</button>' +
          '<button class="btn lg" id="pwBack">Back</button>' +
        '</div>'
      );
      $("authPw").focus();
      $("pwBack").addEventListener("click", accountModal);
      $("authGo").addEventListener("click", function(){
        var a = $("authPw").value, b = $("authPw2").value;
        if (a.length < MIN_PW) return say("Password must be at least " + MIN_PW + " characters.", true);
        if (a !== b) return say("The two passwords don't match.", true);
        $("authGo").disabled = true;
        say("Saving…");
        updatePassword(a).then(function(){
          say("Password changed.");
          setTimeout(accountModal, 700);
        }).catch(function(e){
          say(esc(e.message), true);
          $("authGo").disabled = false;
        });
      });
    });

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

    function fail(text){
      $("prefMsg").className = "state err";
      $("prefMsg").textContent = text;
    }

    $("prefSave").addEventListener("click", function(){
      if (!draft.topics.length) return fail("Pick at least one news topic.");
      var newName = ($("prefName").value || "").trim();
      if (!newName) return fail("Give yourself a name.");

      $("prefSave").disabled = true;
      $("prefMsg").className = "state";
      $("prefMsg").textContent = "Saving…";
      setPrefs(draft);

      Promise.all([savePrefsRemote(draft), saveName(newName)]).then(function(){
        $("prefMsg").textContent = "Saved.";
        renderChip();
        publish();
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
      bg.addEventListener("click", function(e){
        if (e.target === bg) return closeModal();
        var mode = e.target.closest("[data-mode]");
        if (mode) signInModal(mode.getAttribute("data-mode"));
      });
    }
    document.addEventListener("keydown", function(e){
      if (e.key === "Escape") closeModal();
    });

    if (!enabled){ renderChip(); publish(); announce(); return; }

    var from = consumeHashSession();

    if (from === "error"){
      renderChip(); publish(); announce();
      signInModal("signin");     /* surfaces the expired-link message */
      return;
    }

    if (!from) session = loadSession();
    if (!session){ renderChip(); publish(); announce(); return; }

    refreshIfNeeded()
      .then(function(okToGo){
        if (!okToGo && !session) throw new Error("no session");
        return hydrate();
      })
      .then(function(){
        if (from === "recovery") newPasswordModal();
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
