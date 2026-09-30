// Fiddle — Day 17 variant of 30 Wordles.
// One puzzle per day: the answer derives from the calendar date and
// progress is saved to localStorage, so a refresh resumes the same game.
// Practice mode plays a random word without touching the daily save.
//
// A Wordle where the guesses are chained: the first guess is free, and
// every guess after it must keep at least 3 letters of the guess before
// it — so you fiddle from word to word instead of jumping. Shared
// letters count per copy (two e's in the last guess let you keep two
// e's), and order doesn't matter. The counter to the right of the row
// counts the letters still owed; it ticks down as they're typed and
// checks off when the fiddle is satisfied. Eight guesses, five greens
// to win, standard scoring throughout.

(function () {
  "use strict";

  var COLS = 5;
  var ROWS = 8; // guess limit — eight fiddles and it's over
  var NEEDED = 3; // letters each guess keeps of the one before
  var SALT = "fiddle"; // daily hash salt — each variant salts its own way
  var FLIP_STAGGER = 280; // ms between tile flips
  var FLIP_MID = 270;     // half-turn point: the score color appears here
  var STORE_KEY = "fiddle-day17";
  var GAME_URL = "https://suitangi.github.io/30Wordles/days/17";
  var PRAISE = ["Genius", "Magnificent", "Impressive", "Splendid", "Great",
    "Phew"];
  var OPEN_BANNER = "Every guess keeps 3 letters of the last";
  var CHECK = "\u2713";

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
  var guesses = [];      // plain words — the fiddle chain is the record
  var typed = [];        // the active row's letters
  var done = false;
  var won = false;
  var gaveUp = false;
  var revealing = false;
  var practice = false;
  var quietRows = false; // restore flag: rebuilt rows skip enter animations
  var rowEls = [];       // rowEls[r] — .fdrow of five tiles + counter
  var countEls = [];     // countEls[r] — that row's shared-letters counter
  var keyEls = {};       // letter -> key button
  var toastTimer = null;

  // ---------- the fiddle ----------

  // How many letters the two words share: order-free, counted per copy.
  // Each letter of `b` consumes one unused copy from `a` — a doubled
  // letter in the old guess lets you keep it twice.
  function sharedCount(a, b) {
    var copies = {};
    for (var i = 0; i < a.length; i++) {
      copies[a.charAt(i)] = (copies[a.charAt(i)] || 0) + 1;
    }
    var shared = 0;
    for (var j = 0; j < b.length; j++) {
      var ch = b.charAt(j);
      if (copies[ch] > 0) { copies[ch]--; shared++; }
    }
    return shared;
  }

  function prevWord() { return guesses[guesses.length - 1] || ""; }

  // Which of the typed letters count toward the fiddle: left to right,
  // each letter consumes one copy from the previous guess's remaining
  // pool — the same math sharedCount does, kept per position so the
  // tiles can show it.
  function sharedFlags(typedArr, prev) {
    var copies = {};
    for (var i = 0; i < prev.length; i++) {
      copies[prev.charAt(i)] = (copies[prev.charAt(i)] || 0) + 1;
    }
    var flags = [];
    for (var c = 0; c < COLS; c++) {
      var ch = typedArr[c];
      if (ch && copies[ch] > 0) { copies[ch]--; flags.push(true); }
      else flags.push(false);
    }
    return flags;
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
    if (!Array.isArray(saved.guesses) || saved.guesses.length > ROWS) {
      return false;
    }
    if (!saved.guesses.every(validAnswer)) return false;
    // the chain is the law: a saved guess that breaks the fiddle from its
    // predecessor means a corrupt save, not a clever player
    for (var r = 1; r < saved.guesses.length; r++) {
      if (sharedCount(saved.guesses[r - 1], saved.guesses[r]) < NEEDED) {
        return false;
      }
    }
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

  function resetBoard() {
    done = false;
    won = false;
    gaveUp = false;
    revealing = false;
    guesses = [];
    typed = Array(COLS).fill("");
    rowEls = [];
    countEls = [];

    boardEl.innerHTML = "";
    boardEl.classList.remove("overflowing");
    bannerEl.classList.remove("show");
    bannerEl.textContent = "";
    shareBtn.classList.add("hidden");
    updateActions();

    addRow();
    buildKeyboard();
  }

  // Rows are built on demand — eight is the ceiling, not the shape.
  // Each row carries its counter on the right: the shared letters still
  // owed to the previous guess, checking off as they're typed.
  function addRow() {
    var row = document.createElement("div");
    row.className = quietRows ? "fdrow quiet" : "fdrow";
    for (var c = 0; c < COLS; c++) {
      var tile = document.createElement("div");
      tile.className = "tile";
      row.appendChild(tile);
    }
    var count = document.createElement("div");
    count.className = "fcount";
    row.appendChild(count);
    boardEl.appendChild(row);
    rowEls.push(row);
    countEls.push(count);
    paintPending();
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

  // One repaint for the waiting row's live fiddle state: the counter
  // (letters still owed) and the tiles (which typed letters count).
  function paintPending() {
    updatePendingCount();
    paintPendingShared();
  }

  // The waiting row's counter: letters still owed to the last guess.
  // The first row owes nothing and stays blank.
  function updatePendingCount() {
    var el = countEls[guesses.length];
    if (!el) return;
    if (guesses.length === 0) {
      el.textContent = "";
      el.classList.remove("ok");
      return;
    }
    var have = sharedCount(typed.join(""), prevWord());
    if (have >= NEEDED) {
      el.textContent = CHECK;
      el.classList.add("ok");
    } else {
      el.textContent = String(NEEDED - have);
      el.classList.remove("ok");
    }
  }

  // A submitted row settles at the check — the fiddle was made.
  // (No pulse: restored boards are born quiet.)
  function paintCountDone(idx) {
    var el = countEls[idx];
    if (!el) return;
    el.textContent = CHECK;
    el.classList.add("ok");
  }

  // The waiting row's shared letters wear the steel outline, so the
  // fiddle is visible while you type — which letters count and how
  // many you still owe. Scored rows never wear it: the outline is a
  // pending-row voice only, and it would fight the mark colors.
  function paintPendingShared() {
    var row = activeRow();
    if (!row) return;
    var flags = guesses.length > 0
      ? sharedFlags(typed, prevWord())
      : [false, false, false, false, false];
    for (var c = 0; c < COLS; c++) {
      row.children[c].classList.toggle("shared", !!flags[c]);
    }
  }

  function pulse(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth; // restart the animation
    el.classList.add(cls);
  }

  // Today's puzzle: resume the saved game if there is one, else start fresh.
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

  // Replay saved guesses onto the fresh board with no animation. Marks
  // are pure evaluate, so rows repaint directly; every row settles at
  // the check because validSave already proved the chain legal.
  function restore(saved) {
    guesses = [];
    saved.guesses.forEach(function (w) {
      var row = rowEls[guesses.length] || addRow();
      var marks = evaluate(w, answer);
      for (var c = 0; c < COLS; c++) {
        var t = row.children[c];
        t.textContent = w.charAt(c);
        t.classList.add("filled", marks[c]);
        paintKey(w.charAt(c), marks[c]);
      }
      paintCountDone(guesses.length);
      guesses.push(w);
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
        paintPending();
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
        paintPending();
        return;
      }
    }
  }

  // ---------- submitting a guess ----------

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

  function submit() {
    var guess = typed.join("");
    if (guess.length < COLS) { reject("Not enough letters"); return; }
    if (!DICTIONARY.has(guess)) { reject("Not in word list"); return; }
    if (guesses.length > 0) {
      var shared = sharedCount(guess, prevWord());
      if (shared < NEEDED) {
        reject("Only " + shared + " from " + prevWord().toUpperCase() +
          " \u2014 need " + NEEDED);
        return;
      }
    }

    revealing = true;
    var rowIdx = guesses.length;
    var marks = evaluate(guess, answer);
    paintCountDone(rowIdx);
    pulse(countEls[rowIdx], "settle");
    // The outline is a typing voice — off before the marks land, or it
    // would out-rank them and keep the steel border on scored tiles.
    // A rejected attempt leaves `shake` behind; equal specificity,
    // defined after .reveal, it would override the flip — clear it first.
    for (var c = 0; c < COLS; c++) {
      rowEls[rowIdx].children[c].classList.remove("shared", "shake");
    }
    marks.forEach(function (mark, c) {
      var t = rowEls[rowIdx].children[c];
      setTimeout(function () { t.classList.add("reveal"); },
        100 + c * FLIP_STAGGER);
      setTimeout(function () {
        t.classList.remove("filled");
        t.classList.add(mark);
      }, 100 + c * FLIP_STAGGER + FLIP_MID);
    });
    setTimeout(function () { finish(rowIdx, guess, marks); },
      100 + (COLS - 1) * FLIP_STAGGER + FLIP_MID + 150);
  }

  function finish(rowIdx, guess, marks) {
    typed = Array(COLS).fill("");
    guesses.push(guess);

    var allGreen = true;
    for (var c = 0; c < COLS; c++) {
      paintKey(guess.charAt(c), marks[c]);
      if (marks[c] !== "correct") allGreen = false;
    }

    if (allGreen) {
      done = true;
      won = true;
      markWin(rowEls[rowIdx]);
      showBanner(endBanner());
      shareBtn.classList.remove("hidden");
    } else if (guesses.length === ROWS) {
      done = true; // eight fiddles, no greens — the loss
      showBanner(endBanner());
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
    for (var c = 0; c < COLS; c++) row.children[c].classList.add("win-glow");
  }

  function endBanner() {
    if (won) {
      var n = guesses.length;
      var head = n <= PRAISE.length ? PRAISE[n - 1] : "Got there";
      return head + " \u2014 " + n + (n === 1 ? " guess" : " guesses");
    }
    return "The word was " + answer.toUpperCase();
  }

  function giveUp() {
    if (done || revealing) return;
    var row = activeRow();
    for (var c = 0; c < COLS; c++) {
      typed[c] = "";
      if (row) {
        row.children[c].textContent = "";
        row.children[c].classList.remove("filled", "shared");
      }
    }
    if (row) {
      var count = countEls[guesses.length];
      count.textContent = "";
      count.classList.remove("ok");
    }
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
    for (var c = 0; c < COLS; c++) {
      var tile = rowEls[guesses.length].children[c];
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

  function share() {
    var emptyCell = document.documentElement.dataset.theme === "dark"
      ? "\u2B1B" : "\u2B1C";
    var EMOJI = { correct: "\uD83D\uDFE9", present: "\uD83D\uDFE8",
      absent: emptyCell };
    var n = guesses.length;
    var state = won ? n + "/" + ROWS
      : (gaveUp ? "gave up \u00B7 " + n + "/" + ROWS : "X/" + ROWS);
    var title = ["Fiddle", practice ? "practice" : todayKey(), state]
      .join(" \u00B7 ");
    var lines = [title, GAME_URL];
    guesses.forEach(function (w) {
      var marks = evaluate(w, answer);
      lines.push(marks.map(function (m) { return EMOJI[m]; }).join(""));
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
  window.FIDDLE = {
    daily: init,
    practice: startPractice,
    todayKey: todayKey,
    answerFor: answerFor,
    evaluate: evaluate,
    sharedWith: function (a, b) { return sharedCount(a, b); },
    sharedFlags: function (typedArr, prev) { return sharedFlags(typedArr, prev); },
    ROWS: ROWS,
    NEEDED: NEEDED,
    dump: function () {
      return {
        answer: answer,
        guesses: guesses.slice(),
        typed: typed.join(""),
        prev: prevWord(),
        shared: guesses.length > 0
          ? sharedCount(typed.join(""), prevWord())
          : null,
        practice: practice,
        done: done,
        won: won,
        gaveUp: gaveUp,
        save: loadSaved()
      };
    }
  };
})();
