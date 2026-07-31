/* home.js — watcher ticker, manual check, first-post takeover choreography. */
(function () {
  "use strict";
  var $ = CF.$, $$ = CF.$$;

  // greeting: time-of-day + the seller's REAL Whatnot avatar and display name
  var hello = $("[data-hello-pfp]");
  if (hello) {
    var greet = $("[data-greet]");
    if (greet) {
      var h = new Date().getHours();
      greet.textContent = h < 5 ? "Up late?" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
    }
    var nameEl = $("[data-hello-name]");
    var handle = (nameEl ? nameEl.textContent : "").replace(/^@+/, "");
    if (handle) {
      var KEY = "cf_profile_" + handle;
      var apply = function (d) {
        if (!d || !d.ok || !d.exists) return;
        if (d.avatar) {
          var img = document.createElement("img");
          img.src = d.avatar; img.alt = "";
          hello.appendChild(img);
        }
        if (d.displayName && nameEl) {
          nameEl.innerHTML = "";
          nameEl.appendChild(document.createTextNode(d.displayName + " "));
          var m = document.createElement("span");
          m.className = "mono";
          m.textContent = "@" + handle;
          nameEl.appendChild(m);
        }
      };
      var cached = null;
      try { cached = JSON.parse(sessionStorage.getItem(KEY) || "null"); } catch (e) { /* ignore */ }
      if (cached) apply(cached);
      else fetch("/api/whatnot-check?u=" + encodeURIComponent(handle), { credentials: "same-origin" })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          try { sessionStorage.setItem(KEY, JSON.stringify(d)); } catch (e) { /* private mode */ }
          apply(d);
        })
        .catch(function () { /* initial letter stays */ });
    }
  }

  // desk head condenses once the page scrolls (sticky glass strip)
  var deskHead = $("[data-desk-head]");
  if (deskHead) {
    var syncHead = function () { deskHead.classList.toggle("is-condensed", window.scrollY > 24); };
    syncHead();
    window.addEventListener("scroll", syncHead, { passive: true });
  }

  // watcher ticker: elapsed since the last REAL poll, ticking every second
  var tick = $("[data-check-tick]");
  if (tick) {
    var ts = new Date(tick.getAttribute("data-ts")).getTime();
    if (!isNaN(ts)) {
      var fmt = function () {
        var s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
        tick.textContent = s < 60 ? s + "s"
          : s < 3600 ? Math.floor(s / 60) + "m " + (s % 60) + "s"
          : Math.floor(s / 3600) + "h " + Math.floor((s % 3600) / 60) + "m";
      };
      fmt();
      setInterval(fmt, 1000);
    }
  }

  // "Check for clips now" — the check console plays honest live theater:
  // each staged line states what the /check pass is REALLY doing (listing the
  // public clips page, then reading clip pages). Result lines come only from
  // the actual response — no invented progress. ON AIR keeps its capture
  // choreography; reduced-motion goes straight to the reload.
  var check = $("[data-check-now]");
  var checkConsole = $("[data-check-console]");
  var handle = (function () {
    var el = $("[data-hello-name]");
    var m = el ? el.textContent.match(/@([A-Za-z0-9._-]+)/) : null;
    return m ? m[1] : "your shop";
  })();

  function theaterLine(text, state) {
    var line = $("[data-check-line]", checkConsole);
    line.innerHTML = "";
    if (state === "spin") {
      var s = document.createElement("span");
      s.className = "check-spin";
      line.appendChild(s);
    } else if (state === "ok") {
      var g = document.createElement("span");
      g.className = "check-okmark";
      g.textContent = "✓";
      line.appendChild(g);
    }
    line.appendChild(document.createTextNode(text));
  }
  function theaterSub(text) {
    var sub = $("[data-check-subline]", checkConsole);
    sub.textContent = text;
    sub.hidden = false;
  }
  function theaterShow() {
    $("[data-check-idle]", checkConsole).hidden = true;
    $("[data-check-live]", checkConsole).hidden = false;
  }
  function theaterIdle() {
    $("[data-check-idle]", checkConsole).hidden = false;
    $("[data-check-live]", checkConsole).hidden = true;
    $("[data-check-subline]", checkConsole).hidden = true;
    $("[data-check-actions]", checkConsole).hidden = true;
  }

  if (check) check.addEventListener("click", function () {
    var onairEl = $("[data-onair-console]");
    var stage2 = null;
    var label;
    if (checkConsole) {
      theaterShow();
      theaterLine("Looking for clips on @" + handle + "…", "spin");
      stage2 = setTimeout(function () { theaterLine("Reading clip pages…", "spin"); }, 2400);
    } else {
      label = check.textContent;
      check.classList.add("is-loading");
      check.textContent = "Checking…";
    }
    CF.jfetch("/check", {}).then(function (r) {
      if (stage2) clearTimeout(stage2);
      if (!checkConsole) {
        check.classList.remove("is-loading");
        check.textContent = label;
      }

      if (r.code === "found") {
        var n = r.found || 0;
        if (checkConsole) {
          theaterLine("Found " + n + " clip" + (n === 1 ? "" : "s") + " — queued for Instagram + TikTok", "ok");
          theaterSub("Posting now — usually under two minutes. Watch it land below.");
        }
        if (onairEl && !CF.reduced) {
          onairEl.classList.add("is-capturing");
          setTimeout(function () { location.reload(); }, 2600);
        } else {
          setTimeout(function () { location.reload(); }, checkConsole ? 2200 : 2500);
        }
        return;
      }

      if (checkConsole && r.code === "none") {
        if (r.alreadyPosted > 0) {
          theaterLine("All caught up — nothing new to post", "ok");
          theaterSub("Every public clip on @" + handle + " is already out.");
        } else {
          theaterLine("No public clips on @" + handle + " yet", "");
          theaterSub("During your live: tap Clip, then flip “Make it public”. It posts from there.");
          $("[data-check-actions]", checkConsole).hidden = false;
        }
        setTimeout(theaterIdle, 8000);
        return;
      }

      if (checkConsole) theaterIdle();
      if (r.message) CF.toast(r.message, { err: !!(r.code && ["paused", "no_username", "locked", "no_connection"].indexOf(r.code) >= 0), ms: 5000 });
      if (r.code === "locked") setTimeout(function () { location.href = "/billing"; }, 1800);
    });
  });

  // auto-post toggle on the console — optimistic, plain-language sub follows
  var modeToggle = $("[data-check-console] [data-mode-toggle]");
  if (modeToggle) modeToggle.addEventListener("change", function () {
    var auto = modeToggle.checked;
    var sub = $("[data-auto-sub]");
    var apply = function (isAuto) {
      if (sub) sub.textContent = isAuto
        ? "On — checks every 5 minutes and posts new public clips by itself"
        : "Off — clips post only when you tap Check";
    };
    apply(auto);
    CF.jfetch("/settings", { onlyMode: "1", postingMode: auto ? "auto" : "manual" }).then(function (r) {
      if (!r.ok) {
        modeToggle.checked = !auto;
        apply(!auto);
        CF.toast(r.error || "Couldn't save. Try again.", { err: true });
        return;
      }
      CF.toast(auto ? "Auto-posting on." : "Auto-posting off — tap Check after your shows.");
    });
  });

  // owner preview: ?preview=capture loops the capture choreography so the
  // operator can watch the signature moment without being live. No reload.
  if (/[?&]preview=capture\b/.test(location.search)) {
    var pcEl = $("[data-onair-console]");
    if (pcEl && !CF.reduced) {
      var playCapture = function () {
        pcEl.classList.remove("is-capturing");
        void pcEl.offsetWidth; // restart the animation
        pcEl.classList.add("is-capturing");
      };
      setTimeout(playCapture, 900);
      setInterval(playCapture, 5200);
    }
  }

  // first-post takeover: receipt prints (core), stamp slams, THEN the headline
  // and buttons rise. Mark the milestone once, immediately.
  var takeover = $("[data-celebrate]");
  if (takeover) {
    CF.jfetch("/milestone", { kind: "first-post" });
    var lates = $$(".late-rise", takeover);
    var lineCount = takeover.querySelectorAll(".receipt-line, .receipt-head, .receipt-total, .receipt-code").length;
    var delay = CF.reduced ? 0 : 350 + 200 + lineCount * 60 + 900; // print delay + rise + rows + check-draw
    setTimeout(function () {
      lates.forEach(function (el) { el.classList.add("is-in"); });
    }, delay);
  }
})();
