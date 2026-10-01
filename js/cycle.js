// Cycle — Day 18 variant of 30 Wordles.
// One puzzle per day: the answer derives from the calendar date and
// progress is saved to localStorage, so a refresh resumes the same game.
// Practice mode plays a random word without touching the daily save.
//
// A Wordle where the CLUES cycle. Guesses alternate between two modes:
// yellow-only guesses show membership only (greens are demoted to
// yellow), and green-only guesses show exact positions and nothing else
// (yellows are downgraded to gray). Eight guesses: yellow, green,
// yellow, green... so the last guess sees greens. The chip on the right
// of every row says which mode that guess scored — or will score — in.
// The keyboard keeps the best clue each letter has ever been SHOWN
// (never downgrades), so a yellow stays yellow even after a green-only
// guess grades it gray; it never telegraphs truths the board hid,
// either. Five TRUE greens win — type the answer on a yellow-only guess
// and the row flips to its greens as the victory lap.

(function () {
  "use strict";

  var COLS = 5;
  var ROWS = 8; // four green guesses, four yellow guesses
  var SALT = "cycle"; // daily hash salt — each variant salts its own way
  var FLIP_STAGGER = 280; // ms between tile flips
  var FLIP_MID = 270;     // half-turn point: the score color appears here
  var STORE_KEY = "cycle-day18";
  var GAME_URL = "https://suitangi.github.io/30Wordles/days/18";
  var PRAISE = ["Genius", "Magnificent", "Impressive", "Splendid", "Great",
    "Phew"];
  var OPEN_BANNER = "Guesses cycle \u2014 yellow-only, then green";

  var ANSWERS = window.WORD_LISTS.answers;
  var DICTIONARY = new Set(window.WORD_LISTS.guesses);

  var boardEl = document.getElementById("board");
  var keyboardEl = document.getElementById("keyboard");
  var bannerEl = document.getElementById("banner");
  var toastEl = document.getElementById("toast");
  var newBtn = document.getElementById("new-btn");
  var giveUpBtn = document.getElementById("giveup-btn");
  var shareBtn = document.getElementById("share-btn");

  var answer = "";
  var guesses = [];      // plain words — the mode is the row's index
  var typed = [];        // the active row's letters
  var done = false;
  var won = false;
  var gaveUp = false;
  var revealing = false;
  var practice = false;
  var quietRows = false; // restore flag: rebuilt rows skip enter animations
  var rowEls = [];       // rowEls[r] — .cycrow of five tiles + mode chip
  var chipEls = [];      // chipEls[r] — that row's G/Y mode chip
  var keyEls = {};       // letter -> key button
  var toastTimer = null;

  // ---------- the cycle ----------

  // Odd rows score green-only, even rows yellow-only. Yellow first, so
  // the opener is already fogged — and the EIGHTH guess, the one that
  // can still win it, is a green guess.
  function modeFor(r) { return r % 2 === 0 ? "y" : "g"; }

  // What a true mark displays in a mode. Yellow-only: greens demote to
  // yellow. Green-only: yellows downgrade to gray. Absent stays absent.
  function displayMark(mark, mode) {
    if (mode === "y") return mark === "correct" ? "present" : mark;
    return mark === "present" ? "absent" : mark;
  }

  function displayedFor(guess, r) {
    var trueMarks = evaluate(guess, answer);
    var mode = modeFor(r);
    return trueMarks.map(function (m) { return displayMark(m, mode); });
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

  function activeRow() { return rowEls[guesses.length]; }

  function resetBoard() {
    done = false;
    won = false;
    gaveUp = false;
    revealing = false;
    guesses = [];
    typed = Array(COLS).fill("");
    rowEls = [];
    chipEls = [];

    boardEl.innerHTML = "";
    boardEl.classList.remove("overflowing");
    bannerEl.classList.remove("show");
    bannerEl.textContent = "";
    shareBtn.classList.add("hidden");
    updateActions();

    addRow();
    buildKeyboard();
  }

  // Rows are built on demand — the cycle is eight long, not a shape.
  // Each row carries its mode chip on the right: what that guess scored,
  // or for the waiting row, what the guess you're typing will score.
  function addRow() {
    var mode = modeFor(guesses.length);
    var row = document.createElement("div");
    row.className = (quietRows ? "cycrow quiet" : "cycrow") + " on-row";
    for (var c = 0; c < COLS; c++) {
      var tile = document.createElement("div");
      tile.className = "tile";
      row.appendChild(tile);
    }
    var chip = document.createElement("div");
    chip.className = "cmode " + mode;
    chip.textContent = mode.toUpperCase();
    row.appendChild(chip);
    boardEl.appendChild(row);
    rowEls.push(row);
    chipEls.push(chip);
    settleScroll(true);
    return row;
  }

  // The row just played hands the ring to its successor.
  function retireRow(idx) {
    if (rowEls[idx]) rowEls[idx].classList.remove("on-row");
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
      quietRows = true;
      resetBoard();
      answer = saved.answer;
      restore(saved);
      quietRows = false;
    } else {
      answer = answerFor(todayKey());
      resetBoard();
      saveState();
      showBanner(OPEN_BANNER);
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

  // Replay saved guesses onto the fresh board with no animation. Marks
  // are pure (evaluate + the row's mode), so rows repaint directly and
  // the keyboard re-ranks from the displayed marks in guess order.
  function restore(saved) {
    guesses = [];
    saved.guesses.forEach(function (w) {
      var row = rowEls[guesses.length] || addRow();
      var r = guesses.length;
      retireRow(r); // rebuilt rows are finished rows — no ring on them
      var shown = displayedFor(w, r);
      for (var c = 0; c < COLS; c++) {
        var t = row.children[c];
        t.textContent = w.charAt(c);
        t.classList.add("filled", shown[c]);
        paintKey(w.charAt(c), shown[c]);
      }
      guesses.push(w);
    });

    if (saved.done) {
      done = true;
      won = !!saved.won;
      gaveUp = !!saved.gaveUp;
      if (won) {
        // restored boards paint finished, not animated: the win row goes
        // straight to its true greens, no re-flip
        var last = guesses.length - 1;
        var truth = evaluate(guesses[last], answer);
        var winRow = rowEls[last];
        for (var c = 0; c < COLS; c++) {
          var wt = winRow.children[c];
          wt.classList.remove("filled", "correct", "present", "absent");
          wt.classList.add(truth[c]);
        }
        markWin(winRow);
      }
      showBanner(endBanner());
      shareBtn.classList.remove("hidden");
    } else {
      if (!activeRow()) addRow(); // the waiting row (carries the ring)
      showBanner(OPEN_BANNER);
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

    revealing = true;
    var rowIdx = guesses.length;
    retireRow(rowIdx);
    var shown = displayedFor(guess, rowIdx);
    // A rejected attempt leaves `shake` behind; equal specificity, defined
    // after .reveal, it would override the flip — clear it first.
    for (var c = 0; c < COLS; c++) {
      rowEls[rowIdx].children[c].classList.remove("shake");
    }
    flipRow(rowIdx, shown, 100);
    setTimeout(function () { finish(rowIdx, guess); },
      100 + (COLS - 1) * FLIP_STAGGER + FLIP_MID + 150);
  }

  // The one visual primitive: staggered flips with the mark landing at
  // the half-turn. Shared by the play reveal and the win's truth re-flip.
  // `.reveal` must NEVER come off at mid-turn — that truncates the 550ms
  // flip to 270ms and the tile snaps flat (suitangi: "fast and weird").
  // It stays on like Peddle's; a landed reveal restarts via
  // remove → reflow → add inside the start callback. Old marks swap at
  // mid-turn, edge-on, or a re-flipped tile would carry two marks and
  // the later stylesheet rule would win.
  function flipRow(rowIdx, marks, startAt) {
    var row = rowEls[rowIdx];
    for (var c = 0; c < COLS; c++) {
      var t = row.children[c];
      t.classList.remove("shake");
      setTimeout(function (tile) {
        tile.classList.remove("reveal");
        void tile.offsetWidth; // restart a flip that already landed
        tile.classList.add("reveal");
      }, startAt + c * FLIP_STAGGER, t);
      setTimeout(function (tile, mark) {
        tile.classList.remove("filled", "correct", "present", "absent");
        tile.classList.add(mark);
      }, startAt + c * FLIP_STAGGER + FLIP_MID, t, marks[c]);
    }
  }

  // The win row wears truth: in yellow-only mode the flip just landed all
  // yellow — re-flip it to its greens before the banner, the mode lifted.
  function paintTrue(rowIdx, guess) {
    flipRow(rowIdx, evaluate(guess, answer), 100);
  }

  function finish(rowIdx, guess) {
    typed = Array(COLS).fill("");
    var shown = displayedFor(guess, rowIdx);
    guesses.push(guess);

    // the keyboard keeps the best clue each letter has been SHOWN —
    // never the hidden truth, or it would telegraph the mode's secrets
    for (var c = 0; c < COLS; c++) paintKey(guess.charAt(c), shown[c]);

    var allGreen = true;
    for (c = 0; c < COLS; c++) {
      if (evaluate(guess, answer)[c] !== "correct") allGreen = false;
    }

    if (allGreen) {
      done = true;
      won = true;
      // the victory lap lifts the mode for the keyboard too: the keys
      // wear the true greens the board is about to flip to (a no-op on
      // green-mode wins, where shown was already the truth)
      var trueMarks = evaluate(guess, answer);
      for (c = 0; c < COLS; c++) paintKey(guess.charAt(c), trueMarks[c]);
      var wrapUp = function () {
        markWin(rowEls[rowIdx]);
        showBanner(endBanner());
        shareBtn.classList.remove("hidden");
        updateActions();
        saveState();
        revealing = false;
      };
      if (modeFor(rowIdx) === "y") {
        paintTrue(rowIdx, guess); // the victory lap
        setTimeout(wrapUp,
          100 + (COLS - 1) * FLIP_STAGGER + FLIP_MID + 150);
      } else {
        wrapUp();
      }
      return;
    }

    if (guesses.length === ROWS) {
      done = true; // eight guesses, no greens — the loss
      showBanner(endBanner());
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
    for (var c = 0; c < COLS; c++) row.children[c].classList.add("win-glow");
  }

  function endBanner() {
    if (won) {
      var n = guesses.length;
      var head = n <= PRAISE.length ? PRAISE[n - 1] : "Got there";
      return head + " \u2014 " + n + (n === 1 ? " guess" : " guesses");
    }
    return "The word was " + answer.toUpperCase();
  }

  function giveUp() {
    if (done || revealing) return;
    var row = activeRow();
    for (var c = 0; c < COLS; c++) {
      typed[c] = "";
      if (row) {
        row.children[c].textContent = "";
        row.children[c].classList.remove("filled");
      }
    }
    if (row) retireRow(guesses.length);
    done = true;
    gaveUp = true;
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
    if (!key || !mark) return;
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
    for (var c = 0; c < COLS; c++) {
      var tile = rowEls[guesses.length].children[c];
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

  // The share is what the player saw: displayed marks, except the winning
  // row, which re-flipped to its true greens on screen.
  function share() {
    var emptyCell = document.documentElement.dataset.theme === "dark"
      ? "\u2B1B" : "\u2B1C";
    var EMOJI = { correct: "\uD83D\uDFE9", present: "\uD83D\uDFE8",
      absent: emptyCell };
    var n = guesses.length;
    var state = won ? n + "/" + ROWS
      : (gaveUp ? "gave up \u00B7 " + n + "/" + ROWS : "X/" + ROWS);
    var title = ["Cycle", practice ? "practice" : todayKey(), state]
      .join(" \u00B7 ");
    var lines = [title, GAME_URL];
    guesses.forEach(function (w, r) {
      var marks = (won && r === n - 1)
        ? evaluate(w, answer)
        : displayedFor(w, r);
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
  window.CYCLE = {
    daily: init,
    practice: startPractice,
    todayKey: todayKey,
    answerFor: answerFor,
    evaluate: evaluate,
    displayMark: displayMark,
    modeFor: modeFor,
    ROWS: ROWS,
    dump: function () {
      return {
        answer: answer,
        guesses: guesses.slice(),
        typed: typed.join(""),
        modes: guesses.map(function (w, r) { return modeFor(r); }),
        nextMode: done ? null : modeFor(guesses.length),
        practice: practice,
        done: done,
        won: won,
        gaveUp: gaveUp,
        save: loadSaved()
      };
    }
  };
})();
