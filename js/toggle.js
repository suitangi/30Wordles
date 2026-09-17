// Toggle — Day 4 variant of 30 Wordles.
// No letters here: the daily answer is a hidden on/off pattern across five
// toggles. Flip the toggles, guess, and the score counts how many match —
// 1 point each, 5/5 wins. Ten guesses; the tenth is your last chance.
//
// The daily pattern derives from the date (salted "toggle"), progress is
// saved to localStorage and resumes on refresh. Practice plays a random
// pattern, or a forced one via TOGGLE.practice("01101").
(function () {
  "use strict";

  var COLS = 5;
  var TURNS = 10;
  var PRAISE = ["Genius", "Magnificent", "Impressive", "Splendid", "Great",
    "Phew", "Phew", "Slick", "Got there", "Just in time"];
  var SETTLE_AT = 260; // ms before the score settles into its chip
  var SALT = "toggle";
  var STORE_KEY = "toggle-day4";
  var GAME_URL = "https://suitangi.github.io/30Wordles/days/4";

  var boardEl = document.getElementById("board");
  var turnlineEl = document.getElementById("turnline");
  var bannerEl = document.getElementById("banner");
  var toastEl = document.getElementById("toast");
  var newBtn = document.getElementById("new-btn");
  var guessBtn = document.getElementById("guess-btn");
  var shareBtn = document.getElementById("share-btn");

  var pattern = [];    // the hidden answer, 5 × 0/1
  var done = false;
  var won = false;
  var revealing = false;
  var practice = false;
  var quietRows = false; // restore flag: rebuilt rows skip enter animations
  var guesses = [];      // submitted patterns, 5 × 0/1 each
  var typed = [];        // the active row's toggle states
  var rowEls = [];
  var toastTimer = null;

  // ---------- daily puzzle ----------

  function todayKey() {
    var d = new Date();
    return d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
  }

  // Deterministic daily pattern: same for everyone, changes at midnight.
  // The plain hash's low bits are weak over date-shaped keys (only ~24 of
  // 32 patterns reachable), so the hash gets a murmur-style finalizer
  // before the pattern bits are read.
  function patternFor(key) {
    var h = 0;
    var s = SALT + key;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b) >>> 0;
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35) >>> 0;
    h ^= h >>> 16;
    var bits = [];
    for (var b = 0; b < COLS; b++) bits.push((h >>> b) & 1);
    return bits;
  }

  function patternLabel(bits) {
    return bits.map(function (b) { return b ? "ON" : "OFF"; }).join(" \u00B7 ");
  }

  function loadSaved() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)); }
    catch (e) { return null; }
  }

  function saveState() {
    if (practice) return;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        date: todayKey(),
        pattern: pattern,
        guesses: guesses,
        done: done,
        won: won
      }));
    } catch (e) { /* storage unavailable — game still playable */ }
  }

  // ---------- game state ----------

  function activeRow() { return rowEls[guesses.length]; }
  function lastChance() { return guesses.length === TURNS - 1; }
  function scoreOf(guess) {
    var s = 0;
    for (var i = 0; i < COLS; i++) if (guess[i] === pattern[i]) s++;
    return s;
  }

  function resetBoard() {
    done = false;
    won = false;
    revealing = false;
    guesses = [];
    typed = [0, 0, 0, 0, 0];
    rowEls = [];

    boardEl.innerHTML = "";
    bannerEl.classList.remove("show");
    bannerEl.textContent = "";
    shareBtn.classList.add("hidden");
    addRow();
    updateTurnline();
  }

  function addRow() {
    var row = document.createElement("div");
    row.className = "trow" + (quietRows ? " quiet" : "");
    for (var c = 0; c < COLS; c++) {
      var tog = document.createElement("button");
      tog.type = "button";
      tog.className = "tog";
      tog.setAttribute("aria-pressed", "false");
      tog.setAttribute("aria-label", "toggle " + (c + 1));
      tog.addEventListener("click", makeFlipper(c, row));
      row.appendChild(tog);
    }
    var score = document.createElement("div");
    score.className = "score";
    score.textContent = "\u00B7";
    row.appendChild(score);
    boardEl.appendChild(row);
    rowEls.push(row);
    layoutRow(row);
  }

  function makeFlipper(c, row) {
    return function () {
      if (row !== activeRow() || done || revealing) return;
      typed[c] = typed[c] ? 0 : 1;
      renderActive();
    };
  }

  // Pending rows are live toggles; scored rows are frozen history.
  function layoutRow(row) {
    var isActive = !done && row === activeRow();
    var tiles = row.children;
    for (var c = 0; c < COLS; c++) {
      tiles[c].disabled = !isActive;
      tiles[c].classList.toggle("inplay", isActive);
    }
  }

  function renderActive() {
    var row = activeRow();
    // A finished game has no active row — and the reveal row must never be
    // re-rendered from `typed`, or the answer would be wiped to off.
    if (done || !row) return;
    for (var c = 0; c < COLS; c++) {
      var t = row.children[c];
      var on = typed[c] === 1;
      t.setAttribute("aria-pressed", on ? "true" : "false");
      t.classList.toggle("on", on);
    }
  }

  // ---------- countdown ----------

  function updateTurnline() {
    if (done) {
      turnlineEl.textContent = won
        ? "Solved in " + guesses.length + " of " + TURNS
        : "Out of turns";
      turnlineEl.classList.toggle("final", won);
      return;
    }
    var turn = Math.min(guesses.length + 1, TURNS);
    if (lastChance()) {
      turnlineEl.textContent = "Guess " + turn + " of " + TURNS + " \u2014 final guess";
      turnlineEl.classList.add("final");
    } else {
      turnlineEl.textContent = "Guess " + turn + " of " + TURNS;
      turnlineEl.classList.remove("final");
    }
  }

  // ---------- submitting ----------

  function submit() {
    if (done || revealing) return;
    var row = activeRow();
    var guess = typed.slice();
    var score = scoreOf(guess);
    revealing = true;
    setTimeout(function () { settle(row, guess, score); }, SETTLE_AT);
  }

  function settle(row, guess, score) {
    var chip = row.children[COLS];
    chip.textContent = String(score);
    chip.style.setProperty("--w", String(score / COLS));
    chip.classList.add("settle");
    row.classList.remove("inplay");
    row.classList.add("scored");
    for (var c = 0; c < COLS; c++) {
      row.children[c].disabled = true;
      row.children[c].classList.remove("inplay");
    }
    guesses.push(guess);

    if (score === COLS) {
      done = true;
      won = true;
      showBanner(praise(guesses.length));
      shareBtn.classList.remove("hidden");
    } else if (guesses.length >= TURNS) {
      done = true;
      showLossBanner();
      shareBtn.classList.remove("hidden");
    } else {
      addRow();
    }
    renderActive();
    updateTurnline();
    saveState();
    revealing = false;
  }

  // The loss reveal lives in the banner: "Out of guesses" with the answer
  // rendered as small view-only toggles, right where the text was.
  function showLossBanner() {
    bannerEl.innerHTML = ""; // idempotent: rebuilds clean on restore
    var text = document.createElement("div");
    text.textContent = "Out of guesses";
    bannerEl.appendChild(text);
    var patternRow = document.createElement("div");
    patternRow.className = "banner-pattern";
    pattern.forEach(function (b) {
      var tog = document.createElement("span");
      tog.className = "tog" + (b ? " on" : "");
      tog.setAttribute("aria-pressed", b ? "true" : "false");
      patternRow.appendChild(tog);
    });
    bannerEl.appendChild(patternRow);
    bannerEl.classList.add("show");
  }

  function praise(count) {
    return PRAISE[count - 1];
  }

  // ---------- init / practice / restore ----------

  function init() {
    practice = false;
    newBtn.textContent = "Practice";
    var key = todayKey();
    var saved = loadSaved();
    if (saved && saved.date === key && saved.pattern &&
        saved.pattern.length === COLS) {
      pattern = saved.pattern;
      quietRows = true;
      resetBoard();
      restore(saved);
      quietRows = false;
    } else {
      pattern = patternFor(key);
      resetBoard();
      saveState();
    }
  }

  // Optional "10110"-style argument forces the practice pattern (debugging).
  function startPractice(forced) {
    practice = true;
    if (/^[01]{5}$/.test(forced)) {
      pattern = forced.split("").map(Number);
    } else {
      pattern = [0, 0, 0, 0, 0].map(function () {
        return Math.random() < 0.5 ? 0 : 1;
      });
    }
    resetBoard();
    newBtn.textContent = "Today\u2019s puzzle";
    showBanner("Practice round");
  }

  // Replay saved guesses with no animation — settle() replays each score
  // and rebuilds a finished loss's reveal row naturally.
  function restore(saved) {
    guesses = [];
    saved.guesses.forEach(function (g) {
      var row = activeRow(); // the waiting empty row
      typed = g;
      renderActive();
      settle(row, g, scoreOf(g));
    });
    typed = [0, 0, 0, 0, 0];
    renderActive();
  }

  // ---------- feedback ----------

  function showBanner(msg) {
    bannerEl.textContent = msg;
    bannerEl.classList.add("show");
  }

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove("show");
    }, 1600);
  }

  // ---------- share ----------

  // Spoiler-free: scores only, never the patterns — a shared losing game
  // must not hand over the answer.
  function share() {
    var title = ["Toggle", practice ? "practice" : todayKey(),
      (won ? guesses.length : "X") + "/" + TURNS].join(" \u00B7 ");
    var lines = [title, GAME_URL];
    guesses.forEach(function (g, i) {
      lines.push((i + 1) + ". " + scoreOf(g) + "/" + COLS);
    });
    copyText(lines.join("\n"));
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () { toast("Copied to clipboard"); },
        function () { fallbackCopy(text); }
      );
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      toast("Copied to clipboard");
    } catch (e) {
      toast("Could not copy");
    }
    ta.remove();
  }

  // ---------- wiring ----------

  window.addEventListener("keydown", function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "Enter") {
      // Never double-fire while a button holds focus — the browser will
      // activate it too.
      if (!e.target || e.target.tagName !== "BUTTON") submit();
    }
  });

  newBtn.addEventListener("click", function () {
    newBtn.blur();
    if (practice) init(); else startPractice();
  });
  guessBtn.addEventListener("click", function () {
    guessBtn.blur();
    submit();
  });
  shareBtn.addEventListener("click", function () {
    shareBtn.blur();
    share();
  });

  init();

  // Bug reports & debugging: TOGGLE.dump() replays the game on screen;
  // TOGGLE.practice("01101") forces a practice pattern.
  function dump() {
    var out = [
      "Toggle debug dump",
      "mode: " + (practice ? "practice" : "daily"),
      "pattern: " + patternLabel(pattern),
      "done: " + done + ", won: " + won
    ];
    guesses.forEach(function (g, i) {
      out.push((i + 1) + ". " + g.join("") + "  " + scoreOf(g) + "/" + COLS);
    });
    out.push("turns: " + guesses.length + "/" + TURNS);
    if (!practice) {
      var saved = loadSaved();
      out.push("raw save: " + (saved ? JSON.stringify(saved) : "none"));
    }
    return out.join("\n");
  }

  // Small console/test surface.
  window.TOGGLE = {
    daily: init,
    practice: startPractice,
    todayKey: todayKey,
    patternFor: patternFor,
    dump: dump
  };
})();
