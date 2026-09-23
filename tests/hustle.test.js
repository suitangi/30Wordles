// Headless tests for js/hustle.js. Loads the real game script against a
// minimal DOM stub and drives full games through the keyboard handler.
// Run: node tests/hustle.test.js
"use strict";

const assert = require("assert/strict");
const path = require("path");

// ---------- minimal DOM / browser stubs (before loading the game) ----------

const timers = [];
globalThis.setTimeout = (fn) => { timers.push(fn); return timers.length; };
globalThis.clearTimeout = () => {};
function runTimers() { while (timers.length) timers.shift()(); }
// The tick interval is display-only — record it, never fire it, so tests
// are deterministic and can't hang the process.
const intervals = [];
globalThis.setInterval = (fn) => { intervals.push(fn); return intervals.length; };
globalThis.clearInterval = () => {};

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
["board", "keyboard", "banner", "toast", "new-btn", "giveup-btn", "share-btn",
  "clock", "clock-hint"].forEach((id) => {
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
const GAME_URL = "https://suitangi.github.io/30Wordles/days/10";

require(path.join(__dirname, "..", "js", "hustle.js"));
const HUSTLE = globalThis.HUSTLE;
assert.ok(HUSTLE, "hustle.js must expose window.HUSTLE");

const board = byId.board;
const clock = byId.clock;
const clockHint = byId["clock-hint"];
const banner = byId.banner;
const toast = byId.toast;
const newBtn = byId["new-btn"];
const giveUpBtn = byId["giveup-btn"];
const shareBtn = byId["share-btn"];
const keydown = (key) =>
  (windowHandlers.keydown || []).forEach((fn) =>
    fn({ key, metaKey: false, ctrlKey: false, altKey: false }));

const rowTiles = (r) => board.children[r].children;
const readSave = () => JSON.parse(globalThis.localStorage.getItem("hustle-day10"));

// Type a word and submit it, playing out the whole reveal.
function typeRow(word) {
  for (const ch of word) keydown(ch);
  keydown("Enter");
  runTimers();
}

function dailyGame() {
  HUSTLE.daily();
}

// Force today's daily puzzle to an answer (optionally with guesses played).
function seedDaily(answer, guesses = [], extra = {}) {
  globalThis.localStorage.setItem("hustle-day10", JSON.stringify({
    date: HUSTLE.todayKey(), answer, guesses, elapsedMs: 0,
    done: false, won: false, gaveUp: false, ...extra,
  }));
  dailyGame();
}

const ev = HUSTLE.evaluate;
const M = (marksStr) => marksStr.split("").map((ch) => ({ K: "correct", P: "present", A: "absent" }[ch]));
const TIME_RE = /^\d+:\d\d\.\d$/;

// ---------- 1. word list sanity ----------

assert.equal(ANSWERS.length, 2315, "answers count");
assert.equal(DICT.size, 14855, "guessable count");
for (const w of ANSWERS) {
  assert.match(w, /^[a-z]{5}$/, `answer "${w}" shape`);
  assert.ok(DICT.has(w), `answer "${w}" must be guessable`);
}
for (const w of ["crane", "hoist", "cramp"]) {
  assert.ok(DICT.has(w), `test word "${w}" is guessable`);
}
console.log("ok — word lists (2315 answers, 14855 guessable, test words present)");

// ---------- 2. evaluate: standard Wordle two-pass, duplicates included ----

assert.deepEqual(ev("crane", "crane"), M("KKKKK"), "exact match");
assert.deepEqual(ev("crane", "brane"), M("AKKKK"), "one letter off");
assert.deepEqual(ev("speed", "abode"), M("AAPAP"),
  "duplicate guess letters consume target letters once each");
assert.deepEqual(ev("eerie", "erase"), M("KAPAK"),
  "repeated letters: greens first, strays consume target copies in order");
console.log("ok — evaluate: two-pass, duplicates handled");

// ---------- 3. the clock's one public format: M:SS.T ------------------------

assert.equal(HUSTLE.formatTime(0), "0:00.0", "zero");
assert.equal(HUSTLE.formatTime(4200), "0:04.2", "seconds and tenths");
assert.equal(HUSTLE.formatTime(63400), "1:03.4", "past the minute");
assert.equal(HUSTLE.formatTime(3661000), "61:01.0", "minutes run unbounded");
assert.equal(HUSTLE.formatTime(-50), "0:00.0", "clamps negative");
console.log("ok — formatTime: M:SS.T, unbounded minutes, clamps negative");

// ---------- 4. daily word: date-derived, salted away from days 1-9 --------

function saltHash(s) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}
const salted = (salt, key) => ANSWERS[saltHash(salt + key) % ANSWERS.length];

let diff = 0;
for (let i = 0; i < 200; i++) {
  const key = `2026-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`;
  const a = HUSTLE.answerFor(key);
  assert.equal(a, HUSTLE.answerFor(key), "answerFor is deterministic");
  assert.ok(DICT.has(a), "answer is guessable");
  const others = [
    ANSWERS[saltHash(key) % ANSWERS.length], // Bundle hashes the bare key
    salted("subtle", key), salted("wobble", key), salted("toggle", key),
    salted("meddle", key), salted("meddle-b", key), salted("crumble", key),
    salted("bubble", key), salted("swivel", key), salted("swivel-b", key),
    salted("stifle", key),
  ];
  if (others.every((w) => w !== a)) diff++;
}
assert.ok(diff > 180, `answer avoids days 1-9's words (${diff}/200 dates)`);
console.log(`ok — daily word: deterministic, salt-differ from days 1-9 (${diff}/200)`);

// ---------- 5. fresh daily: one waiting row, clock at zero ------------------

store.clear();
dailyGame();

const freshAnswer = HUSTLE.answerFor(HUSTLE.todayKey());
assert.equal(board.children.length, 1, "one waiting row");
assert.equal(rowTiles(0).length, 5, "five tiles");
assert.equal(clock.textContent, "0:00.0", "clock rests at zero");
assert.equal(HUSTLE.dump().running, false, "clock not running");
assert.ok(!clockHint.classList.contains("hidden"), "the hint shows before the run");
assert.ok(!clock.classList.contains("running") && !clock.classList.contains("done"),
  "clock carries no state classes");
assert.ok(!giveUpBtn.classList.contains("hidden"), "give up offered on a fresh board");
assert.ok(shareBtn.classList.contains("hidden"), "no share before an end state");
assert.equal(banner.textContent, "", "no banner before an end state");

const freshSave = readSave();
assert.equal(freshSave.date, HUSTLE.todayKey(), "save stamped with today");
assert.equal(freshSave.answer, freshAnswer, "daily answer is date-derived");
assert.deepEqual(freshSave.guesses, [], "no guesses yet");
assert.equal(freshSave.elapsedMs, 0, "no time banked yet");
console.log(`ok — fresh daily: ${freshSave.date}, answer ${freshAnswer} — clock at zero, not running`);

// ---------- 6. the clock starts on the first SUBMITTED word -----------------

HUSTLE.practice("crane");

// Typing is free.
"crat".split("").forEach(keydown);
assert.equal(clock.textContent, "0:00.0", "typing never starts the clock");
assert.equal(HUSTLE.dump().running, false, "still not running while typing");

// A rejected submit is not a submitted word.
keydown("Enter");
runTimers();
assert.equal(toast.textContent, "Not enough letters");
assert.equal(HUSTLE.dump().running, false, "a rejected attempt starts nothing");
"crat".split("").forEach(() => keydown("Backspace"));

// First valid guess lands — the run begins.
typeRow("hoist");
assert.equal(HUSTLE.dump().running, true, "the clock runs from the first valid submit");
assert.ok(TIME_RE.test(clock.textContent), `clock reads a time (${clock.textContent})`);
assert.ok(clockHint.classList.contains("hidden"), "the hint retires once the run starts");
assert.ok(clock.classList.contains("running"), "the clock wears its running state");
const bankedAfterFirst = readSave();
assert.ok(bankedAfterFirst.elapsedMs >= 0, "time is banked with the save");
console.log("ok — the clock: typing and rejects are free; the first valid submit starts it");

// ---------- 7. unlimited guesses: nobody ever loses by count ----------------

for (let i = 0; i < 10; i++) typeRow(i % 2 === 0 ? "cramp" : "hoist");
assert.equal(board.children.length, 12, "twelve rows: hoist + ten more + waiting");
assert.equal(HUSTLE.dump().done, false, "ten misses end nothing");
assert.equal(banner.textContent, "Practice round", "ten misses end nothing — no loss banner");
const midRunBank = readSave().elapsedMs;
assert.ok(midRunBank >= bankedAfterFirst.elapsedMs, "every submit banks the running time");
console.log("ok — unlimited guesses: ten misses keep playing, time keeps banking");

// ---------- 8. the win: the clock stops and becomes the score ---------------

HUSTLE.practice("crane");
const saveBeforeWin = globalThis.localStorage.getItem("hustle-day10");
typeRow("hoist");
typeRow("crane");
{
  assert.equal(HUSTLE.dump().done, true, "done");
  assert.equal(HUSTLE.dump().won, true, "won");
  assert.equal(HUSTLE.dump().running, false, "the clock stopped");
  assert.ok(clock.textContent.startsWith("0:"), `short run frozen (${clock.textContent})`);
  assert.ok(clock.classList.contains("done"), "the frozen clock wears the accent");
  assert.match(banner.textContent, /^Magnificent \u2014 \d+:\d\d\.\d$/,
    "praise carries the time");
  assert.ok(!shareBtn.classList.contains("hidden"), "share appears on the win");
  assert.ok(giveUpBtn.classList.contains("hidden"), "give up retires");
  assert.ok(HUSTLE.dump().elapsed < 5000, `the test's run was fast (${HUSTLE.dump().elapsed}ms)`);
  keydown("a");
  assert.equal(HUSTLE.dump().guesses.length, 2, "board locked after the win");
  assert.equal(globalThis.localStorage.getItem("hustle-day10"), saveBeforeWin,
    "practice never saves — even a timed win");
}
console.log("ok — the win: clock frozen accent-bright, praised with the time, board locked");

// ---------- 9. share: the time is the whole share ---------------------------

HUSTLE.practice("crane");
typeRow("crane");
shareBtn.click();
const ta = createdEls.filter((e) => e.tagName === "textarea").pop();
const lines = ta.value.split("\n");
assert.equal(lines.length, 2, "no grid — two lines only");
assert.match(lines[0], /^Hustle · practice · \d+:\d\d\.\d$/, "practice share header is the time");
assert.equal(lines[1], GAME_URL, "share links to the game");
console.log("ok — share: name · practice/date · time, URL — nothing else");

// ---------- 10. give up: the only loss ---------------------------------------

seedDaily("crane");
giveUpBtn.click();
assert.equal(banner.textContent, "The word was CRANE", "give up reveals the word");
assert.equal(HUSTLE.dump().running, false, "clock stopped");
assert.equal(clock.textContent, "0:00.0", "a run that never started shares no time");
const gaveUpSave = readSave();
assert.equal(gaveUpSave.done, true, "give up saved done");
assert.equal(gaveUpSave.gaveUp, true, "gaveUp flag explicit");
keydown("a");
assert.equal(HUSTLE.dump().guesses.length, 0, "board locked after give up");

shareBtn.click();
const gta = createdEls.filter((e) => e.tagName === "textarea").pop();
assert.equal(gta.value.split("\n")[0], `Hustle · ${HUSTLE.todayKey()} · gave up`,
  "a surrender shares no time");
dailyGame();
assert.equal(banner.textContent, "The word was CRANE", "loss banner restored");
assert.ok(giveUpBtn.classList.contains("hidden"), "give up stays retired");

// A surrender mid-run still freezes honestly.
seedDaily("crane");
typeRow("hoist");
giveUpBtn.click();
assert.equal(HUSTLE.dump().running, false, "mid-run surrender stops the clock");
assert.match(clock.textContent, /^0:/, "the elapsed time stays on the clock");
console.log("ok — give up: the only loss; fresh or mid-run, the clock freezes honestly");

// ---------- 11. refresh mid-run: the clock resumes from its banked time -----

seedDaily("crane", ["hoist"], { elapsedMs: 5000 });
dailyGame(); // simulated refresh
{
  assert.equal(HUSTLE.dump().running, true, "a live run resumes ticking");
  assert.ok(HUSTLE.dump().elapsed >= 5000, `resumed from the bank (${HUSTLE.dump().elapsed}ms)`);
  assert.equal(clockHint.classList.contains("hidden"), true, "hint stays retired");
  assert.ok(board.children[0].classList.contains("quiet"), "restored rows are quiet");
  assert.deepEqual([...rowTiles(0)].map((t) => t.classList.contains("absent")),
    [true, true, true, true, true], "hoist's marks repainted");
  assert.ok(board.children.length === 2, "the waiting row is back");
}
typeRow("crane");
{
  const won = readSave();
  assert.ok(won.won, "play continues after a refresh and wins");
  assert.ok(won.elapsedMs >= 5000, `the bank survived the win (${won.elapsedMs}ms)`);
}
console.log("ok — refresh mid-run: time resumes from the bank, nothing lost, play continues");

// ---------- 12. refresh after finishing ---------------------------------------

dailyGame(); // refresh the just-won daily
assert.equal(HUSTLE.dump().guesses.length, 2, "finished board restored");
assert.match(banner.textContent, /^Magnificent \u2014 \d+:\d\d\.\d$/, "won banner restored");
assert.ok(!shareBtn.classList.contains("hidden"), "share offered again");
assert.ok(giveUpBtn.classList.contains("hidden"), "give up stays retired");
assert.equal(HUSTLE.dump().running, false, "no clock running on a finished board");
keydown("a");
assert.equal(HUSTLE.dump().guesses.length, 2, "restored won board is locked");
console.log("ok — refresh after finishing: banner, share, clock and lock all restored");

// A won restore paints the exact banked time on the frozen clock.
seedDaily("crane", ["crane"], { elapsedMs: 63400, done: true, won: true });
assert.equal(clock.textContent, "1:03.4", "the frozen clock repaints from the save");
assert.equal(banner.textContent, "Genius \u2014 1:03.4", "banner carries the same time");
console.log("ok — a won restore repaints its exact banked time");

// ---------- 13. next day: fresh puzzle; corrupt saves fall back --------------

let s = readSave();
s.date = "1999-12-31";
globalThis.localStorage.setItem("hustle-day10", JSON.stringify(s));
dailyGame();

s = readSave();
assert.notEqual(s.date, "1999-12-31", "stale save replaced");
assert.equal(s.date, HUSTLE.todayKey(), "re-stamped with today");
assert.equal(s.answer, HUSTLE.answerFor(HUSTLE.todayKey()), "new day, new daily word");
assert.deepEqual(s.guesses, [], "guesses reset");
assert.equal(s.elapsedMs, 0, "clock reset");

const good = { date: HUSTLE.todayKey(), answer: "crane", guesses: [], elapsedMs: 0,
  done: false, won: false, gaveUp: false };
for (const bad of [
  { ...good, answer: "qqqqq" },                    // not a word
  { ...good, answer: 42 },                          // not a string
  { date: HUSTLE.todayKey(), guesses: [], elapsedMs: 0 }, // no answer
  { ...good, guesses: "crane" },                    // not an array
  { ...good, guesses: ["hoist", "qqqqq"] },         // a non-word guess
  { ...good, guesses: ["cat"] },                    // wrong length
  { ...good, elapsedMs: -1 },                       // negative time
  { ...good, elapsedMs: "6000" },                   // not a number
  { date: HUSTLE.todayKey(), answer: "crane", guesses: [] }, // no elapsed
]) {
  globalThis.localStorage.setItem("hustle-day10", JSON.stringify(bad));
  dailyGame();
  s = readSave();
  assert.equal(s.answer, HUSTLE.answerFor(HUSTLE.todayKey()),
    `corrupt save ${JSON.stringify(bad).slice(0, 50)}… replaced by a fresh daily`);
  assert.equal(s.elapsedMs, 0, "corrupt save's clock discarded");
}
console.log("ok — next day + corrupt saves: stale/fake/negative-time saves fall back fresh");

// ---------- 14. practice: forced word, random word, daily save untouched -----

const saveBeforePractice = globalThis.localStorage.getItem("hustle-day10");
const craneIdx = ANSWERS.indexOf("crane");
Math.random = () => (craneIdx + 0.5) / ANSWERS.length;

HUSTLE.practice();
assert.equal(banner.textContent, "Practice round", "practice banner shown");
assert.equal(newBtn.textContent, "Today\u2019s puzzle", "button offers the way back");
assert.equal(HUSTLE.dump().answer, ANSWERS[craneIdx], "random word honors the Math.random stub");

const d = HUSTLE.dump();
assert.ok(Array.isArray(d.guesses), "dump exposes the guesses");
assert.ok("running" in d && "elapsed" in d, "dump exposes the clock");
assert.ok("save" in d, "dump carries the raw save");

HUSTLE.practice("crane"); // forced word, the debugging backdoor
assert.equal(HUSTLE.dump().answer, "crane", "forced practice word honored");
typeRow("hoist"); // the clock runs in practice too
assert.equal(HUSTLE.dump().running, true, "practice runs are timed");
HUSTLE.practice("crane"); // resetting mid-run banks nothing into the new game
assert.equal(HUSTLE.dump().running, false, "a fresh practice starts unstifled and untimed");
assert.equal(clock.textContent, "0:00.0", "the new clock rests at zero");
HUSTLE.practice("qqqqq"); // invalid: falls back to random, still a word
assert.ok(DICT.has(HUSTLE.dump().answer), "invalid forced word rejected");

assert.equal(globalThis.localStorage.getItem("hustle-day10"), saveBeforePractice,
  "practice never touches the daily save");

newBtn.click(); // back to today's puzzle
assert.equal(newBtn.textContent, "Practice", "button back to Practice");
assert.equal(HUSTLE.dump().running, false, "fresh daily not running");
assert.ok(!giveUpBtn.classList.contains("hidden"), "give up back for the fresh daily");
console.log("ok — practice: forced + random words, timed but never saved, round-trips to daily");

// ---------- 15. solvability sweep: every sampled daily is winnable -----------

let swept = 0;
for (let i = 0; i < 60; i++) {
  const key = `2027-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`;
  seedDaily(HUSTLE.answerFor(key));
  typeRow(HUSTLE.dump().answer);
  assert.ok(readSave().won, `${key}: typing the answer wins`);
  swept++;
}
console.log(`ok — solvability sweep: ${swept} sampled dailies all winnable`);

console.log("\nAll hustle tests passed.");
