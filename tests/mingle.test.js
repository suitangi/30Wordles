// Headless tests for js/mingle.js. Loads the real game script against a
// minimal DOM stub and drives full games through the keyboard handler.
// Run: node tests/mingle.test.js
"use strict";

const assert = require("assert/strict");
const path = require("path");

// ---------- minimal DOM / browser stubs (before loading the game) ----------

const timers = [];
// flipRow schedules callbacks with extra args after the delay (the tile,
// its score) — forward everything but the delay (the wobble stub precedent).
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
const GAME_URL = "https://suitangi.github.io/30Wordles/days/23";

require(path.join(__dirname, "..", "js", "mingle.js"));
const MINGLE = globalThis.MINGLE;
assert.ok(MINGLE, "mingle.js must expose window.MINGLE");

const board = byId.board;
const toast = byId.toast;
const newBtn = byId["new-btn"];
const giveUpBtn = byId["giveup-btn"];
const shareBtn = byId["share-btn"];
const keydown = (key) =>
  (windowHandlers.keydown || []).forEach((fn) =>
    fn({ key, metaKey: false, ctrlKey: false, altKey: false }));

const tiles = (r) => board.children[r].children;
const scoreClassOf = (t) =>
  ["sc0", "sc1", "sc2", "sc3", "sc4"].find((c) => t.classList.contains(c)) || null;
const scoresOf = (r) => tiles(r).map((t) => Number(scoreClassOf(t)?.[2] ?? -1));
const markOf = (t) =>
  t.classList.contains("correct") ? "correct"
    : t.classList.contains("present") ? "present"
      : t.classList.contains("absent") ? "absent" : null;
const readSave = () => JSON.parse(globalThis.localStorage.getItem("mingle-day23"));

// Type a word and submit it, playing out the whole reveal.
function typeRow(word) {
  for (const ch of word) keydown(ch);
  keydown("Enter");
  runTimers();
}

function dailyGame() {
  MINGLE.daily();
}

function seedDaily(answer, guesses = [], extra = {}) {
  globalThis.localStorage.setItem("mingle-day23", JSON.stringify({
    date: MINGLE.todayKey(), answer, guesses, done: false, won: false,
    gaveUp: false, ...extra,
  }));
  dailyGame();
}

// ---------- independent mingle model (the test's own truth) -----------------

const K = "correct", P = "present", A = "absent";

// standard two-pass wordle, rebuilt
function wordle(guess, target) {
  const marks = Array(5).fill(A);
  const remain = {};
  for (let i = 0; i < 5; i++) {
    if (guess[i] === target[i]) marks[i] = K;
    else remain[target[i]] = (remain[target[i]] || 0) + 1;
  }
  for (let i = 0; i < 5; i++) {
    if (marks[i] !== K && remain[guess[i]] > 0) {
      marks[i] = P;
      remain[guess[i]]--;
    }
  }
  return marks;
}

// neighbor sum: 1 per yellow, 2 per green, nothing off the ends
function mingle(marks) {
  const v = marks.map((m) => ({ [A]: 0, [P]: 1, [K]: 2 }[m]));
  return v.map((_, i) => (i > 0 ? v[i - 1] : 0) + (i < 4 ? v[i + 1] : 0));
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

// ---------- 2. the mingle scoring --------------------------------------------

assert.equal(MINGLE.ROWS, 9, "nine guesses");
// the true marks underneath are ordinary wordle
assert.deepEqual(MINGLE.evaluate("donut", "pound"), wordle("donut", "pound"),
  "evaluate is standard two-pass wordle");
assert.deepEqual(MINGLE.evaluate("cramp", "crane"), [K, K, K, A, A],
  "cramp on crane: c, r, a green; the rains lesson computed, not eyeballed");
// the spec's arithmetic: ends max 2, middle max 4
assert.deepEqual(MINGLE.scoreRow([K, K, K, K, K]), [2, 4, 4, 4, 2],
  "all green mingles to [2, 4, 4, 4, 2] — and that line is unique to it");
assert.deepEqual(MINGLE.scoreRow([A, A, A, A, A]), [0, 0, 0, 0, 0],
  "all gray mingles to silence");
assert.deepEqual(MINGLE.scoreRow([P, P, P, P, P]), [1, 2, 2, 2, 1],
  "all yellow: ends capped at 1, middles carry 2");
assert.deepEqual(MINGLE.scoreRow([A, K, A, K, A]), [2, 0, 4, 0, 2],
  "green neighbors ring the middle tiles; the middles stay silent");
for (const g of ["donut", "crane", "cramp", "hoist", "eerie", "range"]) {
  for (const a of ["pound", "crane", "eerie", "quick"]) {
    assert.deepEqual(MINGLE.scoreRow(MINGLE.evaluate(g, a)),
      mingle(wordle(g, a)), `mingle("${g}", "${a}") matches the independent model`);
  }
}
console.log("ok — the mingle: neighbor sums [1 per yellow, 2 per green], ends capped, [2,4,4,4,2] unique");

// ---------- 3. fresh daily -----------------------------------------------------

store.clear();
dailyGame();

const freshAnswer = MINGLE.answerFor(MINGLE.todayKey());
assert.equal(board.children.length, 1, "one waiting row");
assert.equal(board.children[0].children.length, 5, "five bare tiles");
assert.ok(!giveUpBtn.classList.contains("hidden"), "give up offered");
assert.ok(shareBtn.classList.contains("hidden"), "no share before an end state");

const freshSave = readSave();
assert.equal(freshSave.date, MINGLE.todayKey(), "save stamped with today");
assert.equal(freshSave.answer, freshAnswer, "daily answer is date-derived");
assert.deepEqual(freshSave.guesses, [], "no guesses yet");
console.log(`ok — fresh daily: ${freshSave.date}, answer ${freshAnswer}`);

// ---------- 4. a live guess: outlines only, tiles and keys stay mute ----------

MINGLE.practice("pound");
typeRow("donut");
{
  assert.deepEqual(scoresOf(0), mingle(wordle("donut", "pound")),
    "the row's outlines carry the mingle scores");
  for (const t of tiles(0)) {
    assert.equal(markOf(t), null,
      "tiles NEVER wear their true marks — the outlines gossip instead");
    assert.ok(t.classList.contains("filled"), "letters show on filled borders");
  }
  assert.equal(tiles(0).map((t) => t.textContent).join(""), "donut",
    "the guess's letters stand");
  for (const row of byId.keyboard.children) {
    for (const k of row.children) {
      for (const mark of ["correct", "present", "absent"]) {
        assert.equal(k.classList.contains(mark), false,
          "the keyboard never paints — the outlines are the only voice");
      }
    }
  }
  assert.equal(board.children.length, 2, "a waiting row followed");
  keydown("a");
  assert.equal(MINGLE.dump().guesses.length, 1, "typing landed on the new row");
}
console.log("ok — a live guess: score outlines land, marks and keys stay hidden");

// ---------- 5. the win: the victory lap reveals the fills ----------------------

MINGLE.practice("crane");
typeRow("crane");
{
  // the outlines lifted with the lap — the score line itself is pinned
  // in section 2 ([2, 4, 4, 4, 2], unique to all-green)
  assert.deepEqual(scoresOf(0), [-1, -1, -1, -1, -1],
    "the victory lap stripped the score outlines");
  assert.deepEqual(tiles(0).map(markOf), [K, K, K, K, K],
    "the victory lap re-flipped the row to its true fills");
  for (const t of tiles(0)) {
    assert.ok(!t.classList.contains("filled"), "the fill border left with the flip");
    assert.ok(t.classList.contains("win-glow"), "the win glows");
  }
  assert.equal(MINGLE.dump().done, true, "won");
  assert.equal(MINGLE.dump().won, true, "won flag");
  assert.ok(!shareBtn.classList.contains("hidden"), "share appears on the win");
  keydown("a");
  assert.equal(MINGLE.dump().guesses.length, 1, "board locked after the win");
}
shareBtn.click();
{
  const ta = createdEls.filter((e) => e.tagName === "textarea").pop();
  const lines = ta.value.split("\n");
  assert.equal(lines[0], "Mingle · practice · 1/9", "share carries the count over nine");
  assert.equal(lines[1], GAME_URL, "share links to the game");
  assert.equal(lines[2], "2 4 4 4 2", "the share is score digits, not marks");
}
console.log("ok — the win: [2,4,4,4,2], true fills revealed, share tells scores only");

// ---------- 6. give up: the ghost answer in full colors ------------------------

MINGLE.practice("crane");
for (const ch of "cr") keydown(ch);
giveUpBtn.click();
{
  assert.equal(tiles(0)[0].textContent, "", "the half-typed word cleared");
  assert.equal(board.children.length, 2, "the ghost answer followed");
  const ghost = board.children[1];
  assert.ok(ghost.classList.contains("answer"), "the reveal row");
  assert.deepEqual(tiles(1).map(markOf), [K, K, K, K, K],
    "the ghost wears its true fills — full wordle colors");
  assert.equal(tiles(1).map((t) => t.textContent).join(""), "crane",
    "the ghost spells the word");
  for (const t of tiles(1)) assert.ok(t.classList.contains("win-glow"), "the ghost glows");
  assert.equal(MINGLE.dump().gaveUp, true, "gaveUp flag explicit");
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
    `Mingle · ${MINGLE.todayKey()} · gave up · 0/9`, "surrender tagged in the share");
}
console.log("ok — give up: clears the row, walks the answer on in full colors, shares gave up · N/9");

// ---------- 7. nine misses end it ----------------------------------------------

MINGLE.practice("crane");
for (let i = 0; i < 9; i++) {
  typeRow("donut");
  if (i < 8) assert.equal(MINGLE.dump().done, false, `alive after ${i + 1} misses`);
}
{
  assert.equal(MINGLE.dump().done, true, "the ninth miss ends it");
  assert.equal(board.children.length, 10, "nine guesses + the ghost");
  assert.deepEqual(tiles(9).map(markOf), [K, K, K, K, K], "the ghost reveals all green");
  keydown("a");
  assert.equal(MINGLE.dump().guesses.length, 9, "board locked at nine");
}
shareBtn.click();
{
  const ta = createdEls.filter((e) => e.tagName === "textarea").pop();
  assert.equal(ta.value.split("\n")[0], "Mingle · practice · X/9", "exhaustion tagged X/9");
  assert.equal(ta.value.split("\n")[2],
    mingle(wordle("donut", "crane")).join(" "), "guess rows share their score digits");
}
console.log("ok — exhaustion: nine misses, ghost answer, X/9");

// ---------- 8. refresh mid-game: scores recompute, end states restore ----------

seedDaily("crane", ["donut", "cramp"]);
dailyGame(); // simulated refresh
{
  assert.equal(board.children.length, 3, "two scored rows + the waiting row");
  assert.ok(board.children[0].classList.contains("quiet"), "restored rows are quiet");
  assert.deepEqual(scoresOf(0), mingle(wordle("donut", "crane")),
    "donut's scores recompute on restore");
  assert.deepEqual(scoresOf(1), mingle(wordle("cramp", "crane")),
    "cramp's scores recompute on restore");
  for (const t of tiles(0).concat(tiles(1))) {
    assert.equal(markOf(t), null, "restored rows keep the marks hidden");
  }
  typeRow("crane");
  assert.deepEqual(tiles(2).map(markOf), [K, K, K, K, K],
    "play continues after a refresh and the win reveals");
}

dailyGame(); // refresh the just-won daily
{
  assert.deepEqual(tiles(2).map(markOf), [K, K, K, K, K],
    "the restored win row paints its fills directly — no re-flip");
  for (const t of tiles(2)) assert.ok(t.classList.contains("win-glow"), "the win re-glows");
  assert.ok(!shareBtn.classList.contains("hidden"), "share offered again");
  keydown("a");
  assert.equal(MINGLE.dump().guesses.length, 3, "restored won board is locked");
}

// a finished loss restores with its ghost
seedDaily("crane", Array(9).fill("donut"), { done: true, won: false });
dailyGame();
{
  assert.equal(board.children.length, 10, "nine rows + the ghost, restored");
  assert.ok(board.children[9].classList.contains("answer"), "the ghost restored");
  assert.deepEqual(tiles(9).map(markOf), [K, K, K, K, K], "the ghost green on restore");
  keydown("a");
  assert.equal(MINGLE.dump().guesses.length, 9, "restored lost board is locked");
}
console.log("ok — refresh mid-game: scores recompute, win and loss end states restore");

// ---------- 9. corrupt saves ----------------------------------------------------

const good = { date: MINGLE.todayKey(), answer: "crane", guesses: [],
  done: false, won: false, gaveUp: false };
for (const bad of [
  { ...good, answer: "qqqqq" },                          // not a word
  { ...good, answer: 42 },                               // not a string
  { date: MINGLE.todayKey(), guesses: [] },              // no answer
  { ...good, guesses: "crane" },                         // not an array
  { ...good, guesses: ["qqqqq"] },                       // non-word guess
  { ...good, guesses: Array(10).fill("donut") },         // ten guesses
  { ...good, date: "2019-04-01" },                       // stale date
]) {
  globalThis.localStorage.setItem("mingle-day23", JSON.stringify(bad));
  dailyGame();
  const s = readSave();
  assert.equal(s.answer, MINGLE.answerFor(MINGLE.todayKey()),
    `corrupt save ${JSON.stringify(bad).slice(0, 40)}… replaced by a fresh daily`);
  assert.deepEqual(s.guesses, [], "corrupt save's guesses discarded");
}
console.log("ok — corrupt saves: stale/fake/overlong saves fall back fresh");

// ---------- 10. rejected words keep their letters (the Stifle lesson) ----------

MINGLE.practice("crane");
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

// ---------- 11. practice: isolation, forced words, dump ------------------------

const saveBeforePractice = globalThis.localStorage.getItem("mingle-day23");
const craneIdx = ANSWERS.indexOf("crane");
Math.random = () => (craneIdx + 0.5) / ANSWERS.length;

MINGLE.practice();
assert.equal(toast.textContent, "Practice round", "practice toasts, no banner");
assert.equal(newBtn.textContent, "Today\u2019s puzzle", "button offers the way back");
assert.equal(MINGLE.dump().answer, ANSWERS[craneIdx], "random word honors the Math.random stub");

MINGLE.practice("qqqqq");
assert.ok(DICT.has(MINGLE.dump().answer), "invalid forced word rejected");

const d = MINGLE.dump();
for (const field of ["answer", "guesses", "typed", "scores",
  "practice", "done", "won", "gaveUp", "save"]) {
  assert.ok(field in d, `dump exposes ${field}`);
}
assert.equal(globalThis.localStorage.getItem("mingle-day23"), saveBeforePractice,
  "practice never touches the daily save");

newBtn.click();
assert.equal(newBtn.textContent, "Practice", "button back to Practice");
assert.equal(board.children.length, 1, "the daily board is fresh again");
console.log("ok — practice: forced words, dump, no daily writes");

// ---------- 12. solvability sweep: ordinary wordle under the mingling ----------

// The marks underneath are standard, so a plain candidate-filtering
// solver — keep only words whose true marks would match every reveal —
// wins comfortably. The mingle hides the marks but not the win.
let swept = 0;
let worst = 0;
for (let i = 0; i < 40; i++) {
  const key = `2027-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`;
  seedDaily(MINGLE.answerFor(key));
  const a = MINGLE.dump().answer;
  let candidates = ANSWERS.slice();
  let n = 0;
  while (!MINGLE.dump().done && n < 9) {
    const guess = candidates[0];
    typeRow(guess);
    n++;
    const marks = MINGLE.evaluate(guess, a);
    candidates = candidates.filter((c) =>
      MINGLE.evaluate(guess, c).every((m, j) => m === marks[j]));
    assert.ok(candidates.length >= 1, "the true answer always survives the filter");
  }
  assert.equal(MINGLE.dump().won, true, `${key}: solver wins "${a}" in ${n}`);
  assert.ok(n <= 9, `${key}: within nine (took ${n})`);
  worst = Math.max(worst, n);
  swept++;
}
console.log(`ok — solvability sweep: ${swept} dates, worst win in ${worst} guesses`);

console.log("mingle.test.js — all sections passed");
