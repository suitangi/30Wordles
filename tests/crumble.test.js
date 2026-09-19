// Headless tests for js/crumble.js. Loads the real game script against a
// minimal DOM stub and drives full games through the keyboard handler.
// Run: node tests/crumble.test.js
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
["well", "queue", "shaft", "ghosts", "keyboard", "banner", "toast", "new-btn", "giveup-btn", "share-btn"].forEach((id) => {
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
const GAME_URL = "https://suitangi.github.io/30Wordles/days/6";

require(path.join(__dirname, "..", "js", "crumble.js"));
const CRUMBLE = globalThis.CRUMBLE;
assert.ok(CRUMBLE, "crumble.js must expose window.CRUMBLE");

const well = byId.well;
const queue = byId.queue;
const ghosts = byId.ghosts;
const banner = byId.banner;
const toast = byId.toast;
const newBtn = byId["new-btn"];
const giveUpBtn = byId["giveup-btn"];
const shareBtn = byId["share-btn"];
const keydown = (key) =>
  (windowHandlers.keydown || []).forEach((fn) =>
    fn({ key, metaKey: false, ctrlKey: false, altKey: false }));

const qtile = (c) => queue.children[c];
const keyFor = (letter) => {
  for (const row of byId.keyboard.children) {
    const k = row.children.find((b) => b.textContent === letter);
    if (k) return k;
  }
  return null;
};
const readSave = () => JSON.parse(globalThis.localStorage.getItem("crumble-day6"));

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

// Type a word into the queue and drop it.
function typeRow(word) {
  for (const ch of word) keydown(ch);
  keydown("Enter");
  runTimers();
}

function dailyGame() {
  CRUMBLE.daily();
}

// Force today's daily puzzle to an answer (optionally with guesses played).
function seedDaily(answer, guesses = []) {
  globalThis.localStorage.setItem("crumble-day6", JSON.stringify({
    date: CRUMBLE.todayKey(), answer, guesses, done: false, won: false, gaveUp: false,
  }));
  dailyGame();
}

const G = (word, marks) => ({ w: word, m: marks });
const M = (marksStr) => marksStr.split("").map((ch) => ({ K: "correct", P: "present", A: "absent" }[ch]));

// The pile as the game reports it: pile[col] = bottom-up [{ch, mark}].
const dump = () => CRUMBLE.dump();
const pileCol = (c) => dump().pile[c];
const pileShape = () => dump().pile.map((col) => col.map((t) => t.ch + t.mark[0]));

// ---------- 1. word list sanity ----------

assert.equal(ANSWERS.length, 2315, "answers count");
assert.equal(DICT.size, 14855, "guessable count");
for (const w of ANSWERS) {
  assert.match(w, /^[a-z]{5}$/, `answer "${w}" shape`);
  assert.ok(DICT.has(w), `answer "${w}" must be guessable`);
}
for (const w of ["crate", "tonic", "basic", "hoist", "crane"]) {
  assert.ok(DICT.has(w), `test word "${w}" is guessable`);
}
console.log("ok — word lists (2315 answers, 14855 guessable, test words present)");

// ---------- 2. evaluate: standard Wordle two-pass, duplicates included ----

const ev = CRUMBLE.evaluate;
assert.deepEqual(ev("crane", "crane"), M("KKKKK"), "exact match");
assert.deepEqual(ev("crane", "brane"), M("AKKKK"), "one letter off");
assert.deepEqual(ev("speed", "abode"), M("AAPAP"),
  "duplicate guess letters consume target letters once each");
assert.deepEqual(ev("eerie", "erase"), M("KAPAK"),
  "repeated letters: greens first, strays consume target copies in order");
console.log("ok — evaluate: two-pass, duplicates handled");

// ---------- 3. simulate: gravity, terrain and vertical cancels -------------
// The piece lands flat one row above the terrain's highest column; greys
// crumble; survivors sink down their own columns; a yellow coming to rest
// on a yellow annihilates with it.

const sim = CRUMBLE.simulate;
const K = "correct", P = "present", A = "absent";

{
  const [f1] = sim([M("PPAAA")]);
  assert.equal(f1.base, 0, "first piece lands on the floor");
  assert.deepEqual(f1.cells.map((c) => c.fate),
    ["settle", "settle", "crumble", "crumble", "crumble"]);
  assert.deepEqual(f1.cells.map((c) => c.row), [0, 0, 0, 0, 0]);
}
{
  // yellow sinks onto yellow → cancel; the terrain shrinks back
  const frames = sim([M("APAAA"), M("APAAA")]);
  assert.deepEqual(frames[0].cells[1], { fate: "settle", row: 0 });
  assert.equal(frames[1].base, 1, "second piece lands on the surviving yellow");
  assert.deepEqual(frames[1].cells[1], { fate: "cancel", row: 1 },
    "the yellow pair annihilates");
}
{
  // gravity skips nothing: g3's yellow sinks onto g1's surviving yellow and
  // the pair annihilates, even though g2's column went to dust in between
  const frames = sim([M("APAAA"), M("PAAAA"), M("APAAA")]);
  assert.deepEqual(frames[1].cells.map((c) => c.fate),
    ["settle", "crumble", "crumble", "crumble", "crumble"]);
  assert.deepEqual(frames[2].cells[1], { fate: "cancel", row: 1 },
    "a yellow sinking onto the surviving yellow below annihilates with it");
}
{
  // greens stack into a tall column
  const frames = sim([M("KAAAA"), M("KAAAA"), M("KAAAA")]);
  assert.deepEqual(frames.map((f) => f.cells[0].row), [0, 1, 2],
    "greens stack row upon row");
}
{
  // terrain scatter: the second piece lands flat on the tall column's top,
  // but its yellow sinks all the way back to the floor in its own column
  const frames = sim([M("KAAAA"), M("PPAAA")]);
  assert.equal(frames[1].base, 1, "the piece lands on the terrain top");
  assert.deepEqual(frames[1].cells[0], { fate: "settle", row: 1 },
    "a yellow settling onto the green rests at the terrain height");
  assert.deepEqual(frames[1].cells[1], { fate: "settle", row: 0 },
    "its neighbour sinks past the void to the floor");
}
{
  // a yellow settles onto a GREEN and simply rests — only yellow-on-yellow cancels
  const frames = sim([M("KAAAA"), M("PAAAA")]);
  assert.deepEqual(frames[1].cells[0], { fate: "settle", row: 1 },
    "yellow on green rests");
}
{
  // three stacked yellows: the bottom pair cancels, the third sinks to the
  // floor and endures
  const frames = sim([M("PAAAA"), M("PAAAA"), M("PAAAA")]);
  assert.deepEqual(frames.map((f) => f.cells[0].fate),
    ["settle", "cancel", "settle"]);
  assert.deepEqual(frames[2].cells[0].row, 0);
}
console.log("ok — simulate: flat landing, per-column sink, yellow-on-yellow cancel, terrain scatter");

// ---------- 4. daily word: date-derived, salted away from days 1-5 --------

function saltHash(s) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}
const dailyFor = (salt, key) => ANSWERS[saltHash(salt + key) % ANSWERS.length];

let diff = 0;
for (let i = 0; i < 200; i++) {
  const key = `2026-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`;
  const a = CRUMBLE.answerFor(key);
  assert.equal(a, CRUMBLE.answerFor(key), "answerFor is deterministic");
  assert.ok(DICT.has(a), "answer is guessable");
  if (["bundle", "subtle", "meddle"].every((s) => dailyFor(s, key) !== a)) diff++;
}
assert.ok(diff > 190, `answer avoids days 1-5's words (${diff}/200 dates)`);
console.log(`ok — daily word: deterministic, salt-differ from Bundle/Subtle/Meddle (${diff}/200)`);

// ---------- 5. fresh daily: empty well, queue at the top, save seeded -----

store.clear();
dailyGame();

const freshAnswer = CRUMBLE.answerFor(CRUMBLE.todayKey());
assert.deepEqual(pileShape(), [[], [], [], [], []], "the well starts empty");
assert.equal(queue.children.length, 5, "the queue waits at the top");
for (let c = 0; c < 5; c++) {
  assert.equal(qtile(c).textContent, "", `queue(${c}) starts empty`);
  assert.ok(qtile(c).classList.contains("tile"), `queue(${c}) is a tile`);
}
assert.equal(ghosts.children.length, 40, "ghost cells sketch the 5×8 shaft");
assert.ok(!well.classList.contains("done"), "the well is open");
assert.ok(!giveUpBtn.classList.contains("hidden"), "give up offered on a fresh board");
assert.ok(shareBtn.classList.contains("hidden"), "no share before an end state");
assert.equal(banner.textContent, "", "no banner before an end state");

const freshSave = readSave();
assert.equal(freshSave.date, CRUMBLE.todayKey(), "save stamped with today");
assert.equal(freshSave.answer, freshAnswer, "daily answer is date-derived");
assert.deepEqual(freshSave.guesses, [], "no guesses yet");
console.log(`ok — fresh daily: ${freshSave.date}, answer ${freshAnswer} — empty well, queue at the top`);

// ---------- 6. validation ----------

keydown("c"); keydown("r"); keydown("a"); keydown("t");
keydown("Enter");
runTimers();
assert.equal(toast.textContent, "Not enough letters");
assert.ok(qtile(0).classList.contains("shake"), "the queue shakes on invalid submit");
assert.deepEqual(pileShape(), [[], [], [], [], []], "nothing landed");

const BAD = ["qqqqq", "jjjjj", "vvvvv"].find((w) => !DICT.has(w));
assert.ok(BAD, "need an invalid 5-letter test word");
"crat".split("").forEach(() => keydown("Backspace"));
BAD.split("").forEach(keydown);
keydown("Enter");
runTimers();
assert.equal(toast.textContent, "Not in word list");
for (let c = 0; c < 5; c++) assert.equal(qtile(c).textContent, BAD[c], "queue keeps the word for fixing");
console.log(`ok — validation rejects short words and "${BAD}"`);

// ---------- 7. the drop: piece lands, greys crumble, survivors sink -------

CRUMBLE.practice("crane");
assert.equal(banner.textContent, "Practice round", "practice banner shown");
const saveBeforeDrop = globalThis.localStorage.getItem("crumble-day6");

// crate vs crane: c,r,a,e green — t grey and crumbles
typeRow("crate");
assert.deepEqual(pileShape(), [["cc"], ["rc"], ["ac"], [], ["ec"]],
  "crate: four greens hold their columns, t crumbled");
assert.ok(keyFor("t").classList.contains("absent"), "keyboard paints grey from a swallowed tile");
assert.ok(keyFor("c").classList.contains("correct"), "keyboard paints green");
for (let c = 0; c < 5; c++) {
  assert.equal(qtile(c).textContent, "", "the queue emptied for the next word");
  assert.ok(!qtile(c).classList.contains("filled"), "queue slot reset");
}
assert.equal(globalThis.localStorage.getItem("crumble-day6"), saveBeforeDrop,
  "practice never saves");
console.log("ok — the drop: piece lands, t crumbles, greens hold, queue refills");

// ---------- 8. sinking and vertical cancels in live play -------------------
// tonic vs crane: yellows at c2 and c4. col2 rests on crate's green a,
// col4 rests on crate's green e — no cancels, just a growing pile.

typeRow("tonic");
assert.deepEqual(pileShape(), [["cc"], ["rc"], ["ac", "np"], [], ["ec", "cp"]],
  "tonic: two yellows rest on the greens beneath them");

// basic vs crane: yellows at c1 and c4. c1 rests on crate's green r. c4
// settles onto tonic's yellow c → the pair annihilates and col4 shrinks.
typeRow("basic");
assert.deepEqual(pileShape(), [["cc"], ["rc", "ap"], ["ac", "np"], [], ["ec"]],
  "basic: c4 took tonic's yellow with it, c1 rests on the green");

// basic again: c1 now settles onto basic's surviving yellow → cancelled;
// c4 settles onto crate's green e → rests. Same word, opposite fates.
typeRow("basic");
assert.deepEqual(pileShape(), [["cc"], ["rc"], ["ac", "np"], [], ["ec", "cp"]],
  "basic again: c1 pair annihilates, c4 rests on the green");
console.log("ok — sinking + vertical cancels: pairs annihilate on contact, greens anchor the pile");

// ---------- 9. the win: the settled pile reads the answer horizontally ----

seedDaily("crane");
typeRow("crane");
// on an empty well every tile sinks to the floor, so the word lands level
assert.deepEqual(pileShape(), [["cc"], ["rc"], ["ac"], ["nc"], ["ec"]],
  "the typed answer assembled itself at the floor");
assert.equal(banner.textContent, "Genius \u2014 1 guess", "typed win praised");
assert.ok(well.classList.contains("done"), "the well closes on the win");
assert.ok(!shareBtn.classList.contains("hidden"), "share appears on the win");
assert.ok(giveUpBtn.classList.contains("hidden"), "give up retires on the win");
const winSave = readSave();
assert.equal(winSave.done, true, "done saved");
assert.equal(winSave.won, true, "won saved");
assert.equal(winSave.guesses.length, 1, "the guess saved with marks");
assert.equal(winSave.answer, "crane", "answer persisted");

shareBtn.classList.remove("hidden");
shareBtn.click();
const ta = createdEls.filter((e) => e.tagName === "textarea").pop();
assert.ok(ta, "share staged a clipboard textarea");
const lines = ta.value.split("\n");
assert.equal(lines[0], `Crumble · ${CRUMBLE.todayKey()} · 1 guess`, "share header");
assert.equal(lines[1], GAME_URL, "share links to the game");
assert.equal(lines[2], "\uD83D\uDFE9".repeat(5), "full-mark squares, crumble or not");
keydown("a");
assert.equal(dump().guesses.length, 1, "no typing after the win");
console.log("ok — the win: the settled pile reads the answer horizontally");

// ---------- 9b. the win scan: suitangi's manic example ---------------------
// floor %INIC, row1 %A%%% — typing MANIC scatters to MINIC/%ANIC/%A%%%
// (no win). A later M sinking into column 0 completes MANIC at row 1.

const userPile = [[], [{ ch: "i" }, { ch: "a" }], [{ ch: "n" }], [{ ch: "i" }], [{ ch: "c" }]];
assert.equal(CRUMBLE.scanWin(userPile, "manic"), -1, "no horizontal manic yet");
const afterM = [
  [{ ch: "m" }, { ch: "m" }],
  [{ ch: "i" }, { ch: "a" }, { ch: "a" }],
  [{ ch: "n" }, { ch: "n" }],
  [{ ch: "i" }, { ch: "i" }],
  [{ ch: "c" }, { ch: "c" }],
];
assert.equal(CRUMBLE.scanWin(afterM, "manic"), 1,
  "the M sinking into col0 completes MANIC at row 1");
assert.equal(CRUMBLE.scanWin(afterM, "crane"), -1, "only the answer wins");
console.log("ok — the win scan: only a full horizontal answer row wins, at any height");

// ---------- 10. refresh mid-game: the pile rebuilds from the marks --------

seedDaily("crane", [
  G("crate", ev("crate", "crane")),
  G("tonic", ev("tonic", "crane")),
]);
dailyGame(); // simulated refresh
assert.deepEqual(pileShape(), [["cc"], ["rc"], ["ac", "np"], [], ["ec", "cp"]],
  "the pile replays exactly from the stored marks");
assert.ok(keyFor("t").classList.contains("absent"), "keyboard colors restored");
assert.equal(banner.textContent, "", "still quiet mid-game");
assert.ok(!well.classList.contains("done"), "the well stays open");

typeRow("basic");
assert.deepEqual(pileShape(), [["cc"], ["rc", "ap"], ["ac", "np"], [], ["ec"]],
  "a drop after a refresh cancels exactly like live play");
console.log("ok — refresh mid-game: the pile rebuilds and play continues");

// ---------- 11. the assemble win + refresh after finishing ----------------

// penny vs crane: its stray e annihilates basic's yellow a, and the green
// n at c3 settles into the one empty column — completing CRANE at row 0.
typeRow("penny");
assert.deepEqual(pileShape(), [["cc"], ["rc"], ["ac", "np"], ["nc"], ["ec"]],
  "penny rebuilt the floor row: c r a n e");
assert.equal(banner.textContent, "Splendid \u2014 4 guesses", "assemble win praised");
assert.ok(well.classList.contains("done"), "the well closes on the assemble win");

dailyGame();
assert.equal(dump().guesses.length, 4, "finished well restored");
assert.ok(well.classList.contains("done"), "restored well stays closed");
assert.ok(!shareBtn.classList.contains("hidden"), "share offered again");
keydown("a");
assert.equal(dump().guesses.length, 4, "restored well is locked");
console.log("ok — the assemble win: penny never spelled crane on landing, the pile did");

// ---------- 12. give up: the loss path and restore -------------------------

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
assert.ok(well.classList.contains("done"), "the well closes on give up");
keydown("a");
assert.equal(dump().guesses.length, 1, "board locked after give up");

shareBtn.click();
const gta = createdEls.filter((e) => e.tagName === "textarea").pop();
assert.match(gta.value.split("\n")[0],
  /^Crumble · \d{4}-\d{2}-\d{2} · gave up · 1 guess$/,
  "give-up share tags the surrender");

dailyGame(); // refresh
assert.equal(dump().guesses.length, 1, "given-up well restored");
assert.equal(banner.textContent, "The word was CRANE", "loss banner restored");
assert.ok(well.classList.contains("done"), "restored well stays closed");
assert.ok(giveUpBtn.classList.contains("hidden"), "give up stays retired");
console.log("ok — give up: reveals the word, saves the loss, restores locked");

// ---------- 13. next day: fresh puzzle; corrupt saves fall back ------------

let s = readSave();
s.date = "1999-12-31";
globalThis.localStorage.setItem("crumble-day6", JSON.stringify(s));
dailyGame();

s = readSave();
assert.notEqual(s.date, "1999-12-31", "stale save replaced");
assert.equal(s.date, CRUMBLE.todayKey(), "re-stamped with today");
assert.equal(s.answer, CRUMBLE.answerFor(CRUMBLE.todayKey()), "new day, new daily word");
assert.deepEqual(s.guesses, [], "guesses reset");
assert.deepEqual(pileShape(), [[], [], [], [], []], "back to an empty well");
assert.equal(ghosts.children.length, 40, "ghost grid rebuilt");

for (const bad of [
  { date: CRUMBLE.todayKey(), answer: "qqqqq", guesses: [] },  // not a word
  { date: CRUMBLE.todayKey(), answer: 42, guesses: [] },       // not a string
  { date: CRUMBLE.todayKey(), guesses: [] },                   // no answer
]) {
  globalThis.localStorage.setItem("crumble-day6", JSON.stringify(bad));
  dailyGame();
  s = readSave();
  assert.equal(s.answer, CRUMBLE.answerFor(CRUMBLE.todayKey()),
    `invalid answer ${JSON.stringify(bad.answer)} replaced by the daily word`);
}
console.log("ok — next day + corrupt saves: stale/fake answers fall back fresh");

// ---------- 14. practice: forced word, random word, daily save untouched ---

const saveBeforePractice = globalThis.localStorage.getItem("crumble-day6");
const craneIdx = ANSWERS.indexOf("crane");
Math.random = () => (craneIdx + 0.5) / ANSWERS.length;

CRUMBLE.practice();
assert.equal(banner.textContent, "Practice round", "practice banner shown");
assert.equal(newBtn.textContent, "Today\u2019s puzzle", "button offers the way back");
assert.deepEqual(pileShape(), [[], [], [], [], []], "practice well fresh");
assert.equal(dump().answer, ANSWERS[craneIdx], "random word honors the Math.random stub");

const d = dump();
assert.ok(Array.isArray(d.pile), "dump exposes the pile");
assert.ok(Array.isArray(d.guesses), "dump exposes guesses");
assert.ok("save" in d, "dump carries the raw save");

CRUMBLE.practice("crane"); // forced word, the debugging backdoor
assert.equal(dump().answer, "crane", "forced practice word honored");
CRUMBLE.practice("qqqqq"); // invalid: falls back to random, still a word
assert.ok(DICT.has(dump().answer), "invalid forced word rejected");

assert.equal(globalThis.localStorage.getItem("crumble-day6"), saveBeforePractice,
  "practice never touches the daily save");

newBtn.click(); // back to today's puzzle
assert.equal(newBtn.textContent, "Practice", "button back to Practice");
assert.deepEqual(pileShape(), [[], [], [], [], []], "daily well fresh again");
assert.equal(ghosts.children.length, 40, "ghost grid cleared for the new game");
assert.ok(!well.classList.contains("done"), "the well reopens");
assert.ok(!giveUpBtn.classList.contains("hidden"), "give up back for the fresh daily");
console.log("ok — practice: forced + random words, no save writes, dump, round-trips to daily");

// ---------- 15. the deep win: a tall column, "Phew", no overflow ----------

seedDaily("crane");
// c-words whose remaining letters never touch r/a/n/e → each drops exactly
// one green into column 0 and nothing anywhere else
const tall = [...DICT].filter((w) => /^c[^rane][^rane][^rane][^rane]$/.test(w)).slice(0, 7);
assert.equal(tall.length, 7, `need seven c-first filler words, found ${tall.length}`);
for (const w of tall) typeRow(w);
assert.equal(pileCol(0).length, 7, "seven greens stacked in column 0");
assert.equal(dump().overflow, false, "seven of eight rows is still survivable");
for (const [ci, col] of dump().pile.entries()) {
  for (let r = 1; r < col.length; r++) {
    assert.ok(!(col[r].mark === "present" && col[r - 1].mark === "present"),
      "no yellow ever rests directly on a yellow");
  }
}
typeRow("crane");
// crane lands at the brim (base 7): its own c sinks to row 7, but row 0 is
// already c,r,a,n,e from the filler's bottom green — assembled win, one
// row from death, so the banner is a genuine "Phew".
assert.equal(banner.textContent, "Phew \u2014 8 guesses", "deep win is a Phew");
assert.equal(dump().won, true, "won despite topping out one row later");
console.log("ok — the deep win: 7-tall column, Phew for escaping by inches");

// ---------- 16. top out: pile reaching the well top is game over ----------

seedDaily("crane");
const eight = [...DICT].filter((w) => /^c[^rane][^rane][^rane][^rane]$/.test(w)).slice(0, 8);
assert.equal(eight.length, 8, `need eight c-first filler words, found ${eight.length}`);
for (const w of eight) typeRow(w);
assert.equal(pileCol(0).length, 8, "the column touches the top row");
assert.equal(dump().done, true, "topping out ends the game");
assert.equal(dump().won, false, "an overflow is not a win");
assert.equal(dump().overflow, true, "overflow flag set");
assert.equal(banner.textContent, "The well overflowed \u2014 the word was CRANE",
  "overflow banner names the word");
assert.ok(well.classList.contains("done"), "the well closes on overflow");
assert.ok(giveUpBtn.classList.contains("hidden"), "give up retires on overflow");
keydown("a");
assert.equal(dump().guesses.length, 8, "board locked after overflow");

shareBtn.classList.remove("hidden");
shareBtn.click();
const ota = createdEls.filter((e) => e.tagName === "textarea").pop();
assert.match(ota.value.split("\n")[0],
  /^Crumble · \d{4}-\d{2}-\d{2} · overflowed · 8 guesses$/,
  "overflow share tags the topping out");

dailyGame(); // refresh
assert.equal(dump().overflow, true, "overflow restored");
assert.equal(banner.textContent, "The well overflowed \u2014 the word was CRANE",
  "overflow banner restored");
assert.ok(well.classList.contains("done"), "restored well stays closed");
keydown("a");
assert.equal(dump().guesses.length, 8, "restored board stays locked");
console.log("ok — top out: pile to the brim overflows the well, saves, restores locked");

console.log("\nAll crumble tests passed.");
