/* =====================================================================
   panels.js — Launchpad and Notes.
   ---------------------------------------------------------------------
   Both are deliberately offline-first: they live in this browser's local
   storage, so they work with no account, no Worker and no network. If
   the Supabase tables ever exist, the read/write pair at the bottom of
   each section is the only thing that needs swapping.

   Also provides H.modal / H.closeModal, a generic dialog other page
   scripts can borrow.
   ===================================================================== */

(function () {
  "use strict";

  var $ = H.$, esc = H.esc;

  /* =====================================================================
     GENERIC MODAL
     ===================================================================== */
  function modal(markup){
    var bg = $("uiModalBg");
    if (!bg) return null;
    $("uiModal").innerHTML = markup;
    bg.classList.add("open");
    var first = bg.querySelector("input, textarea, button");
    if (first) setTimeout(function(){ first.focus(); }, 30);
    return bg;
  }
  function closeModal(){
    var bg = $("uiModalBg");
    if (bg) bg.classList.remove("open");
  }
  H.modal = modal;
  H.closeModal = closeModal;

  function wireModal(){
    var bg = $("uiModalBg");
    if (!bg) return;
    bg.addEventListener("click", function(e){
      if (e.target === bg || e.target.closest("[data-close]")) closeModal();
    });
    document.addEventListener("keydown", function(e){
      if (e.key === "Escape") closeModal();
    });
  }

  /* =====================================================================
     LAUNCHPAD
     ===================================================================== */
  var LP_KEY = "home.launchpad.v1";
  var LP_DEFAULT = [
    { ico:"✉", nm:"Mail",     url:"https://mail.google.com" },
    { ico:"▶", nm:"YouTube",  url:"https://youtube.com" },
    { ico:"♫", nm:"Spotify",  url:"https://open.spotify.com" },
    { ico:"◧", nm:"GitHub",   url:"https://github.com" },
    { ico:"☁", nm:"Cloudflare", url:"https://dash.cloudflare.com" },
    { ico:"◉", nm:"Supabase", url:"https://supabase.com/dashboard" }
  ];

  function lpAll(){ return H.lsGet(LP_KEY, null) || LP_DEFAULT.slice(); }
  function lpSave(list){ H.lsSet(LP_KEY, list); }

  function lpRender(){
    var box = $("launchpad");
    if (!box) return;
    var list = lpAll();

    box.innerHTML = '<div class="lp-grid">' +
      list.map(function(l, i){
        return '<a class="lp" href="' + esc(l.url) + '" target="_blank" rel="noopener">' +
          '<button class="x" data-rm="' + i + '" title="Remove" aria-label="Remove ' + esc(l.nm) + '">✕</button>' +
          '<span class="ico">' + esc(l.ico || "◇") + '</span>' +
          '<span class="nm">' + esc(l.nm) + '</span>' +
        '</a>';
      }).join("") +
      '<button class="lp add" id="lpAdd" title="Add a shortcut">' +
        '<span class="ico">＋</span><span class="nm">add</span>' +
      '</button>' +
    '</div>';

    if ($("lpMeta")) $("lpMeta").textContent = list.length + " shortcut" + (list.length === 1 ? "" : "s");
  }

  function lpAddModal(){
    modal(
      '<h3>New shortcut</h3>' +
      '<div class="tag">saved in this browser</div>' +
      '<label class="f">Label</label><input type="text" id="lpNm" maxlength="18" placeholder="Figma">' +
      '<label class="f">Address</label><input type="text" id="lpUrl" placeholder="figma.com">' +
      '<label class="f">Glyph (one character)</label><input type="text" id="lpIco" maxlength="2" placeholder="◇">' +
      '<div class="state" id="lpMsg" style="padding:10px 0 0"></div>' +
      '<div style="display:flex;gap:8px;margin-top:18px">' +
        '<button class="btn acid lg" id="lpSave" style="flex:1"><span>Add</span></button>' +
        '<button class="btn lg" data-close><span>Cancel</span></button>' +
      '</div>'
    );

    $("lpSave").addEventListener("click", function(){
      var nm = ($("lpNm").value || "").trim();
      var url = ($("lpUrl").value || "").trim();
      var ico = ($("lpIco").value || "").trim() || "◇";
      if (!nm || !url){
        $("lpMsg").className = "state err";
        $("lpMsg").textContent = "A label and an address, please.";
        return;
      }
      if (!/^https?:\/\//i.test(url)) url = "https://" + url;
      var list = lpAll();
      list.push({ ico:ico, nm:nm, url:url });
      lpSave(list);
      lpRender();
      closeModal();
      H.toast("Shortcut added");
    });
  }

  function lpMount(){
    lpRender();
    var box = $("launchpad");
    if (!box) return;
    box.addEventListener("click", function(e){
      var rm = e.target.closest("[data-rm]");
      if (rm){
        e.preventDefault();
        var list = lpAll();
        var gone = list.splice(+rm.getAttribute("data-rm"), 1)[0];
        lpSave(list);
        lpRender();
        H.toast("Removed " + (gone ? gone.nm : "shortcut"));
        return;
      }
      if (e.target.closest("#lpAdd")){ e.preventDefault(); lpAddModal(); }
    });

    var reset = $("lpReset");
    if (reset) reset.addEventListener("click", function(){
      lpSave(LP_DEFAULT.slice());
      lpRender();
      H.toast("Shortcuts reset");
    });
  }

  /* =====================================================================
     NOTES
     ===================================================================== */
  var N_KEY = "home.notes.v1";

  function nAll(){ return H.lsGet(N_KEY, []) || []; }
  function nSave(list){ H.lsSet(N_KEY, list); }

  function nRender(){
    var box = $("notesList");
    if (!box) return;
    var list = nAll();

    if (!list.length){
      box.innerHTML = '<div class="state">Nothing on the board. Type above and hit add — ' +
        'click a note to strike it through, ✕ to bin it.</div>';
    } else {
      box.innerHTML = list.map(function(n, i){
        return '<div class="note' + (n.done ? " done" : "") + '" data-i="' + i + '">' +
          '<button class="x" data-rm="' + i + '" title="Delete" aria-label="Delete note">✕</button>' +
          '<div class="tx" data-toggle="' + i + '">' + esc(n.text) + '</div>' +
          '<div class="mt">' + H.ago(n.at) + (n.done ? " · done" : "") + '</div>' +
        '</div>';
      }).join("");
    }

    var open = list.filter(function(n){ return !n.done; }).length;
    if ($("notesMeta")) $("notesMeta").textContent = list.length
      ? open + " open · " + list.length + " total"
      : "empty";
  }

  function nAdd(){
    var ta = $("noteText");
    var text = (ta.value || "").trim();
    if (!text) return;
    var list = nAll();
    list.unshift({ text:text, at:Date.now(), done:false });
    nSave(list);
    ta.value = "";
    nRender();
    if (window.FX) FX.play("up");
  }

  function nMount(){
    nRender();

    var add = $("noteAdd");
    if (add) add.addEventListener("click", nAdd);

    var ta = $("noteText");
    if (ta) ta.addEventListener("keydown", function(e){
      /* Enter adds, Shift-Enter makes a new line */
      if (e.key === "Enter" && !e.shiftKey){ e.preventDefault(); nAdd(); }
    });

    var box = $("notesList");
    if (box) box.addEventListener("click", function(e){
      var rm = e.target.closest("[data-rm]");
      if (rm){
        var list = nAll();
        list.splice(+rm.getAttribute("data-rm"), 1);
        nSave(list); nRender();
        return;
      }
      var tg = e.target.closest("[data-toggle]");
      if (tg){
        var l2 = nAll(), i = +tg.getAttribute("data-toggle");
        l2[i].done = !l2[i].done;
        nSave(l2); nRender();
        if (window.FX) FX.play(l2[i].done ? "coin" : "press");
      }
    });

    var clear = $("notesClear");
    if (clear) clear.addEventListener("click", function(){
      var list = nAll().filter(function(n){ return !n.done; });
      nSave(list); nRender();
      H.toast("Cleared finished notes");
    });
  }

  /* =====================================================================
     MOUNT
     ===================================================================== */
  H.panels = {
    mount: function(){ wireModal(); lpMount(); nMount(); },
    focusNote: function(){
      var ta = $("noteText");
      if (!ta) return;
      ta.scrollIntoView({ behavior:"smooth", block:"center" });
      setTimeout(function(){ ta.focus(); }, 400);
    }
  };
})();
