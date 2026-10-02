// Findle — Day 19 variant of 30 Wordles.
// One puzzle per day: the answer derives from the calendar date and
// progress is saved to localStorage, so a refresh resumes the same game.
// Practice mode plays a random word without touching the daily save.
//
// A word search that shoots back. The 10×10 grid hides 14+ five-letter
// words — 13+ decoys and one secret TARGET — in all 8 directions:
// across, down, reversed, and the diagonals. A guess is any real word
// that READS somewhere in the grid (the placed words seed it, but
// overlaps and the noise fill spawn more, and they all count): type it,
// and at the fifth letter it lights up on the board where it reads.
// Feedback grades each TILE of the guess on its own: GREEN sits on a
// target cell, YELLOW lies on the target's line (the row, column or
// diagonal the word runs along — sharing a mere column with one target
// cell is NOT warm), GRAY misses it entirely. Marks stay painted on the
// grid, so the board accumulates a map of the target and the hunt closes
// in. Naming the target wins — the board itself is the announcement: no
// banner, the reveal lights the word and the share button appears. The
// grid derives deterministically from the date, so a refreshed page
// rebuilds the exact same board.

(function () {
  "use strict";

  var SIZE = 10;           // 10×10 grid
  var WL = 5;              // every placed word is five letters
  var MIN_WORDS = 14;      // the board's floor (target included)
  var MAX_WORDS = 20;      // and its ceiling — "14+, more is fine"
  var CROSSERS = 3;        // decoys deliberately crossed through the target
  var LIMIT = 6;           // guesses
  var SALT = "findle";     // daily hash salt — each variant salts its own way
  var GRID_SALT = "findle-grid";
  var STORE_KEY = "findle-day19";
  var GAME_URL = "https://suitangi.github.io/30Wordles/days/19";
  var FLIP_STAGGER = 280;  // ms between tile flips (Bundle timing)
  var FLIP_MID = 270;      // half-turn point: the score color appears here
  var REVEAL_START = 100;

  // All 8 directions, word-search style. d is the index everywhere.
  var DIRS = [
    { dr: 0, dc: 1, name: "right", arrow: "\u2192" },
    { dr: 0, dc: -1, name: "left", arrow: "\u2190" },
    { dr: 1, dc: 0, name: "down", arrow: "\u2193" },
    { dr: -1, dc: 0, name: "up", arrow: "\u2191" },
    { dr: 1, dc: 1, name: "down-right", arrow: "\u2198" },
    { dr: 1, dc: -1, name: "down-left", arrow: "\u2199" },
    { dr: -1, dc: 1, name: "up-right", arrow: "\u2197" },
    { dr: -1, dc: -1, name: "up-left", arrow: "\u2196" }
  ];

  // Letter-frequency fill: empty cells take common letters so the planted
  // words don't stand out against the noise.
  var FREQ = "etaoinshrdlcumwfgypbvkjxqz";
  var FREQ_W = [12.7, 9.1, 8.2, 7.5, 7.0, 6.7, 6.3, 6.1, 6.0, 4.3, 4.0,
    2.8, 2.8, 2.4, 2.4, 2.2, 2.0, 2.0, 1.9, 1.5, 1.0, 0.8, 0.15, 0.15,
    0.1, 0.07];

  var ANSWERS = window.WORD_LISTS.answers;
  var DICTIONARY = new Set(window.WORD_LISTS.guesses);

  var gridEl = document.getElementById("grid");
  var slotsEl = document.getElementById("slots");
  var logEl = document.getElementById("log");
  var keyboardEl = document.getElementById("keyboard");
  var toastEl = document.getElementById("toast");
  var newBtn = document.getElementById("new-btn");
  var giveUpBtn = document.getElementById("giveup-btn");
  var shareBtn = document.getElementById("share-btn");

  var answer = "";
  var placed = [];        // [{ w, r, c, d }] — placed[0] is the target
  var targetCells = [];   // [{ r, c }] × 5
  var targetKeys = new Set();
  var line = {};          // the target's infinite line: { type, k }
  var letters = [];       // SIZE*SIZE cell letters

  var guesses = [];       // occurrences: { w, r, c, d }, in order
  var typed = Array(WL).fill("");
  var selCellEls = [];    // cells wearing .sel right now (the live find)
  var done = false;
  var won = false;
  var gaveUp = false;
  var revealing = false;
  var practice = false;
  var quietRows = false;  // restore flag: rebuilt rows skip enter animations
  var slotEls = [];
  var cellEls = [];       // the 100 grid cells
  var toastTimer = null;

  var RANK = { absent: 1, present: 2, correct: 3 };

  // ---------- deterministic randomness ----------

  function hashStr(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h >>> 0;
  }

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(list, rng) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = a[i];
      a[i] = a[j];
      a[j] = tmp;
    }
    return a;
  }

  // ---------- the 8-direction geometry ----------

  // Legal start cells for a word in direction d (start + 4 steps in bounds).
  var BOUNDS = DIRS.map(function (v) {
    return {
      r0: Math.max(0, -(WL - 1) * v.dr),
      r1: Math.min(SIZE - 1, SIZE - 1 - (WL - 1) * v.dr),
      c0: Math.max(0, -(WL - 1) * v.dc),
      c1: Math.min(SIZE - 1, SIZE - 1 - (WL - 1) * v.dc)
    };
  });

  function inBounds(d, r, c) {
    return r >= BOUNDS[d].r0 && r <= BOUNDS[d].r1 &&
      c >= BOUNDS[d].c0 && c <= BOUNDS[d].c1;
  }

  function occCells(o) {
    var v = DIRS[o.d];
    var out = [];
    for (var k = 0; k < WL; k++) {
      out.push({ r: o.r + v.dr * k, c: o.c + v.dc * k });
    }
    return out;
  }

  // The 5 letters reading from (r, c) in direction d, or null off-grid.
  function readAt(r, c, d) {
    if (!inBounds(d, r, c)) return null;
    var v = DIRS[d];
    var s = "";
    for (var k = 0; k < WL; k++) s += letters[(r + v.dr * k) * SIZE + (c + v.dc * k)];
    return s;
  }

  // Every place the word reads in the grid, scan order (cells, then
  // directions) — the deterministic occurrence a typed guess grades.
  function occurrences(word) {
    var out = [];
    if (typeof word !== "string" || word.length !== WL) return out;
    for (var d = 0; d < 8; d++) {
      for (var r = BOUNDS[d].r0; r <= BOUNDS[d].r1; r++) {
        for (var c = BOUNDS[d].c0; c <= BOUNDS[d].c1; c++) {
          if (readAt(r, c, d) === word) out.push({ w: word, r: r, c: c, d: d });
        }
      }
    }
    return out;
  }

  function firstOccurrence(word) {
    if (typeof word !== "string" || word.length !== WL) return null;
    for (var d = 0; d < 8; d++) {
      for (var r = BOUNDS[d].r0; r <= BOUNDS[d].r1; r++) {
        for (var c = BOUNDS[d].c0; c <= BOUNDS[d].c1; c++) {
          if (readAt(r, c, d) === word) return { w: word, r: r, c: c, d: d };
        }
      }
    }
    return null;
  }

  function reads(word) { return !!firstOccurrence(word); }

  // ---------- grid generation ----------

  function fits(cells, w, r, c, d) {
    var v = DIRS[d];
    for (var k = 0; k < WL; k++) {
      var ch = cells[(r + v.dr * k) * SIZE + (c + v.dc * k)];
      if (ch && ch !== w.charAt(k)) return false;
    }
    return true;
  }

  function place(cells, state, w, r, c, d) {
    var v = DIRS[d];
    for (var k = 0; k < WL; k++) {
      cells[(r + v.dr * k) * SIZE + (c + v.dc * k)] = w.charAt(k);
    }
    state.list.push({ w: w, r: r, c: c, d: d });
    state.used[w] = true;
  }

  // One generation pass. Returns null when the pass couldn't deliver a
  // legal board; the caller retries with a varied seed. Practically the
  // first pass always succeeds.
  function tryGenerate(rng) {
    var cells = Array(SIZE * SIZE).fill("");
    var state = { list: [], used: Object.create(null) };

    // 1. the target, any direction, anywhere it fits
    var d0 = Math.floor(rng() * 8);
    var b0 = BOUNDS[d0];
    place(cells, state, answer,
      b0.r0 + Math.floor(rng() * (b0.r1 - b0.r0 + 1)),
      b0.c0 + Math.floor(rng() * (b0.c1 - b0.c0 + 1)), d0);
    var tCells = occCells(state.list[0]);

    // 2. DIRECTION COVERAGE, first of all: place a word in every
    // direction the target missed while the grid is all but empty — every
    // line still fits. Opposite directions share a line family (a
    // down-right word chops the very diagonals an up-left word needs), so
    // each opposite PAIR is attempted back-to-back. The crossers come
    // after: their crossing requirement stays satisfiable on a busier
    // grid, a bare direction does not.
    var pool = shuffle(ANSWERS.filter(function (w) { return w !== answer; }), rng);
    var cursor = 0;
    var dirsUsed = Object.create(null);
    dirsUsed[d0] = true;
    var pairs = shuffle([[0, 1], [2, 3], [4, 7], [5, 6]], rng);
    var order = [];
    pairs.forEach(function (p) {
      if (rng() < 0.5) { order.push(p[0], p[1]); }
      else { order.push(p[1], p[0]); }
    });
    for (var oi = 0; oi < order.length && cursor < pool.length; oi++) {
      var md = order[oi];
      if (dirsUsed[md]) continue;
      var bm = BOUNDS[md];
      var filled = false;
      // every start position is checked for each candidate — with a busy
      // grid a direction can have zero empty lines left, and sampling
      // would never notice; the walk finds a matching overlap if any
      for (var scan = 0; scan < 150 && !filled && cursor < pool.length; scan++) {
        var wm = pool[cursor++];
        for (var rr = bm.r0; rr <= bm.r1 && !filled; rr++) {
          for (var cc = bm.c0; cc <= bm.c1 && !filled; cc++) {
            if (fits(cells, wm, rr, cc, md)) {
              place(cells, state, wm, rr, cc, md);
              dirsUsed[md] = true;
              filled = true;
            }
          }
        }
      }
    }

    // 3. CROSSERS: the overlap guarantee. Scan the pool for words that
    // lie across a target cell — not along the target's own line — so
    // decoy guesses CAN grade green there.
    var nocol = [];
    for (var di = 0; di < 8; di++) {
      var along = DIRS[di].dr === DIRS[d0].dr && DIRS[di].dc === DIRS[d0].dc;
      var opp = DIRS[di].dr === -DIRS[d0].dr && DIRS[di].dc === -DIRS[d0].dc;
      if (!along && !opp) nocol.push(di);
    }
    var tOrder = shuffle([0, 1, 2, 3, 4], rng);
    var cOrder = shuffle(nocol, rng);
    var crossers = 0;
    var crossedTi = Object.create(null);
    while (crossers < CROSSERS && cursor < pool.length) {
      var w = pool[cursor++];
      if (state.used[w]) continue;
      var crossed = false;
      for (var ti = 0; ti < WL && !crossed; ti++) {
        var tIdx = tOrder[ti];
        if (crossedTi[tIdx]) continue; // spread the greens: one cell each
        var tc = tCells[tIdx];
        for (var wi = 0; wi < WL && !crossed; wi++) {
          if (w.charAt(wi) !== answer.charAt(tIdx)) continue;
          for (var ci = 0; ci < cOrder.length && !crossed; ci++) {
            var cd = cOrder[ci];
            var v = DIRS[cd];
            var sr = tc.r - v.dr * wi;
            var sc = tc.c - v.dc * wi;
            if (!inBounds(cd, sr, sc)) continue;
            if (fits(cells, w, sr, sc, cd)) {
              place(cells, state, w, sr, sc, cd);
              crossedTi[tIdx] = true;
              crossed = true;
            }
          }
        }
      }
      if (crossed) crossers++;
    }
    if (crossers < 2) return null; // the spec's floor — retry, don't ship

    // 4. remaining decoys up to the cap, random valid placements; a word
    // that won't fit after 40 tries is passed over for the next candidate.
    while (state.list.length < MAX_WORDS && cursor < pool.length) {
      var w2 = pool[cursor++];
      if (state.used[w2]) continue;
      var ok = false;
      for (var t2 = 0; t2 < 40 && !ok; t2++) {
        var rd = Math.floor(rng() * 8);
        var br = BOUNDS[rd];
        var rr = br.r0 + Math.floor(rng() * (br.r1 - br.r0 + 1));
        var rc = br.c0 + Math.floor(rng() * (br.c1 - br.c0 + 1));
        if (fits(cells, w2, rr, rc, rd)) {
          place(cells, state, w2, rr, rc, rd);
          ok = true;
        }
      }
    }
    if (state.list.length < MIN_WORDS) return null;

    // 5. fill the blanks with frequency-weighted noise
    var total = 0;
    for (var f = 0; f < FREQ_W.length; f++) total += FREQ_W[f];
    for (var i = 0; i < cells.length; i++) {
      if (cells[i]) continue;
      var roll = rng() * total;
      var acc = 0;
      for (var g = 0; g < FREQ.length; g++) {
        acc += FREQ_W[g];
        if (roll <= acc) { cells[i] = FREQ.charAt(g); break; }
      }
      if (!cells[i]) cells[i] = FREQ.charAt(Math.floor(rng() * FREQ.length));
    }
    return { cells: cells, list: state.list };
  }

  function generate(seedStr) {
    // Eight seeded passes; only if every one of them fails the word floor
    // does the floor relax — never observed.
    for (var floorWords = MIN_WORDS; floorWords >= 10; floorWords -= 2) {
      for (var attempt = 0; attempt < 8; attempt++) {
        var g = tryGenerate(mulberry32(hashStr(
          seedStr + "#" + floorWords + "-" + attempt)));
        if (g) return g;
      }
    }
    return null; // unreachable: a random pass always fills the board
  }

  // Commit a generated board to module state and derive the lookups.
  function applyGrid(gen) {
    letters = gen.cells;
    placed = gen.list;
    targetCells = occCells(placed[0]);
    targetKeys = new Set(targetCells.map(function (t) { return t.r + "," + t.c; }));
    // the target's line: the row, column or diagonal the word runs along
    var t = targetCells;
    if (t.every(function (p) { return p.r === t[0].r; })) {
      line = { type: "row", k: t[0].r };
    } else if (t.every(function (p) { return p.c === t[0].c; })) {
      line = { type: "col", k: t[0].c };
    } else if (t.every(function (p) { return p.r - p.c === t[0].r - t[0].c; })) {
      line = { type: "diag", k: t[0].r - t[0].c };
    } else {
      line = { type: "anti", k: t[0].r + t[0].c };
    }
  }

  // ---------- the feedback law (per tile, pure geometry) ----------

  function onLine(r, c) {
    if (line.type === "row") return r === line.k;
    if (line.type === "col") return c === line.k;
    if (line.type === "diag") return r - c === line.k;
    return r + c === line.k;
  }

  // GREEN: the tile IS a target cell. YELLOW: the tile lies on the
  // target's line — its street, not merely a column one of its cells
  // happens to share (suitangi: grade tiles, not the whole word). GRAY:
  // neither.
  function markAt(r, c) {
    if (targetKeys.has(r + "," + c)) return "correct";
    return onLine(r, c) ? "present" : "absent";
  }

  function marksAt(occ) {
    return occCells(occ).map(function (t) { return markAt(t.r, t.c); });
  }

  function cellsFor(word) {
    var occ = firstOccurrence(word);
    return occ ? occCells(occ) : null;
  }

  function marksFor(word) {
    var occ = firstOccurrence(word);
    return occ ? marksAt(occ) : null;
  }

  function isGuessed(w) {
    return guesses.some(function (g) { return g.w === w; });
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

  // A saved guess is an occurrence: the word AND where it was read, so a
  // restore repaints the exact cells the player graded.
  function validOcc(g) {
    return !!g && typeof g === "object" && !Array.isArray(g) &&
      typeof g.w === "string" && DICTIONARY.has(g.w) &&
      Number.isInteger(g.r) && Number.isInteger(g.c) &&
      Number.isInteger(g.d) && g.d >= 0 && g.d < 8 &&
      readAt(g.r, g.c, g.d) === g.w;
  }

  // The board is derived from the date, so a save is only valid when its
  // answer is exactly today's derived target — anything else would pair
  // old guesses with a grid that doesn't hold them.
  function validSave(saved) {
    if (!saved || saved.date !== todayKey() || saved.answer !== answerFor(todayKey())) {
      return false;
    }
    return Array.isArray(saved.guesses) &&
      saved.guesses.length <= LIMIT &&
      saved.guesses.every(validOcc);
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

  function buildBoard() {
    gridEl.innerHTML = "";
    cellEls = [];
    for (var r = 0; r < SIZE; r++) {
      for (var c = 0; c < SIZE; c++) {
        var cell = document.createElement("div");
        cell.className = "tile";
        cell.textContent = letters[r * SIZE + c];
        gridEl.appendChild(cell);
        cellEls.push(cell);
      }
    }
  }

  function buildSlots() {
    slotsEl.innerHTML = "";
    slotEls = [];
    for (var i = 0; i < WL; i++) {
      var s = document.createElement("div");
      s.className = "tile";
      slotsEl.appendChild(s);
      slotEls.push(s);
    }
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

  function occCellEls(occ) {
    return occCells(occ).map(function (t) { return cellEls[t.r * SIZE + t.c]; });
  }

  // Best-known mark per cell, never downgraded — the board accumulates.
  function paintCell(idx, mark) {
    var cur = cellMarks[idx] || "";
    if (RANK[mark] > (RANK[cur] || 0)) {
      var el = cellEls[idx];
      el.classList.remove("correct", "present", "absent");
      el.classList.add(mark);
      cellMarks[idx] = mark;
    }
  }

  var cellMarks = [];

  function resetBoard() {
    done = false;
    won = false;
    gaveUp = false;
    revealing = false;
    guesses = [];
    typed = Array(WL).fill("");
    selCellEls = [];
    cellMarks = Array(SIZE * SIZE).fill("");

    buildBoard();
    buildSlots();
    buildKeyboard();
    logEl.innerHTML = "";
    shareBtn.classList.add("hidden");
    updateActions();
  }

  // Today's puzzle: resume the saved game if there is one, else start fresh.
  function init() {
    practice = false;
    newBtn.textContent = "Practice";
    var key = todayKey();
    answer = answerFor(key);
    applyGrid(generate(GRID_SALT + ":" + key));
    var saved = loadSaved();
    if (validSave(saved)) {
      quietRows = true;
      resetBoard();
      restore(saved);
      quietRows = false;
    } else {
      resetBoard();
      saveState();
    }
  }

  // Random board, never saved — the daily game stays untouched. A forced
  // target ("crane") is the debugging backdoor.
  function startPractice(force) {
    practice = true;
    answer = validAnswer(force)
      ? force
      : ANSWERS[Math.floor(Math.random() * ANSWERS.length)];
    applyGrid(generate(GRID_SALT + ":practice:" + Math.random()));
    quietRows = false;
    resetBoard();
    newBtn.textContent = "Today\u2019s puzzle";
    toast("Practice round");
  }

  // Replay saved occurrences onto the rebuilt board with no animation:
  // marks are pure geometry, so cells and log rows paint directly —
  // restored boards are born finished.
  function restore(saved) {
    guesses = [];
    saved.guesses.forEach(function (g) {
      var marks = marksAt(g);
      var tiles = addLogRow(g.w);
      for (var c = 0; c < WL; c++) {
        tiles[c].classList.add(marks[c]);
        var t = occCells(g)[c];
        paintCell(t.r * SIZE + t.c, marks[c]);
      }
      guesses.push(g);
    });

    if (saved.done) {
      done = true;
      won = !!saved.won;
      gaveUp = !!saved.gaveUp;
      if (won) markCells(targetCells.map(function (t) { return t.r * SIZE + t.c; }));
      else revealTarget(false); // the loss reveal, painted not flipped
      shareBtn.classList.remove("hidden");
    }
    updateActions();
  }

  // ---------- pending guess ----------

  // Where the half-typed word reads on the board, once it reaches five
  // letters: the find-assist. No clicks — the letters find their word.
  function currentOcc() {
    var word = typed.join("");
    if (word.length < WL) return null;
    return firstOccurrence(word);
  }

  function paintPending() {
    for (var c = 0; c < WL; c++) {
      slotEls[c].textContent = typed[c] || "";
      slotEls[c].classList.toggle("filled", !!typed[c]);
    }
    selCellEls.forEach(function (el) { el.classList.remove("sel"); });
    var occ = currentOcc();
    selCellEls = occ ? occCellEls(occ) : [];
    selCellEls.forEach(function (el) { el.classList.add("sel"); });
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
        paintPending();
        return;
      }
    }
  }

  function erase() {
    for (var c = WL - 1; c >= 0; c--) {
      if (typed[c]) {
        typed[c] = "";
        paintPending();
        return;
      }
    }
  }

  // ---------- submitting a guess ----------

  function submit() {
    if (done || revealing) return;
    var occ = currentOcc();
    if (!occ) {
      reject(typed.join("").length < WL ? "Not enough letters" : "Not on the grid");
      return;
    }
    // the grid is the source of truth: the word lights up where it reads,
    // but it still has to be a word
    if (!DICTIONARY.has(occ.w)) { reject("Not a word"); return; }
    if (isGuessed(occ.w)) {
      toast("Already guessed");
      shakeSlots();
      return; // a repeated word teaches nothing — it spends no guess
    }

    revealing = true;
    var marks = marksAt(occ);
    var cells = occCells(occ);
    typed = Array(WL).fill("");
    paintPending();

    // grid cells keep their best-ever mark; the log row shows this guess's
    // own marks even where a cell already knew better
    var gridMarks = marks.map(function (m, i) {
      var idx = cells[i].r * SIZE + cells[i].c;
      var cur = cellMarks[idx] || "";
      return RANK[m] > (RANK[cur] || 0) ? m : cur;
    });
    marks.forEach(function (m, i) {
      paintCell(cells[i].r * SIZE + cells[i].c, m);
    });

    var tiles = addLogRow(occ.w);
    flipTiles(occCellEls(occ), gridMarks);
    flipTiles(tiles, marks);
    setTimeout(function () { finish(occ); },
      REVEAL_START + (WL - 1) * FLIP_STAGGER + FLIP_MID + 150);
  }

  // The one visual primitive: staggered flips with the mark landing at the
  // half-turn (Bundle timing). `.reveal` stays on like Cycle's — a landed
  // reveal restarts via remove → reflow → add inside the start callback.
  function flipTiles(els, marks) {
    for (var c = 0; c < WL; c++) {
      var el = els[c];
      el.classList.remove("shake");
      setTimeout(function (el) {
        el.classList.remove("reveal");
        void el.offsetWidth;
        el.classList.add("reveal");
      }, REVEAL_START + c * FLIP_STAGGER, el);
      setTimeout(function (el, mark) {
        el.classList.remove("filled", "correct", "present", "absent");
        el.classList.add(mark);
      }, REVEAL_START + c * FLIP_STAGGER + FLIP_MID, el, marks[c]);
    }
  }

  function addLogRow(word) {
    var row = document.createElement("div");
    row.className = (quietRows ? "flogrow quiet" : "flogrow");
    var tiles = [];
    for (var c = 0; c < WL; c++) {
      var t = document.createElement("div");
      t.className = "tile filled";
      t.textContent = word.charAt(c);
      row.appendChild(t);
      tiles.push(t);
    }
    logEl.appendChild(row);
    return tiles;
  }

  function markCells(idxs) {
    idxs.forEach(function (idx) { cellEls[idx].classList.add("win-glow"); });
  }

  // End state (loss or surrender): the target's cells light up green —
  // the reveal the whole game was hiding. Restored boards paint it flat.
  function revealTarget(animated) {
    for (var i = 0; i < WL; i++) {
      var t = targetCells[i];
      var idx = t.r * SIZE + t.c;
      var el = cellEls[idx];
      if (!animated) { paintCell(idx, "correct"); continue; }
      (function (el, idx, i) {
        setTimeout(function () {
          el.classList.remove("reveal");
          void el.offsetWidth;
          el.classList.add("reveal");
        }, REVEAL_START + i * FLIP_STAGGER);
        setTimeout(function () {
          paintCell(idx, "correct");
        }, REVEAL_START + i * FLIP_STAGGER + FLIP_MID);
      })(el, idx, i);
    }
  }

  function finish(occ) {
    guesses.push(occ);
    if (occ.w === answer) {
      done = true;
      won = true;
      markCells(targetCells.map(function (t) { return t.r * SIZE + t.c; }));
      // naming the target wins wherever it was read from; if that wasn't
      // the target's own cells, light them up as the victory lap
      if (occ.r !== placed[0].r || occ.c !== placed[0].c || occ.d !== placed[0].d) {
        revealTarget(true);
      }
      shareBtn.classList.remove("hidden");
    } else if (guesses.length >= LIMIT) {
      done = true; // six guesses, no target — the loss
      revealTarget(true);
      shareBtn.classList.remove("hidden");
    }
    updateActions();
    saveState();
    revealing = false;
  }

  function giveUp() {
    if (done || revealing) return;
    typed = Array(WL).fill("");
    paintPending();
    done = true;
    gaveUp = true;
    revealTarget(true);
    shareBtn.classList.remove("hidden");
    updateActions();
    saveState();
  }

  function updateActions() {
    giveUpBtn.classList.toggle("hidden", done);
  }

  // ---------- feedback ----------

  function shakeSlots() {
    slotsEl.classList.remove("shake");
    void slotsEl.offsetWidth; // restart the animation
    slotsEl.classList.add("shake");
    slotsEl.addEventListener("animationend", function h(ev) {
      if (ev.animationName !== "shake") return;
      slotsEl.classList.remove("shake");
      slotsEl.removeEventListener("animationend", h);
    });
  }

  function reject(msg) {
    toast(msg);
    shakeSlots();
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
    var state = won ? n + "/" + LIMIT
      : (gaveUp ? "gave up \u00B7 " + n + "/" + LIMIT : "X/" + LIMIT);
    var title = ["Findle", practice ? "practice" : todayKey(), state]
      .join(" \u00B7 ");
    var lines = [title, GAME_URL];
    guesses.forEach(function (g) {
      lines.push(marksAt(g).map(function (m) { return EMOJI[m]; }).join(""));
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

  // ---------- debug log (suitangi: paste this when something looks off) --

  // Prints a readable snapshot to the console AND copies it to the
  // clipboard, ready to paste into a bug report: the grid with the
  // target's cells bracketed, every placed word with its cells and
  // direction, each guess with its per-tile marks, and the raw save.
  function log() {
    var dirOf = function (o) { return DIRS[o.d].arrow; };
    var lines = [];
    lines.push("Findle " + (practice ? "practice" : todayKey()) +
      " \u00B7 target " + answer.toUpperCase() +
      " @r" + targetCells[0].r + "c" + targetCells[0].c + " " + dirOf(placed[0]) +
      " \u00B7 line: " + line.type + " " + line.k +
      " \u00B7 " + placed.length + " words \u00B7 guesses " +
      guesses.length + "/" + LIMIT);
    for (var r = 0; r < SIZE; r++) {
      var row = [];
      for (var c = 0; c < SIZE; c++) {
        row.push(targetKeys.has(r + "," + c)
          ? "[" + letters[r * SIZE + c] + "]"
          : letters[r * SIZE + c] + " ");
      }
      lines.push("r" + r + "  " + row.join(" "));
    }
    lines.push("words: " + placed.map(function (p) {
      return p.w + "@r" + p.r + "c" + p.c + dirOf(p);
    }).join("  "));
    var GYA = { correct: "G", present: "Y", absent: "A" };
    guesses.forEach(function (g, i) {
      lines.push("g" + (i + 1) + " " + g.w.toUpperCase() +
        " @r" + g.r + "c" + g.c + " " + dirOf(g) + " \u2192 " +
        marksAt(g).map(function (m) { return GYA[m]; }).join(""));
    });
    lines.push("save: " + JSON.stringify(loadSaved()));
    var text = lines.join("\n");
    console.log(text);
    copyText(text);
    return text;
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
  window.FINDLE = {
    daily: init,
    practice: startPractice,
    todayKey: todayKey,
    answerFor: answerFor,
    occurrences: occurrences,
    reads: reads,
    cellsFor: cellsFor,
    marksFor: marksFor,
    marksAt: marksAt,
    markAt: markAt,
    placed: function () {
      return placed.map(function (p) {
        return { w: p.w, r: p.r, c: p.c, d: p.d, name: DIRS[p.d].name };
      });
    },
    cell: function (r, c) { return cellEls[r * SIZE + c]; },
    DIRS: DIRS.map(function (v) { return { dr: v.dr, dc: v.dc }; }),
    SIZE: SIZE,
    LIMIT: LIMIT,
    log: log,
    dump: function () {
      return {
        answer: answer,
        grid: letters.join(""),
        targetCells: targetCells.map(function (t) { return { r: t.r, c: t.c }; }),
        line: { type: line.type, k: line.k },
        placed: placed.map(function (p) {
          return { w: p.w, r: p.r, c: p.c, d: p.d };
        }),
        guesses: guesses.map(function (g) {
          return { w: g.w, r: g.r, c: g.c, d: g.d };
        }),
        typed: typed.join(""),
        sel: (function () {
          var o = currentOcc();
          return o ? { w: o.w, r: o.r, c: o.c, d: o.d } : null;
        })(),
        practice: practice,
        done: done,
        won: won,
        gaveUp: gaveUp,
        save: loadSaved()
      };
    }
  };
})();
