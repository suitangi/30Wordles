// Triple — Day 26 variant of 30 Wordles.
// One puzzle per day: three answers derive from the calendar date and
// progress is saved to localStorage, so a refresh resumes the same game.
// Practice mode plays a random trio without touching the daily save.
//
// Three wordles crossed through one honeycomb of flat-top hexes, laid out
// by suitangi's painted map. Board 1 (blue) is six words running up the
// NE diagonals; board 2 (orange) is nine words running up the columns;
// board 3 (purple) is seven words on the same diagonals, shifted one
// column right per row. The boards overlap: blue's first five words
// refill orange's first five columns (25 shared hexes), and blue + orange
// seed purple's first five rows (25 more). One hex, one letter, scored
// against each board's own answer — the view decides whose clue a shared
// hex wears, like Swivel's duos.
//
// You type on whichever board faces you: 6 guesses on blue, then 4 fresh
// columns on orange, then 2 fresh rows on purple. The Swivel button turns
// the board +60deg so orange's columns read across (glyphs
// counter-rotate and stay face-up). Each
// view outlines its own board in its color. A line that spells its
// board's answer counts as found even if the carry-over fill spelled it,
// not you. Lose a board (budget spent wrong) and the others still play;
// the game ends when all three are decided. Win = all three. Give up =
// the loss.
(function () {
  "use strict";

  var L = 5;                 // word length
  var BUDGET = [6, 4, 2];    // typed guesses per board
  var LINES = [6, 9, 7];     // total lines per board (some are carry-over)
  var SALT = "triple";
  var STORE_KEY = "triple-day26";
  var GAME_URL = "https://suitangi.github.io/30Wordles/days/26";
  var PRAISE = ["Genius", "Magnificent", "Impressive", "Splendid", "Great", "Phew"];
  var BOARD_NAME = ["blue", "orange", "purple"];
  var FLIP_STAGGER = 280;    // ms between tile flips (Bundle timing)
  var FLIP_MID = 270;        // half-turn: the score color lands here

  var ANSWERS = window.WORD_LISTS.answers;
  var DICTIONARY = new Set(window.WORD_LISTS.guesses);

  var pivotEl = document.getElementById("pivot");
  var boardEl = document.getElementById("board");
  var keyboardEl = document.getElementById("keyboard");
  var bannerEl = document.getElementById("banner");
  var toastEl = document.getElementById("toast");
  var newBtn = document.getElementById("new-btn");
  var giveUpBtn = document.getElementById("giveup-btn");
  var turnBtn = document.getElementById("turn-btn");
  var shareBtn = document.getElementById("share-btn");

  var answers = ["", "", ""];
  var guesses = [[], [], []];   // typed words per board
  var found = [false, false, false]; // cache for glow/transition detection
  var done = false;
  var gaveUp = false;
  var view = 0;                 // 0 blue, 1 orange, 2 purple — view AND input target
  var revealing = false;
  var practice = false;
  var quiet = false;            // restore flag: rebuilt hexes are born resolved
  var typed = [];
  var toastTimer = null;
  var swivelOff = [0, 0];       // view-2 re-centering translate, px (debug)

  // Debug sizing log: load the page with ?debug (or #debug) once and the
  // flag sticks for the session — buildBoard then dumps its sizing
  // numbers on every rebuild and resize events log themselves, so
  // viewport toggles (DevTools device mode, phone rotation) can be
  // traced in the console. ?debug=off (or #debug-off) clears it.
  var debug = false;
  try {
    var dflag = location.search + " " + location.hash;
    if (/debug=off|debug-off/.test(dflag)) {
      localStorage.removeItem("triple-debug");
    } else if (/debug/.test(dflag)) {
      localStorage.setItem("triple-debug", "on");
    }
    debug = localStorage.getItem("triple-debug") === "on";
  } catch (e) {}

  // ---------- geometry (the painted map, lab coords) ----------
  //
  // Flat-top hexes: column c sits at x = c*CP, row r at y = r*RP, odd
  // columns half a row lower. A word reading up the NE diagonal keeps
  // phi = r + ceil(c/2) constant. Board 1's word j (0-based) is the
  // phi = 5+j diagonal, letters at c = 2..6 (letter 1 leftmost). Board
  // 2's word i is column c = 2+i read bottom-up (letter 1 at r = 9 -
  // ceil(c/2)). Board 3's word j is the phi = 5+j diagonal shifted one
  // column right per row: letters at c = 2+j..6+j.

  function ceil2(c) { return (c + 1) >> 1; }
  function w1HexAt(j, k) { var c = 1 + k; return [c, 5 + j - ceil2(c)]; }
  function w2HexAt(i, k) { var c = 2 + i; return [c, 9 - ceil2(c) - (k - 1)]; }
  function w3HexAt(j, k) { var c = 2 + j + (k - 1); return [c, 5 + j - ceil2(c)]; }
  function keyOf(c, r) { return c + "," + r; }

  // The union hex table: key -> { c, r, own: [posOnBoard1..3 or null] }.
  // own[b] = { line, pos } — the hex's line index and 1-based letter
  // position within board b's word. Every hex is claimed by at least one
  // board; the typed regions are disjoint (blue's 30, orange-only 20,
  // purple-only 10).
  var HEXES = {};
  function claim(c, r, b, line, pos) {
    var key = keyOf(c, r);
    if (!HEXES[key]) HEXES[key] = { c: c, r: r, own: [null, null, null], el: null, inEl: null };
    HEXES[key].own[b] = { line: line, pos: pos };
  }
  (function buildTable() {
    for (var j = 0; j < 6; j++) for (var k = 1; k <= L; k++) {
      var h = w1HexAt(j, k); claim(h[0], h[1], 0, j, k);
    }
    for (var i = 0; i < 9; i++) for (var k2 = 1; k2 <= L; k2++) {
      var h2 = w2HexAt(i, k2); claim(h2[0], h2[1], 1, i, k2);
    }
    for (var j3 = 0; j3 < 7; j3++) for (var k3 = 1; k3 <= L; k3++) {
      var h3 = w3HexAt(j3, k3); claim(h3[0], h3[1], 2, j3, k3);
    }
  })();

  // The six neighbor offsets on this lattice, CLOCKWISE from the top —
  // index order matches the hex's six edges: N (top), NE (upper-right),
  // SE (lower-right), S (bottom), SW (lower-left), NW (upper-left).
  // Odd columns sit LOWER by half a row, so an EVEN column's diagonal
  // neighbors sit one row up (NE of (2,4) is (3,3)) while an ODD
  // column's sit level (NE of (3,3) is (4,3)). Getting this parity
  // backwards was the messed-up outline: the tracer walked edges that
  // face real neighbors.
  function neighbors(c, r) {
    var up = 1 - (c % 2);
    return [
      [c, r - 1],                       // N
      [c + 1, r - up],                  // NE
      [c + 1, r + 1 - up],              // SE
      [c, r + 1],                       // S
      [c - 1, r + 1 - up],              // SW
      [c - 1, r - up]                   // NW
    ];
  }

  // The board's outline as one SVG path: every edge of every hex whose
  // neighbor is outside the board is a boundary segment; chained
  // end-to-end they close into the region's silhouette (whole-board
  // outline, no per-tile scallops). Segments are collected around each
  // hex's center in painted coords, then emitted through hexCenter so
  // the outline lives in the same rotated, fitted frame as the tiles.
  function outlineLoops(b) {
    var S2 = S / 2, H2 = ROW_P / 2;
    // edge corner pairs, clockwise, center-relative (painted coords)
    var EDGES = [
      [[-S2, -H2], [S2, -H2]],   // N
      [[S2, -H2], [S, 0]],       // NE
      [[S, 0], [S2, H2]],        // SE
      [[S2, H2], [-S2, H2]],     // S
      [[-S2, H2], [-S, 0]],      // SW
      [[-S, 0], [-S2, -H2]]      // NW
    ];
    var segs = [];
    for (var key in HEXES) {
      var h = HEXES[key];
      if (!h.own[b]) continue;
      var cx = h.c * COL_P;
      var cy = h.r * ROW_P + (h.c % 2 ? H2 : 0);
      var nb = neighbors(h.c, h.r);
      for (var i = 0; i < 6; i++) {
        var n = HEXES[keyOf(nb[i][0], nb[i][1])];
        if (n && n.own[b]) continue; // interior edge
        var a = EDGES[i][0], c2 = EDGES[i][1];
        segs.push([[cx + a[0], cy + a[1]], [cx + c2[0], cy + c2[1]]]);
      }
    }
    if (!segs.length) return [];
    // chain segments end-to-end into closed loops
    var K = function (p) { return p[0].toFixed(1) + "," + p[1].toFixed(1); };
    var at = {};
    segs.forEach(function (s, i) {
      (at[K(s[0])] ||= []).push(i);
      (at[K(s[1])] ||= []).push(i);
    });
    var used = segs.map(function () { return false; });
    var loops = [];
    for (var start = 0; start < segs.length; start++) {
      if (used[start]) continue;
      var loop = [segs[start][0], segs[start][1]];
      used[start] = true;
      var guard = segs.length + 1;
      while (guard--) {
        var tail = loop[loop.length - 1];
        if (K(tail) === K(loop[0])) break; // closed
        var cands = at[K(tail)] || [];
        var next = -1;
        for (var ci = 0; ci < cands.length; ci++) {
          if (!used[cands[ci]]) { next = cands[ci]; break; }
        }
        if (next === -1) break;
        used[next] = true;
        var seg = segs[next];
        loop.push(K(seg[0]) === K(tail) ? seg[1] : seg[0]);
      }
      // the walk's last point is the loop's first (the Z closes it) —
      // drop the duplicate or the path grows a zero-length edge
      if (loop.length > 1 && K(loop[loop.length - 1]) === K(loop[0])) {
        loop.pop();
      }
      loops.push(loop);
    }
    return loops;
  }

  function boardOutlinePath(b, minX, minY) {
    var loops = outlineLoops(b);
    var d = "";
    loops.forEach(function (loop) {
      for (var pi = 0; pi < loop.length; pi++) {
        // through the same rotation/fit as the tiles, into board space
        var p = [
          (loop[pi][0] * COS30 - loop[pi][1] * SIN30) * fit - minX,
          (loop[pi][0] * SIN30 + loop[pi][1] * COS30) * fit - minY
        ];
        d += (pi ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1);
      }
      d += "Z";
    });
    return d;
  }

  // The inert honeycomb ring drawn around the union so the rotated board
  // reads as one piece.
  var RING = {};
  (function buildRing() {
    for (var key in HEXES) {
      var h = HEXES[key];
      var nb = neighbors(h.c, h.r);
      for (var i = 0; i < 6; i++) {
        var nk = keyOf(nb[i][0], nb[i][1]);
        if (!HEXES[nk]) RING[nk] = { c: nb[i][0], r: nb[i][1] };
      }
    }
  })();

  // ---------- words on the board ----------

  function lineHex(b, line, k) {
    var at = b === 0 ? w1HexAt(line, k) : b === 1 ? w2HexAt(line, k) : w3HexAt(line, k);
    return HEXES[keyOf(at[0], at[1])] || null;
  }

  // The letter sitting on a hex, derived from the typed guesses (the
  // carry-over is never stored — a hex's letter is wherever it was
  // placed: blue's words first, then orange's typed columns, then purple's
  // typed rows).
  function letterAt(h) {
    if (!h) return "";
    var p;
    if ((p = h.own[0]) !== null && guesses[0][p.line]) {
      return guesses[0][p.line].charAt(p.pos - 1);
    }
    if ((p = h.own[1]) !== null && p.line >= 5 && guesses[1][p.line - 5]) {
      return guesses[1][p.line - 5].charAt(p.pos - 1);
    }
    if ((p = h.own[2]) !== null && p.line >= 5 && guesses[2][p.line - 5]) {
      return guesses[2][p.line - 5].charAt(p.pos - 1);
    }
    return "";
  }

  // A board line's word in word order, or "" while any letter is missing.
  function lineWord(b, line) {
    var w = "";
    for (var k = 1; k <= L; k++) {
      var ch = letterAt(lineHex(b, line, k));
      if (!ch) return "";
      w += ch;
    }
    return w;
  }

  function lineHasLetters(b, line) {
    for (var k = 1; k <= L; k++) if (letterAt(lineHex(b, line, k))) return true;
    return false;
  }

  // Standard Wordle evaluation (two-pass) — used for whole typed words.
  function evaluate(guess, target) {
    var marks = Array(L).fill("absent");
    var remaining = {};
    for (var i = 0; i < L; i++) {
      if (guess[i] === target[i]) marks[i] = "correct";
      else remaining[target[i]] = (remaining[target[i]] || 0) + 1;
    }
    for (var j = 0; j < L; j++) {
      if (marks[j] !== "correct" && remaining[guess[j]] > 0) {
        marks[j] = "present";
        remaining[guess[j]]--;
      }
    }
    return marks;
  }

  var RANK = { absent: 1, present: 2, correct: 3 };

  // A hex's clue against board b: its letter scored at its own position
  // in b's word — per-tile, no cross-hex copy accounting (the Swivel
  // trade: the carry-over is never typed as one word, so there is no
  // canonical word score to defer to; consistency beats pedantry).
  function tileMark(h, b) {
    var ch = letterAt(h);
    if (!ch || !h.own[b]) return null;
    if (ch === answers[b].charAt(h.own[b].pos - 1)) return "correct";
    return answers[b].indexOf(ch) !== -1 ? "present" : "absent";
  }

  // ---------- board state ----------

  function usedB(b) { return guesses[b].length; }

  function foundB(b) {
    for (var i = 0; i < LINES[b]; i++) {
      if (lineWord(b, i) === answers[b]) return true;
    }
    return false;
  }

  function lostB(b) { return !foundB(b) && usedB(b) >= BUDGET[b]; }
  function decidedB(b) { return foundB(b) || lostB(b); }
  function allDecided() {
    return decidedB(0) && decidedB(1) && decidedB(2);
  }
  function foundCount() {
    var n = 0;
    for (var b = 0; b < 3; b++) if (foundB(b)) n++;
    return n;
  }
  function typedCount() { return usedB(0) + usedB(1) + usedB(2); }

  // Where the next typed word lands for the board facing the player:
  // blue's next row (0-5), orange's next open column (5-8 — the first
  // five columns are the carry-over), purple's next open row (5-6). A
  // FOUND board keeps typing until its budget is spent — spare rows are
  // how you seed the later boards (the Swivel rule) — only a LOST board
  // (or a spent one) refuses. -1 when nothing is left.
  function pendingLine(b) {
    if (lostB(b)) return -1;
    var n = usedB(b);
    if (n >= BUDGET[b]) return -1;
    return n + (b === 0 ? 0 : 5);
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

  // Three deterministic daily words, each salted differently; collisions
  // step one word down the list (Swivel's rule, one more member).
  function answersFor(key) {
    var a = ANSWERS[hash(SALT + key) % ANSWERS.length];
    var b = ANSWERS[hash(SALT + "-b" + key) % ANSWERS.length];
    while (b === a) b = ANSWERS[(ANSWERS.indexOf(b) + 1) % ANSWERS.length];
    var c = ANSWERS[hash(SALT + "-c" + key) % ANSWERS.length];
    while (c === a || c === b) c = ANSWERS[(ANSWERS.indexOf(c) + 1) % ANSWERS.length];
    return [a, b, c];
  }

  function validWords(ws) {
    return Array.isArray(ws) && ws.length === 3 &&
      ws.every(function (w) { return DICTIONARY.has(w); }) &&
      ws[0] !== ws[1] && ws[0] !== ws[2] && ws[1] !== ws[2];
  }

  function inDict(w) { return typeof w === "string" && DICTIONARY.has(w); }

  function validSave(s) {
    if (!s || s.date !== todayKey() || !validWords(s.answers)) return false;
    if (!Array.isArray(s.w1) || s.w1.length > BUDGET[0] || !s.w1.every(inDict)) return false;
    if (!Array.isArray(s.w2) || s.w2.length > BUDGET[1] || !s.w2.every(inDict)) return false;
    if (!Array.isArray(s.w3) || s.w3.length > BUDGET[2] || !s.w3.every(inDict)) return false;
    if (![0, 1, 2].includes(s.view)) return false;
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
        answers: answers,
        w1: guesses[0],
        w2: guesses[1],
        w3: guesses[2],
        view: view,
        done: done,
        gaveUp: gaveUp
      }));
    } catch (e) { /* storage unavailable — game still playable */ }
  }

  // ---------- board build & layout ----------
  //
  // The painted map is a flat-top honeycomb whose NE diagonals carry the
  // blue and purple words. Baking a 30deg rotation into the render coords
  // stands that honeycomb up pointy-top with blue/purple reading as
  // straight horizontal rows (guess-rows sheared half a hex, the Muddle
  // look), and orange's columns reading across after exactly one 60deg
  // swivel. Hexes tile FLUSH: the painted pitches are col 1.5*s, row
  // sqrt(3)*s, odd columns half a row — the render is that lattice
  // rotated 30deg (an exact lattice symmetry for the hex shapes, so
  // tiling survives). Views 1/3 sit flush at 0deg; view 2 turns +60deg.

  var S = 35.2;                       // painted flat-top circumradius
  var COL_P = 1.5 * S;                // 52.8 painted column pitch
  var ROW_P = Math.sqrt(3) * S;       // 61 painted row pitch
  var HEX_W = Math.sqrt(3) * S;       // rendered pointy-top hex width
  var HEX_H = 2 * S;                  // rendered hex height
  var COS30 = Math.cos(Math.PI / 6), SIN30 = 0.5;
  var renderList = [];  // union hexes then ring hexes
  var fit = 1;          // scale factor so the board fits the page

  function hexCenter(h) {
    var x = h.c * COL_P;
    var y = h.r * ROW_P + (h.c % 2 ? ROW_P / 2 : 0);
    // rotate 30deg: the NE-diagonal words become horizontal rows
    return [(x * COS30 - y * SIN30) * fit, (x * SIN30 + y * COS30) * fit];
  }

  function makeHex(cls) {
    var t = document.createElement("div");
    t.className = "hex " + cls + (quiet ? " quiet" : "");
    var inner = document.createElement("div");
    inner.className = "hex-in";
    var s = document.createElement("span");
    s.className = "lt";
    inner.appendChild(s);
    t.appendChild(inner);
    return t;
  }

  function buildBoard() {
    boardEl.innerHTML = "";
    // Page gutter is 24px a side (16px under the 480px query); the cap
    // sets the desktop board size.
    var cw = document.documentElement.clientWidth || 1024;
    var avail = Math.min(cw - (cw <= 480 ? 32 : 48), 620);

    renderList = [];
    for (var key in HEXES) renderList.push(HEXES[key]);
    for (var rkey in RING) renderList.push(RING[rkey]);

    // raw (unscaled) rotated bbox over the hex centers, then a fit pass.
    // fit MUST be reset first: hexCenter bakes in the current fit, so
    // measuring through a stale one corrupts rawW — and rawW mixes that
    // bbox with unscaled HEX_W — compounding on every resize rebuild
    // until fit hit its 1 cap and the board rendered full size (the
    // "board randomly gets much bigger" bug on rotate / device toggle).
    fit = 1;
    var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    renderList.forEach(function (h) {
      var pt = hexCenter(h);
      if (pt[0] < minX) minX = pt[0];
      if (pt[1] < minY) minY = pt[1];
      if (pt[0] > maxX) maxX = pt[0];
      if (pt[1] > maxY) maxY = pt[1];
    });
    var rawW = maxX - minX + HEX_W;
    fit = rawW > avail ? avail / rawW : 1;
    var hw = HEX_W * fit, hh = HEX_H * fit;
    boardEl.style.fontSize = Math.round(hw * 0.44) + "px";

    // re-measure at the fitted scale (hexCenter applies `fit`)
    minX = 1e9; minY = 1e9; maxX = -1e9; maxY = -1e9;
    renderList.forEach(function (h) {
      var pt = hexCenter(h);
      if (pt[0] < minX) minX = pt[0];
      if (pt[1] < minY) minY = pt[1];
      if (pt[0] > maxX) maxX = pt[0];
      if (pt[1] > maxY) maxY = pt[1];
    });
    var bw = Math.ceil(maxX - minX + hw);
    var bh = Math.ceil(maxY - minY + hh);

    // The pivot is a FIXED box so nothing jumps between views — but it is
    // sized to the LARGEST SINGLE view's footprint, never the union of
    // the rotated bboxes. Rotating a shape about its center also SHIFTS
    // that shape's bbox, and unioning the shifted boxes bloated the pivot
    // wider than a phone viewport (the mobile horizontal-scroll bug).
    // Instead each view re-centers its own silhouette: view 2 carries a
    // --tp-cx/--tp-cy translate (measured here, consumed by the CSS
    // transform) so both views sit centered in one viewport-safe box.
    // View 2 turns +60deg to stand orange's columns across. The rotation
    // origin is the board rect's center — the CSS default — so offsets
    // are measured about (minX+maxX+hw)/2, not the centers' centroid.
    var OX = (minX + maxX + hw) / 2, OY = (minY + maxY + hh) / 2;
    var pivW = 0, pivH = 0, swX = 0, swY = 0;
    [0, 60, 0].forEach(function (deg, vi) {
      var a = deg * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a);
      var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      renderList.forEach(function (h) {
        var pt = hexCenter(h);
        var dx = pt[0] - OX, dy = pt[1] - OY;
        var rx = dx * cos - dy * sin, ry = dx * sin + dy * cos;
        if (rx < x0) x0 = rx;
        if (rx > x1) x1 = rx;
        if (ry < y0) y0 = ry;
        if (ry > y1) y1 = ry;
      });
      // hexes reach hw/2 sideways and hh/2 vertically past their centers
      if (x1 - x0 + hw > pivW) pivW = x1 - x0 + hw;
      if (y1 - y0 + hh > pivH) pivH = y1 - y0 + hh;
      if (vi === 1) { swX = -(x0 + x1) / 2; swY = -(y0 + y1) / 2; }
    });
    pivotEl.style.width = Math.floor(pivW) + "px";
    pivotEl.style.height = Math.ceil(pivH) + "px";
    boardEl.style.setProperty("--tp-cx", Math.round(swX) + "px");
    boardEl.style.setProperty("--tp-cy", Math.round(swY) + "px");
    swivelOff = [Math.round(swX), Math.round(swY)];

    boardEl.style.width = bw + "px";
    boardEl.style.height = bh + "px";
    boardEl.style.left = "50%";
    boardEl.style.top = "50%";

    renderList.forEach(function (h) {
      var isRing = !h.own;
      var el = makeHex(isRing ? "pad" : "cell");
      var pt3 = hexCenter(h);
      el.style.left = (pt3[0] - minX - hw / 2) + "px";
      el.style.top = (pt3[1] - minY - hh / 2) + "px";
      el.style.width = hw + "px";
      el.style.height = hh + "px";
      boardEl.appendChild(el);
      if (!isRing) {
        h.el = el;
        h.inEl = el.children[0];
      }
    });

    // The whole-board outline rides ON TOP of the tiles: one stroked
    // path hugging the region's silhouette, revealed only in its own
    // view. innerHTML builds the real SVG (createElementNS is off-limits
    // in the headless stub — the Dividle triangle lesson).
    for (var b = 0; b < 3; b++) {
      var dPath = boardOutlinePath(b, minX, minY);
      if (!dPath) continue;
      var wrap = document.createElement("div");
      wrap.className = "toutline w" + (b + 1);
      wrap.style.left = "0px";
      wrap.style.top = "0px";
      wrap.style.width = bw + "px";
      wrap.style.height = bh + "px";
      wrap.innerHTML = '<svg width="' + bw + '" height="' + bh +
        '" viewBox="0 0 ' + bw + ' ' + bh + '" aria-hidden="true">' +
        '<path d="' + dPath + '" fill="none" stroke-width="3.5"' +
        ' stroke-linejoin="round" stroke-linecap="round"/></svg>';
      boardEl.appendChild(wrap);
    }

    if (debug) {
      console.log("[triple] build cw=" + cw + " avail=" + avail +
        " rawW=" + Math.round(rawW) + " fit=" + fit.toFixed(3) +
        " board=" + bw + "x" + bh +
        " pivot=" + pivotEl.style.width + "x" + pivotEl.style.height +
        " swivel=(" + Math.round(swX) + ", " + Math.round(swY) + ")px" +
        " view=" + (view + 1) + "/3");
    }
  }

  function setTileMark(el, mark) {
    el.classList.remove("correct", "present", "absent");
    if (mark) el.classList.add(mark);
  }

  // Repaint every hex for the facing board. Only hexes OF the view's
  // board wear that board's clue — every other letter sits colorless
  // (the letter stays, the mark goes), the Swivel off-board law.
  function repaintBoard() {
    for (var key in HEXES) {
      var h = HEXES[key];
      var ch = letterAt(h);
      h.inEl.children[0].textContent = ch;
      setTileMark(h.inEl, (ch && h.own[view]) ? tileMark(h, view) : null);
      h.el.classList.remove("quiet");
    }
  }

  // ---------- keyboard ----------

  var keyEls = {};

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

  // The keyboard follows the view (reset-then-repaint — paintKey only
  // upgrades, so the reset is load-bearing): only the facing board's
  // own hexes feed it, so its keys carry exactly the clues the view
  // colors.
  function repaintKeys() {
    for (var letter in keyEls) {
      var key = keyEls[letter];
      key.classList.remove("correct", "present", "absent");
      key.dataset.state = "";
    }
    for (var key2 in HEXES) {
      var h = HEXES[key2];
      if (!h.own[view]) continue;
      var mark = tileMark(h, view);
      if (mark) paintKey(letterAt(h), mark);
    }
  }

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

  // ---------- game flow ----------

  function resetBoard() {
    guesses = [[], [], []];
    found = [false, false, false];
    done = false;
    gaveUp = false;
    revealing = false;
    view = 0;
    typed = Array(L).fill("");
    pivotEl.classList.add("view-1");
    pivotEl.classList.remove("view-2", "view-3");
    buildBoard();
    buildKeyboard();
    bannerEl.classList.remove("show");
    bannerEl.textContent = "";
    shareBtn.classList.add("hidden");
    updateActions();
  }

  function init() {
    practice = false;
    newBtn.textContent = "Practice";
    var saved = loadSaved();
    if (saved && validSave(saved)) {
      answers = saved.answers.slice();
      quiet = true;
      resetBoard();
      restore(saved);
      quiet = false;
    } else {
      answers = answersFor(todayKey());
      resetBoard();
      saveState();
      showBanner(progressBanner());
    }
  }

  function startPractice(forceA, forceB, forceC) {
    practice = true;
    answers = validWords([forceA, forceB, forceC])
      ? [forceA, forceB, forceC]
      : randomWords();
    resetBoard();
    newBtn.textContent = "Today\u2019s puzzle";
    showBanner("Practice round");
  }

  function randomWords() {
    var pick = function (taken) {
      var w;
      do { w = ANSWERS[Math.floor(Math.random() * ANSWERS.length)]; }
      while (taken.indexOf(w) !== -1);
      return w;
    };
    var a = pick([]);
    var b = pick([a]);
    var c = pick([a, b]);
    return [a, b, c];
  }

  // Replay saved words onto the fresh board with no animation. Marks are
  // pure functions of (letters, answer) and the carry-over derives from
  // the word lists — the save stores words only.
  function restore(saved) {
    saved.w1.forEach(function (w) { guesses[0].push(w); });
    saved.w2.forEach(function (w) { guesses[1].push(w); });
    saved.w3.forEach(function (w) { guesses[2].push(w); });
    view = saved.view;
    pivotEl.classList.add("view-1");
    pivotEl.classList.remove("view-2", "view-3");
    if (view === 1) pivotEl.classList.add("view-2");
    if (view === 2) pivotEl.classList.add("view-3");
    found = [foundB(0), foundB(1), foundB(2)];
    repaintBoard();
    repaintKeys();
    if (saved.done) {
      done = true;
      gaveUp = !!saved.gaveUp;
      showBanner(endBanner());
      shareBtn.classList.remove("hidden");
    } else {
      showBanner(progressBanner());
    }
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
    var idx = pendingLine(view);
    if (idx === -1) {
      toast(lostB(view)
        ? "The " + BOARD_NAME[view] + " board is out \u2014 swivel on"
        : "The " + BOARD_NAME[view] + " word is down \u2014 swivel on");
      return;
    }
    var p;
    for (p = 0; p < L; p++) if (!typed[p]) break;
    if (p >= L) return;
    typed[p] = ch;
    var h = lineHex(view, idx, p + 1);
    h.inEl.children[0].textContent = ch;
  }

  function erase() {
    var p;
    for (p = L - 1; p >= 0; p--) if (typed[p]) break;
    if (p < 0) return;
    typed[p] = "";
    var idx = pendingLine(view);
    if (idx === -1) return;
    var h = lineHex(view, idx, p + 1);
    h.inEl.children[0].textContent = "";
  }

  // Half-typed letters belong to the board being left behind.
  function clearTyped() {
    var idx = pendingLine(view);
    for (var p = 0; p < L; p++) {
      if (typed[p] && idx !== -1) {
        lineHex(view, idx, p + 1).inEl.children[0].textContent = "";
      }
      typed[p] = "";
    }
  }

  // ---------- swiveling ----------

  function swivelTo(v) {
    if (v === view) return;
    clearTyped();
    view = v;
    pivotEl.classList.toggle("view-1", v === 0);
    pivotEl.classList.toggle("view-2", v === 1);
    pivotEl.classList.toggle("view-3", v === 2);
    repaintBoard();
    repaintKeys();
    saveState(); // the view is part of the save — a refresh resumes facing it
  }

  // ---------- submitting a guess ----------

  function submit() {
    var idx = pendingLine(view);
    if (idx === -1) return;
    var word = typed.join("");
    if (word.length < L) { reject("Not enough letters"); return; }
    if (!DICTIONARY.has(word)) { reject("Not in word list"); return; }

    revealing = true;
    var b = view;
    var marks = evaluate(word, answers[b]);
    var anims = [];
    for (var k = 1; k <= L; k++) {
      (function (kk) {
        var h = lineHex(b, idx, kk);
        var apply = function () {
          h.inEl.classList.remove("absent", "present", "correct");
          h.inEl.classList.add(marks[kk - 1]);
          h.inEl.children[0].textContent = word.charAt(kk - 1);
          h.el.classList.remove("quiet");
        };
        anims.push({ el: h.el, delay: 100 + (kk - 1) * FLIP_STAGGER, apply: apply });
      })(k);
    }
    // A leftover `shake` out-ranks `.reveal` (equal specificity, defined
    // later) and would kill the flip — clear it first.
    anims.forEach(function (a) {
      a.el.classList.remove("shake");
      a.el.classList.remove("quiet");
    });
    anims.forEach(function (a) {
      setTimeout(function () { a.el.classList.add("reveal"); }, a.delay);
      setTimeout(a.apply, a.delay + FLIP_MID);
    });
    setTimeout(function () { finish(word); },
      100 + (L - 1) * FLIP_STAGGER + FLIP_MID + 150);
  }

  function finish(word) {
    typed = Array(L).fill("");
    guesses[view].push(word);
    var hadFound = found.slice();
    found = [foundB(0), foundB(1), foundB(2)];

    // newly found lines glow (typed or spelled by the carry-over fill)
    for (var b = 0; b < 3; b++) {
      if (!hadFound[b] && found[b]) glowBoard(b);
    }

    repaintBoard();
    repaintKeys();

    var justFound = [];
    for (var b2 = 0; b2 < 3; b2++) {
      if (!hadFound[b2] && found[b2]) justFound.push(b2);
    }
    var isDone = allDecided();

    if (isDone) {
      done = true;
      showBanner(winBanner());
      shareBtn.classList.remove("hidden");
    } else {
      // name any fresh find
      if (justFound.length) {
        var names = justFound.map(function (b3) { return BOARD_NAME[b3]; });
        if (justFound.length === 1 && justFound[0] !== view) {
          toast("The " + names[0] + " word found itself!");
        } else if (justFound.indexOf(view) !== -1 &&
                   usedB(view) < BUDGET[view]) {
          // found with room to spare: the Swivel invitation — spare rows
          // seed the later boards
          toast("Fill the board for carry clues \u2014 or swivel on");
        }
      }
      // hand over only when this board has nothing left to type: lost,
      // or its budget spent (an early find keeps the view so the player
      // can fill the spare rows). Land on the first open board, or —
      // failing that — the first found board with spare rows.
      if (lostB(view) || usedB(view) >= BUDGET[view]) {
        var nb = -1, fallback = -1;
        for (var b4 = 0; b4 < 3; b4++) {
          if (pendingLine(b4) === -1) continue;
          if (!decidedB(b4)) { nb = b4; break; }
          if (fallback === -1) fallback = b4;
        }
        if (nb === -1) nb = fallback;
        if (nb !== -1) {
          var oldView = view;
          var wasLost = lostB(oldView);
          swivelTo(nb);
          showBanner((wasLost ? BOARD_NAME[oldView] + " is out \u2014 " : "") +
            progressBanner());
        } else {
          showBanner(progressBanner());
        }
      } else if (justFound.length) {
        showBanner(progressBanner());
      }
    }
    updateActions();
    saveState();
    revealing = false;
  }

  function glowBoard(b) {
    for (var i = 0; i < LINES[b]; i++) {
      if (lineWord(b, i) !== answers[b]) continue;
      for (var k = 1; k <= L; k++) {
        var h = lineHex(b, i, k);
        h.el.classList.remove("quiet");
        h.el.classList.add("win-glow");
      }
      return;
    }
  }

  function winBanner() {
    if (foundCount() === 3) {
      var n = typedCount();
      return PRAISE[Math.min(n, PRAISE.length) - 1] +
        " \u2014 all three in " + n + " guesses";
    }
    return endBanner();
  }

  // The end names what survived: "2 of 3" plus the missed words.
  function endBanner() {
    var missed = [];
    for (var b = 0; b < 3; b++) {
      if (!foundB(b)) missed.push({ name: BOARD_NAME[b], word: answers[b].toUpperCase() });
    }
    var n = 3 - missed.length;
    if (n === 2) {
      return "2 of 3 \u2014 the " + missed[0].name + " word was " + missed[0].word;
    }
    var words = missed.map(function (m) { return m.word; });
    var joiner = missed.length === 2 ? " & " : ", ";
    return n + " of 3 \u2014 the words were " + words.join(joiner);
  }

  function progressBanner() {
    if (done) return endBanner();
    var down = 0, out = 0;
    for (var b = 0; b < 3; b++) {
      if (foundB(b)) down++;
      else if (lostB(b)) out++;
    }
    var rest = 3 - down - out;
    if (down === 0 && out === 0) return "Three words to find";
    if (out === 0) return down + " down \u2014 " + rest + " to go";
    if (rest === 0) return down + " down, " + out + " out";
    return down + " down, " + out + " out \u2014 " + rest + " to go";
  }

  // ---------- give up ----------

  function giveUp() {
    if (done || revealing) return;
    clearTyped();
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

  // ---------- feedback ----------

  function showBanner(msg) {
    bannerEl.textContent = msg;
    bannerEl.classList.add("show");
  }

  function reject(msg) {
    toast(msg);
    var idx = pendingLine(view);
    if (idx === -1) return;
    for (var k = 1; k <= L; k++) {
      var h = lineHex(view, idx, k);
      var el = h.el;
      el.classList.remove("quiet");
      el.classList.remove("shake");
      void el.offsetWidth; // restart the animation
      el.classList.add("shake");
      // Drop the class once played, or it overrides the later flip.
      el.addEventListener("animationend", function h2(ev) {
        if (ev.animationName !== "shake") return;
        el.classList.remove("shake");
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
  //
  // Three blocks — blue's rows, orange's columns, purple's rows — one emoji
  // line per line that carries letters, scored against its own board.
  // Carry-over lines share too: they are the record of what the fill
  // told you. Lines with holes pad with the theme empty square.

  function share() {
    var emptyCell = document.documentElement.dataset.theme === "dark" ? "\u2B1B" : "\u2B1C";
    var EMOJI = { correct: "\uD83D\uDFE9", present: "\uD83D\uDFE8", absent: emptyCell };
    var n = foundCount();
    var count = n + "/3";
    var title = ["Triple", practice ? "practice" : todayKey(),
      (gaveUp ? "gave up \u00B7 " : "") + count]
      .join(" \u00B7 ");
    var lines = [title, GAME_URL];
    for (var b = 0; b < 3; b++) {
      var block = [];
      for (var i = 0; i < LINES[b]; i++) {
        if (!lineHasLetters(b, i)) continue;
        var row = "";
        for (var k = 1; k <= L; k++) {
          var h = lineHex(b, i, k);
          var mark = tileMark(h, b);
          row += mark ? EMOJI[mark] : emptyCell;
        }
        block.push(row);
      }
      if (block.length) {
        lines.push("");
        block.forEach(function (l) { lines.push(l); });
      }
    }
    copyText(lines.join("\n"));
  }

  function copyText(text) {
    if (typeof navigator !== "undefined" && navigator.clipboard &&
        navigator.clipboard.writeText) {
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
      // activate it too.
      if (!e.target || e.target.tagName !== "BUTTON") onKey(e.key);
    }
  });

  window.addEventListener("resize", function () {
    if (debug) {
      console.log("[triple] resize (cw=" +
        document.documentElement.clientWidth + ")");
    }
    buildBoard();
    repaintBoard();
  });

  newBtn.addEventListener("click", function () {
    newBtn.blur();
    if (practice) init(); else startPractice();
  });
  giveUpBtn.addEventListener("click", function () { giveUpBtn.blur(); giveUp(); });
  turnBtn.addEventListener("click", function () {
    turnBtn.blur();
    if (revealing) return;
    swivelTo((view + 1) % 3);
  });
  shareBtn.addEventListener("click", function () { shareBtn.blur(); share(); });

  init();

  // Small console/test surface.
  window.TRIPLE = {
    daily: init,
    practice: startPractice,
    todayKey: todayKey,
    answersFor: answersFor,
    evaluate: evaluate,
    lineWord: lineWord,
    tile: function (c, r) { return HEXES[c + "," + r] || null; },
    hexAt: function (b, line, k) { return lineHex(b, line, k); },
    neighbors: neighbors,
    outlineLoops: outlineLoops,
    boards: function () {
      var out = [[], [], []];
      for (var key in HEXES) {
        for (var b = 0; b < 3; b++) {
          if (HEXES[key].own[b]) out[b].push(key);
        }
      }
      return out.map(function (ks) {
        return ks.sort(function (x, y) {
          var a = x.split(","), c = y.split(",");
          return (+a[1] - +c[1]) || (+a[0] - +c[0]);
        });
      });
    },
    view: function () { return view; },
    swivelTo: function (v) { swivelTo(v); },
    // Current sizing snapshot — call TRIPLE.size() in the console after
    // any viewport change (device-mode toggle, rotation) to compare
    // against the build log.
    size: function () {
      var r = {
        clientWidth: document.documentElement.clientWidth,
        board: { width: boardEl.style.width, height: boardEl.style.height },
        pivot: { width: pivotEl.style.width, height: pivotEl.style.height },
        swivel: swivelOff.slice(),
        font: boardEl.style.fontSize,
        view: view + 1
      };
      if (debug) console.log("[triple] size", r);
      return r;
    },
    dump: function () {
      return {
        answers: answers.slice(),
        w1: guesses[0].slice(),
        w2: guesses[1].slice(),
        w3: guesses[2].slice(),
        found: [foundB(0), foundB(1), foundB(2)],
        lost: [lostB(0), lostB(1), lostB(2)],
        done: done,
        gaveUp: gaveUp,
        view: view,
        practice: practice,
        words: {
          w1: [0, 1, 2, 3, 4, 5].map(function (i) { return lineWord(0, i); }),
          w2: [0, 1, 2, 3, 4, 5, 6, 7, 8].map(function (i) { return lineWord(1, i); }),
          w3: [0, 1, 2, 3, 4, 5, 6].map(function (i) { return lineWord(2, i); })
        },
        save: loadSaved()
      };
    }
  };
})();
