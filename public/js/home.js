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

  // "Check for clips now" — a NARRATED live console. Every line on a real run
  // states what the /check pass genuinely does (list the public clips page →
  // read clip pages → hand to Instagram/TikTok); results come only from the
  // real response. The one exception is the clearly-labeled first-run DEMO
  // (zero posts ever, nothing found): sample data, posts nothing, teaches the
  // loop. Reduced-motion jumps straight to end states.
  var check = $("[data-check-now]");
  var checkConsole = $("[data-check-console]");
  var demoEligible = Boolean(checkConsole && checkConsole.hasAttribute("data-demo"));
  var consolePlatforms = checkConsole
    ? (checkConsole.getAttribute("data-platforms") || "").split(",").filter(Boolean)
    : [];
  var handle = (function () {
    var el = $("[data-hello-name]");
    var m = el ? el.textContent.match(/@([A-Za-z0-9._-]+)/) : null;
    return m ? m[1] : "your shop";
  })();
  var platformName = { ig: "Instagram", tt: "TikTok" };

  function linesBox() { return $("[data-check-lines]", checkConsole); }
  function clearLines() {
    linesBox().innerHTML = "";
    var rec = $("[data-check-receipt]", checkConsole);
    rec.hidden = true; rec.innerHTML = "";
  }
  function addLine(text, state, demo) {
    var line = document.createElement("p");
    line.className = "check-line mono is-in";
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
    if (demo) {
      var d = document.createElement("span");
      d.className = "demo-chip";
      d.textContent = "DEMO";
      line.appendChild(d);
    }
    linesBox().appendChild(line);
    return line;
  }
  function completeLine(line, text) {
    line.innerHTML = "";
    var g = document.createElement("span");
    g.className = "check-okmark";
    g.textContent = "✓";
    line.appendChild(g);
    line.appendChild(document.createTextNode(text));
    return line;
  }
  function theaterSub(text) {
    var sub = $("[data-check-subline]", checkConsole);
    sub.textContent = text;
    sub.hidden = false;
  }
  function theaterShow() {
    $("[data-check-idle]", checkConsole).hidden = true;
    $("[data-check-live]", checkConsole).hidden = false;
    clearLines();
    $("[data-check-subline]", checkConsole).hidden = true;
    $("[data-check-actions]", checkConsole).hidden = true;
  }
  function theaterIdle() {
    $("[data-check-idle]", checkConsole).hidden = false;
    $("[data-check-live]", checkConsole).hidden = true;
  }

  // sequential narration: [text, holdMs] steps; each completes to ✓ before the
  // next appears. Reduced-motion renders every step complete at once.
  function narrate(steps, demo, done) {
    if (CF.reduced) {
      steps.forEach(function (st) { addLine(st[0], "ok", demo); });
      if (done) done();
      return;
    }
    var i = 0;
    var run = function () {
      if (i >= steps.length) { if (done) done(); return; }
      var st = steps[i];
      var line = addLine(st[0], "spin", demo);
      setTimeout(function () {
        completeLine(line, st[0]);
        if (demo) {
          var d = document.createElement("span");
          d.className = "demo-chip";
          d.textContent = "DEMO";
          line.appendChild(d);
        }
        i++;
        run();
      }, st[1]);
    };
    run();
  }

  function demoReceipt() {
    var rec = $("[data-check-receipt]", checkConsole);
    rec.innerHTML = "";
    var rows = [
      ["Your clip", "9:41", "DEMO"],
      ["Posted — Instagram Reels", "9:42", "✓"],
      ["Posted — TikTok", "9:42", "✓"],
    ];
    rows.forEach(function (r0, idx) {
      var row = document.createElement("div");
      row.className = "cr-row";
      row.style.setProperty("--i", String(idx));
      var t = document.createElement("span");
      t.className = "cr-time mono"; t.textContent = r0[1];
      var w = document.createElement("span");
      w.className = "cr-what"; w.textContent = r0[0];
      var m = document.createElement("span");
      m.className = "cr-mark mono" + (r0[2] === "✓" ? " is-ok" : ""); m.textContent = r0[2];
      row.appendChild(t); row.appendChild(w); row.appendChild(m);
      rec.appendChild(row);
    });
    var note = document.createElement("p");
    note.className = "cr-note mono";
    note.textContent = "DEMO — nothing was posted";
    rec.appendChild(note);
    rec.hidden = false;
    requestAnimationFrame(function () { rec.classList.add("is-on"); });
  }

  function runCheck(fromAuto) {
    var onairEl = $("[data-onair-console]");
    var lookLine = null;
    if (checkConsole && !fromAuto) {
      theaterShow();
      lookLine = addLine("Looking on Whatnot @" + handle + "…", "spin");
    } else if (check && !checkConsole && !fromAuto) {
      var label = check.textContent;
      check.classList.add("is-loading");
      check.textContent = "Checking…";
    }

    CF.jfetch("/check", {}).then(function (r) {
      if (check && !checkConsole && !fromAuto) {
        check.classList.remove("is-loading");
        check.textContent = label;
      }

      if (r.code === "found") {
        var n = r.found || 0;
        if (checkConsole && !fromAuto) {
          completeLine(lookLine, "Found " + n + " new clip" + (n === 1 ? "" : "s"));
          var steps = [];
          consolePlatforms.forEach(function (p) {
            steps.push(["Uploading to " + (platformName[p] || p) + "…", 950]);
          });
          narrate(steps, false, function () {
            addLine("Posted — live on " + (consolePlatforms.length > 1 ? "Reels + TikTok" : platformName[consolePlatforms[0]] || "your page") + " in about a minute", "ok");
            theaterSub("Watch it land below.");
            setTimeout(function () { location.reload(); }, CF.reduced ? 700 : 1700);
          });
          return;
        }
        if (onairEl && !CF.reduced) {
          onairEl.classList.add("is-capturing");
          setTimeout(function () { location.reload(); }, 2600);
        } else {
          setTimeout(function () { location.reload(); }, 2200);
        }
        return;
      }

      if (checkConsole && !fromAuto && r.code === "none") {
        if (demoEligible && !(r.alreadyPosted > 0)) {
          // FIRST-RUN DEMO: nothing real to show yet — teach the loop with
          // clearly-labeled sample data. Posts nothing.
          completeLine(lookLine, "No clips yet — here's what WILL happen");
          lookLine.appendChild((function () { var d = document.createElement("span"); d.className = "demo-chip"; d.textContent = "DEMO"; return d; })());
          narrate([
            ["Found 1 new clip", 800],
            ["Uploading to Instagram…", 950],
            ["Uploading to TikTok…", 950],
          ], true, function () {
            addLine("Posted — Reels + TikTok", "ok", true);
            demoReceipt();
            theaterSub("That's the whole job. Go live, clip, make it public — and this happens for real.");
            setTimeout(theaterIdle, 22000);
          });
          return;
        }
        if (r.alreadyPosted > 0) {
          completeLine(lookLine, "All caught up — nothing new to post");
          theaterSub("Every public clip on @" + handle + " is already out.");
        } else {
          completeLine(lookLine, "Nothing new yet");
          lookLine.querySelector(".check-okmark").textContent = "·";
          theaterSub("Clip during your live, make it public, and tap Check again.");
          $("[data-check-actions]", checkConsole).hidden = false;
        }
        setTimeout(theaterIdle, 9000);
        return;
      }

      if (checkConsole && !fromAuto) theaterIdle();
      if (!fromAuto && r.message) CF.toast(r.message, { err: !!(r.code && ["paused", "no_username", "locked", "no_connection"].indexOf(r.code) >= 0), ms: 5000 });
      if (r.code === "locked" && !fromAuto) setTimeout(function () { location.href = "/billing"; }, 1800);
    });
  }

  if (check) check.addEventListener("click", function () { runCheck(false); });

  // ON AIR + auto mode: the console checks by itself in the background and
  // posts as clips appear — hands-off, exactly like the engine, just sooner.
  var onairAuto = $("[data-onair-console][data-auto=\"1\"]");
  if (onairAuto && !/[?&]preview=/.test(location.search)) {
    setInterval(function () {
      if (document.visibilityState === "visible") runCheck(true);
    }, 180000);
  }

  // auto-post toggle on the console — optimistic, consequences in plain words
  var modeToggle = $("[data-check-console] [data-mode-toggle]");
  if (modeToggle) modeToggle.addEventListener("change", function () {
    var auto = modeToggle.checked;
    var sub = $("[data-auto-sub]");
    var apply = function (isAuto) {
      if (sub) sub.textContent = isAuto
        ? "On — the moment you clip, it posts itself to Reels + TikTok"
        : "Off — clips wait here until you tap Check";
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
