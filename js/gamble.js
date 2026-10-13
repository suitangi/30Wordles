// Gamble — Day 30 variant of 30 Wordles. The final day.
// One puzzle per day: the answer derives from the calendar date and
// progress is saved to localStorage, so a refresh resumes the same game.
// Practice mode plays a random word without touching the daily save.
//
// Normal Wordle — but the color clues are for sale. The player holds a
// budget for the whole game: 10 clue points. Every guess carries ONE
// number stepper on its side — how many clue points to COMMIT to that
// row. The row then reveals left to right: grays are free wherever
// they fall, each green and yellow spends one point, and once the
// budget runs out everything after it is colorless and silent about
// what it hid — grays included. The commitment is spent whether the
// letters help or not. That is the gamble. Unlimited guesses; typing
// the exact word wins even with an empty budget (the winning row
// flips its true greens and its commitment is not spent — the bet is
// off). Give up is the one loss. The score is the pair: fewer
// guesses, more clues left. No banner: the board and the share button
// speak for themselves; practice toasts "Practice round".
(function () {
  "use strict";

  var WL = 5;
  var SALT = "gamble";     // daily hash salt — each variant salts its own way
  var STORE_KEY = "gamble-day30";
  var GAME_URL = "https://suitangi.github.io/30Wordles/days/30";
  var BUDGET_C = 10;       // clue points for the whole game; green = yellow = 1
  var FIRST_C = 3;         // the opening row's default bet
  // Bundle flip timing (100ms start, 280 stagger, color at +270, finish 1640).
  var FLIP_START = 100;
  var FLIP_STAGGER = 280;
  var FLIP_MID = 270;

  var ANSWERS = window.WORD_LISTS.answers;
  var DICTIONARY = new Set(window.WORD_LISTS.guesses);
  var RANK = { absent: 1, present: 2, correct: 3 };

  var rowsEl = document.getElementById("rows");
  var potCEl = document.getElementById("pot-c");
  var keyboardEl = document.getElementById("keyboard");
  var toastEl = document.getElementById("toast");
  var newBtn = document.getElementById("new-btn");
  var giveUpBtn = document.getElementById("giveup-btn");
  var shareBtn = document.getElementById("share-btn");

  var answer = "";
  var guesses = [];        // { w, c } — the commitment is part of the record
  var typed = Array(WL).fill("");
  var done = false;
  var won = false;
  var gaveUp = false;
  var revealing = false;
  var practice = false;
  var quietRows = false;   // restore flag: rebuilt rows skip animations
  var rowEls = [];         // rowEls[r] — .gbrow of five tiles + one stepper
  var keyEls = {};         // letter -> key button
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

  // The commitment is part of the record, so the save carries objects
  // (the Castle object-guess precedent) and validSave re-walks the
  // budget: the running total may never pass 10.
  function validSave(saved) {
    if (!saved || saved.date !== todayKey() || !validAnswer(saved.answer)) {
      return false;
    }
    if (!Array.isArray(saved.guesses)) return false;
    var sc = 0;
    for (var i = 0; i < saved.guesses.length; i++) {
      var gu = saved.guesses[i];
      if (!gu || !validAnswer(gu.w)) return false;
      if (typeof gu.c !== "number" || gu.c < 0 || gu.c % 1 !== 0 ||
          gu.c > WL) return false;
      sc += gu.c;
      if (sc > BUDGET_C) return false;
    }
    if (typeof saved.done !== "boolean" ||
        typeof saved.won !== "boolean" ||
        typeof saved.gaveUp !== "boolean") {
      return false;
    }
    if (!saved.done && (saved.won || saved.gaveUp)) return false;
    if (saved.done && !saved.won && !saved.gaveUp) return false; // no exhaustion loss
    if (saved.won && saved.gaveUp) return false;
    return true;
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

  // ---------- the gamble ----------

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

  // The reveal walk: grays are free — every gray shows wherever it
  // falls, as long as the budget still has life. Each green and yellow
  // spends one point, and once the budget runs dry, everything after
  // it becomes null: colorless, and silent about what it hid — grays
  // included. "rider" vs "flick" at 1 clue reads gray, gray, yellow,
  // colorless, colorless; "rider" vs "resat" at 2 reads green,
  // yellow, colorless, colorless, colorless.
  function displayMarks(word, c, target) {
    var marks = evaluate(word, target);
    var out = [];
    var left = c;
    for (var i = 0; i < WL; i++) {
      if (left <= 0) {
        out.push(null);           // budget dry: silence from here on
      } else if (marks[i] === "absent") {
        out.push(marks[i]);       // grays never spend
      } else {
        left--;                   // a green or yellow spends one point
        out.push(marks[i]);
      }
    }
    return out;
  }

  function spentC() {
    var t = 0;
    for (var i = 0; i < guesses.length; i++) t += guesses[i].c;
    return t;
  }

  function paintBudget() {
    potCEl.textContent = String(BUDGET_C - spentC());
  }

  // ---------- board ----------

  function activeRow() { return rowEls[guesses.length]; }

  // The stepper: one big-finger control — [−] value [+] — custom
  // buttons because the native spinners are tiny and vanish on some
  // browsers; 44px of touch height each side.
  function makeStep(value) {
    var cell = document.createElement("div");
    cell.className = "gb-step";
    var dec = document.createElement("button");
    dec.type = "button";
    dec.className = "gb-dec";
    dec.textContent = "\u2212";
    dec.setAttribute("aria-label", "one fewer clue");
    var inp = document.createElement("input");
    inp.type = "number";
    inp.min = "0";
    inp.max = String(Math.min(WL, BUDGET_C - spentC()));
    inp.value = String(value);
    inp.setAttribute("aria-label", "clues to reveal");
    // Enter inside the stepper submits the row — the window handler
    // skips INPUT targets, so this is the only way Enter works here.
    inp.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { inp.blur(); submit(); }
    });
    var inc = document.createElement("button");
    inc.type = "button";
    inc.className = "gb-inc";
    inc.textContent = "+";
    inc.setAttribute("aria-label", "one more clue");
    dec.addEventListener("click", function () { nudge(cell, -1); dec.blur(); });
    inc.addEventListener("click", function () { nudge(cell, 1); inc.blur(); });
    cell.appendChild(dec);
    cell.appendChild(inp);
    cell.appendChild(inc);
    syncStep(cell);
    return cell;
  }

  function stepInput(cell) { return cell.children[1]; }

  function nudge(cell, delta) {
    var inp = stepInput(cell);
    var max = Number(inp.max) || 0;
    var v = Math.max(0, Math.min(max, (Number(inp.value) || 0) + delta));
    inp.value = String(v);
    syncStep(cell);
  }

  function syncStep(cell) {
    var inp = stepInput(cell);
    var v = Number(inp.value) || 0;
    cell.children[0].disabled = cell.classList.contains("scored") || v <= 0;
    cell.children[2].disabled = cell.classList.contains("scored") ||
      v >= (Number(inp.max) || 0);
  }

  // Rows are built on demand — guesses are unlimited. A new row bets
  // the same as the row before it (clamped to what's left); the first
  // row opens at a 3-clue bet.
  function addRow() {
    var prev = guesses[guesses.length - 1];
    var def = Math.min(prev ? prev.c : FIRST_C, WL, BUDGET_C - spentC());
    var row = document.createElement("div");
    row.className = quietRows ? "gbrow quiet" : "gbrow";
    for (var c = 0; c < WL; c++) {
      var tile = document.createElement("div");
      tile.className = "tile";
      row.appendChild(tile);
    }
    row.appendChild(makeStep(def));
    rowsEl.appendChild(row);
    rowEls.push(row);
    settleScroll(true);
    return row;
  }

  // Keep the active row in view; fade the top edge only once it overflows.
  function settleScroll(instant) {
    rowsEl.classList.toggle("overflowing",
      rowsEl.scrollHeight > rowsEl.clientHeight);
    if (instant) rowsEl.style.scrollBehavior = "auto";
    rowsEl.scrollTop = rowsEl.scrollHeight;
    if (instant) rowsEl.style.scrollBehavior = "";
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
      var rowElK = document.createElement("div");
      rowElK.className = "key-row";
      keys.forEach(function (k) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "key" + (k.length > 1 ? " wide" : "");
        btn.textContent = k === "Backspace" ? "\u232B" : k;
        btn.setAttribute("aria-label", k);
        btn.addEventListener("click", function () { onKey(k); btn.blur(); });
        rowElK.appendChild(btn);
        if (k.length === 1) keyEls[k] = btn;
      });
      keyboardEl.appendChild(rowElK);
    });
  }

  function resetBoard() {
    done = false;
    won = false;
    gaveUp = false;
    revealing = false;
    guesses = [];
    typed = Array(WL).fill("");
    rowEls = [];

    rowsEl.innerHTML = "";
    rowsEl.classList.remove("overflowing");
    shareBtn.classList.add("hidden");

    addRow();
    buildKeyboard();
    paintBudget();
    updateActions();
  }

  // Today's puzzle: resume the saved game if there is one, else start
  // fresh. The shown marks are pure (evaluate + the walk), so restore
  // recomputes them from the recorded commitments.
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
  // word ("trust") is the debugging backdoor.
  function startPractice(force) {
    practice = true;
    answer = validAnswer(force)
      ? force
      : ANSWERS[Math.floor(Math.random() * ANSWERS.length)];
    resetBoard();
    newBtn.textContent = "Today\u2019s puzzle";
    toast("Practice round");
  }

  // Replay saved guesses onto fresh rows with no animation — restored
  // boards are born finished. The stepper freezes at the bet.
  function restore(saved) {
    guesses = [];
    saved.guesses.forEach(function (gu, r) {
      var row = rowEls[r] || addRow();
      var shown = displayMarks(gu.w, gu.c, answer);
      for (var c = 0; c < WL; c++) {
        var t = row.children[c];
        t.textContent = gu.w.charAt(c);
        t.classList.add("filled");
        if (shown[c]) t.classList.add(shown[c]);
      }
      freezeBet(row, gu.c);
      for (c = 0; c < WL; c++) {
        if (shown[c]) paintKey(gu.w.charAt(c), shown[c]);
      }
      guesses.push({ w: gu.w, c: gu.c });
    });

    if (saved.done) {
      done = true;
      won = !!saved.won;
      gaveUp = !!saved.gaveUp;
      if (won) paintWinRow();
      else appendAnswerRow();
      shareBtn.classList.remove("hidden");
    } else {
      if (!activeRow()) addRow(); // the waiting row (the Tuple guard)
    }
    paintBudget();
    updateActions();
    settleScroll(true);
  }

  // A scored row's stepper: parked at what was spent, frozen.
  function freezeBet(row, c) {
    row.classList.add("scored");
    var cell = row.children[WL];
    stepInput(cell).value = String(c);
    cell.children[0].disabled = true;
    cell.children[2].disabled = true;
    stepInput(cell).disabled = true;
  }

  // A won board: the answer sits in its true greens, glowing — the bet
  // is off, the whole word shows.
  function paintWinRow() {
    var row = rowEls[guesses.length - 1];
    if (!row) return;
    for (var c = 0; c < WL; c++) {
      row.children[c].classList.remove("filled");
      row.children[c].classList.add("correct", "win-glow");
    }
  }

  // The loss reveal: the answer walks on as a ghost row in full colors —
  // the truth the budget never bought.
  function appendAnswerRow() {
    var row = document.createElement("div");
    row.className = "gbrow answer";
    for (var c = 0; c < WL; c++) {
      var tile = document.createElement("div");
      tile.className = "tile correct";
      tile.textContent = answer.charAt(c);
      row.appendChild(tile);
    }
    for (c = 0; c < WL; c++) row.children[c].classList.add("win-glow");
    rowsEl.appendChild(row);
    settleScroll(true);
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
    var row = activeRow();
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
    var row = activeRow();
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

  // The waiting row's bet, read off its stepper and clamped to the pot
  // — and to the row's five tiles; betting a sixth letter is meaningless.
  function readBet(row) {
    var inp = stepInput(row.children[WL]);
    var c = Math.max(0, Math.floor(Number(inp.value) || 0));
    return Math.min(c, WL, BUDGET_C - spentC());
  }

  // ---------- submitting ----------

  function submit() {
    if (done || revealing) return;
    var row = activeRow();
    if (!row) return;
    var word = typed.join("");
    if (word.length < WL) { reject("Not enough letters"); return; }
    if (!DICTIONARY.has(word)) { reject("Not in word list"); return; }

    var bet = readBet(row);
    revealing = true;
    for (var c = 0; c < WL; c++) {
      // A rejected attempt leaves `shake` behind; equal specificity,
      // defined after .reveal, it would override the flip — clear it.
      row.children[c].classList.remove("shake");
    }
    typed = Array(WL).fill("");

    // The win is outside the economy: the row flips its true greens and
    // the bet is off — nothing is spent, whatever the stepper said.
    if (word === answer) {
      done = true;
      won = true;
      flipRow(row, Array(WL).fill("correct"));
      setTimeout(function () { finishWin(row, word); },
        FLIP_START + (WL - 1) * FLIP_STAGGER + FLIP_MID + 150);
      return;
    }

    var shown = displayMarks(word, bet, answer);
    flipRow(row, shown);
    setTimeout(function () { finish(row, word, bet, shown); },
      FLIP_START + (WL - 1) * FLIP_STAGGER + FLIP_MID + 150);
  }

  // The one visual primitive: staggered flips with the mark landing at
  // the half-turn (Bundle timing, every day's language). A null mark
  // flips with motion only and lands colorless-filled: the cut clue,
  // silent about what it hid.
  function flipRow(row, marks) {
    for (var c = 0; c < WL; c++) {
      var t = row.children[c];
      setTimeout(function (tile) {
        tile.classList.remove("reveal");
        void tile.offsetWidth;
        tile.classList.add("reveal");
      }, FLIP_START + c * FLIP_STAGGER, t);
      setTimeout(function (tile, mark) {
        if (mark) {
          tile.classList.remove("filled");
          tile.classList.add(mark);
        }
      }, FLIP_START + c * FLIP_STAGGER + FLIP_MID, t, marks[c]);
    }
  }

  function finish(row, word, bet, shown) {
    guesses.push({ w: word, c: bet });
    freezeBet(row, bet);
    for (var c = 0; c < WL; c++) {
      if (shown[c]) paintKey(word.charAt(c), shown[c]);
    }
    addRow(); // the next bet — unlimited guesses
    paintBudget();
    updateActions();
    saveState();
    revealing = false;
    settleScroll();
  }

  function finishWin(row, word) {
    guesses.push({ w: word, c: 0 }); // the bet is off — nothing spent
    freezeBet(row, 0);
    markWin(row);
    paintBudget();
    shareBtn.classList.remove("hidden");
    updateActions();
    saveState();
    revealing = false;
  }

  function markWin(row) {
    if (!row) return;
    for (var c = 0; c < WL; c++) row.children[c].classList.add("win-glow");
  }

  // Guesses are unlimited, so there is no exhaustion loss — giving up
  // is the one loss: end the run, reveal the word, freeze everything.
  function giveUp() {
    if (done || revealing) return;
    done = true;
    gaveUp = true;
    typed = Array(WL).fill("");
    var row = activeRow();
    if (row) {
      for (var c = 0; c < WL; c++) {
        row.children[c].textContent = "";
        row.children[c].classList.remove("filled");
      }
    }
    appendAnswerRow();
    shareBtn.classList.remove("hidden");
    updateActions();
    saveState();
  }

  function updateActions() {
    giveUpBtn.classList.toggle("hidden", done);
  }

  // ---------- keyboard colors ----------

  // The keyboard learns only what the player was SHOWN: a cut clue
  // teaches nothing (paintKey is called for shown marks only — a paid-
  // but-cut green never paints its key).
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
    var row = activeRow();
    if (!row) return;
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

  // The score is the pair — fewer guesses, more clues left — so the
  // header carries both. The grid shows the SHOWN marks only; a cut
  // clue shares as the theme's empty square, silent like on the board.
  function share() {
    var emptyCell = document.documentElement.dataset.theme === "dark"
      ? "\u2B1B" : "\u2B1C";
    var EMOJI = { correct: "\uD83D\uDFE9", present: "\uD83D\uDFE8",
      absent: emptyCell };
    var left = BUDGET_C - spentC();
    var n = guesses.length;
    var score = n + (n === 1 ? " guess \u00B7 " : " guesses \u00B7 ") +
      left + " clue" + (left === 1 ? "" : "s") + " left";
    if (gaveUp) score = "gave up \u00B7 " + score;
    var title = ["Gamble", practice ? "practice" : todayKey(), score]
      .join(" \u00B7 ");
    var lines = [title, GAME_URL];
    guesses.forEach(function (gu, r) {
      var shown = won && r === guesses.length - 1
        ? Array(WL).fill("correct") // the win row shares its true greens
        : displayMarks(gu.w, gu.c, answer);
      lines.push(shown.map(function (m) {
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
    if (e.target && e.target.tagName === "INPUT") return; // steppers own their keys
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
  window.GAMBLE = {
    daily: init,
    practice: startPractice,
    todayKey: todayKey,
    answerFor: answerFor,
    evaluate: evaluate,
    displayMarks: displayMarks,
    BUDGET_C: BUDGET_C,
    row: function (r) { return rowEls[r]; },
    tile: function (r, c) { return rowEls[r].children[c]; },
    setBet: function (r, v) {
      var inp = stepInput(rowEls[r].children[WL]);
      inp.value = String(v);
      syncStep(rowEls[r].children[WL]);
    },
    bet: function (r) { return Number(stepInput(rowEls[r].children[WL]).value) || 0; },
    dump: function () {
      return {
        answer: answer,
        guesses: guesses.slice(),
        typed: typed.join(""),
        leftC: BUDGET_C - spentC(),
        marks: guesses.map(function (gu) {
          return displayMarks(gu.w, gu.c, answer);
        }),
        practice: practice,
        done: done,
        won: won,
        gaveUp: gaveUp,
        save: loadSaved()
      };
    }
  };
})();
