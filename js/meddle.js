// Meddle — Day 5 variant of 30 Wordles.
// One puzzle per day: two answers derive from the calendar date and progress
// is saved to localStorage, so a refresh resumes the same game. Practice
// mode plays a random pair without touching the daily save.
//
// Two secret words hide behind one standard Wordle board. Each tile shows
// the better of its clues against the words still hiding — green if the
// letter sits in that spot in either word, then yellow, then gray. Guesses
// are unlimited; a word lands found when guessed exactly and drops out of
// the clues. The game ends when both are found, or on give up.
(function () {
  "use strict";

  var COLS = 5;
  var SALT = "meddle"; // daily hash salt — each variant salts its own way
  var FLIP_STAGGER = 280; // ms between tile flips
  var FLIP_MID = 270;     // half-turn point: the score color appears here
  var STORE_KEY = "meddle-day5";
  var GAME_URL = "https://suitangi.github.io/30Wordles/days/5";

  var ANSWERS = window.WORD_LISTS.answers;
  var DICTIONARY = new Set(window.WORD_LISTS.guesses);

  var boardEl = document.getElementById("board");
  var keyboardEl = document.getElementById("keyboard");
  var bannerEl = document.getElementById("banner");
  var toastEl = document.getElementById("toast");
  var newBtn = document.getElementById("new-btn");
  var giveUpBtn = document.getElementById("giveup-btn");
  var shareBtn = document.getElementById("share-btn");

  var words = ["", ""];   // the two secrets
  var found = [false, false];
  var done = false;
  var won = false;
  var gaveUp = false;
  var revealing = false;
  var practice = false;
  var quietRows = false; // restore flag: rebuilt rows skip enter animations
  var guesses = [];      // { w, m } — the word and the merged marks it showed
  var typed = [];        // the active row's letters
  var rowEls = [];       // rowEls[r] — .mrow of five tiles
  var keyEls = {};       // letter -> key button
  var toastTimer = null;

  // ---------- clues ----------

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

  var RANK = { absent: 1, present: 2, correct: 3 };

  // The merge the whole game hangs on: each tile shows the better of its
  // clues against the words still hiding. A found word has dropped out and
  // stops meddling — its columns answer only to the word that's left.
  function marksFor(guess) {
    var marks = null;
    for (var i = 0; i < 2; i++) {
      if (found[i]) continue;
      var m = evaluate(guess, words[i]);
      if (!marks) { marks = m; continue; }
      for (var c = 0; c < COLS; c++) {
        if (RANK[m[c]] > RANK[marks[c]]) marks[c] = m[c];
      }
    }
    return marks;
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

  // Two deterministic daily words: the second salts differently so the pair
  // is stable but independent; a collision steps one word down the list.
  function wordsFor(key) {
    var a = ANSWERS[hash(SALT + key) % ANSWERS.length];
    var b = ANSWERS[hash(SALT + "-b" + key) % ANSWERS.length];
    while (b === a) b = ANSWERS[(ANSWERS.indexOf(b) + 1) % ANSWERS.length];
    return [a, b];
  }

  function validWords(ws) {
    return Array.isArray(ws) && ws.length === 2 &&
      DICTIONARY.has(ws[0]) && DICTIONARY.has(ws[1]) && ws[0] !== ws[1];
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
        words: words,
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
    found = [false, false];
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

  // Rows are built on demand — the board grows for as long as it takes.
  function addRow() {
    var row = document.createElement("div");
    row.className = quietRows ? "mrow quiet" : "mrow";
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
    var key = todayKey();
    var saved = loadSaved();
    if (saved && saved.date === key && validWords(saved.words)) {
      words = saved.words.slice();
      quietRows = true;
      resetBoard();
      restore(saved);
      quietRows = false;
    } else {
      words = wordsFor(key);
      resetBoard();
      saveState();
    }
  }

  // Random pair, never saved — the daily game stays untouched. A forced pair
  // ("crane", "brane") is the debugging backdoor.
  function startPractice(forceA, forceB) {
    practice = true;
    words = validWords([forceA, forceB])
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

  // Replay saved guesses onto the fresh board with no animation. Marks are
  // stored per guess — the merged clues depend on what was still hidden at
  // the time — so rows paint exactly as they did live. Rows carry a
  // permanent `quiet` class: flipping a suppression class off again would
  // just restart the transitions it disabled.
  function restore(saved) {
    guesses = [];
    found = [false, false];
    saved.guesses.forEach(function (g) {
      var row = rowEls[guesses.length] || addRow();
      for (var c = 0; c < COLS; c++) {
        var t = row.children[c];
        t.textContent = g.w.charAt(c);
        t.classList.add(g.m[c]);
        paintKey(g.w.charAt(c), g.m[c]);
      }
      // A guess finds its word the first time it lands exactly on it; a
      // repeat of an already-found word is just an ordinary guess.
      for (var i = 0; i < 2; i++) {
        if (!found[i] && g.w === words[i]) { found[i] = true; break; }
      }
      guesses.push({ w: g.w, m: g.m.slice() });
    });

    if (saved.done) {
      done = true;
      won = !!saved.won;
      gaveUp = !!saved.gaveUp;
      showBanner(endBanner());
      shareBtn.classList.remove("hidden");
    } else if (!rowEls[guesses.length]) {
      addRow(); // the waiting row — resetBoard's first row may already be it
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

  function submit() {
    var guess = typed.join("");
    if (guess.length < COLS) { reject("Not enough letters"); return; }
    if (!DICTIONARY.has(guess)) { reject("Not in word list"); return; }

    revealing = true;
    var rowIdx = guesses.length;
    // The merged marks freeze at submit: they show what was still hiding.
    var marks = marksFor(guess);
    // A rejected attempt leaves `shake` behind; equal specificity, defined
    // after .reveal, it would override the flip — clear it first.
    Array.prototype.forEach.call(rowEls[rowIdx].children, function (t) {
      t.classList.remove("shake");
    });
    marks.forEach(function (mark, c) {
      var t = rowEls[rowIdx].children[c];
      // Flip first; the score color lands at the half-turn, like Wordle.
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
    for (var c = 0; c < COLS; c++) {
      paintKey(guess.charAt(c), marks[c]);
    }
    typed = Array(COLS).fill("");
    guesses.push({ w: guess, m: marks });

    var firstFind = false;
    for (var i = 0; i < 2; i++) {
      if (!found[i] && guess === words[i]) { found[i] = true; firstFind = true; break; }
    }

    if (found[0] && found[1]) {
      done = true;
      won = true;
      showBanner(endBanner());
      shareBtn.classList.remove("hidden");
    } else {
      if (firstFind) showBanner("One down \u2014 one to go");
      addRow();
    }
    updateActions();
    saveState();
    revealing = false;
  }

  function endBanner() {
    if (!won) {
      return "The words were " + words[0].toUpperCase() +
        " & " + words[1].toUpperCase();
    }
    var n = guesses.length;
    return "Both words \u2014 " + n + (n === 1 ? " guess" : " guesses");
  }

  // There's no guess cap, so giving up is the loss: end the board, reveal
  // both words, freeze it.
  function giveUp() {
    if (done || revealing) return;
    done = true;
    gaveUp = true;
    boardEl.removeChild(rowEls.pop()); // the waiting row goes too
    typed = Array(COLS).fill("");
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
    Array.prototype.forEach.call(activeRow().children, function (tile) {
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

  // Standard emoji squares, one row per guess, showing the merged marks the
  // player actually saw at the time.
  function share() {
    var emptyCell = document.documentElement.dataset.theme === "dark" ? "\u2B1B" : "\u2B1C";
    var EMOJI = { correct: "\uD83D\uDFE9", present: "\uD83D\uDFE8", absent: emptyCell };
    var n = guesses.length;
    var count = n + (n === 1 ? " guess" : " guesses");
    var foundCount = (found[0] ? 1 : 0) + (found[1] ? 1 : 0);
    var title = ["Meddle", practice ? "practice" : todayKey(),
      gaveUp ? "gave up \u00B7 " + foundCount + "/2 \u00B7 " + count : count]
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

  window.addEventListener("resize", function () { settleScroll(true); });

  newBtn.addEventListener("click", function () {
    newBtn.blur();
    if (practice) init(); else startPractice();
  });
  giveUpBtn.addEventListener("click", function () { giveUpBtn.blur(); giveUp(); });
  shareBtn.addEventListener("click", function () { shareBtn.blur(); share(); });

  init();

  // Small console/test surface.
  window.MEDDLE = {
    daily: init,
    practice: startPractice,
    todayKey: todayKey,
    wordsFor: wordsFor,
    evaluate: evaluate,
    marksFor: marksFor,
    dump: function () {
      return {
        words: words.slice(),
        found: found.slice(),
        practice: practice,
        done: done,
        won: won,
        gaveUp: gaveUp,
        guesses: guesses.map(function (g) { return { w: g.w, m: g.m.join("") }; }),
        save: loadSaved()
      };
    }
  };
})();
