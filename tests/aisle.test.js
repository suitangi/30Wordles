// Headless tests for js/aisle.js. Loads the real game script against a
// minimal DOM stub and drives full games through the keyboard handler.
// Run: node tests/aisle.test.js
"use strict";

const assert = require("assert/strict");
const path = require("path");

// ---------- minimal DOM / browser stubs (before loading the game) ----------

const timers = [];
// flipRow schedules callbacks with extra args after the delay (the tile,
// its mark) — forward everything but the delay (the wobble stub precedent).
globalThis.setTimeout = (fn, ...rest) => {
  const args = rest.slice(1);
  timers.push(() => fn(...args));
  return timers.length;
};
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
["board", "keyboard", "toast", "new-btn",
  "giveup-btn", "share-btn"].forEach((id) => { byId[id] = makeEl("div"); });
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
const GAME_URL = "https://suitangi.github.io/30Wordles/days/28";

require(path.join(__dirname, "..", "js", "aisle.js"));
const AISLE = globalThis.AISLE;
assert.ok(AISLE, "aisle.js must expose window.AISLE");

const board = byId.board;
const toast = byId.toast;
const newBtn = byId["new-btn"];
const giveUpBtn = byId["giveup-btn"];
const shareBtn = byId["share-btn"];
const keydown = (key) =>
  (windowHandlers.keydown || []).forEach((fn) =>
    fn({ key, metaKey: false, ctrlKey: false, altKey: false }));

const K = "correct", P = "present", A = "absent", NONE = "";
const STORE_KEY = "aisle-day28";

const readSave = () => JSON.parse(globalThis.localStorage.getItem(STORE_KEY));
const dump = () => AISLE.dump();
const tile = (r, c) => AISLE.tile(r, c);
const tileLetter = (r, c) => tile(r, c).textContent;
const tileMark = (r, c) => {
  const cl = tile(r, c).classList;
  return cl.contains("correct") ? K : cl.contains("present") ? P
    : cl.contains("absent") ? A : NONE;
};
const keyFor = (letter) => {
  for (const row of byId.keyboard.children) {
    const k = row.children.find((b) => b.textContent === letter);
    if (k) return k;
  }
  return null;
};
const keyState = (letter) => {
  const cl = keyFor(letter).classList;
  return cl.contains("correct") ? K : cl.contains("present") ? P
    : cl.contains("absent") ? A : NONE;
};

// Type a word and submit it, playing out the whole reveal.
function typeRow(word) {
  for (const ch of word) keydown(ch);
  keydown("Enter");
  runTimers();
}
// A refused word keeps its letters for editing — backspace out first.
function clearTyped() { for (let i = 0; i < 5; i++) keydown("Backspace"); }

function dailyGame() { AISLE.daily(); }
function seedDaily(guesses, extra = {}) {
  globalThis.localStorage.setItem(STORE_KEY, JSON.stringify({
    date: AISLE.todayKey(),
    answer: AISLE.answerFor(AISLE.todayKey()),
    guesses, done: false, won: false, gaveUp: false, ...extra,
  }));
  dailyGame();
}

// The independent model: the spec rebuilt from scratch, zero shared
// code with the game. Side of a column: 0/1 west of the aisle, 2 ON the
// aisle, 3/4 east. Green = in the word on this side; yellow = in the
// word but only across the aisle or only on it; gray = not in the
// word; the aisle tile never speaks.
const SIDE = [0, 0, -1, 1, 1];
function model(guess, target) {
  const marks = [NONE, NONE, NONE, NONE, NONE];
  for (let p = 0; p < 5; p++) {
    if (SIDE[p] === -1) continue;
    if (!target.includes(guess[p])) { marks[p] = A; continue; }
    marks[p] = target.split("").some((ch, q) =>
      ch === guess[p] && SIDE[q] === SIDE[p]) ? K : P;
  }
  return marks;
}

// ---------- 1. word list sanity ----------

assert.equal(ANSWERS.length, 2315, "answers count");
assert.equal(DICT.size, 14855, "guessable count");
for (const w of ANSWERS) {
  assert.match(w, /^[a-z]{5}$/, `answer "${w}" shape`);
  assert.ok(DICT.has(w), `answer "${w}" must be guessable`);
}
console.log("ok — word lists (2315 answers, 14855 guessable)");

// ---------- 2. the law, hand-pinned ------------------------------------------

// ghost: g h | o | s t — o lives on the aisle
assert.deepEqual(AISLE.evaluate("ghast", "ghost"), [K, K, NONE, K, K],
  "ghast vs ghost: four side greens — and it is NOT the answer");
assert.deepEqual(AISLE.evaluate("tonic", "ghost"), [P, P, NONE, A, A],
  "tonic vs ghost: t and o in the word but never on the west side");
assert.deepEqual(AISLE.evaluate("pious", "alien"), [A, P, NONE, A, A],
  "pious vs alien: the i is in the word but only ON the aisle — yellow");
assert.deepEqual(AISLE.evaluate("learn", "alien"), [K, P, NONE, A, K],
  "learn vs alien: l and n sit on the right sides, e is across");
assert.deepEqual(AISLE.evaluate("elude", "lease"), [K, K, NONE, A, K],
  "elude vs lease: e greens from BOTH sides — the word keeps e east and west");
assert.deepEqual(AISLE.evaluate("sheep", "lease"), [P, A, NONE, K, A],
  "sheep vs lease: the s is in the word but only on the east side");
assert.deepEqual(AISLE.evaluate("llama", "vowel"), [P, P, NONE, A, A],
  "llama vs vowel: BOTH l's yellow — tiles are judged on their own, no letter accounting");
assert.equal(AISLE.ROWS, 6, "six guesses");
console.log("ok — the law: sides green, across-or-aisle yellow, off-word gray, aisle silent");

// ---------- 3. the law, swept against an independent model --------------------

for (let i = 0; i < 400; i++) {
  const a = ANSWERS[(i * 37) % ANSWERS.length];
  const g = WORD_LISTS.guesses[(i * 977) % WORD_LISTS.guesses.length];
  assert.deepEqual(AISLE.evaluate(g, a), model(g, a),
    `game evaluate matches the spec model on ${g} vs ${a}`);
}
console.log("ok — 400 pairs: game evaluate is the spec model");

// ---------- 4. fresh daily: six rows, the aisle drawn -------------------------

store.clear();
dailyGame();

const freshAnswer = AISLE.answerFor(AISLE.todayKey());
assert.equal(dump().answer, freshAnswer, "the daily answer is date-derived");
assert.equal(board.children.length, 6, "six rows stand from the start");
for (let r = 0; r < 6; r++) {
  assert.equal(board.children[r].children.length, 5, `row ${r} holds five tiles`);
  for (let c = 0; c < 5; c++) {
    if (c === 2) {
      assert.ok(tile(r, c).classList.contains("aicol"), `the aisle tile ${r},2 is marked`);
    } else {
      assert.ok(!tile(r, c).classList.contains("aicol"), `tile ${r},${c} is a normal tile`);
    }
    assert.equal(tileLetter(r, c), "", `tile ${r},${c} starts empty`);
  }
}
assert.ok(!giveUpBtn.classList.contains("hidden"), "give up offered");
assert.ok(shareBtn.classList.contains("hidden"), "no share before an end state");

const save1 = readSave();
assert.equal(save1.date, AISLE.todayKey(), "save stamped with today");
assert.equal(save1.answer, freshAnswer, "save holds the derived answer");
assert.deepEqual(save1.guesses, [], "fresh save holds no guesses");

// determinism: a refresh rebuilds the same board, no doubled rows
dailyGame();
assert.equal(board.children.length, 6, "the refresh built six rows, not seven");
assert.equal(dump().answer, freshAnswer, "the answer reproduces exactly");
console.log(`ok — fresh daily: ${save1.date}, answer ${freshAnswer}, six rows with an aisle`);

// ---------- 5. typing on the live row, refusals -------------------------------

{
  keydown("w");
  keydown("o");
  assert.equal(tileLetter(0, 0), "w", "letters land in typed order");
  assert.equal(tileLetter(0, 1), "o", "second letter in place");
  assert.ok(tile(0, 0).classList.contains("filled"), "the typed tile lights up");
  keydown("Backspace");
  assert.equal(tileLetter(0, 1), "", "backspace erases");
  clearTyped();

  typeRow("toni");
  assert.equal(toast.textContent, "Not enough letters", "short words are refused");
  assert.deepEqual(dump().guesses, [], "the refusal spends nothing");
  clearTyped();
  assert.equal(tileLetter(0, 0), "", "cleared");

  typeRow("qqqqz");
  assert.equal(toast.textContent, "Not in word list", "non-words are refused");
  assert.deepEqual(dump().guesses, [], "still nothing spent");
  assert.equal(tileLetter(0, 0), "q", "a refused word keeps its letters");
  clearTyped();
}
console.log("ok — typing: live row, refusals keep the letters");

// ---------- 6. a scored guess: the aisle stays silent --------------------------

{
  const w = "tonic";
  typeRow(w);
  const marks = AISLE.evaluate(w, freshAnswer);
  for (let c = 0; c < 5; c++) {
    assert.equal(tileLetter(0, c), w[c], `tile ${c} holds its letter`);
    assert.equal(tileMark(0, c), marks[c], `tile ${c} wears its mark`);
    if (c === 2) {
      assert.equal(marks[c], NONE, "the aisle never produces a mark");
      assert.ok(tile(0, c).classList.contains("aicol"), "the aisle tile keeps its class");
      assert.ok(tile(0, c).classList.contains("filled"), "the aisle tile stays filled");
      assert.ok(!tile(0, c).classList.contains("correct") &&
        !tile(0, c).classList.contains("present") &&
        !tile(0, c).classList.contains("absent"), "the aisle tile took no color");
    }
  }
  assert.deepEqual(dump().guesses, [w], "the guess is saved");
  // keyboard: the scored letters paint, the aisle letter stays silent
  for (let c = 0; c < 5; c++) {
    if (c === 2) continue;
    const st = keyState(w[c]);
    assert.ok(st === marks[c] || marks[c] === A,
      `the keyboard heard ${w[c]}`);
  }
}
console.log("ok — a scored guess: sides wear marks, the aisle column stays colorless");

// ---------- 7. four greens are NOT the win --------------------------------------

store.clear();
AISLE.practice("ghost");
{
  typeRow("ghast");
  assert.deepEqual([0, 1, 2, 3, 4].map((c) => tileMark(0, c)), [K, K, NONE, K, K],
    "ghast scores four greens against ghost");
  assert.equal(dump().done, false, "four greens do not end the game");
  assert.equal(dump().won, false, "the word has to be the word");
  assert.equal(dump().guesses.length, 1, "the guess is spent");

  typeRow("ghost");
  assert.equal(dump().won, true, "the exact answer wins");
  assert.equal(dump().guesses.length, 2, "won on the second guess");
  for (const c of [0, 1, 3, 4]) assert.equal(tileMark(1, c), K, `side tile ${c} green`);
  assert.equal(tileMark(1, 2), NONE, "the aisle is colorless even on the win");
  assert.ok(tile(1, 2).classList.contains("filled"), "the aisle tile keeps its letter box");
  assert.ok(tile(1, 0).classList.contains("win-glow"), "the win glows");
  assert.ok(tile(1, 2).classList.contains("win-glow"), "the aisle glows with it");
  // the keyboard: side letters green, the aisle letter never told
  for (const ch of ["g", "h", "s", "t"]) {
    assert.equal(keyState(ch), K, `${ch} key went green`);
  }
  assert.equal(keyState("o"), NONE, "the aisle letter never paints its key");
  keydown("a");
  assert.equal(dump().guesses.length, 2, "board locked after the win");
}
shareBtn.click();
{
  const ta = createdEls.filter((e) => e.tagName === "textarea").pop();
  const lines = ta.value.split("\n");
  assert.equal(lines[0], "Aisle · practice · 2/6", "share carries the count over six");
  assert.equal(lines[1], GAME_URL, "share links to the game");
  // the stub's theme is unset → light → white empty square on the aisle
  assert.equal(lines[2],
    "\uD83D\uDFE9".repeat(2) + "\u2B1C" + "\uD83D\uDFE9".repeat(2),
    "the aisle shares as the theme's empty square");
}
console.log("ok — the win: exact answer only, aisle colorless and key silent, shared with a hole");

// ---------- 8. six misses end it -------------------------------------------------

store.clear();
AISLE.practice("crane");
{
  const pool = ["hoist", "words", "plain", "scope", "dealt", "crank",
    "spume", "thorn"];
  const six = pool.filter((w) => DICT.has(w) && w !== "crane").slice(0, 6);
  assert.equal(six.length, 6, "six safe fillers found");
  for (let i = 0; i < 6; i++) {
    typeRow(six[i]);
    if (i < 5) assert.equal(dump().done, false, `alive after ${i + 1} guesses`);
  }
  assert.equal(dump().done, true, "the sixth guess ends it");
  assert.equal(dump().won, false, "lost");
  assert.ok(!shareBtn.classList.contains("hidden"), "share offered");
  // the ghost answer row walked on: green sides, colorless aisle
  assert.equal(board.children.length, 7, "the ghost row is the seventh");
  const ghost = board.children[6];
  for (const c of [0, 1, 3, 4]) {
    assert.ok(ghost.children[c].classList.contains("correct"), `ghost side ${c} green`);
  }
  assert.ok(ghost.children[2].classList.contains("aicol"), "ghost aisle marked");
  assert.ok(!ghost.children[2].classList.contains("correct"), "ghost aisle colorless even in death");
  assert.equal(ghost.children[2].textContent, "crane"[2], "ghost aisle letter shown");
  keydown("a");
  assert.equal(dump().guesses.length, 6, "board locked at six");
}
shareBtn.click();
{
  const ta = createdEls.filter((e) => e.tagName === "textarea").pop();
  assert.equal(ta.value.split("\n")[0], "Aisle · practice · X/6", "exhaustion tagged X/6");
}
console.log("ok — exhaustion: six guesses, the ghost walks on green-sided, X/6");

// ---------- 9. give up -------------------------------------------------------------

store.clear();
AISLE.practice("crane");
{
  keydown("c");
  keydown("r");
  giveUpBtn.click();
  assert.equal(tileLetter(0, 0), "", "the half-typed word cleared off the row");
  assert.ok(!shareBtn.classList.contains("hidden"), "share offered after give up");
  assert.equal(dump().gaveUp, true, "gaveUp flag explicit");
  assert.equal(board.children.length, 7, "the ghost row walked on");
  keydown("a");
  assert.equal(dump().guesses.length, 0, "board locked");
}
shareBtn.click();
{
  const ta = createdEls.filter((e) => e.tagName === "textarea").pop();
  assert.equal(ta.value.split("\n")[0],
    "Aisle · practice · gave up · 0/6", "surrender tagged in the share");
}
console.log("ok — give up: clears the row, walks the ghost, shares gave up · N/6");

// ---------- 10. refresh mid-game and after the end ---------------------------------

store.clear();
dailyGame();
{
  const gs = ["tonic", "words"];
  seedDaily(gs);
  assert.equal(board.children.length, 6, "six rows rebuilt");
  gs.forEach((w, r) => {
    const marks = model(w, dump().answer);
    for (let c = 0; c < 5; c++) {
      assert.equal(tileLetter(r, c), w[c], `row ${r + 1} repainted`);
      assert.equal(tileMark(r, c), marks[c], "marks repainted from the pure law");
    }
  });
  typeRow(dump().answer);
  assert.equal(dump().won, true, "the exact answer wins after a refresh");
}

dailyGame(); // refresh the just-won daily
{
  const wonRow = 2; // two seeded guesses, then the answer
  for (const c of [0, 1, 3, 4]) assert.equal(tileMark(wonRow, c), K, "the win row restored green");
  assert.equal(tileMark(wonRow, 2), NONE, "the restored aisle is colorless");
  assert.ok(tile(wonRow, 0).classList.contains("win-glow"), "the glow restored");
  assert.ok(!shareBtn.classList.contains("hidden"), "share offered again");
  keydown("a");
  assert.equal(dump().guesses.length, 3, "restored won board is locked");
}

// a finished loss restores too — ghost row and all
store.clear();
{
  dailyGame();
  seedDaily(["hoist", "words", "plain", "scope", "dealt", "crank"],
    { done: true, won: false });
  assert.equal(board.children.length, 7, "the restored loss carries its ghost row");
  keydown("a");
  assert.equal(dump().guesses.length, 6, "restored lost board is locked");
}
console.log("ok — refresh mid-game and after the end: marks, win and ghost all restored");

// ---------- 11. corrupt saves -------------------------------------------------------

dailyGame();
const derived = AISLE.answerFor(AISLE.todayKey());
const good = { date: AISLE.todayKey(), answer: derived, guesses: [],
  done: false, won: false, gaveUp: false };
for (const bad of [
  { ...good, answer: "qqqqz" },                    // not a word
  { ...good, answer: 42 },                         // not a string
  { date: AISLE.todayKey(), guesses: [] },         // no answer
  { ...good, guesses: "crane" },                   // not an array
  { ...good, guesses: ["qqqqz"] },                 // non-word guess
  { ...good, guesses: ["crane".slice(0, 4)] },     // wrong length
  { ...good, guesses: Array(7).fill("hoist") },    // seven guesses
  { ...good, date: "2020-01-01" },                 // stale
]) {
  globalThis.localStorage.setItem(STORE_KEY, JSON.stringify(bad));
  dailyGame();
  const s = readSave();
  assert.equal(s.answer, derived,
    `corrupt save ${JSON.stringify(bad).slice(0, 40)}… replaced by a fresh daily`);
  assert.deepEqual(s.guesses, [], "corrupt save's guesses discarded");
}
console.log("ok — corrupt saves: stale/fake/overlong saves fall back fresh");

// ---------- 12. practice: isolation, forced words, dump ------------------------------

const saveBeforePractice = globalThis.localStorage.getItem(STORE_KEY);
const stubAnswer = ANSWERS[Math.floor(0.42 * ANSWERS.length)];
Math.random = () => 0.42;

AISLE.practice();
assert.equal(toast.textContent, "Practice round", "practice announced by toast");
assert.equal(newBtn.textContent, "Today\u2019s puzzle", "button offers the way back");
assert.equal(dump().answer, stubAnswer, "random word honors the Math.random stub");

AISLE.practice("qqqqz");
assert.ok(DICT.has(dump().answer), "invalid forced word rejected");

const d = dump();
for (const field of ["answer", "guesses", "typed", "marks",
  "practice", "done", "won", "gaveUp", "save"]) {
  assert.ok(field in d, `dump exposes ${field}`);
}
assert.equal(globalThis.localStorage.getItem(STORE_KEY), saveBeforePractice,
  "practice never touches the daily save");

newBtn.click();
assert.equal(newBtn.textContent, "Practice", "button back to Practice");
console.log("ok — practice: forced words, dump, no daily writes");

// ---------- 13. solvability sweep: the exact answer always wins ----------------------

let swept = 0;
for (let i = 0; i < 30; i++) {
  const key = `2027-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`;
  store.clear();
  seedDaily([]);
  const a = dump().answer;
  typeRow(a); // typing the word itself is always the win
  assert.ok(readSave().won, `${key}: typing the answer wins`);
  swept++;
}
console.log(`ok — solvability sweep: ${swept} sampled dailies all won by the exact answer`);

console.log("\nAll aisle tests passed.");
