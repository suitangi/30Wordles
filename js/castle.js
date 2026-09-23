// Castle — Day 11 variant of 30 Wordles.
// One puzzle per day: the answer derives from the calendar date and
// progress is saved to localStorage, so a refresh resumes the same game.
// Practice mode plays a random word without touching the daily save.
//
// A normal Wordle whose clues reveal from the OUTSIDE IN. Tiles 1 and 5
// give clues from the start; the inner tiles are WALLED — colorless, they
// give nothing. Land a green on an open tile and BOTH walls beside it
// fall — the breach spreads inward or outward: 1 opens 2, 5 opens 4, the
// keep at the middle opens from either wing, and a taken keep cracks the
// tiles next to it. The siege is strict: a walled tile's green doesn't
// count until the tile is open, so even the exact answer must be
// re-stormed until every wall is down. Only five displayed greens take
// the castle. Guesses are unlimited; give up is the one loss.
//
// Like Meddle's merged marks, the shown marks are time-dependent (they
// depend on which walls stood at the time), so the save stores them per
// guess and restore replays them instead of recomputing.
(function () {
  "use strict";

  var COLS = 5;
  var SALT = "castle"; // daily hash salt — each variant salts its own way
  var FLIP_STAGGER = 280; // ms between tile flips
  var FLIP_MID = 270;     // half-turn point: the score color appears here
  var STORE_KEY = "castle-day11";
  var GAME_URL = "https://suitangi.github.io/30Wordles/days/11";
  var PRAISE = ["Genius", "Magnificent", "Impressive", "Splendid", "Great",
    "Phew"];
  var OPEN_BANNER = "Breach the walls \u2014 outside in";

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
  var guesses = [];      // { w, shown } — shown[c] is the mark displayed at
                         // scoring time, or null where the wall stood
  var typed = [];        // the active row's letters
  var breached = [false, false, false, false, false];
  var rowEls = [];       // rowEls[r] — .crow of five tiles
  var keyEls = {};       // letter -> key button
  var toastTimer = null;

  // ---------- the walls ----------

  // The whole map: 1 and 5 stand open to START, but every wall falls to
  // either side — a breached tile opens BOTH its neighbours (suitangi:
  // tiles 2 and 4 are breachable from the keep too). A keep taken from
  // one wing cracks the other, and one flank can storm the whole word.
  function unlockedFor(br) {
    return [true, br[0] || br[2], br[1] || br[3], br[2] || br[4], true];
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

  function validShown(shown) {
    return Array.isArray(shown) && shown.length === COLS &&
      shown.every(function (m) {
        return m === null || m === "correct" || m === "present" ||
          m === "absent";
      });
  }

  function validSave(saved) {
    if (!saved || saved.date !== todayKey() || !validAnswer(saved.answer)) {
      return false;
    }
    return Array.isArray(saved.guesses) && saved.guesses.every(function (g) {
      return g && validAnswer(g.w) && validShown(g.shown);
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

  function resetBoard() {
    done = false;
    won = false;
    gaveUp = false;
    revealing = false;
    guesses = [];
    typed = Array(COLS).fill("");
    breached = [false, false, false, false, false];
    rowEls = [];

    boardEl.innerHTML = "";
    boardEl.classList.remove("overflowing");
    bannerEl.classList.remove("show");
    bannerEl.textContent = "";
    shareBtn.classList.add("hidden");
    updateActions();

    addRow();
    buildKeyboard();
    paintPendingGates(null);
  }

  // Rows are built on demand — the siege lasts as long as it lasts.
  function addRow() {
    var row = document.createElement("div");
    row.className = quietRows ? "crow quiet" : "crow";
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

  // The pending row is the player's map: walled slots wear the dashed
  // border, freshly opened ones flash the gate-open pulse. Called after
  // every breach and on restore. `pulse` flags the columns to flash —
  // keyed off the breach diff, not off a previous locked class (freshly
  // added rows never wore one).
  function paintPendingGates(pulse) {
    var row = activeRow();
    if (!row) return;
    var unlocked = unlockedFor(breached);
    for (var c = 0; c < COLS; c++) {
      var t = row.children[c];
      if (unlocked[c]) {
        t.classList.remove("locked");
        if (pulse && pulse[c]) {
          t.classList.remove("gate-open");
          void t.offsetWidth; // restart the animation
          t.classList.add("gate-open");
        }
      } else {
        t.classList.add("locked");
      }
    }
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

  // Replay saved guesses onto the fresh board with no animation. The shown
  // marks are stored per guess — they depend on which walls stood at the
  // time — so rows paint exactly as they did live; the breach map
  // re-derives from the stored greens.
  function restore(saved) {
    breached = [false, false, false, false, false];
    guesses = [];
    saved.guesses.forEach(function (g) {
      var row = rowEls[guesses.length] || addRow();
      var unlocked = unlockedFor(breached);
      for (var c = 0; c < COLS; c++) {
        var t = row.children[c];
        t.textContent = g.w.charAt(c);
        if (unlocked[c] && g.shown[c]) {
          t.classList.add("filled", g.shown[c]);
          paintKey(g.w.charAt(c), g.shown[c]);
          if (g.shown[c] === "correct") breached[c] = true;
        } else {
          t.classList.add("locked");
        }
      }
      guesses.push({ w: g.w, shown: g.shown.slice() });
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
    paintPendingGates(null);
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

    revealing = true;
    var rowIdx = guesses.length;
    var marks = evaluate(guess, answer);
    var unlocked = unlockedFor(breached);
    var shown = marks.map(function (mark, c) {
      return unlocked[c] ? mark : null; // the wall gives nothing
    });
    // A rejected attempt leaves `shake` behind; equal specificity, defined
    // after .reveal, it would override the flip — clear it first.
    Array.prototype.forEach.call(rowEls[rowIdx].children, function (t) {
      t.classList.remove("shake");
    });
    shown.forEach(function (mark, c) {
      var t = rowEls[rowIdx].children[c];
      // Every tile flips; only the open ones land on a color.
      setTimeout(function () { t.classList.add("reveal"); },
        100 + c * FLIP_STAGGER);
      setTimeout(function () {
        t.classList.remove("filled");
        if (mark) t.classList.add(mark);
        else t.classList.add("locked");
      }, 100 + c * FLIP_STAGGER + FLIP_MID);
    });
    setTimeout(function () { finish(rowIdx, guess, marks, unlocked); },
      100 + (COLS - 1) * FLIP_STAGGER + FLIP_MID + 150);
  }

  function finish(rowIdx, guess, marks, unlocked) {
    var shown = marks.map(function (mark, c) {
      return unlocked[c] ? mark : null;
    });
    typed = Array(COLS).fill("");
    guesses.push({ w: guess, shown: shown });

    var allGreen = true;
    for (var c = 0; c < COLS; c++) {
      if (unlocked[c]) {
        paintKey(guess.charAt(c), marks[c]);
        if (marks[c] === "correct") breached[c] = true;
        else allGreen = false;
      } else {
        allGreen = false; // a standing wall can't be green
      }
    }

    if (allGreen) {
      done = true;
      won = true;
      markWin(rowEls[rowIdx]);
      showBanner(endBanner());
      shareBtn.classList.remove("hidden");
    } else {
      if (guess === answer) {
        toast("You know the word \u2014 breach inward");
      }
      // Only now do the new walls register: the freshly opened tiles
      // flash on the waiting row.
      var nowUnlocked = unlockedFor(breached);
      var newly = nowUnlocked.map(function (u, c) {
        return u && !unlocked[c];
      });
      addRow();
      paintPendingGates(newly);
    }
    updateActions();
    saveState();
    revealing = false;
  }

  function markWin(row) {
    if (!row) return;
    Array.prototype.forEach.call(row.children, function (t) {
      t.classList.add("win-glow");
    });
  }

  function endBanner() {
    if (!won) return "The word was " + answer.toUpperCase();
    var n = guesses.length;
    var head = n <= PRAISE.length ? PRAISE[n - 1] : "Got there";
    return head + " \u2014 " + n + (n === 1 ? " guess" : " guesses");
  }

  // Guesses are unlimited, so giving up is the one loss: end the siege,
  // reveal the word, freeze the board.
  function giveUp() {
    if (done || revealing) return;
    done = true;
    gaveUp = true;
    typed = Array(COLS).fill("");
    var row = activeRow();
    if (row) {
      Array.prototype.forEach.call(row.children, function (t) {
        t.textContent = "";
        t.classList.remove("filled");
      });
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

  var RANK = { absent: 1, present: 2, correct: 3 };

  // Only displayed marks paint — a walled tile teaches the keyboard
  // nothing.
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
    Array.prototype.forEach.call(activeRow().children, function (tile) {
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

  // Standard emoji squares with one addition: a lock for every tile that
  // was walled when the guess landed.
  function share() {
    var emptyCell = document.documentElement.dataset.theme === "dark"
      ? "\u2B1B" : "\u2B1C";
    var EMOJI = { correct: "\uD83D\uDFE9", present: "\uD83D\uDFE8",
      absent: emptyCell };
    var LOCK = "\uD83D\uDD12";
    var n = guesses.length;
    var count = gaveUp
      ? "gave up \u00B7 " + n + (n === 1 ? " guess" : " guesses")
      : n + (n === 1 ? " guess" : " guesses");
    var title = ["Castle", practice ? "practice" : todayKey(), count]
      .join(" \u00B7 ");
    var lines = [title, GAME_URL];
    guesses.forEach(function (g) {
      lines.push(g.shown.map(function (m) {
        return m ? EMOJI[m] : LOCK;
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
  window.CASTLE = {
    daily: init,
    practice: startPractice,
    todayKey: todayKey,
    answerFor: answerFor,
    evaluate: evaluate,
    unlockedFor: unlockedFor,
    dump: function () {
      return {
        answer: answer,
        guesses: guesses.map(function (g) {
          return { w: g.w, shown: g.shown.map(function (m) {
            return m || "locked";
          }) };
        }),
        breached: breached.slice(),
        unlocked: unlockedFor(breached),
        practice: practice,
        done: done,
        won: won,
        gaveUp: gaveUp,
        save: loadSaved()
      };
    }
  };
})();
