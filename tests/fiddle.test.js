// Headless tests for js/fiddle.js. Loads the real game script against a
// minimal DOM stub and drives full games through the keyboard handler.
// Run: node tests/fiddle.test.js
"use strict";

const assert = require("assert/strict");
const path = require("path");

// ---------- minimal DOM / browser stubs (before loading the game) ----------

const timers = [];
globalThis.setTimeout = (fn) => { timers.push(fn); return timers.length; };
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
const WORDS = WORD_LISTS.guesses;
const GAME_URL = "https://suitangi.github.io/30Wordles/days/17";

require(path.join(__dirname, "..", "js", "fiddle.js"));
const FIDDLE = globalThis.FIDDLE;
assert.ok(FIDDLE, "fiddle.js must expose window.FIDDLE");

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
const countChip = (r) => board.children[r].children[5];
const readSave = () => JSON.parse(globalThis.localStorage.getItem("fiddle-day17"));

// Type a word and submit it, playing out the whole reveal.
function typeRow(word) {
  for (const ch of word) keydown(ch);
  keydown("Enter");
  runTimers();
}

function dailyGame() {
  FIDDLE.daily();
}

function seedDaily(answer, guesses = [], extra = {}) {
  globalThis.localStorage.setItem("fiddle-day17", JSON.stringify({
    date: FIDDLE.todayKey(), answer, guesses, done: false, won: false,
    gaveUp: false, ...extra,
  }));
  dailyGame();
}

// ---------- independent fiddle model (the test's own truth) ------------------

// Rebuilt from the spec, not from fiddle.js: order-free multiset overlap.
function shared(a, b) {
  const copies = {};
  for (const ch of a) copies[ch] = (copies[ch] || 0) + 1;
  let n = 0;
  for (const ch of b) {
    if (copies[ch] > 0) { copies[ch]--; n++; }
  }
  return n;
}

const M = (marksStr) => marksStr.split("").map((ch) => ({ K: "correct", P: "present", A: "absent" }[ch]));
const K = "correct", P = "present", A = "absent";
const OPEN_BANNER = "Every guess keeps 3 letters of the last";
const CHECK = "\u2713";
const NEEDED = 3, ROWS = 8;

// A row is 5 tiles + the counter; tiles are children 0-4.
const tiles = (r) => rowTiles(r).slice(0, 5);

// Greedy legal continuation: any dictionary word keeping 3 letters of
// `prev`, never the answer, never reused.
function legalNext(prev, used) {
  for (const w of WORDS) {
    if (used.has(w) || w === "crane") continue;
    if (shared(prev, w) >= NEEDED) return w;
  }
  return null;
}

// ---------- 1. word list sanity ----------

assert.equal(ANSWERS.length, 2315, "answers count");
assert.equal(DICT.size, 14855, "guessable count");
for (const w of ANSWERS) {
  assert.match(w, /^[a-z]{5}$/, `answer "${w}" shape`);
  assert.ok(DICT.has(w), `answer "${w}" must be guessable`);
}
for (const w of ["crane", "range", "grade", "hoist", "cramp", "grape"]) {
  assert.ok(DICT.has(w), `test word "${w}" is guessable`);
}
console.log("ok — word lists (2315 answers, 14855 guessable, test words present)");

// ---------- 2. the fiddle overlap: order-free, counted per copy --------------

assert.equal(FIDDLE.NEEDED, 3, "three letters owed");
assert.equal(FIDDLE.ROWS, 8, "eight guesses");
assert.equal(FIDDLE.sharedWith("crane", "crane"), 5, "a word keeps itself");
assert.equal(FIDDLE.sharedWith("crane", "cramp"), 3, "c,r,a carry over");
assert.equal(FIDDLE.sharedWith("crane", "narce"), 5, "order is free");
assert.equal(FIDDLE.sharedWith("hoist", "crane"), 0, "strangers share nothing");
assert.equal(FIDDLE.sharedWith("eerie", "eerie"), 5, "duplicates pair up");
assert.equal(FIDDLE.sharedWith("tests", "eerie"), 1, "one e in tests, three in eerie: 1");
assert.equal(FIDDLE.sharedWith("eerie", "seekr"), 3, "two e's + r, capped by eerie's copies");
console.log("ok — shared letters: multiset overlap, order-free, per copy");

// ---------- 3. evaluate: standard Wordle two-pass, duplicates included ------

assert.deepEqual(FIDDLE.evaluate("crane", "crane"), M("KKKKK"), "exact match");
assert.deepEqual(FIDDLE.evaluate("eerie", "erase"), M("KAPAK"),
  "repeated letters: greens first, strays consume target copies in order");
console.log("ok — evaluate: two-pass, duplicates handled");

// ---------- 4. fresh daily: one waiting row, no debt yet ---------------------

store.clear();
dailyGame();

const freshAnswer = FIDDLE.answerFor(FIDDLE.todayKey());
assert.equal(board.children.length, 1, "one waiting row");
assert.equal(countChip(0).textContent, "", "the first guess owes nothing");
assert.equal(banner.textContent, OPEN_BANNER, "the game is announced");
assert.ok(!giveUpBtn.classList.contains("hidden"), "give up offered on a fresh board");
assert.ok(shareBtn.classList.contains("hidden"), "no share before an end state");

const freshSave = readSave();
assert.equal(freshSave.date, FIDDLE.todayKey(), "save stamped with today");
assert.equal(freshSave.answer, freshAnswer, "daily answer is date-derived");
assert.deepEqual(freshSave.guesses, [], "no guesses yet");
console.log(`ok — fresh daily: ${freshSave.date}, answer ${freshAnswer}`);

// ---------- 5. the full win: the answer opens, the chain is untested ---------

FIDDLE.practice("crane");
{
  keydown("c");
  keydown("r");
  assert.equal(countChip(0).textContent, "", "still no debt while typing the free guess");
  for (const t of tiles(0)) assert.ok(!t.classList.contains("shared"),
    "no outline on the free guess — nothing to share with yet");
  keydown("Backspace");
  assert.equal(countChip(0).textContent, "", "no debt after backspace either");
  keydown("r"); // retype it
  keydown("a");
  keydown("n");
  keydown("e");
}
keydown("Enter");
runTimers();
{
  assert.deepEqual([...tiles(0)].map((t) => t.classList.contains("correct")),
    [true, true, true, true, true], "five greens");
  assert.equal(countChip(0).textContent, CHECK, "the submitted row settles at the check");
  assert.ok(countChip(0).classList.contains("ok"), "the check wears the accent");
  assert.equal(banner.textContent, "Genius — 1 guess", "praised by the count");
  assert.ok(!shareBtn.classList.contains("hidden"), "share appears on the win");
  assert.ok(giveUpBtn.classList.contains("hidden"), "give up retires");
  for (const t of tiles(0)) assert.ok(t.classList.contains("win-glow"), "the win glows");
  keydown("a");
  assert.equal(FIDDLE.dump().guesses.length, 1, "board locked after the win");
}

shareBtn.click();
{
  const ta = createdEls.filter((e) => e.tagName === "textarea").pop();
  const lines = ta.value.split("\n");
  assert.equal(lines[0], "Fiddle · practice · 1/8", "share carries the count over eight");
  assert.equal(lines[1], GAME_URL, "share links to the game");
  assert.equal(lines[2], "\uD83D\uDFE9".repeat(5), "a standard green row");
}
console.log("ok — the win: free opener, check on the row, praise, share 1/8");

// ---------- 6. the fiddle rule: the counter lives with the typing ------------

FIDDLE.practice("crane");
typeRow("range"); // free opener; r,a,n,e carry
{
  assert.equal(countChip(0).textContent, CHECK, "range settled at the check");
  assert.equal(countChip(1).textContent, "3", "the new row opens owing three");
  assert.ok(!countChip(1).classList.contains("ok"), "unsettled counter is muted");
}

// the counter ticks down as shared letters land — and each typed letter
// that counts wears the steel outline, per the same math
const EXPECTED_FLAGS = {
  g: [true, false, false, false, false],
  gr: [true, true, false, false, false],
  gra: [true, true, true, false, false],
  grap: [true, true, true, false, false],
  grape: [true, true, true, false, true],
};
for (const [prefix, n] of [["g", "2"], ["gr", "1"], ["gra", CHECK], ["grap", CHECK], ["grape", CHECK]]) {
  keydown(prefix[prefix.length - 1]);
  assert.equal(countChip(1).textContent, n, `counter after typing "${prefix}"`);
  assert.equal(countChip(1).classList.contains("ok"), n === CHECK, `ok state after "${prefix}"`);
  assert.deepEqual([...tiles(1)].map((t) => t.classList.contains("shared")),
    EXPECTED_FLAGS[prefix], `outlined tiles after typing "${prefix}"`);
}
keydown("Backspace");
keydown("Backspace"); // drop p and a: "gra" still keeps g, r, a — the check holds
{
  assert.equal(countChip(1).textContent, CHECK, "gra alone still satisfies the fiddle");
  keydown("Backspace"); // drop the a: "gr" keeps two
  assert.equal(countChip(1).textContent, "1", "backspace hands the check back");
  assert.equal(rowTiles(1)[2].classList.contains("shared"), false,
    "the erased letter's outline went with it");
  keydown("a");
  assert.equal(countChip(1).textContent, CHECK, "the check returns");
  keydown("p");
  keydown("e"); // back to the full grape
}
keydown("Enter");
runTimers();
{
  assert.equal(FIDDLE.dump().guesses[1], "grape", "grape played");
  assert.deepEqual(FIDDLE.evaluate("grape", "crane"), M("AKKAK"),
    "grape marks: r and a are green IN PLACE (the rains lesson)");
  assert.equal(countChip(1).textContent, CHECK, "row two checked");
  for (const t of tiles(1)) assert.ok(!t.classList.contains("shared"),
    "the outline retires once the row plays — marks own the tiles now");
}

// a word that keeps too few letters is refused, and keeps its letters —
// the counter names the debt, the toast names both numbers
typeRow("hoist"); // nothing shared with grape
{
  assert.equal(toast.textContent, "Only 0 from GRAPE — need 3", "the refusal names the numbers");
  assert.equal(rowTiles(2)[0].textContent + rowTiles(2)[4].textContent, "ht", "the letters stay for editing");
  assert.equal(countChip(2).textContent, "3", "the counter still shows the debt");
  assert.equal(FIDDLE.dump().guesses.length, 2, "hoist never played");
  assert.equal(board.children.length, 3, "no fresh row after a refusal");
}
for (let i = 0; i < 5; i++) keydown("Backspace");
typeRow("grind"); // g,r only — one short of grape's five
{
  assert.equal(toast.textContent, "Only 2 from GRAPE — need 3", "two shared is still short");
  assert.equal(FIDDLE.dump().guesses.length, 2, "grind never played either");
}
for (let i = 0; i < 5; i++) keydown("Backspace");
typeRow("grade"); // g,r,a,d,e vs grape: 4 shared — legal
{
  assert.equal(FIDDLE.dump().guesses[2], "grade", "grade played");
  assert.equal(countChip(2).textContent, CHECK, "row three checked");
  assert.equal(countChip(3).textContent, "3", "the chain never rests: row four owes grade three");
  assert.ok(keyFor("g").classList.contains("absent"), "keyboard heard grape's g");
  assert.ok(keyFor("e").classList.contains("correct"), "keyboard heard range's green");
}
console.log("ok — the fiddle rule: counter ticks live, short words refused, letters kept");

// ---------- 7. the chain watches only its own predecessor --------------------

FIDDLE.practice("crane");
typeRow("range"); // g1
typeRow("grape"); // shares 4 with range
{
  assert.equal(FIDDLE.sharedWith("crank", "range"), 3,
    "precondition: crank keeps 3 of range");
  assert.equal(FIDDLE.sharedWith("crank", "grape"), 2,
    "precondition: crank keeps only 2 of grape");
  // crank was legal one guess ago — the chain doesn't care. It owes GRAPE.
  typeRow("crank");
  assert.equal(toast.textContent, "Only 2 from GRAPE — need 3",
    "the chain reads the LAST guess, not the one before it");
  assert.equal(FIDDLE.dump().guesses.length, 2, "crank never played");
}
for (let i = 0; i < 5; i++) keydown("Backspace");
typeRow("parer"); // p,a,r,e,r vs grape: 4 shared — a doubled r counts once
{
  assert.equal(FIDDLE.dump().guesses[2], "parer", "parer played");
}

// the outline counts per copy: eerie offers three e's, seeks keeps two —
// and a refused word KEEPS its letters and its outline
FIDDLE.practice("crane");
typeRow("eerie"); // free opener
for (const ch of "seeks") keydown(ch);
{
  assert.deepEqual(FIDDLE.sharedFlags(["s", "e", "e", "k", "s"], "eerie"),
    [false, true, true, false, false], "flags: the two e's, capped by eerie's pool");
  assert.deepEqual([...tiles(1)].map((t) => t.classList.contains("shared")),
    [false, true, true, false, false], "exactly the two e tiles outlined");
  assert.equal(countChip(1).textContent, "1", "two kept, one still owed");
  keydown("Enter");
  runTimers();
  assert.equal(toast.textContent, "Only 2 from EERIE — need 3", "two copies weren't enough");
  assert.deepEqual([...tiles(1)].map((t) => t.classList.contains("shared")),
    [false, true, true, false, false], "a refused word keeps its outline for editing");
}
console.log("ok — the chain: each guess owes the last one alone, doubles count per copy");

// ---------- 8. refresh mid-game: chain, marks, checks all restored -----------

assert.ok(shared("range", "grade") >= 3, "precondition: range → grade is a legal chain");
seedDaily("crane", ["range", "grade"]);
dailyGame(); // simulated refresh
{
  assert.equal(board.children.length, 3, "two scored rows + the waiting row");
  assert.ok(board.children[0].classList.contains("quiet"), "restored rows are quiet");
  assert.deepEqual([...tiles(0)].map((t) => t.classList.contains("present")),
    [true, true, true, false, false], "range restored");
  assert.ok(tiles(0)[4].classList.contains("correct"), "range's green restored");
  assert.equal(countChip(0).textContent, CHECK, "row one's check restored");
  assert.equal(countChip(1).textContent, CHECK, "row two's check restored");
  assert.equal(countChip(2).textContent, "3", "the waiting row still owes grade three");
  assert.equal(banner.textContent, OPEN_BANNER, "the game is re-announced");
  assert.ok(keyFor("e").classList.contains("correct"), "keyboard colors restored");
  typeRow("crane"); // crane vs grade: r,a,e — three, just legal
  assert.equal(banner.textContent, "Impressive — 3 guesses", "play continues after a refresh and wins");
}

dailyGame(); // refresh the just-won daily
{
  assert.equal(banner.textContent, "Impressive — 3 guesses", "won banner restored");
  assert.ok(!shareBtn.classList.contains("hidden"), "share offered again");
  for (const t of tiles(2)) assert.ok(t.classList.contains("win-glow"), "the win glow restored");
  keydown("a");
  assert.equal(FIDDLE.dump().guesses.length, 3, "restored won board is locked");
}

// a finished loss restores too: eight cramps never win
seedDaily("crane", Array(ROWS).fill("cramp"), { done: true, won: false });
dailyGame();
{
  assert.equal(board.children.length, ROWS, "eight rows restored, no waiting row");
  assert.equal(banner.textContent, "The word was CRANE", "loss banner restored");
  assert.ok(!shareBtn.classList.contains("hidden"), "share offered on the loss");
  keydown("a");
  assert.equal(FIDDLE.dump().guesses.length, 8, "restored lost board is locked");
}
console.log("ok — refresh mid-game: chain re-checked, marks/checks/end states restored");

// ---------- 9. eight misses end it: the legal-chain exhaustion ---------------

FIDDLE.practice("crane");
{
  const used = new Set();
  let prev = "hoist"; // shares nothing with the answer — a legal free opener
  for (let r = 0; r < ROWS; r++) {
    typeRow(prev);
    assert.equal(FIDDLE.dump().guesses.length, r + 1,
      `guess ${r + 1} accepted: ${prev} kept 3 of ${r ? "the last" : "nothing"}`);
    if (r < ROWS - 1) {
      assert.equal(FIDDLE.dump().done, false, `alive after ${r + 1} misses`);
      used.add(prev);
      prev = legalNext(prev, used);
      assert.ok(prev, `a legal ${r + 2}th guess exists`);
    }
  }
  assert.equal(board.children.length, ROWS, "eight rows, no ninth");
  assert.equal(banner.textContent, "The word was CRANE", "the loss is named");
  assert.ok(!shareBtn.classList.contains("hidden"), "share offered");
  keydown("a");
  assert.equal(FIDDLE.dump().guesses.length, 8, "board locked at eight");
}
shareBtn.click();
{
  const ta = createdEls.filter((e) => e.tagName === "textarea").pop();
  assert.equal(ta.value.split("\n")[0], "Fiddle · practice · X/8", "exhaustion tagged X/8");
}
console.log("ok — exhaustion: eight legal fiddles, never the answer, X/8");

// ---------- 10. give up -------------------------------------------------------

FIDDLE.practice("crane");
for (const ch of "cr") keydown(ch);
giveUpBtn.click();
{
  assert.equal(banner.textContent, "The word was CRANE", "give up reveals the word");
  assert.equal(rowTiles(0)[0].textContent, "", "the half-typed word cleared");
  assert.equal(countChip(0).textContent, "", "the counter cleared too");
  assert.ok(!shareBtn.classList.contains("hidden"), "share offered after give up");
  assert.equal(FIDDLE.dump().gaveUp, true, "gaveUp flag explicit");
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
    `Fiddle · ${FIDDLE.todayKey()} · gave up · 0/8`, "surrender tagged in the share");
}
console.log("ok — give up: clears the half-typed row, saves, shares gave up · N/8");

// ---------- 11. corrupt saves: the chain itself is validated -----------------

const good = { date: FIDDLE.todayKey(), answer: "crane", guesses: [],
  done: false, won: false, gaveUp: false };
for (const bad of [
  { ...good, answer: "qqqqq" },                            // not a word
  { ...good, answer: 42 },                                 // not a string
  { date: FIDDLE.todayKey(), guesses: [] },                // no answer
  { ...good, guesses: "crane" },                           // not an array
  { ...good, guesses: ["qqqqq"] },                         // non-word guess
  { ...good, guesses: ["crane", "hoist"] },                // chain broken: 0 shared
  { ...good, guesses: ["range", "cramp"] },                // chain short: 2 shared
  { ...good, guesses: Array(ROWS + 1).fill("crane") },     // nine guesses
]) {
  globalThis.localStorage.setItem("fiddle-day17", JSON.stringify(bad));
  dailyGame();
  const s = readSave();
  assert.equal(s.answer, FIDDLE.answerFor(FIDDLE.todayKey()),
    `corrupt save ${JSON.stringify(bad).slice(0, 40)}… replaced by a fresh daily`);
  assert.deepEqual(s.guesses, [], "corrupt save's guesses discarded");
}
// and the same shapes pass when the chain is legal
for (const okGuesses of [["crane"], ["range", "grade"], Array(ROWS).fill("cramp")]) {
  globalThis.localStorage.setItem("fiddle-day17", JSON.stringify(
    { ...good, guesses: okGuesses }));
  dailyGame();
  assert.deepEqual(readSave().guesses, okGuesses, `legal chain kept: ${okGuesses.length} guesses`);
}
console.log("ok — corrupt saves: broken chains, non-words and ninth guesses fall back fresh");

// ---------- 12. practice: isolation, forced words, dump ----------------------

const saveBeforePractice = globalThis.localStorage.getItem("fiddle-day17");
const craneIdx = ANSWERS.indexOf("crane");
Math.random = () => (craneIdx + 0.5) / ANSWERS.length;

FIDDLE.practice();
assert.equal(banner.textContent, "Practice round", "practice banner shown");
assert.equal(newBtn.textContent, "Today\u2019s puzzle", "button offers the way back");
assert.equal(FIDDLE.dump().answer, ANSWERS[craneIdx], "random word honors the Math.random stub");

FIDDLE.practice("qqqqq");
assert.ok(DICT.has(FIDDLE.dump().answer), "invalid forced word rejected");

const d = FIDDLE.dump();
for (const field of ["answer", "guesses", "typed", "prev", "shared",
  "practice", "done", "won", "gaveUp", "save"]) {
  assert.ok(field in d, `dump exposes ${field}`);
}
assert.equal(globalThis.localStorage.getItem("fiddle-day17"), saveBeforePractice,
  "practice never touches the daily save");

newBtn.click();
assert.equal(newBtn.textContent, "Practice", "button back to Practice");
assert.equal(banner.textContent, OPEN_BANNER, "fresh daily re-announced");
console.log("ok — practice: forced words, dump, no daily writes");

// ---------- 13. solvability sweep: the opener is always free ----------------

let swept = 0;
for (let i = 0; i < 40; i++) {
  const key = `2027-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`;
  seedDaily(FIDDLE.answerFor(key));
  const a = FIDDLE.dump().answer;
  typeRow(a); // the first guess is free — the answer itself is always legal
  assert.ok(readSave().won, `${key}: opening with the answer wins`);
  swept++;
}
console.log(`ok — solvability sweep: ${swept} sampled dailies all won by the free opener`);

console.log("\nAll fiddle tests passed.");
