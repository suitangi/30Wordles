// Encircle — Day 12 variant of 30 Wordles.
// One puzzle per day: the answer derives from the calendar date and
// progress is saved to localStorage, so a refresh resumes the same game.
// Practice mode plays a random word without touching the daily save.
//
// A normal Wordle with seven guesses — except the answer sits on a RING.
// Its first letter starts at a hidden tile and the rest wrap around the
// end: display("modal", 2) reads "almod". Your guess is a ring too — the
// ‹ › arrows (or ←/→) spin it around the board, and the marked tile is
// your word's first letter. Spin before, during or after typing. Marks
// score the tiles AS DISPLAYED, so five greens need the right word at the
// right start: the correct word spun wrong reads as a ring of yellows.
// Seven guesses; the seventh miss or give up is the loss.
//
// Marks are a pure function of (guess, its start, answer, its start), so
// the save stores just { w, s } per guess and restore recomputes them.
(function () {
  "use strict";

  var COLS = 5;
  var ROWS = 7;
  var SALT = "encircle";  // daily hash salt — each variant salts its own way
  var FLIP_STAGGER = 280; // ms between tile flips
  var FLIP_MID = 270;     // half-turn point: the score color appears here
  var STORE_KEY = "encircle-day12";
  var GAME_URL = "https://suitangi.github.io/30Wordles/days/12";
  var PRAISE = ["Genius", "Magnificent", "Impressive", "Splendid", "Great",
    "Phew"];
  var OPEN_BANNER = "Find the word \u2014 and where it starts";

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
  var aStart = 0;        // where the ANSWER's first letter sits — the secret
  var done = false;
  var won = false;
  var gaveUp = false;
  var revealing = false;
  var practice = false;
  var quietRows = false; // restore flag: rebuilt rows skip enter animations
  var guesses = [];      // { w, s } — the word and where its start sat
  var typed = [];        // the active row's letters, in word order
  var start = 0;         // where the pending word currently starts
  var rowEls = [];       // rowEls[r] — .erow: rot, five tiles, rot
  var keyEls = {};       // letter -> key button
  var toastTimer = null;

  // ---------- the ring ----------

  // The word read onto the board from tile s onward, wrapping: tile i
  // shows word[(i - s) mod 5]. display("modal", 2) === "almod".
  function display(word, s) {
    var out = "";
    for (var i = 0; i < COLS; i++) {
      out += word.charAt((((i - s) % COLS) + COLS) % COLS);
    }
    return out;
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

  // The answer's hidden starting tile: its own salted hash, finalized
  // before the mod (the Toggle lesson about narrow hash bits). The last
  // step must go unsigned — ^ is signed in JS and would skew the mod.
  function startFor(key) {
    var h = 0;
    var s = SALT + "-ring" + key;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    h ^= h >>> 16; h = (h * 0x45d9f3b) >>> 0; h ^= h >>> 16;
    return (h >>> 0) % COLS;
  }

  function validAnswer(w) {
    return typeof w === "string" && DICTIONARY.has(w);
  }

  function isStart(n) {
    return Number.isInteger(n) && n >= 0 && n < COLS;
  }

  function validSave(saved) {
    if (!saved || saved.date !== todayKey() || !validAnswer(saved.answer)) {
      return false;
    }
    if (!isStart(saved.start)) return false;
    return Array.isArray(saved.guesses) && saved.guesses.length <= ROWS &&
      saved.guesses.every(function (g) {
        return g && validAnswer(g.w) && isStart(g.s);
      });
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
        start: aStart,
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
    typed = [];
    start = 0;
    rowEls = [];

    boardEl.innerHTML = "";
    boardEl.classList.remove("overflowing");
    bannerEl.classList.remove("show");
    bannerEl.textContent = "";
    shareBtn.classList.add("hidden");
    updateActions();

    addRow();
    buildKeyboard();
    paintPending();
  }

  // Rows are built on demand — seven at most. Each carries its own pair of
  // ring controls, visible only while the row is the live one.
  function addRow() {
    var row = document.createElement("div");
    row.className = quietRows ? "erow quiet" : "erow";
    var west = document.createElement("button");
    west.type = "button";
    west.className = "rot west";
    west.textContent = "\u2039";
    west.setAttribute("aria-label", "Rotate the word left");
    west.addEventListener("click", function () { rotate(-1); west.blur(); });
    row.appendChild(west);
    for (var c = 0; c < COLS; c++) {
      var tile = document.createElement("div");
      tile.className = "tile";
      row.appendChild(tile);
    }
    var east = document.createElement("button");
    east.type = "button";
    east.className = "rot east";
    east.textContent = "\u203A";
    east.setAttribute("aria-label", "Rotate the word right");
    east.addEventListener("click", function () { rotate(1); east.blur(); });
    row.appendChild(east);
    rowEls.forEach(function (r) { r.classList.remove("on"); });
    row.classList.add("on");
    boardEl.appendChild(row);
    rowEls.push(row);
    settleScroll(true);
    return row;
  }

  // The pending row is the player's word laid on the ring: tile (start+j)
  // shows the j-th typed letter, and the start tile wears the handle.
  function paintPending() {
    var row = activeRow();
    if (!row) return;
    for (var c = 0; c < COLS; c++) {
      var t = row.children[1 + c];
      var j = (((c - start) % COLS) + COLS) % COLS;
      t.textContent = typed[j] || "";
      t.classList.toggle("filled", !!typed[j]);
      t.classList.toggle("s0", c === start);
    }
  }

  // Spin the pending word one tile around the ring. Works empty (moves the
  // highlighted start) or full (the whole word swings with it).
  function rotate(dir) {
    if (done || revealing) return;
    start = (((start + dir) % COLS) + COLS) % COLS;
    paintPending();
  }

  // Once it's over, no row keeps its ring controls.
  function retireRows() {
    rowEls.forEach(function (r) { r.classList.remove("on"); });
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
      answer = saved.answer;
      quietRows = true;
      resetBoard();
      restore(saved);
      quietRows = false;
    } else {
      answer = answerFor(todayKey());
      aStart = startFor(todayKey());
      resetBoard();
      saveState();
      showBanner(OPEN_BANNER);
    }
  }

  // Random word (and start), never saved — the daily game stays untouched.
  // Forced arguments ("crane", 3) are the debugging backdoor.
  function startPractice(force, forceStart) {
    practice = true;
    answer = validAnswer(force)
      ? force
      : ANSWERS[Math.floor(Math.random() * ANSWERS.length)];
    aStart = isStart(forceStart)
      ? forceStart
      : Math.floor(Math.random() * COLS);
    resetBoard();
    newBtn.textContent = "Today\u2019s puzzle";
    showBanner("Practice round");
  }

  // Replay saved guesses onto the fresh board with no animation. Marks are
  // recomputed — they only ever depended on the two starts.
  function restore(saved) {
    aStart = saved.start;
    guesses = [];
    saved.guesses.forEach(function (g) {
      var row = rowEls[guesses.length] || addRow();
      var marks = evaluate(display(g.w, g.s), display(answer, aStart));
      for (var c = 0; c < COLS; c++) {
        var t = row.children[1 + c];
        var letter = g.w.charAt((((c - g.s) % COLS) + COLS) % COLS);
        t.textContent = letter;
        t.classList.add("filled", marks[c]);
        if (c === g.s) t.classList.add("s0");
        paintKey(letter, marks[c]);
      }
      guesses.push({ w: g.w, s: g.s });
    });

    if (saved.done) {
      done = true;
      won = !!saved.won;
      gaveUp = !!saved.gaveUp;
      if (won) markWin(rowEls[guesses.length - 1]);
      showBanner(endBanner());
      shareBtn.classList.remove("hidden");
    } else {
      if (!activeRow()) addRow(); // the waiting row
      showBanner(OPEN_BANNER);
      paintPending();
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
    if (key === "ArrowLeft") { rotate(-1); return; }
    if (key === "ArrowRight") { rotate(1); return; }
    if (/^[a-z]$/.test(key)) typeLetter(key);
  }

  function typeLetter(ch) {
    if (typed.length >= COLS) return;
    typed.push(ch);
    paintPending();
  }

  function erase() {
    typed.pop();
    paintPending();
  }

  // ---------- submitting a guess ----------

  // Standard Wordle evaluation: exact matches first, then stray letters.
  // It runs on the DISPLAYED sequences — the rings as they sit on the board.
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
    var word = typed.join("");
    if (word.length < COLS) { reject("Not enough letters"); return; }
    if (!DICTIONARY.has(word)) { reject("Not in word list"); return; }

    revealing = true;
    var rowIdx = guesses.length;
    var myStart = start;
    var marks = evaluate(display(word, myStart), display(answer, aStart));
    // A rejected attempt leaves `shake` behind; equal specificity, defined
    // after .reveal, it would override the flip — clear it first.
    tilesOf(rowEls[rowIdx]).forEach(function (t) {
      t.classList.remove("shake");
    });
    marks.forEach(function (mark, c) {
      var t = rowEls[rowIdx].children[1 + c];
      setTimeout(function () { t.classList.add("reveal"); },
        100 + c * FLIP_STAGGER);
      setTimeout(function () {
        t.classList.remove("filled");
        t.classList.add(mark);
      }, 100 + c * FLIP_STAGGER + FLIP_MID);
    });
    setTimeout(function () { finish(rowIdx, word, myStart, marks); },
      100 + (COLS - 1) * FLIP_STAGGER + FLIP_MID + 150);
  }

  function tilesOf(row) {
    return Array.prototype.slice.call(row.children, 1, 1 + COLS);
  }

  function finish(rowIdx, word, myStart, marks) {
    typed = [];
    start = 0;
    guesses.push({ w: word, s: myStart });

    var allGreen = true;
    for (var c = 0; c < COLS; c++) {
      // The letter of the word shown at tile c earns that tile's mark.
      var letter = word.charAt((((c - myStart) % COLS) + COLS) % COLS);
      paintKey(letter, marks[c]);
      if (marks[c] !== "correct") allGreen = false;
    }

    if (allGreen) {
      done = true;
      won = true;
      retireRows();
      markWin(rowEls[rowIdx]);
      showBanner(endBanner());
      shareBtn.classList.remove("hidden");
    } else {
      if (word === answer) toast("Right word \u2014 rotate it into place");
      if (guesses.length >= ROWS) {
        done = true; // the seventh miss closes the ring for good
        retireRows();
        showBanner(endBanner());
        shareBtn.classList.remove("hidden");
      } else {
        addRow();
        paintPending();
      }
    }
    updateActions();
    saveState();
    revealing = false;
  }

  function markWin(row) {
    if (!row) return;
    tilesOf(row).forEach(function (t) { t.classList.add("win-glow"); });
  }

  function endBanner() {
    if (!won) return "The word was " + answer.toUpperCase();
    var n = guesses.length;
    var head = n <= PRAISE.length ? PRAISE[n - 1] : "Got there";
    return head + " \u2014 " + n + (n === 1 ? " guess" : " guesses");
  }

  // Give up is the other loss: end the hunt, reveal the word, freeze.
  function giveUp() {
    if (done || revealing) return;
    done = true;
    gaveUp = true;
    typed = [];
    var row = activeRow();
    if (row) {
      tilesOf(row).forEach(function (t) {
        t.textContent = "";
        t.classList.remove("filled", "s0");
      });
    }
    retireRows();
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
    tilesOf(activeRow()).forEach(function (tile) {
      tile.classList.remove("shake");
      void tile.offsetWidth; // restart the animation
      tile.classList.add("shake");
      // Drop the class once played, or it overrides the later flip.
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

  // Standard emoji squares of the displayed marks.
  function share() {
    var emptyCell = document.documentElement.dataset.theme === "dark"
      ? "\u2B1B" : "\u2B1C";
    var EMOJI = { correct: "\uD83D\uDFE9", present: "\uD83D\uDFE8",
      absent: emptyCell };
    var n = guesses.length;
    var count = gaveUp
      ? "gave up \u00B7 X/7"
      : (won ? n : "X") + "/7";
    var title = ["Encircle", practice ? "practice" : todayKey(), count]
      .join(" \u00B7 ");
    var lines = [title, GAME_URL];
    guesses.forEach(function (g) {
      lines.push(evaluate(display(g.w, g.s), display(answer, aStart))
        .map(function (m) { return EMOJI[m]; }).join(""));
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
    else if (e.key === "Enter" || e.key === "Backspace" ||
             e.key === "ArrowLeft" || e.key === "ArrowRight") {
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
  window.ENCIRCLE = {
    daily: init,
    practice: startPractice,
    todayKey: todayKey,
    answerFor: answerFor,
    startFor: startFor,
    evaluate: evaluate,
    display: display,
    dump: function () {
      return {
        answer: answer,
        answerStart: aStart,
        pendingStart: start,
        typed: typed.join(""),
        guesses: guesses.map(function (g) { return { w: g.w, s: g.s }; }),
        practice: practice,
        done: done,
        won: won,
        gaveUp: gaveUp,
        save: loadSaved()
      };
    }
  };
})();
