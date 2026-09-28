// Headless tests for js/muddle.js. Loads the real game script against a
// minimal DOM stub and drives full games through the keyboard handler.
// Run: node tests/muddle.test.js
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
    clientWidth: 800,
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
["board", "keyboard", "banner", "toast",
  "new-btn", "giveup-btn", "share-btn"].forEach((id) => {
  byId[id] = makeEl("div");
});

globalThis.window = globalThis;
const windowHandlers = {};
globalThis.addEventListener = (t, fn) => { (windowHandlers[t] ||= []).push(fn); };
globalThis.document = {
  documentElement: { dataset: {}, clientWidth: 1200 },
  body: makeEl("body"),
  getElementById: (id) => byId[id],
  createElement: (tag) => makeEl(tag),
  execCommand: () => true,
};

// ---------- load real game code ----------

require(path.join(__dirname, "..", "js", "words.js"));
const { WORD_LISTS } = globalThis.window;
assert.ok(WORD_LISTS, "words.js must define window.WORD_LISTS");
const ANSWERS = WORD_LISTS.answers;
const DICT = new Set(WORD_LISTS.guesses);
const GAME_URL = "https://suitangi.github.io/30Wordles/days/15";

require(path.join(__dirname, "..", "js", "muddle.js"));
const MUDDLE = globalThis.MUDDLE;
assert.ok(MUDDLE, "muddle.js must expose window.MUDDLE");

const board = byId.board;
const banner = byId.banner;
const toast = byId.toast;
const newBtn = byId["new-btn"];
const giveUpBtn = byId["giveup-btn"];
const shareBtn = byId["share-btn"];
const keydown = (key) =>
  (windowHandlers.keydown || []).forEach((fn) =>
    fn({ key, metaKey: false, ctrlKey: false, altKey: false }));

// ---------- board accessors ----------
// Row r, tile c -> MUDDLE.tile(r, c). Each hex is .hex > .hex-in > span:
// the letter riding the span, the mark class on .hex-in.

const tileEl = (r, c) => MUDDLE.tile(r, c);
const tileCount = (r) => (r % 2 === 0 ? 5 : 4);
const glyph = (r, c) => tileEl(r, c).children[0].children[0].textContent;
const markOf = (r, c) =>
  ["correct", "present", "absent"].find((m) => tileEl(r, c).children[0].classList.contains(m)) || null;

const keyFor = (letter) => {
  for (const row of byId.keyboard.children) {
    const k = row.children.find((b) => b.textContent === letter);
    if (k) return k;
  }
  return null;
};
const keyMark = (letter) =>
  ["correct", "present", "absent"].find((m) => keyFor(letter).classList.contains(m)) || null;
const readSave = () => JSON.parse(globalThis.localStorage.getItem("muddle-day15"));

// ---------- helpers ----------

function evalWord(guess, target) {
  const marks = Array(5).fill("absent");
  const remaining = {};
  for (let i = 0; i < 5; i++) {
    if (guess[i] === target[i]) marks[i] = "correct";
    else remaining[target[i]] = (remaining[target[i]] || 0) + 1;
  }
  for (let j = 0; j < 5; j++) {
    if (marks[j] !== "correct" && remaining[guess[j]] > 0) {
      marks[j] = "present";
      remaining[guess[j]]--;
    }
  }
  return marks;
}

// The muddle spec: tile j of a 4-guess covers answer columns j and j+1.
function evalMuddled(guess, target) {
  return [0, 1, 2, 3].map((j) => {
    if (guess[j] === target[j] || guess[j] === target[j + 1]) return "correct";
    if (target.includes(guess[j])) return "present";
    return "absent";
  });
}

function typeWord(word) {
  for (const ch of word) keydown(ch);
  keydown("Enter");
  runTimers();
}

function practiceGame(answer) {
  MUDDLE.practice(answer);
}

function seedDaily(guesses, flags = {}) {
  globalThis.localStorage.setItem("muddle-day15", JSON.stringify({
    date: MUDDLE.todayKey(),
    answer: flags.answer || MUDDLE.answerFor(MUDDLE.todayKey()),
    guesses,
    done: !!flags.done,
    won: !!flags.won,
    gaveUp: !!flags.gaveUp,
  }));
  MUDDLE.daily();
}

// Assert row r shows `word` with the right marks for its row type.
function assertRow(r, word, msg) {
  const marks = r % 2 === 0 ? evalWord(word, MUDDLE.dump().answer)
    : evalMuddled(word, MUDDLE.dump().answer);
  for (let c = 0; c < word.length; c++) {
    assert.equal(glyph(r, c), word[c], `row ${r} tile ${c} letter ${msg || ""}`);
    assert.equal(markOf(r, c), marks[c], `row ${r} tile ${c} mark ${msg || ""}`);
  }
}

// ---------- 1. word list sanity ----------

assert.equal(ANSWERS.length, 2315, "answers count");
assert.equal(DICT.size, 14855, "guessable count");

// ---------- 2. daily answer: deterministic, in dictionary ----------

assert.ok(DICT.has(MUDDLE.answerFor("2026-09-27")), "daily answer in dict");
assert.equal(MUDDLE.answerFor("2026-09-27"), MUDDLE.answerFor("2026-09-27"),
  "daily answer deterministic");

// ---------- 3. fresh board structure: 7 staggered rows, 5/4/5/4/5/4/5 ----------

practiceGame("crane");
assert.equal(board.children.length, 7, "seven rows");
for (let r = 0; r < 7; r++) {
  assert.ok(tileEl(r, 0), `row ${r} exists`);
  for (let c = 0; c < tileCount(r); c++) {
    assert.ok(tileEl(r, c), `tile(${r},${c}) exists`);
    assert.equal(glyph(r, c), "", `tile(${r},${c}) empty`);
    assert.equal(markOf(r, c), null, `tile(${r},${c}) unmarked`);
  }
  if (r % 2 === 0) assert.ok(tileEl(r, 5) === null, `wide row ${r} has exactly 5`);
  else assert.ok(tileEl(r, 4) === null, `narrow row ${r} has exactly 4`);
}
let totalTiles = 0;
for (let r = 0; r < 7; r++) totalTiles += tileCount(r);
assert.equal(totalTiles, 32, "32 hexes on the board");

// ---------- 4. wide rows score like normal Wordle ----------

practiceGame("crane");
typeWord("rains"); // r present, a present, i absent, n CORRECT (index 3), s absent
assertRow(0, "rains", "rains vs crane");
assert.equal(markOf(0, 3), "correct", "rains n green at index 3 (the rains gotcha)");

// ---------- 5. narrow rows score the MUDDLE ----------

practiceGame("crane");
typeWord("blast"); // wide opener
typeWord("rave"); // r covers c,r -> green; a covers a,n -> green;
                  // v covers n,e -> absent; e covers n,e -> green
assertRow(1, "rave", "rave muddled");
// yellow path: letter in the answer but in neither neighbouring column
typeWord("sword"); // wide filler
typeWord("soap"); // s covers c,r absent; o covers r,a absent;
                  // a covers a,n green; p covers n,e absent
assertRow(3, "soap", "soap muddled");
// partial yellow: letters in the answer but outside their own pair
typeWord("ghost"); // wide filler
typeWord("near"); // n covers c,r -> in word (idx3) yellow; e covers r,a -> idx4 yellow;
                  // a covers a,n -> GREEN (it does sit between them);
                  // r covers n,e -> idx1 yellow
assertRow(5, "near", "near through the muddle");
assert.deepEqual(evalMuddled("near", "crane"), ["present", "present", "correct", "present"],
  "spec check");
assert.equal(MUDDLE.dump().done, false, "all-green narrow row does not win");

// ---------- 6. alternation: row length gates typing and dictionary ----------

practiceGame("crane");
// typing on a wide row stops at 5; extra letters fall silent
for (const ch of "cramps") keydown(ch);
assert.equal(glyph(0, 4), "p", "wide row holds 5");
keydown("Enter");
runTimers();
assert.equal(MUDDLE.dump().guesses.length, 1, "cramp accepted on the wide row");

// a five-letter word can't go on a narrow row: the 5th letter is ignored,
// and "cran" is not in the four-letter list
typeWord("crane");
assert.equal(MUDDLE.dump().guesses.length, 1, "narrow row rejected the wide word");
assert.ok(/four-letter/.test(toast.textContent), `toast: ${toast.textContent}`);
// rejected letters stay for editing — clear them
for (let b = 0; b < 4; b++) keydown("Backspace");

// a real four-letter word passes
typeWord("soak");
assert.equal(MUDDLE.dump().guesses.length, 2, "soak accepted on the narrow row");
assertRow(1, "soak", "soak on row 1");

// a four-letter word can't open the next wide row
typeWord("soak");
assert.equal(MUDDLE.dump().guesses.length, 2, "wide row rejected the narrow word");
assert.ok(/Not enough letters/.test(toast.textContent), `toast: ${toast.textContent}`);

// ---------- 7. win: the exact answer on a wide row ----------

practiceGame("crane");
typeWord("blast"); // wide row 0, wrong
typeWord("soak");  // narrow row 1, muddled
typeWord("crane"); // wide row 2 — the exact answer
let d = MUDDLE.dump();
assert.equal(d.done, true, "won");
assert.equal(d.won, true, "won flag");
assert.equal(d.guesses.length, 3, "three guesses");
for (let c = 0; c < 5; c++) assert.equal(markOf(2, c), "correct", `win green ${c}`);
assert.ok(tileEl(2, 0).classList.contains("win-glow"), "win row glows");
assert.ok(/in 3/.test(banner.textContent), `banner: ${banner.textContent}`);
assert.ok(!shareBtn.classList.contains("hidden"), "share offered");

// ---------- 8. loss paths ----------

// 8a. seven misses: the last row is wide, so the answer had its last shot
practiceGame("crane");
const seq = ["sword", "tram", "ghost", "soot", "build", "pact", "blast"];
for (let i = 0; i < seq.length; i++) {
  typeWord(seq[i]);
  if (i < seq.length - 1) {
    assert.equal(MUDDLE.dump().done, false, `${seq[i]}: still playing`);
  }
}
d = MUDDLE.dump();
assert.equal(d.done, true, "seven misses end it");
assert.equal(d.won, false, "lost");
assert.equal(d.guesses.length, 7, "seven guesses spent");
assert.ok(/The word was CRANE/.test(banner.textContent), `banner: ${banner.textContent}`);

// 8b. give up
practiceGame("crane");
giveUpBtn.click();
const g = MUDDLE.dump();
assert.equal(g.done, true, "give up ends");
assert.equal(g.won, false, "give up loses");
assert.equal(g.gaveUp, true, "gaveUp flag");
assert.ok(/The word was CRANE/.test(banner.textContent), `banner: ${banner.textContent}`);

// ---------- 9. keyboard paints the best mark across both row types ----------

practiceGame("crane");
typeWord("rains"); // wide: r present, a present, i absent, n green (idx 3), s absent
assert.equal(keyMark("c"), null, "keyboard c untouched");
assert.equal(keyMark("r"), "present", "keyboard r present");
assert.equal(keyMark("a"), "present", "keyboard a present");
typeWord("soak"); // narrow muddle: s absent, o absent, a GREEN (covers a,n), k absent
assert.equal(keyMark("a"), "correct", "keyboard a upgraded green via the muddle");
assert.equal(keyMark("r"), "present", "keyboard r unchanged (never downgrades)");
assert.equal(keyMark("m"), null, "keyboard m untouched");

// ---------- 10. restore: mid-game refresh ----------

const dailyAnswer = MUDDLE.answerFor(MUDDLE.todayKey());
seedDaily(["cramp", "soak"]);
let d2 = MUDDLE.dump();
assert.equal(d2.practice, false, "daily restore");
assert.equal(d2.answer, dailyAnswer, "daily answer");
assertRow(0, "cramp", "restored wide row");
assertRow(1, "soak", "restored narrow row");
assert.ok(/2 down/.test(banner.textContent), `banner: ${banner.textContent}`);

// play continues after restore: the next row is wide again
typeWord("rains");
assert.equal(MUDDLE.dump().guesses.length, 3, "third guess spent");

// ---------- 11. restore: after a win and after a give up ----------

seedDaily(["blast", "soak", dailyAnswer], { done: true, won: true });
d2 = MUDDLE.dump();
assert.equal(d2.done && d2.won, true, "won restore");
assert.ok(/in 3/.test(banner.textContent), `banner: ${banner.textContent}`);

seedDaily(["cramp"], { done: true, won: false, gaveUp: true });
d2 = MUDDLE.dump();
assert.equal(d2.gaveUp, true, "gave up restored");
assert.ok(/The word was/.test(banner.textContent), `banner: ${banner.textContent}`);

// ---------- 12. corrupt / stale saves fall back to a fresh daily ----------

// stale date
globalThis.localStorage.setItem("muddle-day15", JSON.stringify({
  date: "1999-01-01", answer: "crane", guesses: [], done: false, won: false,
}));
MUDDLE.daily();
assert.equal(MUDDLE.dump().guesses.length, 0, "stale date -> fresh");

// answer not in dictionary
globalThis.localStorage.setItem("muddle-day15", JSON.stringify({
  date: MUDDLE.todayKey(), answer: "zzzzz", guesses: [],
}));
MUDDLE.daily();
assert.equal(MUDDLE.dump().answer, dailyAnswer, "fake answer -> fresh daily");

// guess with the wrong length for its row (4 letters on wide row 0)
globalThis.localStorage.setItem("muddle-day15", JSON.stringify({
  date: MUDDLE.todayKey(), answer: dailyAnswer, guesses: ["rave"],
}));
MUDDLE.daily();
assert.equal(MUDDLE.dump().guesses.length, 0, "wrong-row-length guess rejected");

// five-letter guess on a narrow row
globalThis.localStorage.setItem("muddle-day15", JSON.stringify({
  date: MUDDLE.todayKey(), answer: dailyAnswer, guesses: ["crane", "crane"],
}));
MUDDLE.daily();
assert.equal(MUDDLE.dump().guesses.length, 0, "wide word on narrow row rejected");

// non-word narrow guess
globalThis.localStorage.setItem("muddle-day15", JSON.stringify({
  date: MUDDLE.todayKey(), answer: dailyAnswer, guesses: ["crane", "zzzz"],
}));
MUDDLE.daily();
assert.equal(MUDDLE.dump().guesses.length, 0, "fake narrow word rejected");

// too many guesses
const eight = [];
for (let i = 0; i < 8; i++) eight.push(i % 2 === 0 ? "crane" : "cram");
globalThis.localStorage.setItem("muddle-day15", JSON.stringify({
  date: MUDDLE.todayKey(), answer: dailyAnswer, guesses: eight,
}));
MUDDLE.daily();
assert.equal(MUDDLE.dump().guesses.length, 0, "over-long save rejected");

// ---------- 13. practice isolation + forced answer ----------

MUDDLE.daily();
const prePractice = readSave();
practiceGame("crane");
typeWord("blast");
typeWord("rave");
typeWord("crane");
assert.deepEqual(readSave(), prePractice, "practice never touches the daily save");
assert.equal(MUDDLE.dump().answer, "crane", "forced practice answer");
MUDDLE.daily();
assert.equal(MUDDLE.dump().answer, dailyAnswer, "daily intact after practice");
newBtn.click(); // practice again, random answer this time
assert.equal(MUDDLE.dump().practice, true, "practice button works");
assert.ok(DICT.has(MUDDLE.dump().answer), "random practice answer in dict");

// ---------- 14. next-day reset ----------

practiceGame("crane");
seedDaily([]);
assert.equal(MUDDLE.dump().guesses.length, 0, "seeded fresh daily state");
assert.ok(MUDDLE.dump().save, "daily save written");

// ---------- 15. share text: guess rows, narrow rows padded left ----------

practiceGame("crane");
typeWord("blast");
typeWord("rave");
typeWord("crane");
shareBtn.click();
{
  const kids = globalThis.document.body.children;
  const st = kids[kids.length - 1].value;
  const lines = st.split("\n");
  assert.ok(lines[0].startsWith("Muddle · practice · 3/7"), `share header: ${lines[0]}`);
  assert.equal(lines[1], GAME_URL, "share url");
  assert.equal(lines.length, 5, "header, url, three guess rows");
  assert.equal(Array.from(lines[2]).length, 5, "wide row is 5 emoji");
  assert.equal(Array.from(lines[3]).length, 5, "narrow row padded to 5 with the inverse blank");
  assert.notEqual(lines[3][0], lines[2][0], "pad is the inverse of a mark square");
}

console.log("muddle.test.js — all sections passed");
