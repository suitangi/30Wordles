// Crumble — Day 6 variant of 30 Wordles.
// One puzzle per day: the answer derives from the calendar date and progress
// is saved to localStorage, so a refresh resumes the same game. Practice
// mode plays a random word without touching the daily save.
//
// A Wordle that stacks, Tetris-style. The board is a 5-wide well; your word
// waits in the queue slot at the top and falls as one piece when you press
// Enter, landing flat on the pile. Landing tiles score like Wordle — then
// gravity takes over: grey tiles crumble to dust, and every survivor sinks
// down its own column until it rests on the pile (nothing ever floats).
// A yellow that settles directly onto another yellow annihilates with it —
// both vanish. The game is won only when the settling leaves the answer
// reading fully horizontal somewhere in the pile: a typed answer can
// scatter as it sinks, so sometimes you have to build the row piece by
// piece. The well is 5×8 and does not grow — if the pile reaches the top
// it overflows and the game ends. Guesses are unlimited until then; give
// up anytime.
(function () {
  "use strict";

  var COLS = 5;
  var SALT = "crumble"; // daily hash salt — each variant salts its own way
  var STORE_KEY = "crumble-day6";
  var GAME_URL = "https://suitangi.github.io/30Wordles/days/6";
  var WELL_ROWS = 8;   // the grid: 5 wide, 8 deep — pile to the top = loss
  var GAP = 5;         // px between tiles — keep in sync with the CSS

  // The drop timeline (ms, from Enter): the piece falls from the queue,
  // marks ripple in at impact, the dust sweep takes the grey, survivors
  // sink down their columns, yellow-on-yellow pairs annihilate, then the
  // well settles and the queue refills.
  var MARK_RIPPLE = 40;
  var CRUMBLE_AT = 300;
  var CRUMBLE_STAGGER = 70;
  var SETTLE_AT = 720;
  var SETTLE_PER_ROW = 60;
  var CANCEL_TAIL = 500;  // shatter time after the sink completes
  var FINISH_AT = 1750;   // earliest the well settles back to input

  var ANSWERS = window.WORD_LISTS.answers;
  var DICTIONARY = new Set(window.WORD_LISTS.guesses);

  var wellEl = document.getElementById("well");
  var queueEl = document.getElementById("queue");
  var shaftEl = document.getElementById("shaft");
  var ghostsEl = document.getElementById("ghosts");
  var bannerEl = document.getElementById("banner");
  var toastEl = document.getElementById("toast");
  var newBtn = document.getElementById("new-btn");
  var giveUpBtn = document.getElementById("giveup-btn");
  var shareBtn = document.getElementById("share-btn");
  var keyboardEl = document.getElementById("keyboard");

  var answer = "";
  var done = false;
  var won = false;
  var gaveUp = false;
  var overflow = false; // the pile reached the top of the well — game over
  var revealing = false;
  var practice = false;
  var guesses = [];      // { w, m } — in drop order, for save + share
  var typed = [];        // the queue's letters
  var queueTiles = [];
  var cols = [[], [], [], [], []]; // the pile: per column, { ch, mark, el }
  var keyEls = {};
  var toastTimer = null;

  var RANK = { absent: 1, present: 2, correct: 3 };

  // ---------- scoring ----------

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

  // Replay a whole game's marks through the well. Per guess it reports the
  // flat landing row (one above the terrain's highest column) and, per
  // column, what became of the tile: crumbled, settled to a row, or
  // cancelled with the yellow it came to rest on. Pure — restore replays
  // it, live play consults it, tests spec it.
  function simulate(allMarks) {
    var heights = [0, 0, 0, 0, 0];
    var tops = [[], [], [], [], []]; // mark per height, per column
    var frames = [];
    allMarks.forEach(function (marks) {
      var base = Math.max(heights[0], heights[1], heights[2], heights[3],
        heights[4]);
      var cells = [];
      for (var c = 0; c < COLS; c++) {
        var m = marks[c];
        if (m === "absent") {
          cells.push({ fate: "crumble", row: base });
        } else if (m === "present" && heights[c] > 0 &&
                   tops[c][heights[c] - 1] === "present") {
          // settles onto a yellow: the pair annihilates
          tops[c].pop();
          heights[c]--;
          cells.push({ fate: "cancel", row: heights[c] + 1 });
        } else {
          tops[c].push(m);
          heights[c]++;
          cells.push({ fate: "settle", row: heights[c] - 1 });
        }
      }
      frames.push({ base: base, cells: cells });
    });
    return frames;
  }

  // ---------- daily puzzle ----------

  function todayKey() {
    var d = new Date();
    return d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
  }

  function hash(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
  }

  function answerFor(key) {
    return ANSWERS[hash(SALT + key) % ANSWERS.length];
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
        gaveUp: gaveUp,
        overflow: overflow
      }));
    } catch (e) { /* storage unavailable — game still playable */ }
  }

  // ---------- the well ----------

  function buildQueue() {
    queueEl.innerHTML = "";
    queueTiles = [];
    for (var c = 0; c < COLS; c++) {
      var tile = document.createElement("div");
      tile.className = "tile";
      queueEl.appendChild(tile);
      queueTiles.push(tile);
    }
  }

  function pitch() {
    return (queueTiles[0] ? queueTiles[0].offsetWidth : 0) + GAP;
  }

  // The well is a fixed 5×8 grid — it never grows. Height is px; rows are
  // square, measured off a queue tile.
  function renderWell() {
    var p = pitch();
    shaftEl.style.height = (WELL_ROWS * p - GAP) + "px";

    ghostsEl.innerHTML = "";
    for (var r = 0; r < WELL_ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        var cell = document.createElement("div");
        cell.className = "cell";
        cell.style.setProperty("--c", c);
        cell.style.setProperty("--r", r);
        ghostsEl.appendChild(cell);
      }
    }
  }

  // A pile tile lives at column c, row r (r = 0 is the floor). Tiles are
  // absolutely positioned; --c/--r feed the transform, --td the transition
  // duration so falls and settles animate.
  function makePileTile(ch, c, r) {
    var tile = document.createElement("div");
    tile.className = "tile pile-tile";
    tile.textContent = ch;
    tile.dataset.letter = ch;
    tile.style.setProperty("--c", c);
    tile.style.setProperty("--r", r);
    shaftEl.appendChild(tile);
    return tile;
  }

  function resetBoard() {
    done = false;
    won = false;
    gaveUp = false;
    overflow = false;
    revealing = false;
    guesses = [];
    typed = Array(COLS).fill("");
    cols = [[], [], [], [], []];

    shaftEl.innerHTML = "";
    wellEl.classList.remove("done");
    buildQueue();
    buildKeyboard();
    renderWell();
    bannerEl.classList.remove("show");
    bannerEl.textContent = "";
    shareBtn.classList.add("hidden");
    updateActions();
  }

  // Today's puzzle: resume the saved game if there is one, else start fresh.
  function init() {
    practice = false;
    newBtn.textContent = "Practice";
    var key = todayKey();
    var saved = loadSaved();
    if (saved && saved.date === key && validAnswer(saved.answer)) {
      answer = saved.answer;
      resetBoard();
      restore(saved);
    } else {
      answer = answerFor(key);
      resetBoard();
      saveState();
    }
  }

  // Random word, never saved — the daily game stays untouched. A forced
  // word ("crane") is the debugging backdoor.
  function startPractice(force) {
    practice = true;
    answer = validAnswer(force) ? force
      : ANSWERS[Math.floor(Math.random() * ANSWERS.length)];
    resetBoard();
    newBtn.textContent = "Today\u2019s puzzle";
    showBanner("Practice round");
  }

  // Replay saved guesses onto the empty well with no animation: the
  // simulate frames say exactly which tiles survived and where they rest.
  function restore(saved) {
    guesses = [];
    saved.guesses.forEach(function (g) {
      guesses.push({ w: g.w, m: g.m.slice() });
    });
    var frames = simulate(guesses.map(function (g) { return g.m; }));
    guesses.forEach(function (g, gi) {
      var frame = frames[gi];
      for (var c = 0; c < COLS; c++) {
        var cell = frame.cells[c];
        paintKey(g.w.charAt(c), g.m[c]);
        if (cell.fate === "settle") {
          var el = makePileTile(g.w.charAt(c), c, cell.row);
          el.classList.add(g.m[c]);
          cols[c].push({ ch: g.w.charAt(c), mark: g.m[c], el: el });
        }
      }
    });
    renderWell();

    if (saved.done) {
      done = true;
      won = !!saved.won;
      gaveUp = !!saved.gaveUp;
      overflow = !!saved.overflow;
      var winRow = won ? scanWin(cols, answer) : -1;
      if (winRow >= 0) {
        for (var w = 0; w < COLS; w++) {
          cols[w][winRow].el.classList.add("winline");
        }
      }
      wellEl.classList.add("done");
      showBanner(endBanner());
      shareBtn.classList.remove("hidden");
    }
    updateActions();
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

  // ---------- input (into the queue at the top of the well) ----------

  function onKey(key) {
    if (done || revealing) return;
    if (key === "Enter") { submit(); return; }
    if (key === "Backspace") { erase(); return; }
    if (/^[a-z]$/.test(key)) typeLetter(key);
  }

  function typeLetter(ch) {
    for (var c = 0; c < COLS; c++) {
      if (!typed[c]) {
        typed[c] = ch;
        queueTiles[c].textContent = ch;
        queueTiles[c].classList.add("filled");
        return;
      }
    }
  }

  function erase() {
    for (var c = COLS - 1; c >= 0; c--) {
      if (typed[c]) {
        typed[c] = "";
        queueTiles[c].textContent = "";
        queueTiles[c].classList.remove("filled");
        return;
      }
    }
  }

  // ---------- dropping a piece ----------

  function submit() {
    var guess = typed.join("");
    if (guess.length < COLS) { reject("Not enough letters"); return; }
    if (!DICTIONARY.has(guess)) { reject("Not in word list"); return; }

    revealing = true;
    var marks = evaluate(guess, answer);
    for (var q = 0; q < COLS; q++) {
      queueTiles[q].textContent = "";
      queueTiles[q].classList.remove("filled");
      // A rejected attempt leaves `shake` behind; clear it before the drop.
      queueTiles[q].classList.remove("shake");
    }

    var rowIdx = guesses.length;
    var allMarks = guesses.map(function (g) { return g.m; }).concat([marks]);
    var frame = simulate(allMarks)[rowIdx];

    // Grow the shaft first so the landing row and the spawn slot both fit.
    renderWell();
    var spawnRow = WELL_ROWS - 1;
    var fallRows = spawnRow - frame.base;
    var dur = 260 + Math.min(360, fallRows * 55);

    // Spawn the piece at the queue slot, then let it fall to the terrain.
    var tiles = [];
    for (var c = 0; c < COLS; c++) {
      tiles.push(makePileTile(guess.charAt(c), c, spawnRow));
    }
    void shaftEl.offsetWidth; // commit the spawn position before falling
    for (var f = 0; f < COLS; f++) {
      tiles[f].style.setProperty("--td", dur + "ms");
      tiles[f].style.setProperty("--r", frame.base);
      tiles[f].style.setProperty("--ease", "cubic-bezier(0.55, 0, 0.85, 0.4)");
    }

    // Marks ripple in at impact.
    for (var i = 0; i < COLS; i++) {
      (function (tile, mark) {
        setTimeout(function () { tile.classList.add(mark); },
          dur + MARK_RIPPLE * i);
      })(tiles[i], marks[i]);
    }

    // The dust sweep takes the grey out of the landed row.
    for (var k = 0; k < COLS; k++) {
      if (marks[k] === "absent") {
        (function (tile) {
          setTimeout(function () { tile.classList.add("crumble"); },
            dur + CRUMBLE_AT + CRUMBLE_STAGGER * k);
        })(tiles[k]);
      }
    }

    // Survivors sink down their columns; a yellow coming to rest on a
    // yellow takes the pair with it.
    var settleRows = 0;
    var cancels = [];
    for (var s = 0; s < COLS; s++) {
      var cell = frame.cells[s];
      if (cell.fate === "crumble") continue;
      var drop = frame.base - cell.row;
      settleRows = Math.max(settleRows, drop);
      if (cell.fate === "cancel") cancels.push({ col: s, tile: tiles[s] });
      (function (tile, row, ms) {
        setTimeout(function () {
          tile.style.setProperty("--td", ms + "ms");
          tile.style.setProperty("--ease", "cubic-bezier(0.6, 0, 0.8, 0.5)");
          tile.style.setProperty("--r", row);
        }, dur + SETTLE_AT);
      })(tiles[s], cell.row, 120 + drop * SETTLE_PER_ROW);
    }

    // After the sink, each cancelled tile erodes together with the yellow
    // it landed on (the column top beneath it).
    var settleDone = dur + SETTLE_AT + 120 + settleRows * SETTLE_PER_ROW + 60;
    cancels.forEach(function (pair) {
      setTimeout(function () {
        var col = cols[pair.col];
        var top = col[col.length - 1];
        [pair.tile, top ? top.el : null].forEach(function (el) {
          if (!el) return;
          el.classList.add("cancel");
        });
      }, settleDone);
    });

    setTimeout(function () { finish(tiles, guess, marks, frame, rowIdx); },
      Math.max(settleDone + CANCEL_TAIL, dur + FINISH_AT));
  }

  // The win: the answer reading left-to-right on one full row of the
  // settled pile — any row, any height. Returns the winning row or -1.
  function scanWin(pile, target) {
    var maxH = 0;
    for (var c = 0; c < COLS; c++) {
      maxH = Math.max(maxH, pile[c].length);
    }
    for (var h = 0; h < maxH; h++) {
      var full = true;
      for (var k = 0; k < COLS; k++) {
        if (!pile[k][h] || pile[k][h].ch !== target.charAt(k)) {
          full = false;
          break;
        }
      }
      if (full) return h;
    }
    return -1;
  }

  function finish(tiles, guess, marks, frame, rowIdx) {
    for (var c = 0; c < COLS; c++) {
      // The keyboard keeps every mark, even from swallowed tiles — grey
      // knowledge is knowledge.
      paintKey(guess.charAt(c), marks[c]);
      var cell = frame.cells[c];
      var t = tiles[c];
      if (cell.fate === "crumble") {
        t.remove();
      } else if (cell.fate === "cancel") {
        t.remove();
        var top = cols[c][cols[c].length - 1];
        if (top) {
          top.el.remove();
          cols[c].pop();
        }
      } else {
        t.classList.remove("crumble", "cancel");
        t.style.setProperty("--td", "0ms");
        cols[c].push({ ch: guess.charAt(c), mark: marks[c], el: t });
      }
    }
    typed = Array(COLS).fill("");
    guesses.push({ w: guess, m: marks });

    // A typed answer doesn't win by landing — its tiles sink and scatter
    // with everything else. The game is won only when the settling leaves
    // the answer reading fully horizontal somewhere in the pile.
    var winRow = scanWin(cols, answer);
    if (winRow >= 0) {
      done = true;
      won = true;
      for (var w = 0; w < COLS; w++) {
        cols[w][winRow].el.classList.add("winline");
      }
      wellEl.classList.add("done");
      showBanner(endBanner());
      shareBtn.classList.remove("hidden");
    } else {
      // Tetris rules: pile touching the top of the well overflows it.
      var maxH = 0;
      for (var h = 0; h < COLS; h++) {
        maxH = Math.max(maxH, cols[h].length);
      }
      if (maxH >= WELL_ROWS) {
        done = true;
        overflow = true;
        wellEl.classList.add("done");
        showBanner(endBanner());
        shareBtn.classList.remove("hidden");
      }
    }
    renderWell();
    updateActions();
    saveState();
    revealing = false;
  }

  function endBanner() {
    if (overflow) {
      return "The well overflowed \u2014 the word was " + answer.toUpperCase();
    }
    if (!won) return "The word was " + answer.toUpperCase();
    var n = guesses.length;
    var count = n + (n === 1 ? " guess" : " guesses");
    // "Phew" is for escaping by inches now: a win with the pile six or
    // more rows up the eight-row well. Shallow wins keep the count ladder.
    var depth = 0;
    for (var c = 0; c < COLS; c++) depth = Math.max(depth, cols[c].length);
    if (depth >= WELL_ROWS - 2) return "Phew \u2014 " + count;
    var praise = ["Genius", "Magnificent", "Impressive", "Splendid",
      "Great"][Math.min(n - 1, 4)];
    return praise + " \u2014 " + count;
  }

  // Voluntary loss: end the game, reveal the answer, freeze the well. (The
  // involuntary loss is the overflow — pile reaching the top of the well.)
  function giveUp() {
    if (done || revealing) return;
    done = true;
    gaveUp = true;
    typed = Array(COLS).fill("");
    for (var q = 0; q < COLS; q++) {
      queueTiles[q].textContent = "";
      queueTiles[q].classList.remove("filled");
    }
    wellEl.classList.add("done");
    showBanner(endBanner());
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
    queueTiles.forEach(function (tile) {
      tile.classList.remove("shake");
      void tile.offsetWidth; // restart the animation
      tile.classList.add("shake");
      // Drop the class once played, or it lingers over the next drop.
      tile.addEventListener("animationend", function h(ev) {
        if (ev.animationName !== "shake") return;
        tile.removeEventListener("animationend", h);
        tile.classList.remove("shake");
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

  // Full Wordle squares per guess, in drop order — what each guess scored,
  // including tiles the well went on to swallow.
  function share() {
    var emptyCell = document.documentElement.dataset.theme === "dark" ? "\u2B1B" : "\u2B1C";
    var EMOJI = { correct: "\uD83D\uDFE9", present: "\uD83D\uDFE8", absent: emptyCell };
    var n = guesses.length;
    var count = n + (n === 1 ? " guess" : " guesses");
    var title = ["Crumble", practice ? "practice" : todayKey(),
      gaveUp ? "gave up \u00B7 " + count
        : overflow ? "overflowed \u00B7 " + count : count]
      .join(" \u00B7 ");
    var lines = [title, GAME_URL];
    guesses.forEach(function (g) {
      lines.push(g.m.map(function (mark) { return EMOJI[mark]; }).join(""));
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

  window.addEventListener("resize", function () { renderWell(); });

  newBtn.addEventListener("click", function () {
    newBtn.blur();
    if (practice) init(); else startPractice();
  });
  giveUpBtn.addEventListener("click", function () { giveUpBtn.blur(); giveUp(); });
  shareBtn.addEventListener("click", function () { shareBtn.blur(); share(); });

  init();

  // Small console/test surface.
  window.CRUMBLE = {
    daily: init,
    practice: startPractice,
    todayKey: todayKey,
    answerFor: answerFor,
    evaluate: evaluate,
    simulate: simulate,
    scanWin: scanWin,
    dump: function () {
      return {
        answer: answer,
        pile: cols.map(function (col) {
          return col.map(function (t) { return { ch: t.ch, mark: t.mark }; });
        }),
        practice: practice,
        done: done,
        won: won,
        gaveUp: gaveUp,
        overflow: overflow,
        guesses: guesses.map(function (g) { return { w: g.w, m: g.m.join("") }; }),
        save: loadSaved()
      };
    }
  };
})();
