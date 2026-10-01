// Headless tests for js/cycle.js. Loads the real game script against a
// minimal DOM stub and drives full games through the keyboard handler.
// Run: node tests/cycle.test.js
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
["board", "keyboard", "banner", "toast", "new-btn", "giveup-btn",
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
const GAME_URL = "https://suitangi.github.io/30Wordles/days/18";

require(path.join(__dirname, "..", "js", "cycle.js"));
const CYCLE = globalThis.CYCLE;
assert.ok(CYCLE, "cycle.js must expose window.CYCLE");

const board = byId.board;
const banner = byId.banner;
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
const rowTiles = (r) => board.children[r].children;
const modeChip = (r) => board.children[r].children[5];
const readSave = () => JSON.parse(globalThis.localStorage.getItem("cycle-day18"));

// Type a word and submit it, playing out the whole reveal.
function typeRow(word) {
  for (const ch of word) keydown(ch);
  keydown("Enter");
  runTimers();
}

function dailyGame() {
  CYCLE.daily();
}

function seedDaily(answer, guesses = [], extra = {}) {
  globalThis.localStorage.setItem("cycle-day18", JSON.stringify({
    date: CYCLE.todayKey(), answer, guesses, done: false, won: false,
    gaveUp: false, ...extra,
  }));
  dailyGame();
}

// ---------- independent cycle model (the test's own truth) ------------------

const M = (marksStr) => marksStr.split("").map((ch) => ({ K: "correct", P: "present", A: "absent" }[ch]));
const K = "correct", P = "present", A = "absent";
const OPEN_BANNER = "Guesses cycle \u2014 yellow-only, then green";

// the display law, rebuilt from the spec
function shown(trueMark, mode) {
  if (mode === "y") return trueMark === K ? P : trueMark;
  return trueMark === P ? A : trueMark;
}

const tiles = (r) => rowTiles(r).slice(0, 5);
const marksOf = (r) => tiles(r).map((t) =>
  t.classList.contains("correct") ? K
    : t.classList.contains("present") ? P : A);

// ---------- 1. word list sanity ----------

assert.equal(ANSWERS.length, 2315, "answers count");
assert.equal(DICT.size, 14855, "guessable count");
for (const w of ANSWERS) {
  assert.match(w, /^[a-z]{5}$/, `answer "${w}" shape`);
  assert.ok(DICT.has(w), `answer "${w}" must be guessable`);
}
for (const w of ["crane", "range", "cramp", "apple", "nadir", "hoist"]) {
  assert.ok(DICT.has(w), `test word "${w}" is guessable`);
}
console.log("ok — word lists (2315 answers, 14855 guessable, test words present)");

// ---------- 2. the cycle: modes and the display law --------------------------

assert.equal(CYCLE.ROWS, 8, "eight guesses");
assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map(CYCLE.modeFor),
  ["y", "g", "y", "g", "y", "g", "y", "g"], "yellow first, alternating, green last");
assert.equal(CYCLE.displayMark(K, "y"), P, "yellow mode demotes greens to yellow");
assert.equal(CYCLE.displayMark(P, "y"), P, "yellow mode keeps yellows");
assert.equal(CYCLE.displayMark(A, "y"), A, "yellow mode keeps grays");
assert.equal(CYCLE.displayMark(K, "g"), K, "green mode keeps greens");
assert.equal(CYCLE.displayMark(P, "g"), A, "green mode downgrades yellows to gray");
assert.equal(CYCLE.displayMark(A, "g"), A, "green mode keeps grays");
console.log("ok — the cycle: y/g alternate from yellow, display law holds");

// ---------- 3. fresh daily: one waiting row in yellow mode -------------------

store.clear();
dailyGame();

const freshAnswer = CYCLE.answerFor(CYCLE.todayKey());
assert.equal(board.children.length, 1, "one waiting row");
assert.equal(modeChip(0).textContent, "Y", "the opener scores yellow-only");
assert.ok(modeChip(0).classList.contains("y"), "the chip wears the mode");
assert.ok(board.children[0].classList.contains("on-row"), "the waiting row holds the ring");
assert.equal(banner.textContent, OPEN_BANNER, "the game is announced");
assert.ok(!giveUpBtn.classList.contains("hidden"), "give up offered on a fresh board");
assert.ok(shareBtn.classList.contains("hidden"), "no share before an end state");

const freshSave = readSave();
assert.equal(freshSave.date, CYCLE.todayKey(), "save stamped with today");
assert.equal(freshSave.answer, freshAnswer, "daily answer is date-derived");
assert.deepEqual(freshSave.guesses, [], "no guesses yet");
console.log(`ok — fresh daily: ${freshSave.date}, answer ${freshAnswer}, yellow mode up first`);

// ---------- 4. the full win on the opener: the truth re-flip -----------------

WIN_REFLIP: {
  CYCLE.practice("crane");
  typeRow("crane"); // a YELLOW guess — the answer demotes to yellow, then lifts
  assert.deepEqual(marksOf(0), M("KKKKK"),
    "the yellow-guess win re-flips to its true greens — the victory lap");
  assert.ok(modeChip(0).classList.contains("y"), "the chip records the mode");
  assert.equal(banner.textContent, "Genius — 1 guess", "praised by the count");
  assert.ok(!shareBtn.classList.contains("hidden"), "share appears on the win");
  for (const t of tiles(0)) assert.ok(t.classList.contains("win-glow"), "the win glows");
  for (const ch of "crane") assert.ok(keyFor(ch).classList.contains("correct"),
    `${ch} key went true green with the re-flip`);
  keydown("a");
  assert.equal(CYCLE.dump().guesses.length, 1, "board locked after the win");
}
shareBtn.click();
{
  const ta = createdEls.filter((e) => e.tagName === "textarea").pop();
  const lines = ta.value.split("\n");
  assert.equal(lines[0], "Cycle · practice · 1/8", "share carries the count over eight");
  assert.equal(lines[1], GAME_URL, "share links to the game");
  assert.equal(lines[2], "\uD83D\uDFE9".repeat(5), "the winning row shares its true greens");
}
console.log("ok — the opener win: answer on a yellow guess, re-flipped to green, share 1/8");

// ---------- 5. the yellow fog, then the green guess reveals ------------------

CYCLE.practice("crane");
typeRow("range"); // yellow mode: membership only — even range's green e hides
{
  assert.deepEqual(marksOf(0), M("PPPAP"),
    "range on a yellow guess: the exact e demotes to yellow with the rest");
  assert.ok(keyFor("e").classList.contains("present"),
    "the fog holds: e reads yellow, never green");
  assert.ok(keyFor("g").classList.contains("absent"), "g heard plain gray");
  assert.ok(board.children[0].classList.contains("on-row") === false, "the played row hands over the ring");
  assert.equal(modeChip(1).textContent, "G", "guess two is green-only");
  assert.ok(board.children[1].classList.contains("on-row"), "the ring moved");
}
typeRow("cramp"); // true KKKAA — a GREEN guess shows it straight
{
  assert.deepEqual(marksOf(1), M("KKKAA"),
    "the green guess shows cramp's greens in place");
  assert.ok(keyFor("c").classList.contains("correct") &&
    keyFor("r").classList.contains("correct") &&
    keyFor("a").classList.contains("correct"),
    "the green guess reveals what the yellow fog hid");
  assert.ok(keyFor("m").classList.contains("absent"), "m heard plain gray");
}
console.log("ok — the cycle: yellow fogs the opener, the green guess reveals positions");

// ---------- 6. the downgrade — but the keyboard remembers --------------------

typeRow("apple"); // true PAAAK — a YELLOW guess: a shows, e demotes again
{
  assert.deepEqual(marksOf(2), M("PAAAP"),
    "apple on a yellow guess: the a surfaces, the green e demotes");
  assert.ok(keyFor("e").classList.contains("present"),
    "e's key is still only yellow — no green has ever been shown for it");
}
typeRow("nadir"); // true PPAAP — a GREEN guess grades n, a, r down to gray
{
  assert.deepEqual(CYCLE.evaluate("nadir", "crane"), M("PPAAP"),
    "nadir truth: n, a, r all present-not-correct");
  assert.deepEqual(marksOf(3), M("AAAAA"),
    "the green guess grades every yellow down to gray — a gray row");
  assert.ok(keyFor("n").classList.contains("present"),
    "the spec: n's yellow survives the green guess's gray — no downgrades");
  assert.ok(keyFor("a").classList.contains("correct"),
    "a is beyond the question — cramp's green held");
  assert.ok(keyFor("r").classList.contains("correct"), "r's green (from cramp) stays");
  assert.equal(modeChip(3).textContent, "G", "guess four in green mode");
}
console.log("ok — the downgrade: a gray row on the board, yellows alive on the keyboard");

// ---------- 7. winning on a yellow guess: the mode lifts ---------------------

CYCLE.practice("crane");
typeRow("hoist"); // yellow guess, all gray vs crane
typeRow("hoist"); // green guess, same grays
typeRow("crane"); // yellow guess — the answer itself
{
  assert.deepEqual(marksOf(2), M("KKKKK"),
    "the yellow-guess win re-flips to its true greens — the victory lap");
  assert.equal(banner.textContent, "Impressive — 3 guesses", "praised by the count");
  for (const t of tiles(2)) assert.ok(t.classList.contains("win-glow"), "the win glows");
  for (const ch of "crane") {
    assert.ok(keyFor(ch).classList.contains("correct"), `${ch} key green at last`);
  }
  keydown("a");
  assert.equal(CYCLE.dump().guesses.length, 3, "board locked");
}
shareBtn.click();
{
  const ta = createdEls.filter((e) => e.tagName === "textarea").pop();
  const lines = ta.value.split("\n");
  assert.equal(lines[0], "Cycle · practice · 3/8", "share counts over eight");
  assert.equal(lines[2], "\u2B1C".repeat(5), "the gray opener shares gray");
  assert.equal(lines[4], "\uD83D\uDFE9".repeat(5), "the winning row shares its true greens");
}
console.log("ok — the yellow-guess win: truth re-flip, keyboard goes green, share tells both");

// ---------- 8. eight misses end it -------------------------------------------

CYCLE.practice("crane");
for (let i = 0; i < 8; i++) {
  typeRow("hoist");
  if (i < 7) assert.equal(CYCLE.dump().done, false, `alive after ${i + 1} misses`);
}
{
  assert.equal(CYCLE.dump().done, true, "the eighth miss ends it");
  assert.equal(board.children.length, 8, "eight rows, no ninth");
  assert.deepEqual([...board.children].map((_, r) => modeChip(r).textContent),
    ["Y", "G", "Y", "G", "Y", "G", "Y", "G"], "the chips cycled Y/G all the way down");
  assert.equal(banner.textContent, "The word was CRANE", "the loss is named");
  assert.ok(!shareBtn.classList.contains("hidden"), "share offered");
  keydown("a");
  assert.equal(CYCLE.dump().guesses.length, 8, "board locked at eight");
}
shareBtn.click();
{
  const ta = createdEls.filter((e) => e.tagName === "textarea").pop();
  assert.equal(ta.value.split("\n")[0], "Cycle · practice · X/8", "exhaustion tagged X/8");
}
console.log("ok — exhaustion: eight guesses, chips cycled Y/G, X/8");

// ---------- 9. give up ---------------------------------------------------------

CYCLE.practice("crane");
for (const ch of "cr") keydown(ch);
giveUpBtn.click();
{
  assert.equal(banner.textContent, "The word was CRANE", "give up reveals the word");
  assert.equal(rowTiles(0)[0].textContent, "", "the half-typed word cleared");
  assert.ok(board.children[0].classList.contains("on-row") === false,
    "the waiting row's ring retired");
  assert.ok(!shareBtn.classList.contains("hidden"), "share offered after give up");
  assert.equal(CYCLE.dump().gaveUp, true, "gaveUp flag explicit");
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
    `Cycle · ${CYCLE.todayKey()} · gave up · 0/8`, "surrender tagged in the share");
}
console.log("ok — give up: clears the row, retires the ring, saves, shares gave up · N/8");

// ---------- 10. refresh mid-game: modes, fog and keyboard restored ------------

seedDaily("crane", ["range", "cramp"]);
dailyGame(); // simulated refresh
{
  assert.equal(board.children.length, 3, "two scored rows + the waiting row");
  assert.ok(board.children[0].classList.contains("quiet"), "restored rows are quiet");
  assert.deepEqual(marksOf(0), M("PPPAP"),
    "range restored DEMOTED — the yellow mode is the record");
  assert.deepEqual(marksOf(1), M("KKKAA"), "cramp restored in its green mode");
  assert.deepEqual([modeChip(0).textContent, modeChip(1).textContent, modeChip(2).textContent],
    ["Y", "G", "Y"], "chips restored: the cycle resumes");
  assert.ok(board.children[2].classList.contains("on-row"), "the waiting row holds the ring");
  assert.ok(keyFor("c").classList.contains("correct"),
    "the keyboard restored the green guess's reveal");
  assert.ok(keyFor("e").classList.contains("present"),
    "and the fog: e is still only yellow, no green ever shown");
  assert.equal(banner.textContent, OPEN_BANNER, "the game is re-announced");
  typeRow("crane"); // guess three, yellow mode — wins through the fog
  assert.equal(banner.textContent, "Impressive — 3 guesses", "play continues after a refresh and wins");
}

dailyGame(); // refresh the just-won daily
{
  assert.equal(banner.textContent, "Impressive — 3 guesses", "won banner restored");
  assert.deepEqual(marksOf(2), M("KKKKK"), "the win row restored in true greens");
  assert.ok(!shareBtn.classList.contains("hidden"), "share offered again");
  keydown("a");
  assert.equal(CYCLE.dump().guesses.length, 3, "restored won board is locked");
}

// a finished loss restores too
seedDaily("crane", Array(8).fill("hoist"), { done: true, won: false });
dailyGame();
{
  assert.equal(board.children.length, 8, "eight rows restored, no waiting row");
  assert.equal(banner.textContent, "The word was CRANE", "loss banner restored");
  keydown("a");
  assert.equal(CYCLE.dump().guesses.length, 8, "restored lost board is locked");
}
console.log("ok — refresh mid-game: modes, demoted marks, fog and end states all restored");

// ---------- 11. corrupt saves -------------------------------------------------

const good = { date: CYCLE.todayKey(), answer: "crane", guesses: [],
  done: false, won: false, gaveUp: false };
for (const bad of [
  { ...good, answer: "qqqqq" },                          // not a word
  { ...good, answer: 42 },                               // not a string
  { date: CYCLE.todayKey(), guesses: [] },               // no answer
  { ...good, guesses: "crane" },                         // not an array
  { ...good, guesses: ["qqqqq"] },                       // non-word guess
  { ...good, guesses: Array(9).fill("hoist") },          // nine guesses
]) {
  globalThis.localStorage.setItem("cycle-day18", JSON.stringify(bad));
  dailyGame();
  const s = readSave();
  assert.equal(s.answer, CYCLE.answerFor(CYCLE.todayKey()),
    `corrupt save ${JSON.stringify(bad).slice(0, 40)}… replaced by a fresh daily`);
  assert.deepEqual(s.guesses, [], "corrupt save's guesses discarded");
}
console.log("ok — corrupt saves: stale/fake/overlong saves fall back fresh");

// ---------- 12. practice: isolation, forced words, dump -----------------------

const saveBeforePractice = globalThis.localStorage.getItem("cycle-day18");
const craneIdx = ANSWERS.indexOf("crane");
Math.random = () => (craneIdx + 0.5) / ANSWERS.length;

CYCLE.practice();
assert.equal(banner.textContent, "Practice round", "practice banner shown");
assert.equal(newBtn.textContent, "Today\u2019s puzzle", "button offers the way back");
assert.equal(CYCLE.dump().answer, ANSWERS[craneIdx], "random word honors the Math.random stub");

CYCLE.practice("qqqqq");
assert.ok(DICT.has(CYCLE.dump().answer), "invalid forced word rejected");

const d = CYCLE.dump();
for (const field of ["answer", "guesses", "typed", "modes", "nextMode",
  "practice", "done", "won", "gaveUp", "save"]) {
  assert.ok(field in d, `dump exposes ${field}`);
}
assert.equal(globalThis.localStorage.getItem("cycle-day18"), saveBeforePractice,
  "practice never touches the daily save");

newBtn.click();
assert.equal(newBtn.textContent, "Practice", "button back to Practice");
assert.equal(banner.textContent, OPEN_BANNER, "fresh daily re-announced");
console.log("ok — practice: forced words, dump, no daily writes");

// ---------- 13. solvability sweep: the opener is ordinary wordle --------------

let swept = 0;
for (let i = 0; i < 40; i++) {
  const key = `2027-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`;
  seedDaily(CYCLE.answerFor(key));
  const a = CYCLE.dump().answer;
  typeRow(a); // guess one is a green guess — the answer wins outright
  assert.ok(readSave().won, `${key}: opening with the answer wins`);
  swept++;
}
console.log(`ok — solvability sweep: ${swept} sampled dailies all won by the opener`);

console.log("\nAll cycle tests passed.");
