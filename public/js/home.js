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

  // "Check for clips now" — when a clip is really found while ON AIR, play the
  // capture choreography on the live console (clip → lanes → printed receipt)
  // before reloading. Reduced-motion goes straight to the reload.
  var check = $("[data-check-now]");
  if (check) check.addEventListener("click", function () {
    var label = check.textContent;
    check.classList.add("is-loading");
    check.textContent = "Checking…";
    CF.jfetch("/check", {}).then(function (r) {
      check.classList.remove("is-loading");
      check.textContent = label;
      if (r.message) CF.toast(r.message, { err: !!(r.code && ["paused", "no_username", "locked", "no_connection"].indexOf(r.code) >= 0), ms: 5000 });
      if (r.code === "found") {
        var consoleEl = $("[data-onair-console]");
        if (consoleEl && !CF.reduced) {
          consoleEl.classList.add("is-capturing");
          setTimeout(function () { location.reload(); }, 2600);
        } else {
          setTimeout(function () { location.reload(); }, 2500);
        }
      }
      if (r.code === "locked") setTimeout(function () { location.href = "/billing"; }, 1800);
    });
  });

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
