// Headless tests for js/stifle.js. Loads the real game script against a
// minimal DOM stub and drives full games through the keyboard handler.
// Run: node tests/stifle.test.js
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
const GAME_URL = "https://suitangi.github.io/30Wordles/days/9";

require(path.join(__dirname, "..", "js", "stifle.js"));
const STIFLE = globalThis.STIFLE;
assert.ok(STIFLE, "stifle.js must expose window.STIFLE");

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
const readSave = () => JSON.parse(globalThis.localStorage.getItem("stifle-day9"));

// Type a word and submit it, playing out the whole reveal.
function typeRow(word) {
  for (const ch of word) keydown(ch);
  keydown("Enter");
  runTimers();
}

function dailyGame() {
  STIFLE.daily();
}

// Force today's daily puzzle to an answer (optionally with guesses played).
function seedDaily(answer, guesses = [], extra = {}) {
  globalThis.localStorage.setItem("stifle-day9", JSON.stringify({
    date: STIFLE.todayKey(), answer, guesses, done: false, won: false, gaveUp: false, ...extra,
  }));
  dailyGame();
}

const ev = STIFLE.evaluate;
const M = (marksStr) => marksStr.split("").map((ch) => ({ K: "correct", P: "present", A: "absent" }[ch]));

// "hoist" and "cramp" share no letters, so they can legally alternate —
// neither is ever the answer "crane".
const CHAIN = ["hoist", "cramp", "hoist", "cramp", "hoist", "cramp"];

// ---------- 1. word list sanity ----------

assert.equal(ANSWERS.length, 2315, "answers count");
assert.equal(DICT.size, 14855, "guessable count");
for (const w of ANSWERS) {
  assert.match(w, /^[a-z]{5}$/, `answer "${w}" shape`);
  assert.ok(DICT.has(w), `answer "${w}" must be guessable`);
}
for (const w of ["crane", "hoist", "cramp", "speed", "abode", "qqqqq"]) {
  assert.equal(DICT.has(w), w !== "qqqqq", `test word "${w}" dictionary status`);
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

// ---------- 3. daily word: date-derived, salted away from days 1-8 --------

function saltHash(s) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}
const salted = (salt, key) => ANSWERS[saltHash(salt + key) % ANSWERS.length];

let diff = 0;
for (let i = 0; i < 200; i++) {
  const key = `2026-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`;
  const a = STIFLE.answerFor(key);
  assert.equal(a, STIFLE.answerFor(key), "answerFor is deterministic");
  assert.ok(DICT.has(a), "answer is guessable");
  const others = [
    ANSWERS[saltHash(key) % ANSWERS.length], // Bundle hashes the bare key
    salted("subtle", key), salted("wobble", key), salted("toggle", key),
    salted("meddle", key), salted("meddle-b", key), salted("crumble", key),
    salted("bubble", key), salted("swivel", key), salted("swivel-b", key),
  ];
  if (others.every((w) => w !== a)) diff++;
}
assert.ok(diff > 185, `answer avoids days 1-8's words (${diff}/200 dates)`);
console.log(`ok — daily word: deterministic, salt-differ from days 1-8 (${diff}/200)`);

// ---------- 4. fresh daily: six empty rows, save seeded, nothing stifled ----

store.clear();
dailyGame();

const freshAnswer = STIFLE.answerFor(STIFLE.todayKey());
assert.equal(board.children.length, 6, "six rows");
for (let r = 0; r < 6; r++) {
  assert.equal(rowTiles(r).length, 5, `row ${r} has five tiles`);
  for (const t of rowTiles(r)) {
    assert.ok(t.classList.contains("tile"), "cells are tiles");
    assert.equal(t.textContent, "", "tiles start empty");
    assert.ok(!t.classList.contains("cool"), "tiles never cool");
  }
}
for (const l of "abcdefghijklmnopqrstuvwxyz") {
  assert.ok(!keyFor(l).classList.contains("cool"), `fresh board: ${l} not stifled`);
}
assert.ok(!giveUpBtn.classList.contains("hidden"), "give up offered on a fresh board");
assert.ok(shareBtn.classList.contains("hidden"), "no share before an end state");
assert.equal(banner.textContent, "", "no banner before an end state");

const freshSave = readSave();
assert.equal(freshSave.date, STIFLE.todayKey(), "save stamped with today");
assert.equal(freshSave.answer, freshAnswer, "daily answer is date-derived");
assert.deepEqual(freshSave.guesses, [], "no guesses yet");
console.log(`ok — fresh daily: ${freshSave.date}, answer ${freshAnswer} — six empty rows, nothing stifled`);

// ---------- 5. the cooldown: guess 1's letters vanish for guess 2 ----------

STIFLE.practice("crane");

typeRow("hoist"); // guess 1: no cooldown restricted it
{
  const marks = rowTiles(0).map((t) => t.textContent);
  assert.deepEqual(marks, ["h", "o", "i", "s", "t"], "hoist landed");
  for (const l of "hoist") {
    const k = keyFor(l);
    assert.ok(k.classList.contains("cool"), `${l} is on cooldown`);
    assert.ok(k.classList.contains("absent"), `${l} keeps its earned gray under the outline`);
  }
  assert.deepEqual(STIFLE.dump().stifled, ["h", "o", "i", "s", "t"], "dump reports the stifled letters");
}

// Each of hoist's letters refuses to type; the row stays empty.
for (const l of "hoist") {
  keydown(l);
  assert.equal(toast.textContent, `${l.toUpperCase()} is stifled`, `${l} refuses with a toast`);
  assert.ok([...rowTiles(1)].every((t) => t.textContent === ""), `${l} never lands`);
  keydown("Backspace"); // no-op; keep the pending row clean for the next letter
}

// crane's letters are untouched by hoist's cooldown — c types fine.
keydown("c");
assert.equal(rowTiles(1)[0].textContent, "c", "an un-stifled letter types normally");
keydown("Backspace");

// Guess 2 lands: its letters stifle, guess 1's letters come back.
typeRow("cramp");
{
  for (const l of "cramp") {
    assert.ok(keyFor(l).classList.contains("cool"), `${l} stifled by guess 2`);
  }
  for (const l of "hoist") {
    const k = keyFor(l);
    assert.ok(!k.classList.contains("cool"), `${l} returned after one guess`);
    assert.ok(k.classList.contains("absent"), `${l}'s gray survived the cooldown`);
  }
  keydown("h");
  assert.equal(rowTiles(2)[0].textContent, "h", "a returned letter types again");
  keydown("Backspace");
  keydown("c");
  assert.equal(toast.textContent, "C is stifled", "cramp's letters refuse");
  keydown("Backspace");
}
console.log("ok — the cooldown: guess 1 stifles guess 2, returns for guess 3, marks survive");

// ---------- 6. duplicate letters stifle once, and rank never downgrades ----

STIFLE.practice("abode");
typeRow("speed"); // e twice: one present, one absent — the key keeps present
{
  assert.deepEqual(STIFLE.dump().stifled, ["s", "p", "e", "d"],
    "duplicates stifle the letter once");
  assert.ok(keyFor("e").classList.contains("present"),
    "paintKey upgrades only: the second e's absent never downgrades the key");
  assert.ok(keyFor("d").classList.contains("present"), "d present");
}
console.log("ok — duplicates stifle once; key rank upgrades only");

// ---------- 7. validation ----------

STIFLE.practice("crane");
"crat".split("").forEach(keydown);
keydown("Enter");
runTimers();
assert.equal(toast.textContent, "Not enough letters");
assert.ok(rowTiles(0)[0].classList.contains("shake"), "the row shakes on invalid submit");
keydown("Backspace");
keydown("Backspace");
keydown("Backspace");
keydown("Backspace");
"qqqqq".split("").forEach(keydown);
keydown("Enter");
runTimers();
assert.equal(toast.textContent, "Not in word list");
assert.deepEqual(rowTiles(0).map((t) => t.textContent), ["q", "q", "q", "q", "q"],
  "row keeps the word for fixing");
console.log("ok — validation rejects short words and qqqqq");

// ---------- 8. the win: praised, shared, keyboard fully visible ------------

STIFLE.practice("crane");
const saveBeforeWin = globalThis.localStorage.getItem("stifle-day9");
typeRow("crane");
{
  assert.equal(banner.textContent, "Genius \u2014 1 guess", "win praised");
  assert.ok(!shareBtn.classList.contains("hidden"), "share appears on the win");
  assert.ok(giveUpBtn.classList.contains("hidden"), "give up retires on the win");
  assert.deepEqual(rowTiles(0).map((t) => t.classList.contains("correct")), [true, true, true, true, true],
    "the win row all green");
  // The end state frees the keyboard: the winning letters show their green
  // instead of an outline.
  for (const l of "crane") {
    const k = keyFor(l);
    assert.ok(k.classList.contains("correct"), `${l} green`);
    assert.ok(!k.classList.contains("cool"), `${l} not outlined on a finished board`);
  }
  keydown("a");
  assert.equal(STIFLE.dump().guesses.length, 1, "board locked after the win");
}
assert.equal(globalThis.localStorage.getItem("stifle-day9"), saveBeforeWin,
  "practice never saves");
console.log("ok — the win: praised, locked, keyboard shows every mark");

// ---------- 9. the loss: six alternating misses ------------------------------

seedDaily("crane");
for (const w of CHAIN) typeRow(w);
assert.equal(banner.textContent, "The word was CRANE", "six misses end the game");
assert.ok(!shareBtn.classList.contains("hidden"), "share offered on the loss");
assert.ok(giveUpBtn.classList.contains("hidden"), "give up retired");
const lossSave = readSave();
assert.equal(lossSave.done, true, "loss saved done");
assert.equal(lossSave.won, false, "loss saved not won");
assert.equal(lossSave.guesses.length, 6, "six guesses saved");
for (const l of "hoist") {
  assert.ok(!keyFor(l).classList.contains("cool"), `${l} visible after the final whistle`);
}
keydown("a");
assert.equal(STIFLE.dump().guesses.length, 6, "board locked after the loss");

shareBtn.click();
const lta = createdEls.filter((e) => e.tagName === "textarea").pop();
assert.equal(lta.value.split("\n")[0], `Stifle · ${STIFLE.todayKey()} · X/6`, "loss share reads X/6");

dailyGame();
assert.equal(STIFLE.dump().guesses.length, 6, "lost board restored");
assert.equal(banner.textContent, "The word was CRANE", "loss banner restored");
console.log("ok — exhaustion: the sixth miss loses, shares X/6, restores locked");

// ---------- 10. share format --------------------------------------------------

STIFLE.practice("crane");
typeRow("hoist");
typeRow("crane"); // legal: crane shares no letter with hoist
shareBtn.click();
const ta = createdEls.filter((e) => e.tagName === "textarea").pop();
const lines = ta.value.split("\n");
const SQ = "\u2B1C"; // light theme's absent square
assert.equal(lines[0], "Stifle · practice · 2/6", "practice share header");
assert.equal(lines[1], GAME_URL, "share links to the game");
assert.equal(lines[2], SQ.repeat(5), "hoist vs crane: five strays");
assert.equal(lines[3], "\uD83D\uDFE9".repeat(5), "the win row is five greens");
console.log("ok — share: name · practice/date · N/6, URL, one emoji row per guess");

// ---------- 11. refresh mid-game: cooldown re-derived from the last guess ----

seedDaily("crane", ["hoist", "cramp"]);
dailyGame(); // simulated refresh
{
  assert.deepEqual(rowTiles(0).map((t) => t.textContent), ["h", "o", "i", "s", "t"],
    "hoist restored");
  assert.deepEqual(rowTiles(0).map((t) => t.classList.contains("absent")), [true, true, true, true, true],
    "hoist's marks repainted");
  assert.ok(board.children[0].classList.contains("quiet"), "restored rows are quiet");
  assert.ok(board.children[1].classList.contains("quiet"), "restored rows are quiet");
  for (const l of "cramp") {
    assert.ok(keyFor(l).classList.contains("cool"), `${l} still stifled after the refresh`);
  }
  for (const l of "hoist") {
    assert.ok(!keyFor(l).classList.contains("cool"), `${l} usable after the refresh`);
  }
  keydown("c");
  assert.equal(toast.textContent, "C is stifled", "the restore enforces the cooldown");
  assert.equal(rowTiles(2)[0].textContent, "", "the refused letter never lands");
}
// Play on: hoist is legal again, then crane wins it.
typeRow("hoist");
typeRow("crane");
assert.equal(banner.textContent, "Splendid \u2014 4 guesses", "play continues after a refresh and wins");
console.log("ok — refresh mid-game: marks repainted, cooldown re-derived, play continues");

// ---------- 12. refresh after finishing ---------------------------------------

dailyGame(); // refresh the just-won daily
assert.equal(STIFLE.dump().guesses.length, 4, "finished board restored with all four rows");
assert.equal(banner.textContent, "Splendid \u2014 4 guesses", "won banner restored");
assert.ok(!shareBtn.classList.contains("hidden"), "share offered again");
assert.ok(giveUpBtn.classList.contains("hidden"), "give up stays retired");
for (const l of "crane") {
  assert.ok(!keyFor(l).classList.contains("cool"), `${l} visible on the restored win`);
}
keydown("a");
assert.equal(STIFLE.dump().guesses.length, 4, "restored won board is locked");
console.log("ok — refresh after finishing: banner, share, marks and lock all restored");

// ---------- 13. give up: the loss path and restore -----------------------------

seedDaily("crane");
typeRow("hoist");
giveUpBtn.click();
assert.equal(banner.textContent, "The word was CRANE", "give up reveals the word");
assert.ok(giveUpBtn.classList.contains("hidden"), "give up retires after use");
assert.ok(!shareBtn.classList.contains("hidden"), "share offered after give up");
const gaveUpSave = readSave();
assert.equal(gaveUpSave.done, true, "give up saved done");
assert.equal(gaveUpSave.won, false, "give up saved not won");
assert.equal(gaveUpSave.gaveUp, true, "gaveUp flag explicit");
keydown("a");
assert.equal(STIFLE.dump().guesses.length, 1, "board locked after give up");

shareBtn.click();
const gta = createdEls.filter((e) => e.tagName === "textarea").pop();
assert.match(gta.value.split("\n")[0],
  /^Stifle · \d{4}-\d{2}-\d{2} · gave up · X\/6$/,
  "give-up share tags the surrender");

dailyGame(); // refresh
assert.equal(STIFLE.dump().guesses.length, 1, "given-up board restored");
assert.equal(banner.textContent, "The word was CRANE", "loss banner restored");
assert.ok(giveUpBtn.classList.contains("hidden"), "give up stays retired");
console.log("ok — give up: reveals the word, saves the loss, restores locked");

// ---------- 14. next day: fresh puzzle; corrupt saves fall back ---------------

let s = readSave();
s.date = "1999-12-31";
globalThis.localStorage.setItem("stifle-day9", JSON.stringify(s));
dailyGame();

s = readSave();
assert.notEqual(s.date, "1999-12-31", "stale save replaced");
assert.equal(s.date, STIFLE.todayKey(), "re-stamped with today");
assert.equal(s.answer, STIFLE.answerFor(STIFLE.todayKey()), "new day, new daily word");
assert.deepEqual(s.guesses, [], "guesses reset");
assert.equal(board.children.length, 6, "fresh six rows");

const good = { date: STIFLE.todayKey(), answer: "crane", guesses: [], done: false, won: false, gaveUp: false };
for (const bad of [
  { ...good, answer: "qqqqq" },                    // not a word
  { ...good, answer: 42 },                          // not a string
  { date: STIFLE.todayKey(), guesses: [] },         // no answer
  { ...good, guesses: "crane" },                    // not an array
  { ...good, guesses: ["hoist", "qqqqq"] },         // a non-word guess
  { ...good, guesses: ["cat"] },                    // wrong length
  { ...good, guesses: CHAIN.concat(["crane"]) },    // seven guesses — over the cap
]) {
  globalThis.localStorage.setItem("stifle-day9", JSON.stringify(bad));
  dailyGame();
  s = readSave();
  assert.equal(s.answer, STIFLE.answerFor(STIFLE.todayKey()),
    `corrupt save ${JSON.stringify(bad).slice(0, 60)}… replaced by a fresh daily`);
  assert.deepEqual(s.guesses, [], "corrupt save's guesses discarded");
}
console.log("ok — next day + corrupt saves: stale/fake/overflowing saves fall back fresh");

// ---------- 15. practice: forced word, random word, daily save untouched ------

const saveBeforePractice = globalThis.localStorage.getItem("stifle-day9");
const craneIdx = ANSWERS.indexOf("crane");
Math.random = () => (craneIdx + 0.5) / ANSWERS.length;

STIFLE.practice();
assert.equal(banner.textContent, "Practice round", "practice banner shown");
assert.equal(newBtn.textContent, "Today\u2019s puzzle", "button offers the way back");
assert.equal(board.children.length, 6, "practice board fresh");
assert.equal(STIFLE.dump().answer, ANSWERS[craneIdx], "random word honors the Math.random stub");
assert.deepEqual(STIFLE.dump().stifled, [], "practice starts unstifled");

const d = STIFLE.dump();
assert.ok(Array.isArray(d.guesses), "dump exposes the guesses");
assert.ok(Array.isArray(d.stifled), "dump exposes the stifled letters");
assert.ok("save" in d, "dump carries the raw save");

STIFLE.practice("crane"); // forced word, the debugging backdoor
assert.equal(STIFLE.dump().answer, "crane", "forced practice word honored");
STIFLE.practice("qqqqq"); // invalid: falls back to random, still a word
assert.ok(DICT.has(STIFLE.dump().answer), "invalid forced word rejected");

assert.equal(globalThis.localStorage.getItem("stifle-day9"), saveBeforePractice,
  "practice never touches the daily save");

newBtn.click(); // back to today's puzzle
assert.equal(newBtn.textContent, "Practice", "button back to Practice");
assert.equal(board.children.length, 6, "daily board fresh again");
assert.ok(!giveUpBtn.classList.contains("hidden"), "give up back for the fresh daily");
console.log("ok — practice: forced + random words, no save writes, dump, round-trips to daily");

// ---------- 16. solvability sweep: the answer itself is always legal ----------

let swept = 0;
for (let i = 0; i < 60; i++) {
  const key = `2027-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`;
  seedDaily(STIFLE.answerFor(key));
  typeRow(STIFLE.dump().answer);
  assert.ok(readSave().won, `${key}: typing the answer wins`);
  swept++;
}
console.log(`ok — solvability sweep: ${swept} sampled dailies all winnable (first guess unrestricted)`);

console.log("\nAll stifle tests passed.");
