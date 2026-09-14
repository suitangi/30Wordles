// Theme toggle: <html data-theme> is set pre-paint by an inline snippet in
// each page; this only wires the button and persists the choice.
(function () {
  var KEY = "30wordles-theme";
  var root = document.documentElement;

  function apply(theme) {
    root.dataset.theme = theme;
  }

  var buttons = document.querySelectorAll(".theme-toggle");
  buttons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      var next = root.dataset.theme === "dark" ? "light" : "dark";
      apply(next);
      try { localStorage.setItem(KEY, next); } catch (e) { /* private mode */ }
    });
  });
})();
