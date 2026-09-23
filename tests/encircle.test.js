// Headless tests for js/encircle.js. Loads the real game script against a
// minimal DOM stub and drives full games through the keyboard handler.
// Run: node tests/encircle.test.js
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
const GAME_URL = "https://suitangi.github.io/30Wordles/days/12";

require(path.join(__dirname, "..", "js", "encircle.js"));
const ENC = globalThis.ENCIRCLE;
assert.ok(ENC, "encircle.js must expose window.ENCIRCLE");

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
// An .erow is [west rot, five tiles, east rot] — tiles live at 1..5.
const rowTiles = (r) => board.children[r].children.slice(1, 6);
const rowArrows = (r) => [board.children[r].children[0], board.children[r].children[6]];
const readSave = () => JSON.parse(globalThis.localStorage.getItem("encircle-day12"));

// Type a word and submit it, playing out the whole reveal.
function typeRow(word) {
  for (const ch of word) keydown(ch);
  keydown("Enter");
  runTimers();
}

function dailyGame() {
  ENC.daily();
}

// Force today's daily puzzle to an answer (optionally with guesses played).
function seedDaily(answer, guesses = [], extra = {}) {
  globalThis.localStorage.setItem("encircle-day12", JSON.stringify({
    date: ENC.todayKey(), answer, start: 0, guesses, done: false, won: false, gaveUp: false, ...extra,
  }));
  dailyGame();
}

const ev = ENC.evaluate;
const disp = ENC.display;
const M = (marksStr) => marksStr.split("").map((ch) => ({ K: "correct", P: "present", A: "absent" }[ch]));
const K = "correct", P = "present", A = "absent";
const OPEN_BANNER = "Find the word \u2014 and where it starts";

// ---------- 1. word list sanity ----------

assert.equal(ANSWERS.length, 2315, "answers count");
assert.equal(DICT.size, 14855, "guessable count");
for (const w of ANSWERS) {
  assert.match(w, /^[a-z]{5}$/, `answer "${w}" shape`);
  assert.ok(DICT.has(w), `answer "${w}" must be guessable`);
}
for (const w of ["crane", "range", "hoist", "cramp", "modal", "snare"]) {
  assert.ok(DICT.has(w), `test word "${w}" is guessable`);
}
console.log("ok — word lists (2315 answers, 14855 guessable, test words present)");

// ---------- 2. the ring: display ---------------------------------------------
// Tile i shows word[(i - s) mod 5] — suitangi's example is the spec.

assert.equal(disp("modal", 2), "almod", "modal at start 2 reads almod");
assert.equal(disp("crane", 0), "crane", "start 0 is the plain word");
assert.equal(disp("crane", 1), "ecran", "start 1 swings the last letter to the front");
assert.equal(disp("crane", 4), "ranec", "start 4 swings the first letter to the end");
const rotations = [0, 1, 2, 3, 4].map((s) => disp("crane", s));
assert.equal(new Set(rotations).size, 5, "a word with five letters has five rotations");
for (const r of rotations) {
  assert.deepEqual(r.split("").sort(), "acrne".split("").sort(), "rotations keep the letters");
}
// Whatever the start, a matching rotation scores all green (duplicates too).
for (const s of [0, 1, 2, 3, 4]) {
  assert.deepEqual(ev(disp("eerie", s), disp("eerie", s)), M("KKKKK"),
    `eerie at start ${s} matches itself`);
}
console.log("ok — display: the ring wraps; modal@2 = almod; five rotations");

// ---------- 3. evaluate: standard Wordle two-pass on displayed sequences -----

assert.deepEqual(ev("crane", "crane"), M("KKKKK"), "exact match");
assert.deepEqual(ev("crane", "brane"), M("AKKKK"), "one letter off");
assert.deepEqual(ev("speed", "abode"), M("AAPAP"),
  "duplicate guess letters consume target letters once each");
assert.deepEqual(ev("eerie", "erase"), M("KAPAK"),
  "repeated letters: greens first, strays consume target copies in order");
console.log("ok — evaluate: two-pass, duplicates handled");

// ---------- 4. daily word + hidden start: date-derived, salted ---------------

function saltHash(s) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}
const salted = (salt, key) => ANSWERS[saltHash(salt + key) % ANSWERS.length];

let diff = 0;
for (let i = 0; i < 200; i++) {
  const key = `2026-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`;
  const a = ENC.answerFor(key);
  assert.equal(a, ENC.answerFor(key), "answerFor is deterministic");
  assert.ok(DICT.has(a), "answer is guessable");
  const s = ENC.startFor(key);
  assert.equal(s, ENC.startFor(key), "startFor is deterministic");
  assert.ok(Number.isInteger(s) && s >= 0 && s <= 4, "start is a tile index");
  const others = [
    ANSWERS[saltHash(key) % ANSWERS.length], // Bundle hashes the bare key
    salted("subtle", key), salted("wobble", key), salted("toggle", key),
    salted("meddle", key), salted("meddle-b", key), salted("crumble", key),
    salted("bubble", key), salted("swivel", key), salted("swivel-b", key),
    salted("stifle", key), salted("hustle", key), salted("castle", key),
  ];
  if (others.every((w) => w !== a)) diff++;
}
assert.ok(diff > 180, `answer avoids days 1-11's words (${diff}/200 dates)`);

// The hidden start visits every tile across a year of keys (no bias
// assertion beyond presence and a loose ceiling — the Toggle lesson).
const seen = new Map();
for (let i = 0; i < 400; i++) {
  const key = `2027-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`;
  const s = ENC.startFor(key);
  seen.set(s, (seen.get(s) || 0) + 1);
}
assert.equal(seen.size, 5, `all five starts occur (${[...seen.entries()].sort()})`);
assert.ok(Math.max(...seen.values()) <= 140,
  `starts are spread, not pinned (max ${Math.max(...seen.values())}/400)`);
console.log(`ok — daily word + hidden start: deterministic, salt-differ (${diff}/200), starts spread`,
  [...seen.entries()].sort().map(([s, n]) => `s${s}:${n}`).join(" "));

// ---------- 5. fresh daily: one waiting row with its ring controls -----------

store.clear();
dailyGame();

const freshAnswer = ENC.answerFor(ENC.todayKey());
const freshStart = ENC.startFor(ENC.todayKey());
assert.equal(board.children.length, 1, "one waiting row");
assert.equal(board.children[0].children.length, 7, "rot + five tiles + rot");
assert.equal(rowArrows(0)[0].tagName, "button", "west rot is a button");
assert.equal(rowArrows(0)[1].tagName, "button", "east rot is a button");
assert.deepEqual(rowTiles(0).map((t) => t.textContent), ["", "", "", "", ""],
  "the ring starts empty");
assert.ok(rowTiles(0)[0].classList.contains("s0"), "the highlighted tile marks the start");
assert.ok(board.children[0].classList.contains("on"), "the live row wears on");
assert.equal(banner.textContent, OPEN_BANNER, "the hunt is announced");
assert.ok(!giveUpBtn.classList.contains("hidden"), "give up offered on a fresh board");
assert.ok(shareBtn.classList.contains("hidden"), "no share before an end state");

const freshSave = readSave();
assert.equal(freshSave.date, ENC.todayKey(), "save stamped with today");
assert.equal(freshSave.answer, freshAnswer, "daily answer is date-derived");
assert.equal(freshSave.start, freshStart, "the answer's start is date-derived");
assert.deepEqual(freshSave.guesses, [], "no guesses yet");
console.log(`ok — fresh daily: ${freshSave.date}, answer ${freshAnswer}, starts at tile ${freshSave.start}`);

// ---------- 6. typing lands on the ring; arrows spin before AND after --------

ENC.practice("modal", 2);

keydown("ArrowRight"); // move the start empty: the highlight walks alone
assert.ok(rowTiles(0)[1].classList.contains("s0"), "the highlight moves with the arrow");
assert.deepEqual(ENC.dump().pendingStart, 1, "pending start tracked");

for (const ch of "modal") keydown(ch);
assert.deepEqual(rowTiles(0).map((t) => t.textContent), ["l", "m", "o", "d", "a"],
  "the word lays down from the highlighted tile and wraps");

keydown("ArrowLeft"); // start 0
keydown("ArrowLeft"); // start 4 — now with letters aboard
assert.deepEqual(rowTiles(0).map((t) => t.textContent), ["o", "d", "a", "l", "m"],
  "the whole word swings with the arrow, wrapping around");
keydown("ArrowRight"); // start 0
assert.deepEqual(rowTiles(0).map((t) => t.textContent), ["m", "o", "d", "a", "l"],
  "and back again");
keydown("Backspace");
assert.deepEqual(rowTiles(0).map((t) => t.textContent), ["m", "o", "d", "a", ""],
  "backspace pops the last typed letter");
keydown("l"); // retype the popped letter
assert.deepEqual(ENC.dump().typed, "modal", "modal rebuilt");
keydown("x");
assert.equal(ENC.dump().typed, "modal", "a sixth letter is refused");
console.log("ok — typing wraps the ring; arrows spin the word empty or full");

// ---------- 7. the wrong start: right word, ring of yellow --------------------

typeRow("modal"); // start 0 vs answer's start 2
{
  assert.deepEqual(rowTiles(0).map((t) => t.classList.contains("present")),
    [true, true, true, true, true], "every tile shows yellow");
  assert.ok(rowTiles(0).every((t) => !t.classList.contains("correct")),
    "no greens — the rotations disagree");
  assert.equal(toast.textContent, "Right word \u2014 rotate it into place",
    "the game names the near miss");
  assert.equal(ENC.dump().done, false, "no win");
  assert.deepEqual(ENC.dump().guesses, [{ w: "modal", s: 0 }], "the guess keeps its start");
  for (const l of "modal") {
    assert.ok(keyFor(l).classList.contains("present"), `key ${l} heard the yellow`);
  }
  assert.equal(board.children.length, 2, "a waiting row followed");
  assert.ok(board.children[1].classList.contains("on"), "the new row is live");
  assert.ok(!board.children[0].classList.contains("on"), "the scored row retired its arrows");
}
console.log("ok — right word at the wrong start: a full ring of yellow, no win");

// ---------- 8. the right start: the circle closes -----------------------------

keydown("ArrowRight");
keydown("ArrowRight"); // start 2 — aligned with the answer
typeRow("modal");
{
  assert.deepEqual(rowTiles(1).map((t) => t.classList.contains("correct")),
    [true, true, true, true, true], "five greens close the circle");
  assert.equal(ENC.dump().done, true, "done");
  assert.equal(ENC.dump().won, true, "won");
  assert.equal(banner.textContent, "Magnificent \u2014 2 guesses", "praised by the count");
  assert.ok(!shareBtn.classList.contains("hidden"), "share appears on the win");
  assert.ok(giveUpBtn.classList.contains("hidden"), "give up retires");
  assert.ok(rowTiles(1).every((t) => t.classList.contains("win-glow")), "the ring glows");
  keydown("a");
  assert.equal(ENC.dump().guesses.length, 2, "board locked after the win");
  assert.ok(board.children.every((r) => !r.classList.contains("on")),
    "no row keeps its arrows after the end");
}
console.log("ok — word + start aligned: five greens, praised, locked");

// ---------- 9. share: the displayed marks --------------------------------------

shareBtn.click();
{
  const ta = createdEls.filter((e) => e.tagName === "textarea").pop();
  const lines = ta.value.split("\n");
  const SQ = "\u2B1C"; // light theme's absent square
  const GRN = "\uD83D\uDFE9";
  const YLW = "\uD83D\uDFE8";
  assert.equal(lines[0], "Encircle · practice · 2/9", "practice share header");
  assert.equal(lines[1], GAME_URL, "share links to the game");
  assert.equal(lines[2], YLW.repeat(5), "the yellow ring");
  assert.equal(lines[3], GRN.repeat(5), "the closed circle");
}
console.log("ok — share: name · practice/date · N/9, URL, the displayed grid");

// ---------- 10. every start is a win; the wrong one is all yellow --------------

for (const s of [0, 1, 2, 3, 4]) {
  ENC.practice("crane", s);
  for (let i = 0; i < s; i++) keydown("ArrowRight");
  typeRow("crane");
  assert.ok(ENC.dump().won, `crane spun to start ${s} wins`);
}
for (const s of [0, 1, 2, 3, 4]) {
  const wrong = (s + 2) % 5;
  ENC.practice("crane", s);
  for (let i = 0; i < wrong; i++) keydown("ArrowRight");
  typeRow("crane");
  assert.ok(!ENC.dump().done, `crane at start ${wrong} vs answer start ${s} does not win`);
  assert.ok(rowTiles(0).every((t) => t.classList.contains("present")),
    "the same word twisted is still a ring of yellow");
  assert.equal(toast.textContent, "Right word \u2014 rotate it into place",
    "the near-miss toast fires every time");
}
console.log("ok — all five starts win when aligned, all yellow when not");

// ---------- 11. mixed marks land on the typed letters --------------------------

ENC.practice("crane", 2); // the answer displays as "necra"
typeRow("snare");        // displays as "snare" → A P P K P
{
  const marks = rowTiles(0).map((t) =>
    t.classList.contains("correct") ? "K"
      : t.classList.contains("present") ? "P"
        : t.classList.contains("absent") ? "A" : "?");
  assert.equal(marks.join(""), "APPKP", "snare vs necra scores per displayed tile");
  assert.ok(keyFor("r").classList.contains("correct"), "r earns its green");
  assert.ok(keyFor("s").classList.contains("absent"), "s earns its gray");
  assert.ok(keyFor("n").classList.contains("present"), "n earns its yellow");
}
typeRow("crane"); // right word at start 0 — all yellow again, no win
{
  assert.ok(!ENC.dump().done, "crane twisted wrong still doesn't win");
  assert.ok(keyFor("r").classList.contains("correct"),
    "the keyboard never downgrades (yellow r vs green r)");
}
for (let i = 0; i < 2; i++) keydown("ArrowRight");
typeRow("crane"); // aligned — the win
assert.equal(banner.textContent, "Impressive \u2014 3 guesses", "three guesses, praised");
console.log("ok — marks score the displayed tiles; the keyboard follows the typed letters");

// ---------- 12. nine guesses: the ninth miss is the loss ------------------------

ENC.practice("crane", 0);
for (let i = 0; i < 9; i++) typeRow("hoist");
{
  assert.equal(ENC.dump().done, true, "nine misses end it");
  assert.equal(ENC.dump().won, false, "not won");
  assert.equal(ENC.dump().gaveUp, false, "not a surrender — exhaustion");
  assert.equal(banner.textContent, "The word was CRANE", "the loss reveals the word");
  assert.equal(board.children.length, 9, "no tenth row");
  keydown("a");
  assert.equal(ENC.dump().guesses.length, 9, "board locked");
}
shareBtn.click();
{
  const ta = createdEls.filter((e) => e.tagName === "textarea").pop();
  assert.equal(ta.value.split("\n")[0], "Encircle · practice · X/9",
    "exhaustion tagged X/9 in the share");
}
console.log("ok — the ninth miss loses: word revealed, board locked, X/9");

// ---------- 13. give up: the other loss ------------------------------------------

store.clear();
seedDaily("crane", [], { start: 3 });
giveUpBtn.click();
{
  assert.equal(banner.textContent, "The word was CRANE", "give up reveals the word");
  assert.ok(giveUpBtn.classList.contains("hidden"), "give up retires after use");
  assert.ok(!shareBtn.classList.contains("hidden"), "share offered after give up");
  const gaveUpSave = readSave();
  assert.equal(gaveUpSave.done, true, "give up saved done");
  assert.equal(gaveUpSave.gaveUp, true, "gaveUp flag explicit");
  keydown("a");
  assert.equal(ENC.dump().guesses.length, 0, "board locked after give up");
}
shareBtn.click();
{
  const ta = createdEls.filter((e) => e.tagName === "textarea").pop();
  assert.equal(ta.value.split("\n")[0], `Encircle · ${ENC.todayKey()} · gave up · X/9`,
    "surrender tagged in the share");
}
dailyGame();
assert.equal(banner.textContent, "The word was CRANE", "loss banner restored");
console.log("ok — give up: reveals the word, saves the loss, restores locked");

// ---------- 14. the ring controls work by click too -------------------------------

ENC.practice("crane", 4);
{
  const [west, east] = rowArrows(0);
  east.click();
  assert.equal(ENC.dump().pendingStart, 1, "the east arrow spins right");
  west.click();
  assert.equal(ENC.dump().pendingStart, 0, "the west arrow spins back");
  east.click(); east.click(); // start 2
  assert.equal(ENC.dump().pendingStart, 2, "spins compose");
}
for (let i = 0; i < 2; i++) rowArrows(0)[1].click(); // start 4
typeRow("crane");
assert.ok(ENC.dump().won, "spun to the answer's start by clicks, crane wins");
console.log("ok — the arrow buttons spin the ring; four east clicks align crane");

// ---------- 15. refresh mid-game: marks recompute, play continues -----------------

store.clear();
seedDaily("crane", [{ w: "snare", s: 1 }], { start: 2 });
dailyGame(); // simulated refresh
{
  assert.deepEqual(rowTiles(0).map((t) => t.textContent), ["e", "s", "n", "a", "r"],
    "snare restored at start 1: e leads, wrapping");
  const marks = rowTiles(0).map((t) =>
    t.classList.contains("correct") ? "K"
      : t.classList.contains("present") ? "P"
        : t.classList.contains("absent") ? "A" : "?");
  assert.equal(marks.join(""), "PAPPP", "snare@1 vs crane@2 recomputed");
  assert.ok(rowTiles(0)[1].classList.contains("s0"), "the guess's start dot restored");
  assert.ok(board.children[0].classList.contains("quiet"), "restored rows are quiet");
  assert.ok(rowTiles(0)[0].classList.contains("present") && keyFor("e").classList.contains("present"),
    "keyboard colors restored");
  assert.ok(keyFor("s").classList.contains("absent"), "the gray restored");
  assert.ok(rowTiles(1)[0].classList.contains("s0"), "the waiting row starts at tile 0");
  assert.equal(banner.textContent, OPEN_BANNER, "the hunt is re-announced");
}
for (let i = 0; i < 2; i++) keydown("ArrowRight");
typeRow("crane");
assert.equal(banner.textContent, "Magnificent \u2014 2 guesses", "play continues after a refresh and wins");
console.log("ok — refresh mid-game: the ring re-derived, play continues, wins");

// ---------- 16. refresh after finishing --------------------------------------------

dailyGame(); // refresh the just-won daily
assert.equal(ENC.dump().guesses.length, 2, "finished board restored");
assert.equal(banner.textContent, "Magnificent \u2014 2 guesses", "won banner restored");
assert.ok(!shareBtn.classList.contains("hidden"), "share offered again");
assert.ok(giveUpBtn.classList.contains("hidden"), "give up stays retired");
assert.ok(rowTiles(1).every((t) => t.classList.contains("win-glow")), "the win glow restored");
keydown("a");
assert.equal(ENC.dump().guesses.length, 2, "restored won board is locked");
console.log("ok — refresh after finishing: banner, share, glow and lock all restored");

// ---------- 17. next day: fresh puzzle; corrupt saves fall back ---------------------

let s = readSave();
s.date = "1999-12-31";
globalThis.localStorage.setItem("encircle-day12", JSON.stringify(s));
dailyGame();

s = readSave();
assert.notEqual(s.date, "1999-12-31", "stale save replaced");
assert.equal(s.date, ENC.todayKey(), "re-stamped with today");
assert.equal(s.answer, ENC.answerFor(ENC.todayKey()), "new day, new daily word");
assert.equal(s.start, ENC.startFor(ENC.todayKey()), "new day, new hidden start");
assert.deepEqual(s.guesses, [], "guesses reset");

const good = { date: ENC.todayKey(), answer: "crane", start: 2, guesses: [],
  done: false, won: false, gaveUp: false };
const longGuesses = Array.from({ length: 10 }, () => ({ w: "hoist", s: 0 }));
for (const bad of [
  { ...good, answer: "qqqqq" },                        // not a word
  { ...good, answer: 42 },                              // not a string
  { date: ENC.todayKey(), guesses: [] },               // no answer
  { ...good, start: 5 },                                // off the ring
  { ...good, start: -1 },                               // off the ring
  { ...good, start: 1.5 },                              // not a tile
  { ...good, start: "2" },                              // not a number
  { date: ENC.todayKey(), answer: "crane", guesses: [] }, // no start
  { ...good, guesses: "crane" },                        // not an array
  { ...good, guesses: [{ w: "qqqqq", s: 0 }] },        // non-word
  { ...good, guesses: [{ w: "crane" }] },              // no start on the guess
  { ...good, guesses: [{ w: "crane", s: 9 }] },        // guess start off the ring
  { ...good, guesses: longGuesses },                    // more than nine
]) {
  globalThis.localStorage.setItem("encircle-day12", JSON.stringify(bad));
  dailyGame();
  s = readSave();
  assert.equal(s.answer, ENC.answerFor(ENC.todayKey()),
    `corrupt save ${JSON.stringify(bad).slice(0, 50)}… replaced by a fresh daily`);
  assert.deepEqual(s.guesses, [], "corrupt save's guesses discarded");
}
console.log("ok — next day + corrupt saves: stale/fake/off-ring saves fall back fresh");

// ---------- 18. arrows lock during the reveal and after the end ----------------------

ENC.practice("crane", 0);
for (const ch of "crane") keydown(ch);
keydown("Enter");           // reveal starts; no timers yet
keydown("ArrowRight");
keydown("ArrowRight");
assert.equal(ENC.dump().pendingStart, 0, "the ring is frozen mid-reveal");
runTimers();
assert.equal(ENC.dump().won, true, "the guess lands with the start it was spun to");
keydown("ArrowRight");
assert.equal(ENC.dump().pendingStart, 0, "and stays frozen after the win");
console.log("ok — arrows lock during the reveal and after the end");

// ---------- 19. practice: forced answer + start, random, daily save untouched --------

store.clear();
seedDaily("crane", [], { start: 0 });
const saveBeforePractice = globalThis.localStorage.getItem("encircle-day12");
const craneIdx = ANSWERS.indexOf("crane");
Math.random = () => (craneIdx + 0.5) / ANSWERS.length;

ENC.practice();
assert.equal(banner.textContent, "Practice round", "practice banner shown");
assert.equal(newBtn.textContent, "Today\u2019s puzzle", "button offers the way back");
assert.equal(ENC.dump().answer, ANSWERS[craneIdx], "random word honors the Math.random stub");
assert.ok(ENC.dump().answerStart >= 0 && ENC.dump().answerStart <= 4,
  "random start is a tile");

ENC.practice("crane", 4); // forced word AND start, the debugging backdoor
assert.equal(ENC.dump().answer, "crane", "forced practice word honored");
assert.equal(ENC.dump().answerStart, 4, "forced practice start honored");
ENC.practice("crane");    // forced word only — start stays random
assert.equal(ENC.dump().answerStart >= 0 && ENC.dump().answerStart <= 4, true,
  "unforced start stays a tile");
ENC.practice("qqqqq");    // invalid: falls back to random, still a word
assert.ok(DICT.has(ENC.dump().answer), "invalid forced word rejected");

const d = ENC.dump();
assert.ok(Array.isArray(d.guesses), "dump exposes the guesses");
assert.ok("answerStart" in d && "pendingStart" in d, "dump exposes both starts");
assert.ok("save" in d, "dump carries the raw save");

assert.equal(globalThis.localStorage.getItem("encircle-day12"), saveBeforePractice,
  "practice never touches the daily save");

newBtn.click(); // back to today's puzzle
assert.equal(newBtn.textContent, "Practice", "button back to Practice");
assert.equal(banner.textContent, OPEN_BANNER, "fresh daily re-announced");
assert.ok(!giveUpBtn.classList.contains("hidden"), "give up back for the fresh daily");
console.log("ok — practice: forced + random word and start, no save writes, round-trips to daily");

// ---------- 20. solvability sweep: word + start always closes the ring ----------------

let swept = 0;
for (let i = 0; i < 60; i++) {
  const key = `2027-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`;
  seedDaily(ENC.answerFor(key), [], { start: ENC.startFor(key) });
  const answer = ENC.dump().answer;
  for (let k = 0; k < ENC.dump().answerStart; k++) keydown("ArrowRight");
  typeRow(answer);
  assert.ok(readSave().won, `${key}: the word at the answer's start wins in one`);
  swept++;
}
console.log(`ok — solvability sweep: ${swept} sampled dailies all close in one aligned guess`);

console.log("\nAll encircle tests passed.");
