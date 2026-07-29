/* landing.js — landing atmosphere/motion + dock, autoplaying demo clip, and the
   live handle check. The server-talking handle-check fetch is unchanged; the
   additions (nav frost, aurora parallax, magnetic CTA) are all reduced-motion
   gated and purely visual. */
(function () {
  "use strict";
  var $ = CF.$, $$ = CF.$$;

  // --- nav: frost/translucent once the page scrolls ---------------------------
  var nav = $("[data-land-nav]");
  if (nav) {
    var syncNav = function () { nav.classList.toggle("is-stuck", window.scrollY > 8); };
    syncNav();
    window.addEventListener("scroll", syncNav, { passive: true });
  }

  // --- aurora parallax: the two blooms drift as you scroll (rMotion-gated) -----
  if (!CF.reduced) {
    var auroras = $$("[data-aurora]");
    if (auroras.length) {
      var ticking = false;
      var moveAuroras = function () {
        var y = window.scrollY;
        auroras.forEach(function (a) {
          var depth = a.getAttribute("data-aurora") === "1" ? 0.06 : -0.09;
          a.style.transform = "translate3d(0," + (y * depth).toFixed(1) + "px,0)";
        });
        ticking = false;
      };
      window.addEventListener("scroll", function () {
        if (!ticking) { ticking = true; requestAnimationFrame(moveAuroras); }
      }, { passive: true });
    }

    // --- magnetic CTA: primary buttons ease toward the pointer (fine pointers) -
    if (window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
      $$(".btn:not(.btn-quiet)").forEach(function (btn) {
        btn.addEventListener("pointermove", function (e) {
          var r = btn.getBoundingClientRect();
          var mx = (e.clientX - r.left - r.width / 2) / r.width;
          var my = (e.clientY - r.top - r.height / 2) / r.height;
          btn.style.transform = "translate(" + (mx * 6).toFixed(1) + "px," + (my * 5 - 2).toFixed(1) + "px)";
        });
        btn.addEventListener("pointerleave", function () { btn.style.transform = ""; });
      });
    }
  }

  // --- sticky dock: appears after the hero CTA scrolls past, hides at final CTA
  var dock = $("[data-dock]");
  var heroCta = $(".land-cta");
  var finalCta = $(".land-final");
  if (dock && heroCta && "IntersectionObserver" in window) {
    dock.hidden = false;
    var pastHero = false, atFinal = false;
    var update = function () { dock.classList.toggle("is-shown", pastHero && !atFinal); };
    new IntersectionObserver(function (entries) {
      var en = entries[0];
      pastHero = !en.isIntersecting && en.boundingClientRect.bottom < 0;
      update();
    }, { threshold: 0 }).observe(heroCta);
    if (finalCta) new IntersectionObserver(function (entries) {
      atFinal = entries[0].isIntersecting;
      update();
    }, { threshold: 0.2 }).observe(finalCta);
  }

  // demo clip: autoplays muted; paused offscreen, resumed in view.
  // Reduced-motion users get the poster, not a moving image.
  var video = $("[data-clip-video]");
  if (video) {
    if (CF.reduced) {
      video.removeAttribute("autoplay");
      video.pause();
    } else if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        var en = entries[0];
        if (en.isIntersecting) video.play().catch(function () { /* poster stays */ });
        else video.pause();
      }, { threshold: 0.25 }).observe(video);
    }
  }

  // --- the hook: check a real handle, their clips turn on a stage -------------
  var form = $("[data-handle-check]");
  var result = $("[data-handle-result]");
  if (!form || !result) return;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function floatPanel() {
    return el("div", "handle-float");
  }

  function skeletonPanel() {
    var panel = floatPanel();
    var skels = el("div", "stage-skels");
    for (var i = 0; i < 3; i++) skels.appendChild(el("div", "skeleton"));
    panel.appendChild(skels);
    panel.classList.add("is-on");
    return panel;
  }

  function receiptPreview(clips) {
    var sleeve = el("div", "will-print");
    var paper = el("div", "receipt-paper");
    var rc = el("div", "receipt");
    var head = el("div", "receipt-head");
    head.style.setProperty("--i", "0");
    head.appendChild(el("span", "", "What last night would've looked like"));
    rc.appendChild(head);
    clips.slice(0, 3).forEach(function (c, i) {
      var line = el("div", "receipt-line no-time");
      line.style.setProperty("--i", String(i + 1));
      var what = el("span", "receipt-what");
      var row = el("span", "fact-row");
      row.appendChild(el("span", "what", c.title || "Your clip"));
      row.appendChild(el("span", "status-word sw-faint", "AUTO"));
      what.appendChild(row);
      what.appendChild(el("span", "who mono", "Instagram Reels · TikTok"));
      line.appendChild(what);
      rc.appendChild(line);
    });
    paper.appendChild(rc);
    sleeve.appendChild(paper);
    return sleeve;
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var input = form.querySelector('input[name="u"]');
    var btn = form.querySelector("button");
    var u = (input.value || "").trim().replace(/^@+/, "").toLowerCase();
    if (!u) { input.focus(); return; }

    btn.classList.add("is-loading");
    btn.textContent = "Looking…";
    result.hidden = false;
    result.innerHTML = "";
    result.appendChild(skeletonPanel());

    fetch("/api/handle-clips?u=" + encodeURIComponent(u), { credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .catch(function () { return { ok: false }; })
      .then(function (r) {
        btn.classList.remove("is-loading");
        btn.textContent = "Show me";
        result.innerHTML = "";

        if (!r || !r.ok) {
          result.appendChild(el("p", "field-error", "Couldn't reach Whatnot right now — try again in a minute."));
          return;
        }
        if (!r.exists) {
          result.appendChild(el("p", "field-error", "Couldn't find @" + u + " on Whatnot. Check the spelling."));
          return;
        }

        var panel = floatPanel();

        var prof = el("div", "handle-profile");
        if (r.avatar) {
          var img = el("img");
          img.src = r.avatar; img.alt = "";
          prof.appendChild(img);
        }
        var who = el("div");
        if (r.displayName) who.appendChild(el("p", "", r.displayName));
        who.appendChild(el("p", "mono sub", "@" + u));
        prof.appendChild(who);
        panel.appendChild(prof);

        if (!r.clips || !r.clips.length) {
          panel.appendChild(el("p", "sub", "No public clips found. If you’ve clipped before, make them public on Whatnot — then try me."));
          result.appendChild(panel);
          requestAnimationFrame(function () { panel.classList.add("is-on"); });
          return;
        }

        var row = el("div", "clips-row");
        r.clips.slice(0, 3).forEach(function (c) {
          if (!c.thumb) return;
          var im = el("img");
          im.src = c.thumb; im.alt = c.title || "Clip"; im.loading = "lazy";
          window.cfWatchThumb(im);
          im.addEventListener("error", function () { im.remove(); });
          row.appendChild(im);
        });
        if (row.children.length) panel.appendChild(row);

        var sleeve = receiptPreview(r.clips);
        panel.appendChild(sleeve);
        result.appendChild(panel);

        var cta = el("a", "btn btn-block", "Try it on your next show");
        cta.href = "/signup";
        cta.style.marginTop = "var(--s-4)";
        result.appendChild(cta);

        // turn the stage on, then print their receipt
        requestAnimationFrame(function () {
          panel.classList.add("is-on");
          setTimeout(function () { window.cfPrint(sleeve); }, CF.reduced ? 0 : 350);
        });
      });
  });
})();
