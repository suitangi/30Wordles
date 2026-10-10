// Ordinal — Day 27 variant of 30 Wordles.
// One puzzle per day: the answer derives from the calendar date and
// progress is saved to localStorage, so a refresh resumes the same game.
// Practice mode plays a random word without touching the daily save.
//
// A Wordle where every guess is filed alphabetically before the board
// judges it. You type in the entry strip above the board — plain slots,
// typed order — and the board stays dark while you type: Enter files
// the word onto the row sorted, type CRANE and the row shows ACENR.
// The SORTED word is what gets judged, so a green means the sort
// landed that letter exactly on that answer letter. Precious few
// five-letter words sort into other words — and the answer would have
// to be sorted to begin with — so there is one lift: type the answer
// itself and the game ends on the spot, the word landing in order,
// five greens. No banner: the board is the announcement, the reveal
// and the share button speak for themselves.

(function () {
  "use strict";

  var WL = 5;
  var ROWS = 6;            // six rows, all standing from the start
  var SALT = "ordinal";    // daily hash salt — each variant salts its own way
  var STORE_KEY = "ordinal-day27";
  var GAME_URL = "https://suitangi.github.io/30Wordles/days/27";
  var FLIP_STAGGER = 280;  // ms between tile flips (Bundle timing)
  var FLIP_MID = 270;      // half-turn point: the score color appears here
  var REVEAL_START = 100;
  var ANSWERS = window.WORD_LISTS.answers;
  var DICTIONARY = new Set(window.WORD_LISTS.guesses);

  var boardEl = document.getElementById("board");
  var entryEl = document.getElementById("entry");
  var keyboardEl = document.getElementById("keyboard");
  var toastEl = document.getElementById("toast");
  var newBtn = document.getElementById("new-btn");
  var giveUpBtn = document.getElementById("giveup-btn");
  var shareBtn = document.getElementById("share-btn");

  var answer = "";
  var guesses = [];       // typed words, in order
  var typed = Array(WL).fill("");
  var done = false;
  var won = false;
  var gaveUp = false;
  var revealing = false;
  var practice = false;
  var rowEls = [];
  var slotEls = [];       // the entry strip
  var keyEls = {};        // letter -> key button
  var toastTimer = null;

  var RANK = { absent: 1, present: 2, correct: 3 };

  // ---------- hashing ----------

  function hashStr(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h >>> 0;
  }

  // ---------- the sort ----------

  // The whole game in one line: the guess's letters file themselves
  // alphabetically — "crane" reads "acenr".
  function sortWord(word) {
    return word.split("").sort().join("");
  }

  // What the row shows for a word: its letters in order — except the
  // answer itself, which is already in order (the lift).
  function displayWord(word) {
    return word === answer ? word : sortWord(word);
  }

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

  // ---------- board ----------

  // All six rows stand from the start. Every row sorts the same way,
  // so there is no per-row map to print — plain tiles.
  function buildBoard() {
    boardEl.innerHTML = "";
    rowEls = [];
    for (var r = 0; r < ROWS; r++) {
      var row = document.createElement("div");
      row.className = "orow";
      for (var c = 0; c < WL; c++) {
        var tile = document.createElement("div");
        tile.className = "tile";
        row.appendChild(tile);
      }
      boardEl.appendChild(row);
      rowEls.push(row);
    }
  }

  function buildEntry() {
    entryEl.innerHTML = "";
    slotEls = [];
    for (var c = 0; c < WL; c++) {
      var s = document.createElement("div");
      s.className = "tile";
      entryEl.appendChild(s);
      slotEls.push(s);
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

  // The row just played hands the board to its successor.
  function retireRow(idx) {
    if (rowEls[idx]) rowEls[idx].classList.remove("on-row");
  }

  function resetBoard() {
    done = false;
    won = false;
    gaveUp = false;
    revealing = false;
    guesses = [];
    typed = Array(WL).fill("");

    buildBoard();
    buildEntry();
    buildKeyboard();
    rowEls[0].classList.add("on-row");
    shareBtn.classList.add("hidden");
    updateActions();
    paintEntry();
  }

  // Today's puzzle: resume the saved game if there is one, else start
  // fresh. The sort is fixed, so a refresh reproduces the same rows.
  function init() {
    practice = false;
    newBtn.textContent = "Practice";
    var key = todayKey();
    answer = answerFor(key);
    var saved = loadSaved();
    if (validSave(saved)) {
      resetBoard();
      restore(saved);
    } else {
      resetBoard();
      saveState();
    }
  }

  // Random word, never saved — the daily stays untouched. A forced
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

  // Replay saved guesses onto the rebuilt rows with no animation. Marks
  // are pure (the sort + evaluate), so rows paint directly — restored
  // boards are born finished.
  function restore(saved) {
    guesses = [];
    saved.guesses.forEach(function (w, r) {
      var row = rowEls[r];
      retireRow(r); // rebuilt rows are finished rows — no live ring
      var shown = displayWord(w);
      var marks = evaluate(shown, answer);
      for (var c = 0; c < WL; c++) {
        var t = row.children[c];
        t.textContent = shown.charAt(c);
        t.classList.add("filled", marks[c]);
        paintKey(shown.charAt(c), marks[c]);
      }
      guesses.push(w);
    });

    if (saved.done) {
      done = true;
      won = !!saved.won;
      gaveUp = !!saved.gaveUp;
      if (won) markWin(rowEls[guesses.length - 1]);
      else for (var r = 0; r < ROWS; r++) retireRow(r);
      shareBtn.classList.remove("hidden");
    } else {
      activeRow().classList.add("on-row");
    }
    updateActions();
  }

  // ---------- entry ----------

  // Typed order only — the board is the sorted record, and a guess
  // reaches it only when submitted.
  function paintEntry() {
    for (var c = 0; c < WL; c++) {
      slotEls[c].textContent = typed[c] || "";
      slotEls[c].classList.toggle("filled", !!typed[c]);
    }
  }

  // ---------- input ----------

  function onKey(key) {
    if (done || revealing) return;
    if (key === "Enter") { submit(); return; }
    if (key === "Backspace") { erase(); return; }
    if (/^[a-z]$/.test(key)) typeLetter(key);
  }

  function typeLetter(ch) {
    for (var c = 0; c < WL; c++) {
      if (!typed[c]) {
        typed[c] = ch;
        paintEntry();
        return;
      }
    }
  }

  function erase() {
    for (var c = WL - 1; c >= 0; c--) {
      if (typed[c]) {
        typed[c] = "";
        paintEntry();
        return;
      }
    }
  }

  // ---------- submitting a guess ----------

  // Standard Wordle evaluation: exact matches first, then stray letters.
  function evaluate(guess, target) {
    var marks = Array(WL).fill("absent");
    var remaining = {};
    for (var i = 0; i < WL; i++) {
      if (guess[i] === target[i]) marks[i] = "correct";
      else remaining[target[i]] = (remaining[target[i]] || 0) + 1;
    }
    for (var j = 0; j < WL; j++) {
      if (marks[j] !== "correct" && remaining[guess[j]] > 0) {
        marks[j] = "present";
        remaining[guess[j]]--;
      }
    }
    return marks;
  }

  function submit() {
    if (done || revealing) return;
    var word = typed.join("");
    if (word.length < WL) { reject("Not enough letters"); return; }
    if (!DICTIONARY.has(word)) { reject("Not in word list"); return; }

    revealing = true;
    var r = guesses.length;
    retireRow(r);
    var shown = displayWord(word);
    var marks = evaluate(shown, answer);
    // the sorted letters land on the row — the answer itself lands in
    // order, its sort lifted for the win
    for (var c = 0; c < WL; c++) {
      var t = rowEls[r].children[c];
      t.textContent = shown.charAt(c);
      t.classList.add("filled");
    }
    typed = Array(WL).fill("");
    paintEntry();
    // A rejected attempt leaves `shake` behind; equal specificity, defined
    // after .reveal, it would override the flip — clear it first.
    for (c = 0; c < WL; c++) rowEls[r].children[c].classList.remove("shake");
    flipRow(r, marks, REVEAL_START);
    setTimeout(function () { finish(r, word, marks); },
      REVEAL_START + (WL - 1) * FLIP_STAGGER + FLIP_MID + 150);
  }

  // The one visual primitive: staggered flips with the mark landing at
  // the half-turn (Cycle's — `.reveal` never comes off at mid-turn; a
  // landed reveal restarts via remove → reflow → add).
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

  function finish(r, word, marks) {
    guesses.push(word);
    var shown = displayWord(word);
    for (var c = 0; c < WL; c++) paintKey(shown.charAt(c), marks[c]);
    var allGreen = true;
    for (c = 0; c < WL; c++) if (marks[c] !== "correct") allGreen = false;

    if (allGreen) {
      done = true;
      won = true;
      markWin(rowEls[r]);
      shareBtn.classList.remove("hidden");
    } else if (guesses.length === ROWS) {
      done = true; // six sorts, no greens — the loss
      shareBtn.classList.remove("hidden");
    } else {
      activeRow().classList.add("on-row");
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
    typed = Array(WL).fill("");
    paintEntry();
    retireRow(guesses.length);
    done = true;
    gaveUp = true;
    shareBtn.classList.remove("hidden");
    updateActions();
    saveState();
  }

  function updateActions() {
    giveUpBtn.classList.toggle("hidden", done);
  }

  // ---------- keyboard colors ----------

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
    entryEl.classList.remove("shake");
    void entryEl.offsetWidth; // restart the animation
    entryEl.classList.add("shake");
    entryEl.addEventListener("animationend", function h(ev) {
      if (ev.animationName !== "shake") return;
      entryEl.classList.remove("shake");
      entryEl.removeEventListener("animationend", h);
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

  function share() {
    var emptyCell = document.documentElement.dataset.theme === "dark"
      ? "\u2B1B" : "\u2B1C";
    var EMOJI = { correct: "\uD83D\uDFE9", present: "\uD83D\uDFE8",
      absent: emptyCell };
    var n = guesses.length;
    var state = won ? n + "/" + ROWS
      : (gaveUp ? "gave up \u00B7 " + n + "/" + ROWS : "X/" + ROWS);
    var title = ["Ordinal", practice ? "practice" : todayKey(), state]
      .join(" \u00B7 ");
    var lines = [title, GAME_URL];
    guesses.forEach(function (w) {
      var marks = evaluate(displayWord(w), answer);
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
  window.ORDINAL = {
    daily: init,
    practice: startPractice,
    todayKey: todayKey,
    answerFor: answerFor,
    sortWord: sortWord,
    evaluate: evaluate,
    ROWS: ROWS,
    tile: function (r, c) { return rowEls[r].children[c]; },
    dump: function () {
      return {
        answer: answer,
        guesses: guesses.slice(),
        typed: typed.join(""),
        rows: guesses.map(function (w) { return displayWord(w); }),
        practice: practice,
        done: done,
        won: won,
        gaveUp: gaveUp,
        save: loadSaved()
      };
    }
  };
})();
