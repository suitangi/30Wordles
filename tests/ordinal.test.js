// Headless tests for js/ordinal.js. Loads the real game script against a
// minimal DOM stub and drives full games through the keyboard handler.
// Run: node tests/ordinal.test.js
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
["board", "entry", "keyboard", "toast", "new-btn",
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
const GAME_URL = "https://suitangi.github.io/30Wordles/days/27";

require(path.join(__dirname, "..", "js", "ordinal.js"));
const ORDINAL = globalThis.ORDINAL;
assert.ok(ORDINAL, "ordinal.js must expose window.ORDINAL");

const board = byId.board;
const entry = byId.entry;
const toast = byId.toast;
const newBtn = byId["new-btn"];
const giveUpBtn = byId["giveup-btn"];
const shareBtn = byId["share-btn"];
const keydown = (key) =>
  (windowHandlers.keydown || []).forEach((fn) =>
    fn({ key, metaKey: false, ctrlKey: false, altKey: false }));

const K = "correct", P = "present", A = "absent";
const STORE_KEY = "ordinal-day27";
const sorted = (w) => w.split("").sort().join("");

const readSave = () => JSON.parse(globalThis.localStorage.getItem(STORE_KEY));
const dump = () => ORDINAL.dump();
const tile = (r, c) => ORDINAL.tile(r, c);
const tileLetter = (r, c) => tile(r, c).textContent;
const tileMark = (r, c) => {
  const cl = tile(r, c).classList;
  return cl.contains("correct") ? K : cl.contains("present") ? P
    : cl.contains("absent") ? A : "";
};
const keyFor = (letter) => {
  for (const row of byId.keyboard.children) {
    const k = row.children.find((b) => b.textContent === letter);
    if (k) return k;
  }
  return null;
};
const entryLetters = () => entry.children.map((s) => s.textContent);

// Type a word and submit it, playing out the whole reveal.
function typeRow(word) {
  for (const ch of word) keydown(ch);
  keydown("Enter");
  runTimers();
}
// A refused word keeps its letters for editing — backspace out first.
function clearTyped() { for (let i = 0; i < 5; i++) keydown("Backspace"); }

function dailyGame() { ORDINAL.daily(); }
function seedDaily(guesses, extra = {}) {
  globalThis.localStorage.setItem(STORE_KEY, JSON.stringify({
    date: ORDINAL.todayKey(),
    answer: ORDINAL.answerFor(ORDINAL.todayKey()),
    guesses, done: false, won: false, gaveUp: false, ...extra,
  }));
  dailyGame();
}

// ---------- 1. word list sanity ----------

assert.equal(ANSWERS.length, 2315, "answers count");
assert.equal(DICT.size, 14855, "guessable count");
for (const w of ANSWERS) {
  assert.match(w, /^[a-z]{5}$/, `answer "${w}" shape`);
  assert.ok(DICT.has(w), `answer "${w}" must be guessable`);
}
console.log("ok — word lists (2315 answers, 14855 guessable)");

// ---------- 2. the sort itself: the spec's example ----------------------------

assert.equal(ORDINAL.sortWord("crane"), "acenr",
  "CRANE sorts to ACENR — the spec's example, letter for letter");
assert.equal(ORDINAL.sortWord("shout"), "hostu", "SHOUT sorts to HOSTU");
assert.equal(ORDINAL.ROWS, 6, "six guesses");
console.log("ok — the sort: crane = acenr, shout = hostu; six rows");

// ---------- 3. fresh daily: six plain rows, deterministic ---------------------

store.clear();
dailyGame();

const freshAnswer = ORDINAL.answerFor(ORDINAL.todayKey());
assert.equal(dump().answer, freshAnswer, "the daily answer is date-derived");
assert.equal(board.children.length, 6, "six rows stand from the start");
for (let r = 0; r < 6; r++) {
  assert.equal(board.children[r].children.length, 5, `row ${r} holds five tiles`);
  for (let c = 0; c < 5; c++) {
    assert.equal(tile(r, c).children.length, 0,
      `tile ${r},${c} is plain — the sort is fixed, no slot numbers to print`);
    assert.equal(tileLetter(r, c), "", `tile ${r},${c} starts empty`);
  }
}
assert.ok(board.children[0].classList.contains("on-row"), "row 1 holds the live ring");
assert.equal(entry.children.length, 5, "the entry strip holds five slots");
assert.ok(!giveUpBtn.classList.contains("hidden"), "give up offered");
assert.ok(shareBtn.classList.contains("hidden"), "no share before an end state");

const save1 = readSave();
assert.equal(save1.date, ORDINAL.todayKey(), "save stamped with today");
assert.equal(save1.answer, freshAnswer, "save holds the derived answer");
assert.deepEqual(save1.guesses, [], "fresh save holds no guesses");
console.log(`ok — fresh daily: ${save1.date}, answer ${freshAnswer}`);

// determinism: a refresh rebuilds the exact same empty board — and no
// double waiting row (restore of a live zero-guess save, the Tuple bug)
dailyGame();
assert.equal(board.children.length, 6, "the refresh built six rows, not seven");
assert.equal(dump().answer, freshAnswer, "the answer reproduces exactly");
console.log("ok — deterministic across refreshes, no doubled rows");

// ---------- 4. the entry strip: typing, no preview, refusals -------------------

{
  keydown("c");
  keydown("r");
  keydown("a");
  assert.deepEqual(entryLetters(), ["c", "r", "a", "", ""],
    "letters land in typed order in the entry");
  assert.deepEqual([0, 1, 2, 3, 4].map((c) => tileLetter(0, c)),
    ["", "", "", "", ""],
    "the board stays dark while typing — the sort happens on submit");
  keydown("Backspace");
  assert.deepEqual(entryLetters(), ["c", "r", "", "", ""], "backspace erases");
  clearTyped();
  assert.deepEqual(entryLetters(), ["", "", "", "", ""], "cleared");

  typeRow("cran");
  assert.equal(toast.textContent, "Not enough letters", "short words are refused");
  assert.deepEqual(dump().guesses, [], "the refusal spends nothing");
  clearTyped();

  typeRow("tsrpq");
  assert.equal(toast.textContent, "Not in word list", "non-words are refused");
  assert.deepEqual(dump().guesses, [], "still nothing spent");
  assert.deepEqual(entryLetters(), ["t", "s", "r", "p", "q"],
    "a refused word keeps its letters");
  assert.deepEqual([0, 1, 2, 3, 4].map((c) => tileLetter(0, c)),
    ["", "", "", "", ""], "a refused word never reaches the board");
  clearTyped();
  assert.deepEqual(entryLetters(), ["", "", "", "", ""], "cleared");
}
console.log("ok — the entry strip: typed order, no board preview, refusals keep the letters");

// ---------- 5. a sorted guess: the sort is what's judged -----------------------

{
  const w = "hoist";
  typeRow(w);
  const shown = sorted(w); // "hiost"
  const marks = ORDINAL.evaluate(shown, freshAnswer);
  assert.deepEqual(dump().guesses, [w], "the typed word is saved");
  assert.equal(dump().rows[0], shown, "the row shows the sort");
  for (let c = 0; c < 5; c++) {
    assert.equal(tileLetter(0, c), shown[c], `tile ${c} holds its sorted letter`);
    assert.equal(tileMark(0, c), marks[c], `tile ${c} is judged as displayed`);
  }
  assert.deepEqual(entryLetters(), ["", "", "", "", ""], "the entry cleared");
  assert.ok(!board.children[0].classList.contains("on-row"), "the sorted row hands over the ring");
  assert.ok(board.children[1].classList.contains("on-row"), "the ring moved to row 2");
  for (let c = 0; c < 5; c++) {
    const key = keyFor(shown[c]);
    assert.ok(key.classList.contains(marks[c]) || marks[c] === A,
      `the keyboard heard ${shown[c]}`);
  }
}
console.log("ok — a sorted guess: the sort lands on the row and is what's judged");

// ---------- 6. the marks, hand-computed: pound vs donut ------------------------

store.clear();
ORDINAL.practice("donut");
{
  typeRow("pound");
  // pound sorts to dnopu; against donut: d greens, n and o stray yellow,
  // p absent, u yellow — the sort puts stray letters on strange positions
  assert.equal(dump().rows[0], "dnopu", "pound filed as dnopu");
  assert.deepEqual([0, 1, 2, 3, 4].map((c) => tileMark(0, c)),
    [K, P, P, A, P], "dnopu vs donut reads K,P,P,A,P");
}
console.log("ok — hand-pinned: pound → dnopu vs donut = K,P,P,A,P");

// ---------- 7. the lift: typing the answer wins in order -----------------------

store.clear();
ORDINAL.practice("crane");
{
  typeRow("crane");
  assert.equal(dump().won, true, "typing the answer wins");
  assert.deepEqual([0, 1, 2, 3, 4].map((c) => tileLetter(0, c)),
    ["c", "r", "a", "n", "e"], "the word lands in order, not sorted");
  for (let c = 0; c < 5; c++) assert.equal(tileMark(0, c), K, "five greens");
  for (const ch of "crane") {
    assert.ok(keyFor(ch).classList.contains(K), `${ch} key went green`);
  }
  keydown("a");
  assert.equal(dump().guesses.length, 1, "board locked after the win");
}
shareBtn.click();
{
  const ta = createdEls.filter((e) => e.tagName === "textarea").pop();
  const lines = ta.value.split("\n");
  assert.equal(lines[0], "Ordinal · practice · 1/6", "share carries the count over six");
  assert.equal(lines[1], GAME_URL, "share links to the game");
  assert.equal(lines[2], "\uD83D\uDFE9".repeat(5), "the win shares five greens");
}
console.log("ok — the lift: the answer typed lands in order, five greens, 1/6");

// ---------- 8. the long way: a word that sorts INTO the answer -----------------

// The answer itself alphabetized: ghost is already in order, so typing
// its anagram goths sorts straight into five greens — no lift (goths is
// not the answer), the sort did the work.
store.clear();
ORDINAL.practice("ghost");
{
  assert.equal(sorted("ghost"), "ghost", "ghost is already alphabetical");
  typeRow("goths");
  assert.equal(dump().guesses[0], "goths", "the typed word is goths");
  assert.equal(dump().rows[0], "ghost", "the sort spells the answer");
  for (let c = 0; c < 5; c++) assert.equal(tileMark(0, c), K, "five greens through the sort");
  assert.equal(dump().won, true, "won the long way");
  assert.ok(tile(0, 0).classList.contains("win-glow"), "the win glows");
  assert.deepEqual([0, 1, 2, 3, 4].map((c) => tileLetter(0, c)),
    ["g", "h", "o", "s", "t"], "the row shows the sorted letters, not the typing");
}
shareBtn.click();
{
  const ta = createdEls.filter((e) => e.tagName === "textarea").pop();
  assert.equal(ta.value.split("\n")[0], "Ordinal · practice · 1/6",
    "the long way shares its count");
}
console.log("ok — the long way: goths sorts into ghost, five greens, no lift");

// ---------- 9. six misses end it -----------------------------------------------

store.clear();
ORDINAL.practice("crane");
{
  const pool = ["hoist", "words", "plain", "scope", "dealt", "crank",
    "spume", "thorn"];
  const six = pool.filter((w) => DICT.has(w) && sorted(w) !== "crane").slice(0, 6);
  assert.equal(six.length, 6, "six safe fillers found");
  for (let i = 0; i < 6; i++) {
    typeRow(six[i]);
    if (i < 5) assert.equal(dump().done, false, `alive after ${i + 1} sorts`);
  }
  assert.equal(dump().done, true, "the sixth sort ends it");
  assert.equal(dump().won, false, "lost");
  assert.ok(!shareBtn.classList.contains("hidden"), "share offered");
  keydown("a");
  assert.equal(dump().guesses.length, 6, "board locked at six");
}
shareBtn.click();
{
  const ta = createdEls.filter((e) => e.tagName === "textarea").pop();
  assert.equal(ta.value.split("\n")[0], "Ordinal · practice · X/6", "exhaustion tagged X/6");
}
console.log("ok — exhaustion: six sorts, the loss named, X/6");

// ---------- 10. give up ---------------------------------------------------------

store.clear();
ORDINAL.practice("crane");
{
  keydown("c");
  keydown("r");
  giveUpBtn.click();
  assert.deepEqual(entryLetters(), ["", "", "", "", ""], "the half-typed word cleared");
  assert.equal(tileLetter(0, 0), "", "the board row was never touched");
  assert.ok(!board.children[0].classList.contains("on-row"), "the live ring retired");
  assert.ok(!shareBtn.classList.contains("hidden"), "share offered after give up");
  assert.equal(dump().gaveUp, true, "gaveUp flag explicit");
  keydown("a");
  assert.equal(dump().guesses.length, 0, "board locked");
}
shareBtn.click();
{
  const ta = createdEls.filter((e) => e.tagName === "textarea").pop();
  assert.equal(ta.value.split("\n")[0],
    "Ordinal · practice · gave up · 0/6", "surrender tagged in the share");
}
console.log("ok — give up: clears the entry, retires the ring, shares gave up · N/6");

// ---------- 11. refresh mid-game: sorts and marks restored ----------------------

store.clear();
dailyGame();
{
  const gs = ["hoist", "words"];
  seedDaily(gs);
  assert.equal(board.children.length, 6, "six rows rebuilt");
  gs.forEach((w, r) => {
    const shown = sorted(w);
    const marks = ORDINAL.evaluate(shown, dump().answer);
    for (let c = 0; c < 5; c++) {
      assert.equal(tileLetter(r, c), shown[c], `row ${r + 1} repainted with its sort`);
      assert.equal(tileMark(r, c), marks[c], "marks repainted from pure evaluate");
    }
  });
  assert.ok(board.children[2].classList.contains("on-row"), "the ring waits on row 3");
  typeRow(dump().answer); // the lift works after a refresh
  assert.equal(dump().won, true, "won after the refresh");
}

dailyGame(); // refresh the just-won daily
{
  for (let c = 0; c < 5; c++) assert.equal(tileMark(2, c), K, "the win row restored green");
  assert.deepEqual([0, 1, 2, 3, 4].map((c) => tileLetter(2, c)),
    [0, 1, 2, 3, 4].map((c) => dump().answer[c]),
    "the restored win row holds the answer in order");
  assert.ok(tile(2, 0).classList.contains("win-glow"), "the glow restored");
  assert.ok(!shareBtn.classList.contains("hidden"), "share offered again");
  keydown("a");
  assert.equal(dump().guesses.length, 3, "restored won board is locked");
}

// a finished loss restores too
store.clear();
{
  dailyGame();
  seedDaily(["hoist", "words", "plain", "scope", "dealt", "crank"],
    { done: true, won: false });
  keydown("a");
  assert.equal(dump().guesses.length, 6, "restored lost board is locked");
}
console.log("ok — refresh mid-game and after the end: sorts, lift and loss all restored");

// ---------- 12. corrupt saves ----------------------------------------------------

dailyGame();
const derived = ORDINAL.answerFor(ORDINAL.todayKey());
const good = { date: ORDINAL.todayKey(), answer: derived, guesses: [],
  done: false, won: false, gaveUp: false };
for (const bad of [
  { ...good, answer: "qqqqz" },                    // not a word
  { ...good, answer: 42 },                         // not a string
  { date: ORDINAL.todayKey(), guesses: [] },       // no answer
  { ...good, guesses: "crane" },                   // not an array
  { ...good, guesses: ["qqqqz"] },                 // non-word guess
  { ...good, guesses: ["crane".slice(0, 4)] },     // wrong length
  { ...good, guesses: Array(7).fill("hoist") },    // seven sorts
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

// ---------- 13. practice: isolation, forced words, dump --------------------------

const saveBeforePractice = globalThis.localStorage.getItem(STORE_KEY);
const stubAnswer = ANSWERS[Math.floor(0.42 * ANSWERS.length)];
Math.random = () => 0.42;

ORDINAL.practice();
assert.equal(toast.textContent, "Practice round", "practice announced by toast");
assert.equal(newBtn.textContent, "Today\u2019s puzzle", "button offers the way back");
assert.equal(dump().answer, stubAnswer, "random word honors the Math.random stub");

ORDINAL.practice("qqqqz");
assert.ok(DICT.has(dump().answer), "invalid forced word rejected");

const d = dump();
for (const field of ["answer", "guesses", "typed", "rows",
  "practice", "done", "won", "gaveUp", "save"]) {
  assert.ok(field in d, `dump exposes ${field}`);
}
assert.equal(globalThis.localStorage.getItem(STORE_KEY), saveBeforePractice,
  "practice never touches the daily save");

newBtn.click();
assert.equal(newBtn.textContent, "Practice", "button back to Practice");
console.log("ok — practice: forced words, dump, no daily writes");

// ---------- 14. solvability sweep: the lift always wins --------------------------

let swept = 0;
for (let i = 0; i < 30; i++) {
  const key = `2027-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`;
  store.clear();
  seedDaily([]);
  const a = dump().answer;
  typeRow(a); // typing the answer always ends it — the lift
  assert.ok(readSave().won, `${key}: typing the answer wins`);
  swept++;
}
console.log(`ok — solvability sweep: ${swept} sampled dailies all won by the lift`);

console.log("\nAll ordinal tests passed.");
