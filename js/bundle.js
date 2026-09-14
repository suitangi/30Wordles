// Bundle — Day 1 variant of 30 Wordles.
// Plain Wordle, except each guess is bundled to the next: one shared letter
// travels down the same column, and the two connected tiles render as a
// single 1x2 rectangle that arrives prefilled and locked.
(function () {
  "use strict";

  var ROWS = 6;
  var COLS = 5;
  // Shared column (0-indexed) between row i and row i+1:
  // 2nd, 4th, 3rd, 1st, then 5th letter.
  var CHAIN = [1, 3, 2, 0, 4];
  var PRAISE = ["Genius", "Magnificent", "Impressive", "Splendid", "Great", "Phew"];
  var FLIP_STEP = 280;

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
  var letters = [];       // letters[r][c]
  var locked = [];        // locked[r][c] — carried tiles
  var tileEls = [];       // tileEls[r][c] — halves inside pairs for chain columns
  var pairEls = [];       // pairEls[i] — bundled rectangle between rows i, i+1
  var keyEls = {};        // letter -> key button
  var toastTimer = null;

  // ---------- setup ----------

  function init() {
    answer = ANSWERS[Math.floor(Math.random() * ANSWERS.length)];
    row = 0;
    done = false;
    won = false;
    revealing = false;
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
        btn.addEventListener("click", function () { onKey(k); });
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
    marks.forEach(function (mark, c) {
      setTimeout(function () {
        var tile = tileEls[rowIdx][c];
        tile.classList.remove("filled", "carried");
        tile.classList.add("reveal", mark);
      }, FLIP_STEP + c * FLIP_STEP);
    });
    setTimeout(function () { finish(rowIdx, marks); },
      FLIP_STEP + COLS * FLIP_STEP + 120);
  }

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

  function finish(rowIdx, marks) {
    marks.forEach(function (mark, c) { paintKey(letters[rowIdx][c], mark); });

    // The lower half of the rectangle above this row just got scored.
    if (rowIdx > 0) setPairState(rowIdx - 1, "spent");

    if (letters[rowIdx].join("") === answer) {
      done = true;
      won = true;
      showBanner(PRAISE[rowIdx]);
      shareBtn.classList.remove("hidden");
      revealing = false;
      return;
    }
    if (rowIdx === ROWS - 1) {
      done = true;
      showBanner("The word was " + answer.toUpperCase());
      shareBtn.classList.remove("hidden");
      revealing = false;
      return;
    }
    carry(rowIdx);
    row = rowIdx + 1;
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
    var lines = ["Bundle (Day 1) " + (won ? row + 1 : "X") + "/6"];
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
    else if (e.key === "Enter" || e.key === "Backspace") onKey(e.key);
  });

  newBtn.addEventListener("click", init);
  shareBtn.addEventListener("click", share);

  init();
})();
