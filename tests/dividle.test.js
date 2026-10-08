// Headless tests for js/dividle.js. Loads the real game script against a
// minimal DOM stub and drives full games through the keyboard handler.
// Run: node tests/dividle.test.js
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
    disabled: false,
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
  documentElement: { dataset: { theme: "dark" } },
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
const GAME_URL = "https://suitangi.github.io/30Wordles/days/25";

require(path.join(__dirname, "..", "js", "dividle.js"));
const DIVIDLE = globalThis.DIVIDLE;
assert.ok(DIVIDLE, "dividle.js must expose window.DIVIDLE");

const board = byId.board;
const toast = byId.toast;
const newBtn = byId["new-btn"];
const giveUpBtn = byId["giveup-btn"];
const shareBtn = byId["share-btn"];
const keydown = (key) =>
  (windowHandlers.keydown || []).forEach((fn) =>
    fn({ key, metaKey: false, ctrlKey: false, altKey: false }));

// .dvrow = [west arrow, .dvword (5 tiles + line), east arrow]
const row = (r) => board.children[r];
const wordEl = (r) => row(r).children[1];
const tiles = (r) => wordEl(r).children.slice(0, 5);
const cellText = (r, c) => tiles(r)[c].textContent;
const rowText = (r) => tiles(r).map((t) => t.textContent).join("");
const markOf = (t) =>
  t.classList.contains("correct") ? "correct"
    : t.classList.contains("present") ? "present"
      : t.classList.contains("absent") ? "absent" : null;
const cellMark = (r, c) => markOf(tiles(r)[c]);
const cutOf = (r) => Number(wordEl(r).style["--d"]);
const westBtn = (r) => row(r).children[0];
const eastBtn = (r) => row(r).children[2];
const keyEl = (letter) => {
  for (const kr of byId.keyboard.children) {
    for (const k of kr.children) {
      if (k.textContent === letter) return k;
    }
  }
  return null;
};
const readSave = () => JSON.parse(globalThis.localStorage.getItem("dividle-day25"));

// Type a word and submit it, playing out the whole reveal.
function typeRow(word) {
  for (const ch of word) keydown(ch);
  keydown("Enter");
  runTimers();
}

// Slide the pending cut to d via the arrow keys (the way a player does).
function cutAt(d) {
  while (DIVIDLE.dump().div < d) keydown("ArrowRight");
  while (DIVIDLE.dump().div > d) keydown("ArrowLeft");
  assert.equal(DIVIDLE.dump().div, d, `the cut moved to ${d}`);
}

function practice(word) { DIVIDLE.practice(word); }

function seedDaily(answer, guesses = [], extra = {}) {
  globalThis.localStorage.setItem("dividle-day25", JSON.stringify({
    date: DIVIDLE.todayKey(), answer, guesses, done: false, won: false,
    gaveUp: false, ...extra,
  }));
  DIVIDLE.daily();
}

// ---------- independent dividle model (the test's own truth) ----------------

const K = "correct", P = "present", A = "absent";

// Wordle's two pass, twice: each side of the cut scores only against
// its own counterpart.
function divided(guess, d, target) {
  const marks = Array(5).fill(A);
  for (const [lo, hi] of [[0, d], [d, 5]]) {
    const remain = {};
    for (let i = lo; i < hi; i++) {
      if (guess[i] === target[i]) marks[i] = K;
      else remain[target[i]] = (remain[target[i]] || 0) + 1;
    }
    for (let j = lo; j < hi; j++) {
      if (marks[j] !== K && remain[guess[j]] > 0) {
        marks[j] = P;
        remain[guess[j]]--;
      }
    }
  }
  return marks;
}

// ordinary two-pass wordle, for contrast pins
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

// ---------- 1. word list sanity ----------------------------------------------

assert.equal(ANSWERS.length, 2315, "answers count");
assert.equal(DICT.size, 14855, "guessable count");
for (const w of ["crane", "range", "cramp", "hoist", "donut", "pound",
  "eerie", "slate", "toast"]) {
  assert.ok(DICT.has(w), `test word "${w}" is guessable`);
}
console.log("ok — word lists (2315 answers, 14855 guessable, test words present)");

// ---------- 2. the divided scoring --------------------------------------------

assert.equal(DIVIDLE.ROWS, 7, "seven guesses");
// THE SPEC'S OWN EXAMPLE: donut cut do|nut against pound —
// "do" against "po" (d grays: "do" never sees the d of "und"),
// "nut" against "und" (n and u yellow, t gray)
assert.deepEqual(DIVIDLE.evaluate("donut", 2, "pound"), [A, K, P, P, A],
  "donut|2 on pound reads gray, green, yellow, yellow, gray");
// duplicate accounting is per-side: eeeee's right side "eee" vs "rie"
// greens only the positionally-matched last e — no cross-line yellows
assert.deepEqual(DIVIDLE.evaluate("eeeee", 2, "eerie"), [K, K, A, A, K],
  "eeeee|2 on eerie: each side spends only its own letters");
// the whole point, side by side: normal wordle lets the d of donut
// find pound's d across the line; dividle's left side "do" never does
assert.deepEqual(wordle("donut", "pound"), [P, K, P, P, A],
  "normal wordle: the opening d is yellow from across the line");
assert.deepEqual(DIVIDLE.evaluate("donut", 2, "pound"), [A, K, P, P, A],
  "dividle: that same d grays — 'do' never sees the d of 'und'");
// every cut of the same pair, computed not eyeballed
assert.deepEqual(DIVIDLE.evaluate("donut", 1, "pound"), divided("donut", 1, "pound"),
  "d=1 matches the model");
assert.deepEqual(DIVIDLE.evaluate("donut", 3, "pound"), [A, K, A, A, A],
  "donut|3 on pound: only the o greens — d grays left of the line");
assert.deepEqual(DIVIDLE.evaluate("donut", 4, "pound"), [A, K, P, P, A],
  "donut|4 on pound: the n and u yellow against their own side's copies");
for (const g of ["donut", "crane", "cramp", "hoist", "eerie", "toast"]) {
  for (const a of ["pound", "crane", "eerie", "slate"]) {
    for (const d of [1, 2, 3, 4]) {
      assert.deepEqual(DIVIDLE.evaluate(g, d, a), divided(g, d, a),
        `evaluate("${g}", ${d}, "${a}") matches the independent model`);
    }
  }
}
console.log("ok — the divided scoring: per-side two-pass, the spec example, model agrees at every cut");

// ---------- 3. fresh daily ------------------------------------------------------

store.clear();
DIVIDLE.daily();

const freshAnswer = DIVIDLE.answerFor(DIVIDLE.todayKey());
assert.equal(board.children.length, 7, "seven rows stand from the start");
assert.equal(wordEl(0).children.length, 6, "five tiles plus the line");
assert.ok(row(0).classList.contains("on"), "row 0 is live");
for (let r = 1; r < 7; r++) {
  assert.ok(!row(r).classList.contains("on"), `row ${r} is not live`);
  assert.ok(!westBtn(r).disabled, `row ${r} arrows dormant, not disabled`);
}
assert.equal(cutOf(0), 2, "a fresh row cuts after the second letter");
assert.ok(!giveUpBtn.classList.contains("hidden"), "give up offered");
assert.ok(shareBtn.classList.contains("hidden"), "no share before an end state");
const freshSave = readSave();
assert.equal(freshSave.date, DIVIDLE.todayKey(), "save stamped with today");
assert.equal(freshSave.answer, freshAnswer, "daily answer is date-derived");
assert.deepEqual(freshSave.guesses, [], "no guesses yet");
console.log(`ok — fresh daily: ${freshSave.date}, answer ${freshAnswer}`);

// ---------- 4. moving the cut ----------------------------------------------------

practice("crane");
{
  keydown("ArrowLeft");
  assert.equal(DIVIDLE.dump().div, 1, "the left triangle key cuts earlier");
  assert.ok(westBtn(0).disabled, "the cut bottoms out at 1");
  keydown("ArrowLeft");
  assert.equal(DIVIDLE.dump().div, 1, "and stays there");
  for (let i = 0; i < 5; i++) keydown("ArrowRight");
  assert.equal(DIVIDLE.dump().div, 4, "four clicks ride to the far right");
  assert.ok(eastBtn(0).disabled, "the cut tops out at 4");
  westBtn(0).click();
  assert.equal(DIVIDLE.dump().div, 3, "the triangle buttons move it too");
  eastBtn(0).click();
  assert.equal(DIVIDLE.dump().div, 4, "back to the edge");
  keydown("a");
  assert.equal(cellText(0, 0), "a", "typing lands on the live row");
  keydown("Backspace");
  // moving the cut never touches scored rows — none exist yet, but the
  // line element itself must exist on every row
  for (let r = 0; r < 7; r++) {
    assert.equal(wordEl(r).children[5].className, "dvline", `row ${r} wears its line`);
  }
}
console.log("ok — moving the cut: arrows and buttons, clamped at 1 and 4, line on every row");

// ---------- 5. a live guess at a moved cut ----------------------------------------

practice("pound");
cutAt(3);
typeRow("donut");
{
  assert.deepEqual(tiles(0).map(markOf), [A, K, A, A, A],
    "donut cut after three letters: only the o greens");
  assert.equal(rowText(0), "donut", "the letters stand");
  assert.ok(row(0).classList.contains("scored"), "the row's cut is now its record");
  assert.equal(cutOf(0), 3, "the line stays where the guess was made");
  assert.deepEqual(DIVIDLE.dump().guesses, [{ w: "donut", d: 3 }],
    "the save records the cut with the word");
  assert.ok(row(1).classList.contains("on"), "the live row moved down");
  assert.ok(!row(0).classList.contains("on"), "the scored row retires");
  assert.equal(DIVIDLE.dump().div, 2, "a fresh row cuts after the second letter again");
  assert.ok(keyEl("o").classList.contains(K), "key o green");
  assert.ok(keyEl("t").classList.contains(A), "key t gray");
  // the scored row's cut is frozen: row 1's cut moves, row 0's stays
  cutAt(4);
  assert.equal(cutOf(0), 3, "scored rows keep their cut");
  assert.equal(cutOf(1), 4, "the live row's line moved");
  keydown("a");
  assert.equal(DIVIDLE.dump().guesses.length, 1, "typing landed on the new row");
  keydown("Backspace");
}
console.log("ok — a live guess: scored at its own cut, the cut recorded, the next row fresh");

// ---------- 6. the win: five greens under any division ------------------------------

practice("crane");
cutAt(4);
typeRow("crane");
{
  assert.deepEqual(tiles(0).map(markOf), [K, K, K, K, K],
    "the exact answer greens even cut at the far right");
  for (const t of tiles(0)) assert.ok(t.classList.contains("win-glow"), "the win glows");
  assert.equal(DIVIDLE.dump().done, true, "won");
  assert.equal(DIVIDLE.dump().won, true, "won flag");
  for (let r = 0; r < 7; r++) {
    assert.ok(!row(r).classList.contains("on"), "no row is live after the win");
  }
  assert.ok(!shareBtn.classList.contains("hidden"), "share appears on the win");
  keydown("a");
  assert.equal(DIVIDLE.dump().guesses.length, 1, "board locked after the win");
}
shareBtn.click();
{
  const ta = createdEls.filter((e) => e.tagName === "textarea").pop();
  const lines = ta.value.split("\n");
  assert.equal(lines[0], "Dividle · practice · 1/7", "share carries the count over seven");
  assert.equal(lines[1], GAME_URL, "share links to the game");
  assert.equal(lines[2], "\u{1F7E9}\u{1F7E9}\u{1F7E9}\u{1F7E9}\u{1F7E9}", "the win row shares five greens");
}
console.log("ok — the win: five greens under any division, share shows the grid");

// ---------- 7. give up: the ghost is the whole word ----------------------------------

practice("crane");
for (const ch of "cr") keydown(ch);
giveUpBtn.click();
{
  assert.equal(cellText(0, 0), "", "the half-typed word cleared");
  assert.equal(board.children.length, 8, "the ghost answer followed");
  const ghost = board.children[7];
  assert.ok(ghost.classList.contains("answer"), "the reveal row");
  assert.deepEqual(tiles(7).map(markOf), [K, K, K, K, K],
    "the ghost wears its true fills — full wordle colors");
  assert.equal(rowText(7), "crane", "the ghost spells the word, undivided");
  for (const t of tiles(7)) assert.ok(t.classList.contains("win-glow"), "the ghost glows");
  assert.equal(DIVIDLE.dump().gaveUp, true, "gaveUp flag explicit");
  assert.ok(giveUpBtn.classList.contains("hidden"), "give up retired");
}
shareBtn.click();
{
  const ta = createdEls.filter((e) => e.tagName === "textarea").pop();
  assert.equal(ta.value.split("\n")[0],
    "Dividle · practice · gave up · 0/7", "surrender tagged in the share");
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
    `Dividle · ${DIVIDLE.todayKey()} · gave up · 0/7`, "daily surrender carries the date");
}
console.log("ok — give up: clears the row, walks the whole word on, shares gave up · N/7");

// ---------- 8. seven misses end it -----------------------------------------------------

practice("crane");
for (let i = 0; i < 7; i++) {
  typeRow("donut");
  if (i < 6) assert.equal(DIVIDLE.dump().done, false, `alive after ${i + 1} misses`);
}
{
  assert.equal(DIVIDLE.dump().done, true, "the seventh miss ends it");
  assert.equal(board.children.length, 8, "seven guesses + the ghost");
  assert.deepEqual(tiles(7).map(markOf), [K, K, K, K, K], "the ghost reveals all green");
  keydown("a");
  assert.equal(DIVIDLE.dump().guesses.length, 7, "board locked at seven");
}
shareBtn.click();
{
  const ta = createdEls.filter((e) => e.tagName === "textarea").pop();
  assert.equal(ta.value.split("\n")[0], "Dividle · practice · X/7", "exhaustion tagged X/7");
  const GLYPH = { correct: "\u{1F7E9}", present: "\u{1F7E8}", absent: "\u2B1B" };
  assert.equal(ta.value.split("\n")[2],
    divided("donut", 2, "crane").map((m) => GLYPH[m]).join(""),
    "each guess row shares its divided marks (donut's n is yellow on the right side)");
}
console.log("ok — exhaustion: seven misses, ghost answer, X/7");

// ---------- 9. refresh mid-game: cuts and marks recompute ------------------------------

seedDaily("pound", [{ w: "donut", d: 3 }, { w: "cramp", d: 1 }]);
DIVIDLE.daily(); // simulated refresh
{
  assert.equal(board.children.length, 7, "the seven rows rebuilt");
  assert.ok(row(0).classList.contains("quiet"), "restored rows are quiet");
  assert.equal(rowText(0), "donut", "row 0 repainted");
  assert.deepEqual(tiles(0).map(markOf), divided("donut", 3, "pound"),
    "row 0's marks recompute at its own cut");
  assert.deepEqual(tiles(1).map(markOf), divided("cramp", 1, "pound"),
    "row 1's marks recompute at its cut");
  assert.equal(cutOf(0), 3, "row 0's line back at three");
  assert.equal(cutOf(1), 1, "row 1's line back at one");
  assert.equal(cutOf(2), 2, "the live row cuts fresh");
  assert.ok(row(2).classList.contains("on"), "the live row moved down");
  assert.ok(keyEl("o").classList.contains(K), "key o green after restore");
  assert.ok(keyEl("c").classList.contains(A), "key c gray after restore");
  typeRow("crane"); // a plain next guess (crane ≠ pound) — play continues
  assert.deepEqual(DIVIDLE.dump().guesses.length, 3, "play continues after a refresh");
}

seedDaily("crane", [{ w: "crane", d: 4 }], { done: true, won: true });
DIVIDLE.daily();
{
  const r = DIVIDLE.dump().guesses.length - 1;
  assert.deepEqual(tiles(r).map(markOf), [K, K, K, K, K],
    "restored win row is green");
  for (const t of tiles(r)) assert.ok(t.classList.contains("win-glow"), "the win re-glows");
  assert.ok(!shareBtn.classList.contains("hidden"), "share offered again");
  keydown("a");
  assert.equal(DIVIDLE.dump().guesses.length, 1, "restored won board is locked");
}

seedDaily("crane", [], { done: true, won: false, gaveUp: true });
DIVIDLE.daily();
{
  assert.equal(board.children.length, 8, "the ghost restored");
  assert.ok(board.children[7].classList.contains("answer"), "the ghost row");
  assert.deepEqual(tiles(7).map(markOf), [K, K, K, K, K], "the ghost green on restore");
  for (let r = 0; r < 7; r++) {
    assert.ok(!row(r).classList.contains("on"), `row ${r} dormant on a finished board`);
  }
  keydown("a");
  assert.equal(DIVIDLE.dump().guesses.length, 0, "restored lost board is locked");
}
console.log("ok — refresh: cuts and marks recompute, win and surrender restore finished");

// ---------- 10. corrupt saves ------------------------------------------------------------

const good = { date: DIVIDLE.todayKey(), answer: "crane", guesses: [],
  done: false, won: false, gaveUp: false };
for (const bad of [
  { ...good, answer: "qqqqq" },                          // not a word
  { ...good, answer: 42 },                               // not a string
  { date: DIVIDLE.todayKey(), guesses: [] },             // no answer
  { ...good, guesses: "crane" },                         // not an array
  { ...good, guesses: [{ w: "qqqqq", d: 2 }] },          // non-word guess
  { ...good, guesses: [{ w: "donut" }] },                // no cut
  { ...good, guesses: [{ w: "donut", d: 0 }] },          // cut before the word
  { ...good, guesses: [{ w: "donut", d: 5 }] },          // cut after the word
  { ...good, guesses: [{ w: "donut", d: 2.5 }] },        // cut between letters
  { ...good, guesses: [{ w: "donut", d: "2" }] },        // cut not a number
  { ...good, guesses: Array.from({ length: 8 }, (_, i) => ({ w: "donut", d: (i % 4) + 1 })) },
  { ...good, date: "2019-04-01" },                       // stale date
]) {
  globalThis.localStorage.setItem("dividle-day25", JSON.stringify(bad));
  DIVIDLE.daily();
  const s = readSave();
  assert.equal(s.answer, DIVIDLE.answerFor(DIVIDLE.todayKey()),
    `corrupt save ${JSON.stringify(bad).slice(0, 48)}… replaced by a fresh daily`);
  assert.deepEqual(s.guesses, [], "corrupt save's guesses discarded");
}
console.log("ok — corrupt saves: stale/fake/off-line cuts fall back fresh");

// ---------- 11. rejected words keep their letters (the Stifle lesson) --------------------

practice("crane");
for (const ch of "cra") keydown(ch);
keydown("Enter"); // not enough letters
{
  assert.equal(toast.textContent, "Not enough letters", "short words refused");
  assert.equal(rowText(0), "cra", "the letters stay for editing");
}
keydown("Backspace");
for (const ch of "qpt") keydown(ch);
keydown("Enter"); // not in the dictionary
{
  assert.equal(toast.textContent, "Not in word list", "non-words refused");
  assert.equal(rowText(0), "crqpt", "still there after the shake");
  assert.equal(DIVIDLE.dump().guesses.length, 0, "no row was spent");
}
runTimers();
console.log("ok — rejections: toasts fire, letters stay, no row spent");

// ---------- 12. practice: isolation, forced words, dump -----------------------------------

const saveBeforePractice = globalThis.localStorage.getItem("dividle-day25");
const craneIdx = ANSWERS.indexOf("crane");
Math.random = () => (craneIdx + 0.5) / ANSWERS.length;

DIVIDLE.practice();
assert.equal(toast.textContent, "Practice round", "practice toasts, no banner");
assert.equal(newBtn.textContent, "Today\u2019s puzzle", "button offers the way back");
assert.equal(DIVIDLE.dump().answer, ANSWERS[craneIdx], "random word honors the Math.random stub");

DIVIDLE.practice("qqqqq");
assert.ok(DICT.has(DIVIDLE.dump().answer), "invalid forced word rejected");

const d = DIVIDLE.dump();
for (const field of ["answer", "guesses", "typed", "div", "marks",
  "practice", "done", "won", "gaveUp", "save"]) {
  assert.ok(field in d, `dump exposes ${field}`);
}
assert.equal(globalThis.localStorage.getItem("dividle-day25"), saveBeforePractice,
  "practice never touches the daily save");

newBtn.click();
assert.equal(newBtn.textContent, "Practice", "button back to Practice");
assert.equal(DIVIDLE.dump().guesses.length, 0, "the daily board is fresh again");
console.log("ok — practice: forced words, dump, no daily writes");

// ---------- 13. solvability sweep: the cut still solves ------------------------------------
//
// Divided clues are strictly weaker than normal wordle's (letters never
// clue across the line), but the player picks the cut — so the sweep
// plays an oracle that tries all four cuts of each guess and keeps the
// most informative one. Honest filter: only guesses submitted through
// the real input path; the true answer must always survive.

{
  let swept = 0;
  let worst = 0;
  for (let i = 0; i < 40; i++) {
    const key = `2027-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`;
    seedDaily(DIVIDLE.answerFor(key));
    const a = DIVIDLE.dump().answer;
    let candidates = ANSWERS.slice();
    let n = 0;
    while (!DIVIDLE.dump().done && n < 7) {
      const guess = candidates[0];
      let best = null;
      for (const dd of [1, 2, 3, 4]) {
        const reveal = DIVIDLE.evaluate(guess, dd, a);
        const kept = candidates.filter((c) => {
          const m = DIVIDLE.evaluate(guess, dd, c);
          return m.every((mk, j) => mk === reveal[j]);
        });
        if (!best || kept.length < best.kept.length) best = { dd, kept };
      }
      cutAt(best.dd);
      typeRow(guess);
      n++;
      candidates = best.kept;
      assert.ok(candidates.length >= 1, "the true answer always survives the filter");
    }
    assert.equal(DIVIDLE.dump().won, true, `${key}: solver wins "${a}" in ${n}`);
    assert.ok(n <= 7, `${key}: within seven (took ${n})`);
    worst = Math.max(worst, n);
    swept++;
  }
  console.log(`ok — solvability sweep: ${swept} dates, worst win in ${worst} guesses`);
}

console.log("dividle.test.js — all sections passed");
