// Hustle — Day 10 variant of 30 Wordles.
// One puzzle per day: the answer derives from the calendar date and
// progress is saved to localStorage, so a refresh resumes the same game.
// Practice mode plays a random word without touching the daily save.
//
// A normal Wordle with UNLIMITED guesses, played against the clock. The
// timer starts the instant the first valid word is submitted (typing and
// rejected attempts are free) and stops when the word is yours — the time
// is the entire score, and the only thing the share carries. Give up is
// the one loss.
//
// The clock banks its elapsed time into the save on every submit, so a
// refresh costs nothing; on restore a live run resumes ticking from the
// banked time. Time with the tab closed doesn't count.
//
// The reveal is Bundle's flip language compressed — in a speedrun, reveal
// time is clock time, so flips start sooner, stagger tighter and turn
// faster (color still lands at the half-turn).
(function () {
  "use strict";

  var COLS = 5;
  var SALT = "hustle"; // daily hash salt — each variant salts its own way
  var FLIP_START = 50;    // ms before the first tile flips
  var FLIP_STAGGER = 120; // ms between tile flips
  var FLIP_MID = 150;     // half-turn of the 0.3s hustle flip: color lands here
  var FLIP_TAIL = 100;    // settle before input unlocks
  var STORE_KEY = "hustle-day10";
  var GAME_URL = "https://suitangi.github.io/30Wordles/days/10";
  var PRAISE = ["Genius", "Magnificent", "Impressive", "Splendid", "Great",
    "Phew"];

  var ANSWERS = window.WORD_LISTS.answers;
  var DICTIONARY = new Set(window.WORD_LISTS.guesses);

  var boardEl = document.getElementById("board");
  var keyboardEl = document.getElementById("keyboard");
  var clockEl = document.getElementById("clock");
  var clockHintEl = document.getElementById("clock-hint");
  var bannerEl = document.getElementById("banner");
  var toastEl = document.getElementById("toast");
  var newBtn = document.getElementById("new-btn");
  var giveUpBtn = document.getElementById("giveup-btn");
  var shareBtn = document.getElementById("share-btn");

  var answer = "";
  var done = false;
  var won = false;
  var gaveUp = false;
  var revealing = false;
  var practice = false;
  var quietRows = false; // restore flag: rebuilt rows skip enter animations
  var guesses = [];      // submitted words, in order — plain strings
  var typed = [];        // the active row's letters
  var rowEls = [];       // rowEls[r] — .hrow of five tiles
  var keyEls = {};       // letter -> key button
  var toastTimer = null;

  // The clock: elapsedMs is the banked time (persisted), startedAt is the
  // live anchor while running. nowElapsed() is the truth either way.
  var elapsedMs = 0;
  var running = false;
  var startedAt = 0;
  var ticker = null;

  // ---------- daily puzzle ----------

  function todayKey() {
    var d = new Date();
    return d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
  }

  function answerFor(key) {
    var h = 0;
    var s = SALT + key;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return ANSWERS[h % ANSWERS.length];
  }

  function validAnswer(w) {
    return typeof w === "string" && DICTIONARY.has(w);
  }

  function validSave(saved) {
    if (!saved || saved.date !== todayKey() || !validAnswer(saved.answer)) {
      return false;
    }
    if (!Array.isArray(saved.guesses) ||
        !saved.guesses.every(function (w) {
          return typeof w === "string" && w.length === COLS &&
            DICTIONARY.has(w);
        })) {
      return false;
    }
    return typeof saved.elapsedMs === "number" &&
      isFinite(saved.elapsedMs) && saved.elapsedMs >= 0;
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
        answer: answer,
        guesses: guesses,
        elapsedMs: nowElapsed(),
        done: done,
        won: won,
        gaveUp: gaveUp
      }));
    } catch (e) { /* storage unavailable — game still playable */ }
  }

  // ---------- the clock ----------

  function nowElapsed() {
    return elapsedMs + (running ? Date.now() - startedAt : 0);
  }

  // M:SS.T — minutes unbounded, seconds zero-padded, tenths. The clock's
  // whole public language (display, banner, share) is this one format.
  function formatTime(ms) {
    ms = Math.max(0, Math.floor(ms));
    var m = Math.floor(ms / 60000);
    var s = Math.floor((ms % 60000) / 1000);
    var t = Math.floor((ms % 1000) / 100);
    return m + ":" + String(s).padStart(2, "0") + "." + t;
  }

  function renderClock(ms) {
    clockEl.textContent = formatTime(ms);
  }

  function startClock() {
    if (running || done) return;
    running = true;
    startedAt = Date.now();
    clockEl.classList.add("running");
    clockHintEl.classList.add("hidden");
    ticker = setInterval(function () { renderClock(nowElapsed()); }, 100);
  }

  // Freeze: bank the elapsed time and leave it on the clock.
  function stopClock() {
    if (running) {
      elapsedMs = nowElapsed();
      running = false;
      startedAt = 0;
      clearInterval(ticker);
      ticker = null;
      clockEl.classList.remove("running");
    }
    renderClock(elapsedMs);
  }

  // Bank time up to now without stopping — keeps the save current at every
  // submit so a refresh never rewinds the clock.
  function bankClock() {
    if (running) {
      elapsedMs = nowElapsed();
      startedAt = Date.now();
    }
  }

  // ---------- board ----------

  function activeRow() { return rowEls[guesses.length]; }

  function resetBoard() {
    done = false;
    won = false;
    gaveUp = false;
    revealing = false;
    guesses = [];
    typed = Array(COLS).fill("");
    rowEls = [];

    stopClock(); // banks any live run first — then the reset zeroes it
    elapsedMs = 0;
    renderClock(elapsedMs);
    clockEl.classList.remove("done");
    clockHintEl.classList.remove("hidden");

    boardEl.innerHTML = "";
    boardEl.classList.remove("overflowing");
    bannerEl.classList.remove("show");
    bannerEl.textContent = "";
    shareBtn.classList.add("hidden");
    updateActions();

    addRow();
    buildKeyboard();
  }

  // Rows are built on demand — the board grows for as long as it takes.
  function addRow() {
    var row = document.createElement("div");
    row.className = quietRows ? "hrow quiet" : "hrow";
    for (var c = 0; c < COLS; c++) {
      var tile = document.createElement("div");
      tile.className = "tile";
      row.appendChild(tile);
    }
    boardEl.appendChild(row);
    rowEls.push(row);
    settleScroll(true);
    return row;
  }

  // Keep the active row in view; fade the top edge only once it overflows.
  function settleScroll(instant) {
    boardEl.classList.toggle("overflowing",
      boardEl.scrollHeight > boardEl.clientHeight);
    if (instant) boardEl.style.scrollBehavior = "auto";
    boardEl.scrollTop = boardEl.scrollHeight;
    if (instant) boardEl.style.scrollBehavior = "";
  }

  // Today's puzzle: resume the saved game if there is one, else start fresh.
  function init() {
    practice = false;
    newBtn.textContent = "Practice";
    var saved = loadSaved();
    if (validSave(saved)) {
      answer = saved.answer;
      quietRows = true;
      resetBoard();
      restore(saved);
      quietRows = false;
    } else {
      answer = answerFor(todayKey());
      resetBoard();
      saveState();
    }
  }

  // Random word, never saved — the daily game stays untouched. A forced
  // word ("crane") is the debugging backdoor.
  function startPractice(force) {
    practice = true;
    answer = validAnswer(force)
      ? force
      : ANSWERS[Math.floor(Math.random() * ANSWERS.length)];
    resetBoard();
    newBtn.textContent = "Today\u2019s puzzle";
    showBanner("Practice round");
  }

  // Replay saved guesses onto the fresh board with no animation. Marks are
  // pure evaluate(word, answer), so they recompute. A live run resumes
  // ticking from its banked time the moment the board is back.
  function restore(saved) {
    guesses = saved.guesses.slice();
    elapsedMs = saved.elapsedMs;
    guesses.forEach(function (word, r) {
      var row = rowEls[r] || addRow();
      var marks = evaluate(word, answer);
      for (var c = 0; c < COLS; c++) {
        var t = row.children[c];
        t.textContent = word.charAt(c);
        t.classList.add("filled", marks[c]);
        paintKey(word.charAt(c), marks[c]);
      }
    });

    if (saved.done) {
      done = true;
      won = !!saved.won;
      gaveUp = !!saved.gaveUp;
      stopClock();
      if (won) clockEl.classList.add("done");
      showBanner(endBanner());
      shareBtn.classList.remove("hidden");
    } else {
      if (!activeRow()) addRow(); // the waiting row
      if (guesses.length > 0) startClock(); // the run is still live
    }
    updateActions();
    settleScroll(true);
  }

  function buildKeyboard() {
    keyboardEl.innerHTML = "";
    keyEls = {};
    var layout = [
      "qwertyuiop".split(""),
      "asdfghjkl".split(""),
      ["Enter", "z", "x", "c", "v", "b", "n", "m", "Backspace"]
    ];
    layout.forEach(function (keys) {
      var rowEl = document.createElement("div");
      rowEl.className = "key-row";
      keys.forEach(function (k) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "key" + (k.length > 1 ? " wide" : "");
        btn.textContent = k === "Backspace" ? "\u232B" : k;
        btn.setAttribute("aria-label", k);
        btn.addEventListener("click", function () { onKey(k); btn.blur(); });
        rowEl.appendChild(btn);
        if (k.length === 1) keyEls[k] = btn;
      });
      keyboardEl.appendChild(rowEl);
    });
  }

  // ---------- input ----------

  function onKey(key) {
    if (done || revealing) return;
    if (key === "Enter") { submit(); return; }
    if (key === "Backspace") { erase(); return; }
    if (/^[a-z]$/.test(key)) typeLetter(key);
  }

  function typeLetter(ch) {
    var row = activeRow();
    for (var c = 0; c < COLS; c++) {
      if (!typed[c]) {
        typed[c] = ch;
        row.children[c].textContent = ch;
        row.children[c].classList.add("filled");
        return;
      }
    }
  }

  function erase() {
    var row = activeRow();
    for (var c = COLS - 1; c >= 0; c--) {
      if (typed[c]) {
        typed[c] = "";
        row.children[c].textContent = "";
        row.children[c].classList.remove("filled");
        return;
      }
    }
  }

  // ---------- submitting a guess ----------

  // Standard Wordle evaluation: exact matches first, then stray letters.
  function evaluate(guess, target) {
    var marks = Array(COLS).fill("absent");
    var remaining = {};
    for (var i = 0; i < COLS; i++) {
      if (guess[i] === target[i]) marks[i] = "correct";
      else remaining[target[i]] = (remaining[target[i]] || 0) + 1;
    }
    for (var j = 0; j < COLS; j++) {
      if (marks[j] !== "correct" && remaining[guess[j]] > 0) {
        marks[j] = "present";
        remaining[guess[j]]--;
      }
    }
    return marks;
  }

  function submit() {
    var guess = typed.join("");
    if (guess.length < COLS) { reject("Not enough letters"); return; }
    if (!DICTIONARY.has(guess)) { reject("Not in word list"); return; }

    startClock(); // the first submitted word starts the run
    revealing = true;
    var rowIdx = guesses.length;
    var marks = evaluate(guess, answer);
    // A rejected attempt leaves `shake` behind; equal specificity, defined
    // after .reveal, it would override the flip — clear it first.
    Array.prototype.forEach.call(rowEls[rowIdx].children, function (t) {
      t.classList.remove("shake");
    });
    marks.forEach(function (mark, c) {
      var t = rowEls[rowIdx].children[c];
      // Flip first; the score color lands at the half-turn, like Wordle.
      setTimeout(function () { t.classList.add("reveal"); },
        FLIP_START + c * FLIP_STAGGER);
      setTimeout(function () {
        t.classList.remove("filled");
        t.classList.add(mark);
      }, FLIP_START + c * FLIP_STAGGER + FLIP_MID);
    });
    setTimeout(function () { finish(rowIdx, guess, marks); },
      FLIP_START + (COLS - 1) * FLIP_STAGGER + FLIP_MID + FLIP_TAIL);
  }

  function finish(rowIdx, guess, marks) {
    for (var c = 0; c < COLS; c++) {
      paintKey(guess.charAt(c), marks[c]);
    }
    typed = Array(COLS).fill("");
    guesses.push(guess);

    if (guess === answer) {
      done = true;
      won = true;
      stopClock();
      clockEl.classList.add("done");
      showBanner(endBanner());
      shareBtn.classList.remove("hidden");
    } else {
      bankClock(); // keep the save's time current for the refresh case
      addRow();
    }
    updateActions();
    saveState();
    revealing = false;
  }

  function endBanner() {
    if (!won) return "The word was " + answer.toUpperCase();
    var n = guesses.length;
    var head = n <= PRAISE.length ? PRAISE[n - 1] : "Got there";
    return head + " \u2014 " + formatTime(nowElapsed());
  }

  // Guesses are unlimited, so there is no exhaustion loss — giving up is
  // the one loss: end the run, reveal the word, freeze everything.
  function giveUp() {
    if (done || revealing) return;
    done = true;
    gaveUp = true;
    typed = Array(COLS).fill("");
    var row = activeRow();
    if (row) {
      for (var c = 0; c < COLS; c++) {
        row.children[c].textContent = "";
        row.children[c].classList.remove("filled");
      }
    }
    stopClock();
    showBanner(endBanner());
    shareBtn.classList.remove("hidden");
    updateActions();
    saveState();
  }

  function updateActions() {
    giveUpBtn.classList.toggle("hidden", done);
  }

  // ---------- keyboard colors ----------

  var RANK = { absent: 1, present: 2, correct: 3 };

  function paintKey(letter, mark) {
    var key = keyEls[letter];
    if (!key) return;
    var current = key.dataset.state || "";
    if (RANK[mark] > (RANK[current] || 0)) {
      if (current) key.classList.remove(current);
      key.classList.add(mark);
      key.dataset.state = mark;
    }
  }

  // ---------- feedback ----------

  function showBanner(msg) {
    bannerEl.textContent = msg;
    bannerEl.classList.add("show");
  }

  function reject(msg) {
    toast(msg);
    Array.prototype.forEach.call(activeRow().children, function (tile) {
      tile.classList.remove("shake");
      void tile.offsetWidth; // restart the animation
      tile.classList.add("shake");
      // Drop the class once played, or it overrides the later flip.
      tile.addEventListener("animationend", function h(ev) {
        if (ev.animationName !== "shake") return;
        tile.removeEventListener("animationend", h);
        tile.classList.remove("shake");
      });
    });
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

  // The time is the whole score, so it's the whole share: title line and
  // link, no grid. A surrender shares no time at all.
  function share() {
    var score = gaveUp ? "gave up" : formatTime(nowElapsed());
    var title = ["Hustle", practice ? "practice" : todayKey(), score]
      .join(" \u00B7 ");
    copyText([title, GAME_URL].join("\n"));
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
    if (/^[a-zA-Z]$/.test(e.key)) onKey(e.key.toLowerCase());
    else if (e.key === "Enter" || e.key === "Backspace") {
      // Never double-fire while a button holds focus: the browser will
      // activate it too (clicking Practice mid-game, retyping a key).
      if (!e.target || e.target.tagName !== "BUTTON") onKey(e.key);
    }
  });

  window.addEventListener("resize", function () { settleScroll(true); });

  newBtn.addEventListener("click", function () {
    newBtn.blur();
    if (practice) init(); else startPractice();
  });
  giveUpBtn.addEventListener("click", function () {
    giveUpBtn.blur();
    giveUp();
  });
  shareBtn.addEventListener("click", function () { shareBtn.blur(); share(); });

  init();

  // Small console/test surface.
  window.HUSTLE = {
    daily: init,
    practice: startPractice,
    todayKey: todayKey,
    answerFor: answerFor,
    evaluate: evaluate,
    formatTime: formatTime,
    dump: function () {
      return {
        answer: answer,
        guesses: guesses.slice(),
        running: running,
        elapsed: nowElapsed(),
        practice: practice,
        done: done,
        won: won,
        gaveUp: gaveUp,
        save: loadSaved()
      };
    }
  };
})();
