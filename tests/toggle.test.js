// Headless tests for js/toggle.js. Loads the real game script against a
// minimal DOM stub and drives full games through the toggle buttons and the
// guess button (Enter works too — there is no keyboard in this game).
// Run: node tests/toggle.test.js
"use strict";

const assert = require("assert/strict");
const path = require("path");

// ---------- minimal DOM / browser stubs (before loading the game) ----------

const timers = [];
globalThis.setTimeout = (fn, delay, ...args) => {
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
["board", "turnline", "banner", "toast", "new-btn", "guess-btn", "share-btn"]
  .forEach((id) => { byId[id] = makeEl("div"); });
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

require(path.join(__dirname, "..", "js", "toggle.js"));
const TOGGLE = globalThis.TOGGLE;
assert.ok(TOGGLE, "toggle.js must expose window.TOGGLE");

const board = byId.board;
const turnline = byId.turnline;
const banner = byId.banner;
const toast = byId.toast;
const newBtn = byId["new-btn"];
const guessBtn = byId["guess-btn"];
const shareBtn = byId["share-btn"];

const rowEl = (r) => board.children[r];
const tog = (r, c) => rowEl(r).children[c];
const isOn = (r, c) => tog(r, c).classList.contains("on");
const chip = (r) => rowEl(r).children[5];
const readSave = () => JSON.parse(globalThis.localStorage.getItem("toggle-day4"));

const keydown = (key) =>
  (windowHandlers.keydown || []).forEach((fn) =>
    fn({ key, metaKey: false, ctrlKey: false, altKey: false }));

function dailyGame() { TOGGLE.daily(); }

function seedDaily(pattern, guesses = []) {
  globalThis.localStorage.setItem("toggle-day4", JSON.stringify({
    date: TOGGLE.todayKey(), pattern, guesses, done: false, won: false,
  }));
  dailyGame();
}

// Click the active row's toggles into a pattern, then guess.
// pattern is a "01011"-style string; use "x" to leave a toggle untouched.
function guessPattern(pattern) {
  const row = rowEl(board.children.length - 1);
  // reset any prior flips in this row so "x" means "leave off as-is"
  for (let c = 0; c < 5; c++) {
    if (row.children[c].classList.contains("on")) row.children[c].click();
  }
  for (let c = 0; c < 5; c++) {
    if (pattern[c] === "1") row.children[c].click();
  }
  guessBtn.click();
  runTimers();
}

// ---------- 1. pattern space ----------

for (const key of ["2026-09-16", "2027-01-01", "x"]) {
  const p = TOGGLE.patternFor(key);
  assert.equal(p.length, 5, "pattern length");
  for (const b of p) assert.ok(b === 0 || b === 1, "bits are 0/1");
  assert.deepEqual(TOGGLE.patternFor(key), p, "deterministic");
}
const seen = new Set();
for (let i = 0; i < 400; i++) seen.add(TOGGLE.patternFor("k" + i).join(""));
assert.equal(seen.size, 32, "all 32 patterns reachable across dates");
// uniformity: over ~1600 real dates each pattern should appear ~50 times —
// a month of dailies colliding is inherent (31 draws from 32 patterns).
const counts = {};
for (let m = 1; m <= 12; m++) {
  for (let d = 1; d <= 31; d++) {
    const key = "2026-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0");
    const p = TOGGLE.patternFor(key).join("");
    counts[p] = (counts[p] || 0) + 1;
  }
}
const freqs = Object.values(counts);
assert.equal(freqs.length, 32, "every pattern occurs across the year");
// expected ~11.6 per pattern over 372 dates; min/max bounds are ~2.5 sigma
assert.ok(Math.min(...freqs) >= 4 && Math.max(...freqs) <= 22,
  `patterns spread evenly (min ${Math.min(...freqs)}, max ${Math.max(...freqs)} of 372)`);
console.log("ok — pattern space: 32 patterns, uniform across a year of dailies (min " + Math.min(...freqs) + ", max " + Math.max(...freqs) + ")");

// ---------- 2. fresh daily: one row of five live toggles ----------

store.clear();
dailyGame();

assert.equal(board.children.length, 1, "one pending row");
assert.equal(rowEl(0).children.length, 6, "five toggles + a score chip");
for (let c = 0; c < 5; c++) {
  assert.equal(tog(0, c).tagName, "button", "toggles are buttons");
  assert.ok(!tog(0, c).disabled, "active toggles enabled");
  assert.ok(!isOn(0, c), `toggle(0,${c}) starts off`);
}
assert.equal(chip(0).textContent, "\u00B7", "chip placeholder");
assert.equal(turnline.textContent, "Guess 1 of 10", "countdown live");
const freshSave = readSave();
assert.equal(freshSave.date, TOGGLE.todayKey(), "save stamped with today");
assert.deepEqual(freshSave.pattern, TOGGLE.patternFor(TOGGLE.todayKey()),
  "daily pattern date-derived");
assert.deepEqual(freshSave.guesses, [], "no guesses yet");
console.log("ok — fresh daily: five live toggles, countdown, pattern seeded");

// ---------- 3. toggling + scoring ----------

seedDaily([1, 0, 1, 1, 0]);

tog(0, 1).click(); // ON, but pattern wants OFF → wrong
assert.ok(isOn(0, 1), "clicking a toggle turns it on");
tog(0, 1).click();
assert.ok(!isOn(0, 1), "clicking again turns it off");
tog(0, 1).click(); // leave it wrong

guessPattern("xxxxx"); // helper resets flips, so the guess is all-off [0,0,0,0,0]
// vs pattern [1,0,1,1,0]: the two OFF columns match → 2/5
assert.equal(chip(0).textContent, "2", "chip counts correct toggles");
assert.equal(chip(0).style["--w"], "0.4", "chip colorized by score share");
assert.ok(rowEl(0).classList.contains("scored"), "row scored");
assert.ok(tog(0, 1).disabled, "scored toggles frozen");
assert.equal(board.children.length, 2, "a fresh row waits below");
assert.ok(!tog(1, 0).disabled, "new row live");
assert.equal(turnline.textContent, "Guess 2 of 10", "countdown advances");
assert.deepEqual(readSave().guesses, [[0, 0, 0, 0, 0]], "guess saved");
console.log("ok — scoring: per-toggle points, frozen history, fresh row");

// ---------- 4. full win: 5/5 ends the game immediately ----------

guessPattern("10110"); // exact match
assert.equal(chip(1).textContent, "5", "winning chip reads 5");
assert.equal(chip(1).style["--w"], "1", "winning chip fully saturated");
assert.equal(banner.textContent, "Magnificent", "praise on turn-2 win");
assert.ok(!shareBtn.classList.contains("hidden"), "share appears on win");
const winSave = readSave();
assert.equal(winSave.done, true, "win saved done");
assert.equal(winSave.won, true, "win saved won");
assert.equal(board.children.length, 2, "no extra row after the win");

shareBtn.click();
const ta = createdEls.filter((e) => e.tagName === "textarea").pop();
assert.ok(ta, "share staged a clipboard textarea");
const lines = ta.value.split("\n");
assert.match(lines[0], /^Toggle · \d{4}-\d{2}-\d{2} · 2\/10$/, "share shows date and turns");
assert.equal(lines[1], "https://suitangi.github.io/30Wordles/days/4", "share links to the game");
assert.equal(lines.length, 4, "header + link + two guess rows");
// spoiler-free: scores only, never the patterns
assert.equal(lines[2], "1. 2/5", "first guess shares its score only");
assert.equal(lines[3], "2. 5/5", "winning guess shares its score only");

// finished board is locked
const wasOn = isOn(1, 0);
tog(1, 0).click();
assert.equal(isOn(1, 0), wasOn, "finished board is locked");
console.log("ok — full win: immediate end, share = " + lines[0]);

// ---------- 5. loss: ten wrong guesses, the answer revealed in the banner ----------

seedDaily([1, 0, 1, 1, 0]);
for (let i = 0; i < 9; i++) guessPattern("00000"); // never 5/5
assert.equal(turnline.textContent, "Guess 10 of 10 \u2014 final guess", "last chance announced");
assert.ok(turnline.classList.contains("final"), "final turn flagged");
guessPattern("00000"); // the tenth and final guess
assert.equal(board.children.length, 10, "ten guess rows, no reveal row on the board");
assert.equal(banner.children.length, 2, "banner holds the text + the answer toggles");
assert.equal(banner.children[0].textContent, "Out of guesses", "loss message centered");
const revealRow = banner.children[1];
assert.ok(revealRow.classList.contains("banner-pattern"), "pattern row styled");
for (let c = 0; c < 5; c++) {
  assert.equal(revealRow.children[c].classList.contains("on"),
    [1, 0, 1, 1, 0][c] === 1, `banner toggle(${c}) shows the answer`);
  assert.equal(revealRow.children[c].tagName, "span", "banner toggles are view-only");
}
const lostSave = readSave();
assert.equal(lostSave.done, true, "loss saved done");
assert.equal(lostSave.won, false, "loss saved not won");
assert.equal(lostSave.guesses.length, 10, "all ten guesses saved");
tog(9, 0).click();
assert.ok(!isOn(9, 0), "board frozen after loss");
console.log("ok — loss: answer revealed as toggles inside the banner");

dailyGame(); // refresh: the loss banner must survive
assert.equal(board.children.length, 10, "board restored without a reveal row");
assert.equal(banner.children.length, 2, "loss banner rebuilt");
const restoredRow = banner.children[1];
for (let c = 0; c < 5; c++) {
  assert.equal(restoredRow.children[c].classList.contains("on"),
    [1, 0, 1, 1, 0][c] === 1, `restored banner toggle(${c})`);
}
assert.equal(banner.children[0].textContent, "Out of guesses", "loss message restored");
console.log("ok — restored loss keeps the banner pattern");

// ---------- 6. refresh mid-game: restore rows, countdown, keep playing ----------

seedDaily([1, 0, 1, 1, 0]);
guessPattern("00000"); // 1/5 — a wrong first guess
dailyGame();
assert.equal(board.children.length, 2, "one scored row + pending row");
assert.ok(chip(0).textContent === "2", "scored row restored");
for (let c = 0; c < 5; c++) assert.ok(tog(0, c).disabled, "restored row frozen");
assert.ok(!tog(1, 0).disabled, "pending row live");
assert.equal(turnline.textContent, "Guess 2 of 10", "countdown restored");
// active row resets to all-off after restore; play on and win
guessPattern("10110");
assert.equal(banner.textContent, "Magnificent", "win after refresh");
console.log("ok — refresh mid-game: rows, score and countdown restored");

// ---------- 7. refresh after finishing ----------

dailyGame();
assert.equal(banner.textContent, "Magnificent", "finished banner restored");
assert.ok(!shareBtn.classList.contains("hidden"), "share offered again");
guessPattern("00000");
assert.equal(board.children.length, 2, "restored board stays locked");
console.log("ok — refresh after finishing: board, banner and lock restored");

// ---------- 8. next day: fresh puzzle ----------

const stale = readSave();
stale.date = "1999-12-31";
globalThis.localStorage.setItem("toggle-day4", JSON.stringify(stale));
dailyGame();
const nextSave = readSave();
assert.notEqual(nextSave.date, "1999-12-31", "stale save replaced");
assert.deepEqual(nextSave.pattern, TOGGLE.patternFor(TOGGLE.todayKey()), "new day, new pattern");
assert.deepEqual(nextSave.guesses, [], "guesses reset");
assert.equal(board.children.length, 1, "single pending row");
assert.equal(turnline.textContent, "Guess 1 of 10", "countdown reset");
console.log("ok — next day: fresh board and countdown");

// ---------- 9. practice mode: forced pattern, daily save untouched ----------

const saveBeforePractice = globalThis.localStorage.getItem("toggle-day4");
TOGGLE.practice("01101");
assert.equal(banner.textContent, "Practice round", "practice banner shown");
assert.equal(newBtn.textContent, "Today\u2019s puzzle", "button offers the way back");
assert.match(TOGGLE.dump(), /pattern: OFF \u00B7 ON \u00B7 ON \u00B7 OFF \u00B7 ON/,
  "forced practice pattern in effect");
guessPattern("01101");
assert.equal(banner.textContent, "Genius", "practice win against forced pattern");
assert.equal(globalThis.localStorage.getItem("toggle-day4"), saveBeforePractice,
  "practice guesses never touch the daily save");
shareBtn.click();
const pta = createdEls.filter((e) => e.tagName === "textarea").pop();
assert.match(pta.value.split("\n")[0], /^Toggle · practice · 1\/10$/,
  "practice share shows the practice tag");
newBtn.click();
assert.equal(newBtn.textContent, "Practice", "button back to Practice");
console.log("ok — practice mode: forced pattern, no save writes, round-trips to daily");

// ---------- 10. dump + Enter submit ----------

seedDaily([1, 0, 1, 1, 0]);
tog(0, 0).click();
tog(0, 2).click();
keydown("Enter"); // Enter submits (guess button not focused)
runTimers();
assert.equal(chip(0).textContent, "4", "Enter submitted the guess");
const dump = TOGGLE.dump();
assert.match(dump, /pattern: ON \u00B7 OFF \u00B7 ON \u00B7 ON \u00B7 OFF/, "dump names the pattern");
assert.match(dump, /1\. 10100  4\/5/, "dump replays guesses with scores");
assert.match(dump, /raw save: /, "dump includes the raw save");
console.log("ok — dump replays the game; Enter submits");
console.log("ok — dump:\n" + dump);

console.log("\nAll toggle tests passed.");
