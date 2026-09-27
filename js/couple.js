// Couple — Day 14 variant of 30 Wordles.
// One puzzle per day: the answer derives from the calendar date and
// progress is saved to localStorage, so a refresh resumes the same game.
// Practice mode plays a random word without touching the daily save.
//
// A normal Wordle whose guesses are COUPLED: the last letter of each
// guess is locked in as the first letter of the next one — Bundle's
// carry, but the lock moves (end of one row, start of the next) instead
// of Bundle's fixed column. The carried letter is chosen for you and
// scores like any other; you build each word around it. The accent line
// on the board draws the couple: out of one guess's last tile, around
// the edge, into the next guess's first tile. Six guesses; the sixth
// miss or give up is the loss.
//
// The carry is fully derived (guess r+1 starts with guess r's last
// letter), so the save stores plain strings and restore rebuilds both
// the rows and the couplers; a save whose chain is broken is corrupt.
(function () {
  "use strict";

  var COLS = 5;
  var ROWS = 6;
  var SALT = "couple"; // daily hash salt — each variant salts its own way
  var FLIP_STAGGER = 280; // ms between tile flips
  var FLIP_MID = 270;     // half-turn point: the score color appears here
  var STORE_KEY = "couple-day14";
  var GAME_URL = "https://suitangi.github.io/30Wordles/days/14";
  var PRAISE = ["Genius", "Magnificent", "Impressive", "Splendid", "Great",
    "Phew"];
  var OPEN_BANNER = "Every guess ends where the next begins";

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
  var guesses = [];      // plain strings; the carry chain must hold
  var typed = [];        // the active row's letters (index 0 may be locked)
  var rowEls = [];       // rowEls[r] — .lrow of five tiles
  var keyEls = {};       // letter -> key button
  var toastTimer = null;

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

  // The chain IS the game: every guess after the first must start with
  // the previous guess's last letter.
  function chains(a, b) {
    return a.charAt(COLS - 1) === b.charAt(0);
  }

  function validSave(saved) {
    if (!saved || saved.date !== todayKey() || !validAnswer(saved.answer)) {
      return false;
    }
    if (!Array.isArray(saved.guesses) || saved.guesses.length > ROWS) {
      return false;
    }
    return saved.guesses.every(validAnswer) &&
      saved.guesses.every(function (w, r) {
        return r === 0 || chains(saved.guesses[r - 1], w);
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

  // Rows are built on demand — six at most. Row 0 types freely; every
  // later row opens with the locked-in carry, and the coupler line grows
  // one segment each time a row gains a neighbour.
  function addRow() {
    var row = document.createElement("div");
    row.className = quietRows ? "lrow quiet" : "lrow";
    for (var c = 0; c < COLS; c++) {
      var tile = document.createElement("div");
      tile.className = "tile";
      row.appendChild(tile);
    }
    var r = rowEls.length; // NOT guesses.length — during restore the
    // guesses are already loaded while the rows are still being built
    if (r > 0) {
      var carry = guesses[r - 1].charAt(COLS - 1);
      typed[0] = carry;
      row.children[0].textContent = carry;
      row.children[0].classList.add("filled", "carried");
      row.classList.add("has-prev");
      rowEls[r - 1].classList.add("has-next");
    }
    rowEls.forEach(function (other) { other.classList.remove("on"); });
    row.classList.add("on");
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

  // Replay saved guesses onto the fresh board with no animation. Marks
  // are pure recompute; the couplers and the waiting row's carry rebuild
  // from the chain.
  function restore(saved) {
    guesses = saved.guesses.slice();
    guesses.forEach(function (word, r) {
      var row = rowEls[r] || addRow();
      var marks = evaluate(word, answer);
      marks.forEach(function (mark, c) {
        var t = row.children[c];
        t.textContent = word.charAt(c);
        t.classList.add("filled", mark);
      });
      row.children[0].classList.remove("carried"); // scored tiles show marks, not the tint
    });
    if (saved.done) {
      done = true;
      won = !!saved.won;
      gaveUp = !!saved.gaveUp;
      if (won) markWin(rowEls[guesses.length - 1]);
      showBanner(endBanner());
      shareBtn.classList.remove("hidden");
    } else {
      if (!activeRow()) addRow(); // the waiting row, carry pre-filled
      showBanner(OPEN_BANNER);
    }
    repaintKeys();
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

  // The carry at index 0 is the couple's word — it never erases.
  function erase() {
    var row = activeRow();
    var lockedFirst = guesses.length > 0;
    for (var c = COLS - 1; c >= 0; c--) {
      if (typed[c] && !(c === 0 && lockedFirst)) {
        typed[c] = "";
        row.children[c].textContent = "";
        row.children[c].classList.remove("filled");
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
    var word = typed.join("");
    if (word.length < COLS) { reject("Not enough letters"); return; }
    if (!DICTIONARY.has(word)) { reject("Not in word list"); return; }

    revealing = true;
    var rowIdx = guesses.length;
    // A rejected attempt leaves `shake` behind; equal specificity, defined
    // after .reveal, it would override the flip — clear it first.
    Array.prototype.forEach.call(rowEls[rowIdx].children, function (t) {
      t.classList.remove("shake");
    });
    var marks = evaluate(word, answer);
    marks.forEach(function (mark, c) {
      var t = rowEls[rowIdx].children[c];
      setTimeout(function () { t.classList.add("reveal"); },
        100 + c * FLIP_STAGGER);
      setTimeout(function () {
        t.classList.remove("filled", "carried");
        t.classList.add(mark);
      }, 100 + c * FLIP_STAGGER + FLIP_MID);
    });
    setTimeout(function () { finish(rowIdx, word); },
      100 + (COLS - 1) * FLIP_STAGGER + FLIP_MID + 150);
  }

  function finish(rowIdx, word) {
    typed = Array(COLS).fill("");
    guesses.push(word);

    var isWin = evaluate(word, answer).every(function (m) {
      return m === "correct";
    });
    if (isWin) {
      done = true;
      won = true;
      markWin(rowEls[rowIdx]);
      showBanner(endBanner());
      shareBtn.classList.remove("hidden");
    } else if (guesses.length >= ROWS) {
      done = true; // the sixth miss is the loss
      showBanner(endBanner());
      shareBtn.classList.remove("hidden");
    } else {
      addRow(); // opens with this guess's last letter, locked in
    }
    repaintKeys();
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

  // Give up is the other loss: end the coupling, reveal the word, freeze.
  function giveUp() {
    if (done || revealing) return;
    done = true;
    gaveUp = true;
    typed = Array(COLS).fill("");
    var row = activeRow();
    if (row) {
      tilesOf(row).forEach(function (t) {
        t.textContent = "";
        t.classList.remove("filled", "carried");
      });
    }
    showBanner(endBanner());
    shareBtn.classList.remove("hidden");
    updateActions();
    saveState();
  }

  function updateActions() {
    giveUpBtn.classList.toggle("hidden", done);
    if (done) {
      // The coupling is over: the live-row hint retires, the couplers stay.
      rowEls.forEach(function (r) { r.classList.remove("on"); });
    }
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

  // Standard rank painting over every committed guess; resets first so
  // repaints never mix stale marks (the Swivel lesson).
  function repaintKeys() {
    Object.keys(keyEls).forEach(function (letter) {
      var key = keyEls[letter];
      Object.keys(RANK).forEach(function (m) { key.classList.remove(m); });
      key.dataset.state = "";
    });
    guesses.forEach(function (word) {
      evaluate(word, answer).forEach(function (m, c) {
        paintKey(word.charAt(c), m);
      });
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

  // Standard emoji squares.
  function share() {
    var emptyCell = document.documentElement.dataset.theme === "dark"
      ? "\u2B1B" : "\u2B1C";
    var EMOJI = { correct: "\uD83D\uDFE9", present: "\uD83D\uDFE8",
      absent: emptyCell };
    var n = guesses.length;
    var count = gaveUp
      ? "gave up \u00B7 X/6"
      : (won ? n : "X") + "/6";
    var title = ["Couple", practice ? "practice" : todayKey(), count]
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
  window.COUPLE = {
    daily: init,
    practice: startPractice,
    todayKey: todayKey,
    answerFor: answerFor,
    evaluate: evaluate,
    chains: chains,
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
