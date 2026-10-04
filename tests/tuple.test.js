// Headless tests for js/tuple.js. Loads the real game script against a
// minimal DOM stub and drives full games through the keyboard handler.
// Run: node tests/tuple.test.js
"use strict";

const assert = require("assert/strict");
const path = require("path");

// ---------- minimal DOM / browser stubs (before loading the game) ----------

const timers = [];
// flipRow schedules callbacks with extra args after the delay (the tile) —
// forward everything but the delay (the wobble stub precedent).
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
["board", "keyboard", "toast", "new-btn", "giveup-btn",
  "share-btn"].forEach((id) => { byId[id] = makeEl("div"); });
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
const GAME_URL = "https://suitangi.github.io/30Wordles/days/21";

require(path.join(__dirname, "..", "js", "tuple.js"));
const TUPLE = globalThis.TUPLE;
assert.ok(TUPLE, "tuple.js must expose window.TUPLE");

const board = byId.board;
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
const tiles = (r) => board.children[r].children.slice(0, 5);
const chip = (r) => board.children[r].children[5];
const tupleNums = (r) => ({
  y: chip(r).children[1].textContent,
  g: chip(r).children[3].textContent,
});
const readSave = () => JSON.parse(globalThis.localStorage.getItem("tuple-day21"));

// Type a word and submit it, playing out the whole reveal.
function typeRow(word) {
  for (const ch of word) keydown(ch);
  keydown("Enter");
  runTimers();
}

function dailyGame() {
  TUPLE.daily();
}

function seedDaily(answer, guesses = [], extra = {}) {
  globalThis.localStorage.setItem("tuple-day21", JSON.stringify({
    date: TUPLE.todayKey(), answer, guesses, done: false, won: false,
    gaveUp: false, ...extra,
  }));
  dailyGame();
}

// ---------- independent tuple model (the test's own truth) ------------------

// the spec's counting, rebuilt from scratch: greens pin, strays flood
function tupleOf(guess, target) {
  const remain = {};
  let greens = 0;
  for (let i = 0; i < 5; i++) {
    if (guess[i] === target[i]) greens++;
    else remain[target[i]] = (remain[target[i]] || 0) + 1;
  }
  let yellows = 0;
  for (let i = 0; i < 5; i++) {
    if (guess[i] !== target[i] && remain[guess[i]] > 0) {
      yellows++;
      remain[guess[i]]--;
    }
  }
  return [yellows, greens];
}

// ---------- 1. word list sanity ----------

assert.equal(ANSWERS.length, 2315, "answers count");
assert.equal(DICT.size, 14855, "guessable count");
for (const w of ANSWERS) {
  assert.match(w, /^[a-z]{5}$/, `answer "${w}" shape`);
  assert.ok(DICT.has(w), `answer "${w}" must be guessable`);
}
for (const w of ["crane", "range", "cramp", "hoist", "donut", "pound"]) {
  assert.ok(DICT.has(w), `test word "${w}" is guessable`);
}
console.log("ok — word lists (2315 answers, 14855 guessable, test words present)");

// ---------- 2. the tuple math, including the spec's example -----------------

assert.deepEqual(TUPLE.tupleFor("donut", "pound"), [3, 1],
  "the spec's example: pound answers donut with [3, 1]");
assert.deepEqual(TUPLE.tupleFor("pound", "pound"), [0, 5],
  "the answer itself is [0, 5] — the win");
assert.deepEqual(TUPLE.tupleFor("hoist", "crane"), [0, 0],
  "total miss shows [0, 0]");
assert.deepEqual(TUPLE.tupleFor("eerie", "eerie"), [0, 5], "doubled answer, trivially");
// duplicate letters: two-pass evaluation, then counted
assert.deepEqual(TUPLE.tupleFor("eerie", "weird"),
  tupleOf("eerie", "weird"), "doubled letters agree with the test's own model");
assert.deepEqual(TUPLE.tupleFor("asses", "state"),
  tupleOf("asses", "state"), "double-s stray accounting agrees");
for (const g of ["donut", "eerie", "asses", "crane", "hoist"]) {
  for (const a of ["pound", "crane", "state", "eerie"]) {
    assert.deepEqual(TUPLE.tupleFor(g, a), tupleOf(g, a),
      `tupleFor("${g}", "${a}") matches the independent model`);
  }
  const [y, k] = TUPLE.tupleFor(g, "crane");
  assert.equal(y + k <= 5, true, "counts never exceed five");
}
console.log("ok — the tuple math: [yellows, greens], spec example pinned, duplicates accounted");

// ---------- 3. fresh daily: bare rows, nothing colored ----------------------

store.clear();
dailyGame();

const freshAnswer = TUPLE.answerFor(TUPLE.todayKey());
assert.equal(board.children.length, 1, "one waiting row");
assert.equal(board.children[0].children.length, 5,
  "the waiting row is five bare tiles — NO tuple before a guess");
assert.ok(!shareBtn.classList.contains("hidden") === false, "no share before an end state");
assert.ok(!giveUpBtn.classList.contains("hidden"), "give up offered on a fresh board");

const freshSave = readSave();
assert.equal(freshSave.date, TUPLE.todayKey(), "save stamped with today");
assert.equal(freshSave.answer, freshAnswer, "daily answer is date-derived");
assert.deepEqual(freshSave.guesses, [], "no guesses yet");
console.log(`ok — fresh daily: ${freshSave.date}, answer ${freshAnswer}, waiting row bare`);

// ---------- 4. a live guess: letters stay, only the tuple answers -----------

TUPLE.practice("pound");
typeRow("donut");
{
  const row = board.children[0];
  assert.equal(chip(0).children.length, 5, "the scored row carries its tuple chip");
  assert.deepEqual(tupleNums(0), { y: "3", g: "1" },
    "pound answers donut with [3, 1] ON THE BOARD");
  assert.ok(chip(0).children[1].classList.contains("y") &&
    chip(0).children[3].classList.contains("g"),
    "the numbers wear their mark colors");
  assert.equal(chip(0).classList.contains("pop"), true,
    "the live tuple popped in");
  for (const t of tiles(0)) {
    for (const mark of ["correct", "present", "absent"]) {
      assert.equal(t.classList.contains(mark), false,
        "the tiles NEVER wear a mark — no color clues, period");
    }
    assert.ok(t.classList.contains("filled"), "letters show, unfenced");
  }
  assert.equal(tiles(0).map((t) => t.textContent).join(""), "donut",
    "the guess's letters stand");
  assert.equal(board.children.length, 2, "a waiting row followed");
  assert.equal(board.children[1].children.length, 5, "still bare");
  for (const row of byId.keyboard.children) {
    for (const k of row.children) {
      for (const mark of ["correct", "present", "absent"]) {
        assert.equal(k.classList.contains(mark), false,
          "[3, 1] proves nothing per letter — the keyboard stays unpainted");
      }
    }
  }
  keydown("a");
  assert.equal(TUPLE.dump().guesses.length, 1, "typing landed on the new row");
}
console.log("ok — a live guess: the tuple answers [3, 1], tiles and keys stay colorless");

// ---------- 5. [0, 0] is the one provable clue: the keys gray out -----------

TUPLE.practice("crane");
typeRow("hoist"); // h, o, i, s, t — none in crane → [0, 0]
{
  assert.deepEqual(TUPLE.dump().tuples[0], [0, 0], "hoist on crane is [0, 0]");
  for (const ch of "hoist") {
    assert.ok(keyFor(ch).classList.contains("absent"), `${ch} grays out`);
  }
  for (const ch of "crane") {
    assert.ok(!keyFor(ch).dataset.state, `${ch} is untouched — crane's letters aren't dead`);
  }
}
typeRow("range"); // [3, 1] — proves nothing per letter
{
  for (const ch of "range") {
    assert.ok(!keyFor(ch).dataset.state, `${ch} stays unpainted on a [3, 1]`);
  }
  assert.equal(TUPLE.dump().done, false, "guesses are unlimited — no ninth-miss loss");
}
for (let i = 0; i < 10; i++) typeRow("hoist");
{
  assert.equal(board.children.length, 13, "twelve misses in, the board keeps growing");
  assert.equal(TUPLE.dump().guesses.length, 12, "all twelve spent");
  assert.equal(TUPLE.dump().done, false, "still alive — only give up ends it");
}
console.log("ok — [0, 0] grays its keys and nothing else; the board grows without end");

// ---------- 6. the win: [0, 5], then the victory lap ------------------------

TUPLE.practice("crane");
typeRow("crane");
{
  assert.deepEqual(tupleNums(0), { y: "0", g: "5" }, "the win reads [0, 5]");
  assert.equal(TUPLE.dump().done, true, "won");
  assert.equal(TUPLE.dump().won, true, "won flag");
  for (const t of tiles(0)) {
    assert.ok(t.classList.contains("correct"),
      "the winning row re-flipped to its true greens — the satisfaction");
    assert.ok(!t.classList.contains("filled"), "the fill border left with the flip");
    assert.ok(t.classList.contains("win-glow"), "the win glows");
  }
  assert.equal(tiles(0).map((t) => t.textContent).join(""), "crane",
    "the letters never moved");
  assert.ok(!shareBtn.classList.contains("hidden"), "share appears on the win");
  keydown("a");
  assert.equal(TUPLE.dump().guesses.length, 1, "board locked after the win");
}
shareBtn.click();
{
  const ta = createdEls.filter((e) => e.tagName === "textarea").pop();
  const lines = ta.value.split("\n");
  assert.equal(lines[0], "Tuple · practice · 1 guess", "share carries the count");
  assert.equal(lines[1], GAME_URL, "share links to the game");
  assert.equal(lines[2], "[0, 5]", "the winning row shares its tuple, plain text");
}
console.log("ok — the win: [0, 5], the row re-flips green, share is plain tuples");

// ---------- 7. give up -------------------------------------------------------

TUPLE.practice("crane");
for (const ch of "cr") keydown(ch);
giveUpBtn.click();
{
  assert.equal(tiles(0)[0].textContent, "", "the half-typed word cleared");
  assert.equal(board.children.length, 2, "the ghost answer followed");
  const ghost = board.children[1];
  assert.ok(ghost.classList.contains("answer"), "the reveal row");
  assert.equal(ghost.children.slice(0, 5).map((t) => t.textContent).join(""), "crane",
    "the ghost spells the word");
  assert.deepEqual(
    { y: ghost.children[5].children[1].textContent,
      g: ghost.children[5].children[3].textContent },
    { y: "0", g: "5" }, "the ghost wears its own [0, 5]");
  for (const t of ghost.children.slice(0, 5)) {
    assert.ok(t.classList.contains("win-glow"), "the ghost glows");
    for (const mark of ["correct", "present", "absent"]) {
      assert.equal(t.classList.contains(mark), false,
        "even the reveal tints, never marks");
    }
  }
  assert.equal(TUPLE.dump().gaveUp, true, "gaveUp flag explicit");
  assert.ok(!shareBtn.classList.contains("hidden"), "share offered after give up");
}
seedDaily("crane");
for (const ch of "cr") keydown(ch);
giveUpBtn.click();
{
  const s = readSave();
  assert.equal(s.done, true, "give up saved done");
  assert.equal(s.gaveUp, true, "gaveUp saved");
}
shareBtn.click();
{
  const ta = createdEls.filter((e) => e.tagName === "textarea").pop();
  assert.equal(ta.value.split("\n")[0],
    `Tuple · ${TUPLE.todayKey()} · gave up · 0 guesses`, "surrender tagged in the share");
}
console.log("ok — give up: clears the row, walks the answer on, shares gave up · N guesses");

// ---------- 8. refresh mid-game: tuples recompute, board resumes ------------

seedDaily("crane", ["hoist", "cramp"]);
dailyGame(); // simulated refresh
{
  assert.equal(board.children.length, 3, "two scored rows + the waiting row");
  assert.ok(board.children[0].classList.contains("quiet"), "restored rows are quiet");
  assert.deepEqual(tupleNums(0), { y: "0", g: "0" },
    "hoist on crane recomputes [0, 0]");
  assert.deepEqual(tupleNums(1), { y: "0", g: "3" },
    "cramp on crane recomputes [0, 3] — c, r, a green, m and p dead");
  for (const ch of "hoist") {
    assert.ok(keyFor(ch).classList.contains("absent"),
      `${ch} restored gray — the [0, 0] replays`);
  }
  for (const ch of "cramp") {
    assert.ok(!keyFor(ch).dataset.state,
      `${ch} unpainted — cramp's [0, 3] proves nothing per letter`);
  }
  assert.equal(chip(0).classList.contains("pop"), false,
    "restored tuples never pop — born finished");
  assert.equal(board.children[2].children.length, 5, "the waiting row is bare");
  for (const t of tiles(0).concat(tiles(1))) {
    for (const mark of ["correct", "present", "absent"]) {
      assert.equal(t.classList.contains(mark), false, "restore keeps the board colorless");
    }
  }
  typeRow("hoist");
  assert.deepEqual(tupleNums(2), { y: "0", g: "0" }, "play continues after a refresh");
}

dailyGame(); // refresh the just-played daily
{
  assert.equal(board.children.length, 4, "three scored rows + the waiting row");
  assert.deepEqual(tupleNums(2), { y: "0", g: "0" }, "the third tuple restored too");
}

// a finished WIN restores with its greens, glow and tuple
seedDaily("crane", ["hoist", "crane"], { done: true, won: true });
dailyGame();
{
  assert.equal(board.children.length, 2, "two scored rows, no waiting row");
  assert.deepEqual(tupleNums(1), { y: "0", g: "5" }, "the win tuple restored");
  for (const t of tiles(1)) {
    assert.ok(t.classList.contains("correct"),
      "the restored win row paints its greens directly — no re-flip");
    assert.ok(t.classList.contains("win-glow"), "the win re-glows");
  }
  for (const t of tiles(0)) {
    for (const mark of ["correct", "present", "absent"]) {
      assert.equal(t.classList.contains(mark), false,
        "only the win row wears marks — hoist stays colorless");
    }
  }
  assert.ok(!shareBtn.classList.contains("hidden"), "share offered again");
  keydown("a");
  assert.equal(TUPLE.dump().guesses.length, 2, "restored won board is locked");
}

// a finished LOSS restores with its ghost answer
seedDaily("crane", Array(9).fill("hoist"), { done: true, won: false });
dailyGame();
{
  assert.equal(board.children.length, 10, "nine rows + the ghost, restored");
  assert.ok(board.children[9].classList.contains("answer"), "the ghost restored");
  assert.ok(board.children[9].classList.contains("quiet"), "the ghost born quiet");
  keydown("a");
  assert.equal(TUPLE.dump().guesses.length, 9, "restored lost board is locked");
}
console.log("ok — refresh mid-game: tuples recompute, win and loss end states restore");

// ---------- 9. corrupt saves --------------------------------------------------

const good = { date: TUPLE.todayKey(), answer: "crane", guesses: [],
  done: false, won: false, gaveUp: false };
for (const bad of [
  { ...good, answer: "qqqqq" },                          // not a word
  { ...good, answer: 42 },                               // not a string
  { date: TUPLE.todayKey(), guesses: [] },               // no answer
  { ...good, guesses: "crane" },                         // not an array
  { ...good, guesses: ["qqqqq"] },                       // non-word guess
  { ...good, guesses: ["hoist", 42] },                   // not a string
  { ...good, date: "2019-04-01" },                       // stale date
]) {
  globalThis.localStorage.setItem("tuple-day21", JSON.stringify(bad));
  dailyGame();
  const s = readSave();
  assert.equal(s.answer, TUPLE.answerFor(TUPLE.todayKey()),
    `corrupt save ${JSON.stringify(bad).slice(0, 40)}… replaced by a fresh daily`);
  assert.deepEqual(s.guesses, [], "corrupt save's guesses discarded");
}
console.log("ok — corrupt saves: stale/fake/overlong saves fall back fresh");

// ---------- 10. rejected words keep their letters (the Stifle lesson) --------

TUPLE.practice("crane");
for (const ch of "cra") keydown(ch);
keydown("Enter"); // not enough letters
{
  assert.equal(toast.textContent, "Not enough letters", "short words refused");
  assert.equal(tiles(0).map((t) => t.textContent).join(""), "cra",
    "the letters stay for editing");
}
keydown("Backspace");
for (const ch of "qpt") keydown(ch);
keydown("Enter"); // not in the dictionary
{
  assert.equal(toast.textContent, "Not in word list", "non-words refused");
  assert.equal(tiles(0).map((t) => t.textContent).join(""), "crqpt",
    "still there after the shake");
  assert.equal(board.children.length, 1, "no row was spent");
}
runTimers();
console.log("ok — rejections: toasts fire, letters stay, no row spent");

// ---------- 11. practice: isolation, forced words, dump ----------------------

const saveBeforePractice = globalThis.localStorage.getItem("tuple-day21");
const craneIdx = ANSWERS.indexOf("crane");
Math.random = () => (craneIdx + 0.5) / ANSWERS.length;

TUPLE.practice();
assert.equal(toast.textContent, "Practice round", "practice toasts, no banner");
assert.equal(newBtn.textContent, "Today\u2019s puzzle", "button offers the way back");
assert.equal(TUPLE.dump().answer, ANSWERS[craneIdx], "random word honors the Math.random stub");

TUPLE.practice("qqqqq");
assert.ok(DICT.has(TUPLE.dump().answer), "invalid forced word rejected");

const d = TUPLE.dump();
for (const field of ["answer", "guesses", "typed", "tuples",
  "practice", "done", "won", "gaveUp", "save"]) {
  assert.ok(field in d, `dump exposes ${field}`);
}
assert.equal(globalThis.localStorage.getItem("tuple-day21"), saveBeforePractice,
  "practice never touches the daily save");

newBtn.click();
assert.equal(newBtn.textContent, "Practice", "button back to Practice");
assert.equal(board.children.length, 1, "the daily board is fresh again");
console.log("ok — practice: forced words, dump, no daily writes");

// ---------- 12. solvability sweep: the answer always wins on sight -----------

let swept = 0;
for (let i = 0; i < 40; i++) {
  const key = `2027-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`;
  seedDaily(TUPLE.answerFor(key));
  const a = TUPLE.dump().answer;
  typeRow(a); // unlimited guesses, but the opener should still win
  assert.equal(TUPLE.dump().won, true, `${key}: the answer wins as guess one`);
  assert.deepEqual(TUPLE.dump().tuples[0], [0, 5], "and its tuple says [0, 5]");
  swept++;
}
console.log(`ok — solvability sweep: ${swept} dates, every answer wins its own tuple`);

console.log("tuple.test.js — all sections passed");
