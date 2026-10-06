// Mingle — Day 23 variant of 30 Wordles.
// One puzzle per day: the answer derives from the calendar date and
// progress is saved to localStorage, so a refresh resumes the same game.
// Practice mode plays a random word without touching the daily save.
//
// A Wordle where the marks MINGLE. Each guess is scored normally
// (two-pass evaluate), but the marks are never shown — every tile's
// outline instead wears a 0-4 score counted from its NEIGHBORS in the
// row: 1 for each adjacent yellow, 2 for each adjacent green, so mid-
// word tiles max at 4 and the two ends max at 2. The outline palette
// runs in heat order: 0 gray (no neighbors), 1 red, 2 yellow, 3 blue,
// 4 green. The letters stay neutral; the outline is the whole
// message. Reading it back is the puzzle: the end tiles always confess
// positions 1 and 3 outright, and the middle tiles hand you sums —
// positions 0, 2 and 4 stay ambiguous on purpose. Five greens is the
// win, and its score line is unique: [2, 4, 4, 4, 2]. The keyboard
// never paints — direction from the neighbors is the only voice. On a
// win the row re-flips to its true fills (the victory lap), and a loss
// walks the answer on as a ghost row in full Wordle colors. No banner:
// the board is the announcement, the reveal and the share button speak
// for themselves.

(function () {
  "use strict";

  var WL = 5;
  var ROWS = 9;            // the sums hide more than colors would
  var SALT = "mingle";     // daily hash salt — each variant salts its own way
  var STORE_KEY = "mingle-day23";
  var GAME_URL = "https://suitangi.github.io/30Wordles/days/23";
  var FLIP_STAGGER = 280;  // ms between tile flips (Bundle timing)
  var FLIP_MID = 270;      // half-turn point: the outline lands here
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
  var guesses = [];        // plain words — scores are pure and recompute
  var typed = Array(WL).fill("");
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

  // ---------- the mingle ----------

  // Standard Wordle evaluation: exact matches first, then stray letters.
  // These marks are the truth the outlines gossip about — never shown
  // during play.
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

  var POINTS = { absent: 0, present: 1, correct: 2 };

  // The mingle: each tile scores its two row-neighbors — 1 per yellow,
  // 2 per green, nothing off the ends (v[-1] = v[5] = 0). Mid-word max
  // 4, end max 2. All-green reads [2, 4, 4, 4, 2], and that line is
  // UNIQUE to all-green: s0 = s4 = 2 pins v1 = v3 = green, and s1 = s3
  // = 4 then pins v0 = v2 = v4 = green. The win is readable.
  function scoreRow(marks) {
    var v = marks.map(function (m) { return POINTS[m]; });
    var s = [];
    for (var i = 0; i < WL; i++) {
      s.push((i > 0 ? v[i - 1] : 0) + (i < WL - 1 ? v[i + 1] : 0));
    }
    return s;
  }

  // ---------- board ----------

  function activeRow() { return rowEls[guesses.length]; }

  // Rows grow on demand inside the shared scroll window — plain
  // five-tile rows; the outline carries everything.
  function addRow() {
    var row = document.createElement("div");
    row.className = quietRows ? "mingrow quiet" : "mingrow";
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

  // The loss reveal: the answer walks on in FULL Wordle colors — the
  // truth the outlines never told.
  function appendAnswerRow() {
    var row = document.createElement("div");
    row.className = "mingrow answer" + (quietRows ? " quiet" : "");
    var marks = evaluate(answer, answer);
    for (var c = 0; c < WL; c++) {
      var tile = document.createElement("div");
      tile.className = "tile " + marks[c];
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
  // fresh. Scores are pure (evaluate + scoreRow), so restore recomputes.
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
      var scores = scoreRow(evaluate(w, answer));
      for (var c = 0; c < WL; c++) {
        row.children[c].textContent = w.charAt(c);
        row.children[c].classList.add("filled", "sc" + scores[c]);
      }
      guesses.push(w);
    });

    if (saved.done) {
      done = true;
      won = !!saved.won;
      gaveUp = !!saved.gaveUp;
      if (won) {
        // restored boards paint finished, not animated: the win row
        // goes straight to its true fills, no re-flip
        var winRow = rowEls[guesses.length - 1];
        var marks = evaluate(guesses[guesses.length - 1], answer);
        for (var c = 0; c < WL; c++) {
          var wt = winRow.children[c];
          wt.classList.remove("filled", "sc0", "sc1", "sc2", "sc3", "sc4");
          wt.classList.add(marks[c]);
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
    var marks = evaluate(guess, answer);
    var scores = scoreRow(marks);
    var row = rowEls[r];
    for (var c = 0; c < WL; c++) {
      // A rejected attempt leaves `shake` behind; equal specificity,
      // defined after .reveal, it would override the flip — clear it.
      row.children[c].classList.remove("shake");
    }
    typed = Array(WL).fill("");
    flipRow(r, scores, REVEAL_START);
    setTimeout(function () { finish(r, guess, marks); },
      REVEAL_START + (WL - 1) * FLIP_STAGGER + FLIP_MID + 150);
  }

  // The one visual primitive: staggered flips with the OUTLINE landing
  // at the half-turn — the score class swaps where every other day
  // lands its mark. Pass fills (true marks) instead for the win's
  // victory lap. `.reveal` never comes off at mid-turn; a landed reveal
  // restarts via remove → reflow → add.
  function flipRow(rowIdx, scores, startAt) {
    var row = rowEls[rowIdx];
    for (var c = 0; c < WL; c++) {
      var t = row.children[c];
      setTimeout(function (tile) {
        tile.classList.remove("reveal");
        void tile.offsetWidth;
        tile.classList.add("reveal");
      }, startAt + c * FLIP_STAGGER, t);
      setTimeout(function (tile, score) {
        tile.classList.remove("sc0", "sc1", "sc2", "sc3", "sc4");
        tile.classList.add("sc" + score);
      }, startAt + c * FLIP_STAGGER + FLIP_MID, t, scores[c]);
    }
  }

  // The victory lap: the mingled outlines lift and the row re-flips to
  // its true fills — the answer the neighbors were only gossiping about.
  function paintTrue(rowIdx, marks) {
    var row = rowEls[rowIdx];
    for (var c = 0; c < WL; c++) {
      var t = row.children[c];
      setTimeout(function (tile) {
        tile.classList.remove("reveal");
        void tile.offsetWidth;
        tile.classList.add("reveal");
      }, REVEAL_START + c * FLIP_STAGGER, t);
      setTimeout(function (tile, mark) {
        tile.classList.remove("filled", "sc0", "sc1", "sc2", "sc3", "sc4");
        tile.classList.add(mark);
      }, REVEAL_START + c * FLIP_STAGGER + FLIP_MID, t, marks[c]);
    }
  }

  function finish(r, guess, marks) {
    guesses.push(guess);

    var allGreen = true;
    for (var c = 0; c < WL; c++) {
      if (marks[c] !== "correct") allGreen = false;
    }

    if (allGreen) {
      done = true;
      won = true;
      // revealing holds through the victory lap; wrapUp glows and saves
      // when the fills are down
      revealing = true;
      paintTrue(r, marks);
      setTimeout(function () {
        markWin(rowEls[r]);
        shareBtn.classList.remove("hidden");
        updateActions();
        saveState();
        revealing = false;
      }, REVEAL_START + (WL - 1) * FLIP_STAGGER + FLIP_MID + 150);
      return;
    }

    if (guesses.length === ROWS) {
      done = true; // nine gossip lines, never all green — the loss
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

  // ---------- feedback ----------

  // The keyboard never paints — the mingled outlines are the only voice,
  // and a key color would leak what the neighbors were hiding.

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

  // The share is what the player saw: five score digits per guess, the
  // record of the gossip — never the true marks behind them.
  function share() {
    var n = guesses.length;
    var state = won ? n + "/" + ROWS
      : (gaveUp ? "gave up \u00B7 " + n + "/" + ROWS : "X/" + ROWS);
    var title = ["Mingle", practice ? "practice" : todayKey(), state]
      .join(" \u00B7 ");
    var lines = [title, GAME_URL];
    guesses.forEach(function (w) {
      var scores = scoreRow(evaluate(w, answer));
      lines.push(scores.join(" "));
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
  window.MINGLE = {
    daily: init,
    practice: startPractice,
    todayKey: todayKey,
    answerFor: answerFor,
    evaluate: evaluate,
    scoreRow: scoreRow,
    ROWS: ROWS,
    tile: function (r, c) { return rowEls[r].children[c]; },
    dump: function () {
      return {
        answer: answer,
        guesses: guesses.slice(),
        typed: typed.join(""),
        scores: guesses.map(function (w) {
          return scoreRow(evaluate(w, answer));
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
