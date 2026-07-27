/* wizard.js — step-2 proof: confirm the REAL account (PFP + name), with
   distinct not-found / no-clips / unreachable outcomes. */
(function () {
  "use strict";
  var $ = CF.$;

  var proofRoot = $("[data-wiz-proof]");
  if (!proofRoot) return;

  var uname = proofRoot.getAttribute("data-handle");
  var loading = $("[data-proof-loading]", proofRoot);
  var found = $("[data-proof-found]", proofRoot);
  var empty = $("[data-proof-empty]", proofRoot);
  var notfound = $("[data-proof-notfound]", proofRoot);
  var errored = $("[data-proof-error]", proofRoot);
  var actConfirm = $("[data-proof-actions]", proofRoot);
  var actRetry = $("[data-proof-retry]", proofRoot);
  var actContinue = $("[data-proof-continue]", proofRoot);

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function profileInto(zone, r) {
    if (!zone) return;
    if (r.avatar) {
      var img = el("img"); img.src = r.avatar; img.alt = "";
      zone.appendChild(img);
    } else {
      zone.appendChild(el("span", "pfp-fallback", uname.charAt(0).toUpperCase()));
    }
    if (r.displayName) zone.appendChild(el("p", "found-name", r.displayName));
    zone.appendChild(el("p", "found-handle mono", "@" + uname));
  }

  fetch("/api/handle-clips?u=" + encodeURIComponent(uname), { credentials: "same-origin" })
    .then(function (r) { return r.json(); })
    .catch(function () { return { ok: false }; })
    .then(function (r) {
      loading.hidden = true;

      if (!r || !r.ok) {
        // Whatnot unreachable — honestly "couldn't check", never "fake"
        errored.hidden = false;
        actContinue.hidden = false;
        return;
      }
      if (!r.exists) {
        notfound.hidden = false;
        actRetry.hidden = false;
        return;
      }
      if (!r.clips || !r.clips.length) {
        empty.hidden = false;
        profileInto($("[data-proof-profile-empty]", proofRoot), r);
        actConfirm.hidden = false;
        return;
      }

      found.hidden = false;
      actConfirm.hidden = false;
      profileInto($("[data-proof-profile]", proofRoot), r);

      var zone = $("[data-proof-receipt]", proofRoot);
      var sleeve = el("div", "will-print");
      var paper = el("div", "receipt-paper");
      var rc = el("div", "receipt");
      r.clips.slice(0, 3).forEach(function (c, i) {
        var line = el("div", "receipt-line" + (c.thumb ? " has-thumb" : ""));
        line.style.setProperty("--i", String(i));
        if (c.thumb) {
          var wrap = el("span", "receipt-thumb");
          wrap.appendChild(el("span", "icon-slot"));
          var im = el("img"); im.src = c.thumb; im.alt = "";
          window.cfWatchThumb(im);
          wrap.appendChild(im);
          line.appendChild(wrap);
        } else {
          line.appendChild(el("span", "receipt-time", ""));
        }
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
      zone.appendChild(sleeve);
      requestAnimationFrame(function () { window.cfPrint(sleeve); });
    });
})();
