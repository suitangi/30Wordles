// Swivel — Day 8 variant of 30 Wordles.
// One puzzle per day: two answers derive from the calendar date and
// progress is saved to localStorage, so a refresh resumes the same game.
// Practice mode plays a random pair without touching the daily save.
//
// Two wordles at right angles share their letters. The MAIN board is a
// normal Wordle: 5 wide x 6 tall, words read across, salt "swivel". The
// HORIZONTAL board sits to its right: 8 wide x 5 tall, words read DOWN
// its columns with the letters turned a quarter-turn (tops left), salt
// "swivel-b". The two boards overlap in the main board's bottom 5x5 block
// — 25 shared tiles, one letter each, scored BOTH ways.
//
// You type on whichever board faces you: upright, the main board;
// swiveled, the horizontal board's open columns. The Swivel button turns
// the board clockwise (and the glyphs counter-rotate so every letter
// lands face-up); it swaps the shared tiles' clues and the keyboard to
// the other board's answer. Main guesses #2-#6 ARE the horizontal
// board's first five columns (the transpose) — each shared tile's
// down-clue is its letter scored against the horizontal answer at its
// own spot, available the moment the letter lands. When the sixth main
// word completes the columns the block pulses, and a column that spells
// the horizontal answer finds it on the spot. The automatic swivels: all
// six main rows used turns the board over to the horizontal word, and
// spent columns with main rows still open turns it back. The game ends
// the moment its outcome is certain — both words found = win; main word
// down but the columns spent = a main-only win; the horizontal word
// found on an already-full main board = a horizontal-only loss;
// everything spent and wrong = the loss. Give up = the loss.
(function () {
  "use strict";

  var L = 5;           // word length
  var M_ROWS = 6;      // main board guesses (words read across)
  var H_COLS = 8;      // horizontal board guesses (words read down)
  var SHARED = 5;      // columns the boards share (the 5x5 = 25-tile overlap)
  var MAX_FRESH = H_COLS - SHARED; // 3 open columns on the horizontal board
  var GAP = 5;         // tile gap, keep in sync with the CSS
  var SALT = "swivel";
  var FLIP_STAGGER = 280; // ms between tile flips
  var FLIP_MID = 270;     // half-turn point: the score color appears here
  var STORE_KEY = "swivel-day8";
  var GAME_URL = "https://suitangi.github.io/30Wordles/days/8";
  var PRAISE = ["Genius", "Magnificent", "Impressive", "Splendid", "Great", "Phew"];

  var ANSWERS = window.WORD_LISTS.answers;
  var DICTIONARY = new Set(window.WORD_LISTS.guesses);

  var boardEl = document.getElementById("board");
  var pivotEl = document.getElementById("pivot");
  var keyboardEl = document.getElementById("keyboard");
  var bannerEl = document.getElementById("banner");
  var toastEl = document.getElementById("toast");
  var newBtn = document.getElementById("new-btn");
  var giveUpBtn = document.getElementById("giveup-btn");
  var turnBtn = document.getElementById("turn-btn");
  var shareBtn = document.getElementById("share-btn");

  var answers = ["", ""];
  var mainGuesses = [];   // the main board's rows (and the shared columns' letters)
  var secondGuesses = []; // words typed into the horizontal board's open columns
  var foundM = false;
  var foundS = false;
  var hRevealed = false;  // the shared columns have completed (drives the pulse)
  var done = false;
  var won = false;
  var gaveUp = false;
  var swiveled = false;  // the view AND the input target (persisted)
  var revealing = false;
  var practice = false;
  var quiet = false;     // restore flag: rebuilt tiles are born resolved
  var typed = [];
  var cells = {};        // "r,c" (0-based grid coords) -> tile element
  var keyEls = {};
  var toastTimer = null;

  // ---------- the two wordles ----------

  // Standard Wordle evaluation: exact matches first, then stray letters.
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

  // The horizontal board's column k as a WORD (in word order), or "" while
  // it doesn't exist. Columns 0-4 are the transpose: their letters are the
  // main board's letters — column k read in word order is main guesses
  // #6..#2's k-th letters (the board is a rotated Wordle, so word order
  // runs bottom-to-top; letter 0 sits at the column's bottom). They only
  // exist once all six main rows are in. Columns 5-7 are the fresh words.
  function hWord(k) {
    if (k >= SHARED) {
      var j = k - SHARED;
      return j < secondGuesses.length ? secondGuesses[j] : "";
    }
    if (mainGuesses.length < M_ROWS) return "";
    var w = "";
    for (var i = 0; i < L; i++) w += mainGuesses[M_ROWS - 1 - i].charAt(k);
    return w;
  }

  function typedCount() { return mainGuesses.length + secondGuesses.length; }

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

  // Two deterministic daily words: the second salts differently so the pair
  // is stable but independent; a collision steps one word down the list.
  function answersFor(key) {
    var a = ANSWERS[hash(SALT + key) % ANSWERS.length];
    var b = ANSWERS[hash(SALT + "-b" + key) % ANSWERS.length];
    while (b === a) b = ANSWERS[(ANSWERS.indexOf(b) + 1) % ANSWERS.length];
    return [a, b];
  }

  function validWords(ws) {
    return Array.isArray(ws) && ws.length === 2 &&
      DICTIONARY.has(ws[0]) && DICTIONARY.has(ws[1]) && ws[0] !== ws[1];
  }

  function inDict(w) { return typeof w === "string" && DICTIONARY.has(w); }

  function validSave(s) {
    if (!s || s.date !== todayKey() || !validWords(s.answers)) return false;
    if (!Array.isArray(s.main) || s.main.length > M_ROWS ||
        !s.main.every(inDict)) return false;
    if (!Array.isArray(s.second) || s.second.length > MAX_FRESH ||
        !s.second.every(inDict)) return false;
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
        main: mainGuesses,
        second: secondGuesses,
        swiveled: swiveled,
        done: done,
        won: won,
        gaveUp: gaveUp
      }));
    } catch (e) { /* storage unavailable — game still playable */ }
  }

  // ---------- board ----------
  //
  // Grid coords (0-based), 6 rows x 8 cols: main guess g, letter c -> cell
  // (g, c) for g 0..5, c 0..4. Horizontal column k, word-letter i -> cell
  // (5 - i, k) — letter 0 at the bottom (row 5), letter 4 at the top
  // (row 1). The boards share cells (1..5, 0..4): 25 duo tiles. Row 0's
  // last three slots belong to no board. Cell types: row 0 = plain m-tile;
  // the 25 shared = duo (one letter, one clue at a time — main wordle's
  // upright, horizontal wordle's swiveled); the rest = s-tile (rotated
  // glyph, horizontal clues only).

  function cellAt(r, c) { return cells[r + "," + c] || null; }
  function mainCell(g, c) { return cellAt(g, c); }
  // Horizontal word-letter i (0-based, word order) sits at grid row 5-i:
  // letter 0 at the bottom (row 5), letter 4 at the top (row 1).
  function hCellAt(k, i) { return cellAt(M_ROWS - 1 - i, k); }

  function makeTile(cls) {
    var t = document.createElement("div");
    // Restored boards are born resolved: their tiles carry `quiet` (no
    // animations). submit()/reject()/repaintMain() strip it from cells as
    // they animate or repaint, so play after a refresh still flips like
    // fresh play.
    t.className = "tile " + cls + " ghost" + (quiet ? " quiet" : "");
    return t;
  }

  function makeLetterSpan() {
    var s = document.createElement("span");
    s.className = "lt";
    return s;
  }

  function buildBoard() {
    boardEl.innerHTML = "";
    cells = {};
    for (var r = 0; r < M_ROWS; r++) {
      for (var c = 0; c < H_COLS; c++) {
        var inMain = c < L;
        var inH = r >= 1;
        if (!inMain && !inH) continue; // the 3 slots above the horizontal board
        var cls = r === 0 ? "m-tile" : c < SHARED ? "duo" : "s-tile";
        var el = makeTile(cls);
        el.appendChild(makeLetterSpan()); // every glyph rides a span so it can turn
        el.style.gridRow = String(r + 1);
        el.style.gridColumn = String(c + 1);
        boardEl.appendChild(el);
        cells[r + "," + c] = el;
      }
    }
    // Board dividers: a dotted line per view, both living inside the
    // rotating board. Upright, divider-m stands in the gap between main
    // columns 5 and 6; swiveled, divider-h lies in the gap between main
    // rows 1 and 2 — on screen that lands between the horizontal board's
    // letter columns and the main-only heel column. The view class shows
    // one and hides the other.
    var dividerM = document.createElement("div");
    dividerM.className = "divider divider-m";
    boardEl.appendChild(dividerM);
    var dividerH = document.createElement("div");
    dividerH.className = "divider divider-h";
    boardEl.appendChild(dividerH);
  }

  function setTileMark(el, mark) {
    el.classList.remove("correct", "present", "absent");
    if (mark) el.classList.add(mark);
  }

  // A shared tile's down-clue: its letter scored against the HORIZONTAL
  // answer at the tile's own spot in the word. The transpose reads
  // bottom-up, so main-guess row g holds word position (L - g) — a
  // column that spells the answer goes all green. Available the moment
  // the letter lands — no completion gate, no provisional/final flip.
  // (The transpose is never typed, so there is no canonical word score
  // to defer to; consistency beats duplicate pedantry here.)
  function tileDownMark(g, c) {
    var ch = mainGuesses[g].charAt(c);
    if (ch === answers[1].charAt(L - g)) return "correct";
    return answers[1].indexOf(ch) !== -1 ? "present" : "absent";
  }

  // Paint a main-board letter + its VIEW-APPROPRIATE clue. Upright, the
  // shared tiles score the main word; swiveled, they score the horizontal
  // one. Row 1 is main-board-only: colorless swiveled, since its letters
  // are in no horizontal column and can't clue that answer.
  function paintMainNow(g, c, w, mm) {
    var el = mainCell(g, c);
    el.classList.remove("ghost", "filled", "quiet");
    el.children[0].textContent = w.charAt(c);
    var mark = null;
    if (g === 0) {
      if (!swiveled) mark = mm[c];
    } else if (!swiveled) {
      mark = mm[c];
    } else {
      mark = tileDownMark(g, c);
    }
    setTileMark(el, mark);
  }

  // A committed shared tile, painted for the current view.
  function paintDuo(g, c) {
    var el = mainCell(g, c);
    el.classList.remove("ghost", "filled", "quiet");
    el.children[0].textContent = mainGuesses[g].charAt(c);
    setTileMark(el, swiveled ? tileDownMark(g, c)
      : evaluate(mainGuesses[g], answers[0])[c]);
  }

  // Repaint main guess #1, all 25 shared tiles, and any committed fresh
  // columns for the current view (view toggles, restore). The fresh
  // columns matter as much as the duos here: without this loop they keep
  // their horizontal clues after swiveling back upright.
  function repaintMain() {
    if (mainGuesses.length > 0) {
      var mm0 = evaluate(mainGuesses[0], answers[0]);
      for (var c0 = 0; c0 < L; c0++) {
        var el0 = mainCell(0, c0);
        el0.classList.remove("ghost", "filled", "quiet");
        el0.children[0].textContent = mainGuesses[0].charAt(c0);
        setTileMark(el0, swiveled ? null : mm0[c0]);
      }
    }
    for (var g = 1; g < M_ROWS; g++) {
      if (!mainGuesses[g]) continue;
      for (var c = 0; c < L; c++) paintDuo(g, c);
    }
    for (var j = 0; j < secondGuesses.length; j++) {
      var k = SHARED + j;
      for (var i = 0; i < L; i++) paintFreshNow(k, i, secondGuesses[j],
        evaluate(secondGuesses[j], answers[1]));
    }
  }

  function paintFreshNow(k, i, w, sm) {
    var el = hCellAt(k, i);
    el.classList.remove("ghost", "filled", "quiet");
    el.children[0].textContent = w.charAt(i);
    // fresh columns read only swiveled — upright they're the other
    // board's territory and go colorless
    setTileMark(el, swiveled ? sm[i] : null);
  }

  // Where typed letters land right now — the board facing the player.
  function pendingRow() { return mainGuesses.length; }
  function pendingCol() { return SHARED + secondGuesses.length; }

  function resetBoard() {
    foundM = false;
    foundS = false;
    hRevealed = false;
    done = false;
    won = false;
    gaveUp = false;
    revealing = false;
    mainGuesses = [];
    secondGuesses = [];
    typed = Array(L).fill("");
    swiveled = false;
    pivotEl.classList.remove("swiveled");
    turnBtn.setAttribute("aria-pressed", "false");

    buildBoard();
    buildKeyboard();
    layoutPivot();
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
    if (saved && validSave(saved)) {
      answers = saved.answers.slice();
      quiet = true;
      resetBoard();
      restore(saved);
      quiet = false;
    } else {
      answers = answersFor(key);
      resetBoard();
      saveState();
      showBanner("Two words to find");
    }
  }

  // Random pair, never saved — the daily game stays untouched. A forced
  // pair ("crane", "cramp") is the debugging backdoor.
  function startPractice(forceA, forceB) {
    practice = true;
    answers = validWords([forceA, forceB])
      ? [forceA, forceB]
      : randomWords();
    resetBoard();
    newBtn.textContent = "Today\u2019s puzzle";
    showBanner("Practice round");
  }

  function randomWords() {
    var a = ANSWERS[Math.floor(Math.random() * ANSWERS.length)];
    var b = a;
    while (b === a) b = ANSWERS[Math.floor(Math.random() * ANSWERS.length)];
    return [a, b];
  }

  // Replay saved words onto the fresh board with no animation. Marks are
  // pure functions of (letters, answer) — the save stores words only and
  // the board repaints from scratch. The saved view decides both the
  // rotation and where typing resumes.
  function restore(saved) {
    // Legacy saves from the first build used a phase2 flag instead of a
    // view; six main rows imply swiveled regardless.
    hRevealed = saved.main.length >= M_ROWS;
    swiveled = !!(saved.swiveled || saved.phase2) || saved.main.length >= M_ROWS;
    saved.main.forEach(function (w) {
      mainGuesses.push(w);
      if (w === answers[0]) foundM = true;
    });
    saved.second.forEach(function (w, j) {
      var k = SHARED + j;
      var sm = evaluate(w, answers[1]);
      for (var i = 0; i < L; i++) paintFreshNow(k, i, w, sm);
      secondGuesses.push(w);
      // a horizontal guess never finds the main word (see finish)
      if (w === answers[1]) foundS = true;
    });
    if (hRevealed) {
      for (var k = 0; k < SHARED; k++) {
        if (hWord(k) === answers[1]) foundS = true;
      }
    }
    if (swiveled) {
      pivotEl.classList.add("swiveled");
      turnBtn.setAttribute("aria-pressed", "true");
      layoutPivot();
    }
    repaintMain();
    repaintKeys();

    if (saved.done) {
      done = true;
      won = !!saved.won;
      gaveUp = !!saved.gaveUp;
      showBanner(won ? winBanner() : endBanner());
      shareBtn.classList.remove("hidden");
    } else {
      showBanner(progressBanner());
    }
    updateActions();
  }

  function repaintKeys() {
    for (var letter in keyEls) {
      var key = keyEls[letter];
      key.classList.remove("correct", "present", "absent");
      key.dataset.state = "";
    }
    function mark(w, marks) {
      for (var c = 0; c < L; c++) paintKey(w.charAt(c), marks[c]);
    }
    if (!swiveled) {
      mainGuesses.forEach(function (w) {
        mark(w, evaluate(w, answers[0]));
      });
    } else {
      for (var g = 1; g < M_ROWS; g++) {
        if (!mainGuesses[g]) continue;
        for (var c = 0; c < L; c++) paintKey(mainGuesses[g].charAt(c), tileDownMark(g, c));
      }
      secondGuesses.forEach(function (w) {
        mark(w, evaluate(w, answers[1]));
      });
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

  // ---------- pivot sizing ----------

  // The board is 8 columns x 6 rows of square tiles. The pivot box is
  // sized in px so the swivel can swap its width/height around the
  // rotating board (rotated, the footprint is 6 x 8).
  function layoutPivot() {
    var avail = (document.documentElement.clientWidth || 1024) - 48;
    avail = Math.min(avail, 420);
    var t = Math.max(24, Math.floor((avail - (H_COLS - 1) * GAP) / H_COLS));
    var w = t * H_COLS + GAP * (H_COLS - 1);
    var h = t * M_ROWS + GAP * (M_ROWS - 1);
    boardEl.style.width = w + "px";
    boardEl.style.height = h + "px";
    boardEl.style.fontSize = Math.round(t * 0.5) + "px";
    pivotEl.style.width = (swiveled ? h : w) + "px";
    pivotEl.style.height = (swiveled ? w : h) + "px";
  }

  // ---------- input ----------

  function onKey(key) {
    if (done || revealing) return;
    if (key === "Enter") { submit(); return; }
    if (key === "Backspace") { erase(); return; }
    if (/^[a-z]$/.test(key)) typeLetter(key);
  }

  // Letters land on whichever board faces the player: across the main
  // board's next row (from row 2 on, each tile IS a horizontal-board
  // letter too, so one write serves both boards), or climbing the
  // horizontal board's next open column bottom-up (word order — which
  // reads left-to-right once swiveled).
  function typeLetter(ch) {
    if (!swiveled && pendingRow() >= M_ROWS) {
      toast("The main board is full \u2014 swivel to keep guessing");
      return;
    }
    if (swiveled && pendingCol() >= H_COLS) {
      toast("The horizontal board is full \u2014 swivel back to the main word");
      return;
    }
    var p;
    for (p = 0; p < L; p++) if (!typed[p]) break;
    if (p >= L) return;
    typed[p] = ch;
    var el = !swiveled
      ? mainCell(pendingRow(), p)
      : hCellAt(pendingCol(), p);
    el.children[0].textContent = ch;
    el.classList.remove("ghost");
    el.classList.add("filled");
  }

  function erase() {
    var p;
    for (p = L - 1; p >= 0; p--) if (typed[p]) break;
    if (p < 0) return;
    typed[p] = "";
    var el = !swiveled
      ? mainCell(pendingRow(), p)
      : hCellAt(pendingCol(), p);
    el.children[0].textContent = "";
    el.classList.add("ghost");
    el.classList.remove("filled");
  }

  // Half-typed letters belong to the board being left behind: clear them
  // when the view turns.
  function clearTyped() {
    while (typed.some(function (ch) { return ch; })) erase();
  }

  // ---------- submitting a guess ----------

  function submit() {
    var guess = typed.join("");
    if (guess.length < L) { reject("Not enough letters"); return; }
    if (!DICTIONARY.has(guess)) { reject("Not in word list"); return; }

    revealing = true;
    var g = pendingRow(), k = pendingCol();
    var mm = evaluate(guess, answers[0]);
    var sm = evaluate(guess, answers[1]);

    var anims = [];
    if (!swiveled) {
      for (var c = 0; c < L; c++) {
        anims.push({ delay: 100 + c * FLIP_STAGGER, el: mainCell(g, c),
          apply: (function (cc) {
            return function () { paintMainNow(g, cc, guess, mm); };
          })(c) });
      }
    } else {
      // word order climbs the column
      for (var i = 0; i < L; i++) {
        anims.push({ delay: 100 + i * FLIP_STAGGER, el: hCellAt(k, i),
          apply: (function (ii) {
            return function () { paintFreshNow(k, ii, guess, sm); };
          })(i) });
      }
    }
    // A rejected attempt leaves `shake` behind; equal specificity, defined
    // after .reveal, it would override the flip — clear it first. `quiet`
    // (restore-born cells) goes too, or it would mute the flip.
    anims.forEach(function (a) {
      a.el.classList.remove("shake");
      a.el.classList.remove("quiet");
    });
    anims.forEach(function (a) {
      setTimeout(function () { a.el.classList.add("reveal"); }, a.delay);
      setTimeout(a.apply, a.delay + FLIP_MID);
    });
    setTimeout(function () { finish(guess, mm, sm); },
      100 + (L - 1) * FLIP_STAGGER + FLIP_MID + 150);
  }

  function finish(guess, mm, sm) {
    typed = Array(L).fill("");
    var hadM = foundM, hadS = foundS;
    if (!swiveled) mainGuesses.push(guess);
    else secondGuesses.push(guess);

    // The keyboard always reflects the current view, rebuilt from the
    // committed words (a horizontal guess feeds the swiveled keyboard; a
    // main guess the upright one — whichever way the player is facing).
    repaintKeys();
    // A guess can only find the word of the board it was played on: main
    // rows hunt the main answer, horizontal columns the horizontal one.
    if (!swiveled && guess === answers[0]) foundM = true;
    if (swiveled && guess === answers[1]) foundS = true;
    // ...or a completed shared column can spell the horizontal answer
    var justRevealed = false;
    if (!swiveled && mainGuesses.length >= M_ROWS && !hRevealed) {
      hRevealed = true;
      justRevealed = true;
    }
    if (hRevealed && !foundS) {
      for (var k = 0; k < SHARED; k++) {
        if (hWord(k) === answers[1]) { foundS = true; break; }
      }
    }
    if (justRevealed) {
      for (var g = 1; g < M_ROWS; g++) {
        for (var gc = 0; gc < L; gc++) mainCell(g, gc).classList.add("scored");
      }
    }

    if (foundM && foundS) {
      done = true;
      won = true;
      glowWin();
      showBanner(winBanner());
      shareBtn.classList.remove("hidden");
    } else if (foundS && mainGuesses.length >= M_ROWS) {
      // (2) the main board filled without its word: the main wordle is
      // LOST — no rescuing it on a column — but the horizontal answer
      // was found. Game over, split outcome.
      done = true;
      won = false;
      showBanner(endBanner());
      shareBtn.classList.remove("hidden");
    } else if (secondGuesses.length >= MAX_FRESH &&
               (foundM || mainGuesses.length >= M_ROWS)) {
      // (1) main found but the open columns are spent without the
      // horizontal answer, or (3) both boards filled with wrong guesses.
      // Columns spent while main rows remain open do NOT end it — the
      // main word is still findable.
      done = true;
      won = false;
      showBanner(endBanner());
      shareBtn.classList.remove("hidden");
    } else {
      var findBanner = null;
      if (foundM && !hadM) findBanner = "Main word down \u2014 one to go";
      else if (foundS && !hadS) findBanner = "Horizontal word down \u2014 one to go";
      if (!swiveled && mainGuesses.length >= M_ROWS) {
        autoSwivel();
        if (findBanner) showBanner(findBanner);
      } else if (swiveled && secondGuesses.length >= MAX_FRESH) {
        autoSwivelBack();
      } else if (findBanner) {
        showBanner(findBanner);
      }
    }
    updateActions();
    saveState();
    revealing = false;
  }

  function winBanner() {
    var n = typedCount();
    return PRAISE[Math.min(n, PRAISE.length) - 1] +
      " \u2014 both words in " + n;
  }

  // The end reveal names the split outcome: it is possible to finish with
  // one word down and the other lost, and "The words were..." alone would
  // flatten that into a plain loss.
  function endBanner() {
    var a = answers[0].toUpperCase();
    var b = answers[1].toUpperCase();
    if (foundM && !foundS) {
      return "Main word down \u2014 the horizontal word was " + b;
    }
    if (foundS && !foundM) {
      return "Horizontal word down \u2014 the main word was " + a;
    }
    return "The words were " + a + " & " + b;
  }

  function progressBanner() {
    if (done) return endBanner();
    if (foundM) return "Main word down \u2014 one to go";
    if (foundS) return "Horizontal word down \u2014 one to go";
    if (secondGuesses.length >= MAX_FRESH) {
      return "Columns spent \u2014 the main word remains";
    }
    if (swiveled) return "Swiveled \u2014 finish the horizontal word";
    return "Two words to find";
  }

  // The ONLY automatic swivel: all six main rows are used up. The board
  // turns clockwise and guessing continues on the horizontal board.
  function autoSwivel() {
    if (swiveled) return;
    clearTyped();
    swiveled = true;
    pivotEl.classList.add("swiveled");
    turnBtn.setAttribute("aria-pressed", "true");
    layoutPivot();
    repaintMain();
    repaintKeys();
    showBanner("Main board full \u2014 swiveled to the horizontal word");
    updateActions();
  }

  // Columns spent with main rows still open: the main word is the only
  // live target left, so the board turns back counterclockwise for it.
  function autoSwivelBack() {
    if (!swiveled) return;
    clearTyped();
    swiveled = false;
    pivotEl.classList.remove("swiveled");
    turnBtn.setAttribute("aria-pressed", "false");
    layoutPivot();
    repaintMain();
    repaintKeys();
    showBanner("Horizontal board full \u2014 back to the main word");
    updateActions();
  }

  // A soft glow along whichever lines hold the found words.
  function glowWin() {
    var g = mainGuesses.indexOf(answers[0]);
    if (g !== -1) {
      for (var c = 0; c < L; c++) mainCell(g, c).classList.add("win-glow");
    }
    for (var k = 0; k < H_COLS; k++) {
      if (hWord(k) !== answers[1]) continue;
      for (var i = 0; i < L; i++) hCellAt(k, i).classList.add("win-glow");
    }
  }

  // Giving up is the loss: end the game, reveal both words, freeze it.
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
    var row = [];
    if (!swiveled) {
      if (pendingRow() < M_ROWS) {
        for (var c = 0; c < L; c++) row.push(mainCell(pendingRow(), c));
      }
    } else if (pendingCol() < H_COLS) {
      for (var i = 0; i < L; i++) row.push(hCellAt(pendingCol(), i));
    }
    row.forEach(function (tile) {
      tile.classList.remove("quiet");
      tile.classList.remove("shake");
      void tile.offsetWidth; // restart the animation
      tile.classList.add("shake");
      // Drop the class once played, or it overrides the later flip animation.
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

  // Two blocks: the main board's rows, a blank line, then the horizontal
  // board's scored columns in word order — the same letters, both reads.
  function share() {
    var emptyCell = document.documentElement.dataset.theme === "dark" ? "\u2B1B" : "\u2B1C";
    var EMOJI = { correct: "\uD83D\uDFE9", present: "\uD83D\uDFE8", absent: emptyCell };
    var n = typedCount();
    var count = won ? n + "/9" : "X/9";
    // a finished game can end with one word down and the other lost —
    // name which side survived instead of flattening it into X/9
    var foundTag = "";
    if (!won) {
      if (foundM && !foundS) foundTag = "main only \u00B7 ";
      else if (foundS && !foundM) foundTag = "horizontal only \u00B7 ";
    }
    var title = ["Swivel", practice ? "practice" : todayKey(),
      gaveUp ? "gave up \u00B7 " + foundTag + count : foundTag + count]
      .join(" \u00B7 ");
    var lines = [title, GAME_URL];
    mainGuesses.forEach(function (w) {
      lines.push(evaluate(w, answers[0]).map(function (m) { return EMOJI[m]; }).join(""));
    });
    var hLines = [];
    for (var k = 0; k < H_COLS; k++) {
      var w = hWord(k);
      if (!w) continue;
      hLines.push(evaluate(w, answers[1]).map(function (m) { return EMOJI[m]; }).join(""));
    }
    if (lines.length > 2 && hLines.length) lines.push("");
    hLines.forEach(function (l) { lines.push(l); });
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

  window.addEventListener("resize", function () { layoutPivot(); });

  newBtn.addEventListener("click", function () {
    newBtn.blur();
    if (practice) init(); else startPractice();
  });
  giveUpBtn.addEventListener("click", function () { giveUpBtn.blur(); giveUp(); });
  turnBtn.addEventListener("click", function () {
    turnBtn.blur();
    if (revealing) return;
    clearTyped(); // half-typed letters belong to the board being left
    swiveled = !swiveled;
    pivotEl.classList.toggle("swiveled", swiveled);
    turnBtn.setAttribute("aria-pressed", swiveled ? "true" : "false");
    layoutPivot();
    repaintMain(); // the shared tiles' clues follow the view...
    repaintKeys(); // ...and so does the keyboard
  });
  shareBtn.addEventListener("click", function () { shareBtn.blur(); share(); });

  init();

  // Small console/test surface.
  window.SWIVEL = {
    daily: init,
    practice: startPractice,
    todayKey: todayKey,
    answersFor: answersFor,
    evaluate: evaluate,
    cell: cellAt,
    dump: function () {
      return {
        answers: answers.slice(),
        main: mainGuesses.slice(),
        second: secondGuesses.slice(),
        hWords: [0, 1, 2, 3, 4, 5, 6, 7].map(hWord),
        foundM: foundM,
        foundS: foundS,
        swiveled: swiveled,
        hRevealed: hRevealed,
        practice: practice,
        done: done,
        won: won,
        gaveUp: gaveUp,
        save: loadSaved()
      };
    }
  };
})();
