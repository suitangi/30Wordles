// Headless tests for js/middle.js. Loads the real game script against a
// minimal DOM stub and drives full games through the keyboard handler.
// Run: node tests/middle.test.js
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
const GAME_URL = "https://suitangi.github.io/30Wordles/days/22";

require(path.join(__dirname, "..", "js", "middle.js"));
const MIDDLE = globalThis.MIDDLE;
assert.ok(MIDDLE, "middle.js must expose window.MIDDLE");

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
const tiles = (r) => board.children[r].children;
const markOf = (t) =>
  t.classList.contains("correct") ? "correct"
    : t.classList.contains("present") ? "present"
      : t.classList.contains("absent") ? "absent" : null;
const marksOf = (r) => tiles(r).map(markOf);
const readSave = () => JSON.parse(globalThis.localStorage.getItem("middle-day22"));

// Type a word and submit it, playing out the whole reveal.
function typeRow(word) {
  for (const ch of word) keydown(ch);
  keydown("Enter");
  runTimers();
}

function dailyGame() {
  MIDDLE.daily();
}

function seedDaily(answer, guesses = [], extra = {}) {
  globalThis.localStorage.setItem("middle-day22", JSON.stringify({
    date: MIDDLE.todayKey(), answer, guesses, done: false, won: false,
    gaveUp: false, ...extra,
  }));
  dailyGame();
}

// ---------- independent thermometer model (the test's own truth) -----------

function thermometer(guess, target) {
  return guess.split("").map((ch, i) =>
    ch === target[i] ? "correct"
      : ch < target[i] ? "present" : "absent");
}

const K = "correct", P = "present", A = "absent";
const emptyCell = "\u2B1C"; // light theme in the stub
const EMOJI = { correct: "\uD83D\uDFE9", present: "\uD83D\uDFE8", absent: emptyCell };

// ---------- 1. word list sanity ----------

assert.equal(ANSWERS.length, 2315, "answers count");
assert.equal(DICT.size, 14855, "guessable count");
for (const w of ANSWERS) {
  assert.match(w, /^[a-z]{5}$/, `answer "${w}" shape`);
  assert.ok(DICT.has(w), `answer "${w}" must be guessable`);
}
for (const w of ["crane", "range", "cramp", "hoist", "donut", "pound", "mmmmm"]) {
  if (w === "mmmmm") assert.ok(!DICT.has(w), "mmmmm is not a word");
  else assert.ok(DICT.has(w), `test word "${w}" is guessable`);
}
console.log("ok — word lists (2315 answers, 14855 guessable, test words present)");

// ---------- 2. the thermometer, including the spec's example ----------------

assert.equal(MIDDLE.ROWS, 9, "nine guesses");
assert.deepEqual(MIDDLE.evaluate("donut", "pound"), [P, K, P, A, A],
  "the spec's example: pound answers donut Y, G, Y, gray, gray");
assert.deepEqual(MIDDLE.evaluate("pound", "pound"), [K, K, K, K, K],
  "the answer is all green");
assert.deepEqual(MIDDLE.evaluate("azert", "pound"),
  thermometer("azert", "pound"), "a-first vs late letters reads yellow");
// extremes at one position each
assert.equal(MIDDLE.evaluate("aaaaa", "zzzzz").every((m) => m === P), true,
  "a under z is always yellow — aim higher");
assert.equal(MIDDLE.evaluate("zzzzz", "aaaaa").every((m) => m === A), true,
  "z over a is always gray — aim lower");
// strictly per-position: NO cross-position accounting, duplicates or not
assert.deepEqual(MIDDLE.evaluate("eeeee", "eerie"), [K, K, P, P, K],
  "five e's on eerie: positions 2 and 3 compare only themselves — " +
  "normal wordle would starve them; the thermometer doesn't");
assert.deepEqual(MIDDLE.evaluate("poooo", "pound"), [K, K, P, A, A],
  "poooo vs pound: each o judges its own spot");
for (const g of ["donut", "eerie", "poooo", "crane", "hoist", "zyxwv"]) {
  for (const a of ["pound", "crane", "eerie", "quick"]) {
    assert.deepEqual(MIDDLE.evaluate(g, a), thermometer(g, a),
      `evaluate("${g}", "${a}") matches the independent model`);
  }
}
console.log("ok — the thermometer: positional direction only, spec example pinned, no accounting");

// ---------- 3. fresh daily ---------------------------------------------------

store.clear();
dailyGame();

const freshAnswer = MIDDLE.answerFor(MIDDLE.todayKey());
assert.equal(board.children.length, 1, "one waiting row");
assert.equal(board.children[0].children.length, 5, "five bare tiles");
assert.ok(!giveUpBtn.classList.contains("hidden"), "give up offered");
assert.ok(shareBtn.classList.contains("hidden"), "no share before an end state");

const freshSave = readSave();
assert.equal(freshSave.date, MIDDLE.todayKey(), "save stamped with today");
assert.equal(freshSave.answer, freshAnswer, "daily answer is date-derived");
assert.deepEqual(freshSave.guesses, [], "no guesses yet");
console.log(`ok — fresh daily: ${freshSave.date}, answer ${freshAnswer}`);

// ---------- 4. a live guess reads the spec's example ------------------------

MIDDLE.practice("pound");
typeRow("donut");
{
  assert.deepEqual(marksOf(0), [P, K, P, A, A],
    "donut on pound: Y, G, Y, gray, gray ON THE BOARD");
  assert.equal(tiles(0).map((t) => t.textContent).join(""), "donut",
    "the guess's letters stand");
  // the keyboard law: GREEN keys only — yellow and gray tiles stay mute
  assert.ok(keyFor("o").classList.contains("correct"),
    "o hit green at its spot — its key paints");
  for (const ch of "dnut") {
    assert.ok(!keyFor(ch).dataset.state,
      `${ch} scored only yellow/gray — its key paints NOTHING, ` +
      "direction is not membership");
  }
  assert.equal(board.children.length, 2, "a waiting row followed");
  keydown("a");
  assert.equal(MIDDLE.dump().guesses.length, 1, "typing landed on the new row");
}
console.log("ok — a live guess: Y,G,Y,A,A on the board, green keys only");

// ---------- 5. the win: five greens -----------------------------------------

MIDDLE.practice("crane");
typeRow("crane");
{
  assert.deepEqual(marksOf(0), [K, K, K, K, K], "the answer reads all green");
  assert.equal(MIDDLE.dump().done, true, "won");
  assert.equal(MIDDLE.dump().won, true, "won flag");
  for (const t of tiles(0)) assert.ok(t.classList.contains("win-glow"), "the win glows");
  assert.ok(!shareBtn.classList.contains("hidden"), "share appears on the win");
  keydown("a");
  assert.equal(MIDDLE.dump().guesses.length, 1, "board locked after the win");
}
shareBtn.click();
{
  const ta = createdEls.filter((e) => e.tagName === "textarea").pop();
  const lines = ta.value.split("\n");
  assert.equal(lines[0], "Middle · practice · 1/9", "share carries the count over nine");
  assert.equal(lines[1], GAME_URL, "share links to the game");
  assert.equal(lines[2], EMOJI.correct.repeat(5), "the winning row shares five greens");
}
console.log("ok — the win: all green, glow, share Middle · practice · 1/9");

// ---------- 6. give up: the all-green ghost answer --------------------------

MIDDLE.practice("crane");
for (const ch of "cr") keydown(ch);
giveUpBtn.click();
{
  assert.equal(tiles(0)[0].textContent, "", "the half-typed word cleared");
  assert.equal(board.children.length, 2, "the ghost answer followed");
  const ghost = board.children[1];
  assert.ok(ghost.classList.contains("answer"), "the reveal row");
  assert.deepEqual(marksOf(1), [K, K, K, K, K], "the ghost is all green");
  assert.equal(tiles(1).map((t) => t.textContent).join(""), "crane",
    "the ghost spells the word");
  for (const t of tiles(1)) assert.ok(t.classList.contains("win-glow"), "the ghost glows");
  assert.equal(MIDDLE.dump().gaveUp, true, "gaveUp flag explicit");
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
    `Middle · ${MIDDLE.todayKey()} · gave up · 0/9`, "surrender tagged in the share");
}
console.log("ok — give up: clears the row, walks the all-green answer on, shares gave up · N/9");

// ---------- 7. nine misses end it -------------------------------------------

MIDDLE.practice("crane");
for (let i = 0; i < 9; i++) {
  typeRow("donut");
  if (i < 8) assert.equal(MIDDLE.dump().done, false, `alive after ${i + 1} misses`);
}
{
  assert.equal(MIDDLE.dump().done, true, "the ninth miss ends it");
  assert.equal(board.children.length, 10, "nine guesses + the ghost");
  assert.deepEqual(marksOf(9), [K, K, K, K, K], "the ghost reveals all green");
  keydown("a");
  assert.equal(MIDDLE.dump().guesses.length, 9, "board locked at nine");
}
shareBtn.click();
{
  const ta = createdEls.filter((e) => e.tagName === "textarea").pop();
  assert.equal(ta.value.split("\n")[0], "Middle · practice · X/9", "exhaustion tagged X/9");
}
console.log("ok — exhaustion: nine misses, ghost answer, X/9");

// ---------- 8. refresh mid-game: marks recompute, greens restored -----------

seedDaily("crane", ["donut", "cramp"]);
dailyGame(); // simulated refresh
{
  assert.equal(board.children.length, 3, "two scored rows + the waiting row");
  assert.ok(board.children[0].classList.contains("quiet"), "restored rows are quiet");
  assert.deepEqual(marksOf(0), thermometer("donut", "crane"),
    "donut's thermometer recomputes on restore");
  assert.deepEqual(marksOf(1), thermometer("cramp", "crane"),
    "cramp's thermometer recomputes on restore");
  assert.ok(keyFor("c").classList.contains("correct") &&
    keyFor("r").classList.contains("correct") &&
    keyFor("a").classList.contains("correct"),
    "the keyboard restored cramp's green letters (c, r, a)");
  assert.ok(!keyFor("d").dataset.state && !keyFor("m").dataset.state &&
    !keyFor("e").dataset.state,
    "yellow/gray tiles painted no keys on restore either — donut has no " +
    "greens vs crane, and m's yellow is not membership");
  typeRow("crane");
  assert.deepEqual(marksOf(2), [K, K, K, K, K], "play continues after a refresh");
}

dailyGame(); // refresh the just-won daily
{
  assert.deepEqual(marksOf(2), [K, K, K, K, K], "the win restored all green");
  for (const t of tiles(2)) assert.ok(t.classList.contains("win-glow"), "the win re-glows");
  assert.ok(!shareBtn.classList.contains("hidden"), "share offered again");
  keydown("a");
  assert.equal(MIDDLE.dump().guesses.length, 3, "restored won board is locked");
}

// a finished loss restores with its ghost
seedDaily("crane", Array(9).fill("donut"), { done: true, won: false });
dailyGame();
{
  assert.equal(board.children.length, 10, "nine rows + the ghost, restored");
  assert.ok(board.children[9].classList.contains("answer"), "the ghost restored");
  assert.deepEqual(marksOf(9), [K, K, K, K, K], "the ghost green on restore");
  keydown("a");
  assert.equal(MIDDLE.dump().guesses.length, 9, "restored lost board is locked");
}
console.log("ok — refresh mid-game: thermometers recompute, win and loss end states restore");

// ---------- 9. corrupt saves --------------------------------------------------

const good = { date: MIDDLE.todayKey(), answer: "crane", guesses: [],
  done: false, won: false, gaveUp: false };
for (const bad of [
  { ...good, answer: "qqqqq" },                          // not a word
  { ...good, answer: 42 },                               // not a string
  { date: MIDDLE.todayKey(), guesses: [] },              // no answer
  { ...good, guesses: "crane" },                         // not an array
  { ...good, guesses: ["qqqqq"] },                       // non-word guess
  { ...good, guesses: Array(10).fill("donut") },         // ten guesses
  { ...good, date: "2019-04-01" },                       // stale date
]) {
  globalThis.localStorage.setItem("middle-day22", JSON.stringify(bad));
  dailyGame();
  const s = readSave();
  assert.equal(s.answer, MIDDLE.answerFor(MIDDLE.todayKey()),
    `corrupt save ${JSON.stringify(bad).slice(0, 40)}… replaced by a fresh daily`);
  assert.deepEqual(s.guesses, [], "corrupt save's guesses discarded");
}
console.log("ok — corrupt saves: stale/fake/overlong saves fall back fresh");

// ---------- 10. rejected words keep their letters (the Stifle lesson) --------

MIDDLE.practice("crane");
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

const saveBeforePractice = globalThis.localStorage.getItem("middle-day22");
const craneIdx = ANSWERS.indexOf("crane");
Math.random = () => (craneIdx + 0.5) / ANSWERS.length;

MIDDLE.practice();
assert.equal(toast.textContent, "Practice round", "practice toasts, no banner");
assert.equal(newBtn.textContent, "Today\u2019s puzzle", "button offers the way back");
assert.equal(MIDDLE.dump().answer, ANSWERS[craneIdx], "random word honors the Math.random stub");

MIDDLE.practice("qqqqq");
assert.ok(DICT.has(MIDDLE.dump().answer), "invalid forced word rejected");

const d = MIDDLE.dump();
for (const field of ["answer", "guesses", "typed", "marks",
  "practice", "done", "won", "gaveUp", "save"]) {
  assert.ok(field in d, `dump exposes ${field}`);
}
assert.equal(globalThis.localStorage.getItem("middle-day22"), saveBeforePractice,
  "practice never touches the daily save");

newBtn.click();
assert.equal(newBtn.textContent, "Practice", "button back to Practice");
assert.equal(board.children.length, 1, "the daily board is fresh again");
console.log("ok — practice: forced words, dump, no daily writes");

// ---------- 12. solvability sweep: binary search converges in nine -----------

// The honest strategy, per position: track the remaining [lo, hi] range
// from each thermometer clue, aim the next guess at the midpoint of
// every range at once (the word closest in total letter-distance), and
// let the splits do the work. If nine guesses can't guarantee a win for
// a careful binary searcher, the game is unwinable by design and the
// row count needs a second look.
let swept = 0;
const worst = { n: 0, word: "" };
for (let i = 0; i < 40; i++) {
  const key = `2027-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`;
  seedDaily(MIDDLE.answerFor(key));
  const a = MIDDLE.dump().answer;
  const ranges = Array.from({ length: 5 }, () => [0, 25]);
  let n = 0;
  while (!MIDDLE.dump().done && n < 9) {
    const targets = ranges.map(([lo, hi]) => Math.floor((lo + hi) / 2));
    let best = null, bestScore = Infinity;
    for (const w of WORD_LISTS.guesses) {
      let score = 0;
      for (let p = 0; p < 5; p++) {
        const g = w.charCodeAt(p) - 97;
        const [lo, hi] = ranges[p];
        if (lo === hi) score += Math.abs(g - lo); // solved: keep the hit
        else if (g < lo || g > hi) score += 100;  // out of range: the
        // clue can't move the boundary — information-free, soft-banned
        else score += Math.abs(g - targets[p]);
      }
      if (score < bestScore) { bestScore = score; best = w; }
    }
    typeRow(best);
    n++;
    const marks = MIDDLE.evaluate(best, a);
    for (let p = 0; p < 5; p++) {
      const g = best.charCodeAt(p) - 97;
      if (marks[p] === K) ranges[p] = [g, g];
      else if (marks[p] === P) ranges[p][0] = Math.max(ranges[p][0], g + 1);
      else ranges[p][1] = Math.min(ranges[p][1], g - 1);
    }
    worst.n = Math.max(worst.n, n);
    worst.word = best;
  }
  assert.equal(MIDDLE.dump().won, true, `${key}: binary search wins "${a}" in ${n}`);
  assert.ok(n <= 9, `${key}: within nine guesses (took ${n})`);
  swept++;
}
console.log(`ok — solvability sweep: ${swept} dates, worst win in ${worst.n} guesses`);

console.log("middle.test.js — all sections passed");
