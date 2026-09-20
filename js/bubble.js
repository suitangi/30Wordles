// Bubble — Day 7 variant of 30 Wordles.
// One puzzle per day: the answer derives from the calendar date and progress
// is saved to localStorage, so a refresh resumes the same game. Practice
// mode plays a random word without touching the daily save.
//
// A Wordle where every letter you submit blows into a bubble — and the
// puzzle is deliberately COLOR-AGNOSTIC: no greens, no yellows. Shape is
// the only voice. Letters that aren't in the answer POP. Letters that are
// in the answer HOLD as soap bubbles, and when two of them sit side by
// side in your guess AND live in neighbouring spots of the answer (either
// order), their bubbles connect into one long chain — a five-wide
// chain is the answer read forwards or backwards. Only the exact answer wins.
// Six guesses; give up is the loss.
//
// Internally the answer is still scored with full Wordle marks (correct /
// present / absent — the save stores them), but display only ever consults
// in-word vs absent: the keyboard paints kept vs absent, the share draws
// bubbles vs popped squares.
(function () {
  "use strict";

  var ROWS = 6;
  var COLS = 5;
  var SALT = "bubble"; // daily hash salt — each variant salts its own way
  var STORE_KEY = "bubble-day7";
  var GAME_URL = "https://suitangi.github.io/30Wordles/days/7";
  var PRAISE = ["Genius", "Magnificent", "Impressive", "Splendid", "Great",
    "Phew"];

  // The reveal timeline (ms, from Enter): each bubble swells left to
  // right, its fate shows at the swell's peak — survivors firm up, greys
  // begin the slow dramatic pop — then connected survivors press together.
  var SWELL_AT = 60;
  var SWELL_STAGGER = 110;
  var MARK_OFFSET = 200; // fate lands at the swell's peak
  var POP_OFFSET = 120;  // greys begin bursting just after their fate shows
  var MERGE_AT = 1300;   // survivors connect
  var FINISH_AT = 1900;  // board settles back to input

  var ANSWERS = window.WORD_LISTS.answers;
  var DICTIONARY = new Set(window.WORD_LISTS.guesses);

  var boardEl = document.getElementById("board");
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
  var revealing = false;
  var practice = false;
  var guesses = [];   // { w, m } — in submit order, for save + share
  var typed = [];     // the pending row's letters
  var row = 0;        // active row
  var rowEls = [];    // per row: the .brow grid
  var cellEls = [];   // per row: 5 bubble cells, in column order
  var runEls = [];    // per row: [{ el, cols }] — connected chains
  var keyEls = {};
  var toastTimer = null;

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

  // Where each guess letter lives in the answer: greens pin their own
  // position; yellows take the leftmost still-free copy of their letter.
  // Connect decisions are made from this assignment, so duplicates stay
  // deterministic.
  function assignPositions(guess, target, marks) {
    var pos = Array(COLS).fill(-1);
    var used = Array(COLS).fill(false);
    var i, p;
    for (i = 0; i < COLS; i++) {
      if (marks[i] === "correct") { pos[i] = i; used[i] = true; }
    }
    for (i = 0; i < COLS; i++) {
      if (marks[i] !== "present") continue;
      for (p = 0; p < COLS; p++) {
        if (!used[p] && target.charAt(p) === guess.charAt(i)) {
          pos[i] = p;
          used[p] = true;
          break;
        }
      }
    }
    return pos;
  }

  // The bubbles a guess resolves into: a partition of the five columns
  // into consecutive groups. In-word neighbours connect when their assigned
  // answer positions are adjacent — IN EITHER ORDER (suitangi: connect
  // "regardless of correct order"; drift vs dirty must connect its R and I
  // even though dirty reads i-r). A chain is the answer's letters read
  // forwards or backwards. A group of five means the guess is the answer
  // or its reversal — the reversal still doesn't win; only the exact
  // answer does.
  function bubbles(guess, target) {
    var marks = evaluate(guess, target);
    var pos = assignPositions(guess, target, marks);
    var groups = [];
    var i = 0;
    while (i < COLS) {
      var j = i;
      while (j < COLS - 1 && marks[j] !== "absent" &&
             marks[j + 1] !== "absent" &&
             Math.abs(pos[j + 1] - pos[j]) === 1) j++;
      var g = [];
      for (var k = i; k <= j; k++) g.push(k);
      groups.push(g);
      i = j + 1;
    }
    return groups;
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
        gaveUp: gaveUp
      }));
    } catch (e) { /* storage unavailable — game still playable */ }
  }

  // ---------- the board ----------

  function makeCell(ch) {
    var t = document.createElement("div");
    t.className = "tile";
    if (ch) {
      t.textContent = ch;
      t.classList.add("filled");
    }
    return t;
  }

  function buildBoard() {
    boardEl.innerHTML = "";
    rowEls = [];
    cellEls = [];
    runEls = [];
    for (var r = 0; r < ROWS; r++) {
      var rowEl = document.createElement("div");
      rowEl.className = "brow";
      var cells = [];
      for (var c = 0; c < COLS; c++) {
        var cell = makeCell("");
        rowEl.appendChild(cell);
        cells.push(cell);
      }
      boardEl.appendChild(rowEl);
      rowEls.push(rowEl);
      cellEls.push(cells);
      runEls.push([]);
    }
  }

  // The row resolves into its final shape the moment the guess lands:
  // solos keep their column, a run spans its columns. The letters don't
  // move — fusing only fills the seams between them — so the rebuild is
  // invisible until the marks land.
  function rebuildRow(rowIdx, guess, groups) {
    var rowEl = rowEls[rowIdx];
    rowEl.innerHTML = "";
    var cells = Array(COLS).fill(null);
    var runs = [];
    groups.forEach(function (g) {
      if (g.length === 1) {
        var solo = makeCell(guess.charAt(g[0]));
        rowEl.appendChild(solo);
        cells[g[0]] = solo;
        return;
      }
      var run = document.createElement("div");
      run.className = "run";
      run.style.gridColumn = "span " + g.length;
      g.forEach(function (c) {
        var t = makeCell(guess.charAt(c));
        run.appendChild(t);
        cells[c] = t;
      });
      rowEl.appendChild(run);
      runs.push({ el: run, cols: g.slice() });
    });
    cellEls[rowIdx] = cells;
    runEls[rowIdx] = runs;
    return cells;
  }

  // Tag a chain's cells for the connect: which sides clip flat (wr / wl)
  // and where each cell sits in the chain, so CSS can slide them together
  // until the shared walls meet flush. The wall sits at r/2 from each
  // center (Plateau's 120° rule), so each junction closes half a bubble
  // width plus the 5px gap — see --tx in the CSS, which computes that in
  // the bubble's own % so it stays exact at any size.
  function connectRun(run, cells) {
    var k = run.cols.length;
    run.cols.forEach(function (c, i) {
      var cell = cells[c];
      if (i < k - 1) cell.classList.add("wr");
      if (i > 0) cell.classList.add("wl");
      cell.style.setProperty("--ci", i);
      cell.style.setProperty("--ck", k);
    });
  }

  function resetBoard() {
    row = 0;
    done = false;
    won = false;
    gaveUp = false;
    revealing = false;
    guesses = [];
    typed = Array(COLS).fill("");

    buildBoard();
    buildKeyboard();
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

  // Replay saved guesses onto the fresh board with no animation: the row
  // shapes rebuild from the stored marks and the chains are born connected.
  function restore(saved) {
    guesses = [];
    saved.guesses.forEach(function (g) {
      guesses.push({ w: g.w, m: g.m.slice() });
    });
    guesses.forEach(function (g, r) {
      var groups = bubbles(g.w, answer);
      var cells = rebuildRow(r, g.w, groups);
      rowEls[r].classList.add("quiet");
      for (var c = 0; c < COLS; c++) {
        cells[c].classList.remove("filled");
        cells[c].classList.add(g.m[c] === "absent" ? "popped" : "held");
      }
      for (var k = 0; k < COLS; k++) paintKey(g.w.charAt(k), g.m[k]);
      runEls[r].forEach(function (run) {
        run.el.classList.add("on");
        connectRun(run, cells);
      });
    });
    row = guesses.length;

    if (saved.done) {
      done = true;
      won = !!saved.won;
      gaveUp = !!saved.gaveUp;
      if (won) {
        runEls[guesses.length - 1].forEach(function (run) {
          if (run.cols.length === COLS) run.el.classList.add("win");
        });
      }
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

  // ---------- input ----------

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
        var cell = cellEls[row][c];
        cell.textContent = ch;
        cell.classList.add("filled");
        // The letter blows up into its bubble; retype retriggers it.
        cell.classList.remove("bub-in");
        void cell.offsetWidth;
        cell.classList.add("bub-in");
        return;
      }
    }
  }

  function erase() {
    for (var c = COLS - 1; c >= 0; c--) {
      if (typed[c]) {
        typed[c] = "";
        var cell = cellEls[row][c];
        cell.textContent = "";
        cell.classList.remove("filled");
        return;
      }
    }
  }

  // ---------- submitting a guess ----------

  function submit() {
    var guess = typed.join("");
    if (guess.length < COLS) { reject("Not enough letters"); return; }
    if (!DICTIONARY.has(guess)) { reject("Not in word list"); return; }

    revealing = true;
    var rowIdx = row;
    var marks = evaluate(guess, answer);
    var groups = bubbles(guess, answer);
    var cells = rebuildRow(rowIdx, guess, groups);

    // Swell left to right; the fate shows at the swell's peak — survivors
    // firm up their shells, greys begin the slow dramatic pop.
    var won = true;
    for (var c = 0; c < COLS; c++) {
      if (marks[c] !== "correct") won = false;
      (function (cell, mark, at) {
        setTimeout(function () { cell.classList.add("swell"); }, at);
        setTimeout(function () {
          cell.classList.remove("filled");
          if (mark === "absent") cell.classList.add("popped");
          else cell.classList.add("held");
        }, at + MARK_OFFSET);
        if (mark === "absent") {
          setTimeout(function () { cell.classList.add("pop"); },
            at + MARK_OFFSET + POP_OFFSET);
        }
      })(cells[c], marks[c], SWELL_AT + c * SWELL_STAGGER);
    }

    // Then the survivors connect: chains clip flat on their facing sides
    // and slide together until the shared walls meet flush.
    setTimeout(function () {
      runEls[rowIdx].forEach(function (run) {
        run.el.classList.add("on");
        connectRun(run, cellEls[rowIdx]);
      });
      if (won) {
        runEls[rowIdx].forEach(function (run) {
          if (run.cols.length === COLS) run.el.classList.add("win");
        });
      }
    }, MERGE_AT);

    setTimeout(function () { finish(rowIdx, guess, marks, won); }, FINISH_AT);
  }

  function finish(rowIdx, guess, marks, win) {
    for (var c = 0; c < COLS; c++) paintKey(guess.charAt(c), marks[c]);
    guesses.push({ w: guess, m: marks });
    typed = Array(COLS).fill("");

    if (win) {
      done = true;
      won = true;
      showBanner(endBanner());
      shareBtn.classList.remove("hidden");
    } else if (rowIdx === ROWS - 1) {
      done = true;
      showBanner(endBanner());
      shareBtn.classList.remove("hidden");
    } else {
      row = rowIdx + 1;
    }
    updateActions();
    saveState();
    revealing = false;
  }

  function endBanner() {
    if (!won) return "The word was " + answer.toUpperCase();
    var n = guesses.length;
    return PRAISE[Math.min(n - 1, 5)] + " \u2014 " + n +
      (n === 1 ? " guess" : " guesses");
  }

  // Six guesses cap the board, so giving up is the loss: end the game,
  // reveal the answer, freeze the board.
  function giveUp() {
    if (done || revealing) return;
    done = true;
    gaveUp = true;
    typed = Array(COLS).fill("");
    for (var c = 0; c < COLS; c++) {
      var cell = cellEls[row][c];
      cell.textContent = "";
      cell.classList.remove("filled");
    }
    showBanner(endBanner());
    shareBtn.classList.remove("hidden");
    updateActions();
    saveState();
  }

  function updateActions() {
    giveUpBtn.classList.toggle("hidden", done);
  }

  // ---------- keyboard colors ----------

  // The keyboard is two-state, like the board: a letter either lives in
  // the answer (kept) or it doesn't (absent). Full marks still come in
  // from evaluate; they collapse here.
  var RANK = { absent: 1, kept: 2 };
  var KEYMARK = { correct: "kept", present: "kept", absent: "absent" };

  function paintKey(letter, mark) {
    var key = keyEls[letter];
    if (!key) return;
    var km = KEYMARK[mark] || mark;
    var current = key.dataset.state || "";
    if (RANK[km] > (RANK[current] || 0)) {
      if (current) key.classList.remove(current);
      key.classList.add(km);
      key.dataset.state = km;
    }
  }

  // ---------- feedback ----------

  function showBanner(msg) {
    bannerEl.textContent = msg;
    bannerEl.classList.add("show");
  }

  function reject(msg) {
    toast(msg);
    cellEls[row].forEach(function (cell) {
      cell.classList.remove("shake");
      void cell.offsetWidth; // restart the animation
      cell.classList.add("shake");
      // Drop the class once played, or it lingers over the next reveal.
      cell.addEventListener("animationend", function h(ev) {
        if (ev.animationName !== "shake") return;
        cell.removeEventListener("animationend", h);
        cell.classList.remove("shake");
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

  // Share keeps the grid but speaks the game's shape language: a bubble
  // for every letter that held, an empty square for every popped one —
  // no colors, same as the board.
  function share() {
    var emptyCell = document.documentElement.dataset.theme === "dark" ? "\u2B1B" : "\u2B1C";
    var HELD = "\uD83E\uDEE7"; // 🫧
    var score = won ? guesses.length + "/6" : "X/6";
    if (gaveUp) score = "gave up \u00B7 " + score;
    var title = ["Bubble", practice ? "practice" : todayKey(), score]
      .join(" \u00B7 ");
    var lines = [title, GAME_URL];
    guesses.forEach(function (g) {
      lines.push(g.m.map(function (mark) {
        return mark === "absent" ? emptyCell : HELD;
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
  giveUpBtn.addEventListener("click", function () { giveUpBtn.blur(); giveUp(); });
  shareBtn.addEventListener("click", function () { shareBtn.blur(); share(); });

  init();

  // Console tuning for the lamella depth: the shared wall's distance from
  // each bubble's edge, as a % of the bubble width. Everything derives
  // from the one --wall-inset property (clip, lamella stripes, slide), so
  // the walls stay flush at any value — and it applies live to chains
  // already on the board. Plateau-correct is 25% (wall at r/2, 120°).
  function currentWall() {
    var v = getComputedStyle(document.body).getPropertyValue("--wall-inset");
    return (v && v.trim()) || "25%";
  }
  function wall(inset) {
    if (typeof inset === "number") {
      if (!(inset > 0 && inset < 0.5)) {
        toast("wall: give a fraction between 0 and 0.5");
        return currentWall();
      }
      document.body.style.setProperty("--wall-inset",
        (inset * 100).toFixed(2) + "%");
    } else if (typeof inset === "string" && /%\s*$/.test(inset)) {
      document.body.style.setProperty("--wall-inset", inset.trim());
    } else {
      toast("wall: try BUBBLE.wall(0.25)");
      return currentWall();
    }
    return currentWall();
  }

  // Small console/test surface.
  window.BUBBLE = {
    daily: init,
    practice: startPractice,
    todayKey: todayKey,
    answerFor: answerFor,
    evaluate: evaluate,
    assign: assignPositions,
    bubbles: bubbles,
    wall: wall,
    dump: function () {
      return {
        answer: answer,
        rows: guesses.map(function (g) {
          return { w: g.w, m: g.m.join(""), bubbles: bubbles(g.w, answer) };
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
