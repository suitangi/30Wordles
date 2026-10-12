// Idle — Day 29 variant of 30 Wordles.
// One puzzle per day: the answer derives from the calendar date and
// finished games are saved to localStorage, so a refresh re-shows the
// result. Practice mode plays a random word without touching the save.
//
// Wordle with ONE guess, where the marquee is the whole clue board.
// The page opens dark: the strip and the row are hidden behind a Start
// button, and nothing runs until the player presses it. Start reveals
// the board and starts the clock together. The top row is the entire
// alphabet, shuffled by the day, scrolling right-to-left over the
// board's own columns. Every letter wears the colors it would earn on
// the board: as a letter crosses a column it lights with its mark
// THERE — green is its spot, yellow it's in the word, gray it isn't.
// The day's shuffle is the order the clues arrive in; a full loop
// shows everything, and every second of watching is score. You get
// exactly one guess: type the word and press Enter — right or wrong,
// that is the game. Give up is the other loss. No banner: the board
// and the share button speak for themselves; practice toasts
// "Practice round".
(function () {
  "use strict";

  var WL = 5;
  var COLS = 5;
  var GAP = 5;             // board gap — the marquee shares the pitch
  var SALT = "idle";       // daily hash salt — each variant salts its own way
  var ALPHA_SALT = "idle-alphabet"; // the marquee shuffle's own salt
  var STORE_KEY = "idle-day29";
  var GAME_URL = "https://suitangi.github.io/30Wordles/days/29";
  // Compressed Bundle timing (the Hustle law: reveal time is clock time).
  var FLIP_START = 50;
  var FLIP_STAGGER = 120;
  var FLIP_MID = 150;      // half-turn of the 0.3s flip: the color lands here
  var FLIP_TAIL = 100;
  var LETTERS = "abcdefghijklmnopqrstuvwxyz".split("");
  // The scroll: one column pitch per tick, so a 26-letter loop takes
  // 13.3s and each column's color holds for one full pitch before the
  // tile slides to the next. The speed knob (600ms originally, -15%).
  var MQ_MS_PER_TILE = 510;

  var ANSWERS = window.WORD_LISTS.answers;
  var DICTIONARY = new Set(window.WORD_LISTS.guesses);
  var RANK = { absent: 1, present: 2, correct: 3 };

  var boardEl = document.getElementById("board");
  var stageEl = document.getElementById("stage");
  var startBtn = document.getElementById("start-btn");
  var marqueeEl = document.getElementById("marquee");
  var keyboardEl = document.getElementById("keyboard");
  var clockEl = document.getElementById("clock");
  var clockHintEl = document.getElementById("clock-hint");
  var toastEl = document.getElementById("toast");
  var newBtn = document.getElementById("new-btn");
  var giveUpBtn = document.getElementById("giveup-btn");
  var shareBtn = document.getElementById("share-btn");

  var answer = "";
  var guess = "";          // the ONE guess — "" until it is spent
  var typed = Array(WL).fill("");
  var started = false;     // the Start button gates everything
  var done = false;
  var won = false;
  var gaveUp = false;
  var revealing = false;
  var practice = false;
  var rowEl = null;        // the single input row
  var trackEl = null;      // the marquee's two-copy track
  var alphabet = [];
  var keyEls = {};         // letter -> key button (input only, never painted)
  var toastTimer = null;

  // The clock: elapsedMs is the banked time (persisted on the end
  // state), startedAt is the live anchor. nowElapsed() is the truth.
  var elapsedMs = 0;
  var running = false;
  var startedAt = 0;
  var ticker = null;
  var banker = null;

  // The marquee engine state.
  var mqPitch = 0;         // px per column (tile + gap), measured
  var mqOffset = 0;        // ms of scroll since Start
  var mqLast = 0;          // previous rAF timestamp
  var mqRaf = 0;           // the loop's handle (so it's only launched once)
  var mqStaticTimer = null;
  var mqMarks = [];        // per alphabet index: { marks[5], cur }
  var mqStatic = false;    // reduced motion: no scroll, cycling colors only

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

  function hashStr(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    // murmur-style finalizer: date-shaped keys scatter before the mod
    // (the Toggle narrow-bits lesson — the low bits of the plain hash cycle)
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
  }

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // The day's shuffled alphabet — one Fisher-Yates pass over A-Z, seeded
  // by the date, so a refresh rebuilds the exact same scrolling order.
  // The shuffle is the game: it is the order the clues arrive in.
  function alphabetFor(key) {
    var rng = mulberry32(hashStr(ALPHA_SALT + ":" + key));
    var letters = LETTERS.slice();
    for (var i = letters.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = letters[i];
      letters[i] = letters[j];
      letters[j] = t;
    }
    return letters;
  }

  function validAnswer(w) {
    return typeof w === "string" && DICTIONARY.has(w);
  }

  // End states persist as results; a LIVE state persists so a refresh
  // can never rewind the clock — it resumes from the bank.
  function validSave(saved) {
    if (!saved || saved.date !== todayKey() || !validAnswer(saved.answer)) {
      return false;
    }
    if (typeof saved.elapsedMs !== "number" ||
        !isFinite(saved.elapsedMs) || saved.elapsedMs < 0) {
      return false;
    }
    if (typeof saved.won !== "boolean" || typeof saved.gaveUp !== "boolean" ||
        typeof saved.done !== "boolean") {
      return false;
    }
    if (!saved.done) {
      // live watch: no guess spent, no outcome claimed
      return saved.won === false && saved.gaveUp === false && !saved.guess;
    }
    if (saved.won && saved.gaveUp) return false;
    if (!saved.guess) {
      if (saved.won || !saved.gaveUp) return false; // only a give up ends wordless
      return true;
    }
    return typeof saved.guess === "string" &&
      saved.guess.length === WL && DICTIONARY.has(saved.guess);
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
        guess: guess,
        elapsedMs: nowElapsed(),
        done: done,
        won: won,
        gaveUp: gaveUp
      }));
    } catch (e) { /* storage unavailable — game still playable */ }
  }

  // ---------- the clock ----------

  function nowElapsed() {
    return elapsedMs + (running ? Date.now() - startedAt : 0);
  }

  // M:SS.T — minutes unbounded, seconds zero-padded, tenths. The clock's
  // whole public language (display, share) is this one format.
  function formatTime(ms) {
    ms = Math.max(0, Math.floor(ms));
    var m = Math.floor(ms / 60000);
    var s = Math.floor((ms % 60000) / 1000);
    var t = Math.floor((ms % 1000) / 100);
    return m + ":" + String(s).padStart(2, "0") + "." + t;
  }

  function renderClock(ms) {
    clockEl.textContent = formatTime(ms);
  }

  function startClock() {
    if (running || done) return;
    running = true;
    startedAt = Date.now();
    clockEl.classList.add("running");
    ticker = setInterval(function () { renderClock(nowElapsed()); }, 100);
    // Bank the clock into the save every second, so a refresh (or a
    // killed tab) can never rewind it by more than a second.
    banker = setInterval(function () {
      if (running && !done && !practice) saveState();
    }, 1000);
  }

  // Freeze: bank the elapsed time and leave it on the clock.
  function stopClock() {
    if (running) {
      elapsedMs = nowElapsed();
      running = false;
      startedAt = 0;
      clearInterval(ticker);
      ticker = null;
      clearInterval(banker);
      banker = null;
      clockEl.classList.remove("running");
    }
    renderClock(elapsedMs);
  }

  // ---------- the marquee ----------

  // Board-size tiles on the board's own pitch: the strip reads as the
  // board's top row, its columns lined up one-to-one with the guess row
  // below. --mq-tile is measured off the viewport with the same
  // five-tiles-and-four-gaps math the grid uses.
  function layoutMarquee() {
    var w = marqueeEl.clientWidth;
    if (!w) return; // headless stub or unrendered — the CSS default carries
    var tile = (w - GAP * 4) / COLS;
    mqPitch = tile + GAP;
    marqueeEl.style.setProperty("--mq-tile", tile + "px");
  }

  function mqU() { return mqOffset / MQ_MS_PER_TILE; }

  // The clue for letter ch on column c: the color ch would earn if it
  // were guessed onto that column — green at its own spot, yellow in
  // the word, gray outside it. The whole answer's Wordle matrix, and
  // the shuffle decides the order you get to read it in.
  function markAt(ch, c) {
    if (answer.charAt(c) === ch) return "correct";
    return answer.indexOf(ch) >= 0 ? "present" : "absent";
  }

  // Arm every letter at every column — 130 clues, all true, all pending.
  // mqMarks is indexed by TRACK position, so the letters come from the
  // day's shuffle, not from a-z order (v3's first draft got this wrong:
  // the colors lit on the wrong letters' tiles). cur is the column a
  // tile is currently lit for (-1 = off the board, dark).
  function armMarquee() {
    mqMarks = [];
    for (var idx = 0; idx < alphabet.length; idx++) {
      var marks = [];
      for (var c = 0; c < WL; c++) {
        marks.push(markAt(alphabet[idx], c));
      }
      mqMarks.push({ marks: marks, cur: -1 });
    }
  }

  // The lighting law: a tile ON THE BOARD is always lit, with the color
  // of the column it stands on — nearest column wins, so a letter's
  // traversal is its true color sequence read continuously (yellow,
  // green, yellow …) with no dark gaps between columns. A tile is dark
  // only while more than half of it is off the board.
  function updateAlignments() {
    var u = mqU();
    for (var idx = 0; idx < mqMarks.length; idx++) {
      var en = mqMarks[idx];
      var s = ((idx - u) % LETTERS.length + LETTERS.length) % LETTERS.length;
      if (s > LETTERS.length - 0.5) s -= LETTERS.length; // wrapped past column 0
      var c = s >= -0.5 && s <= COLS - 0.5
        ? Math.min(COLS - 1, Math.max(0, Math.round(s)))
        : -1;
      if (c === en.cur) continue;
      for (var h = 0; h < trackEl.children.length; h++) {
        var t = trackEl.children[h].children[idx];
        if (en.cur >= 0) t.classList.remove(en.marks[en.cur]);
        if (c >= 0) t.classList.add(en.marks[c]);
      }
      en.cur = c;
    }
  }

  function mqApply() {
    if (!mqStatic) {
      var shift = (mqU() % LETTERS.length) * mqPitch;
      trackEl.style.transform = "translateX(" + (-shift) + "px)";
      updateAlignments();
    } else {
      mqStaticShow();
    }
  }

  // Reduced motion: the strip never moves, so the five visible tiles
  // become the window — each step swaps in the letters that WOULD be
  // crossing the columns and lights them. Color and content changes
  // only, no movement; the drip takes exactly as long as the scroll.
  function mqStaticShow() {
    var u = Math.floor(mqU()) % LETTERS.length;
    var half = trackEl.children[0];
    for (var c = 0; c < COLS; c++) {
      var t = half.children[c];
      var ch = alphabet[(u + c) % LETTERS.length];
      t.textContent = ch;
      t.classList.remove("correct", "present", "absent");
      t.classList.add(markAt(ch, c));
    }
  }

  function mqTick(now) {
    // Cap the delta: a hidden tab suspends rAF, and the whole hidden
    // span must not land as one jump when it wakes.
    if (mqLast) mqOffset += Math.min(now - mqLast, 100);
    mqLast = now;
    mqApply();
    window.requestAnimationFrame(mqTick);
  }

  // Debug/test stepper: advance the scroll by hand and apply.
  function mqStep(ms) {
    mqOffset += ms;
    mqApply();
  }

  // The scroll only runs once the game has started — launch the one
  // loop (rAF, or the reduced-motion stepper) exactly once.
  function launchMarquee() {
    if (mqStatic) {
      marqueeEl.classList.add("mq-static");
      mqStep(0); // paint the first window immediately
      if (!mqStaticTimer) {
        mqStaticTimer = setInterval(function () {
          mqStep(MQ_MS_PER_TILE);
        }, MQ_MS_PER_TILE);
      }
    } else if (typeof window.requestAnimationFrame === "function" && !mqRaf) {
      mqRaf = 1;
      window.requestAnimationFrame(mqTick);
    }
  }

  // ---------- board ----------

  // Standard Wordle evaluation — used for the one guess's marks on the
  // share (and nothing else; the marquee speaks markAt).
  function evaluate(guess, target) {
    var marks = Array(WL).fill("absent");
    var remaining = {};
    for (var i = 0; i < WL; i++) {
      if (guess[i] === target[i]) marks[i] = "correct";
      else remaining[target[i]] = (remaining[target[i]] || 0) + 1;
    }
    for (var j = 0; j < WL; j++) {
      if (marks[j] !== "correct" && remaining[guess[j]] > 0) {
        marks[j] = "present";
        remaining[guess[j]]--;
      }
    }
    return marks;
  }

  function buildBoard() {
    boardEl.innerHTML = "";
    rowEl = document.createElement("div");
    rowEl.className = "idrow";
    for (var c = 0; c < WL; c++) {
      var tile = document.createElement("div");
      tile.className = "tile";
      rowEl.appendChild(tile);
    }
    boardEl.appendChild(rowEl);
  }

  // The marquee: the day's alphabet twice over — two identical halves in
  // one track, so the wrap at one half is seamless. Both halves light
  // the same clues; the second is aria-hidden decoration.
  function buildMarquee() {
    marqueeEl.innerHTML = "";
    trackEl = document.createElement("div");
    trackEl.className = "mq-track";
    alphabet = alphabetFor(todayKey());
    for (var copy = 0; copy < 2; copy++) {
      var half = document.createElement("div");
      half.className = "mq-half" + (copy ? " mq-copy2" : "");
      if (copy) half.setAttribute("aria-hidden", "true");
      for (var i = 0; i < alphabet.length; i++) {
        var tile = document.createElement("div");
        tile.className = "tile mq-tile";
        tile.textContent = alphabet[i];
        half.appendChild(tile);
      }
      trackEl.appendChild(half);
    }
    marqueeEl.appendChild(trackEl);
    layoutMarquee();
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
      var rowElK = document.createElement("div");
      rowElK.className = "key-row";
      keys.forEach(function (k) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "key" + (k.length > 1 ? " wide" : "");
        btn.textContent = k === "Backspace" ? "\u232B" : k;
        btn.setAttribute("aria-label", k);
        btn.addEventListener("click", function () { onKey(k); btn.blur(); });
        rowElK.appendChild(btn);
        if (k.length === 1) keyEls[k] = btn;
      });
      keyboardEl.appendChild(rowElK);
    });
  }

  function resetBoard() {
    done = false;
    won = false;
    gaveUp = false;
    revealing = false;
    guess = "";
    started = false;
    typed = Array(WL).fill("");

    stopClock(); // banks any live run first — then the reset zeroes it
    elapsedMs = 0;
    renderClock(elapsedMs);
    clockEl.classList.remove("done");
    clockHintEl.classList.remove("hidden");

    buildBoard();
    buildMarquee();
    buildKeyboard();
    stageEl.classList.remove("started");
    startBtn.classList.remove("hidden");
    shareBtn.classList.add("hidden");
    updateActions();
  }

  // Today's puzzle: resume a saved game (live or finished) if there is
  // one, else sit behind the Start button — nothing moves, nothing is
  // saved, until the player's mark.
  function init() {
    practice = false;
    newBtn.textContent = "Practice";
    var saved = loadSaved();
    resetBoard();
    if (validSave(saved)) {
      answer = saved.answer;
      restore(saved);
    } else {
      answer = answerFor(todayKey());
    }
    armMarquee();
  }

  // The player's mark: the reveal and the clock begin together. A live
  // save is stamped right away so even an instant refresh can't rewind.
  function startGame() {
    if (started || done || revealing) return;
    started = true;
    stageEl.classList.add("started");
    startBtn.classList.add("hidden");
    startClock();
    saveState();
    updateActions();
    launchMarquee();
  }

  // Random word, never saved — the daily game stays untouched. A forced
  // word ("crane") is the debugging backdoor.
  function startPractice(force) {
    practice = true;
    answer = validAnswer(force)
      ? force
      : ANSWERS[Math.floor(Math.random() * ANSWERS.length)];
    resetBoard();
    armMarquee();
    newBtn.textContent = "Today\u2019s puzzle";
    toast("Practice round");
  }

  // A saved game, born resumed: a finished result shows its outcome; a
  // live watch resumes ticking from the banked time immediately —
  // staring at the reloaded board costs the same as watching did.
  function restore(saved) {
    elapsedMs = saved.elapsedMs || 0;
    started = true;
    stageEl.classList.add("started");
    startBtn.classList.add("hidden");
    launchMarquee();
    if (!saved.done) {
      startClock(); // the run is still live — the clock never rewinds
      return;
    }
    guess = saved.guess || "";
    done = true;
    won = !!saved.won;
    gaveUp = !!saved.gaveUp;
    stopClock();
    renderClock(elapsedMs);
    clockHintEl.classList.add("hidden");
    if (won) {
      paintWinRow();
      clockEl.classList.add("done");
    } else {
      if (guess) paintGuessRow();
      appendAnswerRow();
    }
    shareBtn.classList.remove("hidden");
    updateActions();
  }

  // The spent word, colorless — the row records what you played, never
  // what it scored.
  function paintGuessRow() {
    for (var c = 0; c < WL; c++) {
      var t = rowEl.children[c];
      t.textContent = guess.charAt(c);
      t.classList.add("filled");
    }
  }

  // A won board: the answer itself sits green on the row, glowing.
  function paintWinRow() {
    for (var c = 0; c < WL; c++) {
      var t = rowEl.children[c];
      t.textContent = answer.charAt(c);
      t.classList.add("filled", "correct", "win-glow");
    }
  }

  // The loss reveal: the answer walks on as a ghost row under the input.
  function appendAnswerRow() {
    var row = document.createElement("div");
    row.className = "idrow answer";
    for (var c = 0; c < WL; c++) {
      var tile = document.createElement("div");
      tile.className = "tile correct";
      tile.textContent = answer.charAt(c);
      row.appendChild(tile);
    }
    for (c = 0; c < WL; c++) row.children[c].classList.add("win-glow");
    boardEl.appendChild(row);
    return row;
  }

  // ---------- input ----------

  function onKey(key) {
    if (done || revealing || !started) return; // nothing types before Start
    if (key === "Enter") { submit(); return; }
    if (key === "Backspace") { erase(); return; }
    if (/^[a-z]$/.test(key)) typeLetter(key);
  }

  function typeLetter(ch) {
    for (var c = 0; c < WL; c++) {
      if (!typed[c]) {
        typed[c] = ch;
        rowEl.children[c].textContent = ch;
        rowEl.children[c].classList.add("filled");
        return;
      }
    }
  }

  function erase() {
    for (var c = WL - 1; c >= 0; c--) {
      if (typed[c]) {
        typed[c] = "";
        rowEl.children[c].textContent = "";
        rowEl.children[c].classList.remove("filled");
        return;
      }
    }
  }

  // ---------- the one guess ----------

  function submit() {
    if (done || revealing || !started) return;
    var word = typed.join("");
    if (word.length < WL) { reject("Not enough letters"); return; }
    if (!DICTIONARY.has(word)) { reject("Not in word list"); return; }

    // A real word spends the guess — right or wrong, that is the game.
    revealing = true;
    var marks = evaluate(word, answer);
    clearShake();
    typed = Array(WL).fill("");
    flipRow(word === answer ? marks : [null, null, null, null, null]);
    setTimeout(function () { finish(word, marks); }, revealFinish());
  }

  function finish(word, marks) {
    guess = word;
    done = true;
    if (word === answer) {
      won = true;
      markWin();
      clockEl.classList.add("done");
    } else {
      appendAnswerRow(); // the truth the row never told
    }
    stopClock();
    clockHintEl.classList.add("hidden");
    shareBtn.classList.remove("hidden");
    updateActions();
    saveState();
    revealing = false;
  }

  function revealFinish() {
    return FLIP_START + (WL - 1) * FLIP_STAGGER + FLIP_MID + FLIP_TAIL;
  }

  // The one visual primitive: staggered flips with the mark landing at
  // the half-turn (compressed Bundle timing — reveal time is clock time).
  // A null mark flips with motion only and lands colorless-filled: the
  // row never speaks colors except on the win.
  function flipRow(marks) {
    for (var c = 0; c < WL; c++) {
      var t = rowEl.children[c];
      setTimeout(function (tile) {
        tile.classList.remove("reveal");
        void tile.offsetWidth;
        tile.classList.add("reveal");
      }, FLIP_START + c * FLIP_STAGGER, t);
      setTimeout(function (tile, mark) {
        if (mark) {
          tile.classList.remove("filled");
          tile.classList.add(mark);
        }
      }, FLIP_START + c * FLIP_STAGGER + FLIP_MID, t, marks[c]);
    }
  }

  function clearShake() {
    // A rejected attempt leaves `shake` behind; equal specificity, defined
    // after .reveal, it would override the flip — clear it first.
    for (var c = 0; c < WL; c++) rowEl.children[c].classList.remove("shake");
  }

  function markWin() {
    for (var c = 0; c < WL; c++) rowEl.children[c].classList.add("win-glow");
  }

  // The other loss: the guess is unspent but the player is done looking.
  function giveUp() {
    if (done || revealing || !started) return;
    typed = Array(WL).fill("");
    for (var c = 0; c < WL; c++) {
      rowEl.children[c].textContent = "";
      rowEl.children[c].className = "tile";
    }
    done = true;
    gaveUp = true;
    stopClock();
    clockHintEl.classList.add("hidden");
    appendAnswerRow();
    shareBtn.classList.remove("hidden");
    updateActions();
    saveState();
  }

  function updateActions() {
    giveUpBtn.classList.toggle("hidden", done || !started);
  }

  // ---------- feedback ----------

  // The keyboard never paints in this game — the marquee IS the letter
  // knowledge display, and painting keys would double it. Keys are input
  // only (mobile needs them to type).
  function reject(msg) {
    toast(msg);
    for (var c = 0; c < WL; c++) {
      var tile = rowEl.children[c];
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

  // The time is the score; the emoji line records the shot. No word in
  // the share — word plus colors would spoil the answer for anyone who
  // hasn't played. The blocks alone say how close it was.
  function share() {
    var emptyCell = document.documentElement.dataset.theme === "dark"
      ? "\u2B1B" : "\u2B1C";
    var EMOJI = { correct: "\uD83D\uDFE9", present: "\uD83D\uDFE8",
      absent: emptyCell };
    var state = won ? "1/1" : (gaveUp ? "gave up" : "X/1");
    var title = ["Idle", practice ? "practice" : todayKey(), state]
      .join(" \u00B7 ");
    var lines = [title, GAME_URL];
    if (won || guess) {
      var marks = evaluate(guess, answer);
      lines.push(marks.map(function (m) {
        return EMOJI[m];
      }).join(""));
    }
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

  window.addEventListener("resize", function () { layoutMarquee(); });

  // Bank before the page goes anywhere — a hidden or closing tab must
  // not take the running clock with it.
  window.addEventListener("visibilitychange", function () {
    if (document.hidden && running && !done && !practice) saveState();
  });
  window.addEventListener("pagehide", function () {
    if (running && !done && !practice) saveState();
  });

  newBtn.addEventListener("click", function () {
    newBtn.blur();
    if (practice) init(); else startPractice();
  });
  startBtn.addEventListener("click", function () {
    startBtn.blur();
    startGame();
  });
  giveUpBtn.addEventListener("click", function () {
    giveUpBtn.blur();
    giveUp();
  });
  shareBtn.addEventListener("click", function () { shareBtn.blur(); share(); });

  // Reduced motion: the strip never translates — the five visible tiles
  // become the crossing window and step one column per tick (idle.js
  // owns this; a CSS rule can't stop a JS-driven transform, and the
  // drip must survive without movement). Detection only here — the
  // stepper itself launches with Start.
  try {
    mqStatic = !!window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch (e) { mqStatic = false; }

  init();

  // Small console/test surface.
  window.IDLE = {
    daily: init,
    practice: startPractice,
    todayKey: todayKey,
    answerFor: answerFor,
    alphabetFor: alphabetFor,
    evaluate: evaluate,
    formatTime: formatTime,
    tile: function (c) { return rowEl.children[c]; },
    mqTile: function (letter) {
      if (!trackEl) return null;
      var half = trackEl.children[0];
      for (var i = 0; i < half.children.length; i++) {
        if (half.children[i].textContent === letter) return half.children[i];
      }
      return null;
    },
    mqStep: mqStep,
    dump: function () {
      var flat = [];
      for (var idx = 0; idx < mqMarks.length; idx++) {
        var en = mqMarks[idx];
        for (var c = 0; c < en.marks.length; c++) {
          flat.push({ letter: alphabet[idx], col: c, mark: en.marks[c] });
        }
      }
      return {
        answer: answer,
        alphabet: alphabet.slice(),
        guess: guess,
        typed: typed.join(""),
        started: started,
        running: running,
        elapsed: nowElapsed(),
        mqU: mqU(),
        mqMarks: flat,
        mqStatic: mqStatic,
        practice: practice,
        done: done,
        won: won,
        gaveUp: gaveUp,
        save: loadSaved()
      };
    }
  };
})();
