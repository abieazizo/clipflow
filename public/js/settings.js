/* settings.js — switches, handle sheet, delete-account confirm gate. */
(function () {
  "use strict";
  var $ = CF.$;

  // posting on/off
  var pause = $("[data-pause-toggle]");
  if (pause) pause.addEventListener("change", function () {
    CF.jfetch("/settings", { onlyPause: "1", enabled: pause.checked ? "1" : "0" }).then(function (r) {
      if (!r.ok) { pause.checked = !pause.checked; CF.toast(r.error || "Couldn't save. Try again.", { err: true }); return; }
      CF.toast(r.enabled ? "Posting is on." : "Posting is off. Nothing posts anywhere.");
    });
  });

  // auto vs manual
  var mode = $("[data-mode-toggle]");
  if (mode) mode.addEventListener("change", function () {
    CF.jfetch("/settings", { onlyMode: "1", postingMode: mode.checked ? "auto" : "manual" }).then(function (r) {
      if (!r.ok) { mode.checked = !mode.checked; CF.toast(r.error || "Couldn't save. Try again.", { err: true }); return; }
      CF.toast(r.postingMode === "auto" ? "Posts go out on their own." : "Posts wait for you to tap Check.");
    });
  });

  // whatnot handle sheet
  var save = $("[data-handle-save]");
  if (save) save.addEventListener("click", function () {
    var input = $("[data-handle-input]");
    var errEl = $("[data-handle-error]");
    var v = (input.value || "").trim().replace(/^@+/, "").toLowerCase();
    save.classList.add("is-loading");
    save.textContent = "Saving…";
    CF.jfetch("/settings", { onlyUsername: "1", whatnotUsername: v }).then(function (r) {
      save.classList.remove("is-loading");
      save.textContent = "Save handle";
      if (!r.ok) { errEl.textContent = r.error || "That username doesn't look right."; errEl.hidden = false; return; }
      errEl.hidden = true;
      var rowVal = $('[data-sheet-open="handle"] .grow-value');
      if (rowVal) rowVal.textContent = r.whatnotUsername ? "@" + r.whatnotUsername : "Add handle";
      CF.toast(r.whatnotUsername ? "Watching @" + r.whatnotUsername + "." : "Handle cleared.");
      CF.closeSheet();
    });
  });

  // delete account: button unlocks only when the typed email matches
  var confirmInput = $("[data-delete-confirm]");
  var deleteBtn = $("[data-delete-btn]");
  if (confirmInput && deleteBtn) {
    var email = (confirmInput.getAttribute("data-email") || "").toLowerCase();
    confirmInput.addEventListener("input", function () {
      deleteBtn.disabled = confirmInput.value.trim().toLowerCase() !== email;
    });
  }
})();
