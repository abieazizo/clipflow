/* core.js — shared behavior: entrances, receipt printing + stamp slam, sheets,
   toasts, timestamps, tab-bar dot, password eyes, caption editor, CF.jfetch.
   Motion law: transform + opacity only; reduced-motion collapses everything. */
(function () {
  "use strict";

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var CSRF = (function () {
    var m = $('meta[name="cf-csrf"]');
    return m ? m.getAttribute("content") : "";
  })();
  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // --- toasts ---------------------------------------------------------------
  function toast(msg, opts) {
    var zone = $(".toast-zone");
    if (!zone) return;
    var el = document.createElement("div");
    el.className = "toast" + (opts && opts.err ? " toast-err" : "");
    el.textContent = msg;
    zone.appendChild(el);
    setTimeout(function () { el.remove(); }, (opts && opts.ms) || 3000);
  }

  // --- fetch helper: POST urlencoded with csrf, JSON back --------------------
  function jfetch(url, data) {
    var body = new URLSearchParams();
    body.set("csrf", CSRF);
    Object.keys(data || {}).forEach(function (k) {
      if (data[k] !== undefined && data[k] !== null) body.set(k, String(data[k]));
    });
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      credentials: "same-origin",
    }).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: "Something broke on our end. Try again." }; });
    });
  }

  // --- entrances: data-rise choreography --------------------------------------
  // Above-fold elements rise on load in --i order; below-fold reveal once on
  // intersection. Reduced-motion: CSS forces final state, we just add the class.
  var risers = $$("[data-rise]");
  if (risers.length) {
    var aboveFold = [], belowFold = [];
    risers.forEach(function (el) {
      (el.getBoundingClientRect().top < window.innerHeight ? aboveFold : belowFold).push(el);
    });
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        aboveFold.forEach(function (el) { el.classList.add("is-in"); });
      });
    });
    if ("IntersectionObserver" in window && belowFold.length) {
      var rio = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting) return;
          rio.unobserve(en.target);
          en.target.classList.add("is-in");
        });
      }, { threshold: 0.2 });
      belowFold.forEach(function (el) { rio.observe(el); });
    } else {
      belowFold.forEach(function (el) { el.classList.add("is-in"); });
    }
  }

  // --- bottom sheets ----------------------------------------------------------
  var openSheetEl = null;
  var scrim = $("[data-sheet-scrim]");
  if (scrim) scrim.hidden = false;
  $$(".sheet").forEach(function (s) { s.hidden = false; });

  function openSheet(id) {
    var el = $("#sheet-" + id);
    if (!el) return;
    closeSheet();
    openSheetEl = el;
    el.classList.add("is-open");
    if (scrim) scrim.classList.add("is-open");
    document.body.classList.add("sheet-locked");
    var focusable = el.querySelector("input, textarea, button:not([data-sheet-close])");
    if (focusable && focusable.tagName !== "INPUT" && focusable.tagName !== "TEXTAREA") focusable.focus({ preventScroll: true });
  }
  function closeSheet() {
    if (!openSheetEl) return;
    openSheetEl.classList.remove("is-open");
    if (scrim) scrim.classList.remove("is-open");
    document.body.classList.remove("sheet-locked");
    openSheetEl = null;
  }
  document.addEventListener("click", function (e) {
    var opener = e.target.closest("[data-sheet-open]");
    var innerAction = e.target.closest("form, a");
    if (opener && (!innerAction || !opener.contains(innerAction))) {
      e.preventDefault(); openSheet(opener.getAttribute("data-sheet-open")); return;
    }
    if (e.target.closest("[data-sheet-close]")) { e.preventDefault(); closeSheet(); return; }
    if (scrim && e.target === scrim) closeSheet();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { closeSheet(); return; }
    if ((e.key === "Enter" || e.key === " ") && e.target.matches && e.target.matches('[data-sheet-open][role="button"]')) {
      e.preventDefault(); openSheet(e.target.getAttribute("data-sheet-open"));
    }
  });
  var touchY = null, touchDY = 0;
  document.addEventListener("touchstart", function (e) {
    if (!openSheetEl || !openSheetEl.contains(e.target)) return;
    if (openSheetEl.scrollTop > 0) return;
    touchY = e.touches[0].clientY; touchDY = 0;
  }, { passive: true });
  document.addEventListener("touchmove", function (e) {
    if (touchY === null || !openSheetEl) return;
    touchDY = e.touches[0].clientY - touchY;
    if (touchDY > 0) openSheetEl.style.transform = "translateY(" + touchDY + "px)";
  }, { passive: true });
  document.addEventListener("touchend", function () {
    if (touchY === null || !openSheetEl) { touchY = null; return; }
    openSheetEl.style.transform = "";
    if (touchDY > 90) closeSheet();
    touchY = null; touchDY = 0;
  });

  // --- localize timestamps ----------------------------------------------------
  var now = new Date();
  $$("[data-iso]").forEach(function (el) {
    var d = new Date(el.getAttribute("data-iso"));
    if (isNaN(d.getTime())) return;
    var sameDay = d.toDateString() === now.toDateString();
    el.textContent = sameDay
      ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
      : d.toLocaleDateString([], { month: "short", day: "numeric" });
  });

  // --- ledger entrance: the card rises while rows stagger in. At celebration
  // moments the posted glyphs spring in and their checks draw themselves.
  function startPrint(el) {
    el.classList.add("is-printing");
    if (!el.classList.contains("will-celebrate")) return;
    var n = el.querySelectorAll(".receipt-line, .receipt-head, .receipt-total, .receipt-code").length;
    var settle = reduced ? 0 : 200 + n * 60 + 300;
    setTimeout(function () {
      el.classList.add("is-celebrating");
      if (!reduced && navigator.vibrate) setTimeout(function () { navigator.vibrate(10); }, 380);
    }, settle);
  }
  var printable = $$(".will-print");
  if (printable.length) {
    if ("IntersectionObserver" in window && !reduced) {
      var pio = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting) return;
          pio.unobserve(en.target);
          var delay = Number(en.target.getAttribute("data-print-delay") || 0);
          setTimeout(function () { startPrint(en.target); }, delay);
        });
      }, { threshold: 0.35 });
      printable.forEach(function (r) { pio.observe(r); });
    } else {
      printable.forEach(function (r) { startPrint(r); });
    }
  }
  window.cfPrint = startPrint; // for receipts injected after load

  // --- tab bar: berry dot slides, icon pops ------------------------------------
  var tabbar = $(".tabbar");
  if (tabbar) {
    var dot = document.createElement("span");
    dot.className = "tab-dot";
    tabbar.appendChild(dot);
    var placeDot = function (link, animate) {
      var r = link.getBoundingClientRect(), b = tabbar.getBoundingClientRect();
      if (!animate) dot.style.transition = "none";
      dot.style.transform = "translate(" + (r.left - b.left + r.width / 2 - 2) + "px, 4px)";
      if (!animate) requestAnimationFrame(function () { dot.style.transition = ""; });
    };
    var active = tabbar.querySelector('a[aria-current="page"]');
    if (active) placeDot(active, false); else dot.style.opacity = "0";
    window.addEventListener("resize", function () { if (active) placeDot(active, false); });
    tabbar.addEventListener("click", function (e) {
      var link = e.target.closest("a");
      if (!link || link === active) return;
      dot.style.opacity = "";
      placeDot(link, true);
      link.classList.add("tab-pop");
    });
  }

  // --- password eyes -----------------------------------------------------------
  $$("[data-eye]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var input = btn.parentElement.querySelector("input");
      if (!input) return;
      var show = input.type === "password";
      input.type = show ? "text" : "password";
      btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
    });
  });

  // --- loading buttons on real form submits -------------------------------------
  document.addEventListener("submit", function (e) {
    var form = e.target;
    if (form.hasAttribute("data-js-form")) return;
    var btn = form.querySelector("[data-loading-text]");
    if (btn) {
      setTimeout(function () {
        btn.classList.add("is-loading");
        btn.textContent = btn.getAttribute("data-loading-text").replace(/&hellip;/g, "…");
      }, 0);
    }
  });

  // --- clip thumbnails: never show a black box ------------------------------------
  // 404s hide the img (the wash + glyph slot shows through). Whatnot sometimes
  // serves genuinely BLACK thumbnail webps — catch those by average luminance.
  function isBlackFrame(img) {
    try {
      var c = document.createElement("canvas");
      c.width = 12; c.height = 12;
      var ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0, 12, 12);
      var d = ctx.getImageData(0, 0, 12, 12).data;
      var sum = 0;
      for (var i = 0; i < d.length; i += 4) sum += (d[i] + d[i + 1] + d[i + 2]) / 3;
      return sum / (d.length / 4) < 10;
    } catch (e) { return false; }
  }
  function watchThumb(img) {
    img.addEventListener("error", function () { img.classList.add("is-broken"); });
    img.addEventListener("load", function () {
      if (isBlackFrame(img)) img.classList.add("is-broken");
    });
    if (img.complete && img.naturalWidth > 0 && isBlackFrame(img)) img.classList.add("is-broken");
  }
  $$("[data-thumb-fallback]").forEach(watchThumb);
  window.cfWatchThumb = watchThumb; // for thumbs built client-side (wizard, landing)

  // --- trial banner (per-session dismiss) ----------------------------------------
  var trial = $("[data-trial-banner]");
  if (trial) {
    var KEY = "cf_trial_dismissed";
    try { if (!sessionStorage.getItem(KEY)) trial.hidden = false; } catch (e) { trial.hidden = false; }
    var dis = $("[data-trial-dismiss]", trial);
    if (dis) dis.addEventListener("click", function () {
      trial.hidden = true;
      try { sessionStorage.setItem(KEY, "1"); } catch (e) { /* private mode */ }
    });
  }

  // --- offline honesty -------------------------------------------------------------
  window.addEventListener("offline", function () { toast("No connection. Retrying…", { err: true }); });
  window.addEventListener("online", function () { toast("Back online."); });

  // --- caption editor (wizard step 5 + settings sheet) ------------------------------
  function initCaptionEditor(root) {
    var islandEl = $("#caption-data");
    if (!islandEl) return;
    var data = JSON.parse(islandEl.textContent);
    var preset = data.preset;
    var preview = $("[data-caption-preview]", root);
    var customWrap = $("[data-custom-wrap]", root);
    var customTa = $("[data-custom-template]", root);

    function tpl() {
      if (preset !== "custom") return data.presets[preset];
      return (customTa && customTa.value.trim()) || "{title}\n\n{hashtags}";
    }
    function render() {
      var tags = (data.hashtags || []).map(function (h) { return h.charAt(0) === "#" ? h : "#" + h; }).join(" ");
      var out = tpl()
        .split("{title}").join(data.sample)
        .split("{hashtags}").join(tags)
        .split("{username}").join(data.username);
      if (preview) preview.textContent = out.trim();
      if (customWrap) customWrap.hidden = preset !== "custom";
    }
    $$(".preset-btn", root).forEach(function (b) {
      b.addEventListener("click", function () {
        preset = b.getAttribute("data-preset");
        $$(".preset-btn", root).forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
        render();
      });
    });
    if (customTa) customTa.addEventListener("input", render);
    render();

    var save = $("[data-caption-save]");
    if (save) save.addEventListener("click", function () {
      save.classList.add("is-loading");
      save.textContent = save.getAttribute("data-loading-text").replace(/&hellip;/g, "…");
      var payload = { onlyCaption: "1", captionPreset: preset };
      if (preset === "custom" && customTa) payload.captionTemplate = customTa.value;
      jfetch("/settings", payload).then(function (r) {
        if (!r.ok) { toast(r.error || "Couldn't save. Try again.", { err: true }); save.classList.remove("is-loading"); save.textContent = "Try again"; return; }
        var next = save.getAttribute("data-next");
        if (next) { location.href = next; return; }
        var rowVal = $('[data-sheet-open="caption"] .grow-value');
        if (rowVal) rowVal.textContent = preset === "custom" ? "Your own words" : preset.charAt(0).toUpperCase() + preset.slice(1);
        toast("Caption saved.");
        closeSheet();
        save.classList.remove("is-loading");
        save.textContent = "Save caption";
      });
    });
  }
  var capRoot = $("[data-caption-editor]");
  if (capRoot) initCaptionEditor(capRoot);

  // --- exports ------------------------------------------------------------------
  window.CF = { toast: toast, jfetch: jfetch, openSheet: openSheet, closeSheet: closeSheet, csrf: CSRF, $: $, $$: $$, reduced: reduced };
})();
