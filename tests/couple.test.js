// Headless tests for js/couple.js. Loads the real game script against a
// minimal DOM stub and drives full games through the keyboard handler.
// Run: node tests/couple.test.js
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
["board", "keyboard", "banner", "toast", "new-btn", "giveup-btn", "share-btn"].forEach((id) => {
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
const GAME_URL = "https://suitangi.github.io/30Wordles/days/14";

require(path.join(__dirname, "..", "js", "couple.js"));
const COUPLE = globalThis.COUPLE;
assert.ok(COUPLE, "couple.js must expose window.COUPLE");

const board = byId.board;
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
const shownMarks = (r) => rowTiles(r).map((t) =>
  t.classList.contains("correct") ? "K"
    : t.classList.contains("present") ? "P"
      : t.classList.contains("absent") ? "A" : "?");
const readSave = () => JSON.parse(globalThis.localStorage.getItem("couple-day14"));

// Type a word and submit it, playing out the whole reveal.
function typeRow(word) {
  for (const ch of word) keydown(ch);
  keydown("Enter");
  runTimers();
}

// A chained row opens with the carried letter already in — type only
// the remaining four.
function typeRest(word) {
  for (const ch of word.slice(1)) keydown(ch);
  keydown("Enter");
  runTimers();
}

function dailyGame() {
  COUPLE.daily();
}

// Force today's daily puzzle to an answer (optionally with guesses played).
function seedDaily(answer, guesses = [], extra = {}) {
  globalThis.localStorage.setItem("couple-day14", JSON.stringify({
    date: COUPLE.todayKey(), answer, guesses, done: false, won: false, gaveUp: false, ...extra,
  }));
  dailyGame();
}

const ev = COUPLE.evaluate;
const M = (marksStr) => marksStr.split("").map((ch) => ({ K: "correct", P: "present", A: "absent" }[ch]));
const OPEN_BANNER = "Every guess ends where the next begins";

// ---------- 1. word list sanity ----------

assert.equal(ANSWERS.length, 2315, "answers count");
assert.equal(DICT.size, 14855, "guessable count");
for (const w of ANSWERS) {
  assert.match(w, /^[a-z]{5}$/, `answer "${w}" shape`);
  assert.ok(DICT.has(w), `answer "${w}" must be guessable`);
}
for (const w of ["crane", "cramp", "plane", "eager", "roast", "trust", "tarts", "civic"]) {
  assert.ok(DICT.has(w), `test word "${w}" is guessable`);
}
console.log("ok — word lists (2315 answers, 14855 guessable, test words present)");

// ---------- 2. evaluate: standard Wordle two-pass --------------------------------

assert.deepEqual(ev("crane", "crane"), M("KKKKK"), "exact match");
assert.deepEqual(ev("crane", "brane"), M("AKKKK"), "one letter off");
assert.deepEqual(ev("speed", "abode"), M("AAPAP"),
  "duplicate guess letters consume target letters once each");
assert.deepEqual(ev("eerie", "erase"), M("KAPAK"),
  "repeated letters: greens first, strays consume target copies in order");
console.log("ok — evaluate: two-pass, duplicates handled");

// ---------- 3. the chain rule ------------------------------------------------------

assert.ok(COUPLE.chains("crane", "eaten"), "crane's e couples into eaten");
assert.ok(!COUPLE.chains("crane", "noise"), "noise ignores the carried e — broken chain");
console.log("ok — chains: a guess's last letter must open the next");

// ---------- 4. daily word: date-derived, salted away from days 1-13 ----------------

function saltHash(s) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}
const salted = (salt, key) => ANSWERS[saltHash(salt + key) % ANSWERS.length];

let diff = 0;
for (let i = 0; i < 200; i++) {
  const key = `2026-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`;
  const a = COUPLE.answerFor(key);
  assert.equal(a, COUPLE.answerFor(key), "answerFor is deterministic");
  assert.ok(DICT.has(a), "answer is guessable");
  const others = [
    ANSWERS[saltHash(key) % ANSWERS.length], // Bundle hashes the bare key
    salted("subtle", key), salted("wobble", key), salted("toggle", key),
    salted("meddle", key), salted("meddle-b", key), salted("crumble", key),
    salted("bubble", key), salted("swivel", key), salted("swivel-b", key),
    salted("stifle", key), salted("hustle", key), salted("castle", key),
    salted("encircle", key), salted("encircle-ring", key), salted("dawdle", key),
  ];
  if (others.every((w) => w !== a)) diff++;
}
assert.ok(diff > 180, `answer avoids days 1-13's words (${diff}/200 dates)`);
console.log(`ok — daily word: deterministic, salt-differ from days 1-13 (${diff}/200)`);

// ---------- 5. fresh daily: one free row, nothing carried ---------------------------

store.clear();
dailyGame();

const freshAnswer = COUPLE.answerFor(COUPLE.todayKey());
assert.equal(board.children.length, 1, "one waiting row");
assert.equal(rowTiles(0)[0].textContent, "", "the first row types freely");
assert.ok(!rowTiles(0)[0].classList.contains("carried"), "no carry on row 1");
assert.ok(board.children[0].classList.contains("on"), "the live row wears on");
assert.equal(banner.textContent, OPEN_BANNER, "the coupling is announced");
assert.ok(!giveUpBtn.classList.contains("hidden"), "give up offered on a fresh board");
assert.ok(shareBtn.classList.contains("hidden"), "no share before an end state");

const freshSave = readSave();
assert.equal(freshSave.date, COUPLE.todayKey(), "save stamped with today");
assert.equal(freshSave.answer, freshAnswer, "daily answer is date-derived");
assert.deepEqual(freshSave.guesses, [], "no guesses yet");
console.log(`ok — fresh daily: ${freshSave.date}, answer ${freshAnswer}, first guess free`);

// ---------- 6. the carry: locked in, unerasable, chaining down the board ------------

{
  COUPLE.practice("crane");
  typeRow("cramp"); // free first guess, ends in p
  {
    assert.deepEqual(shownMarks(0), "KKKAA".split(""), "cramp scores normally");
    assert.equal(rowTiles(1)[0].textContent, "p", "cramp's last letter is locked in");
    assert.ok(rowTiles(1)[0].classList.contains("carried"), "the carried tile wears the couple");
    assert.ok(rowTiles(1)[0].classList.contains("filled"), "the carry arrives pre-filled");
    assert.ok(board.children[0].classList.contains("has-next"), "row 1 grows the outgoing line");
    assert.ok(board.children[1].classList.contains("has-prev"), "row 2 grows the incoming line");
    assert.ok(board.children[1].classList.contains("on"), "the waiting row is live");
    assert.ok(!board.children[0].classList.contains("on"), "the scored row retires its hint");
  }
  for (const ch of "abcd") keydown(ch); // typed on top of the carry: "pabcd"
  assert.equal(board.children[1].children[1].textContent, "a",
    "typing starts after the carried tile");
  for (let i = 0; i < 4; i++) keydown("Backspace");
  assert.equal(rowTiles(1)[0].textContent, "p", "backspace cannot erase the carry");
  assert.ok(rowTiles(1)[0].classList.contains("carried"), "the carry keeps its tint");
  keydown("Backspace");
  assert.equal(rowTiles(1)[0].textContent, "p", "still there — the couple holds");

  // Chain the whole board: p → e → r → t → t, six guesses, all wrong.
  typeRest("plane"); // p…e
  assert.equal(rowTiles(2)[0].textContent, "e", "plane's e couples forward");
  typeRest("eager"); // e…r
  assert.equal(rowTiles(3)[0].textContent, "r", "eager's r couples forward");
  typeRest("roast"); // r…t
  assert.equal(rowTiles(4)[0].textContent, "t", "roast's t couples forward");
  typeRest("trust"); // t…t
  assert.equal(rowTiles(5)[0].textContent, "t", "trust's t couples into the last row");
  typeRest("tarts"); // the sixth miss
  {
    assert.equal(COUPLE.dump().done, true, "six misses end it");
    assert.equal(COUPLE.dump().won, false, "not won");
    assert.equal(COUPLE.dump().gaveUp, false, "not a surrender — exhaustion");
    assert.equal(banner.textContent, "The word was CRANE", "the loss reveals the word");
    assert.equal(board.children.length, 6, "no seventh row");
    keydown("a");
    assert.equal(COUPLE.dump().guesses.length, 6, "board locked");
  }
  shareBtn.click();
  {
    const ta = createdEls.filter((e) => e.tagName === "textarea").pop();
    assert.equal(ta.value.split("\n")[0], "Couple · practice · X/6",
      "exhaustion tagged X/6 in the share");
  }
}
console.log("ok — the carry: locked, unerasable, chaining all six rows; sixth miss loses");

// ---------- 7. the win: hand yourself the answer --------------------------------------

COUPLE.practice("crane");
typeRow("civic"); // free guess ending in c
typeRest("crane"); // the carry opens the answer
{
  assert.equal(COUPLE.dump().done, true, "done");
  assert.equal(COUPLE.dump().won, true, "won");
  assert.equal(banner.textContent, "Magnificent \u2014 2 guesses", "praised by the count");
  assert.deepEqual(shownMarks(1), "KKKKK".split(""), "five greens");
  assert.ok(rowTiles(1).every((t) => t.classList.contains("win-glow")), "the chain glows");
  assert.ok(!shareBtn.classList.contains("hidden"), "share appears on the win");
  assert.ok(giveUpBtn.classList.contains("hidden"), "give up retires");
  keydown("a");
  assert.equal(COUPLE.dump().guesses.length, 2, "board locked after the win");
  assert.ok(board.children.every((r) => !r.classList.contains("on")),
    "the live-row hint retires at the end; the couplers stay");
}
console.log("ok — the win: civic hands c to crane; praised, glowing, locked");

// ---------- 8. share --------------------------------------------------------------------

shareBtn.click();
{
  const ta = createdEls.filter((e) => e.tagName === "textarea").pop();
  const lines = ta.value.split("\n");
  const SQ = "\u2B1C";
  const GRN = "\uD83D\uDFE9";
  assert.equal(lines[0], "Couple · practice · 2/6", "practice share header");
  assert.equal(lines[1], GAME_URL, "share links to the game");
  assert.equal(lines[2], GRN + SQ.repeat(4), "civic vs crane");
  assert.equal(lines[3], GRN.repeat(5), "crane resolved");
}
console.log("ok — share: name · practice/date · N/6, URL, the grid");

// ---------- 9. give up: the other loss ----------------------------------------------------

store.clear();
seedDaily("crane");
giveUpBtn.click();
{
  assert.equal(banner.textContent, "The word was CRANE", "give up reveals the word");
  assert.ok(giveUpBtn.classList.contains("hidden"), "give up retires after use");
  assert.ok(!shareBtn.classList.contains("hidden"), "share offered after give up");
  const gaveUpSave = readSave();
  assert.equal(gaveUpSave.done, true, "give up saved done");
  assert.equal(gaveUpSave.gaveUp, true, "gaveUp flag explicit");
  keydown("a");
  assert.equal(COUPLE.dump().guesses.length, 0, "board locked after give up");
}
shareBtn.click();
{
  const ta = createdEls.filter((e) => e.tagName === "textarea").pop();
  assert.equal(ta.value.split("\n")[0], `Couple · ${COUPLE.todayKey()} · gave up · X/6`,
    "surrender tagged in the share");
}
dailyGame();
assert.equal(banner.textContent, "The word was CRANE", "loss banner restored");
console.log("ok — give up: reveals the word, saves the loss, restores locked");

// ---------- 10. refresh mid-game: the chain rebuilds ----------------------------------------

store.clear();
seedDaily("crane", ["cramp", "plane"]);
dailyGame(); // simulated refresh
{
  assert.deepEqual(shownMarks(0), "KKKAA".split(""), "guess 1 restored");
  assert.deepEqual(shownMarks(1), "AAKKK".split(""), "guess 2 restored (plane shares crane's -ane)");
  assert.equal(rowTiles(2)[0].textContent, "e", "the waiting row opens with plane's e");
  assert.ok(rowTiles(2)[0].classList.contains("carried"), "the carry restored");
  assert.ok(board.children[0].classList.contains("has-next"), "couplers restored");
  assert.ok(board.children[1].classList.contains("has-prev"), "couplers restored");
  assert.ok(board.children[1].classList.contains("has-next"), "the middle row couples both ways");
  assert.ok(board.children[0].classList.contains("quiet"), "restored rows are quiet");
  assert.ok(keyFor("c").classList.contains("correct"), "keyboard colors restored");
  assert.equal(banner.textContent, OPEN_BANNER, "the coupling is re-announced");
}
typeRest("eager");
assert.equal(rowTiles(3)[0].textContent, "r", "play continues and the chain grows");
console.log("ok — refresh mid-game: chain and couplers rebuilt, play continues");

// ---------- 11. refresh after finishing -------------------------------------------------------

store.clear();
seedDaily("crane", ["civic", "crane"], { done: true, won: true });
dailyGame();
assert.equal(COUPLE.dump().guesses.length, 2, "finished board restored");
assert.equal(board.children.length, 2, "no waiting row on a done board");
assert.equal(banner.textContent, "Magnificent \u2014 2 guesses", "won banner restored");
assert.ok(!shareBtn.classList.contains("hidden"), "share offered again");
assert.ok(giveUpBtn.classList.contains("hidden"), "give up stays retired");
assert.deepEqual(shownMarks(1), "KKKKK".split(""), "the win restored");
assert.ok(rowTiles(1).every((t) => t.classList.contains("win-glow")), "the win glow restored");
keydown("a");
assert.equal(COUPLE.dump().guesses.length, 2, "restored won board is locked");
console.log("ok — refresh after finishing: banner, resolved chain, glow and lock restored");

// ---------- 12. next day: fresh puzzle; corrupt saves fall back --------------------------------

let s = readSave();
s.date = "1999-12-31";
globalThis.localStorage.setItem("couple-day14", JSON.stringify(s));
dailyGame();

s = readSave();
assert.notEqual(s.date, "1999-12-31", "stale save replaced");
assert.equal(s.date, COUPLE.todayKey(), "re-stamped with today");
assert.equal(s.answer, COUPLE.answerFor(COUPLE.todayKey()), "new day, new daily word");
assert.deepEqual(s.guesses, [], "guesses reset");

const good = { date: COUPLE.todayKey(), answer: "crane", guesses: [],
  done: false, won: false, gaveUp: false };
for (const bad of [
  { ...good, answer: "qqqqq" },                          // not a word
  { ...good, answer: 42 },                                // not a string
  { date: COUPLE.todayKey(), guesses: [] },              // no answer
  { ...good, guesses: "crane" },                          // not an array
  { ...good, guesses: ["qqqqq"] },                       // non-word guess
  { ...good, guesses: ["cat"] },                          // wrong length
  { ...good, guesses: Array.from({ length: 7 }, () => "seems") }, // more than six
  { ...good, guesses: ["crane", "noise"] },              // broken chain: e does not open noise
  { ...good, guesses: ["cramp", "crane"] },              // broken chain: p does not open crane
]) {
  globalThis.localStorage.setItem("couple-day14", JSON.stringify(bad));
  dailyGame();
  s = readSave();
  assert.equal(s.answer, COUPLE.answerFor(COUPLE.todayKey()),
    `corrupt save ${JSON.stringify(bad).slice(0, 50)}… replaced by a fresh daily`);
  assert.deepEqual(s.guesses, [], "corrupt save's guesses discarded");
}
console.log("ok — next day + corrupt saves: stale/fake/broken-chain saves fall back fresh");

// ---------- 13. practice: forced word, random word, daily save untouched ------------------------

store.clear();
seedDaily("crane");
const saveBeforePractice = globalThis.localStorage.getItem("couple-day14");
const craneIdx = ANSWERS.indexOf("crane");
Math.random = () => (craneIdx + 0.5) / ANSWERS.length;

COUPLE.practice();
assert.equal(banner.textContent, "Practice round", "practice banner shown");
assert.equal(newBtn.textContent, "Today\u2019s puzzle", "button offers the way back");
assert.equal(COUPLE.dump().answer, ANSWERS[craneIdx], "random word honors the Math.random stub");

COUPLE.practice("crane"); // forced word, the debugging backdoor
assert.equal(COUPLE.dump().answer, "crane", "forced practice word honored");
COUPLE.practice("qqqqq"); // invalid: falls back to random, still a word
assert.ok(DICT.has(COUPLE.dump().answer), "invalid forced word rejected");

const d = COUPLE.dump();
assert.ok(Array.isArray(d.guesses), "dump exposes the guesses");
assert.ok("save" in d, "dump carries the raw save");

assert.equal(globalThis.localStorage.getItem("couple-day14"), saveBeforePractice,
  "practice never touches the daily save");

newBtn.click(); // back to today's puzzle
assert.equal(newBtn.textContent, "Practice", "button back to Practice");
assert.equal(banner.textContent, OPEN_BANNER, "fresh daily re-announced");
assert.ok(!giveUpBtn.classList.contains("hidden"), "give up back for the fresh daily");
console.log("ok — practice: forced + random words, no save writes, round-trips to daily");

// ---------- 14. solvability sweep: the free first guess always wins ------------------------------

let swept = 0;
for (let i = 0; i < 60; i++) {
  const key = `2027-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`;
  seedDaily(COUPLE.answerFor(key));
  typeRow(COUPLE.dump().answer);
  assert.ok(readSave().won, `${key}: the answer as the free opener wins`);
  swept++;
}
console.log(`ok — solvability sweep: ${swept} sampled dailies all fall to one opening guess`);

console.log("\nAll couple tests passed.");
