// Peddle — Day 16 variant of 30 Wordles.
// One puzzle per day: the answer derives from the calendar date and
// progress is saved to localStorage, so a refresh resumes the same game.
// Practice mode plays a random word without touching the daily save.
//
// A Wordle where information costs money. You start with $120 and there
// is no guess limit — only a financial one. Every letter charges as you
// type (common letters are the expensive ones), backspace refunds it.
// When a guess resolves, clues pay back — once each: the first time a
// letter shows yellow it refunds $10; the first time it shows green it
// refunds $15 and the letter is FREE in every later guess. Gray pays
// nothing. The price chart above the board lights up as letters are
// clued in, and each guess row carries a price chip (gross while it
// flips, net after the refunds land).
//
// The one loss is bankruptcy: if the bank can't cover the cheapest way
// to complete the word on the board — or the cheapest word in the
// dictionary on an empty row — the game ends mid-guess, half-typed
// letters and all. A prefix no dictionary word extends is a typo, not a
// bankruptcy: backspace out. Give up refunds the unsubmitted word.
//
// The bank is saved explicitly (like Hustle's clock) rather than
// replayed from the guesses: money debits while typing, and a mid-guess
// bankruptcy debits it into letters that were never submitted, so
// guesses alone can't reproduce the balance.
(function () {
  "use strict";

  var COLS = 5;
  var SALT = "peddle"; // daily hash salt — each variant salts its own way
  var FLIP_STAGGER = 280; // ms between tile flips
  var FLIP_MID = 270;     // half-turn point: the score color appears here
  var STORE_KEY = "peddle-day16";
  var GAME_URL = "https://suitangi.github.io/30Wordles/days/16";
  var START_MONEY = 120;
  var COST_YELLOW = 10; // first yellow discovery
  var COST_GREEN = 15;  // first green discovery — the letter goes free
  var PRAISE = ["Genius", "Magnificent", "Impressive", "Splendid", "Great",
    "Phew"];
  var OPEN_BANNER = "Every letter has a price";

  // Priced by likelihood, not rarity: common letters cost the most
  // because they're the safe bets; rare letters are cheap gambles.
  var TIERS = [
    { price: 10, letters: "eariotns" },
    { price: 6, letters: "lcudpmhg" },
    { price: 4, letters: "bfywkv" },
    { price: 2, letters: "jxqz" }
  ];
  var COST = {};
  TIERS.forEach(function (tier) {
    tier.letters.split("").forEach(function (ch) { COST[ch] = tier.price; });
  });

  var ANSWERS = window.WORD_LISTS.answers;
  var GUESS_WORDS = window.WORD_LISTS.guesses;
  var DICTIONARY = new Set(GUESS_WORDS);

  var boardEl = document.getElementById("board");
  var chartEl = document.getElementById("chart");
  var moneyAmountEl = document.getElementById("money-amount");
  var keyboardEl = document.getElementById("keyboard");
  var bannerEl = document.getElementById("banner");
  var toastEl = document.getElementById("toast");
  var newBtn = document.getElementById("new-btn");
  var giveUpBtn = document.getElementById("giveup-btn");
  var shareBtn = document.getElementById("share-btn");

  var answer = "";
  var bank = START_MONEY; // the truth; debits land as letters are typed
  var paid = 0;           // what the current half-typed word has cost
  var done = false;
  var won = false;
  var gaveUp = false;
  var revealing = false;
  var practice = false;
  var quietRows = false; // restore flag: rebuilt rows skip enter animations
  var guesses = [];      // plain words
  var typed = [];        // the active row's letters
  var freed = {};        // green-discovered letters: free forever
  var yellowSeen = {};   // letters that already paid out their yellow $10
  var dead = {};         // letters proven absent (dimmed on the chart)
  var rowEls = [];       // rowEls[r] — .prow of five tiles + price chip
  var priceEls = [];     // priceEls[r] — that row's price chip
  var chipEls = {};      // letter -> chart chip
  var keyEls = {};       // letter -> key button
  var toastTimer = null;

  // ---------- the economy ----------

  function costOf(ch) { return freed[ch] ? 0 : COST[ch]; }

  function wordCost(word) {
    var total = 0;
    for (var i = 0; i < word.length; i++) total += costOf(word.charAt(i));
    return total;
  }

  // Cheapest completion from a prefix: the least, over dictionary words
  // starting with `prefix`, of what the remaining letters would cost.
  // Infinity when no word extends the prefix — a dead row is a typo,
  // not a bankruptcy.
  function minRemaining(prefix) {
    var best = Infinity;
    for (var i = 0; i < GUESS_WORDS.length; i++) {
      var w = GUESS_WORDS[i];
      if (prefix && w.lastIndexOf(prefix, 0) !== 0) continue;
      var cost = 0;
      for (var j = prefix.length; j < w.length; j++) {
        var ch = w.charAt(j);
        if (!freed[ch]) cost += COST[ch];
      }
      if (cost < best) best = cost;
      if (best === 0) break;
    }
    return best;
  }

  // Bankrupt now? The typed row must still be completable by SOME word
  // (otherwise it's a typo — backspace, don't bury) and the bank must
  // not cover its cheapest completion. On an empty row that same test
  // reads "can't afford the cheapest word in the dictionary".
  // Backspacing can never newly trip this: the bank at any prefix is
  // committed − cost(typed), and erasing only widens the set of
  // completions, lowering the minimum back.
  function bankruptNow() {
    var mr = minRemaining(typed.join(""));
    return mr !== Infinity && bank < mr;
  }

  // Pure replay of resolved guesses (the tests use it; restore walks
  // the same rules incrementally). Starts from a full $120 and no
  // knowledge, so `bank` is the between-guesses balance.
  function replay(guessList, answerStr) {
    var f = {}, y = {}, d = {}, b = START_MONEY, rows = [];
    guessList.forEach(function (w) {
      var marks = evaluate(w, answerStr);
      var gross = 0, refund = 0, c, ch;
      for (c = 0; c < COLS; c++) {
        ch = w.charAt(c);
        if (!f[ch]) gross += COST[ch];
      }
      for (c = 0; c < COLS; c++) {
        if (marks[c] === "correct") {
          ch = w.charAt(c);
          if (!f[ch]) { f[ch] = true; refund += COST_GREEN; }
        }
      }
      for (c = 0; c < COLS; c++) {
        if (marks[c] === "present") {
          ch = w.charAt(c);
          if (!f[ch] && !y[ch]) { y[ch] = true; refund += COST_YELLOW; }
        }
      }
      for (c = 0; c < COLS; c++) {
        ch = w.charAt(c);
        if (answerStr.indexOf(ch) < 0) d[ch] = true;
      }
      b += refund - gross;
      rows.push({ w: w, gross: gross, refund: refund, net: gross - refund });
    });
    var keys = function (o) { return Object.keys(o).sort(); };
    return { bank: b, freed: keys(f), yellow: keys(y), dead: keys(d), rows: rows };
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
    if (typeof saved.bank !== "number" || !isFinite(saved.bank) ||
      saved.bank < 0 || saved.bank > 1000) {
      return false;
    }
    return Array.isArray(saved.guesses) && saved.guesses.every(validAnswer);
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
        bank: bank,
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
    bank = START_MONEY;
    paid = 0;
    guesses = [];
    typed = Array(COLS).fill("");
    freed = {};
    yellowSeen = {};
    dead = {};
    rowEls = [];
    priceEls = [];

    boardEl.innerHTML = "";
    boardEl.classList.remove("overflowing");
    bannerEl.classList.remove("show");
    bannerEl.textContent = "";
    shareBtn.classList.add("hidden");
    updateActions();

    buildChart();
    updateMoney();
    addRow();
    buildKeyboard();
  }

  // Rows are built on demand — the bankroll lasts as long as it lasts.
  // Each row carries a price chip: gross while the guess flips, net
  // after the refunds land.
  function addRow() {
    var row = document.createElement("div");
    row.className = quietRows ? "prow quiet" : "prow";
    for (var c = 0; c < COLS; c++) {
      var tile = document.createElement("div");
      tile.className = "tile";
      row.appendChild(tile);
    }
    var price = document.createElement("div");
    price.className = "price";
    row.appendChild(price);
    boardEl.appendChild(row);
    rowEls.push(row);
    priceEls.push(price);
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

  // The price chart: four tiers, one chip per letter. Chips light up as
  // the game clues them in — yellow wash on a first yellow, green and
  // "free" on a green discovery, dimmed with a struck price once the
  // letter is proven absent.
  function buildChart() {
    chartEl.innerHTML = "";
    chipEls = {};
    TIERS.forEach(function (tier) {
      var row = document.createElement("div");
      row.className = "chart-row";
      var label = document.createElement("span");
      label.className = "chart-tier";
      label.textContent = "$" + tier.price;
      row.appendChild(label);
      tier.letters.split("").forEach(function (ch) {
        var chip = document.createElement("span");
        chip.className = "chip";
        var letter = document.createElement("b");
        letter.textContent = ch.toUpperCase();
        var price = document.createElement("i");
        price.textContent = "$" + tier.price;
        chip.appendChild(letter);
        chip.appendChild(price);
        row.appendChild(chip);
        chipEls[ch] = chip;
      });
      chartEl.appendChild(row);
    });
  }

  function paintChart() {
    Object.keys(chipEls).forEach(function (ch) {
      var chip = chipEls[ch];
      var price = chip.children[1];
      chip.classList.remove("hit-y", "hit-g", "dead");
      if (freed[ch]) {
        chip.classList.add("hit-g");
        price.textContent = "free";
      } else if (yellowSeen[ch]) {
        chip.classList.add("hit-y");
      } else if (dead[ch]) {
        chip.classList.add("dead");
      }
    });
  }

  function updateMoney() {
    moneyAmountEl.textContent = "$" + bank;
    moneyAmountEl.classList.toggle("done", done && won);
  }

  // The price of the guess IN PROGRESS rides the waiting row's chip, so
  // the cost is always next to the word being typed — it settles to net
  // at finish like any played guess.
  function updatePendingPrice() {
    var price = priceEls[guesses.length];
    if (price) price.textContent = paid > 0 ? "\u2212$" + paid : "";
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
      restore(saved); // also takes saved.bank as the balance
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
  // are pure evaluate, so rows repaint directly; the economy re-walks
  // guess by guess (freed/yellow evolving) so every chip lands on its
  // final net price and the chart lights up as clued.
  function restore(saved) {
    guesses = [];
    saved.guesses.forEach(function (w) {
      var row = rowEls[guesses.length] || addRow();
      var marks = evaluate(w, answer);
      var gross = 0, refund = 0, c, ch;
      for (c = 0; c < COLS; c++) {
        ch = w.charAt(c);
        if (!freed[ch]) gross += COST[ch];
      }
      for (c = 0; c < COLS; c++) {
        ch = w.charAt(c);
        var t = row.children[c];
        t.textContent = ch;
        t.classList.add("filled", marks[c]);
        paintKey(ch, marks[c]);
        if (marks[c] === "correct" && !freed[ch]) {
          freed[ch] = true;
          refund += COST_GREEN;
        }
      }
      for (c = 0; c < COLS; c++) {
        if (marks[c] === "present") {
          ch = w.charAt(c);
          if (!freed[ch] && !yellowSeen[ch]) {
            yellowSeen[ch] = true;
            refund += COST_YELLOW;
          }
        }
      }
      for (c = 0; c < COLS; c++) {
        ch = w.charAt(c);
        if (answer.indexOf(ch) < 0) dead[ch] = true;
      }
      var net = gross - refund;
      var price = priceEls[guesses.length];
      price.textContent = priceText(net);
      price.classList.toggle("gain", net < 0);
      guesses.push(w);
    });

    bank = saved.bank;
    paintChart();
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
      if (bankruptNow()) bankruptcy(); // a seeded save can start broke
    }
    updateMoney();
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
        var cost = costOf(ch);
        if (bank < cost) {
          toast(ch.toUpperCase() + " costs $" + cost + " \u2014 you have $" + bank);
          return;
        }
        typed[c] = ch;
        bank -= cost;
        paid += cost;
        row.children[c].textContent = ch;
        row.children[c].classList.add("filled");
        updateMoney();
        updatePendingPrice();
        if (bankruptNow()) bankruptcy();
        return;
      }
    }
  }

  // Backspace refunds the letter's cost — money returns, the row shortens.
  // No bankruptcy check here by design: erasing can never newly trip it.
  function erase() {
    var row = activeRow();
    for (var c = COLS - 1; c >= 0; c--) {
      if (typed[c]) {
        var cost = costOf(typed[c]);
        bank += cost;
        paid -= cost;
        typed[c] = "";
        row.children[c].textContent = "";
        row.children[c].classList.remove("filled");
        updateMoney();
        updatePendingPrice();
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

  function priceText(net) {
    if (net > 0) return "\u2212$" + net;
    if (net < 0) return "+$" + (-net);
    return "$0";
  }

  function pulse(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth; // restart the animation
    el.classList.add(cls);
  }

  function submit() {
    var guess = typed.join("");
    if (guess.length < COLS) { reject("Not enough letters"); return; }
    if (!DICTIONARY.has(guess)) { reject("Not in word list"); return; }

    revealing = true;
    var rowIdx = guesses.length;
    var marks = evaluate(guess, answer);
    var gross = paid; // what typing this word already cost
    var price = priceEls[rowIdx];
    price.textContent = priceText(gross);
    pulse(price, "settle");
    // A rejected attempt leaves `shake` behind; equal specificity, defined
    // after .reveal, it would override the flip — clear it first.
    Array.prototype.forEach.call(rowEls[rowIdx].children, function (t) {
      t.classList.remove("shake");
    });
    marks.forEach(function (mark, c) {
      var t = rowEls[rowIdx].children[c];
      setTimeout(function () { t.classList.add("reveal"); },
        100 + c * FLIP_STAGGER);
      setTimeout(function () {
        t.classList.remove("filled");
        t.classList.add(mark);
      }, 100 + c * FLIP_STAGGER + FLIP_MID);
    });
    setTimeout(function () { finish(rowIdx, guess, marks, gross); },
      100 + (COLS - 1) * FLIP_STAGGER + FLIP_MID + 150);
  }

  function finish(rowIdx, guess, marks, gross) {
    typed = Array(COLS).fill("");
    var refund = 0;
    var c, ch;
    // Green discoveries first: a letter found green this guess earns the
    // green refund and goes free — its yellow tiles (same guess) earn
    // nothing on top. Earlier yellows don't block the green payout.
    for (c = 0; c < COLS; c++) {
      if (marks[c] === "correct") {
        ch = guess.charAt(c);
        if (!freed[ch]) { freed[ch] = true; refund += COST_GREEN; }
      }
    }
    for (c = 0; c < COLS; c++) {
      if (marks[c] === "present") {
        ch = guess.charAt(c);
        if (!freed[ch] && !yellowSeen[ch]) {
          yellowSeen[ch] = true;
          refund += COST_YELLOW;
        }
      }
    }
    for (c = 0; c < COLS; c++) {
      ch = guess.charAt(c);
      if (answer.indexOf(ch) < 0) dead[ch] = true;
    }
    bank += refund;
    paid = 0;
    guesses.push(guess);

    var net = gross - refund;
    var price = priceEls[rowIdx];
    price.textContent = priceText(net);
    price.classList.toggle("gain", net < 0);
    pulse(price, "settle");
    if (refund > 0) pulse(moneyAmountEl, "bump");

    var allGreen = true;
    for (c = 0; c < COLS; c++) {
      paintKey(guess.charAt(c), marks[c]);
      if (marks[c] !== "correct") allGreen = false;
    }

    paintChart();

    if (allGreen) {
      done = true;
      won = true;
      markWin(rowEls[rowIdx]);
      showBanner(endBanner());
      shareBtn.classList.remove("hidden");
    } else if (bankruptNow()) {
      bankruptcy();
    } else {
      addRow();
    }
    // After the end-state flags: the balance wears its win accent here.
    updateMoney();
    updateActions();
    saveState();
    revealing = false;
  }

  // The one loss the game deals itself: the bank can't complete any word.
  // The half-typed letters stay on the board — that's how it ended.
  function bankruptcy() {
    done = true;
    showBanner("Bankrupt \u2014 the word was " + answer.toUpperCase());
    shareBtn.classList.remove("hidden");
    updateActions();
    saveState();
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
    if (gaveUp) return "The word was " + answer.toUpperCase();
    return "Bankrupt \u2014 the word was " + answer.toUpperCase();
  }

  // Give up: the unsubmitted word wasn't played, so its letters refund —
  // the bank freezes at what the played guesses actually cost.
  function giveUp() {
    if (done || revealing) return;
    while (typed.join("").length > 0) erase();
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
    var guessesTag = n + (n === 1 ? " guess" : " guesses");
    var state = won ? guessesTag
      : (gaveUp ? "gave up \u00B7 " + guessesTag
        : "bankrupt \u00B7 " + guessesTag);
    var title = ["Peddle", practice ? "practice" : todayKey(), state,
      "$" + bank + " left"].join(" \u00B7 ");
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
  window.PEDDLE = {
    daily: init,
    practice: startPractice,
    todayKey: todayKey,
    answerFor: answerFor,
    evaluate: evaluate,
    costOf: function (ch) { return costOf(ch); },
    wordCost: function (w) { return wordCost(w); },
    minRemaining: function (prefix) { return minRemaining(prefix); },
    replay: replay,
    dump: function () {
      var keys = function (o) { return Object.keys(o).sort(); };
      return {
        answer: answer,
        bank: bank,
        paid: paid,
        typed: typed.join(""),
        guesses: guesses.slice(),
        freed: keys(freed),
        yellow: keys(yellowSeen),
        dead: keys(dead),
        practice: practice,
        done: done,
        won: won,
        gaveUp: gaveUp,
        save: loadSaved()
      };
    }
  };
})();
