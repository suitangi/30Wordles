// Headless tests for js/findle.js. Loads the real game script against a
// minimal DOM stub and drives full games through the keyboard handler.
// Run: node tests/findle.test.js
"use strict";

const assert = require("assert/strict");
const path = require("path");

// ---------- minimal DOM / browser stubs (before loading the game) ----------

const timers = [];
// flipTiles schedules callbacks with extra args after the delay (the el,
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
["grid", "slots", "log", "keyboard", "toast", "new-btn",
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
const GAME_URL = "https://suitangi.github.io/30Wordles/days/19";

require(path.join(__dirname, "..", "js", "findle.js"));
const FINDLE = globalThis.FINDLE;
assert.ok(FINDLE, "findle.js must expose window.FINDLE");

const grid = byId.grid;
const slots = byId.slots;
const log = byId.log;
const toast = byId.toast;
const newBtn = byId["new-btn"];
const giveUpBtn = byId["giveup-btn"];
const shareBtn = byId["share-btn"];
const keydown = (key) =>
  (windowHandlers.keydown || []).forEach((fn) =>
    fn({ key, metaKey: false, ctrlKey: false, altKey: false }));

const K = "correct", P = "present", A = "absent";
const STORE_KEY = "findle-day19";
const DIRS = FINDLE.DIRS;

const readSave = () => JSON.parse(globalThis.localStorage.getItem(STORE_KEY));
const dump = () => FINDLE.dump();
const occCells = (o) => Array.from({ length: 5 }, (_, k) => ({
  r: o.r + DIRS[o.d].dr * k, c: o.c + DIRS[o.d].dc * k,
}));
const placedList = () => dump().placed;
const decoysOf = () => placedList().slice(1);
const firstOcc = (w) => FINDLE.occurrences(w)[0];
const cellMark = (r, c) => {
  const cl = FINDLE.cell(r, c).classList;
  return cl.contains("correct") ? K : cl.contains("present") ? P
    : cl.contains("absent") ? A : "";
};
const isSel = (r, c) => FINDLE.cell(r, c).classList.contains("sel");
const selCells = () => {
  const out = [];
  for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) if (isSel(r, c)) out.push({ r, c });
  return out;
};
const slotLetters = () => slots.children.map((s) => s.textContent);
const logMarks = (g) => log.children[g].children.map((t) =>
  t.classList.contains("correct") ? K
    : t.classList.contains("present") ? P
      : t.classList.contains("absent") ? A : "");

// Type a word and submit it, playing out the whole reveal.
function typeRow(word) {
  for (const ch of word) keydown(ch);
  keydown("Enter");
  runTimers();
}
// A refused word keeps its letters for editing — backspace out first
// (the Stifle lesson: leftover letters silently merge into the next word).
function clearTyped() { for (let i = 0; i < 5; i++) keydown("Backspace"); }

function dailyGame() { FINDLE.daily(); }
function seedDaily(guesses, extra = {}) {
  globalThis.localStorage.setItem(STORE_KEY, JSON.stringify({
    date: FINDLE.todayKey(),
    answer: FINDLE.answerFor(FINDLE.todayKey()),
    guesses, done: false, won: false, gaveUp: false, ...extra,
  }));
  dailyGame();
}

// the test's own truth: the feedback law, rebuilt from the spec —
// green on a target cell, yellow on the target's LINE, gray elsewhere
function lineTest(targetCells) {
  if (targetCells.every((t) => t.r === targetCells[0].r)) {
    return (r, c) => r === targetCells[0].r;
  }
  if (targetCells.every((t) => t.c === targetCells[0].c)) {
    return (r, c) => c === targetCells[0].c;
  }
  if (targetCells.every((t) => t.r - t.c === targetCells[0].r - targetCells[0].c)) {
    return (r, c) => r - c === targetCells[0].r - targetCells[0].c;
  }
  return (r, c) => r + c === targetCells[0].r + targetCells[0].c;
}
function expectedMark(cell, targetCells) {
  if (targetCells.some((t) => t.r === cell.r && t.c === cell.c)) return K;
  return lineTest(targetCells)(cell.r, cell.c) ? P : A;
}
const expectedMarksAt = (occ) => occCells(occ).map((c) => expectedMark(c, dump().targetCells));

// ---------- 1. word list sanity ----------

assert.equal(ANSWERS.length, 2315, "answers count");
assert.equal(DICT.size, 14855, "guessable count");
for (const w of ANSWERS) {
  assert.match(w, /^[a-z]{5}$/, `answer "${w}" shape`);
  assert.ok(DICT.has(w), `answer "${w}" must be guessable`);
}
console.log("ok — word lists (2315 answers, 14855 guessable)");

// ---------- 2. constants ----------

assert.equal(FINDLE.SIZE, 10, "a 10×10 grid");
assert.equal(FINDLE.LIMIT, 6, "six guesses");
assert.equal(FINDLE.DIRS.length, 8, "all 8 directions");
console.log("ok — constants: 10×10, 6 guesses, 8 directions");

// ---------- 3. fresh daily: a full board, deterministic, no banner -------

store.clear();
dailyGame();

const freshAnswer = FINDLE.answerFor(FINDLE.todayKey());
assert.equal(dump().answer, freshAnswer, "the daily target is date-derived");
assert.equal(grid.children.length, 100, "the grid built 100 cells");
for (const cell of grid.children) {
  assert.match(cell.textContent, /^[a-z]$/, "every cell holds a letter");
}
const placed1 = placedList();
assert.ok(placed1.length >= 14, `14+ words placed (got ${placed1.length})`);
assert.ok(placed1.length <= 20, `at most 20 words (got ${placed1.length})`);
assert.equal(placed1[0].w, freshAnswer, "the target is placed first");
assert.equal(placed1.filter((p) => p.w === freshAnswer).length, 1,
  "the target placed exactly once");
assert.equal(new Set(placed1.map((p) => p.w)).size, placed1.length, "no duplicate words");
{
  const dirsSeen = new Set(placed1.map((p) => p.d));
  for (let d = 0; d < 8; d++) {
    assert.ok(dirsSeen.has(d), `direction ${d} hosts a word`);
  }
}
for (const p of placed1) {
  assert.ok(p.d >= 0 && p.d < 8, "direction index in range");
  assert.ok(p.r >= 0 && p.c >= 0, "in bounds");
  const cells = occCells(p);
  cells.forEach((t, i) => {
    assert.equal(FINDLE.cell(t.r, t.c).textContent, p.w[i],
      `${p.w} reads off the grid in its own direction`);
  });
}
assert.ok(!giveUpBtn.classList.contains("hidden"), "give up offered");
assert.ok(shareBtn.classList.contains("hidden"), "no share before an end state");
assert.deepEqual(dump().guesses, [], "no guesses yet");
assert.deepEqual(slotLetters(), ["", "", "", "", ""], "empty pending slots");
assert.deepEqual(selCells(), [], "nothing lit on a fresh board");

const save1 = readSave();
assert.equal(save1.date, FINDLE.todayKey(), "save stamped with today");
assert.equal(save1.answer, freshAnswer, "save holds the derived target");
console.log(`ok — fresh daily: ${save1.date}, target ${freshAnswer}, ${placed1.length} words, all 8 directions, no banner`);

// determinism: a refresh rebuilds the exact same board
const letters1 = grid.children.map((c) => c.textContent);
dailyGame();
assert.deepEqual(placedList(), placed1, "the placed words reproduce exactly");
assert.deepEqual(grid.children.map((c) => c.textContent), letters1,
  "the letters reproduce exactly");
console.log(`ok — the daily board is deterministic (${placed1.length} words) across refreshes`);

// ---------- 4. the overlap guarantee: crossers through the target ----------

function overlapCount() {
  const decoyKeys = new Set(decoysOf().flatMap(occCells).map((t) => t.r + "," + t.c));
  return dump().targetCells.filter((t) => decoyKeys.has(t.r + "," + t.c)).length;
}
assert.ok(overlapCount() >= 2,
  `the target shares at least 2 cells with decoys (got ${overlapCount()})`);
console.log(`ok — overlap guarantee: ${overlapCount()} target-decoy crossings on the daily`);

// ---------- 5. the feedback law, everywhere: tiles, not the whole word ------

const tCells = dump().targetCells;
for (let r = 0; r < 10; r++) {
  for (let c = 0; c < 10; c++) {
    assert.equal(FINDLE.markAt(r, c), expectedMark({ r, c }, tCells),
      `markAt(${r},${c}) follows the line law`);
  }
}
for (const p of placedList()) {
  assert.deepEqual(FINDLE.marksFor(p.w), expectedMarksAt(p),
    `${p.w} grades per its own tiles`);
}
assert.deepEqual(FINDLE.marksFor(freshAnswer), Array(5).fill(K),
  "the target's own tiles are all green");
assert.equal(FINDLE.marksFor("zzzzz"), null, "unreadable words have no marks");

// suitangi's report: a crosser used to grade 1 green + 4 yellow because
// its cells shared a column with target cells. Tiles now: the crossing
// tile is green, the rest are GRAY — they're not on the target's line.
{
  const tDir = placedList()[0].d;
  const colinear = (d) => DIRS[d].dr === DIRS[tDir].dr && DIRS[d].dc === DIRS[tDir].dc ||
    DIRS[d].dr === -DIRS[tDir].dr && DIRS[d].dc === -DIRS[tDir].dc;
  const crosser = decoysOf().find((p) => !colinear(p.d) &&
    occCells(p).some((t) => tCells.some((q) => q.r === t.r && q.c === t.c)));
  assert.ok(crosser, "a true crosser exists");
  const marks = FINDLE.marksFor(crosser.w);
  assert.equal(marks.filter((m) => m === K).length, 1, "exactly one green at the crossing");
  assert.equal(marks.filter((m) => m === A).length, 4,
    "the crosser's other tiles are gray — no whole-word yellow");
}
console.log("ok — feedback law: green on the target, yellow on its line, gray beyond; crossers grade per tile");

// ---------- 6. the live find: typing lights the word up ----------------------

{
  const d1 = decoysOf()[1];
  const cells1 = occCells(firstOcc(d1.w));
  for (const ch of d1.w.slice(0, 4)) keydown(ch);
  assert.deepEqual(selCells(), [], "four letters light nothing yet");
  keydown(d1.w[4]); // the fifth letter completes a grid word
  assert.deepEqual(selCells().map((t) => t.r + "," + t.c).sort(),
    cells1.map((t) => t.r + "," + t.c).sort(),
    "at five letters the word lights up where it reads");
  assert.deepEqual(slotLetters(), d1.w.split(""), "the slots hold the word");
  assert.equal(dump().sel.w, d1.w, "dump names the lit word");

  // a DIAGONAL word lights its diagonal cells
  const diag = placedList().find((p) => p.d >= 4);
  assert.ok(diag, "a diagonal word exists");
  clearTyped();
  for (const ch of diag.w) keydown(ch);
  assert.deepEqual(selCells().map((t) => t.r + "," + t.c).sort(),
    occCells(firstOcc(diag.w)).map((t) => t.r + "," + t.c).sort(),
    "the diagonal word lights along its diagonal");

  // backspacing below five letters goes dark again
  keydown("Backspace");
  assert.deepEqual(selCells(), [], "backspace goes dark");
  keydown(diag.w[4]);
  assert.equal(selCells().length, 5, "retyping relights");

  // five letters that read NOWHERE light nothing and refuse to fire
  const outsider = ANSWERS.find((w) => !FINDLE.reads(w));
  clearTyped();
  typeRow(outsider);
  assert.deepEqual(selCells(), [], "an unreadable word stays dark");
  assert.equal(toast.textContent, "Not on the grid", "unreadable words are refused");
  assert.deepEqual(dump().guesses, [], "the refusal spends nothing");
  clearTyped();

  // a readable non-word lights up but is refused as a word
  let garbage = null;
  outer:
  for (let d = 0; d < 8; d++) {
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 10; c++) {
        const occ = { w: "", r, c, d };
        const cells = occCells(occ);
        if (cells.some((t) => t.r < 0 || t.r > 9 || t.c < 0 || t.c > 9)) continue;
        const s = cells.map((t) => FINDLE.cell(t.r, t.c).textContent).join("");
        if (!DICT.has(s)) { garbage = s; break outer; }
      }
    }
  }
  assert.ok(garbage, "a readable non-word exists");
  for (const ch of garbage) keydown(ch);
  assert.equal(selCells().length, 5, "readable garbage lights up where it reads");
  keydown("Enter");
  runTimers();
  assert.equal(toast.textContent, "Not a word", "readable garbage is named");
  assert.deepEqual(dump().guesses, [], "still nothing spent");
  clearTyped();

  // short words are refused
  typeRow("cran");
  assert.equal(toast.textContent, "Not enough letters", "short words are refused");
  clearTyped(); // the 4 refused letters too
}
console.log("ok — the live find: five letters light the word, backspace goes dark, validity still checked");

// ---------- 7. submitting: grades, the spent word, the log -------------------

{
  const d1 = decoysOf()[1];
  typeRow(d1.w);
  assert.deepEqual(dump().guesses.map((g) => g.w), [d1.w], "a grid word is accepted");
  assert.deepEqual(logMarks(0), expectedMarksAt(firstOcc(d1.w)),
    "the log row grades letter by letter");
  for (const [i, t] of occCells(firstOcc(d1.w)).entries()) {
    assert.equal(cellMark(t.r, t.c), expectedMark(t, tCells),
      "the grid tile wears the same verdict");
  }
  assert.deepEqual(slotLetters(), ["", "", "", "", ""], "the slots cleared");
  assert.deepEqual(selCells(), [], "the highlight cleared with the submit");

  // the same word again: refused, and no guess spent
  typeRow(d1.w);
  assert.equal(toast.textContent, "Already guessed", "repeats are named");
  assert.deepEqual(dump().guesses.length, 1, "the repeat spent nothing");
  clearTyped();
}
console.log("ok — submitting: graded where it reads, spent words refused, the log accumulates");

// ---------- 8. the win: naming the target ------------------------------------

store.clear();
FINDLE.practice();
assert.equal(toast.textContent, "Practice round", "practice announced by toast");
assert.equal(newBtn.textContent, "Today\u2019s puzzle", "button offers the way back");
{
  const target = dump().answer;
  typeRow(target);
  assert.deepEqual(dump().guesses.map((g) => g.w), [target], "the target is always guessable");
  assert.equal(dump().done, true, "the win ends it");
  assert.equal(dump().won, true, "won");
  for (const t of dump().targetCells) {
    assert.equal(cellMark(t.r, t.c), K, "the target's cells stand green");
    assert.ok(FINDLE.cell(t.r, t.c).classList.contains("win-glow"), "the win glows");
  }
  assert.deepEqual(logMarks(0), [K, K, K, K, K], "all green in the log");
  keydown("a");
  assert.equal(dump().guesses.length, 1, "board locked after the win");
}
shareBtn.click();
{
  const ta = createdEls.filter((e) => e.tagName === "textarea").pop();
  const lines = ta.value.split("\n");
  assert.equal(lines[0], "Findle · practice · 1/6", "share carries the count over six");
  assert.equal(lines[1], GAME_URL, "share links to the game");
  assert.equal(lines[2], "\uD83D\uDFE9".repeat(5), "the win shares five greens");
}
console.log("ok — the win: target named, grid lit green and glowing, share 1/6");

// ---------- 9. six misses end it ----------------------------------------------

store.clear();
dailyGame();
{
  const six = decoysOf().slice(0, 6);
  for (let i = 0; i < 6; i++) {
    typeRow(six[i].w);
    if (i < 5) assert.equal(dump().done, false, `alive after ${i + 1} misses`);
  }
  assert.equal(dump().done, true, "the sixth miss ends it");
  assert.equal(dump().won, false, "lost");
  for (const t of dump().targetCells) {
    assert.equal(cellMark(t.r, t.c), K, "the reveal lights the target");
  }
  assert.equal(log.children.length, 6, "six log rows");
  assert.ok(giveUpBtn.classList.contains("hidden"), "give up retired");
  keydown("a");
  assert.equal(dump().guesses.length, 6, "board locked at six");
}
shareBtn.click();
{
  const ta = createdEls.filter((e) => e.tagName === "textarea").pop();
  assert.equal(ta.value.split("\n")[0],
    `Findle · ${FINDLE.todayKey()} · X/6`, "exhaustion tagged X/6");
}
console.log("ok — exhaustion: six misses, the target revealed, X/6");

// ---------- 10. give up --------------------------------------------------------

store.clear();
FINDLE.practice();
{
  keydown("c");
  keydown("r");
  giveUpBtn.click();
  runTimers(); // the target reveal is a flip wave
  assert.deepEqual(slotLetters(), ["", "", "", "", ""], "the half-typed word cleared");
  assert.equal(dump().gaveUp, true, "gaveUp flag explicit");
  for (const t of dump().targetCells) {
    assert.equal(cellMark(t.r, t.c), K, "the target revealed on surrender too");
  }
  keydown("a");
  assert.equal(dump().guesses.length, 0, "board locked");
}
shareBtn.click();
{
  const ta = createdEls.filter((e) => e.tagName === "textarea").pop();
  assert.equal(ta.value.split("\n")[0],
    `Findle · practice · gave up · 0/6`, "surrender tagged in the share");
}
console.log("ok — give up: clears the row, reveals the target, shares gave up · N/6");

// ---------- 11. refresh mid-game: occurrences restore exactly -----------------

store.clear();
dailyGame();
{
  // two far decoys, saved as the occurrences a typed guess would grade
  const ds = decoysOf().slice(3, 5).map((p) => firstOcc(p.w));
  seedDaily(ds.map((o) => ({ ...o })));
  assert.equal(grid.children.length, 100, "the grid rebuilt");
  assert.deepEqual(placedList(), placed1, "the same daily board came back");
  assert.equal(log.children.length, 2, "two log rows restored");
  ds.forEach((o, g) => {
    assert.deepEqual(logMarks(g), expectedMarksAt(o), "log row repainted");
    for (const [i, t] of occCells(o).entries()) {
      assert.equal(cellMark(t.r, t.c), expectedMark(t, tCells),
        "grid tiles repainted from pure geometry");
    }
  });
  // play continues after a refresh — and wins
  typeRow(dump().answer);
  assert.equal(dump().won, true, "won after the refresh");
}

dailyGame(); // refresh the just-won daily
{
  for (const t of dump().targetCells) {
    assert.equal(cellMark(t.r, t.c), K, "the win's greens restored");
  }
  assert.ok(!shareBtn.classList.contains("hidden"), "share offered again");
  keydown("a");
  assert.equal(dump().guesses.length, 3, "restored won board is locked");
}

// a finished loss restores too
store.clear();
{
  dailyGame();
  const six = decoysOf().slice(6, 12).map((p) => firstOcc(p.w));
  seedDaily(six.map((o) => ({ ...o })), { done: true, won: false });
  assert.equal(log.children.length, 6, "six rows restored");
  for (const t of dump().targetCells) {
    assert.equal(cellMark(t.r, t.c), K, "the reveal restored, painted not flipped");
  }
  keydown("a");
  assert.equal(dump().guesses.length, 6, "restored lost board is locked");
}
console.log("ok — refresh mid-game and after the end: occurrences repaint exactly");

// ---------- 12. corrupt saves --------------------------------------------------

dailyGame();
const derived = FINDLE.answerFor(FINDLE.todayKey());
const occ1 = firstOcc(decoysOf()[0].w);
const good = { date: FINDLE.todayKey(), answer: derived, guesses: [],
  done: false, won: false, gaveUp: false };
for (const bad of [
  { ...good, answer: "qqqqz" },                            // not a word
  { ...good, answer: "crane" },                            // a real word, not today's
  { date: FINDLE.todayKey(), guesses: [] },                // no answer
  { ...good, guesses: "crane" },                           // not an array
  { ...good, guesses: ["qqqqq"] },                         // plain string (v1 format)
  { ...good, guesses: [{ ...occ1, w: "qqqqq" }] },         // word not on the grid there
  { ...good, guesses: [{ ...occ1, r: 99 }] },              // off-grid start
  { ...good, guesses: [{ ...occ1, d: 9 }] },               // no such direction
  { ...good, guesses: [{ ...occ1, c: 1.5 }] },             // not a cell
  { ...good, guesses: Array(7).fill(occ1) },               // over the limit
  { ...good, date: "2020-01-01" },                         // stale
]) {
  globalThis.localStorage.setItem(STORE_KEY, JSON.stringify(bad));
  dailyGame();
  const s = readSave();
  assert.equal(s.answer, derived,
    `corrupt save ${JSON.stringify(bad).slice(0, 42)}… replaced by a fresh daily`);
  assert.deepEqual(s.guesses, [], "corrupt save's guesses discarded");
}
console.log("ok — corrupt saves: stale/fake/unreadable/overlong saves fall back fresh");

// ---------- 13. practice: isolation, forced words, dump, log -------------------

const saveBeforePractice = globalThis.localStorage.getItem(STORE_KEY);
const craneIdx = ANSWERS.indexOf("crane");
Math.random = () => (craneIdx + 0.5) / ANSWERS.length;

FINDLE.practice();
assert.equal(dump().answer, ANSWERS[craneIdx], "random target honors the Math.random stub");
assert.equal(dump().practice, true, "practice flagged");
assert.notEqual(dump().placed.map((p) => p.w).join(),
  placed1.map((p) => p.w).join(), "a fresh random board was generated");

FINDLE.practice("qqqqq");
assert.ok(DICT.has(dump().answer), "invalid forced word rejected");

const d = dump();
for (const field of ["answer", "grid", "targetCells", "line", "placed",
  "guesses", "typed", "sel", "practice", "done", "won", "gaveUp", "save"]) {
  assert.ok(field in d, `dump exposes ${field}`);
}
const report = FINDLE.log();
assert.match(report, /Findle/, "the debug log names the game");
assert.match(report, new RegExp(dump().answer.toUpperCase()), "the debug log names the target");
assert.match(report, /words:/, "the debug log lists the placed words");
assert.match(report, /save:/, "the debug log carries the raw save");
assert.equal(globalThis.localStorage.getItem(STORE_KEY), saveBeforePractice,
  "practice never touches the daily save");

newBtn.click();
assert.equal(newBtn.textContent, "Practice", "button back to Practice");
console.log("ok — practice: forced targets, random boards, dump + log, no daily writes");

// ---------- 14. solvability sweep: 8 directions, full boards, found ----------

let swept = 0;
for (let i = 0; i < 12; i++) {
  const key = `2027-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`;
  FINDLE.practice(FINDLE.answerFor(key));
  const a = dump().answer;
  const t = dump().targetCells;
  const count = placedList().length;
  assert.ok(count >= 14 && count <= 20, `${key}: ${count} words in band`);
  const dirsSeen = new Set(placedList().map((p) => p.d));
  for (let d = 0; d < 8; d++) assert.ok(dirsSeen.has(d), `${key}: direction ${d} covered`);
  const decoyKeys = new Set(decoysOf().flatMap(occCells).map((x) => x.r + "," + x.c));
  const ov = t.filter((x) => decoyKeys.has(x.r + "," + x.c)).length;
  assert.ok(ov >= 2, `${key}: ${ov} crossings clear the floor of 2`);
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 10; c++) {
      assert.equal(FINDLE.markAt(r, c), expectedMark({ r, c }, t),
        `${key}: line law at ${r},${c}`);
    }
  }
  typeRow(a); // the target reads in its grid — name it, win
  assert.ok(dump().won, `${key}: the target wins`);
  swept++;
}
console.log(`ok — solvability sweep: ${swept} boards, all full, all 8 directions, all found`);

console.log("\nAll findle tests passed.");
