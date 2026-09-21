// Headless tests for js/swivel.js. Loads the real game script against a
// minimal DOM stub and drives full games through the keyboard handler.
// Run: node tests/swivel.test.js
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
["board", "pivot", "keyboard", "banner", "toast",
  "new-btn", "giveup-btn", "turn-btn", "share-btn"].forEach((id) => {
  byId[id] = makeEl("div");
});
const createdEls = [];

globalThis.window = globalThis;
const windowHandlers = {};
globalThis.addEventListener = (t, fn) => { (windowHandlers[t] ||= []).push(fn); };
globalThis.document = {
  documentElement: { dataset: {}, clientWidth: 1200 },
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
const GAME_URL = "https://suitangi.github.io/30Wordles/days/8";

require(path.join(__dirname, "..", "js", "swivel.js"));
const SWIVEL = globalThis.SWIVEL;
assert.ok(SWIVEL, "swivel.js must expose window.SWIVEL");

const board = byId.board;
const pivot = byId.pivot;
const banner = byId.banner;
const toast = byId.toast;
const newBtn = byId["new-btn"];
const giveUpBtn = byId["giveup-btn"];
const turnBtn = byId["turn-btn"];
const shareBtn = byId["share-btn"];
const keydown = (key) =>
  (windowHandlers.keydown || []).forEach((fn) =>
    fn({ key, metaKey: false, ctrlKey: false, altKey: false }));

// ---------- board map ----------
// Grid (0-based): main guess g, letter c -> cell(g, c). Horizontal column
// k, word-letter i -> cell(5 - i, k) — word order climbs the column.
// Cells (1..5, 0..4) are the 25 duo tiles; row 0 cols 0-4 are main-only;
// cols 5-7 rows 1-5 are horizontal-only; (0, 5..7) belong to no board.

const cell = (r, c) => SWIVEL.cell(r, c);
const duoGlyph = (g, c) => cell(g, c).children[0].textContent; // shared letter
const hLetter = (k, i) => cell(5 - i, k).children[0].textContent; // s-tiles only
const keyFor = (letter) => {
  for (const row of byId.keyboard.children) {
    const k = row.children.find((b) => b.textContent === letter);
    if (k) return k;
  }
  return null;
};
const readSave = () => JSON.parse(globalThis.localStorage.getItem("swivel-day8"));

// ---------- independent spec ----------

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

// The transpose spec: horizontal column k (word order) = main guesses
// #6..#2's k-th letters.
function transposeWord(main, k) {
  return [main[5][k], main[4][k], main[3][k], main[2][k], main[1][k]].join("");
}

function typeRow(word) {
  for (const ch of word) keydown(ch);
  keydown("Enter");
  runTimers();
}

function dailyGame() { SWIVEL.daily(); }

function seedDaily(main, second, flags = {}) {
  globalThis.localStorage.setItem("swivel-day8", JSON.stringify({
    date: SWIVEL.todayKey(),
    answers: ["crane", "cramp"],
    main,
    second,
    swiveled: !!flags.swiveled,
    done: !!flags.done,
    won: !!flags.won,
    gaveUp: !!flags.gaveUp,
  }));
  dailyGame();
}

function assertMainCell(g, c, letter, acrossMark, msg) {
  const t = cell(g, c);
  assert.equal(t.children[0].textContent, letter, `cell(${g},${c}) letter`);
  const d = SWIVEL.dump();
  if (g === 0 || !d.swiveled) {
    // upright: every main-board tile shows its across-clue
    assert.ok(t.classList.contains(acrossMark),
      `cell(${g},${c}) shows ${acrossMark} ${msg || ""}`);
  } else {
    // swiveled: the tile's letter scored vs the horizontal answer at its
    // own spot in the word (word position 5-g)
    const ch = d.main[g][c];
    const hMark = ch === d.answers[1][5 - g] ? "correct"
      : (d.answers[1].includes(ch) ? "present" : "absent");
    assert.ok(t.classList.contains(hMark),
      `cell(${g},${c}) shows down-clue ${hMark} ${msg || ""}`);
  }
}

function assertFreshCell(k, i, letter, mark, msg) {
  const t = cell(5 - i, k);
  assert.equal(t.children[0].textContent, letter, `hCell(${k},${i}) letter`);
  if (SWIVEL.dump().swiveled) {
    assert.ok(t.classList.contains(mark), `hCell(${k},${i}) shows ${mark} ${msg || ""}`);
  } else {
    // upright: the fresh columns are horizontal territory — colorless
    assert.ok(!t.classList.contains("correct") && !t.classList.contains("present")
      && !t.classList.contains("absent"),
      `hCell(${k},${i}) colorless upright ${msg || ""}`);
  }
}

// ---------- 1. word list sanity ----------

assert.equal(ANSWERS.length, 2315, "answers count");
assert.equal(DICT.size, 14855, "guessable count");
for (const w of ANSWERS) {
  assert.match(w, /^[a-z]{5}$/, `answer "${w}" shape`);
  assert.ok(DICT.has(w), `answer "${w}" must be guessable`);
}
console.log("ok — word lists (2315 answers, 14855 guessable, answers ⊆ guesses)");

// ---------- 2. evaluate: standard Wordle two-pass, duplicates included ----------

const ev = SWIVEL.evaluate;
assert.deepEqual(ev("crane", "crane"), ["correct", "correct", "correct", "correct", "correct"], "exact match");
assert.deepEqual(ev("crane", "brane"), ["absent", "correct", "correct", "correct", "correct"], "one letter off");
assert.deepEqual(ev("speed", "abode"), ["absent", "absent", "present", "absent", "present"],
  "duplicate guess letters consume target letters once each");
assert.deepEqual(ev("eerie", "erase"), ["correct", "absent", "present", "absent", "correct"],
  "repeated letters: greens first, strays consume target copies in order");
console.log("ok — evaluate: two-pass, duplicates handled");

// ---------- 3. daily pair: deterministic, distinct, salted away from 1-7 ----------

function saltHash(s) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}
const otherSalts = ["bundle", "subtle", "wobble", "toggle", "meddle", "crumble", "bubble"]
  .map((salt) => (key) => ANSWERS[saltHash(salt + key) % ANSWERS.length]);

let clear = 0;
for (let i = 0; i < 200; i++) {
  const key = `2026-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`;
  const pair = SWIVEL.answersFor(key);
  assert.deepEqual(pair, SWIVEL.answersFor(key), "answersFor is deterministic");
  assert.notEqual(pair[0], pair[1], `pair is distinct for ${key}`);
  assert.ok(DICT.has(pair[0]) && DICT.has(pair[1]), "pair is guessable");
  if (otherSalts.every((ansFor) => ansFor(key) !== pair[0] && ansFor(key) !== pair[1])) clear++;
}
assert.ok(clear > 185, `pair avoids every earlier day's word (${clear}/200 dates)`);
console.log(`ok — daily pair: deterministic, distinct, salt-differ from days 1-7 (${clear}/200)`);

// ---------- 4. fresh daily: the L, sketched in ghosts ----------

store.clear();
dailyGame();

let cellCount = 0;
let duoCount = 0;
let ghostCount = 0;
for (let r = 0; r < 6; r++) {
  for (let c = 0; c < 8; c++) {
    const el = cell(r, c);
    if (!el) continue;
    cellCount++;
    if (el.classList.contains("ghost")) ghostCount++;
    if (el.classList.contains("duo")) duoCount++;
  }
}
assert.equal(cellCount, 45, "45 cells: 6x8 minus the three slots above the horizontal board");
assert.equal(duoCount, 25, "exactly 25 crossing tiles");
assert.equal(ghostCount, 45, "every cell starts a ghost outline");
assert.equal(cell(0, 5), null, "no board above-right of the main board's first row");
const dividerM = board.children.find((el) => el.classList.contains("divider-m"));
const dividerH = board.children.find((el) => el.classList.contains("divider-h"));
assert.ok(dividerM && dividerH, "a dotted divider per view, both present on the board");
assert.ok(cell(0, 0) && !cell(0, 0).classList.contains("duo"), "main guess 1 is main-board-only");
assert.ok(duo(1, 0) && duo(5, 4), "the overlap spans main guesses 2-6");
for (let k = 5; k < 8; k++) {
  assert.ok(cell(1, k) && !cell(1, k).classList.contains("duo"),
    `horizontal-only column ${k + 1}`);
}
assert.ok(!giveUpBtn.classList.contains("hidden"), "give up offered on a fresh board");
assert.ok(shareBtn.classList.contains("hidden"), "no share before an end state");
assert.equal(banner.textContent, "Two words to find", "fresh board announces its progress");

const freshSave = readSave();
assert.deepEqual(freshSave.answers, SWIVEL.answersFor(SWIVEL.todayKey()), "daily pair is date-derived");
assert.deepEqual(freshSave.main, [], "no main guesses yet");
assert.deepEqual(freshSave.second, [], "no second guesses yet");
console.log(`ok — fresh daily: ${freshSave.date}, words ${freshSave.answers.join("/")} — 45 ghosts, 25 of them shared`);

function duo(g, c) { return cell(g, c); }

// ---------- 5. typing lands once, on the shared tile ----------

SWIVEL.practice("crane", "cramp");
assert.equal(banner.textContent, "Practice round", "practice banner shown");

keydown("p"); keydown("o"); keydown("u");
assert.equal(cell(0, 0).children[0].textContent, "p", "row 1 types onto the plain main tile");
keydown("Backspace"); keydown("Backspace"); keydown("Backspace");

typeRow("brain"); // main guess 1: the unshared heel
assertMainCell(0, 0, "b", "absent", "(brain vs crane)");
assertMainCell(0, 1, "r", "correct", "(brain vs crane)");
assertMainCell(0, 4, "n", "present", "(brain vs crane)");
assert.ok(cell(0, 0).classList.contains("absent"), "row-1 tiles color the whole tile");

keydown("p"); keydown("o"); keydown("u");
assert.equal(duoGlyph(1, 0), "p", "row 2's letter lands on the shared tile's glyph");
assert.ok(duo(1, 0).classList.contains("filled"), "shared tile filled");
assert.equal(duo(1, 0).children.length, 1, "the shared tile carries just the glyph span");
keydown("Backspace");
assert.equal(duoGlyph(1, 2), "", "backspace clears the last shared glyph");
keydown("Backspace"); keydown("Backspace");
assert.equal(duoGlyph(1, 0), "", "backspace clears the shared glyph");

const BAD = ["qqqqq", "jjjjj", "vvvvv"].find((w) => !DICT.has(w));
"pou".split("").forEach(() => keydown("Backspace"));
BAD.split("").forEach(keydown);
keydown("Enter");
runTimers();
assert.equal(toast.textContent, "Not in word list", "non-word rejected");
BAD.split("").forEach(() => keydown("Backspace"));
console.log(`ok — typing lands once on the shared tiles; validation rejects "${BAD}"`);

// ---------- 6. the sixth main word completes and scores the transpose ----------

for (const w of ["pouty", "mirth", "alarm", "rider"]) typeRow(w);
typeRow("crane"); // sixth row: solves the main word AND completes the columns

const main = ["brain", "pouty", "mirth", "alarm", "rider", "crane"];
const dump = SWIVEL.dump();
assert.ok(dump.hRevealed, "the sixth word reveals the shared columns");
assert.deepEqual(dump.hWords.slice(0, 5), [0, 1, 2, 3, 4].map((k) => transposeWord(main, k)),
  "horizontal columns 1-5 are the main board's columns, word order bottom-up");
assert.equal(dump.hWords[0], "cramp", "column 1's transpose spells the horizontal answer exactly");

// every duo: shared glyph = the main letter, across-clue on the tile
// (upright view), the scored pulse marking the reveal
for (let g = 1; g <= 5; g++) {
  for (let c = 0; c < 5; c++) {
    assert.equal(duoGlyph(g, c), main[g][c], `duo(${g},${c}) glyph`);
    assert.ok(cell(g, c).classList.contains(evalWord(main[g], "crane")[c]),
      `duo(${g},${c}) across clue vs crane`);
    assert.ok(duo(g, c).classList.contains("scored"), `duo(${g},${c}) scored pulse`);
  }
}
// the transpose that spells the answer finds it: both words, done at six
assert.equal(banner.textContent, "Phew \u2014 both words in 6", "transpose found the horizontal word: win at 6");
assert.ok(dump.foundM && dump.foundS && dump.done && dump.won, "both flags at the sixth word");
assert.ok(!pivot.classList.contains("swiveled"), "won before the swivel — the view never turned");
for (let i = 0; i < 5; i++) assert.ok(cell(5 - i, 0).classList.contains("win-glow"), "found column glows");

// swivel: the shared tiles flip from main clues to horizontal clues and
// every glyph counter-rotates to face up; swivel back restores the view.
// Down-clues are per-tile: the letter vs cramp at the tile's word
// position (5-g) — column 1 spells cramp, so it goes all green.
const downClue = (g, c) => {
  const ch = main[g][c];
  return ch === "cramp"[5 - g] ? "correct"
    : ("cramp".includes(ch) ? "present" : "absent");
};
turnBtn.click();
assert.ok(pivot.classList.contains("swiveled"), "view swiveled");
for (let g = 1; g <= 5; g++) {
  for (let c = 0; c < 5; c++) {
    assert.ok(cell(g, c).classList.contains(downClue(g, c)),
      `duo(${g},${c}) shows the down-clue swiveled`);
  }
}
assert.equal(dump.hWords[0], "cramp", "column 1 read for the down-clues");
for (let c = 0; c < 5; c++) {
  assert.ok(!cell(0, c).classList.contains("correct") && !cell(0, c).classList.contains("present")
    && !cell(0, c).classList.contains("absent"),
    `heel tile (${c}) colorless swiveled — it clues only the main word`);
}
turnBtn.click();
assert.ok(!pivot.classList.contains("swiveled"), "swiveled back");
for (let g = 1; g <= 5; g++) {
  for (let c = 0; c < 5; c++) {
    assert.ok(cell(g, c).classList.contains(evalWord(main[g], "crane")[c]),
      `duo(${g},${c}) back to the across-clue`);
  }
}
console.log("ok — sixth word completes the transpose; the crossing tiles follow the view");

// ---------- 7. the keyboard follows the view too ----------

// upright: the main wordle's clues only
assert.ok(keyFor("c").classList.contains("correct"), "c green (crane row)");
assert.ok(keyFor("r").classList.contains("correct"), "r green");
assert.ok(keyFor("m").classList.contains("absent"), "m gray upright (mirth vs crane)");
assert.ok(keyFor("p").classList.contains("absent"), "p gray upright (pouty vs crane)");
// swiveled: the horizontal wordle's clues take over — the found column
// lights every key of cramp green, and row 1's main-only letters drop out
turnBtn.click();
for (const ch of "cramp") {
  assert.ok(keyFor(ch).classList.contains("correct"), `${ch} green swiveled (column 1 = cramp)`);
}
assert.ok(!keyFor("b").classList.contains("absent") &&
  !keyFor("b").classList.contains("present") &&
  !keyFor("b").classList.contains("correct"),
  "b unpainted swiveled — brain is row 1, main-board-only");
turnBtn.click();
assert.ok(keyFor("c").classList.contains("correct"), "back upright: c green");
assert.ok(keyFor("m").classList.contains("absent"), "back upright: m gray again");
console.log("ok — keyboard flips with the view: main clues upright, horizontal clues swiveled");

// ---------- 8. share: main rows, then the scored columns ----------

shareBtn.classList.remove("hidden");
shareBtn.click();
const ta = createdEls.filter((e) => e.tagName === "textarea").pop();
assert.ok(ta, "share staged a clipboard textarea");
const lines = ta.value.split("\n");
assert.equal(lines[0], "Swivel · practice · 6/9", "practice share header counts 6 of 9");
assert.equal(lines[1], GAME_URL, "share links to the game");
assert.equal(lines.length, 2 + 6 + 1 + 5, "header + link + 6 main rows + gap + 5 scored columns");
assert.equal(lines[2], "\u2B1C\uD83D\uDFE9\uD83D\uDFE9\u2B1C\uD83D\uDFE8", "brain row vs crane");
assert.equal(lines[7], "\uD83D\uDFE9".repeat(5), "crane row vs crane");
assert.equal(lines[8], "", "the blank line separates the boards");
assert.equal(lines[9], "\uD83D\uDFE9".repeat(5), "column 1 = cramp, all green");
assert.equal(lines[10], evalWord(transposeWord(main, 1), "cramp").map((m) =>
  ({ correct: "\uD83D\uDFE9", present: "\uD83D\uDFE8", absent: "\u2B1C" }[m])).join(""),
  "column 2's transpose row");
console.log("ok — share: main rows, gap, transpose columns, header N/9");

// ---------- 9. phase 2: fresh words climb the open columns ----------

SWIVEL.practice("crane", "cramp");
for (const w of ["brain", "cloud", "dwarf", "eager", "flint", "ghost"]) typeRow(w);
assert.ok(SWIVEL.dump().swiveled, "six main rows used: auto-swivel");
assert.ok(pivot.classList.contains("swiveled"), "the view rotated for the horizontal board");
assert.equal(banner.textContent, "Main board full \u2014 swiveled to the horizontal word",
  "swivel announced");
assert.ok(!SWIVEL.dump().foundS, "no lucky transpose this time");
assert.ok(!SWIVEL.dump().foundM, "the main word still hides");
// swiveled: the shared tiles flipped to the horizontal wordle's clues
assert.ok(cell(5, 0).classList.contains("absent"), "g of gfedc: absent vs cramp");
assert.ok(cell(1, 0).classList.contains("present"), "c of gfedc: present vs cramp");
assert.ok(cell(1, 0).classList.contains("scored"), "the crossing block pulsed");
for (let c = 0; c < 5; c++) {
  assert.ok(!cell(0, c).classList.contains("correct") && !cell(0, c).classList.contains("present")
    && !cell(0, c).classList.contains("absent"),
    `heel tile (${c}) colorless swiveled`);
}

keydown("c"); keydown("r"); keydown("a");
assert.equal(hLetter(5, 0), "c", "fresh letters climb from the column's bottom");
assert.equal(hLetter(5, 1), "r", "letter 2 above it");
assert.equal(hLetter(5, 2), "a", "letter 3 above that");
keydown("Backspace");
assert.equal(hLetter(5, 2), "", "backspace clears from the top");
keydown("Backspace"); keydown("Backspace");
typeRow("cramp"); // a clean full column: c,r,a,m,p
assert.ok(SWIVEL.dump().foundS, "fresh column finds the horizontal word");
assert.ok(SWIVEL.dump().done && !SWIVEL.dump().won,
  "the main board is already lost: the find ends the game at once");
assert.equal(banner.textContent, "Horizontal word down \u2014 the main word was CRANE",
  "the split end names the survivor");
for (let i = 0; i < 5; i++) assertFreshCell(5, i, "cramp"[i], "correct", "(cramp vs cramp)");
shareBtn.click();
const s9ta = createdEls.filter((e) => e.tagName === "textarea").pop();
assert.equal(s9ta.value.split("\n")[0], "Swivel · practice · horizontal only · X/9",
  "share tags a horizontal-only finish");
console.log("ok — phase 2: fresh columns climb bottom-up; a late horizontal find ends the split game");

// ---------- 10. a main guess never finds the horizontal word ----------

SWIVEL.practice("crane", "brain");
typeRow("brain"); // typed across — main rows only ever hunt the main word
assert.ok(!SWIVEL.dump().foundS, "the horizontal answer does not land from the main board");
assert.ok(!SWIVEL.dump().foundM, "and brain is not the main word");
assert.equal(banner.textContent, "Practice round", "no find banner for a non-find");
typeRow("crane");
assert.ok(SWIVEL.dump().foundM && !SWIVEL.dump().foundS,
  "the main word lands on its own board");
assert.equal(banner.textContent, "Main word down \u2014 one to go", "progress banner");
assert.equal(duoGlyph(1, 0), "c", "row 2's shared glyph");
assert.ok(duo(1, 0).classList.contains("correct"),
  "upright shared tile shows the main wordle's clue");
console.log("ok — a guess only finds its own board's word; unscored crossing tiles stay whole-color");

// ---------- 11. early find: fillers, then swivel to the horizontal board ----------

SWIVEL.practice("crane", "cramp");
typeRow("crane");
assert.equal(banner.textContent, "Main word down \u2014 one to go",
  "early find offers the choice");
assert.ok(!SWIVEL.dump().swiveled,
  "no auto-swivel on an early find — only when all six main rows are used");

typeRow("shade");
assertMainCell(1, 0, "s", "absent", "(shade vs crane)");
assertMainCell(1, 2, "a", "correct", "(shade vs crane)");

turnBtn.click();
assert.ok(SWIVEL.dump().swiveled, "swiveling moves input to the horizontal board");
assert.ok(pivot.classList.contains("swiveled"), "and swivels the view clockwise");
// the columns haven't completed, but the down-clues are per-tile: they
// show as soon as each letter lands
assert.ok(duo(1, 2).classList.contains("present"),
  "a of shade: present vs cramp swiveled");

typeRow("cramp");
assert.equal(banner.textContent, "Impressive \u2014 both words in 3", "win after the skip");
for (let i = 0; i < 5; i++) assertFreshCell(5, i, "cramp"[i], "correct", "(first open column)");

// swiveling back upright mutes the horizontal board's tiles — the fresh
// columns included — and brings the main clues back
turnBtn.click();
assert.ok(!SWIVEL.dump().swiveled, "swiveled back upright");
for (let i = 0; i < 5; i++) assertFreshCell(5, i, "cramp"[i], "correct", "(colorless upright)");
assertMainCell(0, 0, "c", "correct", "(across clue restored)");
turnBtn.click();
for (let i = 0; i < 5; i++) assertFreshCell(5, i, "cramp"[i], "correct", "(colors return swiveled)");
console.log("ok — early find: spare rows stay fillable, swiveling hands input to the horizontal board");

// ---------- 12. three fresh misses: the loss ----------

SWIVEL.practice("crane", "cramp");
for (const w of ["brain", "cloud", "dwarf", "eager", "flint", "ghost"]) typeRow(w);
for (const w of ["house", "index", "ropes"]) {
  assert.ok(DICT.has(w), `loss-test word "${w}" is guessable`);
  typeRow(w);
}
assert.ok(SWIVEL.dump().done && !SWIVEL.dump().won, "three fresh misses end the game");
assert.equal(banner.textContent, "The words were CRANE & CRAMP", "loss reveals both words");
assert.ok(!shareBtn.classList.contains("hidden"), "share offered after the loss");
const before = JSON.stringify(SWIVEL.dump().main) + JSON.stringify(SWIVEL.dump().second);
keydown("q"); keydown("Enter");
assert.equal(JSON.stringify(SWIVEL.dump().main) + JSON.stringify(SWIVEL.dump().second),
  before, "board locked after the loss");
console.log("ok — the fresh-columns loss: words revealed, board locked");

// ---------- 13. give up ----------

SWIVEL.practice("crane", "cramp");
typeRow("brain");
giveUpBtn.click();
assert.equal(banner.textContent, "The words were CRANE & CRAMP", "give up reveals both");
assert.ok(giveUpBtn.classList.contains("hidden"), "give up retires after use");
assert.ok(!shareBtn.classList.contains("hidden"), "share offered after give up");
keydown("a");
assert.equal(SWIVEL.dump().main.length, 1, "board locked after give up");

shareBtn.click();
const gta = createdEls.filter((e) => e.tagName === "textarea").pop();
assert.equal(gta.value.split("\n")[0], "Swivel · practice · gave up · X/9",
  "give-up share tags the surrender");
console.log("ok — give up: the loss path with its own share tag");

// ---------- 13b. split outcomes: one word down, the other lost ----------

// horizontal won, main lost
SWIVEL.practice("crane", "cramp");
for (const w of ["brain", "cloud", "dwarf", "eager", "flint", "ghost"]) typeRow(w);
assert.ok(!SWIVEL.dump().foundM && !SWIVEL.dump().foundS, "nothing found yet");
typeRow("cramp"); // the horizontal answer, landed swiveled — the main board is already lost
assert.ok(SWIVEL.dump().done && !SWIVEL.dump().won,
  "finding the horizontal word on a lost main board ends it at once");
assert.equal(banner.textContent,
  "Horizontal word down \u2014 the main word was CRANE", "split loss names the survivor");
shareBtn.click();
const sta = createdEls.filter((e) => e.tagName === "textarea").pop();
assert.equal(sta.value.split("\n")[0], "Swivel · practice · horizontal only · X/9",
  "share tags a horizontal-only finish");

// main won, horizontal lost
SWIVEL.practice("crane", "cramp");
typeRow("crane");
for (const w of ["cloud", "dwarf", "eager", "flint", "ghost"]) typeRow(w);
assert.ok(SWIVEL.dump().foundM && !SWIVEL.dump().foundS, "main found early");
for (const w of ["house", "index", "ropes"]) typeRow(w);
assert.ok(SWIVEL.dump().done && !SWIVEL.dump().won, "out of columns: the horizontal word never landed");
assert.equal(banner.textContent,
  "Main word down \u2014 the horizontal word was CRAMP", "split loss names the survivor");
shareBtn.click();
const mta = createdEls.filter((e) => e.tagName === "textarea").pop();
assert.equal(mta.value.split("\n")[0], "Swivel · practice · main only · X/9",
  "share tags a main-only finish");

// give up with one word down keeps the split tag too
SWIVEL.practice("crane", "cramp");
typeRow("crane");
giveUpBtn.click();
assert.equal(banner.textContent, "Main word down \u2014 the horizontal word was CRAMP",
  "give-up banner names the split");
shareBtn.click();
const gta2 = createdEls.filter((e) => e.tagName === "textarea").pop();
assert.equal(gta2.value.split("\n")[0], "Swivel · practice · gave up · main only · X/9",
  "give-up share carries the split tag");
console.log("ok — split outcomes: horizontal-only, main-only, and give-up all named");

// ---------- 13c. columns spent early: the main rows stay live ----------

// burning all three fresh columns before the main board fills leaves the
// main word findable — the game hands input back to the main board
SWIVEL.practice("crane", "cramp");
typeRow("brain");
turnBtn.click();
for (const w of ["house", "index", "ropes"]) typeRow(w);
assert.ok(!SWIVEL.dump().done, "spent columns with main rows open: the game continues");
assert.ok(!SWIVEL.dump().swiveled, "auto-swiveled back to the main board");
assert.equal(banner.textContent, "Horizontal board full \u2014 back to the main word",
  "the swivel-back is announced");
typeRow("cloud");
assert.equal(SWIVEL.dump().main.length, 2, "typing resumes on the main board");
// with the columns gone the main word can only split the game, not win it
typeRow("crane");
assert.ok(SWIVEL.dump().done && !SWIVEL.dump().won, "main found late: a main-only finish");
assert.equal(banner.textContent, "Main word down \u2014 the horizontal word was CRAMP",
  "split banner");
shareBtn.click();
const cta = createdEls.filter((e) => e.tagName === "textarea").pop();
assert.equal(cta.value.split("\n")[0], "Swivel · practice · main only · X/9",
  "share tags a main-only finish");

// swiveling onto spent columns by hand refuses typing instead of crashing
SWIVEL.practice("crane", "cramp");
typeRow("brain");
turnBtn.click();
for (const w of ["house", "index", "ropes"]) typeRow(w);
assert.ok(!SWIVEL.dump().done, "still live after the swivel-back");
turnBtn.click(); // back onto the full horizontal board, by hand
keydown("q");
assert.equal(toast.textContent, "The horizontal board is full \u2014 swivel back to the main word",
  "a spent horizontal board declines typing with a pointer back");
turnBtn.click();
typeRow("crane");
assert.ok(SWIVEL.dump().done && !SWIVEL.dump().won, "and the game still finishes normally");
console.log("ok — spent columns swivel back to the live main board; the guard covers the manual way too");

// ---------- 14. restore mid-game, phase 1 ----------

seedDaily(["brain"], []);
dailyGame();
assertMainCell(0, 0, "b", "absent", "(restored vs crane)");
assert.ok(!cell(0, 0).classList.contains("reveal"), "restored tiles paint resolved, no flip replayed");
assert.ok(!pivot.classList.contains("swiveled"), "phase-1 restore keeps the view upright");
assert.equal(banner.textContent, "Two words to find", "progress banner restored");
assert.ok(keyFor("r").classList.contains("correct"), "keyboard repaints");

typeRow("crane");
assert.equal(banner.textContent, "Main word down \u2014 one to go",
  "early find works after a refresh");
assert.ok(cell(1, 0).classList.contains("reveal"), "play after a refresh still flips");
assertMainCell(1, 0, "c", "correct", "(crane vs crane)");

turnBtn.click();
typeRow("cramp"); // landed swiveled, on the first open column
assert.equal(banner.textContent, "Impressive \u2014 both words in 3", "win after a refresh");
let s = readSave();
assert.deepEqual(s.main, ["brain", "crane"], "main guesses persisted");
assert.deepEqual(s.second, ["cramp"], "the horizontal guess persisted as a column");
assert.equal(s.done, true, "done saved");
assert.equal(s.won, true, "won saved");
console.log("ok — restore mid-game (phase 1): marks, quiet tiles, live flips after");

// ---------- 15. restore with the transpose revealed ----------

const six = ["brain", "cloud", "dwarf", "eager", "flint", "ghost"];
seedDaily(six, [], { swiveled: true });
dailyGame();
assert.ok(SWIVEL.dump().hRevealed, "transpose state restored");
assert.ok(pivot.classList.contains("swiveled"), "phase-2 restore resumes swiveled");
assert.equal(banner.textContent, "Swiveled \u2014 finish the horizontal word", "swivel banner restored");
for (let g = 1; g <= 5; g++) {
  for (let c = 0; c < 5; c++) {
    assert.equal(duoGlyph(g, c), six[g][c], `restored duo(${g},${c}) glyph`);
    const ch = six[g][c];
    const hMark = ch === "cramp"[5 - g] ? "correct"
      : ("cramp".includes(ch) ? "present" : "absent");
    assert.ok(cell(g, c).classList.contains(hMark),
      `restored duo(${g},${c}) shows the down-clue swiveled`);
  }
}
assert.ok(!cell(1, 5).classList.contains("reveal"), "restored tiles paint resolved, no flip replayed");
assert.ok(keyFor("g").classList.contains("absent"), "keyboard heard the transpose (g gray everywhere)");
assert.ok(keyFor("c").classList.contains("present"), "c present swiveled (closing letter of gfedc vs cramp)");

typeRow("cramp");
for (let i = 0; i < 5; i++) assertFreshCell(5, i, "cramp"[i], "correct", "(column 6)");
assert.ok(SWIVEL.dump().done && !SWIVEL.dump().won,
  "the horizontal word lands on an already-lost main board: game over");
assert.equal(banner.textContent, "Horizontal word down \u2014 the main word was CRANE",
  "the split end is named");
s = readSave();
assert.deepEqual(s.second, ["cramp"], "second guesses persisted");
assert.equal(s.done, true, "done saved");
assert.equal(s.won, false, "the split loss is what's saved");
console.log("ok — restore with revealed transpose: down-clues swiveled, split end respected");

// ---------- 16. restore after finishing / giving up ----------

seedDaily(["brain", "cloud", "dwarf", "eager", "flint", "crane"], [],
  { done: true, won: true });
dailyGame();
assert.equal(banner.textContent, "Phew \u2014 both words in 6", "finished board restored");
assert.ok(!shareBtn.classList.contains("hidden"), "share still offered");
keydown("a");
assert.equal(SWIVEL.dump().main.length, 6, "restored finished board is locked");

seedDaily(["brain"], [], { done: true, won: false, gaveUp: true });
dailyGame();
assert.equal(banner.textContent, "The words were CRANE & CRAMP", "given-up board restored");
assert.ok(giveUpBtn.classList.contains("hidden"), "give up stays retired");
console.log("ok — restore after finishing and after giving up");

// ---------- 17. corrupt saves fall back to a fresh game ----------

const dailyPair = SWIVEL.answersFor(SWIVEL.todayKey());
for (const bad of [
  { answers: ["crane", "crane"], main: [], second: [] },                  // equal pair
  { answers: ["crane"], main: [], second: [] },                           // one answer
  { answers: ["qqqqq", "cramp"], main: [], second: [] },                  // not words
  { answers: ["crane", "cramp"], main: ["qqqqq"], second: [] },           // fake guess
  { answers: ["crane", "cramp"], main: ["a", "b", "c", "d", "e", "f", "g"], second: [] }, // 7 main rows
  { answers: ["crane", "cramp"], main: ["a"], second: ["b", "c", "d"] },  // 4 fresh > 3
  { date: "1999-12-31", answers: ["crane", "cramp"], main: [], second: [] },    // stale date
]) {
  globalThis.localStorage.setItem("swivel-day8", JSON.stringify({
    date: SWIVEL.todayKey(), ...bad,
  }));
  dailyGame();
  const save = readSave();
  assert.deepEqual(save.answers, dailyPair,
    `invalid save ${JSON.stringify(bad).slice(0, 60)} replaced by the daily pair`);
  assert.deepEqual(save.main, [], "main reset");
  assert.deepEqual(save.second, [], "second reset");
}

// an unknown extra key is tolerated, not corrupt
globalThis.localStorage.setItem("swivel-day8", JSON.stringify({
  date: SWIVEL.todayKey(), answers: ["crane", "cramp"], main: [], second: [], extra: 1,
}));
dailyGame();
assert.deepEqual(readSave().answers, ["crane", "cramp"], "unknown extra keys don't invalidate a save");
console.log("ok — corrupt saves: every malformation falls back to a fresh daily");

// ---------- 18. next day: fresh puzzle ----------

s = readSave();
s.date = "1999-12-31";
globalThis.localStorage.setItem("swivel-day8", JSON.stringify(s));
dailyGame();
s = readSave();
assert.equal(s.date, SWIVEL.todayKey(), "re-stamped with today");
assert.deepEqual(s.answers, SWIVEL.answersFor(SWIVEL.todayKey()), "new day, new pair");
assert.equal(board.children.length, 47, "back to a bare L of ghosts plus the two dividers");
assert.equal(banner.textContent, "Two words to find", "banner back to the start");
console.log("ok — next day: fresh board and a new date-derived pair");

// ---------- 19. practice: forced + random pairs, daily save untouched ----------

const saveBeforePractice = globalThis.localStorage.getItem("swivel-day8");
const craneIdx = ANSWERS.indexOf("crane");
const lastIdx = ANSWERS.length - 1;
let rngFlip = 0;
Math.random = () =>
  ([(craneIdx + 0.5) / ANSWERS.length, (lastIdx + 0.5) / ANSWERS.length][rngFlip++ % 2]);

SWIVEL.practice();
assert.equal(banner.textContent, "Practice round", "practice banner shown");
assert.equal(newBtn.textContent, "Today\u2019s puzzle", "button offers the way back");
assert.deepEqual(SWIVEL.dump().answers, [ANSWERS[craneIdx], ANSWERS[lastIdx]],
  "random pair honors the Math.random stub and is distinct");
assert.equal(globalThis.localStorage.getItem("swivel-day8"), saveBeforePractice,
  "practice never touches the daily save");

SWIVEL.practice("crane", "brane");
assert.deepEqual(SWIVEL.dump().answers, ["crane", "brane"], "forced practice pair honored");
SWIVEL.practice("crane", "crane");
assert.notEqual(SWIVEL.dump().answers[0], SWIVEL.dump().answers[1], "invalid forced pair rejected");

const dbg = SWIVEL.dump();
for (const key of ["answers", "main", "second", "hWords", "foundM", "foundS",
  "swiveled", "hRevealed", "practice", "done", "won", "gaveUp", "save"]) {
  assert.ok(key in dbg, `dump exposes ${key}`);
}

newBtn.click(); // back to today's puzzle
assert.equal(newBtn.textContent, "Practice", "button back to Practice");
assert.equal(banner.textContent, "Two words to find", "daily board fresh again");
assert.ok(!giveUpBtn.classList.contains("hidden"), "give up back for the fresh daily");
console.log("ok — practice: forced + random pairs, no save writes, dump, round-trips to daily");

// ---------- 20. the Swivel button only turns the view ----------

SWIVEL.practice("crane", "cramp");
turnBtn.click();
assert.ok(pivot.classList.contains("swiveled"), "swivel button rotates the view");
assert.ok(SWIVEL.dump().swiveled, "and it moves input with the view");
keydown("b");
assert.equal(hLetter(5, 0), "b", "typing lands on the horizontal board while swiveled");
turnBtn.click();
assert.ok(!pivot.classList.contains("swiveled"), "swiveling back counterclockwise");
keydown("c");
assert.equal(cell(0, 0).children[0].textContent, "c", "and back onto the main board");
console.log("ok — Swivel button: the view is the input, exactly as advertised");

// ---------- 21. a full main board refuses typing upright; legacy saves migrate ----------

SWIVEL.practice("crane", "cramp");
for (const w of ["brain", "cloud", "dwarf", "eager", "flint", "ghost"]) typeRow(w);
assert.ok(SWIVEL.dump().swiveled, "auto-swiveled at six rows");
turnBtn.click(); // swivel back upright — the main board is full
keydown("b"); keydown("r"); keydown("a");
assert.equal(toast.textContent, "The main board is full \u2014 swivel to keep guessing",
  "a full main board declines typing with a pointer to the swivel");
assert.equal(cell(0, 0).children[0].textContent, "b",
  "no letters landed on the full board (brain's b still row 1)");
turnBtn.click();

// a first-build save (phase2 flag, no swiveled) migrates cleanly
globalThis.localStorage.setItem("swivel-day8", JSON.stringify({
  date: SWIVEL.todayKey(), answers: ["crane", "cramp"],
  main: ["brain", "cloud", "dwarf", "eager", "flint", "ghost"],
  second: [], phase2: true, done: false, won: false, gaveUp: false,
}));
dailyGame();
assert.ok(SWIVEL.dump().swiveled, "legacy phase2 save resumes swiveled");
typeRow("crane"); // a submit re-saves in the new shape
assert.ok(SWIVEL.dump().save.swiveled, "and re-saves in the new shape");
console.log("ok — full-board guard toasts; legacy phase2 saves migrate to the view flag");

console.log("\nAll swivel tests passed.");
