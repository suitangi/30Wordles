// Scramble — Day 20 variant of 30 Wordles.
// One puzzle per day: the answer derives from the calendar date and
// progress is saved to localStorage, so a refresh resumes the same game.
// Practice mode plays a random word without touching the daily save.
//
// A Wordle where every row deals your letters its own way. Before the
// game starts the rng scrambles each row's letter spacing independently:
// a row numbered 3,4,1,5,2 takes slot 3 of your typed word into its
// first tile, slot 4 into its second, and so on — type SHOUT and that
// row shows OUSTH. You type in the entry strip above the board and the
// letters deal themselves onto the waiting row live, scrambled per its
// numbers; Enter flips the deal and the SCRAMBLED word is what gets
// judged. Five greens need the row to spell the answer after the deal.
// And since precious few five-letter words scramble into other words,
// there is one lift: type the answer itself and the game ends on the
// spot — the scramble lifts, the word lands in order, five greens. No
// banner: the board is the announcement, the reveal and the share button
// speak for themselves.

(function () {
  "use strict";

  var WL = 5;
  var ROWS = 6;            // six pre-dealt rows, all visible from the start
  var SALT = "scramble";   // daily hash salt — each variant salts its own way
  var PERM_SALT = "scramble-perms";
  var STORE_KEY = "scramble-day20";
  var GAME_URL = "https://suitangi.github.io/30Wordles/days/20";
  var FLIP_STAGGER = 280;  // ms between tile flips (Bundle timing)
  var FLIP_MID = 270;      // half-turn point: the score color appears here
  var REVEAL_START = 100;
  var ANSWERS = window.WORD_LISTS.answers;
  var DICTIONARY = new Set(window.WORD_LISTS.guesses);

  var boardEl = document.getElementById("board");
  var entryEl = document.getElementById("entry");
  var keyboardEl = document.getElementById("keyboard");
  var toastEl = document.getElementById("toast");
  var newBtn = document.getElementById("new-btn");
  var giveUpBtn = document.getElementById("giveup-btn");
  var shareBtn = document.getElementById("share-btn");

  var answer = "";
  var perms = [];         // perms[r][c] = the typed slot tile c takes (1-5)
  var guesses = [];       // typed words, in order
  var typed = Array(WL).fill("");
  var done = false;
  var won = false;
  var gaveUp = false;
  var revealing = false;
  var practice = false;
  var quietRows = false;  // restore flag: rows paint finished, not animated
  var rowEls = [];
  var slotEls = [];       // the entry strip
  var keyEls = {};        // letter -> key button
  var toastTimer = null;

  var RANK = { absent: 1, present: 2, correct: 3 };

  // ---------- deterministic randomness ----------

  function hashStr(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
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

  // ---------- the scramble ----------

  // Row r's deal: tile c takes typed slot perms[r][c] (1-indexed).
  // "shout" under 3,4,1,5,2 reads "ousth" — the spec's example.
  function scramble(word, perm) {
    var out = "";
    for (var k = 0; k < WL; k++) out += word.charAt(perm[k] - 1);
    return out;
  }

  // Six independent shuffles of 1..5; an identity row would wear numbers
  // and scramble nothing, so redraw the rare degenerate lot.
  function permsFor(key) {
    var rng = mulberry32(hashStr(PERM_SALT + ":" + key));
    var out = [];
    for (var r = 0; r < ROWS; r++) {
      var p, guard = 0;
      do {
        p = [1, 2, 3, 4, 5];
        for (var i = p.length - 1; i > 0; i--) {
          var j = Math.floor(rng() * (i + 1));
          var t = p[i];
          p[i] = p[j];
          p[j] = t;
        }
        guard++;
      } while (p[0] === 1 && p[1] === 2 && p[2] === 3 && p[3] === 4 &&
        p[4] === 5 && guard < 30);
      out.push(p);
    }
    return out;
  }

  // What the waiting row will show for a word: the deal — except the
  // answer itself, which lands in order when typed (the lift).
  function displayWord(r, word) {
    return word === answer ? word : scramble(word, perms[r]);
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
    return Array.isArray(saved.guesses) &&
      saved.guesses.length <= ROWS &&
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

  // All six rows stand from the start — the numbers are the puzzle's map.
  function buildBoard() {
    boardEl.innerHTML = "";
    rowEls = [];
    for (var r = 0; r < ROWS; r++) {
      var row = document.createElement("div");
      row.className = (quietRows ? "scrow quiet" : "scrow");
      for (var c = 0; c < WL; c++) {
        var tile = document.createElement("div");
        tile.className = "tile";
        var lt = document.createElement("span");
        lt.className = "slt";
        var num = document.createElement("span");
        num.className = "slot-num";
        num.textContent = String(perms[r][c]);
        tile.appendChild(lt);
        tile.appendChild(num);
        row.appendChild(tile);
      }
      boardEl.appendChild(row);
      rowEls.push(row);
    }
  }

  function buildEntry() {
    entryEl.innerHTML = "";
    slotEls = [];
    for (var c = 0; c < WL; c++) {
      var s = document.createElement("div");
      s.className = "tile";
      entryEl.appendChild(s);
      slotEls.push(s);
    }
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

  function activeRow() { return rowEls[guesses.length]; }

  // The row just played hands the deal to its successor.
  function retireRow(idx) {
    if (rowEls[idx]) rowEls[idx].classList.remove("on-row");
  }

  function resetBoard() {
    done = false;
    won = false;
    gaveUp = false;
    revealing = false;
    guesses = [];
    typed = Array(WL).fill("");

    buildBoard();
    buildEntry();
    buildKeyboard();
    rowEls[0].classList.add("on-row");
    shareBtn.classList.add("hidden");
    updateActions();
    paintEntry();
  }

  // Today's puzzle: resume the saved game if there is one, else start
  // fresh. The perms derive from the date, so a refresh re-deals exactly.
  function init() {
    practice = false;
    newBtn.textContent = "Practice";
    var key = todayKey();
    answer = answerFor(key);
    perms = permsFor(key);
    var saved = loadSaved();
    if (validSave(saved)) {
      quietRows = true;
      resetBoard();
      restore(saved);
      quietRows = false;
    } else {
      resetBoard();
      saveState();
    }
  }

  // Random word and deal, never saved — the daily stays untouched. A
  // forced word ("crane") is the debugging backdoor.
  function startPractice(force) {
    practice = true;
    answer = validAnswer(force)
      ? force
      : ANSWERS[Math.floor(Math.random() * ANSWERS.length)];
    perms = permsFor(PERM_SALT + ":practice:" + Math.random());
    quietRows = false;
    resetBoard();
    newBtn.textContent = "Today\u2019s puzzle";
    toast("Practice round");
  }

  // Replay saved guesses onto the rebuilt rows with no animation. Marks
  // are pure (the deal + evaluate), so rows paint directly — restored
  // boards are born finished.
  function restore(saved) {
    guesses = [];
    saved.guesses.forEach(function (w, r) {
      var row = rowEls[r];
      retireRow(r); // rebuilt rows are finished rows — no live ring
      var shown = displayWord(r, w);
      var marks = evaluate(shown, answer);
      for (var c = 0; c < WL; c++) {
        var t = row.children[c];
        t.children[0].textContent = shown.charAt(c);
        t.classList.add("filled", marks[c]);
        paintKey(shown.charAt(c), marks[c]);
      }
      if (w === answer) row.classList.add("unscrambled");
      guesses.push(w);
    });

    if (saved.done) {
      done = true;
      won = !!saved.won;
      gaveUp = !!saved.gaveUp;
      if (won) markWin(rowEls[guesses.length - 1]);
      else for (var r = 0; r < ROWS; r++) retireRow(r);
      shareBtn.classList.remove("hidden");
    } else {
      activeRow().classList.add("on-row");
    }
    updateActions();
  }

  // ---------- entry ----------

  function paintEntry() {
    for (var c = 0; c < WL; c++) {
      slotEls[c].textContent = typed[c] || "";
      slotEls[c].classList.toggle("filled", !!typed[c]);
    }
    paintDeal();
  }

  // The letters deal themselves live: tile c of the waiting row shows
  // the letter sitting in typed slot perms[r][c]. Held through the flip
  // (revealing) and after the game ends.
  function paintDeal() {
    if (done || revealing) return;
    var row = rowEls[guesses.length];
    if (!row) return;
    for (var c = 0; c < WL; c++) {
      var t = row.children[c];
      var ch = typed[perms[guesses.length][c] - 1] || "";
      t.children[0].textContent = ch;
      t.classList.toggle("filled", !!ch);
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
    for (var c = 0; c < WL; c++) {
      if (!typed[c]) {
        typed[c] = ch;
        paintEntry();
        return;
      }
    }
  }

  function erase() {
    for (var c = WL - 1; c >= 0; c--) {
      if (typed[c]) {
        typed[c] = "";
        paintEntry();
        return;
      }
    }
  }

  // ---------- submitting a guess ----------

  // Standard Wordle evaluation: exact matches first, then stray letters.
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

  function submit() {
    if (done || revealing) return;
    var word = typed.join("");
    if (word.length < WL) { reject("Not enough letters"); return; }
    if (!DICTIONARY.has(word)) { reject("Not in word list"); return; }

    revealing = true;
    var r = guesses.length;
    retireRow(r);
    var shown = displayWord(r, word);
    var marks = evaluate(shown, answer);
    // deal the letters to the row — the answer itself lands in order,
    // its row's scramble lifted for the win
    if (word === answer) rowEls[r].classList.add("unscrambled");
    for (var c = 0; c < WL; c++) {
      var t = rowEls[r].children[c];
      t.children[0].textContent = shown.charAt(c);
      t.classList.add("filled");
    }
    typed = Array(WL).fill("");
    paintEntry();
    // A rejected attempt leaves `shake` behind; equal specificity, defined
    // after .reveal, it would override the flip — clear it first.
    for (c = 0; c < WL; c++) rowEls[r].children[c].classList.remove("shake");
    flipRow(r, marks, REVEAL_START);
    setTimeout(function () { finish(r, word, marks); },
      REVEAL_START + (WL - 1) * FLIP_STAGGER + FLIP_MID + 150);
  }

  // The one visual primitive: staggered flips with the mark landing at
  // the half-turn (Cycle's — `.reveal` never comes off at mid-turn; a
  // landed reveal restarts via remove → reflow → add).
  function flipRow(rowIdx, marks, startAt) {
    var row = rowEls[rowIdx];
    for (var c = 0; c < WL; c++) {
      var t = row.children[c];
      setTimeout(function (tile) {
        tile.classList.remove("reveal");
        void tile.offsetWidth;
        tile.classList.add("reveal");
      }, startAt + c * FLIP_STAGGER, t);
      setTimeout(function (tile, mark) {
        tile.classList.remove("filled", "correct", "present", "absent");
        tile.classList.add(mark);
      }, startAt + c * FLIP_STAGGER + FLIP_MID, t, marks[c]);
    }
  }

  function finish(r, word, marks) {
    guesses.push(word);
    var shown = displayWord(r, word);
    for (var c = 0; c < WL; c++) paintKey(shown.charAt(c), marks[c]);
    var allGreen = true;
    for (c = 0; c < WL; c++) if (marks[c] !== "correct") allGreen = false;

    if (allGreen) {
      done = true;
      won = true;
      markWin(rowEls[r]);
      shareBtn.classList.remove("hidden");
    } else if (guesses.length === ROWS) {
      done = true; // six deals, no greens — the loss
      shareBtn.classList.remove("hidden");
    } else {
      activeRow().classList.add("on-row");
    }
    updateActions();
    saveState();
    revealing = false;
  }

  function markWin(row) {
    if (!row) return;
    for (var c = 0; c < WL; c++) row.children[c].classList.add("win-glow");
  }

  function giveUp() {
    if (done || revealing) return;
    typed = Array(WL).fill("");
    paintEntry();
    retireRow(guesses.length);
    done = true;
    gaveUp = true;
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
    if (!key || !mark) return;
    var current = key.dataset.state || "";
    if (RANK[mark] > (RANK[current] || 0)) {
      if (current) key.classList.remove(current);
      key.classList.add(mark);
      key.dataset.state = mark;
    }
  }

  // ---------- feedback ----------

  function reject(msg) {
    toast(msg);
    entryEl.classList.remove("shake");
    void entryEl.offsetWidth; // restart the animation
    entryEl.classList.add("shake");
    entryEl.addEventListener("animationend", function h(ev) {
      if (ev.animationName !== "shake") return;
      entryEl.classList.remove("shake");
      entryEl.removeEventListener("animationend", h);
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
    var n = guesses.length;
    var state = won ? n + "/" + ROWS
      : (gaveUp ? "gave up \u00B7 " + n + "/" + ROWS : "X/" + ROWS);
    var title = ["Scramble", practice ? "practice" : todayKey(), state]
      .join(" \u00B7 ");
    var lines = [title, GAME_URL];
    guesses.forEach(function (w, r) {
      var marks = evaluate(displayWord(r, w), answer);
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
  window.SCRAMBLE = {
    daily: init,
    practice: startPractice,
    todayKey: todayKey,
    answerFor: answerFor,
    scramble: scramble,
    evaluate: evaluate,
    perms: function () {
      return perms.map(function (p) { return p.slice(); });
    },
    ROWS: ROWS,
    tile: function (r, c) { return rowEls[r].children[c]; },
    dump: function () {
      return {
        answer: answer,
        perms: perms.map(function (p) { return p.slice(); }),
        guesses: guesses.slice(),
        typed: typed.join(""),
        rows: guesses.map(function (w, r) { return displayWord(r, w); }),
        practice: practice,
        done: done,
        won: won,
        gaveUp: gaveUp,
        save: loadSaved()
      };
    }
  };
})();
