// Headless tests for js/peddle.js. Loads the real game script against a
// minimal DOM stub and drives full games through the keyboard handler.
// Run: node tests/peddle.test.js
"use strict";

const assert = require("assert/strict");
const path = require("path");

// ---------- minimal DOM / browser stubs (before loading the game) ----------

const timers = [];
globalThis.setTimeout = (fn) => { timers.push(fn); return timers.length; };
globalThis.clearTimeout = () => {};
function runTimers() { while (timers.length) timers.shift()(); }

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

function makeEl(tag) {
  const el = {
    tagName: tag,
    children: [],
    textContent: "",
    value: "",
    dataset: {},
    style: { setProperty(k, v) { this[k] = v; } },
    scrollTop: 0,
    scrollHeight: 0,
    clientHeight: 0,
    offsetTop: 0,
    offsetHeight: 0,
    offsetWidth: 0,
    type: "",
    _handlers: {},
    appendChild(child) { this.children.push(child); return child; },
    removeChild(child) {
      this.children = this.children.filter((c) => c !== child);
      return child;
    },
    addEventListener(t, fn) { (this._handlers[t] ||= []).push(fn); },
    removeEventListener() {},
    setAttribute() {},
    select() {},
    remove() {},
    blur() {},
    click() { (this._handlers.click || []).forEach((fn) => fn()); },
  };
  const classes = new Set();
  Object.defineProperty(el, "classList", {
    value: {
      add: (...cs) => cs.forEach((c) => classes.add(c)),
      remove: (...cs) => cs.forEach((c) => classes.delete(c)),
      contains: (c) => classes.has(c),
      toggle: (c, force) => {
        if (force === undefined) classes.has(c) ? classes.delete(c) : classes.add(c);
        else force ? classes.add(c) : classes.delete(c);
      },
    },
  });
  Object.defineProperty(el, "className", {
    get: () => [...classes].join(" "),
    set: (v) => {
      classes.clear();
      String(v).split(/\s+/).filter(Boolean).forEach((c) => classes.add(c));
    },
  });
  Object.defineProperty(el, "innerHTML", {
    get: () => "",
    set: () => { el.children = []; },
  });
  return el;
}

const byId = {};
["board", "chart", "money-amount", "keyboard", "banner", "toast",
  "new-btn", "giveup-btn", "share-btn"].forEach((id) => {
  byId[id] = makeEl("div");
});
const createdEls = [];

globalThis.window = globalThis;
const windowHandlers = {};
globalThis.addEventListener = (t, fn) => { (windowHandlers[t] ||= []).push(fn); };
globalThis.document = {
  documentElement: { dataset: {} },
  body: makeEl("body"),
  getElementById: (id) => byId[id],
  createElement: (tag) => { const el = makeEl(tag); createdEls.push(el); return el; },
  execCommand: () => true,
};

// ---------- load real game code ----------

require(path.join(__dirname, "..", "js", "words.js"));
const { WORD_LISTS } = globalThis.window;
assert.ok(WORD_LISTS, "words.js must define window.WORD_LISTS");
const ANSWERS = WORD_LISTS.answers;
const DICT = new Set(WORD_LISTS.guesses);
const WORDS = WORD_LISTS.guesses;
const GAME_URL = "https://suitangi.github.io/30Wordles/days/16";

require(path.join(__dirname, "..", "js", "peddle.js"));
const PEDDLE = globalThis.PEDDLE;
assert.ok(PEDDLE, "peddle.js must expose window.PEDDLE");

const board = byId.board;
const chart = byId.chart;
const moneyAmount = byId["money-amount"];
const banner = byId.banner;
const toast = byId.toast;
const newBtn = byId["new-btn"];
const giveUpBtn = byId["giveup-btn"];
const shareBtn = byId["share-btn"];
const keydown = (key) =>
  (windowHandlers.keydown || []).forEach((fn) =>
    fn({ key, metaKey: false, ctrlKey: false, altKey: false }));

const keyFor = (letter) => {
  for (const row of byId.keyboard.children) {
    const k = row.children.find((b) => b.textContent === letter);
    if (k) return k;
  }
  return null;
};
const rowTiles = (r) => board.children[r].children;
const priceChip = (r) => board.children[r].children[5];
const readSave = () => JSON.parse(globalThis.localStorage.getItem("peddle-day16"));

// Type a word and submit it, playing out the whole reveal.
function typeRow(word) {
  for (const ch of word) keydown(ch);
  keydown("Enter");
  runTimers();
}

function dailyGame() {
  PEDDLE.daily();
}

function seedDaily(answer, guesses = [], extra = {}) {
  globalThis.localStorage.setItem("peddle-day16", JSON.stringify({
    date: PEDDLE.todayKey(), answer, bank: 120, guesses, done: false, won: false,
    gaveUp: false, ...extra,
  }));
  dailyGame();
}

// ---------- independent economy model (the test's own truth) ----------------

// Rebuilt from the spec, not from peddle.js: common eariotns $10,
// mid lcudpmhg $6, uncommon bfywkv $4, rare jxqz $2.
const TIER_TABLE = [
  [10, "eariotns"], [6, "lcudpmhg"], [4, "bfywkv"], [2, "jxqz"],
];
const COST = {};
for (const [price, letters] of TIER_TABLE) {
  for (const ch of letters) COST[ch] = price;
}
const cost = (w, freed = {}) =>
  [...w].reduce((sum, ch) => sum + (freed[ch] ? 0 : COST[ch]), 0);

// Cheapest completion from a prefix, by brute force over the dictionary.
function bruteMR(prefix, freed = {}) {
  let best = Infinity;
  for (const w of WORDS) {
    if (prefix && !w.startsWith(prefix)) continue;
    let c = 0;
    for (let j = prefix.length; j < w.length; j++) {
      if (!freed[w[j]]) c += COST[w[j]];
    }
    if (c < best) best = c;
  }
  return best;
}

const M = (marksStr) => marksStr.split("").map((ch) => ({ K: "correct", P: "present", A: "absent" }[ch]));
const K = "correct", P = "present", A = "absent";
const OPEN_BANNER = "Every letter has a price";

// A row is 5 tiles + the price chip; tiles are children 0-4.
const tiles = (r) => rowTiles(r).slice(0, 5);

// The chart chip for a letter, found via the same tier table as above.
const BANDS = [[10, "eariotns"], [6, "lcudpmhg"], [4, "bfywkv"], [2, "jxqz"]];
function chipOf(ch) {
  const t = BANDS.findIndex(([, letters]) => letters.includes(ch));
  return chart.children[t].children[1 + [...BANDS[t][1]].indexOf(ch)];
}

// ---------- 1. word list sanity ----------

assert.equal(ANSWERS.length, 2315, "answers count");
assert.equal(DICT.size, 14855, "guessable count");
for (const w of ANSWERS) {
  assert.match(w, /^[a-z]{5}$/, `answer "${w}" shape`);
  assert.ok(DICT.has(w), `answer "${w}" must be guessable`);
}
for (const w of ["crane", "range", "hoist", "cramp", "theme", "fuzzy"]) {
  assert.ok(DICT.has(w), `test word "${w}" is guessable`);
}
console.log("ok — word lists (2315 answers, 14855 guessable, test words present)");

// ---------- 2. the price list: every letter priced, freed letters free ------

const allLetters = TIER_TABLE.flatMap(([, letters]) => letters.split("")).sort().join("");
assert.equal(allLetters, "abcdefghijklmnopqrstuvwxyz", "tiers cover the alphabet");
assert.equal(COST.e, 10, "e is common: $10");
assert.equal(COST.l, 6, "l is mid: $6");
assert.equal(COST.b, 4, "b is uncommon: $4");
assert.equal(COST.j, 2, "j is rare: $2");
assert.equal(PEDDLE.wordCost("crane"), 46, "crane costs 6+10+10+10+10");
assert.equal(PEDDLE.wordCost("fuzzy"), 18, "fuzzy is a cheap gamble");
// minRemaining matches the brute force while the board's freed set is empty.
for (const p of ["", "f", "fu", "fuz", "cr", "qua", "zz", "fuzzy"]) {
  assert.equal(PEDDLE.minRemaining(p), bruteMR(p), `minRemaining("${p}")`);
}
assert.equal(bruteMR("fuzx"), Infinity, "sanity: no word starts fuzx");
assert.equal(PEDDLE.minRemaining("fuzx"), Infinity, "dead prefixes are Infinity");
assert.ok(bruteMR("") >= 12, "the cheapest word still costs real money");
console.log(`ok — price list: 26 letters, crane $${cost("crane")}, cheapest word $${bruteMR("")}`);

// ---------- 3. evaluate: standard Wordle two-pass, duplicates included ------

assert.deepEqual(PEDDLE.evaluate("crane", "crane"), M("KKKKK"), "exact match");
assert.deepEqual(PEDDLE.evaluate("eerie", "erase"), M("KAPAK"),
  "repeated letters: greens first, strays consume target copies in order");
console.log("ok — evaluate: two-pass, duplicates handled");

// ---------- 4. replay: the pure economy --------------------------------------

{
  const r = PEDDLE.replay(["crane"], "crane");
  assert.equal(r.bank, 120 - 46 + 75, "a first-guess win pays five green refunds");
  assert.deepEqual(r.freed, ["a", "c", "e", "n", "r"], "all five letters freed");

  const r2 = PEDDLE.replay(["range"], "crane");
  assert.equal(r2.rows[0].gross, 46, "range gross");
  assert.equal(r2.rows[0].refund, 45, "e green $15 + r,a,n yellow $30");
  assert.equal(r2.rows[0].net, 1, "range nets +$1 of cost");
  assert.equal(r2.bank, 119, "bank after range");
  assert.deepEqual(r2.freed, ["e"], "only e freed");
  assert.deepEqual(r2.yellow, ["a", "n", "r"], "r,a,n discovered yellow");
  assert.deepEqual(r2.dead, ["g"], "g proven absent");

  // the same letter may pay yellow first and green later
  const r3 = PEDDLE.replay(["range", "crane"], "crane");
  assert.equal(r3.rows[1].gross, 36, "freed e is free; r,a,n still cost after yellow");
  assert.equal(r3.rows[1].refund, 60, "c,r,a,n first greens pay $15 each; e earns nothing");
  assert.equal(r3.rows[1].net, -24, "the winning guess turned a profit");
  assert.equal(r3.bank, 120 - 46 + 45 - 36 + 60, "bank arithmetic end to end");

  // gray pays nothing, ever
  const r4 = PEDDLE.replay(["range", "hoist", "hoist"], "crane");
  assert.equal(r4.rows[1].refund, 0, "all-gray hoist refunds nothing");
  assert.equal(r4.rows[2].refund, 0, "repeating it refunds nothing again");
  assert.equal(r4.bank, 120 - 46 + 45 - 46 - 46, "grays are pure expense");
  assert.deepEqual(r4.dead.sort(), ["g", "h", "i", "o", "s", "t"], "dead letters recorded");
}
console.log("ok — replay: refunds once per discovery, greens supersede, grays pay nothing");

// ---------- 5. fresh daily: bank, chart, one waiting row ----------------------

store.clear();
dailyGame();

const freshAnswer = PEDDLE.answerFor(PEDDLE.todayKey());
assert.equal(board.children.length, 1, "one waiting row");
assert.equal(moneyAmount.textContent, "$120", "the bankroll opens at $120");
assert.equal(priceChip(0).textContent, "", "no price in play yet");
assert.equal(chart.children.length, 4, "four tier bands");
assert.deepEqual([...chart.children].map((row) => row.children[0].textContent),
  ["$10", "$6", "$4", "$2"], "tier labels carry the prices");
assert.deepEqual([...chart.children].map((row) => row.children.length - 1),
  [8, 8, 6, 4], "eight common, eight mid, six uncommon, four rare");
assert.deepEqual([...chart.children[0].children].slice(1).map((c) => c.children[0].textContent),
  ["E", "A", "R", "I", "O", "T", "N", "S"], "common band reads EAIONRST's letters");
assert.equal(chart.children[0].children[1].children[1].textContent, "$10", "chip shows its price");
assert.equal(banner.textContent, OPEN_BANNER, "the game is announced");
assert.ok(!giveUpBtn.classList.contains("hidden"), "give up offered on a fresh board");
assert.ok(shareBtn.classList.contains("hidden"), "no share before an end state");

const freshSave = readSave();
assert.equal(freshSave.date, PEDDLE.todayKey(), "save stamped with today");
assert.equal(freshSave.answer, freshAnswer, "daily answer is date-derived");
assert.equal(freshSave.bank, 120, "save carries the bank");
assert.deepEqual(freshSave.guesses, [], "no guesses yet");
console.log(`ok — fresh daily: ${freshSave.date}, answer ${freshAnswer}, $120 bank, chart priced`);

// ---------- 6. the full win: five greens that pay for themselves --------------

PEDDLE.practice("crane");
typeRow("crane");
{
  assert.deepEqual([...tiles(0)].map((t) => t.classList.contains("correct")),
    [true, true, true, true, true], "five greens");
  assert.equal(priceChip(0).textContent, "+$29", "gross $46 minus five green refunds $75");
  assert.ok(priceChip(0).classList.contains("gain"), "a profitable guess reads as gain");
  assert.equal(moneyAmount.textContent, "$149", "the bank grew past its opening $120");
  assert.ok(moneyAmount.classList.contains("done"), "the balance wears its win accent");
  assert.equal(banner.textContent, "Genius — 1 guess", "praised by the count");
  assert.ok(!shareBtn.classList.contains("hidden"), "share appears on the win");
  assert.ok(giveUpBtn.classList.contains("hidden"), "give up retires");
  for (const t of tiles(0)) assert.ok(t.classList.contains("win-glow"), "the win glows");
  assert.ok(!priceChip(0).classList.contains("win-glow"), "the price chip is not a tile");
  for (const ch of "crane") {
    assert.ok(keyFor(ch).classList.contains("correct"), `${ch} key green`);
    assert.ok(chipOf(ch).classList.contains("hit-g"), `${ch} chip lit green`);
    assert.equal(chipOf(ch).children[1].textContent, "free", `${ch} now reads free`);
  }
  keydown("a");
  assert.equal(PEDDLE.dump().guesses.length, 1, "board locked after the win");
}

shareBtn.click();
{
  const ta = createdEls.filter((e) => e.tagName === "textarea").pop();
  const lines = ta.value.split("\n");
  assert.equal(lines[0], "Peddle · practice · 1 guess · $149 left", "share carries the bank");
  assert.equal(lines[1], GAME_URL, "share links to the game");
  assert.equal(lines[2], "\uD83D\uDFE9".repeat(5), "a standard green row");
}
console.log("ok — the win: $46 of letters, $75 of first-green refunds, share carries the bank");

// ---------- 7. yellow and gray economy, gross→net chip, chart lighting -------

PEDDLE.practice("crane");
for (const ch of "range") keydown(ch);
keydown("Enter");
assert.equal(priceChip(0).textContent, "\u2212$46", "the chip opens at gross while the flip runs");
runTimers();
{
  assert.equal(PEDDLE.evaluate("range", "crane")[4], K, "range's green lands on e");
  assert.equal(priceChip(0).textContent, "\u2212$1", "settles to net: $46 gross, $45 back");
  assert.ok(!priceChip(0).classList.contains("gain"), "a $1 cost is not a gain");
  assert.equal(moneyAmount.textContent, "$119", "bank after range");
  assert.ok(chipOf("e").classList.contains("hit-g"), "e lit green");
  assert.equal(chipOf("e").children[1].textContent, "free", "e is free");
  for (const ch of "ran") assert.ok(chipOf(ch).classList.contains("hit-y"), `${ch} lit yellow`);
  assert.ok(chipOf("g").classList.contains("dead"), "g dimmed as dead");
  assert.ok(keyFor("e").classList.contains("correct"), "keyboard heard the green");
  assert.ok(keyFor("r").classList.contains("present"), "keyboard heard the yellow");
  assert.ok(keyFor("g").classList.contains("absent"), "keyboard heard the gray");
}

typeRow("hoist");
{
  assert.equal(priceChip(1).textContent, "\u2212$46", "an all-gray guess refunds nothing");
  assert.equal(moneyAmount.textContent, "$73", "grays are pure expense");
  assert.ok(chipOf("s").classList.contains("dead"), "s joined the dead");
}

// r,a,n were only YELLOW — they still cost full price; their first GREEN
// discovery pays the $15 the yellow never blocked.
typeRow("crane");
{
  assert.equal(priceChip(2).textContent, "+$24", "$36 of letters, $60 of first-green refunds");
  assert.ok(priceChip(2).classList.contains("gain"), "the winning guess profited");
  assert.equal(moneyAmount.textContent, "$97", "bank arithmetic across three guesses");
  assert.equal(banner.textContent, "Impressive — 3 guesses", "praised by the count");
  for (const ch of "ran") {
    assert.ok(chipOf(ch).classList.contains("hit-g"),
      `${ch} upgraded from yellow-lit to green-lit`);
  }
}
console.log("ok — yellow/gray economy: chip opens gross and settles net; yellows still cost");

// ---------- 8. freed letters are free, backspace refunds ----------------------

PEDDLE.practice("crane");
typeRow("range"); // e freed, bank 119
for (const ch of "them") keydown(ch);
{
  assert.equal(priceChip(1).textContent, "\u2212$22", "the running tab rides the pending row, freed e at $0");
  assert.equal(moneyAmount.textContent, "$97", "the bank shows the typed money gone");
  keydown("Backspace"); // drop the m
  assert.equal(priceChip(1).textContent, "\u2212$16", "backspace refunds the letter");
  assert.equal(moneyAmount.textContent, "$103", "the money came back");
  keydown("m"); // re-type it: still $6
  keydown("e"); // the freed one: $0
  assert.equal(priceChip(1).textContent, "\u2212$22", "five letters bought for $22");
  assert.equal(PEDDLE.dump().typed, "theme", "the word assembled");
  keydown("Enter");
  runTimers();
  assert.deepEqual(PEDDLE.evaluate("theme", "crane"), M("AAAAK"),
    "theme marks: the twin e took the green, so the mid-word e is absent");
  assert.equal(priceChip(1).textContent, "\u2212$22", "the chip agrees: two e's were free");
  assert.equal(moneyAmount.textContent, "$97", "bank after theme");
  assert.equal(PEDDLE.dump().freed.join(""), "e", "e is the only freed letter");
  assert.equal(PEDDLE.dump().yellow.join(""), "anr", "no new yellows: freed letters earn nothing");
}
console.log("ok — freed letters ride free; backspace refunds; theme bought for $22");

// ---------- 9. the afford block: a letter you can't pay for ------------------
// Built dynamically off the dictionary: take the cheapest all-dead word
// (no letters shared with crane) whose last letter costs ≤ $6, seed the
// bank at its price + $2, and type it up to the last letter. The bank
// then can't cover a common letter — but the cheap completion stays live.

const CHEAP = (() => {
  let best = null;
  for (const w of DICT) {
    if ([...w].some((ch) => "crane".includes(ch))) continue;
    if (COST[w[4]] > 6) continue;
    if (best === null || cost(w) < cost(best)) best = w;
  }
  return best;
})();
assert.ok(CHEAP, "a cheap all-dead word exists");
assert.ok(cost(CHEAP) + 2 >= bruteMR(""), "the seed bank stays alive on an empty row");

seedDaily("crane", [], { bank: cost(CHEAP) + 2 });
{
  for (let i = 0; i < 4; i++) {
    keydown(CHEAP[i]);
    assert.equal(PEDDLE.dump().done, false, `alive after typing ${CHEAP.slice(0, i + 1)}`);
  }
  const bankLeft = 2 + COST[CHEAP[4]];
  assert.equal(moneyAmount.textContent, "$" + bankLeft, "four letters bought");
  assert.equal(priceChip(0).textContent, "\u2212$" + (cost(CHEAP) - COST[CHEAP[4]]),
    "the pending row's chip matches the four letters' price");
  keydown("e"); // the $10 letter
  assert.equal(toast.textContent, `E costs $10 — you have $${bankLeft}`,
    "the block names the price and the balance");
  assert.equal(rowTiles(0)[4].textContent, "", "the letter never landed");
  assert.equal(moneyAmount.textContent, "$" + bankLeft, "no money moved");
  assert.equal(PEDDLE.dump().done, false, "a live row blocks, it doesn't bury");
  keydown(CHEAP[4]); // the affordable completion
  assert.equal(PEDDLE.dump().typed, CHEAP, "the cheap word completed");
}
console.log(`ok — afford block: "${CHEAP}" typed to the brim, the $10 letter refused, board alive`);

// ---------- 10. mid-guess bankruptcy: the word you can't finish ---------------
// From $28, find a legal two-letter prefix that is affordable letter by
// letter yet whose cheapest completion costs more than what's left.

seedDaily("crane", [], { bank: 28 });
const TRIP = (() => {
  for (const l1 of "abcdefghijklmnopqrstuvwxyz") {
    const c1 = COST[l1];
    if (c1 > 28 || 28 - c1 < bruteMR(l1)) continue; // l1 must be affordable AND live
    for (const l2 of "abcdefghijklmnopqrstuvwxyz") {
      const c2 = COST[l2];
      if (c2 > 28 - c1) continue;                   // l2 affordable
      const mr = bruteMR(l1 + l2);
      if (mr !== Infinity && 28 - c1 - c2 < mr) return [l1, l2, c1, c2];
    }
  }
  return null;
})();
assert.ok(TRIP, "a two-letter trip exists from $28");

{
  keydown(TRIP[0]);
  assert.equal(PEDDLE.dump().done, false, "the first letter left the game alive");
  keydown(TRIP[1]);
  assert.equal(PEDDLE.dump().done, true, "the second letter bankrupted the game");
  assert.equal(banner.textContent, "Bankrupt — the word was CRANE", "the loss is named");
  assert.equal(rowTiles(0)[0].textContent + rowTiles(0)[1].textContent,
    TRIP[0] + TRIP[1], "the half-typed word stays on the board — that's how it ended");
  assert.equal(board.children.length, 1, "no fresh row after the fall");
  assert.equal(PEDDLE.dump().bank, 28 - TRIP[2] - TRIP[3], "the typed letters stayed spent");
  assert.ok(!shareBtn.classList.contains("hidden"), "share offered after bankruptcy");
  assert.ok(giveUpBtn.classList.contains("hidden"), "give up retires");
  keydown("a");
  assert.equal(PEDDLE.dump().guesses.length, 0, "board locked after bankruptcy");

  const s = readSave();
  assert.equal(s.done, true, "bankruptcy saved done");
  assert.equal(s.bank, 28 - TRIP[2] - TRIP[3], "the broken bank saved");
  assert.equal(s.guesses.length, 0, "no guesses to show for it");
}

shareBtn.click();
{
  const ta = createdEls.filter((e) => e.tagName === "textarea").pop();
  assert.equal(ta.value.split("\n")[0],
    `Peddle · ${PEDDLE.todayKey()} · bankrupt · 0 guesses · $${28 - TRIP[2] - TRIP[3]} left`,
    "bankruptcy tagged in the share");
}

dailyGame(); // refresh: the loss restores
assert.equal(banner.textContent, "Bankrupt — the word was CRANE", "loss banner restored");
assert.equal(PEDDLE.dump().done, true, "restored board locked");
console.log(`ok — mid-guess bankruptcy: "${TRIP[0]}${TRIP[1]}" from $28 ends the game mid-word`);

// ---------- 11. empty-row bankruptcy: can't afford any word -------------------

assert.ok(5 < bruteMR(""), "precondition: $5 can't buy the cheapest word");
seedDaily("crane", [], { bank: 5 });
assert.equal(banner.textContent, "Bankrupt — the word was CRANE", "bankrupt at the handoff");
assert.equal(PEDDLE.dump().done, true, "done without a single guess");
assert.ok(!shareBtn.classList.contains("hidden"), "share offered");
console.log("ok — empty-row bankruptcy: $5 can't open a word, the game says so");

// ---------- 12. give up refunds the unsubmitted word --------------------------

PEDDLE.practice("crane");
for (const ch of "cr") keydown(ch);
giveUpBtn.click();
{
  assert.equal(banner.textContent, "The word was CRANE", "give up reveals the word");
  assert.equal(moneyAmount.textContent, "$120", "the unsubmitted letters refunded");
  assert.equal(priceChip(0).textContent, "", "the unsubmitted tab cleared from the row");
  assert.ok(!shareBtn.classList.contains("hidden"), "share offered after give up");
  assert.equal(PEDDLE.dump().bank, 120, "bank intact — cr was never played");
  assert.equal(PEDDLE.dump().gaveUp, true, "gaveUp flag explicit");
}

seedDaily("crane");
for (const ch of "cr") keydown(ch);
giveUpBtn.click();
{
  const s = readSave();
  assert.equal(s.done, true, "give up saved done");
  assert.equal(s.gaveUp, true, "gaveUp saved");
  assert.equal(s.bank, 120, "the refund saved too");
}
shareBtn.click();
{
  const ta = createdEls.filter((e) => e.tagName === "textarea").pop();
  assert.equal(ta.value.split("\n")[0],
    `Peddle · ${PEDDLE.todayKey()} · gave up · 0 guesses · $120 left`,
    "surrender tagged in the share");
}
console.log("ok — give up: the unplayed word refunds, the loss saves and restores");

// ---------- 13. the economy tightens: freed letters cheapen old habits -------

PEDDLE.practice("crane");
typeRow("cramp"); // c/r/a green in place, m/p gray
{
  assert.deepEqual(PEDDLE.evaluate("cramp", "crane"), M("KKKAA"), "cramp marks");
  assert.equal(priceChip(0).textContent, "+$7", "$38 of letters, $45 of first-green refunds");
  assert.ok(priceChip(0).classList.contains("gain"), "an opening guess can already profit");
  assert.equal(moneyAmount.textContent, "$127", "bank after cramp");
}
typeRow("hoist");
assert.equal(moneyAmount.textContent, "$81", "bank after hoist");
typeRow("cramp"); // same word again: c/r/a are free now, m/p refund nothing
{
  assert.equal(priceChip(2).textContent, "\u2212$12", "the repeat costs $12, not $38 — the greens ride free");
  assert.equal(moneyAmount.textContent, "$69", "the same habit costs less but pays nothing back");
  assert.equal(PEDDLE.dump().done, false, "three misses end nothing — guesses are unlimited");
  assert.equal(board.children.length, 4, "rows grow on demand");
}
console.log("ok — the economy tightens: freed greens cheapen the repeat, grays never refund");

// ---------- 14. refresh mid-game: economy, chips and chart all restored ------

seedDaily("crane", ["range", "hoist"], { bank: 73 });
dailyGame(); // simulated refresh
{
  assert.equal(board.children.length, 3, "two scored rows + the waiting row");
  assert.ok(board.children[0].classList.contains("quiet"), "restored rows are quiet");
  assert.deepEqual([...tiles(0)].map((t) => t.classList.contains("present")),
    [true, true, true, false, false], "range restored");
  assert.ok(tiles(0)[4].classList.contains("correct"), "range's green restored");
  assert.equal(priceChip(0).textContent, "\u2212$1", "range's net price restored");
  assert.equal(priceChip(1).textContent, "\u2212$46", "hoist's net price restored");
  assert.equal(moneyAmount.textContent, "$73", "the saved bank restored exactly");
  assert.equal(banner.textContent, OPEN_BANNER, "the game is re-announced");
  assert.ok(chipOf("e").classList.contains("hit-g"), "the chart's green discovery restored");
  assert.ok(chipOf("r").classList.contains("hit-y"), "the chart's yellow discovery restored");
  assert.ok(chipOf("h").classList.contains("dead"), "the chart's dead letters restored");
  assert.ok(keyFor("e").classList.contains("correct"), "keyboard colors restored");
  typeRow("crane");
  assert.equal(banner.textContent, "Impressive — 3 guesses", "play continues after a refresh and wins");
  assert.equal(moneyAmount.textContent, "$97", "the restored bank plays on to the same win");
}

dailyGame(); // refresh the just-won daily
{
  assert.equal(banner.textContent, "Impressive — 3 guesses", "won banner restored");
  assert.ok(moneyAmount.classList.contains("done"), "win accent restored");
  assert.ok(!shareBtn.classList.contains("hidden"), "share offered again");
  for (const t of tiles(2)) assert.ok(t.classList.contains("win-glow"), "the win glow restored");
  keydown("a");
  assert.equal(PEDDLE.dump().guesses.length, 3, "restored won board is locked");
}

// a live save whose bank can't buy any word ends on restore
seedDaily("crane", [], { bank: 2 });
assert.equal(banner.textContent, "Bankrupt — the word was CRANE", "a broke save bankrupts on restore");
assert.equal(readSave().done, true, "the save is finalized");
console.log("ok — refresh mid-game: chips, chart, bank and end states all restored");

// ---------- 15. next day + corrupt saves: the bank is validated too ----------

seedDaily("crane", ["crane"], { bank: 149, done: true, won: true });
let s = readSave();
s.date = "1999-12-31";
globalThis.localStorage.setItem("peddle-day16", JSON.stringify(s));
dailyGame();
s = readSave();
assert.notEqual(s.date, "1999-12-31", "stale save replaced");
assert.equal(s.bank, 120, "fresh daily, fresh bank");
assert.equal(s.answer, PEDDLE.answerFor(PEDDLE.todayKey()), "new day, new daily word");

const good = { date: PEDDLE.todayKey(), answer: "crane", bank: 120, guesses: [],
  done: false, won: false, gaveUp: false };
for (const bad of [
  { ...good, answer: "qqqqq" },                          // not a word
  { ...good, answer: 42 },                               // not a string
  { date: PEDDLE.todayKey(), guesses: [], bank: 120 },   // no answer
  { ...good, guesses: "crane" },                         // not an array
  { ...good, guesses: ["qqqqq"] },                       // non-word guess
  { ...good, bank: undefined },                          // no bank
  { ...good, bank: "73" },                               // bank as text
  { ...good, bank: -5 },                                 // negative bank
  { ...good, bank: null },                               // NaN/Infinity serialize to null
  { ...good, bank: 100000 },                             // beyond any legal bankroll
]) {
  globalThis.localStorage.setItem("peddle-day16", JSON.stringify(bad));
  dailyGame();
  s = readSave();
  assert.equal(s.answer, PEDDLE.answerFor(PEDDLE.todayKey()),
    `corrupt save ${JSON.stringify(bad).slice(0, 40)}… replaced by a fresh daily`);
  assert.equal(s.bank, 120, "corrupt bank discarded");
  assert.deepEqual(s.guesses, [], "corrupt save's guesses discarded");
}
console.log("ok — next day + corrupt saves: stale/fake/bankless saves fall back fresh");

// ---------- 16. practice: fresh bank, forced words, daily save untouched ------

const saveBeforePractice = globalThis.localStorage.getItem("peddle-day16");
const craneIdx = ANSWERS.indexOf("crane");
Math.random = () => (craneIdx + 0.5) / ANSWERS.length;

PEDDLE.practice();
assert.equal(banner.textContent, "Practice round", "practice banner shown");
assert.equal(newBtn.textContent, "Today\u2019s puzzle", "button offers the way back");
assert.equal(PEDDLE.dump().answer, ANSWERS[craneIdx], "random word honors the Math.random stub");
assert.equal(PEDDLE.dump().bank, 120, "practice opens its own $120");

PEDDLE.practice("crane");
typeRow("crane");
assert.equal(PEDDLE.dump().bank, 149, "practice economy runs the same rules");
PEDDLE.practice("qqqqq");
assert.ok(DICT.has(PEDDLE.dump().answer), "invalid forced word rejected");
assert.equal(PEDDLE.dump().bank, 120, "each practice starts clean");

const d = PEDDLE.dump();
for (const field of ["answer", "bank", "paid", "typed", "guesses", "freed",
  "yellow", "dead", "practice", "done", "won", "gaveUp", "save"]) {
  assert.ok(field in d, `dump exposes ${field}`);
}
assert.equal(globalThis.localStorage.getItem("peddle-day16"), saveBeforePractice,
  "practice never touches the daily save");

newBtn.click();
assert.equal(newBtn.textContent, "Practice", "button back to Practice");
assert.equal(banner.textContent, OPEN_BANNER, "fresh daily re-announced");
assert.equal(moneyAmount.textContent, "$120", "the daily bank is its own");
console.log("ok — practice: fresh $120 each round, forced words, dump, no daily writes");

// ---------- 17. minRemaining tracks the freed set -----------------------------

PEDDLE.practice("crane");
typeRow("crane"); // c,r,a,n,e freed — completions through them get cheaper
{
  assert.equal(PEDDLE.minRemaining(""), 0, "an all-freed word costs nothing… ");
  assert.equal(PEDDLE.dump().done, true, "…but that first-guess win already ended the game");
}
PEDDLE.practice("crane");
typeRow("range"); // only e freed
{
  const f = { e: 1 };
  assert.equal(PEDDLE.minRemaining("cr"), bruteMR("cr", f),
    "minRemaining consults the live freed set (e free)");
  assert.ok(PEDDLE.minRemaining("cr") <= bruteMR("cr"),
    "freed letters can only cheapen the minimum");
}
console.log("ok — minRemaining: freed letters cheapen completions, live set consulted");

// ---------- 18. solvability sweep: the answer is always affordable ------------

let swept = 0;
for (let i = 0; i < 40; i++) {
  const key = `2027-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`;
  seedDaily(PEDDLE.answerFor(key));
  const a = PEDDLE.dump().answer;
  assert.ok(cost(a) <= 120, `${key}: the answer costs at most five common letters`);
  typeRow(a);
  const expected = 120 - cost(a) + 15 * new Set([...a]).size;
  assert.ok(readSave().won, `${key}: buying the answer wins`);
  assert.equal(readSave().bank, expected, `${key}: bank math checks`);
  swept++;
}
console.log(`ok — solvability sweep: ${swept} sampled dailies all bought and won`);

console.log("\nAll peddle tests passed.");
