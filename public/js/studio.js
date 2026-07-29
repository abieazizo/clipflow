/* studio.js — make a cover: generate → pick → save. Delete with arm-to-confirm. */
(function () {
  "use strict";
  var $ = CF.$, $$ = CF.$$;

  var form = $("[data-studio-form]");
  if (!form) return;
  form.setAttribute("data-js-form", "1");

  var loading = $("[data-studio-loading]");
  var statusEl = $("[data-studio-status]");
  var resultEl = $("[data-studio-result]");
  var quota = $("[data-quota-num]") || $(".quota-line .mono");
  var style = "hype";
  var statusTimer = null;
  var LINES = ["sketching…", "lettering…", "laying the colors…", "checking it reads…"];

  $$(".style-btn").forEach(function (b) {
    b.addEventListener("click", function () {
      style = b.getAttribute("data-style");
      $$(".style-btn").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
    });
  });

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function setBusy(busy) {
    loading.hidden = !busy;
    form.hidden = busy;
    if (busy) {
      var i = 0;
      statusEl.textContent = LINES[0];
      statusTimer = setInterval(function () { i = (i + 1) % LINES.length; statusEl.textContent = LINES[i]; }, 2600);
    } else if (statusTimer) {
      clearInterval(statusTimer); statusTimer = null;
    }
  }

  function showResult(ids) {
    resultEl.innerHTML = "";
    resultEl.hidden = false;
    resultEl.classList.remove("is-on");
    requestAnimationFrame(function () { requestAnimationFrame(function () { resultEl.classList.add("is-on"); }); });
    var pick = el("div", "cover-pick");
    ids.forEach(function (id) {
      var fig = el("figure");
      var img = el("img");
      img.src = "/thumb-gen/" + id + ".webp?t=" + Date.now();
      img.alt = "Cover option";
      var keep = el("button", "btn btn-small", "Save this one");
      keep.type = "button";
      keep.addEventListener("click", function () {
        keep.classList.add("is-loading");
        keep.textContent = "Saving…";
        CF.jfetch("/thumbnails/keep/" + id, {}).then(function (r) {
          if (!r.ok) { CF.toast(r.error || "Couldn't save. Try again.", { err: true }); keep.classList.remove("is-loading"); keep.textContent = "Save this one"; return; }
          CF.toast("Saved to your covers.");
          location.reload();
        });
      });
      fig.appendChild(img); fig.appendChild(keep);
      pick.appendChild(fig);
    });
    resultEl.appendChild(pick);
    var again = el("button", "btn btn-quiet", "Make another");
    again.type = "button";
    again.addEventListener("click", function () { resultEl.hidden = true; form.hidden = false; });
    resultEl.appendChild(again);
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var headline = (form.querySelector('[name="headline"]').value || "").trim();
    if (!headline) return;
    resultEl.hidden = true;
    setBusy(true);
    CF.jfetch("/thumbnails/generate", {
      style: style, headline: headline, subject: headline, layout: "wall", useClip: "0",
    }).then(function (r) {
      setBusy(false);
      if (!r.ok) {
        CF.toast(r.error || "Couldn't generate. Try a shorter title.", { err: true, ms: 5000 });
        return;
      }
      if (quota && typeof r.left === "number") {
        quota.textContent = quota.hasAttribute("data-quota-num")
          ? String(r.left)
          : r.left + " of " + quota.textContent.split(" of ")[1];
      }
      form.hidden = true; // the pick is the one action now; "Make another" brings the form back
      showResult(r.variations);
    });
  });

  // delete: first tap arms, second tap deletes
  $$("[data-cover-del]").forEach(function (btn) {
    var t = null;
    btn.addEventListener("click", function () {
      if (!btn.classList.contains("is-armed")) {
        btn.classList.add("is-armed");
        btn.setAttribute("aria-label", "Tap again to delete");
        t = setTimeout(function () { btn.classList.remove("is-armed"); }, 2600);
        return;
      }
      clearTimeout(t);
      var id = btn.getAttribute("data-cover-del");
      CF.jfetch("/thumbnails/delete/" + id, {}).then(function (r) {
        if (!r.ok) { CF.toast(r.error || "Couldn't delete it. Try again.", { err: true }); return; }
        var fig = btn.closest("figure");
        if (fig) fig.remove();
        CF.toast("Cover deleted.");
      });
    });
  });
})();
