// Headless tests for js/castle.js. Loads the real game script against a
// minimal DOM stub and drives full games through the keyboard handler.
// Run: node tests/castle.test.js
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
const GAME_URL = "https://suitangi.github.io/30Wordles/days/11";

require(path.join(__dirname, "..", "js", "castle.js"));
const CASTLE = globalThis.CASTLE;
assert.ok(CASTLE, "castle.js must expose window.CASTLE");

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
const readSave = () => JSON.parse(globalThis.localStorage.getItem("castle-day11"));

// Type a word and submit it, playing out the whole reveal.
function typeRow(word) {
  for (const ch of word) keydown(ch);
  keydown("Enter");
  runTimers();
}

function dailyGame() {
  CASTLE.daily();
}

// Force today's daily puzzle to an answer (optionally with guesses played).
function seedDaily(answer, guesses = [], extra = {}) {
  globalThis.localStorage.setItem("castle-day11", JSON.stringify({
    date: CASTLE.todayKey(), answer, guesses, done: false, won: false, gaveUp: false, ...extra,
  }));
  dailyGame();
}

const ev = CASTLE.evaluate;
const M = (marksStr) => marksStr.split("").map((ch) => ({ K: "correct", P: "present", A: "absent" }[ch]));
const K = "correct", P = "present", A = "absent", L = null;
const OPEN_BANNER = "Breach the walls \u2014 outside in";
const G = (w, shown) => ({ w, shown });

// ---------- 1. word list sanity ----------

assert.equal(ANSWERS.length, 2315, "answers count");
assert.equal(DICT.size, 14855, "guessable count");
for (const w of ANSWERS) {
  assert.match(w, /^[a-z]{5}$/, `answer "${w}" shape`);
  assert.ok(DICT.has(w), `answer "${w}" must be guessable`);
}
for (const w of ["crane", "range", "hoist", "cramp"]) {
  assert.ok(DICT.has(w), `test word "${w}" is guessable`);
}
console.log("ok — word lists (2315 answers, 14855 guessable, test words present)");

// ---------- 2. evaluate: standard Wordle two-pass, duplicates included ----

assert.deepEqual(ev("crane", "crane"), M("KKKKK"), "exact match");
assert.deepEqual(ev("crane", "brane"), M("AKKKK"), "one letter off");
assert.deepEqual(ev("speed", "abode"), M("AAPAP"),
  "duplicate guess letters consume target letters once each");
assert.deepEqual(ev("eerie", "erase"), M("KAPAK"),
  "repeated letters: greens first, strays consume target copies in order");
console.log("ok — evaluate: two-pass, duplicates handled");

// ---------- 3. the walls: unlockedFor ---------------------------------------
// Every tile is breachable from BOTH sides — 1 and 5 are just where the
// player starts (suitangi fix).

const F = false, T = true;
assert.deepEqual(CASTLE.unlockedFor([F, F, F, F, F]), [T, F, F, F, T],
  "fresh walls: only 1 and 5 stand open");
assert.deepEqual(CASTLE.unlockedFor([T, F, F, F, F]), [T, T, F, F, T],
  "breaching 1 opens 2");
assert.deepEqual(CASTLE.unlockedFor([F, F, F, F, T]), [T, F, F, T, T],
  "breaching 5 opens 4");
assert.deepEqual(CASTLE.unlockedFor([F, T, F, F, F]), [T, F, T, F, T],
  "breaching 2 opens the keep from the left");
assert.deepEqual(CASTLE.unlockedFor([F, F, F, T, F]), [T, F, T, F, T],
  "breaching 4 opens the keep from the right");
assert.deepEqual(CASTLE.unlockedFor([F, F, T, F, F]), [T, T, F, T, T],
  "breaching the keep alone opens both wings");
assert.deepEqual(CASTLE.unlockedFor([F, F, T, T, T]), [T, T, T, T, T],
  "keep + east breached cracks tile 2 from the inside");
assert.deepEqual(CASTLE.unlockedFor([T, T, T, F, F]), [T, T, T, T, T],
  "one flank can storm the whole word");
assert.deepEqual(CASTLE.unlockedFor([T, T, F, T, T]), [T, T, T, T, T],
  "everything open");
console.log("ok — unlockedFor: walls fall to both sides; 1 and 5 are just the start");

// ---------- 4. daily word: date-derived, salted away from days 1-10 --------

function saltHash(s) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}
const salted = (salt, key) => ANSWERS[saltHash(salt + key) % ANSWERS.length];

let diff = 0;
for (let i = 0; i < 200; i++) {
  const key = `2026-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`;
  const a = CASTLE.answerFor(key);
  assert.equal(a, CASTLE.answerFor(key), "answerFor is deterministic");
  assert.ok(DICT.has(a), "answer is guessable");
  const others = [
    ANSWERS[saltHash(key) % ANSWERS.length], // Bundle hashes the bare key
    salted("subtle", key), salted("wobble", key), salted("toggle", key),
    salted("meddle", key), salted("meddle-b", key), salted("crumble", key),
    salted("bubble", key), salted("swivel", key), salted("swivel-b", key),
    salted("stifle", key), salted("hustle", key),
  ];
  if (others.every((w) => w !== a)) diff++;
}
assert.ok(diff > 180, `answer avoids days 1-10's words (${diff}/200 dates)`);
console.log(`ok — daily word: deterministic, salt-differ from days 1-10 (${diff}/200)`);

// ---------- 5. fresh daily: one waiting row with its map of walls -----------

store.clear();
dailyGame();

const freshAnswer = CASTLE.answerFor(CASTLE.todayKey());
assert.equal(board.children.length, 1, "one waiting row");
assert.deepEqual([...rowTiles(0)].map((t) => t.classList.contains("locked")),
  [false, true, true, true, false], "the pending row shows its walled slots");
assert.equal(banner.textContent, OPEN_BANNER, "the siege is announced");
assert.ok(!giveUpBtn.classList.contains("hidden"), "give up offered on a fresh board");
assert.ok(shareBtn.classList.contains("hidden"), "no share before an end state");

const freshSave = readSave();
assert.equal(freshSave.date, CASTLE.todayKey(), "save stamped with today");
assert.equal(freshSave.answer, freshAnswer, "daily answer is date-derived");
assert.deepEqual(freshSave.guesses, [], "no guesses yet");
console.log(`ok — fresh daily: ${freshSave.date}, answer ${freshAnswer} — walls mapped on the waiting row`);

// ---------- 6. the full siege: even the answer must be stormed twice -------

CASTLE.practice("crane");

// Assault 1: the exact answer — only the open walls can show green.
typeRow("crane");
{
  assert.deepEqual([...rowTiles(0)].map((t) => t.classList.contains("correct")),
    [true, false, false, false, true], "tiles 1 and 5 turn green");
  for (const c of [1, 2, 3]) {
    const t = rowTiles(0)[c];
    assert.equal(t.classList.contains("locked"), true, `walled tile ${c + 1} stays colorless`);
    assert.ok(!t.classList.contains("correct") && !t.classList.contains("present")
      && !t.classList.contains("absent"), `walled tile ${c + 1} shows no mark`);
  }
  assert.equal(toast.textContent, "You know the word \u2014 breach inward",
    "a known word is not a win while walls stand");
  assert.equal(CASTLE.dump().done, false, "no win");
  assert.deepEqual(CASTLE.dump().breached, [true, false, false, false, true],
    "the outer walls are breached");
  assert.deepEqual([...rowTiles(1)].map((t) => t.classList.contains("locked")),
    [false, false, true, false, false], "the waiting row now walls only the keep");
  assert.ok(rowTiles(1)[1].classList.contains("gate-open"), "the new gate flashes open");
}

// Assault 2: 2 and 4 give their greens; the keep is still walled.
typeRow("crane");
{
  assert.deepEqual([...rowTiles(1)].map((t) => t.classList.contains("correct")),
    [true, true, false, true, true], "tiles 2 and 4 turn green this time");
  assert.equal(CASTLE.dump().done, false, "still no win — the keep stands");
  assert.deepEqual(CASTLE.dump().breached, [true, true, false, true, true],
    "both wings are breached");
  assert.deepEqual([...rowTiles(2)].map((t) => t.classList.contains("locked")),
    [false, false, false, false, false], "the keep stands open");
}

// Assault 3: five greens take the castle.
typeRow("crane");
{
  assert.equal(CASTLE.dump().done, true, "done");
  assert.equal(CASTLE.dump().won, true, "won");
  assert.equal(banner.textContent, "Impressive \u2014 3 guesses", "praised by the count");
  assert.ok(!shareBtn.classList.contains("hidden"), "share appears on the win");
  assert.ok(giveUpBtn.classList.contains("hidden"), "give up retires");
  for (const t of rowTiles(2)) assert.ok(t.classList.contains("win-glow"), "the castle falls glowing");
  keydown("a");
  assert.equal(CASTLE.dump().guesses.length, 3, "board locked after the win");
}
console.log("ok — the siege: the exact answer storms three times; walled tiles never clue");

// ---------- 7. open tiles clue normally: yellow and gray ---------------------

CASTLE.practice("crane");
typeRow("range");
{
  const t = rowTiles(0);
  assert.ok(t[0].classList.contains("present"), "an open tile shows yellow");
  assert.ok(t[4].classList.contains("correct"), "an open tile shows green");
  for (const c of [1, 2, 3]) {
    assert.equal(t[c].classList.contains("locked"), true, `tile ${c + 1} walled`);
    assert.ok(!t[c].classList.contains("present") && !t[c].classList.contains("absent"),
      `tile ${c + 1} gives nothing`);
  }
  assert.ok(keyFor("r").classList.contains("present"), "the keyboard hears the yellow");
  assert.ok(keyFor("e").classList.contains("correct"), "the keyboard hears the green");
  assert.equal(keyFor("a").dataset.state || "", "", "walled letters teach the keyboard nothing");
  assert.equal(keyFor("n").dataset.state || "", "", "walled letters teach the keyboard nothing");
  assert.deepEqual(CASTLE.dump().breached, [false, false, false, false, true],
    "the eastern green breached the wall behind it");
  assert.equal(rowTiles(1)[3].classList.contains("locked"), false, "tile 4 now clues");
  assert.equal(rowTiles(1)[1].classList.contains("locked"), true, "tile 2 still walled");
}

CASTLE.practice("crane");
typeRow("hoist");
{
  const t = rowTiles(0);
  assert.ok(t[0].classList.contains("absent"), "an open tile shows gray");
  assert.ok(t[4].classList.contains("absent"), "an open tile shows gray");
  assert.ok(keyFor("h").classList.contains("absent") && keyFor("t").classList.contains("absent"),
    "grays paint the keyboard");
  assert.equal(keyFor("o").dataset.state || "", "", "the walled o teaches nothing");
  assert.deepEqual(CASTLE.dump().breached, [false, false, false, false, false],
    "grays breach nothing");
}
console.log("ok — open tiles clue normally; walled tiles teach the keyboard nothing");

// ---------- 7b. the inside-out breach: a taken keep cracks tile 2 -----------
// suitangi's scenario: the player somehow takes 3, 4 and 5 first — tile 2
// must be breachable from the keep, without tile 1 ever having fallen.

CASTLE.practice("crane");
typeRow("range"); // e green at tile 5 → breached {5}
assert.deepEqual(CASTLE.dump().breached, [false, false, false, false, true],
  "the east gate is breached");
typeRow("shone"); // n green at tile 4 (now open) → breached {4, 5}
assert.deepEqual(CASTLE.dump().breached, [false, false, false, true, true],
  "tile 4 fell to the eastern breach");
typeRow("beach"); // a green at the keep (open from tile 4) → breached {3, 4, 5}
assert.deepEqual(CASTLE.dump().breached, [false, false, true, true, true],
  "the keep is taken from the east");
assert.deepEqual([...rowTiles(3)].map((t) => t.classList.contains("locked")),
  [false, false, false, false, false],
  "tile 2 stands open — breachable from the keep, no western breach needed");

typeRow("bread"); // r green at tile 2 → breached {2, 3, 4, 5}
assert.deepEqual(CASTLE.dump().breached, [false, true, true, true, true],
  "tile 2 breached from the inside");
assert.deepEqual([...rowTiles(4)].map((t) => t.classList.contains("locked")),
  [false, false, false, false, false], "every wall is down but the west gate's neighbor");
console.log("ok — the inside-out breach: a taken keep cracks tile 2 from the inside");

// ---------- 8. unlimited guesses: no exhaustion, no loss ---------------------

CASTLE.practice("crane");
for (let i = 0; i < 10; i++) typeRow(i % 2 === 0 ? "cramp" : "hoist");
assert.equal(board.children.length, 11, "eleven rows: ten guesses + waiting");
assert.equal(CASTLE.dump().done, false, "ten misses end nothing");
console.log("ok — unlimited guesses: ten misses keep the siege going");

// ---------- 9. give up: the one loss ------------------------------------------

seedDaily("crane");
giveUpBtn.click();
assert.equal(banner.textContent, "The word was CRANE", "give up reveals the word");
assert.ok(giveUpBtn.classList.contains("hidden"), "give up retires after use");
assert.ok(!shareBtn.classList.contains("hidden"), "share offered after give up");
const gaveUpSave = readSave();
assert.equal(gaveUpSave.done, true, "give up saved done");
assert.equal(gaveUpSave.gaveUp, true, "gaveUp flag explicit");
keydown("a");
assert.equal(CASTLE.dump().guesses.length, 0, "board locked after give up");

shareBtn.click();
const gta = createdEls.filter((e) => e.tagName === "textarea").pop();
assert.equal(gta.value.split("\n")[0], `Castle · ${CASTLE.todayKey()} · gave up · 0 guesses`,
  "surrender tagged in the share");

dailyGame();
assert.equal(banner.textContent, "The word was CRANE", "loss banner restored");
assert.ok(giveUpBtn.classList.contains("hidden"), "give up stays retired");
console.log("ok — give up: reveals the word, saves the loss, restores locked");

// ---------- 10. share: the grid with locks ------------------------------------

CASTLE.practice("crane");
typeRow("crane");
typeRow("crane");
typeRow("crane");
shareBtn.click();
const ta = createdEls.filter((e) => e.tagName === "textarea").pop();
const lines = ta.value.split("\n");
const SQ = "\u2B1C"; // light theme's absent square
const LOCK = "\uD83D\uDD12";
const GRN = "\uD83D\uDFE9";
assert.equal(lines[0], "Castle · practice · 3 guesses", "practice share header");
assert.equal(lines[1], GAME_URL, "share links to the game");
assert.equal(lines[2], GRN + LOCK.repeat(3) + GRN, "assault 1: locks where walls stood");
assert.equal(lines[3], GRN + GRN + LOCK + GRN + GRN, "assault 2: the keep still walled");
assert.equal(lines[4], GRN.repeat(5), "assault 3: five greens");
console.log("ok — share: name · practice/date · N guesses, URL, emoji grid with locks");

// ---------- 11. refresh mid-siege: walls re-derive from the stored greens ----

seedDaily("crane", [G("crane", [K, L, L, L, K])]);
dailyGame(); // simulated refresh
{
  assert.deepEqual([...rowTiles(0)].map((t) => t.classList.contains("correct")),
    [true, false, false, false, true], "the assault restored");
  assert.ok(board.children[0].classList.contains("quiet"), "restored rows are quiet");
  assert.deepEqual([...rowTiles(1)].map((t) => t.classList.contains("locked")),
    [false, false, true, false, false], "the wall map restored");
  assert.ok(keyFor("c").classList.contains("correct") && keyFor("e").classList.contains("correct"),
    "keyboard colors restored");
  assert.equal(keyFor("r").dataset.state || "", "", "walled letters still teach nothing after restore");
  assert.equal(banner.textContent, OPEN_BANNER, "the siege is re-announced");
}
typeRow("crane");
typeRow("crane");
assert.equal(banner.textContent, "Impressive \u2014 3 guesses", "play continues after a refresh and wins");
console.log("ok — refresh mid-siege: walls re-derived, play continues, wins");

// ---------- 12. refresh after finishing ----------------------------------------

dailyGame(); // refresh the just-won daily
assert.equal(CASTLE.dump().guesses.length, 3, "finished board restored");
assert.equal(banner.textContent, "Impressive \u2014 3 guesses", "won banner restored");
assert.ok(!shareBtn.classList.contains("hidden"), "share offered again");
assert.ok(giveUpBtn.classList.contains("hidden"), "give up stays retired");
for (const t of rowTiles(2)) assert.ok(t.classList.contains("win-glow"), "the win glow restored");
keydown("a");
assert.equal(CASTLE.dump().guesses.length, 3, "restored won board is locked");
console.log("ok — refresh after finishing: banner, share, glow and lock all restored");

// ---------- 13. next day: fresh puzzle; corrupt saves fall back ----------------

let s = readSave();
s.date = "1999-12-31";
globalThis.localStorage.setItem("castle-day11", JSON.stringify(s));
dailyGame();

s = readSave();
assert.notEqual(s.date, "1999-12-31", "stale save replaced");
assert.equal(s.date, CASTLE.todayKey(), "re-stamped with today");
assert.equal(s.answer, CASTLE.answerFor(CASTLE.todayKey()), "new day, new daily word");
assert.deepEqual(s.guesses, [], "guesses reset");

const good = { date: CASTLE.todayKey(), answer: "crane", guesses: [],
  done: false, won: false, gaveUp: false };
for (const bad of [
  { ...good, answer: "qqqqq" },                       // not a word
  { ...good, answer: 42 },                             // not a string
  { date: CASTLE.todayKey(), guesses: [] },           // no answer
  { ...good, guesses: "crane" },                       // not an array
  { ...good, guesses: [{ w: "qqqqq", shown: [L, L, L, L, L] }] }, // non-word
  { ...good, guesses: [{ w: "crane" }] },              // no shown
  { ...good, guesses: [{ w: "crane", shown: [K, L, L, L] }] },    // short shown
  { ...good, guesses: [{ w: "crane", shown: ["banana", L, L, L, L] }] }, // fake mark
]) {
  globalThis.localStorage.setItem("castle-day11", JSON.stringify(bad));
  dailyGame();
  s = readSave();
  assert.equal(s.answer, CASTLE.answerFor(CASTLE.todayKey()),
    `corrupt save ${JSON.stringify(bad).slice(0, 50)}… replaced by a fresh daily`);
  assert.deepEqual(s.guesses, [], "corrupt save's guesses discarded");
}
console.log("ok — next day + corrupt saves: stale/fake/wall-forging saves fall back fresh");

// ---------- 14. practice: forced word, random word, daily save untouched -------

const saveBeforePractice = globalThis.localStorage.getItem("castle-day11");
const craneIdx = ANSWERS.indexOf("crane");
Math.random = () => (craneIdx + 0.5) / ANSWERS.length;

CASTLE.practice();
assert.equal(banner.textContent, "Practice round", "practice banner shown");
assert.equal(newBtn.textContent, "Today\u2019s puzzle", "button offers the way back");
assert.equal(CASTLE.dump().answer, ANSWERS[craneIdx], "random word honors the Math.random stub");
assert.deepEqual(CASTLE.dump().breached, [false, false, false, false, false],
  "practice starts behind full walls");

const d = CASTLE.dump();
assert.ok(Array.isArray(d.guesses), "dump exposes the guesses");
assert.ok(Array.isArray(d.breached) && Array.isArray(d.unlocked), "dump exposes the walls");
assert.ok("save" in d, "dump carries the raw save");

CASTLE.practice("crane"); // forced word, the debugging backdoor
assert.equal(CASTLE.dump().answer, "crane", "forced practice word honored");
CASTLE.practice("qqqqq"); // invalid: falls back to random, still a word
assert.ok(DICT.has(CASTLE.dump().answer), "invalid forced word rejected");

assert.equal(globalThis.localStorage.getItem("castle-day11"), saveBeforePractice,
  "practice never touches the daily save");

newBtn.click(); // back to today's puzzle
assert.equal(newBtn.textContent, "Practice", "button back to Practice");
assert.equal(banner.textContent, OPEN_BANNER, "fresh daily re-announced");
assert.ok(!giveUpBtn.classList.contains("hidden"), "give up back for the fresh daily");
console.log("ok — practice: forced + random words, no save writes, dump, round-trips to daily");

// ---------- 15. solvability sweep: three storms always take the castle --------

let swept = 0;
for (let i = 0; i < 60; i++) {
  const key = `2027-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`;
  seedDaily(CASTLE.answerFor(key));
  typeRow(CASTLE.dump().answer);
  typeRow(CASTLE.dump().answer);
  typeRow(CASTLE.dump().answer);
  assert.ok(readSave().won, `${key}: storming the answer three times wins`);
  swept++;
}
console.log(`ok — solvability sweep: ${swept} sampled dailies all fall to three assaults`);

console.log("\nAll castle tests passed.");
