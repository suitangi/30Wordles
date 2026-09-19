// Subtle — Day 2 variant of 30 Wordles.
// One puzzle per day: the answer derives from the calendar date and progress
// is saved to localStorage, so a refresh resumes the same game. Practice
// mode plays random words without touching the daily save.
//
// No colors here. Each guess is scored 0-100 for how close it sits to the
// answer — a blend of letters held in the right position and edit distance —
// and guesses are unlimited: the board simply grows until the word is found.
(function () {
  "use strict";

  var COLS = 5;
  var SALT = "subtle"; // daily hash salt — each variant salts its own way
  var PRAISE = ["Genius", "Magnificent", "Impressive", "Splendid", "Great", "Phew"];
  var SETTLE_AT = 260; // ms after submit: the score fades into its chip
  var STORE_KEY = "subtle-day2";
  var GAME_URL = "https://suitangi.github.io/30Wordles/days/2";

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
  var guesses = []; // submitted words, in order
  var typed = [];   // the active row's letters
  var rowEls = [];  // rowEls[r] — .srow: five tiles + a score chip
  var keyEls = {};      // letter -> key button
  var letterStats = {}; // letter -> { sum, count } of scores it has earned
  var toastTimer = null;

  // ---------- scoring ----------

  // 0-100: 20 per letter in the exact spot, 10 per right letter gone astray.
  // (Astray = the overlap of the non-green letters, counted order-free so
  // the score stays symmetric.) Steps of 10, quiet and legible; only the
  // answer itself reaches 100 — a one-letter miss tops out at 80.
  function scoreFor(guess, target) {
    if (guess === target) return 100;
    var right = 0;
    var astray = 0;
    var guessLeft = {};
    var targetLeft = {};
    for (var i = 0; i < COLS; i++) {
      var g = guess.charAt(i);
      var t = target.charAt(i);
      if (g === t) {
        right++;
      } else {
        guessLeft[g] = (guessLeft[g] || 0) + 1;
        targetLeft[t] = (targetLeft[t] || 0) + 1;
      }
    }
    for (var ch in guessLeft) {
      if (targetLeft[ch]) astray += Math.min(guessLeft[ch], targetLeft[ch]);
    }
    return 20 * right + 10 * astray;
  }

  // ---------- daily puzzle ----------

  function todayKey() {
    var d = new Date();
    return d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
  }

  // Deterministic daily answer: same word for everyone, changes at midnight.
  function answerFor(key) {
    var h = 0;
    var s = SALT + key;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return ANSWERS[h % ANSWERS.length];
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
        won: won
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
    letterStats = {};

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
    row.className = quietRows ? "srow active quiet" : "srow active";
    for (var c = 0; c < COLS; c++) {
      var tile = document.createElement("div");
      tile.className = "tile";
      row.appendChild(tile);
    }
    var chip = document.createElement("div");
    chip.className = "score";
    chip.textContent = "\u00B7"; // quiet placeholder until the score lands
    row.appendChild(chip);

    boardEl.appendChild(row);
    rowEls.push(row);
    settleScroll(true);
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
    if (saved && saved.date === key && saved.answer && DICTIONARY.has(saved.answer)) {
      answer = saved.answer;
      quietRows = true;
      resetBoard();
      restore(saved);
      quietRows = false;
    } else {
      answer = answerFor(key);
      resetBoard();
      saveState();
    }
  }

  // Random word, never saved — the daily game stays untouched.
  function startPractice() {
    practice = true;
    answer = ANSWERS[Math.floor(Math.random() * ANSWERS.length)];
    resetBoard();
    newBtn.textContent = "Today\u2019s puzzle";
    showBanner("Practice round");
  }

  // Replay saved guesses onto the fresh board with no animation. Rows carry
  // a permanent `quiet` class — flipping a suppression class off again would
  // just restart the transitions it disabled.
  function restore(saved) {
    guesses = [];
    saved.guesses.forEach(function (guess) {
      var row = rowEls[guesses.length]; // the waiting empty row
      for (var c = 0; c < COLS; c++) {
        var t = row.children[c];
        t.textContent = guess.charAt(c);
        t.classList.add("filled");
      }
      settle(row, guess, scoreFor(guess, answer), true);
    });
    if (saved.done && !saved.won) { // a given-up game resumes ended
      boardEl.removeChild(rowEls.pop());
      done = true;
      gaveUp = true;
      showBanner("The word was " + answer.toUpperCase());
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
    paintKeys();
  }

  // ---------- keyboard tint ----------
  // Each key tints by its letter's share of all the score earned so far:
  // sum of the scores it appeared in, over 100 × guesses played. A single
  // lucky appearance can't pin a letter at full — tints re-normalize as the
  // game grows. Unused keys stay plain; any use tints 30% at once so used
  // reads instantly against unused.

  function paintKeys() {
    var total = 100 * Math.max(1, guesses.length);
    for (var L in keyEls) {
      var st = letterStats[L];
      var m = st && st.count ? usedMix(st.sum / total) : 0;
      keyEls[L].style.setProperty("--m", m.toFixed(4));
    }
  }

  function usedMix(share) {
    return 0.3 + 0.7 * share;
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
    var row = activeRow();
    var score = scoreFor(guess, answer);
    // A rejected attempt leaves `shake` behind; equal specificity, defined
    // after .settle, it would swallow the settle animation — clear it first.
    Array.prototype.forEach.call(row.children, function (el) {
      el.classList.remove("shake");
    });
    setTimeout(function () { settle(row, guess, score); }, SETTLE_AT);
  }

  // The score settles in: the number deepens toward full color, the row
  // recedes, the next row waits.
  function settle(row, guess, score, silent) {
    var chip = row.children[COLS];
    chip.textContent = String(score);
    chip.style.setProperty("--w", String(score / 100));
    if (!silent) chip.classList.add("settle");
    row.classList.remove("active");
    row.classList.add("scored");
    if (score === 100) row.classList.add("win");
    Array.prototype.forEach.call(row.children, function (el) {
      el.classList.remove("filled");
    });
    typed = Array(COLS).fill("");
    guesses.push(guess);

    // Each distinct letter of the guess earns this guess's score once.
    var seen = {};
    for (var c = 0; c < COLS; c++) {
      var ch = guess.charAt(c);
      if (!seen[ch]) {
        seen[ch] = true;
        var st = letterStats[ch] || (letterStats[ch] = { sum: 0, count: 0 });
        st.sum += score;
        st.count++;
      }
    }

    if (score === 100) {
      done = true;
      won = true;
      showBanner(praise(guesses.length));
      shareBtn.classList.remove("hidden");
      settleScroll(true);
    } else {
      addRow();
    }
    paintKeys();
    updateActions();
    saveState();
    revealing = false;
  }

  function praise(count) {
    return count > PRAISE.length ? "Got there" : PRAISE[count - 1];
  }

  // There's no losing in Subtle, so giving up is the loss: end the board,
  // reveal the answer, freeze it.
  function giveUp() {
    if (done || revealing) return;
    done = true;
    gaveUp = true;
    boardEl.removeChild(rowEls.pop()); // the waiting row goes too
    typed = Array(COLS).fill("");
    showBanner("The word was " + answer.toUpperCase());
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
    Array.prototype.forEach.call(activeRow().children, function (tile) {
      tile.classList.remove("shake");
      void tile.offsetWidth; // restart the animation
      tile.classList.add("shake");
      // Drop the class once played, or it overrides the later settle animation.
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

  // No emoji squares — each guess shares as a quiet little bar out of 100.
  function share() {
    var n = guesses.length;
    var count = n + (n === 1 ? " guess" : " guesses");
    var title = ["Subtle", practice ? "practice" : todayKey(),
      gaveUp ? "gave up \u00B7 " + count : count].join(" \u00B7 ");
    var lines = [title, GAME_URL];
    guesses.forEach(function (guess) {
      var filled = Math.round(scoreFor(guess, answer) / 10);
      lines.push("\u2588".repeat(filled) + "\u2591".repeat(10 - filled) +
        " " + scoreFor(guess, answer));
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
  giveUpBtn.addEventListener("click", giveUp);
  shareBtn.addEventListener("click", function () { shareBtn.blur(); share(); });

  init();

  // Small console/test surface.
  window.SUBTLE = {
    daily: init,
    practice: startPractice,
    todayKey: todayKey,
    answerFor: answerFor,
    scoreFor: scoreFor
  };
})();
