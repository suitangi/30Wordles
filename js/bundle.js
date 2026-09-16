// Bundle — Day 1 variant of 30 Wordles.
// One puzzle per day: the answer is derived from the calendar date and
// progress is saved to localStorage, so a refresh resumes the same game
// mid-board, exactly like real Wordle. A Practice mode plays random words
// without touching the daily save.
//
// Each guess is bundled to the next: one shared letter travels down the same
// column, and the two connected tiles render as a single 1x2 rectangle.
(function () {
  "use strict";

  var ROWS = 6;
  var COLS = 5;
  // Shared column (0-indexed) between row i and row i+1:
  // 2nd, 4th, 3rd, 1st, then 5th letter.
  var CHAIN = [1, 3, 2, 0, 4];
  var PRAISE = ["Genius", "Magnificent", "Impressive", "Splendid", "Great", "Phew"];
  var FLIP_STAGGER = 280; // ms between tile flips
  var FLIP_MID = 270;     // half-turn point: the score color appears here
  var STORE_KEY = "bundle-day1";
  var GAME_URL = "https://suitangi.github.io/30Wordles/days/1";

  var ANSWERS = window.WORD_LISTS.answers;
  var DICTIONARY = new Set(window.WORD_LISTS.guesses);

  var boardEl = document.getElementById("board");
  var keyboardEl = document.getElementById("keyboard");
  var bannerEl = document.getElementById("banner");
  var toastEl = document.getElementById("toast");
  var newBtn = document.getElementById("new-btn");
  var shareBtn = document.getElementById("share-btn");

  var answer = "";
  var row = 0;            // active row
  var done = false;
  var won = false;
  var revealing = false;
  var practice = false;
  var guesses = [];       // submitted guesses this game
  var letters = [];       // letters[r][c]
  var locked = [];        // locked[r][c] — carried tiles
  var tileEls = [];       // tileEls[r][c] — halves inside pairs for chain columns
  var pairEls = [];       // pairEls[i] — bundled rectangle between rows i, i+1
  var keyEls = {};        // letter -> key button
  var toastTimer = null;

  // ---------- daily puzzle ----------

  function todayKey() {
    var d = new Date();
    return d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
  }

  // Deterministic daily answer: same word for everyone, changes at midnight.
  function answerFor(key) {
    var h = 0;
    for (var i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
    return ANSWERS[h % ANSWERS.length];
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
        won: won
      }));
    } catch (e) { /* storage unavailable — game still playable */ }
  }

  // ---------- setup ----------

  function resetBoard() {
    row = 0;
    done = false;
    won = false;
    revealing = false;
    guesses = [];
    letters = [];
    locked = [];
    tileEls = [];
    pairEls = [];

    boardEl.innerHTML = "";
    bannerEl.classList.remove("show");
    bannerEl.textContent = "";
    shareBtn.classList.add("hidden");

    for (var r = 0; r < ROWS; r++) {
      letters.push(Array(COLS).fill(""));
      locked.push(Array(COLS).fill(false));
      tileEls.push(Array(COLS).fill(null));
    }

    // Connected columns: one rectangle spanning both rows and the seam.
    for (var i = 0; i < ROWS - 1; i++) {
      var pair = document.createElement("div");
      pair.className = "pair chain";
      pair.style.gridColumn = String(CHAIN[i] + 1);
      pair.style.gridRow = 2 * i + 1 + " / span 3";

      var top = document.createElement("div");
      top.className = "tile";
      var bottom = document.createElement("div");
      bottom.className = "tile";
      pair.appendChild(top);
      pair.appendChild(bottom);

      boardEl.appendChild(pair);
      pairEls.push(pair);
      tileEls[i][CHAIN[i]] = top;
      tileEls[i + 1][CHAIN[i]] = bottom;
    }

    // Every other position: a plain square tile.
    for (var r2 = 0; r2 < ROWS; r2++) {
      for (var c = 0; c < COLS; c++) {
        if (tileEls[r2][c]) continue;
        var tile = document.createElement("div");
        tile.className = "tile";
        tile.style.gridColumn = String(c + 1);
        tile.style.gridRow = String(2 * r2 + 1);
        boardEl.appendChild(tile);
        tileEls[r2][c] = tile;
      }
    }

    buildKeyboard();
  }

  // Today's puzzle: resume the saved game if there is one, else start fresh.
  function init() {
    practice = false;
    newBtn.textContent = "Practice";
    var key = todayKey();
    var saved = loadSaved();
    if (saved && saved.date === key && saved.answer && DICTIONARY.has(saved.answer)) {
      answer = saved.answer;
      resetBoard();
      restore(saved);
    } else {
      answer = answerFor(key);
      resetBoard();
      saveState();
    }
  }

  // Random word, never saved — the daily game stays untouched.
  function startPractice() {
    practice = true;
    answer = ANSWERS[Math.floor(Math.random() * ANSWERS.length)];
    resetBoard();
    newBtn.textContent = "Today\u2019s puzzle";
    showBanner("Practice round");
  }

  // Replay saved guesses onto the fresh board, with no reveal animation.
  function restore(saved) {
    guesses = saved.guesses.slice();
    for (var r = 0; r < guesses.length; r++) {
      letters[r] = guesses[r].split("");
      if (r > 0) {
        var pc = CHAIN[r - 1];
        letters[r][pc] = letters[r - 1][pc];
        locked[r][pc] = true;
      }
      var marks = evaluate(guesses[r], answer);
      for (var c = 0; c < COLS; c++) {
        var t = tileEls[r][c];
        t.textContent = letters[r][c];
        t.classList.add(marks[c]);
      }
      for (var k = 0; k < COLS; k++) paintKey(letters[r][k], marks[k]);
    }

    if (saved.done || guesses.length >= ROWS) {
      done = true;
      won = !!saved.won;
      row = guesses.length - 1;
      for (var pi = 0; pi < ROWS - 1; pi++) setPairState(pi, "spent");
      showBanner(won ? PRAISE[row] : "The word was " + answer.toUpperCase());
      shareBtn.classList.remove("hidden");
    } else {
      row = guesses.length;
      for (var pj = 0; pj < row - 1; pj++) setPairState(pj, "spent");
      if (row > 0) {
        var ac = CHAIN[row - 1];
        var ch = letters[row - 1][ac];
        letters[row][ac] = ch;
        locked[row][ac] = true;
        var at = tileEls[row][ac];
        at.textContent = ch;
        at.classList.add("carried");
        setPairState(row - 1, "armed");
      }
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

  // ---------- input ----------

  function onKey(key) {
    if (done || revealing) return;
    if (key === "Enter") { submit(); return; }
    if (key === "Backspace") { erase(); return; }
    if (/^[a-z]$/.test(key)) typeLetter(key);
  }

  function typeLetter(ch) {
    for (var c = 0; c < COLS; c++) {
      if (!locked[row][c] && !letters[row][c]) {
        letters[row][c] = ch;
        tileEls[row][c].textContent = ch;
        tileEls[row][c].classList.add("filled");
        return;
      }
    }
  }

  function erase() {
    for (var c = COLS - 1; c >= 0; c--) {
      if (!locked[row][c] && letters[row][c]) {
        letters[row][c] = "";
        var tile = tileEls[row][c];
        tile.textContent = "";
        tile.classList.remove("filled");
        return;
      }
    }
  }

  // ---------- submitting a guess ----------

  function submit() {
    var guess = letters[row].join("");
    if (guess.length < COLS) { reject("Not enough letters"); return; }
    if (!DICTIONARY.has(guess)) { reject("Not in word list"); return; }

    revealing = true;
    var rowIdx = row;
    var marks = evaluate(guess, answer);
    // A rejected attempt leaves `shake` behind; equal specificity, defined
    // after .reveal, it would override the flip — clear it first.
    tileEls[rowIdx].forEach(function (t) { t.classList.remove("shake"); });
    marks.forEach(function (mark, c) {
      var t = tileEls[rowIdx][c];
      // Flip first; the score color lands at the half-turn, like Wordle.
      setTimeout(function () { t.classList.add("reveal"); },
        100 + c * FLIP_STAGGER);
      setTimeout(function () {
        t.classList.remove("filled", "carried");
        t.classList.add(mark);
      }, 100 + c * FLIP_STAGGER + FLIP_MID);
    });
    setTimeout(function () { finish(rowIdx, marks); },
      100 + (COLS - 1) * FLIP_STAGGER + FLIP_MID + 150);
  }

  // Standard Wordle evaluation: exact matches first, then stray letters.
  function evaluate(guess, target) {    var marks = Array(COLS).fill("absent");
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

  function finish(rowIdx, marks) {
    marks.forEach(function (mark, c) { paintKey(letters[rowIdx][c], mark); });

    // The lower half of the rectangle above this row just got scored.
    if (rowIdx > 0) setPairState(rowIdx - 1, "spent");

    guesses.push(letters[rowIdx].join(""));

    if (letters[rowIdx].join("") === answer) {
      done = true;
      won = true;
      showBanner(PRAISE[rowIdx]);
      shareBtn.classList.remove("hidden");
    } else if (rowIdx === ROWS - 1) {
      done = true;
      showBanner("The word was " + answer.toUpperCase());
      shareBtn.classList.remove("hidden");
    } else {
      carry(rowIdx);
      row = rowIdx + 1;
    }
    saveState();
    revealing = false;
  }

  // The bundle tightens: copy the shared letter down into the next row.
  function carry(fromRow) {
    var col = CHAIN[fromRow];
    var ch = letters[fromRow][col];
    letters[fromRow + 1][col] = ch;
    locked[fromRow + 1][col] = true;
    var tile = tileEls[fromRow + 1][col];
    tile.textContent = ch;
    tile.classList.add("carried");
    setPairState(fromRow, "armed");
  }

  function setPairState(i, state) {
    var pair = pairEls[i];
    pair.classList.remove("chain", "armed", "spent");
    pair.classList.add(state);
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
    tileEls[row].forEach(function (t) {
      t.classList.remove("shake");
      void t.offsetWidth; // restart the animation
      t.classList.add("shake");
      // Drop the class once played, or it overrides the later flip animation.
      t.addEventListener("animationend", function h(ev) {
        if (ev.animationName !== "shake") return;
        t.removeEventListener("animationend", h);
        t.classList.remove("shake");
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

  function share() {
    var emptyCell = document.documentElement.dataset.theme === "dark" ? "\u2B1B" : "\u2B1C";
    var EMOJI = { correct: "\uD83D\uDFE9", present: "\uD83D\uDFE8", absent: emptyCell };
    var title = ["Bundle", practice ? "practice" : todayKey(),
      (won ? row + 1 : "X") + "/6"].join(" \u00B7 ");
    var lines = [title, GAME_URL];
    for (var r = 0; r < ROWS; r++) {
      if (!letters[r].some(Boolean)) break;
      lines.push(letters[r].map(function (ch, c) {
        var mark = evaluate(letters[r].join(""), answer)[c];
        return EMOJI[mark];
      }).join(""));
    }
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
  shareBtn.addEventListener("click", function () { shareBtn.blur(); share(); });

  init();

  // Small console/test surface.
  window.BUNDLE = {
    daily: init,
    practice: startPractice,
    todayKey: todayKey,
    answerFor: answerFor
  };
})();
