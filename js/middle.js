// Middle — Day 22 variant of 30 Wordles.
// One puzzle per day: the answer derives from the calendar date and
// progress is saved to localStorage, so a refresh resumes the same game.
// Practice mode plays a random word without touching the daily save.
//
// A Wordle played by thermometer. There is no membership clue in this
// game — every tile compares its guessed letter to the answer's letter
// AT ITS OWN POSITION: green, you hit it; yellow, the answer's letter is
// ABOVE yours (aim later in the alphabet); gray, it's below (aim
// earlier). "pound" answers "donut" with Y, G, Y, gray, gray. The
// optimal play is a binary search — guess the middle of each position's
// remaining range and split it. Nine guesses. Scoring is strictly
// per-position: no cross-position letter accounting, duplicates or
// otherwise, because membership doesn't exist here. The keyboard paints
// GREEN keys only — a yellow or gray tile says where the answer sits
// relative to your letter, never whether your letter is in the word at
// all, so graying or yellowing a key would lie. No banner: the board is
// the announcement, the reveal and the share button speak for
// themselves; a loss walks the answer on as a final all-green ghost row.

(function () {
  "use strict";

  var WL = 5;
  var ROWS = 9;            // room for the binary search to converge
  var SALT = "middle";     // daily hash salt — each variant salts its own way
  var STORE_KEY = "middle-day22";
  var GAME_URL = "https://suitangi.github.io/30Wordles/days/22";
  var FLIP_STAGGER = 280;  // ms between tile flips (Bundle timing)
  var FLIP_MID = 270;      // half-turn point: the mark lands here
  var REVEAL_START = 100;
  var ANSWERS = window.WORD_LISTS.answers;
  var DICTIONARY = new Set(window.WORD_LISTS.guesses);

  var boardEl = document.getElementById("board");
  var keyboardEl = document.getElementById("keyboard");
  var toastEl = document.getElementById("toast");
  var newBtn = document.getElementById("new-btn");
  var giveUpBtn = document.getElementById("giveup-btn");
  var shareBtn = document.getElementById("share-btn");

  var answer = "";
  var guesses = [];        // plain words — marks are pure and recompute
  var typed = Array(WL).fill("");
  var done = false;
  var won = false;
  var gaveUp = false;
  var revealing = false;
  var practice = false;
  var quietRows = false;   // restore flag: rows paint finished, not animated
  var rowEls = [];
  var keyEls = {};         // letter -> key button (green keys only)
  var toastTimer = null;

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
    return Array.isArray(saved.guesses) &&
      saved.guesses.length <= ROWS &&
      saved.guesses.every(validAnswer);
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
        done: done,
        won: won,
        gaveUp: gaveUp
      }));
    } catch (e) { /* storage unavailable — game still playable */ }
  }

  // ---------- the thermometer ----------

  // Strictly per-position: green on equality, yellow when the answer's
  // letter sits ABOVE the guess (guess is alphabetically earlier), gray
  // when it sits below. "pound" answers "donut" with Y, G, Y, A, A —
  // the spec's example. No two-pass accounting: membership is not a
  // clue this game speaks.
  function evaluate(guess, target) {
    var marks = Array(WL).fill("absent");
    for (var i = 0; i < WL; i++) {
      if (guess[i] === target[i]) marks[i] = "correct";
      else if (guess[i] < target[i]) marks[i] = "present";
    }
    return marks;
  }

  // ---------- board ----------

  function activeRow() { return rowEls[guesses.length]; }

  // Rows grow on demand inside the shared scroll window — the clues
  // live on the tiles themselves; no side column.
  function addRow() {
    var row = document.createElement("div");
    row.className = quietRows ? "midrow quiet" : "midrow";
    for (var c = 0; c < WL; c++) {
      var tile = document.createElement("div");
      tile.className = "tile";
      row.appendChild(tile);
    }
    boardEl.appendChild(row);
    rowEls.push(row);
    settleScroll(true);
    return row;
  }

  // The loss reveal: the answer walks on as a final all-green ghost row.
  function appendAnswerRow() {
    var row = document.createElement("div");
    row.className = "midrow answer" + (quietRows ? " quiet" : "");
    for (var c = 0; c < WL; c++) {
      var tile = document.createElement("div");
      tile.className = "tile correct";
      tile.textContent = answer.charAt(c);
      row.appendChild(tile);
    }
    for (c = 0; c < WL; c++) row.children[c].classList.add("win-glow");
    boardEl.appendChild(row);
    settleScroll(true);
    return row;
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

  // Keep the active row in view; fade the top edge only once it overflows.
  function settleScroll(instant) {
    boardEl.classList.toggle("overflowing",
      boardEl.scrollHeight > boardEl.clientHeight);
    if (instant) boardEl.style.scrollBehavior = "auto";
    boardEl.scrollTop = boardEl.scrollHeight;
    if (instant) boardEl.style.scrollBehavior = "";
  }

  function resetBoard() {
    done = false;
    won = false;
    gaveUp = false;
    revealing = false;
    guesses = [];
    typed = Array(WL).fill("");
    rowEls = [];

    boardEl.innerHTML = "";
    boardEl.classList.remove("overflowing");
    shareBtn.classList.add("hidden");
    updateActions();

    buildKeyboard();
    addRow();
  }

  // Today's puzzle: resume the saved game if there is one, else start
  // fresh. Marks are pure (the thermometer), so restore just recomputes.
  function init() {
    practice = false;
    newBtn.textContent = "Practice";
    var saved = loadSaved();
    if (validSave(saved)) {
      quietRows = true;
      resetBoard();
      answer = saved.answer;
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
    quietRows = false;
    resetBoard();
    newBtn.textContent = "Today\u2019s puzzle";
    toast("Practice round");
  }

  // Replay saved guesses onto the fresh board with no animation.
  function restore(saved) {
    guesses = [];
    saved.guesses.forEach(function (w) {
      var row = rowEls[guesses.length] || addRow();
      var marks = evaluate(w, answer);
      for (var c = 0; c < WL; c++) {
        var t = row.children[c];
        t.textContent = w.charAt(c);
        t.classList.add("filled", marks[c]);
      }
      for (c = 0; c < WL; c++) paintKey(w.charAt(c), marks[c]);
      guesses.push(w);
    });

    if (saved.done) {
      done = true;
      won = !!saved.won;
      gaveUp = !!saved.gaveUp;
      if (won) markWin(rowEls[guesses.length - 1]);
      else appendAnswerRow();
      shareBtn.classList.remove("hidden");
    } else {
      if (!activeRow()) addRow(); // the waiting row (resetBoard built one
    }                             // already when the save had no guesses)
    updateActions();
    settleScroll(true);
  }

  // ---------- input ----------

  function onKey(key) {
    if (done || revealing) return;
    if (key === "Enter") { submit(); return; }
    if (key === "Backspace") { erase(); return; }
    if (/^[a-z]$/.test(key)) typeLetter(key);
  }

  function typeLetter(ch) {
    var row = rowEls[guesses.length];
    for (var c = 0; c < WL; c++) {
      if (!typed[c]) {
        typed[c] = ch;
        row.children[c].textContent = ch;
        row.children[c].classList.add("filled");
        return;
      }
    }
  }

  function erase() {
    var row = rowEls[guesses.length];
    for (var c = WL - 1; c >= 0; c--) {
      if (typed[c]) {
        typed[c] = "";
        row.children[c].textContent = "";
        row.children[c].classList.remove("filled");
        return;
      }
    }
  }

  // ---------- submitting a guess ----------

  function submit() {
    if (done || revealing) return;
    var guess = typed.join("");
    if (guess.length < WL) { reject("Not enough letters"); return; }
    if (!DICTIONARY.has(guess)) { reject("Not in word list"); return; }

    revealing = true;
    var r = guesses.length;
    var marks = evaluate(guess, answer);
    var row = rowEls[r];
    for (var c = 0; c < WL; c++) {
      // A rejected attempt leaves `shake` behind; equal specificity,
      // defined after .reveal, it would override the flip — clear it.
      row.children[c].classList.remove("shake");
    }
    typed = Array(WL).fill("");
    flipRow(r, marks, REVEAL_START);
    setTimeout(function () { finish(r, guess, marks); },
      REVEAL_START + (WL - 1) * FLIP_STAGGER + FLIP_MID + 150);
  }

  // The one visual primitive: staggered flips with the mark landing at
  // the half-turn (Bundle timing, every day's language). `.reveal` never
  // comes off at mid-turn; a landed reveal restarts via remove →
  // reflow → add.
  function flipRow(rowIdx, marks, startAt) {
    var row = rowEls[rowIdx];
    for (var c = 0; c < WL; c++) {
      var t = row.children[c];
      setTimeout(function (tile) {
        tile.classList.remove("reveal");
        void tile.offsetWidth;
        tile.classList.add("reveal");
      }, startAt + c * FLIP_STAGGER, t);
      setTimeout(function (tile, mark) {
        tile.classList.remove("filled", "correct", "present", "absent");
        tile.classList.add(mark);
      }, startAt + c * FLIP_STAGGER + FLIP_MID, t, marks[c]);
    }
  }

  function finish(r, guess, marks) {
    guesses.push(guess);
    for (var c = 0; c < WL; c++) paintKey(guess.charAt(c), marks[c]);

    var allGreen = true;
    for (c = 0; c < WL; c++) {
      if (marks[c] !== "correct") allGreen = false;
    }

    if (allGreen) {
      done = true;
      won = true;
      markWin(rowEls[r]);
      shareBtn.classList.remove("hidden");
    } else if (guesses.length === ROWS) {
      done = true; // nine thermometers, never all green — the loss
      appendAnswerRow();
      shareBtn.classList.remove("hidden");
    } else {
      addRow();
    }
    updateActions();
    saveState();
    revealing = false;
  }

  function markWin(row) {
    if (!row) return;
    for (var c = 0; c < WL; c++) row.children[c].classList.add("win-glow");
  }

  function giveUp() {
    if (done || revealing) return;
    var row = rowEls[guesses.length];
    for (var c = 0; c < WL; c++) {
      typed[c] = "";
      if (row) {
        row.children[c].textContent = "";
        row.children[c].classList.remove("filled");
      }
    }
    done = true;
    gaveUp = true;
    appendAnswerRow();
    shareBtn.classList.remove("hidden");
    updateActions();
    saveState();
  }

  function updateActions() {
    giveUpBtn.classList.toggle("hidden", done);
  }

  // ---------- keyboard colors ----------

  // GREEN keys only. A yellow tile says the answer's letter sits above
  // yours AT THAT POSITION; a gray tile says below — neither tells you
  // whether your letter is in the word at all (it may live at another
  // position), so painting those keys would lie. A green tile is the
  // one per-letter truth: this letter IS the answer's letter here.
  function paintKey(letter, mark) {
    var key = keyEls[letter];
    if (!key || mark !== "correct") return;
    key.classList.add("correct");
    key.dataset.state = "correct";
  }

  // ---------- feedback ----------

  function reject(msg) {
    toast(msg);
    var row = rowEls[guesses.length];
    for (var c = 0; c < WL; c++) {
      var tile = row.children[c];
      tile.classList.remove("shake");
      void tile.offsetWidth; // restart the animation
      tile.classList.add("shake");
      // Drop the class once played, or it overrides the later flip.
      tile.addEventListener("animationend", function h(ev) {
        if (ev.animationName !== "shake") return;
        tile.removeEventListener("animationend", h);
        tile.classList.remove("shake");
      });
    }
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

  // The tiles wear real marks, so the share is the standard emoji grid
  // — with the understanding that yellow reads "aim higher" and gray
  // "aim lower".
  function share() {
    var emptyCell = document.documentElement.dataset.theme === "dark"
      ? "\u2B1B" : "\u2B1C";
    var EMOJI = { correct: "\uD83D\uDFE9", present: "\uD83D\uDFE8",
      absent: emptyCell };
    var n = guesses.length;
    var state = won ? n + "/" + ROWS
      : (gaveUp ? "gave up \u00B7 " + n + "/" + ROWS : "X/" + ROWS);
    var title = ["Middle", practice ? "practice" : todayKey(), state]
      .join(" \u00B7 ");
    var lines = [title, GAME_URL];
    guesses.forEach(function (w) {
      var marks = evaluate(w, answer);
      lines.push(marks.map(function (m) { return EMOJI[m]; }).join(""));
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
  window.MIDDLE = {
    daily: init,
    practice: startPractice,
    todayKey: todayKey,
    answerFor: answerFor,
    evaluate: evaluate,
    ROWS: ROWS,
    tile: function (r, c) { return rowEls[r].children[c]; },
    dump: function () {
      return {
        answer: answer,
        guesses: guesses.slice(),
        typed: typed.join(""),
        marks: guesses.map(function (w) { return evaluate(w, answer); }),
        practice: practice,
        done: done,
        won: won,
        gaveUp: gaveUp,
        save: loadSaved()
      };
    }
  };
})();
