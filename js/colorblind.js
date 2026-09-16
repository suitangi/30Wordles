// Colorblind (high-contrast) marks toggle — shared by every game page.
// Swaps the green/yellow mark palette for orange/blue via
// [data-colorblind="on"] on <html> (see the CSS overrides in styles.css).
// Persisted in localStorage next to the theme, applied pre-paint by each
// page's inline boot script so there's no flash of wrong-colored marks.
(function () {
  "use strict";

  var KEY = "30wordles-colorblind";
  var btn = document.getElementById("cb-toggle");
  if (!btn) return;

  function apply() {
    var on = document.documentElement.dataset.colorblind === "on";
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  }

  btn.addEventListener("click", function () {
    btn.blur();
    var on = document.documentElement.dataset.colorblind === "on";
    if (on) delete document.documentElement.dataset.colorblind;
    else document.documentElement.dataset.colorblind = "on";
    try {
      localStorage.setItem(KEY, on ? "" : "on");
    } catch (e) { /* storage unavailable — toggle still works this session */ }
    apply();
  });

  apply();
})();
