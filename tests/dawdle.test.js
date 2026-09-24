// Headless tests for js/dawdle.js. Loads the real game script against a
// minimal DOM stub and drives full games through the keyboard handler.
// Run: node tests/dawdle.test.js
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
const GAME_URL = "https://suitangi.github.io/30Wordles/days/13";

require(path.join(__dirname, "..", "js", "dawdle.js"));
const DAWDLE = globalThis.DAWDLE;
assert.ok(DAWDLE, "dawdle.js must expose window.DAWDLE");

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
const readSave = () => JSON.parse(globalThis.localStorage.getItem("dawdle-day13"));

// Type a word and submit it, playing out the whole reveal + catch-up wave.
function typeRow(word) {
  for (const ch of word) keydown(ch);
  keydown("Enter");
  runTimers();
}

function dailyGame() {
  DAWDLE.daily();
}

// Force today's daily puzzle to an answer (optionally with guesses played).
function seedDaily(answer, guesses = [], extra = {}) {
  globalThis.localStorage.setItem("dawdle-day13", JSON.stringify({
    date: DAWDLE.todayKey(), answer, guesses, done: false, won: false, gaveUp: false, ...extra,
  }));
  dailyGame();
}

const ev = DAWDLE.evaluate;
const mat = DAWDLE.mature;
const M = (marksStr) => marksStr.split("").map((ch) => ({ K: "correct", P: "present", A: "absent" }[ch]));
const OPEN_BANNER = "Clues run late \u2014 every guess lands gray";

// ---------- 1. word list sanity ----------

assert.equal(ANSWERS.length, 2315, "answers count");
assert.equal(DICT.size, 14855, "guessable count");
for (const w of ANSWERS) {
  assert.match(w, /^[a-z]{5}$/, `answer "${w}" shape`);
  assert.ok(DICT.has(w), `answer "${w}" must be guessable`);
}
for (const w of ["crane", "range", "hoist", "cramp"]) {
  assert.ok(DICT.has(w), `test word "${w}" is guessable`);
}
console.log("ok — word lists (2315 answers, 14855 guessable, test words present)");

// ---------- 2. evaluate: standard Wordle two-pass underneath -----------------

assert.deepEqual(ev("crane", "crane"), M("KKKKK"), "exact match");
assert.deepEqual(ev("crane", "brane"), M("AKKKK"), "one letter off");
assert.deepEqual(ev("speed", "abode"), M("AAPAP"),
  "duplicate guess letters consume target letters once each");
assert.deepEqual(ev("eerie", "erase"), M("KAPAK"),
  "repeated letters: greens first, strays consume target copies in order");
console.log("ok — evaluate: two-pass, duplicates handled");

// ---------- 3. mature: the aging law — grays instant, yellow +1, green +2 ----

assert.deepEqual(mat("crane", "crane", 0), M("AAAAA"),
  "a fresh guess says nothing at all");
assert.deepEqual(mat("crane", "crane", 1), M("PPPPP"),
  "greens spend their first late turn as yellow");
assert.deepEqual(mat("crane", "crane", 2), M("KKKKK"),
  "greens settle on the second late turn");
assert.deepEqual(mat("crane", "crane", 5), M("KKKKK"),
  "matured is matured");
assert.deepEqual(mat("range", "crane", 0), M("AAAAA"),
  "even a row with strays and a green starts silent");
assert.deepEqual(mat("range", "crane", 1), M("PPPAP"),
  "strays and the green all read yellow a turn later");
assert.deepEqual(mat("range", "crane", 2), M("PPPAK"),
  "and the green settles a turn after that");
assert.deepEqual(mat("speed", "abode", 1), M("AAPAP"),
  "strays wake; duplicates still consume once");
assert.deepEqual(mat("speed", "abode", 0), M("AAAAA"),
  "nothing before their time");
console.log("ok — mature: grays instant, yellows +1 turn, greens +2 via yellow");

// ---------- 4. daily word: date-derived, salted away from days 1-12 ----------

function saltHash(s) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}
const salted = (salt, key) => ANSWERS[saltHash(salt + key) % ANSWERS.length];

let diff = 0;
for (let i = 0; i < 200; i++) {
  const key = `2026-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`;
  const a = DAWDLE.answerFor(key);
  assert.equal(a, DAWDLE.answerFor(key), "answerFor is deterministic");
  assert.ok(DICT.has(a), "answer is guessable");
  const others = [
    ANSWERS[saltHash(key) % ANSWERS.length], // Bundle hashes the bare key
    salted("subtle", key), salted("wobble", key), salted("toggle", key),
    salted("meddle", key), salted("meddle-b", key), salted("crumble", key),
    salted("bubble", key), salted("swivel", key), salted("swivel-b", key),
    salted("stifle", key), salted("hustle", key), salted("castle", key),
    salted("encircle", key), salted("encircle-ring", key),
  ];
  if (others.every((w) => w !== a)) diff++;
}
assert.ok(diff > 180, `answer avoids days 1-12's words (${diff}/200 dates)`);
console.log(`ok — daily word: deterministic, salt-differ from days 1-12 (${diff}/200)`);

// ---------- 5. fresh daily: one waiting row, nothing hinted -------------------

store.clear();
dailyGame();

const freshAnswer = DAWDLE.answerFor(DAWDLE.todayKey());
assert.equal(board.children.length, 1, "one waiting row");
assert.equal(banner.textContent, OPEN_BANNER, "the dawdle is announced");
assert.ok(!giveUpBtn.classList.contains("hidden"), "give up offered on a fresh board");
assert.ok(shareBtn.classList.contains("hidden"), "no share before an end state");

const freshSave = readSave();
assert.equal(freshSave.date, DAWDLE.todayKey(), "save stamped with today");
assert.equal(freshSave.answer, freshAnswer, "daily answer is date-derived");
assert.deepEqual(freshSave.guesses, [], "no guesses yet");
console.log(`ok — fresh daily: ${freshSave.date}, answer ${freshAnswer}, board silent`);

// ---------- 6. the winning guess lands gray, then the board catches up --------

DAWDLE.practice("crane");
for (const ch of "crane") keydown(ch);
keydown("Enter");
for (let i = 0; i < 10; i++) timers.shift()(); // the row's flips, not finish()
{
  assert.deepEqual(shownMarks(0), "AAAAA".split(""),
    "even the answer lands all gray");
  assert.equal(DAWDLE.dump().done, false, "not finished mid-flip");
  assert.ok(rowTiles(0).every((t) => !t.classList.contains("correct")),
    "no green yet, on pain of death");
}
runTimers(); // finish() + the end-state maturation wave
{
  assert.equal(DAWDLE.dump().done, true, "the answer wins outright");
  assert.equal(DAWDLE.dump().won, true, "won");
  assert.equal(banner.textContent, "Genius \u2014 1 guess", "praised by the count");
  assert.deepEqual(shownMarks(0), "KKKKK".split(""),
    "the wave resolved the winning row to five greens");
  assert.ok(rowTiles(0).every((t) => t.classList.contains("win-glow")),
    "the word comes out glowing");
  for (const l of "crane") {
    assert.ok(keyFor(l).classList.contains("correct"), `key ${l} landed green`);
  }
  assert.ok(!shareBtn.classList.contains("hidden"), "share appears on the win");
  assert.ok(giveUpBtn.classList.contains("hidden"), "give up retires");
  keydown("a");
  assert.equal(DAWDLE.dump().guesses.length, 1, "board locked after the win");
}
console.log("ok — the answer lands gray and the wave reveals it: instant win, late color");

// ---------- 7. the dawdle across turns: yellows wake, greens settle -----------
// cramp vs crane is K K K A A; range vs crane is P P P A K; hoist is all gray.

DAWDLE.practice("crane");
typeRow("cramp"); // row 0: age 0, says nothing
{
  assert.deepEqual(shownMarks(0), "AAAAA".split(""), "guess 1 sits silent");
}
typeRow("range"); // row 0 ages to 1; row 1 lands silent
{
  assert.deepEqual(shownMarks(0), "PPPAA".split(""),
    "guess 1's greens read yellow one turn later; its grays were gray");
  assert.deepEqual(shownMarks(1), "AAAAA".split(""), "the new guess is silent");
  assert.ok(keyFor("c").classList.contains("present"), "key c woke yellow");
  assert.ok(keyFor("m").classList.contains("absent"), "true grays paint immediately");
  assert.ok(!keyFor("c").classList.contains("correct"),
    "the keyboard does not jump ahead to green");
  assert.ok(keyFor("e").classList.contains("absent"),
    "row 2's green e is still pretending to be gray");
}
typeRow("hoist"); // row 0 ages to 2, row 1 to 1, row 2 lands silent
{
  assert.deepEqual(shownMarks(0), "KKKAA".split(""),
    "the greens settle two turns after their guess");
  assert.deepEqual(shownMarks(1), "PPPAP".split(""),
    "row 2's strays stay yellow; its green e is still yellow too");
  assert.deepEqual(shownMarks(2), "AAAAA".split(""), "the newest guess is silent");
  assert.ok(keyFor("c").classList.contains("correct"),
    "the c key settles green once its tile does");
  assert.ok(keyFor("n").classList.contains("present"),
    "n's key woke yellow with its tile");
  assert.ok(keyFor("g").classList.contains("absent"),
    "g's clue is still dawdling — gray key, yellow-to-be");
}
console.log("ok — the dawdle across turns: yellows wake at +1, greens settle at +2");

// ---------- 8. seven guesses: the seventh miss is the loss ---------------------

DAWDLE.practice("crane");
for (let i = 0; i < 7; i++) typeRow("hoist");
{
  assert.equal(DAWDLE.dump().done, true, "seven misses end it");
  assert.equal(DAWDLE.dump().won, false, "not won");
  assert.equal(DAWDLE.dump().gaveUp, false, "not a surrender — exhaustion");
  assert.equal(banner.textContent, "The word was CRANE", "the loss reveals the word");
  assert.equal(board.children.length, 7, "no eighth row");
  keydown("a");
  assert.equal(DAWDLE.dump().guesses.length, 7, "board locked");
}
shareBtn.click();
{
  const ta = createdEls.filter((e) => e.tagName === "textarea").pop();
  assert.equal(ta.value.split("\n")[0], "Dawdle · practice · X/7",
    "exhaustion tagged X/7 in the share");
}
console.log("ok — the seventh miss loses: word revealed, board locked, X/7");

// ---------- 9. give up: the other loss ------------------------------------------

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
  assert.equal(DAWDLE.dump().guesses.length, 0, "board locked after give up");
}
shareBtn.click();
{
  const ta = createdEls.filter((e) => e.tagName === "textarea").pop();
  assert.equal(ta.value.split("\n")[0], `Dawdle · ${DAWDLE.todayKey()} · gave up · X/7`,
    "surrender tagged in the share");
}
dailyGame();
assert.equal(banner.textContent, "The word was CRANE", "loss banner restored");
console.log("ok — give up: reveals the word, saves the loss, restores locked");

// ---------- 10. share: the whole truth, always ------------------------------------

DAWDLE.practice("crane");
typeRow("crane");
shareBtn.click();
{
  const ta = createdEls.filter((e) => e.tagName === "textarea").pop();
  const lines = ta.value.split("\n");
  const GRN = "\uD83D\uDFE9";
  assert.equal(lines[0], "Dawdle · practice · 1/7", "practice share header");
  assert.equal(lines[1], GAME_URL, "share links to the game");
  assert.equal(lines[2], GRN.repeat(5), "the share shows resolved clues, not dawdled ones");
}
console.log("ok — share: name · practice/date · N/7, URL, the resolved grid");

// ---------- 11. refresh mid-game: the board resumes exactly as matured ------------

store.clear();
seedDaily("crane", ["cramp", "range"]);
dailyGame(); // simulated refresh
{
  assert.deepEqual(shownMarks(0), "PPPAA".split(""),
    "guess 1 restored at age 1: yellows awake, greens still shy");
  assert.deepEqual(shownMarks(1), "AAAAA".split(""),
    "guess 2 restored at age 0: silent");
  assert.ok(board.children[0].classList.contains("quiet"), "restored rows are quiet");
  assert.ok(keyFor("c").classList.contains("present"), "keyboard restored to the aged truth");
  assert.ok(!keyFor("c").classList.contains("correct"), "no early green on the keys");
  assert.equal(banner.textContent, OPEN_BANNER, "the dawdle is re-announced");
}
typeRow("hoist");
assert.deepEqual(shownMarks(0), "KKKAA".split(""), "play continues and greens settle");
typeRow("crane");
assert.equal(banner.textContent, "Splendid \u2014 4 guesses", "play continues after a refresh and wins");
console.log("ok — refresh mid-game: ages recomputed, play continues, wins");

// ---------- 12. refresh after finishing ---------------------------------------------

dailyGame(); // refresh the just-won daily
assert.equal(DAWDLE.dump().guesses.length, 4, "finished board restored");
assert.equal(banner.textContent, "Splendid \u2014 4 guesses", "won banner restored");
assert.ok(!shareBtn.classList.contains("hidden"), "share offered again");
assert.ok(giveUpBtn.classList.contains("hidden"), "give up stays retired");
assert.deepEqual(shownMarks(3), "KKKKK".split(""),
  "a done board restores fully resolved");
assert.ok(rowTiles(3).every((t) => t.classList.contains("win-glow")), "the win glow restored");
keydown("a");
assert.equal(DAWDLE.dump().guesses.length, 4, "restored won board is locked");
console.log("ok — refresh after finishing: banner, resolved board, glow and lock restored");

// ---------- 13. next day: fresh puzzle; corrupt saves fall back ----------------------

let s = readSave();
s.date = "1999-12-31";
globalThis.localStorage.setItem("dawdle-day13", JSON.stringify(s));
dailyGame();

s = readSave();
assert.notEqual(s.date, "1999-12-31", "stale save replaced");
assert.equal(s.date, DAWDLE.todayKey(), "re-stamped with today");
assert.equal(s.answer, DAWDLE.answerFor(DAWDLE.todayKey()), "new day, new daily word");
assert.deepEqual(s.guesses, [], "guesses reset");

const good = { date: DAWDLE.todayKey(), answer: "crane", guesses: [],
  done: false, won: false, gaveUp: false };
for (const bad of [
  { ...good, answer: "qqqqq" },                    // not a word
  { ...good, answer: 42 },                          // not a string
  { date: DAWDLE.todayKey(), guesses: [] },        // no answer
  { ...good, guesses: "crane" },                    // not an array
  { ...good, guesses: ["qqqqq"] },                 // non-word guess
  { ...good, guesses: ["cat"] },                    // wrong length ("short" would be legal!)
  { ...good, guesses: Array.from({ length: 8 }, () => "hoist") }, // more than seven
]) {
  globalThis.localStorage.setItem("dawdle-day13", JSON.stringify(bad));
  dailyGame();
  s = readSave();
  assert.equal(s.answer, DAWDLE.answerFor(DAWDLE.todayKey()),
    `corrupt save ${JSON.stringify(bad).slice(0, 50)}… replaced by a fresh daily`);
  assert.deepEqual(s.guesses, [], "corrupt save's guesses discarded");
}
console.log("ok — next day + corrupt saves: stale/fake/overlong saves fall back fresh");

// ---------- 14. practice: forced word, random word, daily save untouched --------------

store.clear();
seedDaily("crane");
const saveBeforePractice = globalThis.localStorage.getItem("dawdle-day13");
const craneIdx = ANSWERS.indexOf("crane");
Math.random = () => (craneIdx + 0.5) / ANSWERS.length;

DAWDLE.practice();
assert.equal(banner.textContent, "Practice round", "practice banner shown");
assert.equal(newBtn.textContent, "Today\u2019s puzzle", "button offers the way back");
assert.equal(DAWDLE.dump().answer, ANSWERS[craneIdx], "random word honors the Math.random stub");

DAWDLE.practice("crane"); // forced word, the debugging backdoor
assert.equal(DAWDLE.dump().answer, "crane", "forced practice word honored");
DAWDLE.practice("qqqqq"); // invalid: falls back to random, still a word
assert.ok(DICT.has(DAWDLE.dump().answer), "invalid forced word rejected");

const d = DAWDLE.dump();
assert.ok(Array.isArray(d.guesses), "dump exposes the guesses");
assert.ok("save" in d, "dump carries the raw save");

assert.equal(globalThis.localStorage.getItem("dawdle-day13"), saveBeforePractice,
  "practice never touches the daily save");

newBtn.click(); // back to today's puzzle
assert.equal(newBtn.textContent, "Practice", "button back to Practice");
assert.equal(banner.textContent, OPEN_BANNER, "fresh daily re-announced");
assert.ok(!giveUpBtn.classList.contains("hidden"), "give up back for the fresh daily");
console.log("ok — practice: forced + random words, no save writes, round-trips to daily");

// ---------- 15. solvability sweep: the answer always wins, gray or not ----------------

let swept = 0;
for (let i = 0; i < 60; i++) {
  const key = `2027-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`;
  seedDaily(DAWDLE.answerFor(key));
  typeRow(DAWDLE.dump().answer);
  assert.ok(readSave().won, `${key}: the answer wins even before its colors arrive`);
  swept++;
}
console.log(`ok — solvability sweep: ${swept} sampled dailies all fall to one (silent) guess`);

console.log("\nAll dawdle tests passed.");
