// Headless tests for js/bubble.js. Loads the real game script against a
// minimal DOM stub and drives full games through the keyboard handler.
// Run: node tests/bubble.test.js
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
["board", "keyboard", "banner", "toast", "new-btn", "giveup-btn", "share-btn"].forEach((id) => {
  byId[id] = makeEl("div");
});
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
const GAME_URL = "https://suitangi.github.io/30Wordles/days/7";

require(path.join(__dirname, "..", "js", "bubble.js"));
const BUBBLE = globalThis.BUBBLE;
assert.ok(BUBBLE, "bubble.js must expose window.BUBBLE");

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
const readSave = () => JSON.parse(globalThis.localStorage.getItem("bubble-day7"));

// A row's resolved shape: the grid items, each a solo bubble or a chain
// spanning `width` columns.
function rowItems(r) {
  return board.children[r].children.map((item) =>
    item.classList.contains("run")
      ? { kind: "run", width: item.children.length, el: item }
      : { kind: "solo", width: 1, el: item });
}
// The row's five bubble cells flattened back into column order.
function rowCells(r) {
  return rowItems(r).flatMap((item) =>
    item.kind === "run" ? [...item.el.children] : [item.el]);
}

// ---------- independent spec of the mechanic ----------

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

// Type a word and submit it, playing out the whole reveal.
function typeRow(word) {
  for (const ch of word) keydown(ch);
  keydown("Enter");
  runTimers();
}

function dailyGame() {
  BUBBLE.daily();
}

// Force today's daily puzzle to an answer (optionally with guesses played).
function seedDaily(answer, guesses = [], extra = {}) {
  globalThis.localStorage.setItem("bubble-day7", JSON.stringify({
    date: BUBBLE.todayKey(), answer, guesses, done: false, won: false, gaveUp: false, ...extra,
  }));
  dailyGame();
}

const G = (word, marks) => ({ w: word, m: marks });
const ev = evalWord;
const M = (marksStr) => marksStr.split("").map((ch) => ({ K: "correct", P: "present", A: "absent" }[ch]));
const HELD = "\uD83E\uDEE7"; // 🫧 — held letters share as bubbles
const POP_SQ = "\u2B1C";     // light theme's popped square

// ---------- 1. word list sanity ----------

assert.equal(ANSWERS.length, 2315, "answers count");
assert.equal(DICT.size, 14855, "guessable count");
for (const w of ANSWERS) {
  assert.match(w, /^[a-z]{5}$/, `answer "${w}" shape`);
  assert.ok(DICT.has(w), `answer "${w}" must be guessable`);
}
for (const w of ["crane", "rains", "plane", "crank", "yeast", "devil", "lived"]) {
  assert.ok(DICT.has(w), `test word "${w}" is guessable`);
}
console.log("ok — word lists (2315 answers, 14855 guessable, test words present)");

// ---------- 2. evaluate: standard Wordle two-pass, duplicates included ----

assert.deepEqual(BUBBLE.evaluate("crane", "crane"), M("KKKKK"), "exact match");
assert.deepEqual(BUBBLE.evaluate("crane", "brane"), M("AKKKK"), "one letter off");
assert.deepEqual(BUBBLE.evaluate("speed", "abode"), M("AAPAP"),
  "duplicate guess letters consume target letters once each");
assert.deepEqual(BUBBLE.evaluate("eerie", "erase"), M("KAPAK"),
  "repeated letters: greens first, strays consume target copies in order");
console.log("ok — evaluate: two-pass, duplicates handled");

// ---------- 3. bubbles: the connect rule ------------------------------------
// Neighbours in the guess connect when their letters live in neighbouring
// spots of the answer — IN EITHER ORDER.

const bub = (guess, target) => BUBBLE.bubbles(guess, target);

assert.deepEqual(bub("crane", "crane"), [[0, 1, 2, 3, 4]],
  "the exact answer is one full-width chain");
assert.deepEqual(bub("plane", "crane"), [[0], [1], [2, 3, 4]],
  "ANE holds together — a three-long chain");
assert.deepEqual(bub("rains", "crane"), [[0, 1], [2], [3], [4]],
  "RA connects: R and A are neighbours in CRANE too");
assert.deepEqual(bub("crank", "crane"), [[0, 1, 2, 3], [4]],
  "four-long chain");
{
  // suitangi's report, verbatim: vs DIRTY, drift's R (answer pos 2) and I
  // (answer pos 1) are neighbours with the guess order REVERSED — they
  // must still connect. (The old left-to-right rule refused exactly this.)
  assert.deepEqual(bub("drift", "dirty"), [[0], [1, 2], [3], [4]],
    "drift vs dirty: RI connects regardless of order");
  // The word backwards: every letter is in devil, positions running the
  // wrong way — now one full-width chain (and still NOT a win; only the
  // exact answer wins).
  assert.deepEqual(ev("lived", "devil"), M("PPKPP"), "lived vs devil: all letters present");
  assert.deepEqual(bub("lived", "devil"), [[0, 1, 2, 3, 4]],
    "the word backwards is one full-width chain");
  // Still assignment-driven, not raw substrings: erase's E is pinned at
  // eerie position 0, and its R lives at 2 — not neighbours of that E.
  assert.deepEqual(bub("erase", "eerie"), [[0], [1], [2], [3], [4]],
    "greens pin positions: connecting follows YOUR letters' homes");
}
console.log("ok — bubbles: unordered adjacency, reverse connects whole, drift/dirty case");

// ---------- 3b. fuzz: the bubble invariants ----------------------------------

let fuzzSeeded = 12345;
const rnd = () => (fuzzSeeded = (fuzzSeeded * 1103515245 + 12345) % 2147483648) / 2147483648;
for (let t = 0; t < 400; t++) {
  const target = ANSWERS[Math.floor(rnd() * ANSWERS.length)];
  const guess = WORD_LISTS.guesses[Math.floor(rnd() * WORD_LISTS.guesses.length)];
  const marks = BUBBLE.evaluate(guess, target);
  const pos = BUBBLE.assign(guess, target, marks);
  const groups = BUBBLE.bubbles(guess, target);
  let next = 0;
  for (const g of groups) {
    assert.equal(g[0], next, "groups partition the row in order");
    next = g[g.length - 1] + 1;
    if (g.length > 1) {
      for (let c = 0; c < g.length - 1; c++) {
        assert.ok(![marks[g[c]], marks[g[c + 1]]].includes("absent"),
          "greys never connect");
        assert.equal(Math.abs(pos[g[c + 1]] - pos[g[c]]), 1,
          "connected neighbours live one apart in the answer, either order");
      }
      const lo = Math.min(...g.map((c) => pos[c]));
      const hi = Math.max(...g.map((c) => pos[c]));
      const want = target.slice(lo, hi + 1).split("").sort().join("");
      const got = g.map((c) => guess[c]).sort().join("");
      assert.equal(got, want, "a chain is the answer's stretch, any order");
    }
  }
  assert.equal(next, 5, "groups cover all five columns");
  if (groups.length === 1) {
    const rev = target.split("").reverse().join("");
    assert.ok(guess === target || guess === rev,
      "only the answer (or its reversal) fills a single chain");
  }
}
console.log("ok — fuzz (400 pairs): connected neighbours adjacent either order; 5-wide = answer or reverse");

// ---------- 4. daily word: date-derived, salted away from days 1-6 ---------

function saltHash(s) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}
const salted = (salt, key) => ANSWERS[saltHash(salt + key) % ANSWERS.length];

let diff = 0;
for (let i = 0; i < 200; i++) {
  const key = `2026-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`;
  const a = BUBBLE.answerFor(key);
  assert.equal(a, BUBBLE.answerFor(key), "answerFor is deterministic");
  assert.ok(DICT.has(a), "answer is guessable");
  const others = [
    ANSWERS[saltHash(key) % ANSWERS.length], // Bundle hashes the bare key
    salted("subtle", key), salted("wobble", key), salted("toggle", key),
    salted("meddle", key), salted("crumble", key),
  ];
  if (others.every((w) => w !== a)) diff++;
}
assert.ok(diff > 190, `answer avoids days 1-6's words (${diff}/200 dates)`);
console.log(`ok — daily word: deterministic, salt-differ from days 1-6 (${diff}/200)`);

// ---------- 5. fresh daily: six rows of empty shells, save seeded ----------

store.clear();
dailyGame();

const freshAnswer = BUBBLE.answerFor(BUBBLE.todayKey());
assert.equal(board.children.length, 6, "six rows");
for (let r = 0; r < 6; r++) {
  const items = rowItems(r);
  assert.equal(items.length, 5, `row ${r} starts as five solos`);
  for (const item of items) {
    assert.equal(item.kind, "solo", `row ${r}: solo shells only`);
    assert.ok(item.el.classList.contains("tile"), "cells are tiles");
    assert.equal(item.el.textContent, "", "cells start empty");
  }
}
assert.ok(!giveUpBtn.classList.contains("hidden"), "give up offered on a fresh board");
assert.ok(shareBtn.classList.contains("hidden"), "no share before an end state");
assert.equal(banner.textContent, "", "no banner before an end state");

const freshSave = readSave();
assert.equal(freshSave.date, BUBBLE.todayKey(), "save stamped with today");
assert.equal(freshSave.answer, freshAnswer, "daily answer is date-derived");
assert.deepEqual(freshSave.guesses, [], "no guesses yet");
console.log(`ok — fresh daily: ${freshSave.date}, answer ${freshAnswer} — six rows of empty shells`);

// ---------- 6. validation ----------

keydown("c"); keydown("r"); keydown("a"); keydown("t");
keydown("Enter");
runTimers();
assert.equal(toast.textContent, "Not enough letters");
assert.ok(rowCells(0)[0].classList.contains("shake"), "the row shakes on invalid submit");
assert.equal(board.children.length, 6, "still six rows");

const BAD = ["qqqqq", "jjjjj", "vvvvv"].find((w) => !DICT.has(w));
assert.ok(BAD, "need an invalid 5-letter test word");
"crat".split("").forEach(() => keydown("Backspace"));
BAD.split("").forEach(keydown);
keydown("Enter");
runTimers();
assert.equal(toast.textContent, "Not in word list");
for (let c = 0; c < 5; c++) assert.equal(rowCells(0)[c].textContent, BAD[c], "row keeps the word for fixing");
console.log(`ok — validation rejects short words and "${BAD}"`);

// ---------- 7. the reveal: greys pop, survivors hold, neighbours connect ---

BUBBLE.practice("crane");
assert.equal(banner.textContent, "Practice round", "practice banner shown");
const saveBeforeReveal = globalThis.localStorage.getItem("bubble-day7");

// rains vs crane: RA connects (one chain), i pops, n holds alone, s pops.
typeRow("rains");
{
  const items = rowItems(0);
  assert.deepEqual(items.map((i) => [i.kind, i.width]),
    [["run", 2], ["solo", 1], ["solo", 1], ["solo", 1]],
    "rains resolves into a chain and three solos");
  const cells = rowCells(0);
  assert.deepEqual(cells.map((c) => c.textContent), ["r", "a", "i", "n", "s"],
    "letters stay in their columns");
  assert.ok(items[0].el.classList.contains("on"), "the chain is connected");
  assert.ok(cells[0].classList.contains("wr") && !cells[0].classList.contains("wl"),
    "the chain's first bubble clips flat on its right");
  assert.ok(cells[1].classList.contains("wl") && !cells[1].classList.contains("wr"),
    "the chain's second bubble clips flat on its left");
  assert.ok(cells[0].classList.contains("held"), "r held");
  assert.ok(cells[1].classList.contains("held"), "a held");
  assert.ok(cells[2].classList.contains("popped"), "i popped");
  assert.ok(cells[2].classList.contains("pop"), "i plays the pop");
  assert.ok(cells[3].classList.contains("held"), "n held");
  assert.ok(cells[4].classList.contains("popped"), "s popped");
  assert.ok(!cells[0].classList.contains("filled"), "the fate replaces the filled state");
}
assert.ok(keyFor("i").classList.contains("absent"), "keyboard dims a popped letter");
assert.ok(keyFor("n").classList.contains("kept"), "keyboard keeps an in-word letter");
assert.equal(globalThis.localStorage.getItem("bubble-day7"), saveBeforeReveal,
  "practice never saves");

// plane vs crane: p and l pop, ANE connects into a held three-chain.
typeRow("plane");
{
  const items = rowItems(1);
  assert.deepEqual(items.map((i) => [i.kind, i.width]),
    [["solo", 1], ["solo", 1], ["run", 3]],
    "plane resolves into two popped slots and an ANE chain");
  for (const c of rowCells(1).slice(2)) assert.ok(c.classList.contains("held"), "ANE all held");
}
console.log("ok — the reveal: greys pop, survivors hold, neighbours connect");

// ---------- 8. the win: the word blown into a single chain ------------------

BUBBLE.practice("crane");
const saveBeforeWin = globalThis.localStorage.getItem("bubble-day7");
typeRow("crane");
{
  const items = rowItems(0);
  assert.deepEqual(items.map((i) => [i.kind, i.width]), [["run", 5]],
    "the answer is one full-width chain");
  const run = items[0].el;
  assert.ok(run.classList.contains("on"), "chain connected");
  assert.ok(run.classList.contains("win"), "the win glows");
  const five = rowCells(0);
  assert.ok(five[0].classList.contains("wr") && five[4].classList.contains("wl"),
    "the chain's ends clip flat outward");
  assert.ok(five[2].classList.contains("wr") && five[2].classList.contains("wl"),
    "the chain's middle bubble is flat on both sides");
  for (const c of rowCells(0)) assert.ok(c.classList.contains("held"), "all held");
}
assert.equal(banner.textContent, "Genius \u2014 1 guess", "win praised");
assert.ok(!shareBtn.classList.contains("hidden"), "share appears on the win");
assert.ok(giveUpBtn.classList.contains("hidden"), "give up retires on the win");
assert.equal(globalThis.localStorage.getItem("bubble-day7"), saveBeforeWin,
  "practice still never saves");

// A four-chain near-miss is not a win — play continues.
BUBBLE.practice("crane");
typeRow("crank");
assert.equal(banner.textContent, "Practice round", "no false win on a four-chain");
assert.ok(shareBtn.classList.contains("hidden"), "share stays hidden");
console.log("ok — the win: one full-width chain, praised; near-misses keep playing");

// ---------- 9. share format --------------------------------------------------

BUBBLE.practice("crane");
typeRow("rains");
typeRow("plane");
typeRow("crane");
shareBtn.click();
const ta = createdEls.filter((e) => e.tagName === "textarea").pop();
assert.ok(ta, "share staged a clipboard textarea");
const lines = ta.value.split("\n");
assert.equal(lines[0], "Bubble · practice · 3/6", "practice share header");
assert.equal(lines[1], GAME_URL, "share links to the game");
assert.equal(lines[2], HELD + HELD + POP_SQ + HELD + POP_SQ,
  "rains shares bubbles for held letters, empty squares for popped ones");
assert.equal(lines[3], POP_SQ + POP_SQ + HELD + HELD + HELD,
  "plane shares its shape");
assert.equal(lines[4], HELD.repeat(5), "the win row is five bubbles");
keydown("a");
assert.equal(BUBBLE.dump().rows.length, 3, "no typing after the win");
console.log("ok — share: name · practice/date · score, URL, one squares row per guess");

// ---------- 10. refresh mid-game: rows rebuild connected and quiet ----------

seedDaily("crane", [
  G("rains", ev("rains", "crane")),
  G("plane", ev("plane", "crane")),
]);
dailyGame(); // simulated refresh
{
  const items0 = rowItems(0);
  assert.deepEqual(items0.map((i) => [i.kind, i.width]),
    [["run", 2], ["solo", 1], ["solo", 1], ["solo", 1]],
    "rains restored in its resolved shape");
  assert.ok(items0[0].el.classList.contains("on"), "chain restored already connected");
  assert.ok(board.children[0].classList.contains("quiet"), "restored rows are quiet");
  assert.ok(rowCells(0)[2].classList.contains("popped"), "popped letters stay marked");
  const items1 = rowItems(1);
  assert.deepEqual(items1.map((i) => [i.kind, i.width]),
    [["solo", 1], ["solo", 1], ["run", 3]], "plane restored as solo-solo-chain");
}
assert.ok(keyFor("i").classList.contains("absent"), "keyboard colors restored");
assert.equal(banner.textContent, "", "still quiet mid-game");
assert.ok(rowCells(2).every((c) => c.textContent === ""), "the pending row waits empty");

typeRow("crane");
assert.equal(banner.textContent, "Impressive \u2014 3 guesses", "play continues after a refresh and wins");
console.log("ok — refresh mid-game: rows rebuild connected and quiet, play continues");

// ---------- 11. refresh after finishing --------------------------------------

dailyGame(); // refresh the just-won daily
assert.equal(BUBBLE.dump().rows.length, 3, "finished board restored with all three rows");
assert.equal(banner.textContent, "Impressive \u2014 3 guesses", "won banner restored");
assert.ok(!shareBtn.classList.contains("hidden"), "share offered again");
assert.ok(giveUpBtn.classList.contains("hidden"), "give up stays retired");
{
  const run = rowItems(2).find((i) => i.kind === "run");
  assert.ok(run && run.width === 5, "the win restored as a full chain");
  assert.ok(run.el.classList.contains("win"), "the win glow restored");
}
keydown("a");
assert.equal(BUBBLE.dump().rows.length, 3, "restored won board is locked");
console.log("ok — refresh after finishing: banner, share, glow and lock all restored");

// ---------- 12. give up: the loss path and restore ----------------------------

seedDaily("crane");
typeRow("hoist");
giveUpBtn.click();
assert.equal(banner.textContent, "The word was CRANE", "give up reveals the word");
assert.ok(giveUpBtn.classList.contains("hidden"), "give up retires after use");
assert.ok(!shareBtn.classList.contains("hidden"), "share offered after give up");
const gaveUp = readSave();
assert.equal(gaveUp.done, true, "give up saved done");
assert.equal(gaveUp.won, false, "give up saved not won");
assert.equal(gaveUp.gaveUp, true, "gaveUp flag explicit");
keydown("a");
assert.equal(BUBBLE.dump().rows.length, 1, "board locked after give up");

shareBtn.click();
const gta = createdEls.filter((e) => e.tagName === "textarea").pop();
assert.match(gta.value.split("\n")[0],
  /^Bubble · \d{4}-\d{2}-\d{2} · gave up · X\/6$/,
  "give-up share tags the surrender");

dailyGame(); // refresh
assert.equal(BUBBLE.dump().rows.length, 1, "given-up board restored");
assert.equal(banner.textContent, "The word was CRANE", "loss banner restored");
assert.ok(giveUpBtn.classList.contains("hidden"), "give up stays retired");
console.log("ok — give up: reveals the word, saves the loss, restores locked");

// ---------- 13. the sixth miss: exhaustion is the loss ------------------------

seedDaily("crane");
const LOSERS = ["hoist", "tonic", "basic", "penny", "gizmo", "squat"];
for (const w of LOSERS) typeRow(w);
assert.equal(banner.textContent, "The word was CRANE", "six misses end the game");
assert.ok(!shareBtn.classList.contains("hidden"), "share offered on the loss");
assert.ok(giveUpBtn.classList.contains("hidden"), "give up retired");
const lossSave = readSave();
assert.equal(lossSave.done, true, "loss saved done");
assert.equal(lossSave.won, false, "loss saved not won");
assert.equal(lossSave.guesses.length, 6, "six guesses saved");
keydown("a");
assert.equal(BUBBLE.dump().rows.length, 6, "board locked after the loss");

shareBtn.click();
const lta = createdEls.filter((e) => e.tagName === "textarea").pop();
assert.equal(lta.value.split("\n")[0], `Bubble · ${BUBBLE.todayKey()} · X/6`, "loss share reads X/6");

dailyGame();
assert.equal(BUBBLE.dump().rows.length, 6, "lost board restored");
assert.equal(banner.textContent, "The word was CRANE", "loss banner restored");
console.log("ok — exhaustion: the sixth miss loses, shares X/6, restores locked");

// ---------- 14. next day: fresh puzzle; corrupt saves fall back ---------------

let s = readSave();
s.date = "1999-12-31";
globalThis.localStorage.setItem("bubble-day7", JSON.stringify(s));
dailyGame();

s = readSave();
assert.notEqual(s.date, "1999-12-31", "stale save replaced");
assert.equal(s.date, BUBBLE.todayKey(), "re-stamped with today");
assert.equal(s.answer, BUBBLE.answerFor(BUBBLE.todayKey()), "new day, new daily word");
assert.deepEqual(s.guesses, [], "guesses reset");
assert.equal(board.children.length, 6, "fresh six rows");

for (const bad of [
  { date: BUBBLE.todayKey(), answer: "qqqqq", guesses: [] },  // not a word
  { date: BUBBLE.todayKey(), answer: 42, guesses: [] },       // not a string
  { date: BUBBLE.todayKey(), guesses: [] },                   // no answer
]) {
  globalThis.localStorage.setItem("bubble-day7", JSON.stringify(bad));
  dailyGame();
  s = readSave();
  assert.equal(s.answer, BUBBLE.answerFor(BUBBLE.todayKey()),
    `invalid answer ${JSON.stringify(bad.answer)} replaced by the daily word`);
}
console.log("ok — next day + corrupt saves: stale/fake answers fall back fresh");

// ---------- 15. practice: forced word, random word, daily save untouched ------

const saveBeforePractice = globalThis.localStorage.getItem("bubble-day7");
const craneIdx = ANSWERS.indexOf("crane");
Math.random = () => (craneIdx + 0.5) / ANSWERS.length;

BUBBLE.practice();
assert.equal(banner.textContent, "Practice round", "practice banner shown");
assert.equal(newBtn.textContent, "Today\u2019s puzzle", "button offers the way back");
assert.equal(board.children.length, 6, "practice board fresh");
assert.equal(BUBBLE.dump().answer, ANSWERS[craneIdx], "random word honors the Math.random stub");

const d = BUBBLE.dump();
assert.ok(Array.isArray(d.rows), "dump exposes the resolved rows");
assert.ok("save" in d, "dump carries the raw save");

BUBBLE.practice("crane"); // forced word, the debugging backdoor
assert.equal(BUBBLE.dump().answer, "crane", "forced practice word honored");
BUBBLE.practice("qqqqq"); // invalid: falls back to random, still a word
assert.ok(DICT.has(BUBBLE.dump().answer), "invalid forced word rejected");

assert.equal(globalThis.localStorage.getItem("bubble-day7"), saveBeforePractice,
  "practice never touches the daily save");

newBtn.click(); // back to today's puzzle
assert.equal(newBtn.textContent, "Practice", "button back to Practice");
assert.equal(board.children[0].children.length, 5, "daily board fresh again");
assert.ok(!giveUpBtn.classList.contains("hidden"), "give up back for the fresh daily");
console.log("ok — practice: forced + random words, no save writes, dump, round-trips to daily");

// ---------- 16. solvability sweep: every sampled daily is one type away -------

let swept = 0;
for (let i = 0; i < 60; i++) {
  const key = `2027-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`;
  seedDaily(BUBBLE.answerFor(key));
  typeRow(BUBBLE.dump().answer);
  assert.ok(readSave().won, `${key}: typing the answer wins`);
  swept++;
}
console.log(`ok — solvability sweep: ${swept} sampled dailies all winnable`);

console.log("\nAll bubble tests passed.");
