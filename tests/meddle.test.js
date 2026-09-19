// Headless tests for js/meddle.js. Loads the real game script against a
// minimal DOM stub and drives full games through the keyboard handler.
// Run: node tests/meddle.test.js
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
const GAME_URL = "https://suitangi.github.io/30Wordles/days/5";

require(path.join(__dirname, "..", "js", "meddle.js"));
const MEDDLE = globalThis.MEDDLE;
assert.ok(MEDDLE, "meddle.js must expose window.MEDDLE");

const board = byId.board;
const banner = byId.banner;
const toast = byId.toast;
const newBtn = byId["new-btn"];
const giveUpBtn = byId["giveup-btn"];
const shareBtn = byId["share-btn"];
const keydown = (key) =>
  (windowHandlers.keydown || []).forEach((fn) =>
    fn({ key, metaKey: false, ctrlKey: false, altKey: false }));

// ---------- board map: row r = board.children[r], tile = children[c] ----------

const rowEl = (r) => board.children[r];
const tile = (r, c) => rowEl(r).children[c];
const keyFor = (letter) => {
  for (const row of byId.keyboard.children) {
    const k = row.children.find((b) => b.textContent === letter);
    if (k) return k;
  }
  return null;
};
const readSave = () => JSON.parse(globalThis.localStorage.getItem("meddle-day5"));

// ---------- independent spec of the merge (the whole game in 12 lines) ------

function evalWord(guess, target) {
  const marks = Array(5).fill("absent");
  const remaining = {};
  for (let i = 0; i < 5; i++) {
    if (guess[i] === target[i]) marks[i] = "correct";
    else remaining[target[i]] = (remaining[target[i]] || 0) + 1;
  }
  for (let j = 0; j < 5; j++) {
    if (marks[j] !== "correct" && remaining[guess[j]] > 0) {
      marks[j] = "present";
      remaining[guess[j]]--;
    }
  }
  return marks;
}
const RANK = { absent: 1, present: 2, correct: 3 };
const mergeMarks = (m1, m2) =>
  m1.map((m, i) => (RANK[m2[i]] > RANK[m] ? m2[i] : m));

// Type a word into the active row and submit.
function typeRow(word) {
  for (const ch of word) keydown(ch);
  keydown("Enter");
  runTimers();
}

function dailyGame() {
  MEDDLE.daily();
}

// Force today's daily puzzle to a word pair (optionally with guesses played).
function seedDaily(words, guesses = []) {
  globalThis.localStorage.setItem("meddle-day5", JSON.stringify({
    date: MEDDLE.todayKey(), words, guesses, done: false, won: false, gaveUp: false,
  }));
  dailyGame();
}

function assertRowMarks(r, word, marks) {
  for (let c = 0; c < 5; c++) {
    assert.equal(tile(r, c).textContent, word[c], `tile(${r},${c}) letter`);
    assert.ok(tile(r, c).classList.contains(marks[c]),
      `tile(${r},${c}) shows ${marks[c]} (row "${word}")`);
    assert.ok(!tile(r, c).classList.contains("filled"), `tile(${r},${c}) scored`);
  }
}

// ---------- 1. word list sanity ----------

assert.equal(ANSWERS.length, 2315, "answers count");
assert.equal(DICT.size, 14855, "guessable count");
for (const w of ANSWERS) {
  assert.match(w, /^[a-z]{5}$/, `answer "${w}" shape`);
  assert.ok(DICT.has(w), `answer "${w}" must be guessable`);
}
console.log("ok — word lists (2315 answers, 14855 guessable, answers ⊆ guesses)");

// ---------- 2. evaluate: standard Wordle two-pass, duplicates included ----------

const ev = MEDDLE.evaluate;
assert.deepEqual(ev("crane", "crane"), ["correct", "correct", "correct", "correct", "correct"], "exact match");
assert.deepEqual(ev("crane", "brane"), ["absent", "correct", "correct", "correct", "correct"], "one letter off");
assert.deepEqual(ev("speed", "abode"), ["absent", "absent", "present", "absent", "present"],
  "duplicate guess letters consume target letters once each");
assert.deepEqual(ev("eerie", "erase"), ["correct", "absent", "present", "absent", "correct"],
  "repeated letters: greens first, strays consume target copies in order");
console.log("ok — evaluate: two-pass, duplicates handled");

// ---------- 3. daily words: date-derived, distinct, salted away from 1-4 ----------

function saltHash(s) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}
const bundleAnswerFor = (key) => ANSWERS[saltHash("bundle" + key) % ANSWERS.length];
const subtleAnswerFor = (key) => ANSWERS[saltHash("subtle" + key) % ANSWERS.length];

let diffB = 0;
let diffS = 0;
for (let i = 0; i < 200; i++) {
  const key = `2026-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`;
  const [a, b] = MEDDLE.wordsFor(key);
  assert.equal(a, MEDDLE.wordsFor(key)[0], "wordsFor is deterministic");
  assert.notEqual(a, b, `pair is distinct for ${key}`);
  assert.ok(DICT.has(a) && DICT.has(b), "pair is guessable");
  if (a !== bundleAnswerFor(key) && b !== bundleAnswerFor(key)) diffB++;
  if (a !== subtleAnswerFor(key) && b !== subtleAnswerFor(key)) diffS++;
}
assert.ok(diffB > 190, `pair avoids Bundle's word (${diffB}/200 dates)`);
assert.ok(diffS > 190, `pair avoids Subtle's word (${diffS}/200 dates)`);
console.log(`ok — daily words: deterministic, distinct, salt-differ from Bundle (${diffB}/200) and Subtle (${diffS}/200)`);

// ---------- 4. fresh daily: one waiting row, save seeded ----------

store.clear();
dailyGame();

const freshWords = MEDDLE.wordsFor(MEDDLE.todayKey());
assert.equal(board.children.length, 1, "a single waiting row");
assert.equal(rowEl(0).children.length, 5, "five tiles");
for (let c = 0; c < 5; c++) {
  assert.equal(tile(0, c).textContent, "", `tile(0,${c}) starts empty`);
  assert.ok(tile(0, c).classList.contains("tile"), `tile(0,${c}) is a tile`);
}
assert.ok(!giveUpBtn.classList.contains("hidden"), "give up offered on a fresh board");
assert.ok(shareBtn.classList.contains("hidden"), "no share before an end state");
assert.equal(banner.textContent, "Two words to find", "fresh board announces its progress");

const freshSave = readSave();
assert.equal(freshSave.date, MEDDLE.todayKey(), "save stamped with today");
assert.deepEqual(freshSave.words, freshWords, "daily pair is date-derived");
assert.deepEqual(freshSave.guesses, [], "no guesses yet");
assert.equal(freshSave.done, false, "not done");
console.log(`ok — fresh daily: ${freshSave.date}, words ${freshWords.join("/")} — one empty row`);

// ---------- 5. validation ----------

keydown("c"); keydown("r"); keydown("a"); keydown("t");
keydown("Enter");
runTimers();
assert.equal(toast.textContent, "Not enough letters");
assert.ok(tile(0, 0).classList.contains("shake"), "row shakes on invalid submit");

const BAD = ["qqqqq", "jjjjj", "vvvvv"].find((w) => !DICT.has(w));
assert.ok(BAD, "need an invalid 5-letter test word");
"crat".split("").forEach(() => keydown("Backspace"));
BAD.split("").forEach(keydown);
keydown("Enter");
runTimers();
assert.equal(toast.textContent, "Not in word list");
console.log(`ok — validation rejects short words and "${BAD}"`);

// ---------- 6. merged clues on the board: the whole mechanic ----------

MEDDLE.practice("crane", "cramp");
assert.equal(banner.textContent, "Practice round", "practice banner shown");

// brain: vs crane [a,c,c,a,p], vs cramp [a,c,c,a,a] → merged [a,c,c,a,p]
const brainMarks = mergeMarks(evalWord("brain", "crane"), evalWord("brain", "cramp"));
assert.deepEqual(brainMarks, ["absent", "correct", "correct", "absent", "present"],
  "brain spec: r,a green (both words), n yellow (in crane), b,i gray");
typeRow("brain");
assertRowMarks(0, "brain", brainMarks);
assert.ok(rowEl(1), "a fresh row waits below");
assert.equal(board.children.length, 2, "board grows");

// keyboard: standard colors from the merged marks
assert.ok(keyFor("r").classList.contains("correct"), "r key green");
assert.ok(keyFor("a").classList.contains("correct"), "a key green");
assert.ok(keyFor("n").classList.contains("present"), "n key yellow");
assert.ok(keyFor("b").classList.contains("absent"), "b key gray");
assert.ok(keyFor("i").classList.contains("absent"), "i key gray");

// the all-green trap: crame matches crane OR cramp in every spot, is
// neither secret — every tile greens and the game keeps going.
const crameMarks = mergeMarks(evalWord("crame", "crane"), evalWord("crame", "cramp"));
assert.deepEqual(crameMarks, ["correct", "correct", "correct", "correct", "correct"],
  "crame specs all-green against the pair");
typeRow("crame");
assertRowMarks(1, "crame", crameMarks);
assert.equal(banner.textContent, "Practice round", "no find banner for an all-green non-word");
assert.ok(shareBtn.classList.contains("hidden"), "all green ≠ won: share stays hidden");
assert.equal(board.children.length, 3, "game continues after the trap");
console.log("ok — merged clues: best-of-two per tile, keyboard paints, all-green trap plays on");

// ---------- 7. finding a word: all green, drops out of the clues ----------

typeRow("crane");
assertRowMarks(2, "crane", ["correct", "correct", "correct", "correct", "correct"]);
assert.equal(banner.textContent, "One down \u2014 one to go", "first find announced");
assert.ok(!giveUpBtn.classList.contains("hidden"), "game still open with one word left");
assert.ok(keyFor("n").classList.contains("correct"),
  "keyboard paints normally: n green from the find");

// crane is found: the same word again now scores against cramp alone.
typeRow("crane");
assertRowMarks(3, "crane", evalWord("crane", "cramp"));
assert.ok(!tile(3, 3).classList.contains("correct"),
  "found word no longer meddles: n scores gray vs cramp");
assert.equal(banner.textContent, "One down \u2014 one to go", "no re-find of a found word");
// the keyboard never downgrades: n keeps its green even though cramp has no n
assert.ok(keyFor("n").classList.contains("correct"), "keyboard keeps the best hint so far");

// ---------- 8. finding both: the win ----------

typeRow("cramp");
assert.equal(banner.textContent, "Both words \u2014 5 guesses", "win banner counts the guesses");
assert.ok(shareBtn.classList.contains("hidden") === false, "share appears on the win");
assert.ok(giveUpBtn.classList.contains("hidden"), "give up retires on the win");
assert.equal(board.children.length, 5, "no extra row after the win");

const winSave = readSave();
assert.equal(winSave.done, false, "practice never saves");

// share: stored marks replay as emoji rows, exactly as they were shown
shareBtn.classList.remove("hidden");
shareBtn.click();
const ta = createdEls.filter((e) => e.tagName === "textarea").pop();
assert.ok(ta, "share staged a clipboard textarea");
const lines = ta.value.split("\n");
assert.equal(lines[0], "Meddle · practice · 5 guesses", "practice share header");
assert.equal(lines[1], GAME_URL, "share links to the game");
assert.equal(lines.length, 7, "header + link + one row per guess");
assert.equal(lines[2], "\u2B1C\uD83D\uDFE9\uD83D\uDFE9\u2B1C\uD83D\uDFE8", "brain row");
assert.equal(lines[3], "\uD83D\uDFE9".repeat(5), "crame row (the trap, all green)");
assert.equal(lines[4], "\uD83D\uDFE9".repeat(5), "crane find row");
assert.equal(lines[5], "\uD83D\uDFE9\uD83D\uDFE9\uD83D\uDFE9\u2B1C\u2B1C", "crane-again row vs cramp alone");
assert.equal(lines[6], "\uD83D\uDFE9".repeat(5), "cramp win row");

// finished board is locked
keydown("a");
assert.equal(board.children.length, 5, "no typing after the win");
console.log("ok — find + drop-out + win: banners, saved marks, share rows");

// ---------- 9. refresh mid-game, with a found word: state survives ----------

seedDaily(["crane", "cramp"], [
  { w: "brain", m: mergeMarks(evalWord("brain", "crane"), evalWord("brain", "cramp")) },
]);
dailyGame(); // simulated refresh
assert.equal(board.children.length, 2, "scored row + waiting row");
assertRowMarks(0, "brain",
  mergeMarks(evalWord("brain", "crane"), evalWord("brain", "cramp")));
assert.ok(rowEl(0).classList.contains("quiet"), "restored row skips the entrance animation");
assert.equal(banner.textContent, "Two words to find", "progress banner restored");

typeRow("crane");
assert.equal(banner.textContent, "One down \u2014 one to go", "find works after a refresh");
assertRowMarks(1, "crane", ["correct", "correct", "correct", "correct", "correct"]);

dailyGame(); // refresh again, now with one word found
assert.equal(board.children.length, 3, "two scored rows + a waiting row");
assert.equal(banner.textContent, "One down \u2014 one to go", "found state survived the refresh");
typeRow("crane"); // the found word, again: must score vs cramp only
assertRowMarks(2, "crane", evalWord("crane", "cramp"));

typeRow("cramp");
assert.equal(banner.textContent, "Both words \u2014 4 guesses", "win after refreshes");
let s = readSave();
assert.deepEqual(s.words, ["crane", "cramp"], "pair persisted");
assert.equal(s.done, true, "done saved");
assert.equal(s.won, true, "won saved");
assert.equal(s.guesses.length, 4, "all guesses saved with marks");
console.log("ok — refresh mid-game: rows, marks and the found-word drop-out restore");

// ---------- 10. refresh after finishing: completed board, frozen ----------

dailyGame();
assert.equal(board.children.length, 4, "finished board restored");
assert.equal(banner.textContent, "Both words \u2014 4 guesses", "win banner restored");
assert.ok(!shareBtn.classList.contains("hidden"), "share offered again");
keydown("a");
assert.equal(board.children.length, 4, "restored finished board is locked");
console.log("ok — refresh after finishing: completed board and lock restored");

// ---------- 11. give up: the loss path, before and after a find ----------

seedDaily(["crane", "cramp"]);
typeRow("hoist");
typeRow("crane"); // find one first
giveUpBtn.click();
assert.equal(banner.textContent, "The words were CRANE & CRAMP", "give up reveals both words");
assert.ok(giveUpBtn.classList.contains("hidden"), "give up retires after use");
assert.ok(!shareBtn.classList.contains("hidden"), "share offered after give up");
const gaveUp = readSave();
assert.equal(gaveUp.done, true, "give up saved done");
assert.equal(gaveUp.won, false, "give up saved not won");
assert.equal(gaveUp.gaveUp, true, "gaveUp flag explicit");
assert.equal(gaveUp.guesses.length, 2, "guesses kept in the save");
assert.equal(board.children.length, 2, "the waiting row goes with it");
keydown("a");
assert.equal(board.children.length, 2, "board locked after give up");

shareBtn.click();
const gta = createdEls.filter((e) => e.tagName === "textarea").pop();
assert.match(gta.value.split("\n")[0],
  /^Meddle · \d{4}-\d{2}-\d{2} · gave up · 1\/2 · 2 guesses$/,
  "give-up share tags the surrender and the found count");

dailyGame(); // refresh
assert.equal(board.children.length, 2, "given-up board restored");
assert.equal(banner.textContent, "The words were CRANE & CRAMP", "loss banner restored");
assert.ok(giveUpBtn.classList.contains("hidden"), "give up stays retired");
assert.ok(!shareBtn.classList.contains("hidden"), "share still offered");
keydown("a");
assert.equal(board.children.length, 2, "restored board stays locked");
console.log("ok — give up: reveals both, saves the loss, restores locked");

// ---------- 12. next day: fresh puzzle ----------

s = readSave();
s.date = "1999-12-31";
globalThis.localStorage.setItem("meddle-day5", JSON.stringify(s));
dailyGame();

s = readSave();
assert.notEqual(s.date, "1999-12-31", "stale save replaced");
assert.equal(s.date, MEDDLE.todayKey(), "re-stamped with today");
assert.deepEqual(s.words, MEDDLE.wordsFor(MEDDLE.todayKey()), "new day, new daily pair");
assert.deepEqual(s.guesses, [], "guesses reset");
assert.equal(board.children.length, 1, "back to a single row");
assert.equal(banner.textContent, "Two words to find", "banner back to the start");
console.log("ok — next day: fresh board and a new date-derived pair");

// ---------- 13. corrupt saves fall back to a fresh game ----------

for (const bad of [
  { date: MEDDLE.todayKey(), words: ["crane", "crane"], guesses: [] },  // equal pair
  { date: MEDDLE.todayKey(), words: ["crane"], guesses: [] },           // one word
  { date: MEDDLE.todayKey(), words: ["qqqqq", "crane"], guesses: [] },  // not words
  { date: MEDDLE.todayKey(), guesses: [] },                             // no words
]) {
  globalThis.localStorage.setItem("meddle-day5", JSON.stringify(bad));
  dailyGame();
  s = readSave();
  assert.deepEqual(s.words, MEDDLE.wordsFor(MEDDLE.todayKey()),
    `invalid pair ${JSON.stringify(bad.words)} replaced by the daily pair`);
  assert.notDeepEqual(s.words[0], s.words[1], "replacement pair is distinct");
}
console.log("ok — corrupt saves: equal/short/fake/missing pairs all fall back fresh");

// ---------- 14. practice: forced pair, random pair, daily save untouched ----------

const saveBeforePractice = globalThis.localStorage.getItem("meddle-day5");
const craneIdx = ANSWERS.indexOf("crane");
const lastIdx = ANSWERS.length - 1;
// alternate picks so randomWords()'s distinct-pair loop terminates
let rngFlip = 0;
Math.random = () =>
  ([(craneIdx + 0.5) / ANSWERS.length, (lastIdx + 0.5) / ANSWERS.length][rngFlip++ % 2]);

MEDDLE.practice();
assert.equal(banner.textContent, "Practice round", "practice banner shown");
assert.equal(newBtn.textContent, "Today\u2019s puzzle", "button offers the way back");
assert.equal(board.children.length, 1, "practice board fresh");
assert.deepEqual(MEDDLE.dump().words, [ANSWERS[craneIdx], ANSWERS[lastIdx]],
  "random pair honors the Math.random stub and is distinct");
assert.equal(globalThis.localStorage.getItem("meddle-day5"), saveBeforePractice,
  "practice never touches the daily save");

const dump = MEDDLE.dump();
assert.ok(Array.isArray(dump.found) && dump.found.length === 2, "dump exposes found state");
assert.ok(Array.isArray(dump.guesses), "dump exposes guesses");
assert.ok("save" in dump, "dump carries the raw save");

MEDDLE.practice("crane", "brane"); // forced pair, the debugging backdoor
assert.deepEqual(MEDDLE.dump().words, ["crane", "brane"], "forced practice pair honored");
MEDDLE.practice("crane", "crane"); // invalid: falls back to random, still distinct
assert.notEqual(MEDDLE.dump().words[0], MEDDLE.dump().words[1], "invalid forced pair rejected");

newBtn.click(); // back to today's puzzle
assert.equal(newBtn.textContent, "Practice", "button back to Practice");
assert.equal(board.children.length, 1, "daily board fresh again");
assert.ok(!giveUpBtn.classList.contains("hidden"), "give up back for the fresh daily");
console.log("ok — practice: forced + random pairs, no save writes, dump, round-trips to daily");

// ---------- 15. a long game: rows grow, scroll state, restore ----------

seedDaily(["crane", "cramp"]);
board.scrollHeight = 2000; // fake layout: board overflows
board.clientHeight = 300;
const filler = [...DICT].filter((w) => w !== "crane" && w !== "cramp").slice(0, 11);
for (const w of filler) typeRow(w);
assert.ok(board.classList.contains("overflowing"), "overflow fade switches on");
assert.equal(board.scrollTop, 2000, "board auto-scrolls to the active row");
assert.equal(board.children.length, 12, "eleven scored rows + active row");

typeRow("crane");
typeRow("cramp");
assert.equal(banner.textContent, "Both words \u2014 13 guesses", "long game wins with a plain banner");
assert.equal(readSave().guesses.length, 13, "all thirteen guesses saved");

board.scrollHeight = 0; // reset fake layout
dailyGame();
assert.equal(board.children.length, 13, "long board restored");
assert.equal(banner.textContent, "Both words \u2014 13 guesses", "restored banner");
console.log("ok — long game: thirteen guesses persist and restore");

console.log("\nAll meddle tests passed.");
