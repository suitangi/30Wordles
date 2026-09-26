// Dawdle — Day 13 variant of 30 Wordles.
// One puzzle per day: the answer derives from the calendar date and
// progress is saved to localStorage, so a refresh resumes the same game.
// Practice mode plays a random word without touching the daily save.
//
// A normal Wordle whose clues can't keep time. Every guess lands ALL
// GRAY — the tiles say nothing on the turn you play them. A letter
// that's in the word wakes up yellow when your NEXT guess lands, and a
// letter in the right spot takes two: yellow one guess later, green the
// guess after that. The keyboard dawdles with the tiles. Seven guesses;
// the seventh miss or give up is the loss.
//
// What a tile shows is a pure function of (word, answer, age) where age
// is the number of guesses submitted after it, so the save stores plain
// strings (Stifle's shape) and restore recomputes every mark. On any end
// state the whole board resolves in one maturation wave — a clue with no
// future guesses would dawdle forever.
(function () {
  "use strict";

  var COLS = 5;
  var ROWS = 7;
  var SALT = "dawdle"; // daily hash salt — each variant salts its own way
  var FLIP_STAGGER = 280; // ms between tile flips
  var FLIP_MID = 270;     // half-turn point: the score color appears here
  var AGE_START = 700;      // the catch-up wave starts as the new row settles
  var AGE_ROW_STEP = 700;   // older clues wake first
  var AGE_TILE_STAGGER = 180;
  var MATURE_START = 1900;  // end-state wave: the whole board resolves
  var MATURE_ROW_STEP = 330;
  var MATURE_TILE_STAGGER = 150;
  var STORE_KEY = "dawdle-day13";
  var GAME_URL = "https://suitangi.github.io/30Wordles/days/13";
  var PRAISE = ["Genius", "Magnificent", "Impressive", "Splendid", "Great",
    "Phew"];
  var OPEN_BANNER = "Clues run late \u2014 every guess lands gray";
  var MARKS = ["correct", "present", "absent"];

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
  var done = false;
  var won = false;
  var gaveUp = false;
  var revealing = false;
  var practice = false;
  var quietRows = false; // restore flag: rebuilt rows skip enter animations
  var guesses = [];      // plain strings — marks recompute from ages
  var typed = [];        // the active row's letters
  var rowEls = [];       // rowEls[r] — .dwrow of five tiles
  var keyEls = {};       // letter -> key button
  var toastTimer = null;

  // ---------- the dawdle ----------

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

  // What a guess's tiles SHOW once `age` later guesses have landed:
  // grays are instant, strays wake up yellow a guess late, and a green
  // spends a guess looking yellow before it settles.
  function mature(word, target, age) {
    return evaluate(word, target).map(function (m) {
      if (m === "present") return age >= 1 ? "present" : "absent";
      if (m === "correct") {
        return age >= 2 ? "correct" : age >= 1 ? "present" : "absent";
      }
      return "absent";
    });
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

  function validSave(saved) {
    if (!saved || saved.date !== todayKey() || !validAnswer(saved.answer)) {
      return false;
    }
    return Array.isArray(saved.guesses) && saved.guesses.length <= ROWS &&
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

  // ---------- board ----------

  function activeRow() { return rowEls[guesses.length]; }

  function tilesOf(row) {
    return Array.prototype.slice.call(row.children, 0, COLS);
  }

  function resetBoard() {
    done = false;
    won = false;
    gaveUp = false;
    revealing = false;
    guesses = [];
    typed = Array(COLS).fill("");
    rowEls = [];

    boardEl.innerHTML = "";
    boardEl.classList.remove("overflowing");
    bannerEl.classList.remove("show");
    bannerEl.textContent = "";
    shareBtn.classList.add("hidden");
    updateActions();

    addRow();
    buildKeyboard();
  }

  // Rows are built on demand — seven at most.
  function addRow() {
    var row = document.createElement("div");
    row.className = quietRows ? "dwrow quiet" : "dwrow";
    for (var c = 0; c < COLS; c++) {
      var tile = document.createElement("div");
      tile.className = "tile";
      row.appendChild(tile);
    }
    boardEl.appendChild(row);
    rowEls.push(row);
    settleScroll(true);
    return row;
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
      resetBoard();
      saveState();
      showBanner(OPEN_BANNER);
    }
  }

  // Random word, never saved — the daily game stays untouched. A forced
  // word ("crane") is the debugging backdoor.
  function startPractice(force) {
    practice = true;
    answer = validAnswer(force)
      ? force
      : ANSWERS[Math.floor(Math.random() * ANSWERS.length)];
    resetBoard();
    newBtn.textContent = "Today\u2019s puzzle";
    showBanner("Practice round");
  }

  // Replay saved guesses onto the fresh board with no animation. A done
  // board shows the whole truth; a live one shows the clues exactly as
  // matured as of now.
  function restore(saved) {
    guesses = saved.guesses.slice();
    guesses.forEach(function (word, r) {
      var row = rowEls[r] || addRow();
      var age = saved.done ? ROWS : guesses.length - 1 - r;
      var shown = saved.done
        ? evaluate(word, answer)
        : mature(word, answer, age);
      shown.forEach(function (mark, c) {
        var t = row.children[c];
        t.textContent = word.charAt(c);
        t.classList.add("filled", mark);
      });
    });

    if (saved.done) {
      done = true;
      won = !!saved.won;
      gaveUp = !!saved.gaveUp;
      if (won) markWin(rowEls[guesses.length - 1]);
      repaintKeys(true);
      showBanner(endBanner());
      shareBtn.classList.remove("hidden");
    } else {
      if (!activeRow()) addRow(); // the waiting row
      repaintKeys(false);
      showBanner(OPEN_BANNER);
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
    if (/^[a-z]$/.test(key)) typeLetter(key);
  }

  function typeLetter(ch) {
    var row = activeRow();
    for (var c = 0; c < COLS; c++) {
      if (!typed[c]) {
        typed[c] = ch;
        row.children[c].textContent = ch;
        row.children[c].classList.add("filled");
        return;
      }
    }
  }

  function erase() {
    var row = activeRow();
    for (var c = COLS - 1; c >= 0; c--) {
      if (typed[c]) {
        typed[c] = "";
        row.children[c].textContent = "";
        row.children[c].classList.remove("filled");
        return;
      }
    }
  }

  // ---------- submitting a guess ----------

  // One tile re-flips and lands on `mark` at mid-turn (used for aging and
  // the end-state resolution — the flip language of the base game).
  function reflip(row, c, mark, at) {
    var t = row.children[c];
    setTimeout(function () {
      t.classList.remove("reveal");
      void t.offsetWidth; // restart the animation
      t.classList.add("reveal");
    }, at);
    setTimeout(function () {
      MARKS.forEach(function (m) {
        if (m !== mark) t.classList.remove(m);
      });
      t.classList.add(mark);
    }, at + FLIP_MID);
  }

  function submit() {
    var word = typed.join("");
    if (word.length < COLS) { reject("Not enough letters"); return; }
    if (!DICTIONARY.has(word)) { reject("Not in word list"); return; }

    revealing = true;
    var rowIdx = guesses.length;
    // The new row shows its age-0 self: every tile lands gray, whatever
    // the truth is. A rejected attempt leaves `shake` behind; equal
    // specificity, defined after .reveal, it would override the flip —
    // clear it first.
    Array.prototype.forEach.call(rowEls[rowIdx].children, function (t) {
      t.classList.remove("shake");
    });
    mature(word, answer, 0).forEach(function (mark, c) {
      var t = rowEls[rowIdx].children[c];
      setTimeout(function () { t.classList.add("reveal"); },
        100 + c * FLIP_STAGGER);
      setTimeout(function () {
        t.classList.remove("filled");
        t.classList.add(mark);
      }, 100 + c * FLIP_STAGGER + FLIP_MID);
    });
    setTimeout(function () { finish(rowIdx, word); },
      100 + (COLS - 1) * FLIP_STAGGER + FLIP_MID + 150);
  }

  function finish(rowIdx, word) {
    typed = Array(COLS).fill("");
    guesses.push(word);

    var trueMarks = evaluate(word, answer);
    var isWin = trueMarks.every(function (m) { return m === "correct"; });

    if (isWin || guesses.length >= ROWS) {
      // Any end state resolves every clue — a dawdled guess with no
      // later guess would never wake up. The banner and keyboard tell
      // the truth immediately; the board catches up in one wave.
      done = true;
      won = isWin;
      repaintKeys(true);
      if (isWin) markWin(rowEls[rowIdx]);
      showBanner(endBanner());
      shareBtn.classList.remove("hidden");
      matureAll();
    } else {
      repaintKeys(false);
      // The catch-up wave: as this guess lands, the row one back wakes
      // its yellows and the row two back settles its greens. Oldest
      // first, so the wave rolls down the board.
      var slots = Math.min(rowIdx, 2);
      for (var j = 0; j < slots; j++) {
        var r = rowIdx - slots + j; // oldest first: greens settle, then yellows wake
        var age = rowIdx - r;
        var shown = mature(guesses[r], answer, age);
        shown.forEach(function (mark, c) {
          reflip(rowEls[r], c, mark,
            AGE_START + j * AGE_ROW_STEP + c * AGE_TILE_STAGGER);
        });
        setTimeout(function () { repaintKeys(false); },
          AGE_START + j * AGE_ROW_STEP + (COLS - 1) * AGE_TILE_STAGGER +
          FLIP_MID + 120);
      }
      addRow();
      var cascadeEnd = slots
        ? AGE_START + (slots - 1) * AGE_ROW_STEP +
          (COLS - 1) * AGE_TILE_STAGGER + FLIP_MID + 120
        : 0;
      setTimeout(function () { revealing = false; },
        Math.max(100 + (COLS - 1) * FLIP_STAGGER + FLIP_MID + 150,
          cascadeEnd));
    }
    updateActions();
    saveState();
    if (done) revealing = false;
  }

  // The end-state wave: every row re-flips to the whole truth, oldest
  // first — the board catching up with itself all at once.
  function matureAll() {
    guesses.forEach(function (word, r) {
      evaluate(word, answer).forEach(function (mark, c) {
        reflip(rowEls[r], c, mark,
          MATURE_START + r * MATURE_ROW_STEP + c * MATURE_TILE_STAGGER);
      });
    });
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

  // Give up is the other loss: end the wait, reveal the word, resolve
  // every clue the board was sitting on.
  function giveUp() {
    if (done || revealing) return;
    done = true;
    gaveUp = true;
    typed = Array(COLS).fill("");
    var row = activeRow();
    if (row) {
      tilesOf(row).forEach(function (t) {
        t.textContent = "";
        t.classList.remove("filled");
      });
    }
    repaintKeys(true);
    showBanner(endBanner());
    shareBtn.classList.remove("hidden");
    matureAll();
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

  // The keyboard dawdles with the tiles: `aged` paints what the board
  // currently shows, `true` is the end-state reveal.
  function repaintKeys(truth) {
    Object.keys(keyEls).forEach(function (letter) {
      var key = keyEls[letter];
      MARKS.forEach(function (m) { key.classList.remove(m); });
      key.dataset.state = "";
    });
    guesses.forEach(function (word, r) {
      var marks = truth
        ? evaluate(word, answer)
        : mature(word, answer, guesses.length - 1 - r);
      marks.forEach(function (m, c) { paintKey(word.charAt(c), m); });
    });
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

  // Standard emoji squares of the whole truth (share only exists at an
  // end state, where every clue has resolved).
  function share() {
    var emptyCell = document.documentElement.dataset.theme === "dark"
      ? "\u2B1B" : "\u2B1C";
    var EMOJI = { correct: "\uD83D\uDFE9", present: "\uD83D\uDFE8",
      absent: emptyCell };
    var n = guesses.length;
    var count = gaveUp
      ? "gave up \u00B7 X/7"
      : (won ? n : "X") + "/7";
    var title = ["Dawdle", practice ? "practice" : todayKey(), count]
      .join(" \u00B7 ");
    var lines = [title, GAME_URL];
    guesses.forEach(function (word) {
      lines.push(evaluate(word, answer)
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
  window.DAWDLE = {
    daily: init,
    practice: startPractice,
    todayKey: todayKey,
    answerFor: answerFor,
    evaluate: evaluate,
    mature: mature,
    dump: function () {
      return {
        answer: answer,
        guesses: guesses.slice(),
        practice: practice,
        done: done,
        won: won,
        gaveUp: gaveUp,
        save: loadSaved()
      };
    }
  };
})();
