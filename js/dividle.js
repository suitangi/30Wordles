// Dividle — Day 25 variant of 30 Wordles.
// One puzzle per day: the answer derives from the calendar date and
// progress is saved to localStorage, so a refresh resumes the same game.
// Practice mode plays a random word without touching the daily save.
//
// A Wordle cut in TWO. Every guess carries a vertical division line —
// slide it with the triangle buttons flanking the row (or the arrow
// keys); it lands between letters, at position d = 1..4, a fresh row
// cutting after the second letter. At submit the cut divides the GUESS
// and the ANSWER at the same spot, and each side scores only against
// its own counterpart with Wordle's ordinary two-pass — letters never
// clue across the line. donut cut do|nut against POUND reads gray,
// green, yellow, yellow, gray: the d grays because "do" never sees the
// d of "und". The cut is part of the guess's record (the save stores
// { w, d } and marks recompute from it), so a scored row's line stays
// put — only the pending row's line moves. Five greens win as always:
// the exact answer greens under any division. Seven guesses; give up
// is the other loss, and the answer walks on as a ghost row. No
// banner: the board is the announcement, the reveal and the share
// button speak for themselves.

(function () {
  "use strict";

  var WL = 5;
  var ROWS = 7;            // the cut costs cross-line clues — a little slack
  var SALT = "dividle";    // daily hash salt — each variant salts its own way
  var STORE_KEY = "dividle-day25";
  var GAME_URL = "https://suitangi.github.io/30Wordles/days/25";
  var FLIP_STAGGER = 280;  // ms between tile flips (Bundle timing)
  var FLIP_MID = 270;      // half-turn point: the mark lands here
  var REVEAL_START = 100;
  var DEFAULT_DIV = 2;     // a fresh row cuts after the second letter
  var ANSWERS = window.WORD_LISTS.answers;
  var DICTIONARY = new Set(window.WORD_LISTS.guesses);

  var boardEl = document.getElementById("board");
  var keyboardEl = document.getElementById("keyboard");
  var toastEl = document.getElementById("toast");
  var newBtn = document.getElementById("new-btn");
  var giveUpBtn = document.getElementById("giveup-btn");
  var shareBtn = document.getElementById("share-btn");

  var answer = "";
  var guesses = [];        // { w, d } — the cut is part of the record
  var typed = Array(WL).fill("");
  var div = DEFAULT_DIV;   // the pending row's cut
  var done = false;
  var won = false;
  var gaveUp = false;
  var revealing = false;
  var practice = false;
  var quietRows = false;   // restore flag: rows paint finished, not animated
  var rowEls = [];
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

  function validGuess(g) {
    return !!g && typeof g.w === "string" && DICTIONARY.has(g.w) &&
      typeof g.d === "number" && isFinite(g.d) &&
      g.d >= 1 && g.d <= 4 && g.d === Math.floor(g.d);
  }

  function validSave(saved) {
    if (!saved || saved.date !== todayKey() || !validAnswer(saved.answer)) {
      return false;
    }
    return Array.isArray(saved.guesses) &&
      saved.guesses.length <= ROWS &&
      saved.guesses.every(validGuess);
  }

  function validAnswer(w) {
    return typeof w === "string" && DICTIONARY.has(w);
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

  // ---------- the divided scoring ----------

  // Wordle's ordinary two pass, run TWICE: the cut divides guess and
  // answer at the same position d, and each side scores only against
  // its own counterpart — greens pin their side's exact matches,
  // yellows come out of the side's own leftover letters, and nothing
  // clues across the line.
  function evaluateDivided(guess, d, target) {
    var marks = Array(WL).fill("absent");
    scoreSide(0, d);
    scoreSide(d, WL);
    return marks;

    function scoreSide(lo, hi) {
      var remaining = {};
      for (var i = lo; i < hi; i++) {
        if (guess[i] === target[i]) marks[i] = "correct";
        else remaining[target[i]] = (remaining[target[i]] || 0) + 1;
      }
      for (var j = lo; j < hi; j++) {
        if (marks[j] !== "correct" && remaining[guess[j]] > 0) {
          marks[j] = "present";
          remaining[guess[j]]--;
        }
      }
    }
  }

  // ---------- board ----------

  function activeRow() { return rowEls[guesses.length]; }

  // The five tiles of a row — .dvrow is [west arrow, .dvword, east
  // arrow] and .dvword is the five tiles plus the line, so the tiles
  // are wordEl.children[0..4] and the line rides at children[5].
  function tilesOf(row) {
    var wordEl = row.children[1];
    var tiles = [];
    for (var c = 0; c < WL; c++) tiles.push(wordEl.children[c]);
    return tiles;
  }

  // The seven rows stand from the start (the Stifle board); the
  // pending row wears .on — that is the only row whose arrows show and
  // whose line moves.
  function makeArrow(side, label, delta) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "dvarrow " + side;
    btn.setAttribute("aria-label", label);
    // the triangle itself — inline SVG via innerHTML (the HTML parser
    // builds real SVG elements; createElement("svg") would not)
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
      '<path d="' + (delta < 0
        ? "M15.5 4.5 8 12l7.5 7.5z"
        : "M8.5 4.5 16 12l-7.5 7.5z") + '"/></svg>';
    btn.addEventListener("click", function () { nudge(delta); btn.blur(); });
    return btn;
  }

  function buildRows() {
    rowEls = [];
    boardEl.innerHTML = "";
    for (var r = 0; r < ROWS; r++) {
      var row = document.createElement("div");
      row.className = "dvrow" + (quietRows ? " quiet" : "");
      row.appendChild(makeArrow("west", "Move the division left", -1));

      var wordEl = document.createElement("div");
      wordEl.className = "dvword";
      for (var c = 0; c < WL; c++) {
        var tile = document.createElement("div");
        tile.className = "tile";
        wordEl.appendChild(tile);
      }
      var line = document.createElement("div");
      line.className = "dvline";
      wordEl.appendChild(line);
      row.appendChild(wordEl);

      row.appendChild(makeArrow("east", "Move the division right", 1));

      boardEl.appendChild(row);
      rowEls.push(row);
    }
  }

  // The pending cut, drawn and bounded — the triangles dim at the ends
  // of their travel.
  function paintDivider() {
    var row = activeRow();
    if (!row) return;
    row.children[1].style.setProperty("--d", div);
    row.children[0].disabled = div <= 1;
    row.children[2].disabled = div >= 4;
  }

  function nudge(delta) {
    if (done || revealing) return;
    div = Math.min(WL - 1, Math.max(1, div + delta));
    paintDivider();
  }

  function setActive(r) {
    rowEls.forEach(function (row) { row.classList.remove("on"); });
    if (rowEls[r]) rowEls[r].classList.add("on");
  }

  // The loss reveal: the answer walks on in FULL Wordle colors — one
  // whole, undivided word.
  function appendAnswerRow() {
    var row = document.createElement("div");
    row.className = "dvrow answer scored" + (quietRows ? " quiet" : "");
    row.appendChild(document.createElement("div"));
    var wordEl = document.createElement("div");
    wordEl.className = "dvword";
    wordEl.style.setProperty("--d", DEFAULT_DIV);
    for (var c = 0; c < WL; c++) {
      var tile = document.createElement("div");
      tile.className = "tile correct win-glow";
      tile.textContent = answer.charAt(c);
      wordEl.appendChild(tile);
    }
    var line = document.createElement("div");
    line.className = "dvline";
    wordEl.appendChild(line);
    row.appendChild(wordEl);
    row.appendChild(document.createElement("div"));
    boardEl.appendChild(row);
    return row;
  }

  function markWin(row) {
    if (!row) return;
    tilesOf(row).forEach(function (t) { t.classList.add("win-glow"); });
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

  var keyEls = {};

  // Standard rank painting — best clue so far, never downgrades. The
  // reset-then-repaint in repaintKeys is load-bearing (paintKey only
  // upgrades; the Swivel lesson).
  var RANK = { absent: 1, present: 2, correct: 3 };

  function paintKey(letter, mark) {
    var key = keyEls[letter];
    var current = key.dataset.state || "";
    if (!current || RANK[mark] > RANK[current]) {
      key.classList.remove("absent", "present", "correct");
      key.classList.add(mark);
      key.dataset.state = mark;
    }
  }

  function repaintKeys() {
    Object.keys(keyEls).forEach(function (l) {
      keyEls[l].classList.remove("absent", "present", "correct");
      keyEls[l].dataset.state = "";
    });
    guesses.forEach(function (g) {
      var marks = evaluateDivided(g.w, g.d, answer);
      for (var i = 0; i < WL; i++) paintKey(g.w[i], marks[i]);
    });
  }

  function resetBoard() {
    done = false;
    won = false;
    gaveUp = false;
    revealing = false;
    guesses = [];
    typed = Array(WL).fill("");
    div = DEFAULT_DIV;

    shareBtn.classList.add("hidden");
    buildRows();
    buildKeyboard();
    setActive(0);
    paintDivider();
    updateActions();
  }

  // Today's puzzle: resume the saved game if there is one, else start
  // fresh. Marks are pure (evaluateDivided over { w, d }), so restore
  // recomputes.
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

  // Replay saved guesses onto the fresh board with no animation: the
  // cut lands where the guess made it, the marks follow.
  function restore(saved) {
    guesses = [];
    saved.guesses.forEach(function (g) {
      var row = rowEls[guesses.length];
      var marks = evaluateDivided(g.w, g.d, answer);
      row.children[1].style.setProperty("--d", g.d);
      row.classList.add("scored");
      var tiles = tilesOf(row);
      for (var c = 0; c < WL; c++) {
        tiles[c].textContent = g.w.charAt(c);
        tiles[c].classList.add(marks[c]);
      }
      guesses.push({ w: g.w, d: g.d });
    });

    if (saved.done) {
      done = true;
      won = !!saved.won;
      gaveUp = !!saved.gaveUp;
      setActive(-1); // a finished board has no live row
      if (won) markWin(rowEls[guesses.length - 1]);
      else appendAnswerRow();
      shareBtn.classList.remove("hidden");
    } else {
      div = DEFAULT_DIV;
      setActive(guesses.length);
      paintDivider();
    }
    repaintKeys();
    updateActions();
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
    for (var c = 0; c < WL; c++) {
      if (!typed[c]) {
        typed[c] = ch;
        tilesOf(row)[c].textContent = ch;
        tilesOf(row)[c].classList.add("filled");
        return;
      }
    }
  }

  function erase() {
    var row = activeRow();
    for (var c = WL - 1; c >= 0; c--) {
      if (typed[c]) {
        typed[c] = "";
        tilesOf(row)[c].textContent = "";
        tilesOf(row)[c].classList.remove("filled");
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
    var cut = div;
    var marks = evaluateDivided(guess, cut, answer);
    var row = rowEls[r];
    tilesOf(row).forEach(function (t) {
      // A rejected attempt leaves `shake` behind; equal specificity,
      // defined after .reveal, it would override the flip — clear it.
      t.classList.remove("shake");
    });
    typed = Array(WL).fill("");
    row.classList.add("scored"); // the cut belongs to the guess now
    flipRow(row, marks);
    setTimeout(function () { finish(r, guess, cut, marks); },
      REVEAL_START + (WL - 1) * FLIP_STAGGER + FLIP_MID + 150);
  }

  // The one visual primitive: staggered flips with the mark landing at
  // the half-turn. `.reveal` never comes off at mid-turn.
  function flipRow(row, marks) {
    var tiles = tilesOf(row);
    for (var c = 0; c < WL; c++) {
      var t = tiles[c];
      setTimeout(function (tile) {
        tile.classList.remove("reveal");
        void tile.offsetWidth;
        tile.classList.add("reveal");
      }, REVEAL_START + c * FLIP_STAGGER, t);
      setTimeout(function (tile, mark) {
        tile.classList.remove("filled");
        tile.classList.add(mark);
      }, REVEAL_START + c * FLIP_STAGGER + FLIP_MID, t, marks[c]);
    }
  }

  function finish(r, guess, cut, marks) {
    guesses.push({ w: guess, d: cut });
    repaintKeys();

    var allGreen = true;
    for (var c = 0; c < WL; c++) {
      if (marks[c] !== "correct") allGreen = false;
    }

    if (allGreen) {
      done = true;
      won = true;
      markWin(rowEls[r]);
      shareBtn.classList.remove("hidden");
      setActive(-1);
      updateActions();
      saveState();
      revealing = false;
      return;
    }

    if (guesses.length === ROWS) {
      done = true; // seven cuts, never all green — the loss
      appendAnswerRow();
      shareBtn.classList.remove("hidden");
      setActive(-1);
    } else {
      div = DEFAULT_DIV; // a fresh row cuts after the second letter
      setActive(r + 1);
      paintDivider();
    }
    updateActions();
    saveState();
    revealing = false;
  }

  function giveUp() {
    if (done || revealing) return;
    var row = activeRow();
    for (var c = 0; c < WL; c++) {
      typed[c] = "";
      if (row) {
        var t = tilesOf(row)[c];
        t.textContent = "";
        t.classList.remove("filled");
      }
    }
    done = true;
    gaveUp = true;
    setActive(-1);
    appendAnswerRow();
    shareBtn.classList.remove("hidden");
    updateActions();
    saveState();
  }

  function updateActions() {
    giveUpBtn.classList.toggle("hidden", done);
  }

  // ---------- feedback ----------

  function shakeTile(tile) {
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

  function reject(msg) {
    toast(msg);
    tilesOf(activeRow()).forEach(shakeTile);
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

  // The share is what the player saw: the standard emoji grid of the
  // divided marks, each row scored at its own cut.
  function share() {
    var n = guesses.length;
    var state = won ? n + "/" + ROWS
      : (gaveUp ? "gave up \u00B7 " + n + "/" + ROWS : "X/" + ROWS);
    var title = ["Dividle", practice ? "practice" : todayKey(), state]
      .join(" \u00B7 ");
    var lines = [title, GAME_URL];
    var empty = document.documentElement.dataset.theme === "dark"
      ? "\u2B1B" : "\u2B1C";
    var GLYPH = { correct: "\uD83D\uDFE9", present: "\uD83D\uDFE8", absent: empty };
    guesses.forEach(function (g) {
      var marks = evaluateDivided(g.w, g.d, answer);
      lines.push(marks.map(function (m) { return GLYPH[m]; }).join(""));
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
    if (e.key === "ArrowLeft") { nudge(-1); return; }
    if (e.key === "ArrowRight") { nudge(1); return; }
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
  window.DIVIDLE = {
    daily: init,
    practice: startPractice,
    todayKey: todayKey,
    answerFor: answerFor,
    evaluate: evaluateDivided,
    ROWS: ROWS,
    divider: function () { return div; },
    tile: function (r, c) { return tilesOf(rowEls[r])[c]; },
    dump: function () {
      return {
        answer: answer,
        guesses: guesses.slice(),
        typed: typed.join(""),
        div: div,
        marks: guesses.map(function (g) {
          return evaluateDivided(g.w, g.d, answer);
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
