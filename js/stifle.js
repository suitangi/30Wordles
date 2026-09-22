// Stifle — Day 9 variant of 30 Wordles.
// One puzzle per day: the answer derives from the calendar date and
// progress is saved to localStorage, so a refresh resumes the same game.
// Practice mode plays a random word without touching the daily save.
//
// A normal Wordle with one stricture: every letter you submit is STIFLED
// for the next guess. The key fades to a bare outline, refuses to type,
// and comes back the guess after — so consecutive guesses can never share
// a letter, and burning the answer's letters costs you a turn of thinking
// around them. Six guesses; give up is the loss.
//
// Only the MOST RECENT guess stifles: submitting a new guess lifts the old
// cooldown as it lands its own. Cooldown is display + input only — scoring
// is standard two-pass Wordle, and the keyboard's earned marks survive the
// outline (they show again the moment the letter returns).
(function () {
  "use strict";

  var ROWS = 6;
  var COLS = 5;
  var SALT = "stifle"; // daily hash salt — each variant salts its own way
  var STORE_KEY = "stifle-day9";
  var GAME_URL = "https://suitangi.github.io/30Wordles/days/9";
  var PRAISE = ["Genius", "Magnificent", "Impressive", "Splendid", "Great",
    "Phew"];
  var FLIP_STAGGER = 280; // ms between tile flips
  var FLIP_MID = 270;     // half-turn point: the score color appears here

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
  var row = 0;          // active row
  var done = false;
  var won = false;
  var gaveUp = false;
  var revealing = false;
  var practice = false;
  var guesses = [];     // submitted words, in order — plain strings
  var letters = [];     // letters[r][c]
  var stifled = {};     // letter -> true while its key is on cooldown
  var rowEls = [];      // per row: the .frow grid
  var tileEls = [];     // tileEls[r][c]
  var keyEls = {};      // letter -> key button
  var toastTimer = null;

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
    return saved.guesses.every(function (w) {
      return typeof w === "string" && w.length === COLS && DICTIONARY.has(w);
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

  // ---------- setup ----------

  function resetBoard() {
    row = 0;
    done = false;
    won = false;
    gaveUp = false;
    revealing = false;
    guesses = [];
    letters = [];
    stifled = {};
    rowEls = [];
    tileEls = [];

    boardEl.innerHTML = "";
    bannerEl.classList.remove("show");
    bannerEl.textContent = "";
    shareBtn.classList.add("hidden");

    for (var r = 0; r < ROWS; r++) {
      var rowEl = document.createElement("div");
      rowEl.className = "frow";
      letters.push(Array(COLS).fill(""));
      var tiles = [];
      for (var c = 0; c < COLS; c++) {
        var tile = document.createElement("div");
        tile.className = "tile";
        rowEl.appendChild(tile);
        tiles.push(tile);
      }
      boardEl.appendChild(rowEl);
      rowEls.push(rowEl);
      tileEls.push(tiles);
    }

    buildKeyboard();
    updateActions();
  }

  // Today's puzzle: resume the saved game if there is one, else start fresh.
  function init() {
    practice = false;
    newBtn.textContent = "Practice";
    var saved = loadSaved();
    if (validSave(saved)) {
      answer = saved.answer;
      resetBoard();
      restore(saved);
    } else {
      answer = answerFor(todayKey());
      resetBoard();
      saveState();
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

  // Replay saved guesses onto the fresh board with no reveal animation.
  // Marks are pure functions of (word, answer), so they recompute; the
  // live game re-derives its cooldown from the last guess.
  function restore(saved) {
    guesses = saved.guesses.slice();
    for (var r = 0; r < guesses.length; r++) {
      var word = guesses[r];
      var marks = evaluate(word, answer);
      rowEls[r].classList.add("quiet"); // born resolved, no enter animation
      for (var c = 0; c < COLS; c++) {
        var t = tileEls[r][c];
        t.textContent = word.charAt(c);
        t.classList.add("filled", marks[c]);
      }
      for (var k = 0; k < COLS; k++) paintKey(word.charAt(k), marks[k]);
    }

    if (saved.done || guesses.length >= ROWS) {
      done = true;
      won = !!saved.won;
      gaveUp = !!saved.gaveUp;
      showBanner(endBanner());
      shareBtn.classList.remove("hidden");
    } else {
      row = guesses.length;
      if (row > 0) setCooldown(guesses[row - 1]);
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

  // ---------- the cooldown ----------

  // Word's letters fade out for exactly one guess. Passing no word lifts
  // every cooldown — that's how the next submit releases the previous
  // guess's letters, and how end states free the whole keyboard.
  function setCooldown(word) {
    stifled = {};
    for (var l in keyEls) keyEls[l].classList.remove("cool");
    if (!word) return;
    for (var i = 0; i < word.length; i++) {
      var ch = word.charAt(i);
      if (keyEls[ch]) {
        stifled[ch] = true;
        keyEls[ch].classList.add("cool");
      }
    }
  }

  // ---------- input ----------

  function onKey(key) {
    if (done || revealing) return;
    if (key === "Enter") { submit(); return; }
    if (key === "Backspace") { erase(); return; }
    if (/^[a-z]$/.test(key)) typeLetter(key);
  }

  function typeLetter(ch) {
    if (stifled[ch]) { toast(ch.toUpperCase() + " is stifled"); return; }
    for (var c = 0; c < COLS; c++) {
      if (!letters[row][c]) {
        letters[row][c] = ch;
        var tile = tileEls[row][c];
        tile.textContent = ch;
        tile.classList.add("filled");
        return;
      }
    }
  }

  function erase() {
    for (var c = COLS - 1; c >= 0; c--) {
      if (letters[row][c]) {
        letters[row][c] = "";
        var tile = tileEls[row][c];
        tile.textContent = "";
        tile.classList.remove("filled");
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
    var guess = letters[row].join("");
    if (guess.length < COLS) { reject("Not enough letters"); return; }
    if (!DICTIONARY.has(guess)) { reject("Not in word list"); return; }

    revealing = true;
    var rowIdx = row;
    var marks = evaluate(guess, answer);
    // A rejected attempt leaves `shake` behind; equal specificity, defined
    // after .reveal, it would override the flip — clear it first.
    tileEls[rowIdx].forEach(function (t) { t.classList.remove("shake"); });
    marks.forEach(function (mark, c) {
      var t = tileEls[rowIdx][c];
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
    marks.forEach(function (mark, c) {
      paintKey(guess.charAt(c), mark);
    });
    guesses.push(guess);

    if (guess === answer) {
      done = true;
      won = true;
      setCooldown(null); // the final board shows every earned mark
      showBanner(endBanner());
      shareBtn.classList.remove("hidden");
    } else if (rowIdx === ROWS - 1) {
      done = true;
      setCooldown(null);
      showBanner(endBanner());
      shareBtn.classList.remove("hidden");
    } else {
      setCooldown(guess); // lifts the previous cooldown as it lands its own
      row = rowIdx + 1;
    }
    updateActions();
    saveState();
    revealing = false;
  }

  // Six guesses cap the board, so giving up is the loss: end the game,
  // reveal the answer, freeze the board.
  function giveUp() {
    if (done || revealing) return;
    done = true;
    gaveUp = true;
    letters[row] = Array(COLS).fill("");
    tileEls[row].forEach(function (t) {
      t.textContent = "";
      t.classList.remove("filled");
    });
    setCooldown(null);
    showBanner(endBanner());
    shareBtn.classList.remove("hidden");
    updateActions();
    saveState();
  }

  function endBanner() {
    if (gaveUp || (!won && done)) {
      return "The word was " + answer.toUpperCase();
    }
    if (won) {
      var n = guesses.length;
      return PRAISE[Math.min(n - 1, 5)] + " \u2014 " + n +
        (n === 1 ? " guess" : " guesses");
    }
    return "";
  }

  function updateActions() {
    giveUpBtn.classList.toggle("hidden", done);
  }

  // ---------- keyboard colors ----------

  var RANK = { absent: 1, present: 2, correct: 3 };

  // Marks upgrade only, never downgrade. The `cool` outline is applied
  // separately (setCooldown) and rides on top: the dataset state survives
  // the faded period and shows again when the letter returns.
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
    tileEls[row].forEach(function (t) {
      t.classList.remove("shake");
      void t.offsetWidth; // restart the animation
      t.classList.add("shake");
      // Drop the class once played, or it overrides the later flip.
      t.addEventListener("animationend", function h(ev) {
        if (ev.animationName !== "shake") return;
        t.removeEventListener("animationend", h);
        t.classList.remove("shake");
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

  function share() {
    var emptyCell = document.documentElement.dataset.theme === "dark"
      ? "\u2B1B" : "\u2B1C";
    var EMOJI = { correct: "\uD83D\uDFE9", present: "\uD83D\uDFE8",
      absent: emptyCell };
    var score = won ? guesses.length + "/6" : "X/6";
    if (gaveUp) score = "gave up \u00B7 " + score;
    var title = ["Stifle", practice ? "practice" : todayKey(), score]
      .join(" \u00B7 ");
    var lines = [title, GAME_URL];
    guesses.forEach(function (w) {
      lines.push(evaluate(w, answer).map(function (m) {
        return EMOJI[m];
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
  giveUpBtn.addEventListener("click", function () {
    giveUpBtn.blur();
    giveUp();
  });
  shareBtn.addEventListener("click", function () { shareBtn.blur(); share(); });

  init();

  // Small console/test surface.
  window.STIFLE = {
    daily: init,
    practice: startPractice,
    todayKey: todayKey,
    answerFor: answerFor,
    evaluate: evaluate,
    dump: function () {
      return {
        answer: answer,
        guesses: guesses.slice(),
        stifled: Object.keys(stifled),
        row: row,
        practice: practice,
        done: done,
        won: won,
        gaveUp: gaveUp,
        save: loadSaved()
      };
    }
  };
})();
