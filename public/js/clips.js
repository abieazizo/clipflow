/* clips.js — segmented filter with a sliding pill over the receipt pile. */
(function () {
  "use strict";
  var $ = CF.$, $$ = CF.$$;

  var seg = $("[data-filters]");
  if (!seg) return;
  var pill = $(".seg-pill", seg);
  var posts = $$("[data-post]");
  var emptyNote = $("[data-filter-empty]");

  function placePill(btn, animate) {
    if (!pill || !btn) return;
    if (!animate) pill.style.transition = "none";
    pill.style.width = btn.offsetWidth + "px";
    pill.style.transform = "translateX(" + (btn.offsetLeft - 3) + "px)";
    if (!animate) requestAnimationFrame(function () { pill.style.transition = ""; });
  }

  function apply(filter, animate) {
    var shown = 0;
    posts.forEach(function (p) {
      var ok = filter === "all"
        || (filter === "failed" ? p.getAttribute("data-status") === "failed"
          : p.getAttribute("data-platform") === filter);
      p.hidden = !ok;
      if (ok) shown++;
    });
    if (emptyNote) emptyNote.hidden = shown > 0;
    var activeBtn = null;
    $$("button[data-filter]", seg).forEach(function (c) {
      var on = c.getAttribute("data-filter") === filter;
      c.setAttribute("aria-pressed", String(on));
      if (on) activeBtn = c;
    });
    placePill(activeBtn, animate);
  }

  seg.addEventListener("click", function (e) {
    var chip = e.target.closest("[data-filter]");
    if (chip) apply(chip.getAttribute("data-filter"), true);
  });
  window.addEventListener("resize", function () {
    placePill(seg.querySelector('button[aria-pressed="true"]'), false);
  });

  apply(seg.getAttribute("data-start") || "all", false);
})();
