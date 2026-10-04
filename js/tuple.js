// Tuple — Day 21 variant of 30 Wordles.
// One puzzle per day: the answer derives from the calendar date and
// progress is saved to localStorage, so a refresh resumes the same game.
// Practice mode plays a random word without touching the daily save.
//
// A Wordle with no colors anywhere. The tiles never tint — every guess
// is answered by a TUPLE on the row's right end: [yellows, greens], the
// two counts a normal board would have spread across its tiles,
// compressed into two numbers. The counts are a much narrower window on
// the truth than colors are, so guesses are UNLIMITED — give up is the
// one loss. One per-letter clue survives, the provable one: a tuple of
// [0, 0] means no letter of that guess is in the word, so its five keys
// gray out on the keyboard (any other tuple can't tell you WHICH
// letters were the absent ones, so they paint nothing). A [0, 5] tuple
// is the win — and for the satisfaction, hitting the answer lifts the
// colorlessness: the winning row RE-FLIPS to its true greens as a
// victory lap. A loss reveals the answer as a final ghost row wearing
// its own [0, 5]. No banner: the board is the announcement, the reveal
// and the share button speak for themselves.

(function () {
  "use strict";

  var WL = 5;
  var SALT = "tuple";      // daily hash salt — each variant salts its own way
  var STORE_KEY = "tuple-day21";
  var GAME_URL = "https://suitangi.github.io/30Wordles/days/21";
  var FLIP_STAGGER = 280;  // ms between tile flips (Bundle timing)
  var FLIP_MID = 270;      // half-turn point (nothing lands here — no colors)
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
  var guesses = [];        // plain words — the tuple recomputes from them
  var typed = Array(WL).fill("");
  var done = false;
  var won = false;
  var gaveUp = false;
  var revealing = false;
  var practice = false;
  var quietRows = false;   // restore flag: rows paint finished, not animated
  var rowEls = [];
  var keyEls = {};         // letter -> key button (grays on a [0, 0])
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
    // guesses are unlimited — no count to check (the Castle precedent)
    return Array.isArray(saved.guesses) && saved.guesses.every(validAnswer);
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

  // ---------- the tuple ----------

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

  // The whole game's voice: the guess's marks compressed to [yellows,
  // greens] — "pound" answers "donut" with [3, 1] (the spec's example).
  function tupleFor(guess, target) {
    var marks = evaluate(guess, target);
    var yellows = 0, greens = 0;
    for (var i = 0; i < WL; i++) {
      if (marks[i] === "present") yellows++;
      else if (marks[i] === "correct") greens++;
    }
    return [yellows, greens];
  }

  // ---------- board ----------

  function activeRow() { return rowEls[guesses.length]; }

  // Rows grow on demand inside the shared scroll window — the board
  // grows as long as the game lives.
  // The waiting row is five bare tiles; its tuple arrives with the reveal.
  function addRow() {
    var row = document.createElement("div");
    row.className = quietRows ? "tuprow quiet" : "tuprow";
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

  // The row's answer: [yellows, greens] as two number tiles wearing the
  // mark colors, framed in the tuple's brackets. pop staggers the numbers
  // in on a live reveal; restored rows paint plain (born finished).
  function paintTuple(row, tup, pop) {
    var chip = document.createElement("div");
    chip.className = "ttup" + (pop ? " pop" : "");
    var parts = [
      ["tsep", "["],
      ["tnum y", String(tup[0])],
      ["tsep", ","],
      ["tnum g", String(tup[1])],
      ["tsep", "]"]
    ];
    parts.forEach(function (p) {
      var s = document.createElement("span");
      s.className = p[0];
      s.textContent = p[1];
      chip.appendChild(s);
    });
    row.appendChild(chip);
    settleScroll(true);
    return chip;
  }

  // The loss reveal: the answer walks on as a ghost row wearing its own
  // [0, 5] — "the word was X" in the board's only language.
  function appendAnswerRow() {
    var row = document.createElement("div");
    row.className = "tuprow answer" + (quietRows ? " quiet" : "");
    for (var c = 0; c < WL; c++) {
      var tile = document.createElement("div");
      tile.className = "tile filled";
      tile.textContent = answer.charAt(c);
      row.appendChild(tile);
    }
    paintTuple(row, [0, WL], false);
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
  // fresh. Tuples are pure (evaluate), so restore just recomputes.
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
      for (var c = 0; c < WL; c++) {
        row.children[c].textContent = w.charAt(c);
        row.children[c].classList.add("filled");
      }
      var tup = tupleFor(w, answer);
      paintTuple(row, tup, false);
      if (tup[0] + tup[1] === 0) grayKeysFor(w); // [0, 0] — proven absent
      guesses.push(w);
    });

    if (saved.done) {
      done = true;
      won = !!saved.won;
      gaveUp = !!saved.gaveUp;
      if (won) {
        // restored boards paint finished, not animated: the win row
        // goes straight to its true greens, no re-flip
        var winRow = rowEls[guesses.length - 1];
        for (var c = 0; c < WL; c++) {
          winRow.children[c].classList.remove("filled");
          winRow.children[c].classList.add("correct");
        }
        markWin(winRow);
      } else {
        appendAnswerRow();
      }
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
    var row = rowEls[r];
    for (var c = 0; c < WL; c++) {
      // A rejected attempt leaves `shake` behind; equal specificity,
      // defined after .reveal, it would override the flip — clear it.
      row.children[c].classList.remove("shake");
    }
    typed = Array(WL).fill("");
    flipRow(r, REVEAL_START);
    var marks = evaluate(guess, answer);
    setTimeout(function () { finish(r, guess, marks); },
      REVEAL_START + (WL - 1) * FLIP_STAGGER + FLIP_MID + 150);
  }

  // The one visual primitive: staggered flips, pure motion during play
  // (no color lands at the half-turn). Pass `marks` and each tile's mark
  // class lands at the mid-turn instead — that's the win's victory lap.
  // `.reveal` stays on like every day's (stripping it mid-turn truncates
  // the flip); a landed reveal restarts via remove → reflow → add.
  function flipRow(rowIdx, startAt, marks) {
    var row = rowEls[rowIdx];
    for (var c = 0; c < WL; c++) {
      var t = row.children[c];
      setTimeout(function (tile) {
        tile.classList.remove("reveal");
        void tile.offsetWidth;
        tile.classList.add("reveal");
      }, startAt + c * FLIP_STAGGER, t);
      if (marks) {
        setTimeout(function (tile, mark) {
          tile.classList.remove("filled", "correct", "present", "absent");
          tile.classList.add(mark);
        }, startAt + c * FLIP_STAGGER + FLIP_MID, t, marks[c]);
      }
    }
  }

  function finish(r, guess, marks) {
    guesses.push(guess);
    var tup = tupleFor(guess, answer);
    paintTuple(rowEls[r], tup, true);
    if (tup[0] + tup[1] === 0) grayKeysFor(guess); // [0, 0] — proven absent

    var allGreen = true;
    for (var c = 0; c < WL; c++) {
      if (marks[c] !== "correct") allGreen = false;
    }

    if (allGreen) {
      done = true;
      won = true;
      // the victory lap: the board stayed colorless while the tuple
      // landed — now the row re-flips to its true greens. revealing
      // holds through the second flip; wrapUp glows and saves when the
      // greens are down (the Cycle paintTrue precedent).
      revealing = true;
      flipRow(r, REVEAL_START, marks);
      setTimeout(function () {
        markWin(rowEls[r]);
        shareBtn.classList.remove("hidden");
        updateActions();
        saveState();
        revealing = false;
      }, REVEAL_START + (WL - 1) * FLIP_STAGGER + FLIP_MID + 150);
      return;
    }
    addRow(); // guesses are unlimited — the board just keeps growing
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

  // The one per-letter clue the tuple can prove: [0, 0] means no letter
  // of the guess is in the word, so all five keys gray out. Any other
  // tuple can't tell you WHICH letters were the absent ones, so it
  // paints nothing — the keyboard stays silent unless the board said so.
  function paintKey(letter) {
    var key = keyEls[letter];
    if (!key || key.dataset.state) return;
    key.classList.add("absent");
    key.dataset.state = "absent";
  }

  function grayKeysFor(word) {
    for (var i = 0; i < WL; i++) paintKey(word.charAt(i));
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

  // The board never showed colors, so the share doesn't either — one
  // tuple line per guess, plain text in the board's own notation:
  // [3, 1], and [0, 5] on the row that won.
  function share() {
    var n = guesses.length;
    var count = gaveUp
      ? "gave up \u00B7 " + n + (n === 1 ? " guess" : " guesses")
      : n + (n === 1 ? " guess" : " guesses");
    var title = ["Tuple", practice ? "practice" : todayKey(), count]
      .join(" \u00B7 ");
    var lines = [title, GAME_URL];
    guesses.forEach(function (w) {
      var t = tupleFor(w, answer);
      lines.push("[" + t[0] + ", " + t[1] + "]");
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
  window.TUPLE = {
    daily: init,
    practice: startPractice,
    todayKey: todayKey,
    answerFor: answerFor,
    evaluate: evaluate,
    tupleFor: tupleFor,
    tile: function (r, c) { return rowEls[r].children[c]; },
    dump: function () {
      return {
        answer: answer,
        guesses: guesses.slice(),
        typed: typed.join(""),
        tuples: guesses.map(function (w) { return tupleFor(w, answer); }),
        practice: practice,
        done: done,
        won: won,
        gaveUp: gaveUp,
        save: loadSaved()
      };
    }
  };
})();
