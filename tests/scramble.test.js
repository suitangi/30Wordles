// Headless tests for js/scramble.js. Loads the real game script against a
// minimal DOM stub and drives full games through the keyboard handler.
// Run: node tests/scramble.test.js
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
const GAME_URL = "https://suitangi.github.io/30Wordles/days/20";

require(path.join(__dirname, "..", "js", "scramble.js"));
const SCRAMBLE = globalThis.SCRAMBLE;
assert.ok(SCRAMBLE, "scramble.js must expose window.SCRAMBLE");

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
const STORE_KEY = "scramble-day20";

const readSave = () => JSON.parse(globalThis.localStorage.getItem(STORE_KEY));
const dump = () => SCRAMBLE.dump();
const tile = (r, c) => SCRAMBLE.tile(r, c);
const tileLetter = (r, c) => tile(r, c).children[0].textContent;
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

function dailyGame() { SCRAMBLE.daily(); }
function seedDaily(guesses, extra = {}) {
  globalThis.localStorage.setItem(STORE_KEY, JSON.stringify({
    date: SCRAMBLE.todayKey(),
    answer: SCRAMBLE.answerFor(SCRAMBLE.todayKey()),
    guesses, done: false, won: false, gaveUp: false, ...extra,
  }));
  dailyGame();
}
// the deal for a word on row r, rebuilt from the spec
const shownFor = (w, r) => (w === dump().answer ? w : SCRAMBLE.scramble(w, dump().perms[r]));
// the word that deals INTO a on row r
function unpermute(a, perm) {
  const w = Array(5);
  for (let k = 0; k < 5; k++) w[perm[k] - 1] = a[k];
  return w.join("");
}

// ---------- 1. word list sanity ----------

assert.equal(ANSWERS.length, 2315, "answers count");
assert.equal(DICT.size, 14855, "guessable count");
for (const w of ANSWERS) {
  assert.match(w, /^[a-z]{5}$/, `answer "${w}" shape`);
  assert.ok(DICT.has(w), `answer "${w}" must be guessable`);
}
console.log("ok — word lists (2315 answers, 14855 guessable)");

// ---------- 2. the deal itself: the spec's example ---------------------------

assert.equal(SCRAMBLE.scramble("shout", [3, 4, 1, 5, 2]), "ousth",
  "SHOUT under 3,4,1,5,2 reads OUSTH — the spec's example, letter for letter");
assert.equal(SCRAMBLE.ROWS, 6, "six guesses");
console.log("ok — the deal: shout + 3,4,1,5,2 = ousth; six rows");

// ---------- 3. fresh daily: six dealt rows, deterministic ---------------------

store.clear();
dailyGame();

const freshAnswer = SCRAMBLE.answerFor(SCRAMBLE.todayKey());
const perms1 = dump().perms;
assert.equal(dump().answer, freshAnswer, "the daily answer is date-derived");
assert.equal(board.children.length, 6, "six rows stand from the start");
for (let r = 0; r < 6; r++) {
  assert.equal(board.children[r].children.length, 5, `row ${r} holds five tiles`);
  const seen = new Set(perms1[r]);
  assert.equal(seen.size, 5, `row ${r}'s deal is a permutation of 1..5`);
  for (let c = 0; c < 5; c++) {
    assert.ok(perms1[r][c] >= 1 && perms1[r][c] <= 5, "slot numbers in range");
    assert.equal(tile(r, c).children[1].textContent, String(perms1[r][c]),
      `tile ${r},${c} wears its slot number`);
    assert.equal(tileLetter(r, c), "", `tile ${r},${c} starts empty`);
  }
  const identity = perms1[r].every((v, i) => v === i + 1);
  assert.ok(!identity, `row ${r} is actually scrambled`);
}
assert.ok(board.children[0].classList.contains("on-row"), "row 1 holds the live ring");
assert.equal(entry.children.length, 5, "the entry strip holds five slots");
assert.ok(!giveUpBtn.classList.contains("hidden"), "give up offered");
assert.ok(shareBtn.classList.contains("hidden"), "no share before an end state");

const save1 = readSave();
assert.equal(save1.date, SCRAMBLE.todayKey(), "save stamped with today");
assert.equal(save1.answer, freshAnswer, "save holds the derived answer");
console.log(`ok — fresh daily: ${save1.date}, answer ${freshAnswer}, six deals dealt (${perms1.map((p) => p.join("")).join(" ")})`);

// determinism: a refresh re-deals the exact same rows
dailyGame();
assert.deepEqual(dump().perms, perms1, "the deals reproduce exactly");
console.log("ok — the deals are deterministic across refreshes");

// ---------- 4. the entry strip: typing, refusals ------------------------------

{
  keydown("h");
  keydown("o");
  assert.deepEqual(entryLetters(), ["h", "o", "", "", ""], "letters land in typed order, unscrambled");
  // the letters deal themselves live onto the waiting row
  const P0 = dump().perms[0];
  assert.equal(tileLetter(0, P0.indexOf(1)), "h", "the tile taking slot 1 shows h live");
  assert.equal(tileLetter(0, P0.indexOf(2)), "o", "the tile taking slot 2 shows o live");
  assert.ok(tile(0, P0.indexOf(1)).classList.contains("filled"), "the dealt tile lights up");
  keydown("Backspace");
  assert.deepEqual(entryLetters(), ["h", "", "", "", ""], "backspace erases");
  assert.equal(tileLetter(0, P0.indexOf(2)), "", "the deal follows the backspace");
  clearTyped();
  assert.equal(tileLetter(0, P0.indexOf(1)), "", "an empty entry deals nothing");

  typeRow("cran");
  assert.equal(toast.textContent, "Not enough letters", "short words are refused");
  assert.deepEqual(dump().guesses, [], "the refusal spends nothing");
  clearTyped();

  typeRow("qqqqz");
  assert.equal(toast.textContent, "Not in word list", "non-words are refused");
  assert.deepEqual(dump().guesses, [], "still nothing spent");
  assert.deepEqual(entryLetters(), ["q", "q", "q", "q", "z"], "a refused word keeps its letters");
  for (let c = 0; c < 5; c++) {
    assert.equal(tileLetter(0, c), "qqqqz"[dump().perms[0][c] - 1],
      "the refused word stays dealt on the row for editing");
  }
  clearTyped();
  assert.deepEqual(entryLetters(), ["", "", "", "", ""], "cleared");
}
console.log("ok — the entry strip: typed order, live dealing, refusals keep the letters");

// ---------- 5. a dealt guess: the scramble is what's judged -------------------

{
  const w = "hoist";
  typeRow(w);
  const shown = shownFor(w, 0);
  const marks = SCRAMBLE.evaluate(shown, freshAnswer);
  assert.deepEqual(dump().guesses, [w], "the typed word is saved");
  assert.equal(dump().rows[0], shown, "the row shows the deal");
  for (let c = 0; c < 5; c++) {
    assert.equal(tileLetter(0, c), shown[c], `tile ${c} holds its dealt letter`);
    assert.equal(tileMark(0, c), marks[c], `tile ${c} is judged as displayed`);
  }
  assert.deepEqual(entryLetters(), ["", "", "", "", ""], "the entry cleared");
  assert.ok(!board.children[0].classList.contains("on-row"), "the dealt row hands over the ring");
  assert.ok(board.children[1].classList.contains("on-row"), "the ring moved to row 2");
  for (let c = 0; c < 5; c++) {
    const key = keyFor(shown[c]);
    assert.ok(key.classList.contains(marks[c]) || marks[c] === A,
      `the keyboard heard ${shown[c]}`);
  }
  keyFor(shown[0]).classList.contains(marks[0]) || marks[0] === "absent";
}
console.log("ok — a dealt guess: the scramble lands on the row and is what's judged");

// ---------- 6. the lift: typing the answer wins in order ----------------------

store.clear();
SCRAMBLE.practice("crane");
{
  typeRow("crane");
  assert.equal(dump().won, true, "typing the answer wins");
  for (let c = 0; c < 5; c++) {
    assert.equal(tileLetter(0, c), "crane"[c], "the word lands in order");
    assert.equal(tileMark(0, c), K, "five greens");
  }
  assert.ok(board.children[0].classList.contains("unscrambled"),
    "the scramble lifted (the row's numbers retired)");
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
  assert.equal(lines[0], "Scramble · practice · 1/6", "share carries the count over six");
  assert.equal(lines[1], GAME_URL, "share links to the game");
  assert.equal(lines[2], "\uD83D\uDFE9".repeat(5), "the win shares five greens");
}
console.log("ok — the lift: the answer typed lands in order, five greens, 1/6");

// ---------- 7. the long way: a word that deals INTO the answer ----------------

// Fix the practice rng so the deals are stable, then hunt an answer with
// a row whose deal carries a real word into it. The game deals to the
// WAITING row, so the plan is: fill rows with junk until the qualifying
// row is up, then deal the word that lands on the answer.
Math.random = () => 0.42;
{
  SCRAMBLE.practice("crane");
  const P = dump().perms;
  let pick = null;
  for (let r = 0; r < 6 && !pick; r++) {
    for (const a of ANSWERS) {
      const w = unpermute(a, P[r]);
      if (w !== a && DICT.has(w)) { pick = { a, r, w }; break; }
    }
  }
  assert.ok(pick, "some answer deals out of a real word");
  SCRAMBLE.practice(pick.a);
  assert.deepEqual(dump().perms, P, "the fixed rng re-deals the same rows");
  for (let j = 0; j < pick.r; j++) {
    typeRow("hoist"); // junk to reach the qualifying row
    assert.ok(!dump().won, "the filler never wins by accident");
  }
  typeRow(pick.w);
  assert.equal(dump().guesses[pick.r], pick.w, `typed ${pick.w} on row ${pick.r + 1}`);
  assert.equal(dump().rows[pick.r], pick.a, "the deal spells the answer");
  for (let c = 0; c < 5; c++) assert.equal(tileMark(pick.r, c), K, "five greens through the deal");
  assert.equal(dump().won, true, "won the long way");
  assert.ok(!board.children[pick.r].classList.contains("unscrambled"),
    "no lift — the deal did the work, the numbers stay");
  assert.ok(tile(pick.r, 0).classList.contains("win-glow"), "the win glows");
}
shareBtn.click();
{
  const ta = createdEls.filter((e) => e.tagName === "textarea").pop();
  assert.equal(ta.value.split("\n")[0].endsWith("/6"), true, "the long way shares its count");
}
console.log("ok — the long way: a real word dealt into the answer, numbers still standing");

// ---------- 8. six misses end it ----------------------------------------------

store.clear();
SCRAMBLE.practice("crane");
{
  const a = dump().answer;
  const P = dump().perms;
  const pool = ["hoist", "words", "plain", "scope", "dealt", "crank",
    "spume", "thorn", "grind", "flask"];
  const six = pool.filter((w) => DICT.has(w))
    .filter((w, i) => i >= 6 || SCRAMBLE.scramble(w, P[i]) !== a)
    .slice(0, 6);
  assert.equal(six.length, 6, "six safe fillers found");
  for (let i = 0; i < 6; i++) {
    typeRow(six[i]);
    if (i < 5) assert.equal(dump().done, false, `alive after ${i + 1} deals`);
  }
  assert.equal(dump().done, true, "the sixth deal ends it");
  assert.equal(dump().won, false, "lost");
  assert.ok(!shareBtn.classList.contains("hidden"), "share offered");
  keydown("a");
  assert.equal(dump().guesses.length, 6, "board locked at six");
}
shareBtn.click();
{
  const ta = createdEls.filter((e) => e.tagName === "textarea").pop();
  assert.equal(ta.value.split("\n")[0], "Scramble · practice · X/6", "exhaustion tagged X/6");
}
console.log("ok — exhaustion: six deals, the loss named, X/6");

// ---------- 9. give up ----------------------------------------------------------

store.clear();
SCRAMBLE.practice("crane");
{
  keydown("c");
  keydown("r");
  giveUpBtn.click();
  assert.deepEqual(entryLetters(), ["", "", "", "", ""], "the half-typed word cleared");
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
    "Scramble · practice · gave up · 0/6", "surrender tagged in the share");
}
console.log("ok — give up: clears the entry, retires the ring, shares gave up · N/6");

// ---------- 10. refresh mid-game: deals and marks restored ---------------------

store.clear();
dailyGame();
{
  const gs = ["hoist", "words"];
  seedDaily(gs);
  assert.equal(board.children.length, 6, "six rows rebuilt");
  assert.deepEqual(dump().perms, perms1, "the same deals came back");
  gs.forEach((w, r) => {
    const shown = shownFor(w, r);
    const marks = SCRAMBLE.evaluate(shown, dump().answer);
    for (let c = 0; c < 5; c++) {
      assert.equal(tileLetter(r, c), shown[c], `row ${r + 1} repainted with its deal`);
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
  assert.ok(board.children[2].classList.contains("unscrambled"),
    "the lift restored");
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
console.log("ok — refresh mid-game and after the end: deals, lift and loss all restored");

// ---------- 11. corrupt saves ----------------------------------------------------

dailyGame();
const derived = SCRAMBLE.answerFor(SCRAMBLE.todayKey());
const good = { date: SCRAMBLE.todayKey(), answer: derived, guesses: [],
  done: false, won: false, gaveUp: false };
for (const bad of [
  { ...good, answer: "qqqqz" },                    // not a word
  { ...good, answer: 42 },                         // not a string
  { date: SCRAMBLE.todayKey(), guesses: [] },      // no answer
  { ...good, guesses: "crane" },                   // not an array
  { ...good, guesses: ["qqqqz"] },                 // non-word guess
  { ...good, guesses: ["crane".slice(0, 4)] },     // wrong length
  { ...good, guesses: Array(7).fill("hoist") },    // seven deals
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

// ---------- 12. practice: isolation, forced words, dump --------------------------

const saveBeforePractice = globalThis.localStorage.getItem(STORE_KEY);
const craneIdx = ANSWERS.indexOf("crane");
const stubAnswer = ANSWERS[Math.floor(0.42 * ANSWERS.length)];

SCRAMBLE.practice();
assert.equal(toast.textContent, "Practice round", "practice announced by toast");
assert.equal(newBtn.textContent, "Today\u2019s puzzle", "button offers the way back");
assert.equal(dump().answer, stubAnswer, "random word honors the Math.random stub");

SCRAMBLE.practice("qqqqz");
assert.ok(DICT.has(dump().answer), "invalid forced word rejected");

const d = dump();
for (const field of ["answer", "perms", "guesses", "typed", "rows",
  "practice", "done", "won", "gaveUp", "save"]) {
  assert.ok(field in d, `dump exposes ${field}`);
}
assert.equal(globalThis.localStorage.getItem(STORE_KEY), saveBeforePractice,
  "practice never touches the daily save");

newBtn.click();
assert.equal(newBtn.textContent, "Practice", "button back to Practice");
console.log("ok — practice: forced words, dump, no daily writes");

// ---------- 13. solvability sweep: the lift always wins --------------------------

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

console.log("\nAll scramble tests passed.");
