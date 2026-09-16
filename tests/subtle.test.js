// Headless tests for js/subtle.js. Loads the real game script against a
// minimal DOM stub and drives full games through the keyboard handler.
// Run: node tests/subtle.test.js
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
    offsetWidth: 0,
    type: "",
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
const GAME_URL = "https://suitangi.github.io/30Wordles/days/2";

require(path.join(__dirname, "..", "js", "subtle.js"));
const SUBTLE = globalThis.SUBTLE;
assert.ok(SUBTLE, "subtle.js must expose window.SUBTLE");

const board = byId.board;
const banner = byId.banner;
const toast = byId.toast;
const newBtn = byId["new-btn"];
const giveUpBtn = byId["giveup-btn"];
const shareBtn = byId["share-btn"];
const keydown = (key) =>
  (windowHandlers.keydown || []).forEach((fn) =>
    fn({ key, metaKey: false, ctrlKey: false, altKey: false }));

// ---------- board map: row r = board.children[r], chip = children[5] ----------

const rowEl = (r) => board.children[r];
const tile = (r, c) => rowEl(r).children[c];
const chip = (r) => rowEl(r).children[5];
const keyFor = (letter) => {
  for (const row of byId.keyboard.children) {
    const k = row.children.find((b) => b.textContent === letter);
    if (k) return k;
  }
  return null;
};
// mirrors usedMix() in subtle.js: letter's share of all score earned -> tint
const mix = (sum, guesses) => (0.3 + 0.7 * (sum / (100 * guesses))).toFixed(4);
const readSave = () => JSON.parse(globalThis.localStorage.getItem("subtle-day2"));

function dailyGame() {
  SUBTLE.daily();
}

// Force today's daily puzzle to `answer` (optionally with guesses played).
function seedDaily(answer, guesses = []) {
  globalThis.localStorage.setItem("subtle-day2", JSON.stringify({
    date: SUBTLE.todayKey(), answer, guesses, done: false, won: false,
  }));
  dailyGame();
}

// Type a word into the active row and submit.
function typeRow(word) {
  for (const ch of word) keydown(ch);
  keydown("Enter");
  runTimers();
}

// Independent re-implementation of Bundle's salt for the salt test below.
function bundleAnswerFor(key) {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return ANSWERS[h % ANSWERS.length];
}

// ---------- 1. word list sanity ----------

assert.equal(ANSWERS.length, 2315, "answers count");
assert.equal(DICT.size, 14855, "guessable count");
for (const w of ANSWERS) {
  assert.match(w, /^[a-z]{5}$/, `answer "${w}" shape`);
  assert.ok(DICT.has(w), `answer "${w}" must be guessable`);
}
console.log("ok — word lists (2315 answers, 14855 guessable, answers ⊆ guesses)");

// ---------- 2. scoring ----------

const score = SUBTLE.scoreFor;
assert.equal(score("crane", "crane"), 100, "exact match scores 100");
assert.equal(score("crane", "hoist"), 0, "nothing shared scores 0");
assert.equal(score("crane", "brane"), 84, "one letter off, 4 greens: 84 (the ceiling)");
assert.equal(score("crane", "crank"), 84, "one substitution at the end: 84");
assert.equal(score("crane", "canoe"), 62, "2 greens, 2 astray, distance 2: 62");
assert.equal(score("crane", "brain"), 48, "2 greens, 1 astray, distance 3: 48");
assert.ok(score("crane", "brane") > score("crane", "canoe"),
  "sanity: closer words score higher");
for (const [a, b] of [["crane", "eerie"], ["slate", "crane"], ["crane", "slate"]]) {
  assert.equal(score(a, b), score(b, a), `score is symmetric for ${a}/${b}`);
}
const scale = new Set();
for (const g of DICT) {
  const s = score(g, "crane");
  assert.ok(s >= 0 && s <= 100, `score in range for "${g}"`);
  assert.equal(s === 100, g === "crane", `only the answer scores 100 ("${g}")`);
  scale.add(s);
}
assert.ok(scale.size >= 20, `plenty of scale: ${scale.size} distinct scores (want 20+)`);
console.log(`ok — scoring: exact=100, one-off=84 ceiling, ${scale.size} distinct values, symmetric, unique 100`);

// ---------- 3. daily salt: Subtle must not serve Bundle's word ----------

let differing = 0;
for (let i = 0; i < 200; i++) {
  const key = `2026-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`;
  if (SUBTLE.answerFor(key) !== bundleAnswerFor(key)) differing++;
}
assert.ok(differing > 150, `daily salt differs from Bundle (${differing}/200 dates)`);
console.log(`ok — daily salt: differs from Bundle on ${differing}/200 sampled dates`);

// ---------- 4. fresh daily: one active row, save seeded ----------

store.clear();
dailyGame();

assert.equal(board.children.length, 1, "a single waiting row");
assert.equal(rowEl(0).children.length, 6, "five tiles + a score chip");
for (let c = 0; c < 5; c++) {
  assert.equal(tile(0, c).textContent, "", `tile(0,${c}) starts empty`);
  assert.ok(tile(0, c).classList.contains("tile"), `tile(0,${c}) is a tile`);
}
assert.ok(rowEl(0).classList.contains("active"), "row 0 is the active row");
assert.equal(chip(0).textContent, "\u00B7", "chip shows its quiet placeholder");
assert.ok(chip(0).classList.contains("score"), "chip styled as score");
assert.ok(!giveUpBtn.classList.contains("hidden"), "give up offered on a fresh board");

const freshSave = readSave();
assert.equal(freshSave.date, SUBTLE.todayKey(), "save stamped with today");
assert.equal(freshSave.answer, SUBTLE.answerFor(SUBTLE.todayKey()), "daily answer is date-derived");
assert.deepEqual(freshSave.guesses, [], "no guesses yet");
assert.equal(freshSave.done, false, "not done");
console.log(`ok — fresh daily: ${freshSave.date}, word ${freshSave.answer}, one empty row`);

// ---------- 5. validation ----------

keydown("c"); keydown("r"); keydown("a"); keydown("t");
keydown("Enter");
runTimers();
assert.equal(toast.textContent, "Not enough letters");
assert.ok(tile(0, 0).classList.contains("shake"), "row shakes on invalid submit");

const BAD = ["qqqqq", "jjjjj", "vvvvv"].find((w) => !DICT.has(w));
assert.ok(BAD, "need an invalid 5-letter test word");
"crat".split("").forEach(() => keydown("Backspace"));
BAD.split("").forEach(keydown);
keydown("Enter");
runTimers();
assert.equal(toast.textContent, "Not in word list");
console.log(`ok — validation rejects short words and "${BAD}"`);

// ---------- 6. full winning game: scores settle, rows grow, share ----------

// Same board section 5 shook: the real submit must clear the leftover
// `shake` classes or they would swallow the settle animation.
const dailyAnswer = readSave().answer;
for (let i = 0; i < 5; i++) keydown("Backspace");
"crane".split("").forEach(keydown);
keydown("Enter");
for (let c = 0; c < 5; c++) {
  assert.ok(!tile(0, c).classList.contains("shake"), `tile(0,${c}) shake cleared on submit`);
}
runTimers();
assert.equal(chip(0).textContent, String(score("crane", dailyAnswer)),
  "unseeded daily guess settles its score");

seedDaily("crane");
const script = [["hoist", 0], ["canoe", 62], ["brane", 84]];
for (const [word, expected] of script) {
  typeRow(word);
  const r = board.children.length - 2; // the row just settled
  assert.equal(chip(r).textContent, String(expected), `chip(${r}) shows ${expected}`);
  assert.equal(chip(r).style["--w"], String(expected / 100), `chip(${r}) wash at ${expected}%`);
  assert.ok(rowEl(r).classList.contains("scored"), `row ${r} recedes as scored`);
  assert.ok(!rowEl(r).classList.contains("active"), `row ${r} no longer active`);
  for (let c = 0; c < 5; c++) {
    assert.ok(!tile(r, c).classList.contains("filled"), `scored tile(${r},${c}) drops filled`);
  }
  assert.equal(board.children.length, r + 2, "a fresh row waits below");
}
assert.equal(chip(board.children.length - 1).textContent, "\u00B7", "waiting chip placeholder");

// the pre-settle window: chip still quiet between submit and settle
keydown("c"); keydown("r"); keydown("a"); keydown("n"); keydown("e");
keydown("Enter");
assert.equal(chip(3).textContent, "\u00B7", "chip holds until the settle timer");
runTimers();

assert.equal(chip(3).textContent, "100", "winning chip reads 100");
assert.equal(chip(3).style["--w"], "1", "winning chip fully saturated");
assert.ok(rowEl(3).classList.contains("win"), "winning row glows");
assert.equal(board.children.length, 4, "no extra row after the win");
assert.equal(banner.textContent, "Splendid", "praise by guess count");
assert.ok(!shareBtn.classList.contains("hidden"), "share button appears on win");
assert.ok(giveUpBtn.classList.contains("hidden"), "give up retires on win");

const winSave = readSave();
assert.deepEqual(winSave.guesses, ["hoist", "canoe", "brane", "crane"], "guesses saved");
assert.equal(winSave.done, true, "save marked done");
assert.equal(winSave.won, true, "save marked won");

shareBtn.click();
const ta = createdEls.filter((e) => e.tagName === "textarea").pop();
assert.ok(ta, "share staged a clipboard textarea");
const lines = ta.value.split("\n");
assert.match(lines[0], /^Subtle · \d{4}-\d{2}-\d{2} · 4 guesses$/, "share shows date and count");
assert.equal(lines[1], GAME_URL, "share links to the game");
assert.equal(lines.length, 6, "header + link + one bar per guess");
assert.equal(lines[2], "░░░░░░░░░░ 0", "score 0 bar");
assert.equal(lines[3], "██████░░░░ 62", "score 62 bar");
assert.equal(lines[4], "████████░░ 84", "score 84 bar");
assert.equal(lines[5], "██████████ 100", "score 100 bar");

// finished board is locked
const frozen = tile(3, 0).textContent;
keydown("a");
keydown("Backspace");
assert.equal(tile(3, 0).textContent, frozen, "restored finished board is locked");
assert.equal(board.children.length, 4, "no new row after done");
console.log("ok — full win: scores settle, rows grow, share = " + lines[0]);

// ---------- 7. refresh mid-game: restore without animation, keep playing ----------

seedDaily("crane");
typeRow("hoist");
typeRow("canoe");
let s = readSave();
assert.deepEqual(s.guesses, ["hoist", "canoe"], "two guesses persisted");

dailyGame(); // simulates a page refresh
assert.equal(board.children.length, 3, "two scored rows + a waiting row");
for (let r = 0; r < 2; r++) {
  for (let c = 0; c < 5; c++) {
    assert.equal(tile(r, c).textContent, ["hoist", "canoe"][r][c], `restored tile(${r},${c})`);
  }
  assert.equal(chip(r).textContent, String(score(["hoist", "canoe"][r], "crane")),
    `restored chip(${r})`);
  assert.ok(!chip(r).classList.contains("settle"), "restored chips skip the settle animation");
  assert.ok(!rowEl(r).classList.contains("active"), "restored rows are scored, not active");
}
assert.ok(rowEl(2).classList.contains("active"), "row 2 waits for input");
assert.equal(chip(2).textContent, "\u00B7", "waiting chip restored");
assert.equal(keyFor("o").style["--m"], mix(62, 2),
  "keyboard tint rebuilt from restored guesses");

typeRow("brane");
assert.equal(chip(2).textContent, "84", "game continues after refresh");
for (let i = 0; i < 10; i++) keydown("Backspace");
typeRow("crane");
s = readSave();
assert.equal(s.done, true, "game completed after refresh");
assert.equal(s.won, true, "won after refresh");
assert.equal(banner.textContent, "Splendid", "praise after refreshed finish");
console.log("ok — refresh mid-game: board, chips and progress restored, play resumes");

// ---------- 8. refresh after finishing: completed board, frozen ----------

dailyGame();
assert.equal(board.children.length, 4, "finished board restored");
assert.equal(banner.textContent, "Splendid", "finished banner restored");
assert.ok(!shareBtn.classList.contains("hidden"), "share offered again");
keydown("a");
assert.equal(board.children.length, 4, "restored finished board is locked");
console.log("ok — refresh after finishing: completed board and lock restored");

// ---------- 9. next day: fresh puzzle ----------

s = readSave();
s.date = "1999-12-31";
globalThis.localStorage.setItem("subtle-day2", JSON.stringify(s));
dailyGame();

s = readSave();
assert.notEqual(s.date, "1999-12-31", "stale save replaced");
assert.equal(s.date, SUBTLE.todayKey(), "re-stamped with today");
assert.equal(s.answer, SUBTLE.answerFor(SUBTLE.todayKey()), "new day, new daily word");
assert.deepEqual(s.guesses, [], "guesses reset");
assert.equal(board.children.length, 1, "back to a single row");
assert.equal(chip(0).textContent, "\u00B7", "chip back to placeholder");
assert.equal(banner.textContent, "", "banner cleared");
console.log("ok — next day: fresh board and a new date-derived word");

// ---------- 10. practice mode: random word, daily save untouched ----------

const craneIdx = ANSWERS.indexOf("crane");
Math.random = () => (craneIdx + 0.5) / ANSWERS.length;
const saveBeforePractice = globalThis.localStorage.getItem("subtle-day2");

SUBTLE.practice();
assert.equal(banner.textContent, "Practice round", "practice banner shown");
assert.equal(newBtn.textContent, "Today\u2019s puzzle", "button offers the way back");
assert.equal(board.children.length, 1, "practice board fresh");
assert.equal(chip(0).textContent, "\u00B7", "practice chip placeholder");

typeRow("hoist");
typeRow("canoe");
assert.equal(globalThis.localStorage.getItem("subtle-day2"), saveBeforePractice,
  "practice guesses never touch the daily save");

shareBtn.classList.remove("hidden"); // share is reachable mid-practice via a win only;
shareBtn.click();                     // exercising the format with an unfinished board
const pta = createdEls.filter((e) => e.tagName === "textarea").pop();
assert.match(pta.value.split("\n")[0], /^Subtle · practice · 2 guesses$/,
  "practice share shows the practice tag");

giveUpBtn.click(); // giving up works in practice too
assert.equal(banner.textContent, "The word was CRANE", "practice give up reveals the answer");
assert.equal(globalThis.localStorage.getItem("subtle-day2"), saveBeforePractice,
  "practice give up never touches the daily save");

newBtn.click(); // back to today's puzzle
assert.equal(newBtn.textContent, "Practice", "button back to Practice");
assert.equal(banner.textContent, "", "daily board fresh again (was reset in section 9)");
assert.ok(!giveUpBtn.classList.contains("hidden"), "give up back for the fresh daily");
console.log("ok — practice mode: random word, no save writes, give up, round-trips to daily");

// ---------- 11. keyboard never colors — the score is the only feedback ----------

const keys = byId.keyboard.children.flatMap((row) => row.children);
assert.equal(keys.length, 28, "full keyboard built");
for (const k of keys) {
  for (const bad of ["correct", "present", "absent"]) {
    assert.ok(!k.classList.contains(bad), `key "${k.textContent}" stays neutral`);
  }
}
console.log("ok — keyboard stays neutral: no greens, no yellows, anywhere");

// ---------- 12. keyboard tints with the average score letters earned ----------

seedDaily("crane");
assert.equal(keyFor("z").style["--m"], "0.0000", "unused keys stay untinted");

typeRow("hoist"); // scores 0 — used, but earned nothing
for (const L of "hoist") {
  assert.equal(keyFor(L).style["--m"], mix(0, 1),
    `used letter "${L}" shows the minimum tint`);
}

typeRow("canoe"); // scores 62: c,a,n,e earn it, o carries 0+62 — same share
assert.equal(keyFor("o").style["--m"], mix(62, 2), "'o' tints by its share of all score");
assert.equal(keyFor("c").style["--m"], mix(62, 2), "'c' tints by its share of all score");
assert.ok(parseFloat(keyFor("o").style["--m"]) > parseFloat(keyFor("h").style["--m"]),
  "a letter with earned score tints stronger than a zero-score letter");

dailyGame(); // refresh: tint rebuilt from the save, unchanged
assert.equal(keyFor("o").style["--m"], mix(62, 2), "tint survives a refresh");

newBtn.click(); // practice: a fresh board clears the tints
assert.equal(keyFor("o").style["--m"], "0.0000", "practice starts untinted");
newBtn.click(); // and back to the daily
console.log("ok — keyboard tint: unused plain, used ≥ floor, scales with earned share, restores");

// ---------- 13. give up: the loss path ----------

seedDaily("crane");
typeRow("hoist");
giveUpBtn.click();
assert.equal(banner.textContent, "The word was CRANE", "give up reveals the answer");
assert.ok(giveUpBtn.classList.contains("hidden"), "give up retires after use");
assert.ok(!shareBtn.classList.contains("hidden"), "share offered after give up");
const gaveUp = readSave();
assert.equal(gaveUp.done, true, "give up saved done");
assert.equal(gaveUp.won, false, "give up saved not won");
assert.deepEqual(gaveUp.guesses, ["hoist"], "guesses kept in the save");
assert.equal(board.children.length, 1, "the waiting row goes with it");
keydown("a");
assert.equal(board.children.length, 1, "board locked after give up");

shareBtn.click();
const gta = createdEls.filter((e) => e.tagName === "textarea").pop();
assert.match(gta.value.split("\n")[0], /^Subtle · \d{4}-\d{2}-\d{2} · gave up · 1 guess$/,
  "give-up share tags the surrender");

dailyGame(); // refresh
assert.equal(board.children.length, 1, "given-up board restored");
assert.ok(rowEl(0).classList.contains("scored"), "restored row scored");
assert.equal(chip(0).textContent, "0", "restored chip");
assert.equal(banner.textContent, "The word was CRANE", "loss banner restored");
assert.ok(giveUpBtn.classList.contains("hidden"), "give up stays retired");
assert.ok(!shareBtn.classList.contains("hidden"), "share still offered");
keydown("a");
assert.equal(board.children.length, 1, "restored board stays locked");
console.log("ok — give up: reveals answer, saves the loss, restores locked");

// ---------- 13. a long game: ten guesses, persistence, praise past six ----------

seedDaily("eerie");
board.scrollHeight = 2000; // fake layout: board overflows
board.clientHeight = 300;
const filler = [...DICT].filter((w) => w !== "eerie").slice(0, 9);
for (const w of filler) typeRow(w);
assert.ok(board.classList.contains("overflowing"), "overflow fade switches on");
assert.equal(board.scrollTop, 2000, "board auto-scrolls to the active row");
assert.equal(board.children.length, 10, "nine scored rows + active row");

typeRow("eerie");
assert.equal(banner.textContent, "Got there", "praise past six guesses");
assert.equal(chip(9).textContent, "100", "tenth chip reads 100");
const longSave = readSave();
assert.equal(longSave.guesses.length, 10, "all ten guesses saved");
assert.equal(longSave.done, true, "long game saved done");

board.scrollHeight = 0; // reset fake layout
dailyGame();
assert.equal(board.children.length, 10, "long board restored");
for (let r = 0; r < 10; r++) {
  assert.ok(rowEl(r).classList.contains("scored"), `restored row ${r} scored`);
}
assert.equal(chip(9).textContent, "100", "restored winning chip");
assert.equal(banner.textContent, "Got there", "restored banner");
console.log("ok — long game: ten guesses persist, restore, praise holds");

console.log("\nAll subtle tests passed.");
