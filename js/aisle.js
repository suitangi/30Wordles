// Aisle — Day 28 variant of 30 Wordles.
// One puzzle per day: the answer derives from the calendar date and
// progress is saved to localStorage, so a refresh resumes the same game.
// Practice mode plays a random word without touching the daily save.
//
// Normal Wordle, except the middle column of the board — the Aisle —
// never gives a clue. Its tile takes no color, ever, and its letter
// teaches the keyboard nothing. The four tiles around it speak only in
// SIDES: green, the letter is in the word on this side of the aisle;
// yellow, it is in the word but on the other side — or only on the
// aisle itself; gray, it is not in the word. A tile is judged by its
// side alone, no letter accounting: a letter the answer keeps on both
// sides greens from either. And four greens do not win — the word
// itself has to be right ("ghast" scores G,G,·,G,G against "ghost" and
// keeps playing). The middle letter is the part you never get told: six
// guesses to file the sides and reason out what the aisle is hiding.
// No banner: the board is the announcement, the reveal and the share
// button speak for themselves; a loss walks the answer on as a ghost
// row — green on its sides, colorless on its own aisle, even in death.

(function () {
  "use strict";

  var WL = 5;
  var ROWS = 6;            // six guesses for now
  var SALT = "aisle";      // daily hash salt — each variant salts its own way
  var STORE_KEY = "aisle-day28";
  var GAME_URL = "https://suitangi.github.io/30Wordles/days/28";
  var FLIP_STAGGER = 280;  // ms between tile flips (Bundle timing)
  var FLIP_MID = 270;      // half-turn point: the mark lands here
  var REVEAL_START = 100;
  var AISLE = 2;           // the middle column
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
  var rowEls = [];
  var keyEls = {};         // letter -> key button
  var toastTimer = null;

  var RANK = { absent: 1, present: 2, correct: 3 };

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

  // ---------- the aisle ----------

  // Side clues only. Each scored tile asks two things about its letter:
  // is it in the word, and does the word keep it on this side of the
  // aisle? Green on both, yellow when it lives only across the aisle or
  // only on the aisle itself, gray when it isn't in the word at all.
  // The aisle tile answers with "" — no clue, no color, ever. No letter
  // accounting: every tile is judged on its own (the spec's rule as
  // written — a letter the answer keeps on both sides greens from
  // either side, and a repeated guess letter scores twice).
  function evaluate(guess, target) {
    var SIDE = [0, 0, -1, 1, 1];
    var marks = Array(WL).fill("");
    for (var p = 0; p < WL; p++) {
      if (SIDE[p] < 0) continue;
      var ch = guess.charAt(p);
      if (target.indexOf(ch) < 0) { marks[p] = "absent"; continue; }
      marks[p] = "present";
      for (var q = 0; q < WL; q++) {
        if (target.charAt(q) === ch && SIDE[q] === SIDE[p]) {
          marks[p] = "correct";
          break;
        }
      }
    }
    return marks;
  }

  // ---------- board ----------

  // All six rows stand from the start; the hairline down the middle is
  // the aisle (CSS draws it behind the tiles).
  function buildBoard() {
    boardEl.innerHTML = "";
    rowEls = [];
    for (var r = 0; r < ROWS; r++) {
      var row = document.createElement("div");
      row.className = "airow";
      for (var c = 0; c < WL; c++) {
        var tile = document.createElement("div");
        tile.className = "tile" + (c === AISLE ? " aicol" : "");
        row.appendChild(tile);
      }
      boardEl.appendChild(row);
      rowEls.push(row);
    }
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

  function activeRow() { return rowEls[guesses.length]; }

  function resetBoard() {
    done = false;
    won = false;
    gaveUp = false;
    revealing = false;
    guesses = [];
    typed = Array(WL).fill("");

    buildBoard();
    buildKeyboard();
    shareBtn.classList.add("hidden");
    updateActions();
  }

  // Today's puzzle: resume the saved game if there is one, else start
  // fresh. Marks are pure (side + membership), so restore recomputes.
  function init() {
    practice = false;
    newBtn.textContent = "Practice";
    var saved = loadSaved();
    if (validSave(saved)) {
      resetBoard();
      answer = saved.answer;
      restore(saved);
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
    toast("Practice round");
  }

  // Replay saved guesses onto the rebuilt rows with no animation.
  // Restored boards are born finished.
  function restore(saved) {
    guesses = [];
    saved.guesses.forEach(function (w, r) {
      var row = rowEls[r];
      var marks = evaluate(w, answer);
      for (var c = 0; c < WL; c++) {
        var t = row.children[c];
        t.textContent = w.charAt(c);
        t.classList.add("filled");
        if (marks[c]) t.classList.add(marks[c]);
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
    }
    updateActions();
  }

  // The loss reveal: the answer walks on as a ghost row — green on its
  // sides, colorless on its own aisle. The truth the board never told,
  // in the board's own language.
  function appendAnswerRow() {
    var row = document.createElement("div");
    row.className = "airow answer";
    for (var c = 0; c < WL; c++) {
      var tile = document.createElement("div");
      tile.className = c === AISLE ? "tile aicol filled"
        : "tile correct";
      tile.textContent = answer.charAt(c);
      row.appendChild(tile);
    }
    for (c = 0; c < WL; c++) row.children[c].classList.add("win-glow");
    boardEl.appendChild(row);
    return row;
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
    if (!row) return;
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
    if (!row) return;
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
  // the half-turn (Bundle timing, every day's language). The aisle tile
  // flips too — motion, not a clue — and lands back on its plain filled
  // border, colorless as ever.
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
        tile.classList.remove("correct", "present", "absent");
        if (mark) {
          tile.classList.remove("filled");
          tile.classList.add(mark);
        }
      }, startAt + c * FLIP_STAGGER + FLIP_MID, t, marks[c]);
    }
  }

  function finish(r, guess, marks) {
    guesses.push(guess);
    for (var c = 0; c < WL; c++) paintKey(guess.charAt(c), marks[c]);

    // Four greens are not the win — the word itself has to be right.
    if (guess === answer) {
      done = true;
      won = true;
      markWin(rowEls[r]);
      shareBtn.classList.remove("hidden");
    } else if (guesses.length === ROWS) {
      done = true; // six guesses, the aisle never cracked — the loss
      appendAnswerRow();
      shareBtn.classList.remove("hidden");
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

  // Standard rank painting from the four scored tiles. The aisle letter
  // carries "" and teaches the keyboard nothing — the one letter the
  // game never confirms unless it shows up on a side somewhere else.
  function paintKey(letter, mark) {
    var key = keyEls[letter];
    if (!key || !mark) return;
    var current = key.dataset.state || "";
    if (RANK[mark] > (RANK[current] || 0)) {
      if (current) key.classList.remove(current);
      key.classList.add(mark);
      key.dataset.state = mark;
    }
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

  // The four side tiles wear real marks; the aisle shares as the
  // theme's empty square — the hole in every row.
  function share() {
    var emptyCell = document.documentElement.dataset.theme === "dark"
      ? "\u2B1B" : "\u2B1C";
    var EMOJI = { correct: "\uD83D\uDFE9", present: "\uD83D\uDFE8",
      absent: emptyCell };
    var n = guesses.length;
    var state = won ? n + "/" + ROWS
      : (gaveUp ? "gave up \u00B7 " + n + "/" + ROWS : "X/" + ROWS);
    var title = ["Aisle", practice ? "practice" : todayKey(), state]
      .join(" \u00B7 ");
    var lines = [title, GAME_URL];
    guesses.forEach(function (w) {
      var marks = evaluate(w, answer);
      lines.push(marks.map(function (m) {
        return m ? EMOJI[m] : emptyCell;
      }).join(""));
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
  window.AISLE = {
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
