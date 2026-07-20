/*
 * app.js — progressive enhancement. Every feature here layers on top of
 * working server-rendered forms; nothing below is required to use the app.
 *
 * Toasts · confirm modal (focus trap) · switch/password/chip inputs ·
 * caption live preview · connect-button loading · copy · dropdown ·
 * mobile nav · wizard username validation · manual check (staged status +
 * next-step results) · posting mode · guided-setup checklist (progress fill,
 * jump-and-focus, how-to-clip sheet, all-done collapse) · sample-post demo ·
 * one-time first-post celebration (confetti, motion-guarded) · help popovers ·
 * "Need help?" launcher panel (focus trap) ·
 * thumbnail studio (async generate + skeleton + char count) ·
 * URL-query flash -> toast + history.replaceState cleanup.
 */
(function () {
  "use strict";

  var ICONS = {
    success: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.75"/><path d="m8.4 12.3 2.5 2.5 4.7-5.4"/></svg>',
    error: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.8 2.8 19.5a.8.8 0 0 0 .7 1.2h17a.8.8 0 0 0 .7-1.2z"/><path d="M12 9.5v4.5"/><circle cx="12" cy="17.2" r="0.4" fill="currentColor" stroke="none"/></svg>',
    info: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.75"/><path d="M12 11v5"/><circle cx="12" cy="7.8" r="0.4" fill="currentColor" stroke="none"/></svg>',
    x: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>'
  };

  function reducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  // Hero video: on phones (and Data Saver) we keep the light real-frame poster
  // and never fetch the ~20MB clip. On desktop we stream + loop it. This keeps
  // the landing page fast on cellular — the poster alone already looks great.
  (function heroVideo() {
    var v = document.querySelector("[data-hero-video]");
    if (!v) return;
    var conn = navigator.connection || {};
    var wideEnough = window.matchMedia("(min-width: 760px)").matches;
    if (!wideEnough || conn.saveData || reducedMotion()) return; // poster stays
    v.preload = "auto";
    var go = function () { v.play().catch(function () {}); };
    if (v.readyState >= 2) go(); else v.addEventListener("canplay", go, { once: true });
    v.load();
  })();

  // ------------------------------------------------------------------ toasts
  //
  // Disciplined toast system: auto-dismiss (4s, errors 6s) with a progress
  // bar, hover pauses the timer, duplicate messages REPLACE the visible one
  // (restarting its timer) instead of stacking, and at most 3 are visible —
  // a 4th pushes the oldest out. Exit = fade+slide (instant on reduced motion).

  var TOASTS = []; // [{el, message, timer, startedAt, remaining, bar}]

  function toastDuration(kind, ms) {
    if (typeof ms === "number" && ms > 0) return ms;
    return kind === "error" ? 6000 : 4000;
  }

  function startToastTimer(t) {
    t.startedAt = Date.now();
    t.timer = window.setTimeout(function () { dismissToast(t); }, t.remaining);
    if (t.bar) {
      t.bar.style.transition = "none";
      // reflow, then animate the bar down over the remaining time
      void t.bar.offsetWidth;
      t.bar.style.transition = "width " + t.remaining + "ms linear";
      t.bar.style.width = "0%";
    }
  }

  function pauseToastTimer(t) {
    if (!t.timer) return;
    window.clearTimeout(t.timer);
    t.timer = null;
    t.remaining = Math.max(400, t.remaining - (Date.now() - t.startedAt));
    if (t.bar) {
      var w = window.getComputedStyle(t.bar).width;
      t.bar.style.transition = "none";
      t.bar.style.width = w;
    }
  }

  function dismissToast(t) {
    var i = TOASTS.indexOf(t);
    if (i >= 0) TOASTS.splice(i, 1);
    if (t.timer) { window.clearTimeout(t.timer); t.timer = null; }
    var el = t.el;
    if (!el.parentNode) return;
    if (reducedMotion()) { el.remove(); return; }
    el.classList.add("is-leaving");
    el.addEventListener("animationend", function () { el.remove(); }, { once: true });
    window.setTimeout(function () { if (el.parentNode) el.remove(); }, 400); // safety net
  }

  function toast(message, kind, ms) {
    kind = kind || "info";
    var stack = document.getElementById("toast-stack");
    if (!stack) return;

    // Dedupe: same message already visible → restart its timer, never stack.
    for (var i = 0; i < TOASTS.length; i++) {
      if (TOASTS[i].message === message && TOASTS[i].el.parentNode) {
        var ex = TOASTS[i];
        pauseToastTimer(ex);
        ex.remaining = toastDuration(kind, ms);
        if (ex.bar) { ex.bar.style.transition = "none"; ex.bar.style.width = "100%"; }
        startToastTimer(ex);
        return;
      }
    }

    // Cap: max 3 visible — push the oldest out.
    while (TOASTS.length >= 3) dismissToast(TOASTS[0]);

    var el = document.createElement("div");
    el.className = "toast toast-" + kind;
    el.innerHTML = ICONS[kind] + "<span></span>" +
      '<button type="button" class="toast-close" aria-label="Dismiss">' + ICONS.x + "</button>" +
      '<span class="toast-bar" aria-hidden="true"></span>';
    el.querySelector("span").textContent = message;
    stack.appendChild(el);

    var t = { el: el, message: message, timer: null, startedAt: 0, remaining: toastDuration(kind, ms), bar: el.querySelector(".toast-bar") };
    TOASTS.push(t);
    el.querySelector(".toast-close").addEventListener("click", function () { dismissToast(t); });
    el.addEventListener("mouseenter", function () { pauseToastTimer(t); });
    el.addEventListener("mouseleave", function () { if (!t.timer && el.parentNode && !el.classList.contains("is-leaving")) startToastTimer(t); });
    startToastTimer(t);
  }
  window.cfToast = toast; // exposed for integrations/tests — markup never calls it

  // ----------------------------------------------------------- confirm modal

  var modalRoot = document.getElementById("modal-root");

  function confirmModal(opts, onConfirm) {
    if (!modalRoot) { onConfirm(); return; }
    var previous = document.activeElement;
    var backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="cf-modal-title">' +
      '<h2 class="modal-title" id="cf-modal-title"></h2>' +
      '<p class="modal-body"></p>' +
      '<div class="modal-actions">' +
      '<button type="button" class="btn btn-ghost" data-modal-cancel>Cancel</button>' +
      '<button type="button" class="btn btn-danger" data-modal-confirm></button>' +
      "</div></div>";
    backdrop.querySelector(".modal-title").textContent = opts.title || "Are you sure?";
    backdrop.querySelector(".modal-body").textContent = opts.body || "";
    backdrop.querySelector("[data-modal-confirm]").textContent = opts.action || "Confirm";

    function close() {
      document.removeEventListener("keydown", onKey, true);
      backdrop.remove();
      if (previous && previous.focus) previous.focus();
    }
    function onKey(e) {
      if (e.key === "Escape") { e.preventDefault(); close(); return; }
      if (e.key !== "Tab") return;
      var focusables = backdrop.querySelectorAll("button");
      var first = focusables[0], last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    backdrop.addEventListener("click", function (e) { if (e.target === backdrop) close(); });
    backdrop.querySelector("[data-modal-cancel]").addEventListener("click", close);
    backdrop.querySelector("[data-modal-confirm]").addEventListener("click", function () {
      close();
      onConfirm();
    });
    document.addEventListener("keydown", onKey, true);
    modalRoot.appendChild(backdrop);
    backdrop.querySelector("[data-modal-cancel]").focus();
  }

  // ---------------------------------------------------------------- entrance
  // Staggered fade-up: assign each stagger container's direct children an --i
  // index so the CSS animation cascades. No-op under reduced motion.
  if (!reducedMotion()) {
    document.querySelectorAll("[data-stagger]").forEach(function (group) {
      var i = 0;
      Array.prototype.forEach.call(group.children, function (child) {
        child.style.setProperty("--i", i++);
      });
    });
  }

  // Count-up: numbers tick from 0 to their value on first paint (tabular figures
  // hold the box so nothing shifts). Skipped under reduced motion.
  if (!reducedMotion()) {
    document.querySelectorAll(".stat-num").forEach(function (el) {
      // Only the leading integer node animates; preserve trailing markup (e.g. "/2").
      var raw = (el.firstChild && el.firstChild.nodeType === 3) ? el.firstChild.textContent : el.textContent;
      var target = parseInt(String(raw).replace(/[^0-9]/g, ""), 10);
      if (!isFinite(target) || target <= 0 || target > 100000) return;
      var node = (el.firstChild && el.firstChild.nodeType === 3) ? el.firstChild : el;
      var start = null, dur = 650;
      function frame(ts) {
        if (start === null) start = ts;
        var p = Math.min(1, (ts - start) / dur);
        var eased = 1 - Math.pow(1 - p, 3);
        node.textContent = String(Math.round(target * eased));
        if (p < 1) requestAnimationFrame(frame);
        else node.textContent = String(target);
      }
      node.textContent = "0";
      requestAnimationFrame(frame);
    });
  }

  // links that want a confirm step (e.g. Disconnect)
  document.querySelectorAll("a[data-confirm-title]").forEach(function (link) {
    link.addEventListener("click", function (e) {
      e.preventDefault();
      confirmModal(
        {
          title: link.getAttribute("data-confirm-title"),
          body: link.getAttribute("data-confirm-body"),
          action: link.getAttribute("data-confirm-action")
        },
        function () { window.location.href = link.href; }
      );
    });
  });

  // submit buttons that want a confirm step (e.g. thumbnail Delete, account
  // deletion). If the form carries a type-your-email gate, enforce it first.
  document.querySelectorAll("button[type=submit][data-confirm-title]").forEach(function (btn) {
    var form = btn.closest("form");
    if (!form) return;
    var confirmed = false;
    form.addEventListener("submit", function (e) {
      if (confirmed) return;
      e.preventDefault();
      var gate = form.querySelector("[data-expected-email]");
      if (gate && gate.value.trim().toLowerCase() !== gate.getAttribute("data-expected-email").toLowerCase()) {
        toast("Type your email exactly to confirm — this one's permanent.", "error");
        gate.focus();
        return;
      }
      confirmModal(
        {
          title: btn.getAttribute("data-confirm-title"),
          body: btn.getAttribute("data-confirm-body"),
          action: btn.getAttribute("data-confirm-action")
        },
        function () { confirmed = true; form.submit(); }
      );
    });
  });

  // -------------------------------------------------------- button loading

  document.querySelectorAll("a[data-loading-text]").forEach(function (a) {
    a.addEventListener("click", function () {
      a.classList.add("is-loading");
      a.setAttribute("aria-disabled", "true");
      window.addEventListener("pageshow", function () {
        a.classList.remove("is-loading");
        a.removeAttribute("aria-disabled");
      }, { once: true });
    });
  });
  document.querySelectorAll("form").forEach(function (form) {
    form.addEventListener("submit", function () {
      var btn = form.querySelector('button[type="submit"][data-loading-text]') ||
        document.querySelector('button[type="submit"][form="' + form.id + '"][data-loading-text]');
      if (btn) { btn.classList.add("is-loading"); }
    });
  });

  // ------------------------------------------------------ password show/hide

  document.querySelectorAll("[data-toggle-password]").forEach(function (btn) {
    btn.hidden = false;
    btn.addEventListener("click", function () {
      var input = document.getElementById(btn.getAttribute("data-toggle-password"));
      if (!input) return;
      var show = input.type === "password";
      input.type = show ? "text" : "password";
      btn.setAttribute("aria-pressed", String(show));
      btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
    });
  });

  // Live password-strength meter (signup). Scores 0-4 from length + variety.
  document.querySelectorAll("[data-strength]").forEach(function (input) {
    var field = input.closest(".field");
    var meter = field ? field.querySelector("[data-strength-meter]") : null;
    if (!meter) return;
    var bars = meter.querySelectorAll(".pw-bars span");
    var label = meter.querySelector("[data-strength-label]");
    var NAMES = ["Too short", "Weak", "Fair", "Good", "Strong"];
    function score(v) {
      if (v.length < 8) return 0;
      var s = 0;
      if (/[a-z]/.test(v)) s++;
      if (/[A-Z]/.test(v)) s++;
      if (/[0-9]/.test(v)) s++;
      if (/[^A-Za-z0-9]/.test(v)) s++;
      if (v.length >= 12 && s < 4) s++;          // reward length
      if (v.length >= 8 && s === 0) s = 1;
      return Math.max(1, Math.min(4, s));
    }
    function render() {
      var v = input.value;
      if (!v) { meter.hidden = true; return; }
      meter.hidden = false;
      var sc = score(v);
      for (var i = 0; i < bars.length; i++) {
        bars[i].className = i < sc ? "is-on lvl-" + sc : "";
      }
      if (label) label.textContent = NAMES[v.length < 8 ? 0 : sc];
    }
    input.addEventListener("input", render);
  });

  // Live "repeat password" match check — shows a hint and blocks submit on mismatch.
  document.querySelectorAll("[data-match]").forEach(function (input) {
    var target = document.getElementById(input.getAttribute("data-match"));
    var field = input.closest(".field");
    var hint = field ? field.querySelector("[data-match-hint]") : null;
    if (!target) return;
    function check() {
      var mismatch = input.value.length > 0 && input.value !== target.value;
      if (hint) hint.hidden = !mismatch;
      input.setAttribute("aria-invalid", String(mismatch));
      input.setCustomValidity(mismatch ? "Passwords don't match" : "");
    }
    input.addEventListener("input", check);
    target.addEventListener("input", check);
  });

  // ---------------------------------------------------------------- copying

  document.querySelectorAll("[data-copy]").forEach(function (btn) {
    if (!navigator.clipboard) return;
    btn.hidden = false;
    btn.addEventListener("click", function () {
      navigator.clipboard.writeText(btn.getAttribute("data-copy")).then(
        function () { toast("Copied to clipboard", "success", 2500); },
        function () { toast("Couldn't copy — sorry", "error"); }
      );
    });
  });

  // ---------------------------------------------------------------- dropdown

  document.querySelectorAll("details[data-dropdown]").forEach(function (dd) {
    var trigger = dd.querySelector(".dropdown-trigger");
    document.addEventListener("click", function (e) {
      if (dd.open && !dd.contains(e.target)) dd.open = false;
    });
    dd.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && dd.open) {
        dd.open = false;
        if (trigger) trigger.focus();
      }
    });
  });

  // -------------------------------------------------------------- mobile nav

  var navBtn = document.querySelector("[data-mobile-nav]");
  var mobileNav = document.getElementById("mobile-nav");
  if (navBtn && mobileNav) {
    navBtn.hidden = false;
    mobileNav.hidden = false; // visibility handled by .is-open + CSS
    navBtn.addEventListener("click", function () {
      var open = mobileNav.classList.toggle("is-open");
      navBtn.setAttribute("aria-expanded", String(open));
      navBtn.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    });
    mobileNav.addEventListener("click", function (e) {
      if (e.target.closest("a")) {
        mobileNav.classList.remove("is-open");
        navBtn.setAttribute("aria-expanded", "false");
      }
    });
  }

  // ----------------------------------------------- wizard: live username tidy

  document.querySelectorAll("[data-username-live]").forEach(function (input) {
    input.addEventListener("input", function () {
      var caret = input.selectionStart;
      var before = input.value;
      var after = before.toLowerCase().replace(/\s+/g, "").replace(/^@+/, "");
      if (before !== after) {
        input.value = after;
        var shift = before.length - after.length;
        if (caret != null) input.setSelectionRange(Math.max(0, caret - shift), Math.max(0, caret - shift));
      }
    });
  });

  // -------------------------------------- wizard: live Whatnot profile check

  var checkInput = document.querySelector("[data-username-check]");
  var checkBox = document.getElementById("uname-check");
  if (checkInput && checkBox && window.fetch) {
    var avatarEl = checkBox.querySelector("[data-uname-avatar]");
    var titleEl = checkBox.querySelector("[data-uname-title]");
    var subEl = checkBox.querySelector("[data-uname-sub]");
    var debounceTimer = null;
    var lastChecked = "";

    var render = function (state, data) {
      checkBox.hidden = false;
      checkBox.className = "uname-check is-" + state;
      avatarEl.style.backgroundImage = "";
      avatarEl.textContent = "";
      if (state === "checking") {
        titleEl.textContent = "Looking up @" + data + "…";
        subEl.textContent = "";
      } else if (state === "found") {
        if (data.avatar) {
          avatarEl.style.backgroundImage = "url(" + data.avatar + ")";
        } else {
          avatarEl.textContent = (data.uname[0] || "?").toUpperCase();
        }
        titleEl.textContent = data.displayName || "@" + data.uname;
        subEl.textContent = "Found on Whatnot — that's the one we'll watch.";
      } else if (state === "missing") {
        titleEl.textContent = "No @" + data + " on Whatnot";
        subEl.textContent = "Check the spelling — it's the handle in whatnot.com/user/…";
      } else { // unknown
        titleEl.textContent = data;
        subEl.textContent = "";
      }
    };

    var check = function () {
      var uname = checkInput.value.trim().replace(/^@+/, "");
      if (uname.length < 2 || !/^[a-z0-9._-]+$/.test(uname)) {
        checkBox.hidden = true;
        return;
      }
      if (uname === lastChecked) return;
      lastChecked = uname;
      render("checking", uname);
      fetch("/api/whatnot-check?u=" + encodeURIComponent(uname), { headers: { Accept: "application/json" } })
        .then(function (r) { return r.json(); })
        .then(function (json) {
          if (checkInput.value.trim().replace(/^@+/, "") !== uname) return; // stale
          if (!json.ok) { render("unknown", json.error || "Couldn't check right now — you can still continue."); return; }
          if (json.exists) render("found", { uname: uname, displayName: json.displayName, avatar: json.avatar });
          else render("missing", uname);
        })
        .catch(function () {
          if (checkInput.value.trim().replace(/^@+/, "") === uname) {
            render("unknown", "Couldn't check right now — you can still continue.");
          }
        });
    };

    checkInput.addEventListener("input", function () {
      lastChecked = "";
      if (debounceTimer) window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(check, 600);
    });
    if (checkInput.value.trim()) check(); // pre-filled (returning to step 2)
  }

  // ------------------------------------- dashboard: real Whatnot profile pic

  var wnAvatars = document.querySelectorAll("[data-wn-avatar]");
  if (wnAvatars.length && window.fetch) {
    var wnHandle = wnAvatars[0].getAttribute("data-wn-avatar");
    if (wnHandle) {
      fetch("/api/whatnot-check?u=" + encodeURIComponent(wnHandle), { headers: { Accept: "application/json" } })
        .then(function (r) { return r.json(); })
        .then(function (json) {
          if (!json || !json.ok || !json.exists || !json.avatar) return;
          wnAvatars.forEach(function (el) {
            el.style.backgroundImage = "url(" + json.avatar + ")";
            el.classList.add("has-img");
          });
          if (json.displayName) {
            document.querySelectorAll("[data-wn-name]").forEach(function (n) { n.textContent = json.displayName; });
          }
        })
        .catch(function () { /* keep the initial fallback */ });
    }
  }

  // Real Instagram/TikTok profile pictures (served as data URIs to satisfy CSP).
  var socialAvatars = document.querySelectorAll("[data-social-avatar]");
  if (socialAvatars.length && window.fetch) {
    fetch("/api/social-avatars", { headers: { Accept: "application/json" } })
      .then(function (r) { return r.json(); })
      .then(function (json) {
        if (!json || !json.ok) return;
        socialAvatars.forEach(function (el) {
          var p = el.getAttribute("data-social-avatar");
          if (json[p]) {
            el.style.backgroundImage = "url(" + json[p] + ")";
            el.classList.add("has-img");
          }
        });
      })
      .catch(function () { /* brand icon stays */ });
  }

  // ------------------------------------------ manual check + posting mode

  var modeControls = document.querySelector("[data-mode-controls]");
  var modeCsrf = modeControls ? (modeControls.getAttribute("data-csrf") || "") : "";

  function updateModePill(mode) {
    var pill = document.querySelector("[data-mode-pill]");
    if (!pill) return;
    pill.className = "pill " + (mode === "auto" ? "pill-live" : "pill-neutral");
    pill.innerHTML = mode === "auto" ? '<span class="pulse-dot"></span>Auto-posting' : "Manual mode";
  }
  // "Check for clips" — the new user's first real interaction. While it runs,
  // staged status lines make the work visible; the result names the exact next
  // step for every outcome (found / none yet / something missing).
  function setCheckResult(text, linkText, linkHref) {
    var el = document.querySelector("[data-check-result]");
    if (!el) return;
    el.textContent = text || "";
    if (text && linkText && linkHref) {
      el.appendChild(document.createTextNode(" "));
      var a = document.createElement("a");
      a.href = linkHref; a.textContent = linkText; a.className = "check-result-link";
      el.appendChild(a);
    }
    el.hidden = !text;
  }
  function scrollFocus(sel, focusSel) {
    var el = document.querySelector(sel);
    if (el) el.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "center" });
    if (focusSel) window.setTimeout(function () {
      var f = document.querySelector(focusSel);
      if (f && f.focus) f.focus({ preventScroll: true });
    }, 380);
  }

  document.querySelectorAll("[data-check]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      if (btn.classList.contains("is-loading")) return;
      var uname = btn.getAttribute("data-username") || "";
      var label = btn.querySelector(".check-label");
      var orig = label ? label.textContent : "";
      var stageTimers = [];
      btn.classList.add("is-loading"); btn.disabled = true;
      if (label) label.textContent = "Checking…";
      setCheckResult("Looking at @" + uname + "'s clips…");
      stageTimers.push(window.setTimeout(function () { setCheckResult("Checking for new published clips…"); }, 1600));
      stageTimers.push(window.setTimeout(function () { setCheckResult("Still going — Whatnot can take a few seconds…"); }, 4500));
      function done() {
        stageTimers.forEach(function (t) { window.clearTimeout(t); });
        btn.classList.remove("is-loading"); btn.disabled = false;
        if (label) label.textContent = orig;
      }
      fetch("/check", {
        method: "POST", headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ csrf: modeCsrf })
      }).then(function (r) { return r.json().catch(function () { return { error: "That didn't come back right — try again in a moment." }; }); })
        .then(function (json) {
          done();
          var code = json.code || (typeof json.found === "number" ? (json.found > 0 ? "found" : "none") : "error");
          if (code === "busy") { setCheckResult(""); toast(json.message || "Already checking — one sec.", "info"); return; }
          if (code === "found") {
            setCheckResult(json.message || "Found new clips — posting now.");
            if (json.firstFind) toast("🎉 First clip found — posting it now!", "success", 7000);
            else toast(json.message, "success", 6000);
            window.setTimeout(function () { window.location.reload(); }, json.firstFind ? 1800 : 1500);
            return;
          }
          if (code === "no_username") {
            setCheckResult(json.message);
            toast(json.message, "info", 6000);
            scrollFocus("#whatnot-card", "#whatnotUsername");
            return;
          }
          if (code === "no_connection") {
            setCheckResult(json.message);
            toast(json.message, "info", 6000);
            scrollFocus("#connections");
            return;
          }
          if (code === "locked") {
            setCheckResult(json.message, "Add a card", "/billing");
            toast(json.message, "info", 7000);
            return;
          }
          if (code === "paused") {
            setCheckResult(json.message);
            toast(json.message, "info", 6000);
            scrollFocus("#account");
            return;
          }
          if (code === "error") {
            setCheckResult("");
            toast(json.error || "That didn't come back right — try again in a moment.", "error", 6000);
            return;
          }
          // none — the honest, hopeful default
          setCheckResult(json.message || "No new clips yet — publish one on your next show and check again.",
            "How clipping works", "/guide#clipping");
          toast(json.message || "No new clips yet — publish one on your next show and check again.", "info", 6000);
        })
        .catch(function () {
          done();
          setCheckResult("");
          toast("Couldn't reach ClipFlow — check your connection and try again.", "error");
        });
    });
  });

  // Manual ↔ Auto segmented control — OPTIMISTIC: the segment, header pill and
  // check-button style flip instantly on click; the POST is debounced so rapid
  // clicks settle into one request. No toast on success (the UI IS the
  // feedback); failure reverts to the server-confirmed mode with ONE error toast.
  if (modeControls) {
    var confirmedMode = (function () {
      var a = modeControls.querySelector(".mode-seg-opt.is-active");
      return a ? a.getAttribute("data-mode") : "auto";
    })();
    var modeDebounce = null;

    function paintMode(mode) {
      modeControls.querySelectorAll(".mode-seg-opt").forEach(function (o) {
        var on = o.getAttribute("data-mode") === mode;
        o.classList.toggle("is-active", on);
        o.setAttribute("aria-checked", String(on));
      });
      updateModePill(mode);
      // Check button: primary in manual (it's THE action), secondary in auto.
      document.querySelectorAll("[data-check]").forEach(function (b) {
        b.classList.toggle("btn-primary", mode === "manual");
        b.classList.toggle("btn-secondary", mode !== "manual");
      });
    }

    function persistMode(mode) {
      fetch("/settings", {
        method: "POST", headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ csrf: modeCsrf, onlyMode: "1", postingMode: mode })
      }).then(function (r) { return r.json().catch(function () { return { ok: false }; }); })
        .then(function (json) {
          if (json.ok) { confirmedMode = json.postingMode; if (json.postingMode !== mode) paintMode(json.postingMode); return; }
          paintMode(confirmedMode); // revert
          toast(json.error || "Couldn't change mode — try again.", "error");
        })
        .catch(function () {
          paintMode(confirmedMode); // revert
          toast("Couldn't change mode — check your connection and try again.", "error");
        });
    }

    modeControls.querySelectorAll(".mode-seg-opt").forEach(function (opt) {
      opt.addEventListener("click", function () {
        var mode = opt.getAttribute("data-mode");
        if (opt.classList.contains("is-active")) return;
        paintMode(mode); // instant
        if (modeDebounce) window.clearTimeout(modeDebounce);
        modeDebounce = window.setTimeout(function () { modeDebounce = null; persistMode(mode); }, 350);
      });
    });
  }

  // ------------------------------------------------- shared sheet (modal) UI
  //
  // A generic focus-trapped dialog for server-rendered <template> content
  // (the sample-post demo and the how-to-clip steps). Escape, backdrop click,
  // and any [data-*-close] button all close it; focus returns where it was.

  function openSheet(node) {
    if (!modalRoot) return null;
    var previous = document.activeElement;
    var backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop sheet-backdrop";
    backdrop.appendChild(node);
    function close() {
      document.removeEventListener("keydown", onKey, true);
      backdrop.remove();
      if (previous && previous.focus) previous.focus();
    }
    function onKey(e) {
      if (e.key === "Escape") { e.preventDefault(); close(); return; }
      if (e.key !== "Tab") return;
      var focusables = backdrop.querySelectorAll("button, a[href], input, summary");
      if (!focusables.length) return;
      var first = focusables[0], last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    backdrop.addEventListener("click", function (e) { if (e.target === backdrop) close(); });
    document.addEventListener("keydown", onKey, true);
    modalRoot.appendChild(backdrop);
    var focusTarget = backdrop.querySelector("button, a[href]");
    if (focusTarget) focusTarget.focus();
    return { close: close, root: backdrop };
  }

  function postMilestone(kind, csrf) {
    if (!csrf) return;
    fetch("/milestone", {
      method: "POST", headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrf: csrf, kind: kind })
    }).catch(function () { /* purely cosmetic state — never bother the user */ });
  }

  // -------------------------------------------------- guided-setup checklist

  // Progress bar fills in from zero on load — the "you're getting somewhere"
  // moment. Skipped under reduced motion (the width is already correct).
  var setupFill = document.querySelector("[data-setup-fill]");
  if (setupFill && !reducedMotion()) {
    var fillTarget = setupFill.style.width;
    setupFill.style.width = "0%";
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () { setupFill.style.width = fillTarget; });
    });
  }

  // Checklist CTAs that jump to a section AND land focus in the right field.
  document.querySelectorAll("[data-setup-goto]").forEach(function (a) {
    a.addEventListener("click", function () {
      var id = a.getAttribute("data-setup-goto");
      window.setTimeout(function () {
        var el = document.getElementById(id);
        if (el && el.focus) el.focus({ preventScroll: true });
      }, 420);
    });
  });

  // All four steps done → the one-time "You're all set" confirmation. Seeing
  // it marks it seen server-side, so it never comes back.
  var setupDoneCard = document.querySelector("[data-setup-complete]");
  if (setupDoneCard) {
    postMilestone("setup-seen", setupDoneCard.getAttribute("data-csrf") || "");
    var dismissBtn = setupDoneCard.querySelector("[data-setup-dismiss]");
    if (dismissBtn) dismissBtn.addEventListener("click", function () {
      if (reducedMotion()) { setupDoneCard.remove(); return; }
      setupDoneCard.classList.add("is-leaving-card");
      window.setTimeout(function () { setupDoneCard.remove(); }, 280);
    });
  }

  // "Show me how" — the how-to-clip steps in a sheet, ending at the Check button.
  var howtoTpl = document.getElementById("howto-clip-template");
  if (howtoTpl) {
    document.querySelectorAll("[data-howto-clip]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var node = howtoTpl.content.firstElementChild.cloneNode(true);
        var sheet = openSheet(node);
        if (!sheet) return;
        node.querySelectorAll("[data-howto-close]").forEach(function (x) { x.addEventListener("click", sheet.close); });
        var doneBtn = node.querySelector("[data-howto-done]");
        if (doneBtn) doneBtn.addEventListener("click", function () {
          sheet.close();
          var check = document.querySelector("[data-check]");
          if (check) {
            check.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "center" });
            check.classList.add("is-spotlit");
            window.setTimeout(function () { check.classList.remove("is-spotlit"); }, 2400);
          } else {
            scrollFocus("#clips");
          }
        });
      });
    });
  }

  // --------------------------------------------------- sample-post demo sheet
  //
  // "Preview a sample post" — the whole pipeline, populated with the seller's
  // own handle/caption/hashtags, server-rendered into a <template>. Purely
  // local: cloning the template makes zero network requests and posts nothing.

  var demoTpl = document.getElementById("demo-post-template");
  if (demoTpl) {
    document.querySelectorAll("[data-demo-open]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var node = demoTpl.content.firstElementChild.cloneNode(true);
        var sheet = openSheet(node);
        if (!sheet) return;
        node.querySelectorAll("[data-demo-close]").forEach(function (x) { x.addEventListener("click", sheet.close); });
        var stages = node.querySelectorAll(".demo-stage, .demo-arrow");
        if (reducedMotion()) {
          stages.forEach(function (s) { s.classList.add("is-on"); });
        } else {
          stages.forEach(function (s, i) {
            window.setTimeout(function () { s.classList.add("is-on"); }, 260 + i * 340);
          });
        }
      });
    });
  }

  // -------------------------------------------- first-post celebration (once)

  var celebrateEl = document.querySelector("[data-celebrate]");
  if (celebrateEl) {
    postMilestone("first-post", celebrateEl.getAttribute("data-csrf") || "");
    if (!reducedMotion()) {
      var burst = document.createElement("div");
      burst.className = "confetti";
      burst.setAttribute("aria-hidden", "true");
      var colors = ["#FF5A3C", "#FF8A4C", "#6E8BFF", "#22C55E", "#FFC01E"];
      for (var ci = 0; ci < 28; ci++) {
        var bit = document.createElement("span");
        bit.className = "confetti-bit";
        bit.style.left = (4 + Math.random() * 92) + "%";
        bit.style.background = colors[ci % colors.length];
        bit.style.animationDelay = (Math.random() * 0.5) + "s";
        bit.style.animationDuration = (1.7 + Math.random() * 1.1) + "s";
        bit.style.width = (6 + Math.random() * 5) + "px";
        bit.style.height = (9 + Math.random() * 6) + "px";
        burst.appendChild(bit);
      }
      document.body.appendChild(burst);
      window.setTimeout(function () { burst.remove(); }, 3600);
    }
  }

  // ------------------------------------------------------ inline help popovers

  var openTip = null;
  function closeTip() {
    if (!openTip) return;
    openTip.btn.setAttribute("aria-expanded", "false");
    openTip.pop.hidden = true;
    openTip = null;
  }
  document.querySelectorAll("[data-help-tip]").forEach(function (wrap) {
    var tipBtn = wrap.querySelector(".help-tip-btn");
    var pop = wrap.querySelector(".help-pop");
    if (!tipBtn || !pop) return;
    tipBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      var wasOpen = openTip && openTip.btn === tipBtn;
      closeTip();
      if (!wasOpen) {
        tipBtn.setAttribute("aria-expanded", "true");
        pop.hidden = false;
        openTip = { btn: tipBtn, pop: pop };
      }
    });
  });
  document.addEventListener("click", function (e) {
    if (openTip && !openTip.pop.contains(e.target)) closeTip();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && openTip) { var b = openTip.btn; closeTip(); b.focus(); }
  });

  // -------------------------------------------------- "Need help?" launcher

  var helpRoot = document.querySelector("[data-help-root]");
  if (helpRoot) {
    var helpBtn = helpRoot.querySelector("[data-help-toggle]");
    var helpPanel = document.getElementById("help-panel");
    if (helpBtn && helpPanel) {
      helpBtn.hidden = false;
      var helpLastFocus = null;
      var onHelpKey = function (e) {
        if (e.key === "Escape") { e.preventDefault(); setHelpOpen(false); return; }
        if (e.key !== "Tab") return;
        var focusables = helpPanel.querySelectorAll("button, a[href], summary");
        if (!focusables.length) return;
        var first = focusables[0], last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      };
      var setHelpOpen = function (open) {
        helpPanel.hidden = !open;
        helpBtn.setAttribute("aria-expanded", String(open));
        if (open) {
          helpLastFocus = document.activeElement;
          document.addEventListener("keydown", onHelpKey, true);
          var f = helpPanel.querySelector("[data-help-close]");
          if (f) f.focus();
        } else {
          document.removeEventListener("keydown", onHelpKey, true);
          if (helpLastFocus && helpLastFocus.focus) helpLastFocus.focus();
          else helpBtn.focus();
        }
      };
      helpBtn.addEventListener("click", function () { setHelpOpen(helpPanel.hidden); });
      var helpClose = helpPanel.querySelector("[data-help-close]");
      if (helpClose) helpClose.addEventListener("click", function () { setHelpOpen(false); });
      document.addEventListener("click", function (e) {
        if (!helpPanel.hidden && !helpRoot.contains(e.target)) setHelpOpen(false);
      });
    }
  }

  // ----------------------------------------- clip thumbnails: fallback guard
  //
  // The branded placeholder is always in the DOM behind the <img>. Drop the img
  // (revealing the placeholder) when it 404s/fails to decode OR when it loads
  // but is effectively a black frame — Whatnot sometimes grabs an all-dark
  // thumbnail, which used to render as a solid black rectangle.
  function isBlackFrame(img) {
    try {
      var c = document.createElement("canvas");
      c.width = 12; c.height = 12;
      var x = c.getContext("2d");
      x.drawImage(img, 0, 0, 12, 12);
      var d = x.getImageData(0, 0, 12, 12).data;
      var sum = 0;
      for (var i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      return (sum / (d.length / 4)) < 10; // avg luminance ≈ black
    } catch (e) { return false; } // canvas blocked — keep the image
  }
  document.querySelectorAll("[data-thumb-img]").forEach(function (img) {
    var vet = function () { if (isBlackFrame(img)) img.remove(); };
    if (img.complete && img.naturalWidth === 0) { img.remove(); return; }
    if (img.complete && img.naturalWidth > 0) { vet(); return; }
    img.addEventListener("error", function () { img.remove(); });
    img.addEventListener("load", vet);
  });

  // -------------------------------------------------- headline char counter

  document.querySelectorAll("[data-char-count-for]").forEach(function (counter) {
    var input = document.getElementById(counter.getAttribute("data-char-count-for"));
    if (!input) return;
    var max = Number(input.getAttribute("maxlength")) || 80;
    var update = function () {
      counter.textContent = input.value.length + "/" + max;
      counter.classList.toggle("is-maxed", input.value.length >= max);
    };
    input.addEventListener("input", update);
    update();
  });

  // ---------------------------------- thumbnail studio (show-covers): live preview
  //
  // Mirrors src/thumbrender.ts's Text-Wall / Poster engine (flood colour + rays +
  // stacked type wall + big price starburst + product collage) at the real Whatnot
  // tile ratio (1080×1667 ≈ 0.647). Cutout background-removal + grade are server-only;
  // the preview approximates the collage with the uploaded photos as tiles.

  var studioCfgEl = document.getElementById("cf-thumbstudio");
  var genForm = document.getElementById("gen-form");
  var canvas = document.getElementById("preview-canvas");
  if (studioCfgEl && genForm && canvas && canvas.getContext && window.fetch) {
    var CFG = {};
    try { CFG = JSON.parse(studioCfgEl.textContent || "{}"); } catch (eCfg) { CFG = {}; }
    var ctx = canvas.getContext("2d");

    // Layout constants — MUST match src/thumbrender.ts.
    var RW = 1080, RH = 1667, SAFE = 0.05, INNER_W = RW * (1 - SAFE * 2), MARGIN = RW * SAFE;
    var WALL_TOP = 0.125, WALL_BOTTOM = 0.68, WALL_FILL = 0.62, WALL_MAX_LINES = 5, WALL_LEAD = 0.9, LINE_TARGET_W = 0.94;
    var BADGE_RADIUS = RW * 0.115;
    var L_TOP = 0.075, L_BOTTOM = 0.46, L_CENTER = 0.26, P_START = 150, P_MIN = 40, P_MAXLINES = 4, P_LEAD = 0.98;

    var headlineInput = document.getElementById("gen-headline");
    var subjectInput = document.getElementById("gen-subject");
    var clipSelect = document.getElementById("gen-clip");
    var heroInput = document.getElementById("gen-hero");
    var useClipInput = document.getElementById("gen-useclip");
    var useClipToggle = document.getElementById("gen-useclip-toggle");
    var clipHero = document.getElementById("clip-hero");
    var clipHeroImg = document.getElementById("clip-hero-img");
    var layoutInput = document.getElementById("gen-layout");
    var dateInput = document.getElementById("gen-date");
    var cutoutsInput = document.getElementById("gen-cutouts");
    var recipeInput = document.getElementById("gen-recipe");
    var uploadsEl = document.getElementById("uploads");
    var uploadInput = document.getElementById("upload-input");
    var uploadAdd = document.getElementById("upload-add");
    var cloneUrl = document.getElementById("clone-url");
    var cloneGo = document.getElementById("clone-go");
    var cloneStatus = document.getElementById("clone-status");
    var frame = document.getElementById("preview-frame");
    var leftEl = document.getElementById("gen-left");
    var submitBtn = document.getElementById("gen-submit");
    var statusEl = document.getElementById("preview-status");
    var statusText = document.getElementById("preview-status-text");
    var writeBtn = document.getElementById("headline-write");
    var ideasEl = document.getElementById("headline-ideas");
    var heroPick = document.getElementById("hero-pick");
    var heroPickWords = document.getElementById("hero-pick-words");

    var products = []; // {img, cutoutId}
    var recipe = null;

    function currentStyle() { var c = genForm.querySelector('input[name="style"]:checked'); return c ? c.value : Object.keys(CFG.styles)[0]; }
    function selectedOption() { return clipSelect ? clipSelect.options[clipSelect.selectedIndex] : null; }
    function currentMode() { return recipe ? recipe.layoutStyle : (layoutInput ? layoutInput.value : "wall"); }

    // --- offer + hero-word (mirror thumbrender.ts) ---
    var LFILLER = { the:1,a:1,an:1,and:1,or:1,"for":1,"with":1,of:1,to:1,"in":1,on:1,at:1,my:1,your:1,all:1,night:1,tonight:1 };
    var OFFER_PATTERNS = [/\$\s?\d[\d,]*(?:\.\d+)?\+?/, /\b\d[\d,]*\s?\$/, /\b\d{1,3}\s?%\s?off\b/i, /\b\d+\s+for\s+\$?\d+\b/i, /\bbogo\b/i, /\bfree\b/i];
    function normalizeOffer(raw) { var t = raw.replace(/\s+/g, "").toUpperCase(); var m = t.match(/^(\d[\d,]*)\$$/); return m ? "$" + m[1] : t; }
    function detectOffer(h) {
      var clean = (h || "").replace(/\s+/g, " ").trim(), offer = null, rest = clean;
      for (var i = 0; i < OFFER_PATTERNS.length; i++) { var m = clean.match(OFFER_PATTERNS[i]); if (m) { offer = normalizeOffer(m[0]); rest = (clean.slice(0, m.index) + clean.slice(m.index + m[0].length)).replace(/\s+/g, " ").trim(); break; } }
      var words = rest ? rest.toUpperCase().split(" ") : [];
      if (words.length === 0 && offer) return { offer: null, rest: [offer] };
      return { offer: offer, rest: words };
    }
    function pickHeroIndex(rest, override) {
      if (override != null && override >= 0 && override < rest.length) return override;
      var best = 0, bl = -1; rest.forEach(function (w, i) { var s = LFILLER[w.toLowerCase()] ? w.length - 100 : w.length; if (s > bl) { bl = s; best = i; } }); return best;
    }
    var SFILLER = { the:1,a:1,an:1,and:1,or:1,"for":1,"with":1,of:1,to:1,"in":1,on:1,at:1,my:1,your:1,live:1,stream:1,streaming:1,clip:1,video:1,today:1,tonight:1,now:1,"new":1,watch:1,come:1,join:1,us:1,get:1,shop:1,sale:1,deal:1,deals:1,giveaway:1 };
    function deriveSubject(t) { return (t || "").toLowerCase().replace(/[^0-9a-zà-ÿ\s]/gi, " ").split(/\s+/).filter(function (w) { return w && !SFILLER[w]; }).slice(0, 6).join(" ").trim(); }

    // --- colours ---
    function hexToRgb(h) { var s = h.replace("#", ""); if (s.length === 3) s = s[0]+s[0]+s[1]+s[1]+s[2]+s[2]; return [parseInt(s.slice(0,2),16), parseInt(s.slice(2,4),16), parseInt(s.slice(4,6),16)]; }
    function shade(hex, amt) { var c = hexToRgb(hex); function f(v){ v = Math.max(0, Math.min(255, Math.round(v+amt))); return v.toString(16).padStart(2,"0"); } return "#"+f(c[0])+f(c[1])+f(c[2]); }
    function lum(hex) { var c = hexToRgb(hex); return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2]; }

    // --- wall layout (mirror thumbrender.ts) ---
    function groupLines(words, count) {
      if (words.length <= count) return words.slice();
      var total = words.join(" ").length, per = total / count, lines = [], cur = [], curLen = 0;
      for (var i = 0; i < words.length; i++) {
        cur.push(words[i]); curLen += words[i].length + 1;
        var remLines = count - lines.length, remWords = words.length - i;
        if ((curLen >= per && lines.length < count - 1) || remWords <= remLines - 1) { lines.push(cur.join(" ")); cur = []; curLen = 0; }
      }
      if (cur.length) lines.push(cur.join(" "));
      return lines;
    }
    function layoutWall(words, refMeasure, ref, innerW, targetH) {
      var targetW = innerW * LINE_TARGET_W;
      function sizeFor(t) { var w = refMeasure(t) / ref; return w > 0 ? targetW / w : ref; }
      var best = null, maxLines = Math.min(WALL_MAX_LINES, Math.max(1, words.length));
      for (var count = 1; count <= maxLines; count++) {
        var grouped = groupLines(words, count);
        var lines = grouped.map(function (t) { return { text: t, size: Math.min(sizeFor(t), RH * 0.24) }; });
        var stackH = lines.reduce(function (h, l) { return h + l.size * WALL_LEAD; }, 0);
        var err = Math.abs(stackH - targetH);
        if (!best || err < best.err) best = { lines: lines, stackH: stackH, err: err };
      }
      return best;
    }
    function wrapWords(words, measure, maxW) { var lines = [], cur = ""; for (var i=0;i<words.length;i++){ var t = cur?cur+" "+words[i]:words[i]; if(!cur||measure(t)<=maxW)cur=t; else{lines.push(cur);cur=words[i];} } if(cur)lines.push(cur); return lines; }
    function layoutLockup(rest, heroIdx, measure, heroScale, maxW) {
      var before = rest.slice(0, heroIdx), hero = rest[heroIdx] || "", after = rest.slice(heroIdx + 1), maxBlockH = (L_BOTTOM - L_TOP) * RH;
      function build(size) {
        var bl = wrapWords(before, function (s) { return measure(s, size); }, maxW), al = wrapWords(after, function (s) { return measure(s, size); }, maxW);
        var lines = bl.map(function (t) { return { text: t, size: size }; }); if (hero) lines.push({ text: hero, size: size * heroScale }); lines = lines.concat(al.map(function (t) { return { text: t, size: size }; }));
        return { lines: lines, heroLine: hero ? bl.length : -1 };
      }
      for (var size = P_START; size >= P_MIN; size -= 4) {
        var r = build(size); if (!r.lines.length) continue;
        var ok = r.lines.every(function (l) { return measure(l.text, l.size) <= maxW; });
        var bh = r.lines.reduce(function (h, l) { return h + l.size * P_LEAD; }, 0);
        if (r.lines.length <= P_MAXLINES && ok && bh <= maxBlockH) return { lines: r.lines, blockH: bh, heroLine: r.heroLine };
      }
      var f = build(P_MIN), lines = f.lines.slice(0, P_MAXLINES);
      return { lines: lines, blockH: lines.reduce(function (h, l) { return h + l.size * P_LEAD; }, 0), heroLine: Math.min(f.heroLine, lines.length - 1) };
    }

    // --- drawing ---
    function drawFlood(base, rays) {
      var g = ctx.createRadialGradient(RW/2, RH*0.42, RH*0.05, RW/2, RH*0.42, RH*0.8);
      g.addColorStop(0, shade(base, 34)); g.addColorStop(1, shade(base, -26)); ctx.fillStyle = g; ctx.fillRect(0,0,RW,RH);
      var cx = RW/2, cy = RH*0.4, n = 24, R = RH*1.1; ctx.save(); ctx.globalAlpha = 0.16; ctx.fillStyle = rays;
      for (var i=0;i<n;i++){ var a=(Math.PI*2*i)/n, w=0.10; ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(cx+Math.cos(a-w)*R, cy+Math.sin(a-w)*R); ctx.lineTo(cx+Math.cos(a+w)*R, cy+Math.sin(a+w)*R); ctx.closePath(); ctx.fill(); }
      ctx.restore();
      var v = ctx.createRadialGradient(RW/2, RH*0.45, RH*0.3, RW/2, RH*0.5, RH*0.75); v.addColorStop(0,"rgba(0,0,0,0)"); v.addColorStop(1,"rgba(0,0,0,0.28)"); ctx.fillStyle=v; ctx.fillRect(0,0,RW,RH);
    }
    function drawWallLine(line, cx, y, skew, fill, outline) {
      ctx.save(); ctx.translate(cx, y); ctx.transform(1, 0, Math.tan(skew*Math.PI/180), 1, 0, 0);
      ctx.font = line.size + 'px "Clash Display"'; try { ctx.letterSpacing = "-1px"; } catch (e) {}
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(0,0,0,0.42)"; ctx.fillText(line.text, line.size*0.045, line.size*0.06);
      ctx.lineJoin = "round"; ctx.lineWidth = line.size*0.075; ctx.strokeStyle = outline; ctx.strokeText(line.text, 0, 0);
      ctx.fillStyle = fill; ctx.fillText(line.text, 0, 0);
      try { ctx.letterSpacing = "0px"; } catch (e) {} ctx.restore();
    }
    function starPath(radius, inner, points) { ctx.beginPath(); for (var i=0;i<points*2;i++){ var r=i%2===0?radius:inner, a=(Math.PI*i)/points-Math.PI/2, x=Math.cos(a)*r, y=Math.sin(a)*r; i===0?ctx.moveTo(x,y):ctx.lineTo(x,y); } ctx.closePath(); }
    function drawStarburst(cx, cy, text) {
      var radius = BADGE_RADIUS, inner = radius*0.74, points = 16;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(-8*Math.PI/180);
      ctx.shadowColor = "rgba(0,0,0,0.45)"; ctx.shadowBlur = 34; ctx.shadowOffsetY = 12;
      var grad = ctx.createLinearGradient(0,-radius,0,radius); grad.addColorStop(0,"#FFE79A"); grad.addColorStop(0.5,"#FFC01E"); grad.addColorStop(1,"#E48A00");
      starPath(radius, inner, points); ctx.fillStyle = grad; ctx.fill();
      ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
      ctx.lineWidth = 7; ctx.strokeStyle = "#ffffff"; starPath(radius*0.86, inner*0.86, points); ctx.stroke();
      var fs = radius*1.05; ctx.font = fs+'px "Clash Display"'; var maxTw = inner*1.62, tw = ctx.measureText(text).width; if (tw > maxTw) { fs *= maxTw/tw; ctx.font = fs+'px "Clash Display"'; }
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.lineJoin = "round"; ctx.lineWidth = fs*0.09; ctx.strokeStyle = "#7A3E00"; ctx.strokeText(text, 0, fs*0.02);
      ctx.fillStyle = "#ffffff"; ctx.fillText(text, 0, fs*0.02); ctx.restore();
    }
    function drawStickerLine(line, cx, y, rot, fill, outline) {
      ctx.save(); ctx.translate(cx, y); ctx.rotate(rot*Math.PI/180);
      ctx.font = line.size+'px "Clash Display"'; try { ctx.letterSpacing = "-1px"; } catch (e) {}
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(0,0,0,0.4)"; ctx.fillText(line.text, line.size*0.045, line.size*0.065);
      ctx.lineJoin = "round"; ctx.lineWidth = line.size*0.06; ctx.strokeStyle = outline; ctx.strokeText(line.text, 0, 0);
      ctx.fillStyle = fill; ctx.fillText(line.text, 0, 0);
      try { ctx.letterSpacing = "0px"; } catch (e) {} ctx.restore();
    }
    function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }

    function rngFn(seed) { var s = seed>>>0; return function(){ s=(s+0x6d2b79f5)>>>0; var t=Math.imul(s^(s>>>15),1|s); t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296; }; }
    function drawCollagePreview() {
      if (!products.length) return;
      var r = rngFn(20240001), count = Math.min(6, Math.max(3, products.length * 2)), overN = Math.min(count, 2);
      for (var k=0;k<count;k++){
        var p = products[k % products.length]; if (!p.img || !p.img.complete) continue;
        var over = k < overN, ar = (p.img.naturalWidth/p.img.naturalHeight)||1;
        var w = RW*(over?0.38+r()*0.12:0.32+r()*0.14), h = w/ar;
        var col = (k+0.5)/count, x = RW*(0.05+col*0.9+(r()-0.5)*0.1)-w/2;
        var bandTop = over?WALL_BOTTOM-0.11:WALL_BOTTOM-0.02, bandBottom = over?WALL_BOTTOM+0.05:0.9;
        var y = RH*(bandTop+r()*(bandBottom-bandTop))-h/2, rot = (r()-0.5)*(over?16:24);
        ctx.save(); ctx.translate(x+w/2, y+h/2); ctx.rotate(rot*Math.PI/180);
        if (over) { ctx.shadowColor="rgba(0,0,0,0.5)"; ctx.shadowBlur=26; ctx.shadowOffsetY=12; }
        var pad = w*0.03; ctx.fillStyle = "#fff"; roundRect(-w/2-pad,-h/2-pad,w+pad*2,h+pad*2,w*0.06); ctx.fill();
        ctx.shadowColor="transparent"; ctx.shadowBlur=0; ctx.shadowOffsetY=0;
        ctx.save(); roundRect(-w/2,-h/2,w,h,w*0.05); ctx.clip(); ctx.drawImage(p.img,-w/2,-h/2,w,h); ctx.restore();
        ctx.restore();
      }
    }

    function renderPreview() {
      var style = currentStyle(), spec = CFG.styles[style]; if (!spec) return;
      if (frame) frame.setAttribute("data-style", style);
      var mode = currentMode();
      var base = recipe ? recipe.baseColorHex : spec.base;
      var rays = recipe ? shade(base, 40) : spec.rays;
      var wallFills = (recipe && recipe.textColors && recipe.textColors.length) ? recipe.textColors : spec.wallFills;

      ctx.clearRect(0, 0, RW, RH);
      drawFlood(base, rays);
      // behind-collage
      drawCollagePreview();
      if (mode === "poster") { var sg = ctx.createLinearGradient(0,0,0,RH*0.5); sg.addColorStop(0,"rgba(0,0,0,0.5)"); sg.addColorStop(1,"rgba(0,0,0,0)"); ctx.fillStyle=sg; ctx.fillRect(0,0,RW,RH*0.5); }

      var od = detectOffer((headlineInput && headlineInput.value) || "YOUR HEADLINE");
      var words = od.rest.length ? od.rest : ["YOUR", "HEADLINE"];
      var starCx = RW*0.8, starCy = RH*0.2;

      if (mode === "wall") {
        var REF = 100, refMeasure = function (t) { ctx.font = REF+'px "Clash Display"'; return ctx.measureText(t).width; };
        var effInnerW = INNER_W * (od.offer ? 0.74 : 1), textCenterX = MARGIN + effInnerW/2;
        var lay = layoutWall(words, refMeasure, REF, effInnerW, RH*WALL_FILL);
        var bandCenter = (WALL_TOP+WALL_BOTTOM)/2*RH, cursorY = bandCenter - lay.stackH/2, firstTop = cursorY;
        lay.lines.forEach(function (l, i) {
          var lh = l.size*WALL_LEAD, cy = cursorY + lh/2, skew = (i%2===0?1:-1)*2;
          var fill = wallFills[i % wallFills.length], outline = lum(fill) > 150 ? shade(base,-60) : "#ffffff";
          drawWallLine(l, textCenterX, cy, skew, fill, outline); cursorY += lh;
        });
        starCx = MARGIN + effInnerW - 30 + BADGE_RADIUS;
        starCy = firstTop + ((lay.lines[0]?lay.lines[0].size:100) + (lay.lines[1]?lay.lines[1].size*0.5:0)) * WALL_LEAD * 0.5;
      } else {
        var t = spec.text, heroIdx = pickHeroIndex(words, (heroInput && heroInput.value!=="") ? parseInt(heroInput.value,10) : null);
        var maxW = RW - MARGIN*2, GUTTER = 240, effMaxW = maxW - (od.offer?GUTTER:0), tcx = MARGIN + effMaxW/2;
        var measure = function (text, px) { ctx.font = px+'px "Clash Display"'; return ctx.measureText(text).width; };
        var lk = layoutLockup(words, heroIdx, measure, t.heroScale, effMaxW);
        var cy0 = Math.max(L_TOP*RH, L_CENTER*RH - lk.blockH/2), ft = cy0, fs = lk.lines[0]?lk.lines[0].size:100, cursor = cy0;
        lk.lines.forEach(function (l, i) {
          var lh = l.size*P_LEAD, cy = cursor + lh/2, rot = (i%2===0?1:-1)*t.rotateMag*(i===lk.heroLine?0.5:1);
          var entry = wallFills[i % wallFills.length], outline = lum(entry) > 150 ? shade(base,-60) : "#ffffff";
          drawStickerLine(l, tcx, cy, rot, entry, outline); cursor += lh;
        });
        starCx = MARGIN + effMaxW + RW*0.02; starCy = ft + fs*0.3;
      }
      // over-collage on top (approx: same tiles, drawn again lightly for depth) — skipped in preview to keep it readable
      if (od.offer) drawStarburst(Math.min(starCx, RW - RW*0.1), starCy, od.offer);

      var date = (dateInput && dateInput.value || "").trim().slice(0, 24);
      if (date) {
        ctx.font = '44px "Satoshi Black", "Satoshi", sans-serif';
        var tw = ctx.measureText(date.toUpperCase()).width, pad = 30, bh = 76, bw = tw + pad*2, bx = (RW-bw)/2, by = RH*0.9 - bh;
        ctx.save(); ctx.shadowColor="rgba(0,0,0,0.4)"; ctx.shadowBlur=18; ctx.shadowOffsetY=6; ctx.fillStyle = spec.accent; roundRect(bx,by,bw,bh,bh/2); ctx.fill(); ctx.restore();
        ctx.fillStyle="#fff"; ctx.textAlign="center"; ctx.textBaseline="middle"; ctx.fillText(date.toUpperCase(), RW/2, by+bh/2+2);
      }
      if (CFG.handle) {
        ctx.font = '40px "Satoshi Medium", "Satoshi", sans-serif'; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
        ctx.fillStyle = "rgba(255,255,255,0.85)"; ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 10;
        ctx.fillText("@" + CFG.handle, RW/2, RH - 58); ctx.shadowColor = "transparent"; ctx.shadowBlur = 0;
      }
    }

    function renderHeroPick() {
      if (!heroPick || !heroPickWords) return;
      if (currentMode() !== "poster") { heroPick.hidden = true; return; } // hero word only matters in Poster
      var od = detectOffer((headlineInput && headlineInput.value) || ""), rest = od.rest;
      if (rest.length < 2) { heroPick.hidden = true; heroPickWords.innerHTML = ""; return; }
      var override = (heroInput && heroInput.value!=="") ? parseInt(heroInput.value,10) : null;
      var chosen = (override != null && override < rest.length) ? override : pickHeroIndex(rest, null);
      heroPickWords.innerHTML = "";
      rest.forEach(function (w, i) {
        var b = document.createElement("button"); b.type = "button"; b.className = "hero-word" + (i===chosen?" is-chosen":""); b.textContent = w; b.setAttribute("aria-pressed", String(i===chosen));
        b.addEventListener("click", function () { heroInput.value = String(i); renderHeroPick(); renderPreview(); });
        heroPickWords.appendChild(b);
      });
      heroPick.hidden = false;
    }

    function renderWhenReady() {
      renderPreview();
      if (document.fonts && document.fonts.load) { Promise.all([document.fonts.load('700 120px "Clash Display"'), document.fonts.load('400 40px "Satoshi Medium"')]).then(renderPreview).catch(function () {}); }
    }

    // --- controls wiring ---
    genForm.querySelectorAll('input[name="style"]').forEach(function (radio) {
      radio.addEventListener("change", function () { genForm.querySelectorAll(".style-card").forEach(function (c) { c.classList.toggle("is-selected", c.getAttribute("data-style") === radio.value); }); renderPreview(); });
    });
    // layout segmented control
    genForm.querySelectorAll(".seg-btn").forEach(function (b) {
      b.addEventListener("click", function () {
        recipe = null; if (recipeInput) recipeInput.value = ""; if (cloneStatus) cloneStatus.hidden = true;
        genForm.querySelectorAll(".seg-btn").forEach(function (x) { x.classList.remove("is-active"); x.setAttribute("aria-checked", "false"); });
        b.classList.add("is-active"); b.setAttribute("aria-checked", "true");
        if (layoutInput) layoutInput.value = b.getAttribute("data-layout");
        renderHeroPick(); renderPreview();
      });
    });
    if (headlineInput) headlineInput.addEventListener("input", function () { if (heroInput) heroInput.value = ""; renderHeroPick(); renderPreview(); });
    if (dateInput) dateInput.addEventListener("input", renderPreview);

    function syncClipHero() {
      var opt = selectedOption(), hasThumb = opt && opt.getAttribute("data-thumb") === "1";
      if (clipHero) clipHero.hidden = !hasThumb;
      if (hasThumb && clipHeroImg) clipHeroImg.src = "/thumb/" + opt.value;
    }
    if (clipSelect) clipSelect.addEventListener("change", function () {
      var opt = selectedOption(), derived = deriveSubject(opt ? opt.getAttribute("data-title") : "");
      if (subjectInput && derived) subjectInput.value = derived; syncClipHero();
    });
    if (useClipToggle) useClipToggle.addEventListener("change", function () { if (useClipInput) useClipInput.value = useClipToggle.checked ? "1" : "0"; });

    // --- product uploads → server cutout ---
    function syncCutoutIds() { if (cutoutsInput) cutoutsInput.value = products.map(function (p) { return p.cutoutId; }).filter(Boolean).join(","); }
    function refreshAddTile() { if (uploadAdd) uploadAdd.style.display = products.length >= 3 ? "none" : ""; }
    function addProduct(dataUrl) {
      if (products.length >= 3) return;
      var img = new Image();
      var tile = document.createElement("div"); tile.className = "upload-tile is-loading-cut";
      tile.innerHTML = '<span class="upload-spin" aria-hidden="true"></span><button type="button" class="upload-remove" aria-label="Remove">' + ICONS.x + '</button>';
      tile.style.backgroundImage = "url(" + dataUrl + ")";
      var rec = { img: img, cutoutId: "", tile: tile };
      img.onload = function () { renderPreview(); };
      img.src = dataUrl;
      products.push(rec);
      if (uploadsEl && uploadAdd) uploadsEl.insertBefore(tile, uploadAdd);
      refreshAddTile();
      tile.querySelector(".upload-remove").addEventListener("click", function () {
        var i = products.indexOf(rec); if (i >= 0) products.splice(i, 1); tile.remove(); syncCutoutIds(); refreshAddTile(); renderPreview();
      });
      // POST to server for real cutout id (used at generate time)
      fetch("/thumbnails/cutout", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ csrf: CFG.csrf, image: dataUrl }) })
        .then(function (r) { return r.json().catch(function () { return { ok: false }; }); })
        .then(function (j) { tile.classList.remove("is-loading-cut"); if (j.ok) { rec.cutoutId = j.id; syncCutoutIds(); } else { toast(j.error || "Couldn't process that photo.", "error", 6000); } })
        .catch(function () { tile.classList.remove("is-loading-cut"); toast("Couldn't upload that photo.", "error"); });
    }
    if (uploadInput) uploadInput.addEventListener("change", function () {
      var files = Array.prototype.slice.call(uploadInput.files || []);
      files.slice(0, 3 - products.length).forEach(function (f) { var rd = new FileReader(); rd.onload = function () { addProduct(String(rd.result)); }; rd.readAsDataURL(f); });
      uploadInput.value = "";
    });

    // --- clone a winner ---
    if (cloneGo) cloneGo.addEventListener("click", function () {
      var url = (cloneUrl && cloneUrl.value || "").trim(); if (!url) { toast("Paste a Whatnot cover image URL first.", "info"); return; }
      cloneGo.classList.add("is-loading"); cloneGo.disabled = true;
      fetch("/thumbnails/clone", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ csrf: CFG.csrf, url: url }) })
        .then(function (r) { return r.json().catch(function () { return { ok: false, error: "Unexpected response." }; }); })
        .then(function (j) {
          cloneGo.classList.remove("is-loading"); cloneGo.disabled = false;
          if (!j.ok) { toast(j.error || "Couldn't read that cover.", "error", 7000); return; }
          recipe = j.recipe; if (recipeInput) recipeInput.value = JSON.stringify(j.recipe);
          // reflect the recipe's layout in the segmented control
          genForm.querySelectorAll(".seg-btn").forEach(function (x) { var on = x.getAttribute("data-layout") === j.recipe.layoutStyle; x.classList.toggle("is-active", on); x.setAttribute("aria-checked", String(on)); });
          if (layoutInput) layoutInput.value = j.recipe.layoutStyle;
          if (cloneStatus) { cloneStatus.hidden = false; cloneStatus.textContent = "Style applied — " + (j.recipe.energyNotes || j.recipe.layoutStyle + " layout") + " (base " + j.recipe.baseColorHex + "). Your words, your products."; }
          renderHeroPick(); renderPreview();
        })
        .catch(function () { cloneGo.classList.remove("is-loading"); cloneGo.disabled = false; toast("Network hiccup — try again.", "error"); });
    });

    // AI headline writer
    if (writeBtn && ideasEl) {
      writeBtn.addEventListener("click", function () {
        writeBtn.classList.add("is-loading"); writeBtn.disabled = true; ideasEl.hidden = false;
        ideasEl.innerHTML = '<span class="idea-shimmer"></span><span class="idea-shimmer"></span><span class="idea-shimmer"></span>';
        var opt = selectedOption();
        var body = new URLSearchParams({ csrf: CFG.csrf, clipTitle: opt ? (opt.getAttribute("data-title") || "") : "", subject: subjectInput ? subjectInput.value : "" });
        fetch("/thumbnails/headline", { method: "POST", headers: { Accept: "application/json" }, body: body })
          .then(function (r) { return r.json().catch(function () { return { ok: false, error: "Unexpected response." }; }); })
          .then(function (json) {
            writeBtn.classList.remove("is-loading"); writeBtn.disabled = false;
            if (!json.ok) { ideasEl.hidden = true; toast(json.error || "Couldn't write headlines — try again.", "error", 6000); return; }
            ideasEl.innerHTML = "";
            json.headlines.forEach(function (h) {
              var chip = document.createElement("button"); chip.type = "button"; chip.className = "idea-chip"; chip.textContent = h;
              chip.addEventListener("click", function () { headlineInput.value = h; if (heroInput) heroInput.value = ""; renderHeroPick(); renderPreview(); headlineInput.focus(); });
              ideasEl.appendChild(chip);
            });
          })
          .catch(function () { writeBtn.classList.remove("is-loading"); writeBtn.disabled = false; ideasEl.hidden = true; toast("Network hiccup — try again.", "error"); });
      });
    }

    syncClipHero(); renderHeroPick(); renderWhenReady();

    // --- generate + full-screen chooser ---
    var PIPELINE = ["Cutting out your products…", "Flooding the colour…", "Building the text wall…", "Collaging it together…"];
    var pipelineTimer = null;
    function showStatus(on) {
      if (!statusEl) return;
      statusEl.hidden = !on;
      if (on) {
        var i = 0; if (statusText) statusText.textContent = PIPELINE[0];
        pipelineTimer = window.setInterval(function () { i = Math.min(i + 1, PIPELINE.length - 1); if (statusText) statusText.textContent = PIPELINE[i]; }, 3200);
      } else if (pipelineTimer) { window.clearInterval(pipelineTimer); pipelineTimer = null; }
    }
    function setBusy(busy) { submitBtn.classList.toggle("is-loading", busy); submitBtn.disabled = busy; showStatus(busy); }
    function post(url, extra) {
      var body = new URLSearchParams({ csrf: CFG.csrf });
      if (extra) Object.keys(extra).forEach(function (k) { body.set(k, extra[k]); });
      return fetch(url, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" }, body: body })
        .then(function (r) { return r.json().catch(function () { return { ok: false, error: "Unexpected response." }; }); });
    }

    function openChooser(ids) {
      if (!modalRoot) { window.location.href = "/thumbnails"; return; }
      var previous = document.activeElement;
      var backdrop = document.createElement("div");
      backdrop.className = "modal-backdrop chooser-backdrop";
      var cards = ids.map(function (id, i) {
        return '<figure class="chooser-card" data-id="' + id + '">' +
          '<img src="/thumb-gen/' + id + '.webp" alt="Variation ' + (i + 1) + '">' +
          '<button type="button" class="btn btn-primary btn-block chooser-keep" data-keep="' + id + '">Keep this one</button>' +
          '</figure>';
      }).join("");
      backdrop.innerHTML =
        '<div class="chooser" role="dialog" aria-modal="true" aria-label="Choose your cover">' +
        '<button type="button" class="chooser-close" data-close aria-label="Discard both">' + ICONS.x + '</button>' +
        '<h2 class="chooser-title">Pick your cover</h2>' +
        '<div class="chooser-grid">' + cards + '</div>' +
        '<div class="chooser-actions">' +
        (ids.length > 1 ? '<button type="button" class="btn btn-secondary" data-keepboth>Keep both</button>' : "") +
        '<button type="button" class="btn btn-ghost" data-regenerate>Regenerate</button>' +
        '</div></div>';

      function close() {
        document.removeEventListener("keydown", onKey, true);
        backdrop.remove();
        if (previous && previous.focus) previous.focus();
      }
      function confirmDiscard() {
        confirmModal({ title: "Discard both variations?", body: "Neither cover will be saved. You can generate again.", action: "Discard" }, function () {
          ids.forEach(function (id) { post("/thumbnails/delete/" + id); });
          close();
        });
      }
      function keep(id, discard) {
        var busy = backdrop.querySelector('[data-keep="' + id + '"]');
        if (busy) { busy.classList.add("is-loading"); busy.disabled = true; }
        return post("/thumbnails/keep/" + id, discard ? {} : { discard: "0" });
      }
      var focusables = backdrop.querySelectorAll("button");
      function onKey(e) {
        if (e.key === "Escape") { e.preventDefault(); confirmDiscard(); return; }
        if (e.key === "Tab") {
          var first = focusables[0], last = focusables[focusables.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }
      backdrop.addEventListener("click", function (e) {
        var keepBtn = e.target.closest("[data-keep]");
        if (keepBtn) { keep(keepBtn.getAttribute("data-keep"), true).then(function (j) { if (j.ok) { toast("Saved to your covers.", "success"); window.location.href = "/thumbnails"; } else { toast(j.error || "Couldn't keep that one.", "error"); } }); return; }
        if (e.target.closest("[data-keepboth]")) {
          Promise.all(ids.map(function (id) { return keep(id, false); })).then(function () { toast("Both saved.", "success"); window.location.href = "/thumbnails"; }); return;
        }
        if (e.target.closest("[data-regenerate]")) { ids.forEach(function (id) { post("/thumbnails/delete/" + id); }); close(); genForm.requestSubmit(); return; }
        if (e.target.closest("[data-close]") || e.target === backdrop) { confirmDiscard(); return; }
      });
      document.addEventListener("keydown", onKey, true);
      modalRoot.appendChild(backdrop);
      var firstKeep = backdrop.querySelector(".chooser-keep");
      if (firstKeep) firstKeep.focus();
    }

    genForm.addEventListener("submit", function (e) {
      e.preventDefault();
      setBusy(true);
      var body = new URLSearchParams(new FormData(genForm));
      body.set("csrf", CFG.csrf);
      fetch("/thumbnails/generate", { method: "POST", headers: { Accept: "application/json" }, body: body })
        .then(function (r) { return r.json().catch(function () { return { ok: false, error: "Unexpected response — try again." }; }); })
        .then(function (json) {
          setBusy(false);
          if (!json.ok) { toast(json.error || "Generation failed — try again.", "error", 7000); return; }
          if (typeof json.left === "number" && leftEl) leftEl.textContent = json.left;
          if (json.variations.length < 2) toast("One background came back — keep it or regenerate.", "info", 6000);
          openChooser(json.variations);
        })
        .catch(function () { setBusy(false); toast("Network hiccup — check your connection and try again.", "error"); });
    });

    // Gallery: regenerate background / delete (event-delegated on the page).
    document.addEventListener("click", function (e) {
      var regen = e.target.closest("[data-regen]");
      var del = e.target.closest("[data-delete]");
      if (regen) {
        var rid = regen.getAttribute("data-regen");
        regen.classList.add("is-loading"); regen.disabled = true;
        post("/thumbnails/regen/" + rid).then(function (json) {
          regen.classList.remove("is-loading"); regen.disabled = false;
          if (!json.ok) { toast(json.error || "Regeneration failed.", "error", 7000); return; }
          var img = document.querySelector('.thumb-card[data-id="' + rid + '"] img');
          if (img) img.src = "/thumb-gen/" + rid + ".webp?t=" + (json.ts || 1);
          toast("Fresh background — same headline.", "success");
        });
      } else if (del) {
        var did = del.getAttribute("data-delete");
        confirmModal({
          title: del.getAttribute("data-confirm-title") || "Delete this thumbnail?",
          body: del.getAttribute("data-confirm-body") || "",
          action: del.getAttribute("data-confirm-action") || "Delete"
        }, function () {
          post("/thumbnails/delete/" + did).then(function (json) {
            if (json.ok) { var card = document.querySelector('.thumb-card[data-id="' + did + '"]'); if (card) card.remove(); toast("Cover deleted.", "info"); }
            else { toast(json.error || "Couldn't delete.", "error"); }
          });
        });
      }
    });
  }


  // ------------------------------------------------- settings: hashtag chips

  var hiddenTags = document.getElementById("hashtags");
  var chipWrap = document.getElementById("hashtag-chip-input");
  var chipList = document.getElementById("hashtag-chip-list");
  var chipEntry = document.getElementById("hashtag-entry");
  var tags = [];

  function parseTags(value) {
    return value.split(/[\s,]+/).map(function (t) {
      return t.replace(/^#+/, "").trim();
    }).filter(Boolean);
  }

  function renderChips() {
    if (!chipList) return;
    chipList.innerHTML = "";
    tags.forEach(function (tag, i) {
      var li = document.createElement("li");
      li.className = "chip chip-hashtag";
      var label = document.createElement("span");
      label.textContent = "#" + tag;
      var rm = document.createElement("button");
      rm.type = "button";
      rm.className = "chip-remove";
      rm.setAttribute("aria-label", "Remove #" + tag);
      rm.innerHTML = ICONS.x;
      rm.addEventListener("click", function () {
        tags.splice(i, 1);
        syncTags();
      });
      li.appendChild(label);
      li.appendChild(rm);
      chipList.appendChild(li);
    });
    hiddenTags.value = tags.join(" ");
  }

  function syncTags() {
    renderChips();
    updatePreview();
    if (window.__captionAutosave) window.__captionAutosave();
    if (window.__renderSuggestions) window.__renderSuggestions();
  }

  function commitEntry() {
    var fresh = parseTags(chipEntry.value);
    fresh.forEach(function (t) {
      if (tags.indexOf(t) === -1) tags.push(t);
    });
    chipEntry.value = "";
    syncTags();
  }

  if (hiddenTags && chipWrap && chipList && chipEntry) {
    tags = parseTags(hiddenTags.value);
    hiddenTags.type = "hidden";           // raw input keeps the form contract
    chipWrap.hidden = false;              // chips take over visually
    renderChips();

    chipWrap.addEventListener("click", function (e) {
      if (e.target === chipWrap || e.target === chipList) chipEntry.focus();
    });
    chipEntry.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " " || e.key === ",") {
        e.preventDefault();
        commitEntry();
      } else if (e.key === "Backspace" && chipEntry.value === "" && tags.length) {
        tags.pop();
        syncTags();
      }
    });
    chipEntry.addEventListener("blur", function () {
      if (chipEntry.value.trim()) commitEntry();
    });
  }

  // ------------------------- settings: caption styles + live preview + saves
  //
  // Sellers pick a preset card (Hype/Chill/Minimal) or Custom. Preset templates
  // travel on each card's data-template; tokens are only ever visible inside
  // the Custom editor. Preset/hashtag changes AUTO-SAVE with an inline
  // "Saved ✓" flash — no toasts on this page except real failures.

  var SAMPLE_TITLE = "🔥 $1 SQUISHIES ALL NIGHT — NONSTOP GIVEAWAYS";
  var captionInput = document.getElementById("captionTemplate");
  var previewEl = document.getElementById("caption-preview");
  var handleEl = document.getElementById("preview-handle");
  var usernameInput = document.getElementById("whatnotUsername");
  var captionsRoot = document.getElementById("captions-root");
  var settingsCsrf = (captionsRoot && captionsRoot.getAttribute("data-csrf")) ||
    (document.getElementById("whatnot-card") ? document.getElementById("whatnot-card").getAttribute("data-csrf") : "") || "";

  function currentTags() {
    return hiddenTags ? parseTags(hiddenTags.value) : [];
  }
  function currentPreset() {
    return captionsRoot ? (captionsRoot.getAttribute("data-preset") || "custom") : "custom";
  }
  function presetTemplate(key) {
    var card = document.querySelector('.preset-card[data-preset="' + key + '"]');
    return card ? (card.getAttribute("data-template") || "") : "";
  }
  function activeTemplate() {
    var p = currentPreset();
    if (p !== "custom") { var t = presetTemplate(p); if (t) return t; }
    return captionInput ? captionInput.value : "{title}\n\n{hashtags}";
  }

  function updatePreview() {
    if (!previewEl) return;
    var uname = (usernameInput && usernameInput.value.trim().replace(/^@+/, "")) || "yourhandle";
    var hashtags = currentTags().map(function (t) { return "#" + t; }).join(" ");
    var caption = activeTemplate()
      .split("{title}").join(SAMPLE_TITLE)
      .split("{hashtags}").join(hashtags)
      .split("{username}").join(uname);
    previewEl.textContent = caption.trim() || "Your caption preview appears here.";
    if (handleEl) handleEl.textContent = "@" + uname;
  }

  function flashSaved(id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.hidden = false;
    el.classList.remove("is-on"); void el.offsetWidth; el.classList.add("is-on");
    window.clearTimeout(el.__t);
    el.__t = window.setTimeout(function () { el.hidden = true; }, 1800);
  }

  function postSettings(fields) {
    var body = new URLSearchParams({ csrf: settingsCsrf });
    Object.keys(fields).forEach(function (k) { body.set(k, fields[k]); });
    return fetch("/settings", {
      method: "POST", headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" }, body: body
    }).then(function (r) { return r.json().catch(function () { return { ok: false }; }); });
  }

  // Auto-save (debounced) for preset + hashtags; template included when Custom.
  var captionSaveTimer = null;
  function autoSaveCaptions() {
    if (!captionsRoot) return;
    if (captionSaveTimer) window.clearTimeout(captionSaveTimer);
    captionSaveTimer = window.setTimeout(function () {
      captionSaveTimer = null;
      var fields = { onlyCaption: "1", captionPreset: currentPreset(), hashtags: currentTags().join(" ") };
      if (currentPreset() === "custom" && captionInput) fields.captionTemplate = captionInput.value;
      postSettings(fields).then(function (json) {
        if (json.ok) flashSaved("captions-saved");
        else toast(json.error || "Couldn't save your caption style — try again.", "error");
      }).catch(function () { toast("Couldn't save — check your connection.", "error"); });
    }, 500);
  }
  window.__captionAutosave = captionsRoot ? autoSaveCaptions : null;

  // Preset card selection.
  document.querySelectorAll(".preset-card").forEach(function (card) {
    card.addEventListener("click", function () {
      var key = card.getAttribute("data-preset");
      if (currentPreset() === key) return;
      captionsRoot.setAttribute("data-preset", key);
      document.querySelectorAll(".preset-card").forEach(function (c) {
        var on = c === card;
        c.classList.toggle("is-selected", on);
        var r = c.querySelector("input[type=radio]"); if (r) r.checked = on;
      });
      var editor = document.getElementById("custom-editor");
      if (editor) editor.hidden = key !== "custom";
      updatePreview();
      autoSaveCaptions();
    });
  });

  // Custom template editor: explicit Save button (the one save button on the page).
  var saveTemplateBtn = document.getElementById("save-template");
  if (saveTemplateBtn && captionInput) {
    captionInput.addEventListener("input", updatePreview);
    saveTemplateBtn.addEventListener("click", function () {
      saveTemplateBtn.classList.add("is-loading"); saveTemplateBtn.disabled = true;
      postSettings({ onlyCaption: "1", captionPreset: "custom", hashtags: currentTags().join(" "), captionTemplate: captionInput.value })
        .then(function (json) {
          saveTemplateBtn.classList.remove("is-loading"); saveTemplateBtn.disabled = false;
          if (json.ok) flashSaved("captions-saved");
          else toast(json.error || "Couldn't save — try again.", "error");
        })
        .catch(function () { saveTemplateBtn.classList.remove("is-loading"); saveTemplateBtn.disabled = false; toast("Couldn't save — check your connection.", "error"); });
    });
  }

  // Username save (Your Whatnot card).
  var saveUsernameBtn = document.getElementById("save-username");
  if (saveUsernameBtn && usernameInput) {
    usernameInput.addEventListener("input", updatePreview);
    saveUsernameBtn.addEventListener("click", function () {
      saveUsernameBtn.classList.add("is-loading"); saveUsernameBtn.disabled = true;
      postSettings({ onlyUsername: "1", whatnotUsername: usernameInput.value })
        .then(function (json) {
          saveUsernameBtn.classList.remove("is-loading"); saveUsernameBtn.disabled = false;
          if (json.ok) flashSaved("whatnot-saved");
          else toast(json.error || "That username doesn't look right.", "error");
        })
        .catch(function () { saveUsernameBtn.classList.remove("is-loading"); saveUsernameBtn.disabled = false; toast("Couldn't save — check your connection.", "error"); });
    });
  }

  // Token chips (Custom editor only).
  var tokenBar = document.querySelector("[data-token-target]");
  if (tokenBar && captionInput) {
    tokenBar.hidden = false;
    tokenBar.querySelectorAll("[data-token]").forEach(function (chip) {
      chip.addEventListener("click", function () {
        var token = chip.getAttribute("data-token");
        var start = captionInput.selectionStart != null ? captionInput.selectionStart : captionInput.value.length;
        var end = captionInput.selectionEnd != null ? captionInput.selectionEnd : start;
        captionInput.value = captionInput.value.slice(0, start) + token + captionInput.value.slice(end);
        var caret = start + token.length;
        captionInput.focus();
        captionInput.setSelectionRange(caret, caret);
        updatePreview();
      });
    });
  }

  // Suggested hashtags — a tiny keyword→tags map, no AI. Tap to add.
  var suggestRow = document.getElementById("suggest-tags");
  if (suggestRow && chipList) {
    var NICHES = [
      { re: /squish|sensory/, tags: ["squishy", "sensory", "squishtok", "satisfying", "squishies"] },
      { re: /card|break|tcg|pokemon|sport/, tags: ["cardbreaks", "sportscards", "pokemoncards", "tcg", "thehobby"] },
      { re: /sneak|kick|shoe/, tags: ["sneakers", "kicks", "sneakerhead", "shoegame"] },
      { re: /vintage|thrift|retro/, tags: ["vintage", "thrifted", "retrofinds", "secondhand"] },
      { re: /plush|bear|doll|toy/, tags: ["plushies", "plushtok", "collectibles", "toys"] },
    ];
    var unameStr = (suggestRow.getAttribute("data-uname") || "").toLowerCase();
    var niche = null;
    for (var ni = 0; ni < NICHES.length; ni++) { if (NICHES[ni].re.test(unameStr)) { niche = NICHES[ni].tags; break; } }
    var suggestions = ["whatnot", "liveshopping", "fyp"].concat(niche || ["smallbusiness", "unboxing", "haul", "collector"]);

    function renderSuggestions() {
      suggestRow.querySelectorAll(".chip-suggest").forEach(function (c) { c.remove(); });
      var have = currentTags();
      var shown = 0;
      suggestions.forEach(function (tag) {
        if (have.indexOf(tag) !== -1 || shown >= 8) return;
        shown++;
        var b = document.createElement("button");
        b.type = "button"; b.className = "chip chip-suggest"; b.textContent = "#" + tag;
        b.addEventListener("click", function () {
          if (tags.indexOf(tag) === -1) { tags.push(tag); syncTags(); }
          renderSuggestions();
        });
        suggestRow.appendChild(b);
      });
      suggestRow.hidden = shown === 0;
    }
    renderSuggestions();
    window.__renderSuggestions = renderSuggestions;
  }

  // Preview tabs: Instagram ↔ TikTok framing.
  var previewCard = document.querySelector(".preview-card");
  document.querySelectorAll(".preview-tab").forEach(function (tab) {
    tab.addEventListener("click", function () {
      var net = tab.getAttribute("data-net");
      document.querySelectorAll(".preview-tab").forEach(function (t) {
        var on = t === tab;
        t.classList.toggle("is-active", on); t.setAttribute("aria-pressed", String(on));
      });
      if (previewCard) previewCard.classList.toggle("show-tiktok", net === "tiktok");
      var label = document.getElementById("preview-net-label");
      if (label) label.textContent = net === "tiktok" ? "TikTok · caption" : "Instagram · Reel caption";
    });
  });

  // Pause switch (Account card) — optimistic, no toast on success.
  var pauseSwitch = document.getElementById("pause-switch");
  if (pauseSwitch) {
    var pauseCsrf = pauseSwitch.closest(".pause-card").getAttribute("data-csrf") || settingsCsrf;
    var paintPause = function (on) {
      var title = document.getElementById("pause-title");
      var copy = document.getElementById("pause-copy");
      if (title) title.textContent = on ? "ClipFlow is on" : "Paused";
      if (copy) copy.textContent = on ? "Checking and posting normally." : "Paused — nothing checks or posts until you turn this back on.";
      var pill = document.querySelector("[data-active-pill]");
      if (pill) {
        pill.className = "pill " + (on ? "pill-live" : "pill-paused");
        pill.innerHTML = on ? '<span class="pulse-dot"></span>Active' : "Paused";
      }
      var modePill = document.querySelector("[data-mode-pill]");
      if (modePill) modePill.style.display = on ? "" : "none";
    };
    pauseSwitch.addEventListener("change", function () {
      var on = pauseSwitch.checked;
      paintPause(on); // optimistic
      fetch("/settings", {
        method: "POST", headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ csrf: pauseCsrf, onlyPause: "1", enabled: on ? "1" : "0" })
      }).then(function (r) { return r.json().catch(function () { return { ok: false }; }); })
        .then(function (json) {
          if (!json.ok) { pauseSwitch.checked = !on; paintPause(!on); toast(json.error || "Couldn't change that — try again.", "error"); }
        })
        .catch(function () { pauseSwitch.checked = !on; paintPause(!on); toast("Couldn't change that — check your connection.", "error"); });
    });
  }

  updatePreview();

  // --------------------------------------------- URL query flash -> toasts

  var flashEl = document.getElementById("cf-flash");
  if (flashEl) {
    var flash = {};
    try { flash = JSON.parse(flashEl.textContent || "{}"); } catch (e) { /* ignore */ }
    var labels = { instagram: "Instagram", tiktok: "TikTok" };
    var errorMessages = {
      zernio_not_configured: "Connecting isn't switched on right now — nothing's wrong on your end. Please try again a little later.",
      zernio_plan_limit: "We've hit a temporary limit on new connections — nothing's wrong on your end. Please try again later.",
      connect_failed: "Couldn't start the connection — please try again in a moment.",
      connect_incomplete: "That didn't finish — no account came back. For Instagram, make sure it's a Business or Creator account, then try again.",
      bad_username: "That username doesn't look right — lowercase letters, numbers, dots and dashes only.",
      slow_down: "Easy does it — too many attempts at once. Give it a minute."
    };
    if (flash.connected) toast((labels[flash.connected] || flash.connected) + " connected — you're live", "success");
    if (flash.disconnected) {
      var pname = labels[flash.disconnected] || flash.disconnected;
      if (flash.partial) toast(pname + " disconnected from ClipFlow. It may take a moment to clear on " + pname + "'s side.", "info", 8000);
      else toast(pname + " disconnected everywhere.", "success");
    }
    if (flash.error) toast(errorMessages[flash.error] || flash.error, "error", 7000);
    if (flash.saved) toast("Settings saved", "success");
    if (flash.onboarded) toast("You're live. Publish a clip on your next show and watch it appear here.", "success", 7000);
    if (flash.generated) toast("Cover ready — looking sharp.", "success");
    if (flash.deleted) toast("Cover deleted", "info");
    if (flash.retried) toast("Queued for retry — the engine picks it up on the next check.", "success");
    if (flash.billing === "success") toast("You're unlocked — 1 week free starts now. No charge until it's over.", "success", 8000);
    var any = flash.connected || flash.disconnected || flash.error || flash.saved || flash.onboarded || flash.generated || flash.deleted || flash.retried || flash.billing;
    if (any) {
      var url = new URL(window.location.href);
      ["connected", "disconnected", "partial", "error", "saved", "onboarded", "generated", "deleted", "retried", "billing"].forEach(function (k) { url.searchParams.delete(k); });
      window.history.replaceState({}, "", url.pathname + url.search + url.hash);
    }
  }
})();
