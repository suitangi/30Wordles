// Headless tests for js/triple.js. Loads the real game script against a
// minimal DOM stub and drives full games through the keyboard handler.
// Run: node tests/triple.test.js
"use strict";

const assert = require("assert/strict");
const path = require("path");

// ---------- minimal DOM / browser stubs (before loading the game) ----------

const timers = [];
// finish() schedules callbacks with an extra arg after the delay (the
// word) — forward everything but the delay (the wobble stub precedent).
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
    disabled: false,
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
["pivot", "board", "keyboard", "banner", "toast", "new-btn", "giveup-btn",
  "turn-btn", "share-btn"].forEach((id) => { byId[id] = makeEl("div"); });
const createdEls = [];

globalThis.window = globalThis;
const windowHandlers = {};
globalThis.addEventListener = (t, fn) => { (windowHandlers[t] ||= []).push(fn); };
globalThis.document = {
  documentElement: { dataset: { theme: "dark" }, clientWidth: 1024 },
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
const GAME_URL = "https://suitangi.github.io/30Wordles/days/26";

require(path.join(__dirname, "..", "js", "triple.js"));
const TRIPLE = globalThis.TRIPLE;
assert.ok(TRIPLE, "triple.js must expose window.TRIPLE");

const banner = byId.banner;
const toast = byId.toast;
const giveUpBtn = byId["giveup-btn"];
const shareBtn = byId["share-btn"];
const keydown = (key) =>
  (windowHandlers.keydown || []).forEach((fn) =>
    fn({ key, metaKey: false, ctrlKey: false, altKey: false }));

// Hex access: TRIPLE.tile(c, r) -> { el, inEl } (el is the outer .hex,
// inEl the .hex-in carrying the letter span and the mark).
const cellEl = (c, r) => TRIPLE.tile(c, r).el;
const cellText = (c, r) => TRIPLE.tile(c, r).inEl.children[0].textContent;
const markOf = (el) =>
  el.classList.contains("correct") ? "correct"
    : el.classList.contains("present") ? "present"
      : el.classList.contains("absent") ? "absent" : null;
const cellMark = (c, r) => markOf(TRIPLE.tile(c, r).inEl);
const keyEl = (letter) => {
  for (const kr of byId.keyboard.children) {
    for (const k of kr.children) {
      if (k.textContent === letter) return k;
    }
  }
  return null;
};
const keyState = (letter) => keyEl(letter).dataset.state;
const dump = () => TRIPLE.dump();

// Type a word and submit it, playing out the whole reveal.
function typeWord(word) {
  for (const ch of word) keydown(ch);
  keydown("Enter");
  runTimers();
}

function practice(a, b, c) { TRIPLE.practice(a, b, c); }

function seedDaily(answers, extra = {}) {
  globalThis.localStorage.setItem("triple-day26", JSON.stringify({
    date: TRIPLE.todayKey(), answers, w1: [], w2: [], w3: [],
    view: 0, done: false, gaveUp: false, ...extra,
  }));
  TRIPLE.daily();
}

function lastShareText() {
  return createdEls[createdEls.length - 1].value;
}

// ---------- the painted map (suitangi's grid-lab paste, verbatim) ----------

const PAINTED = {
  w1: "5,2 6,2 3,3 4,3 5,3 6,3 2,4 3,4 4,4 5,4 6,4 2,5 3,5 4,5 5,5 6,5 2,6 3,6 4,6 5,6 6,6 2,7 3,7 4,7 5,7 6,7 2,8 3,8 4,8 2,9",
  w2: "9,0 10,0 7,1 8,1 9,1 10,1 5,2 6,2 7,2 8,2 9,2 10,2 3,3 4,3 5,3 6,3 7,3 8,3 9,3 10,3 2,4 3,4 4,4 5,4 6,4 7,4 8,4 9,4 10,4 2,5 3,5 4,5 5,5 6,5 7,5 8,5 2,6 3,6 4,6 5,6 6,6 2,7 3,7 4,7 2,8",
  w3: "5,2 6,2 7,2 3,3 4,3 5,3 6,3 7,3 8,3 9,3 2,4 3,4 4,4 5,4 6,4 7,4 8,4 9,4 10,4 11,4 4,5 5,5 6,5 7,5 8,5 9,5 10,5 11,5 12,5 6,6 7,6 8,6 9,6 10,6 8,7",
};

// ---------- independent board model (the test's own truth) ----------------

const K = "correct", P = "present", A = "absent";

const ceil2 = (c) => (c + 1) >> 1;
const w1Hex = (j, k) => [1 + k, 5 + j - ceil2(1 + k)];
const w2Hex = (i, k) => [2 + i, 9 - ceil2(2 + i) - (k - 1)];
const w3Hex = (j, k) => [2 + j + (k - 1), 5 + j - ceil2(2 + j + (k - 1))];

// Letters on the board from typed guesses: blue's rows first, then
// orange's typed columns (line index >= 5), then gray's typed rows (>= 5).
function modelLetters(w1, w2, w3) {
  const at = {};
  w1.forEach((word, j) => {
    for (let k = 1; k <= 5; k++) {
      const [c, r] = w1Hex(j, k);
      at[c + "," + r] = word[k - 1];
    }
  });
  w2.forEach((word, t) => {
    for (let k = 1; k <= 5; k++) {
      const [c, r] = w2Hex(5 + t, k);
      at[c + "," + r] = word[k - 1];
    }
  });
  w3.forEach((word, t) => {
    for (let k = 1; k <= 5; k++) {
      const [c, r] = w3Hex(5 + t, k);
      at[c + "," + r] = word[k - 1];
    }
  });
  return at;
}

// The three boards' word lists (word order), "" while incomplete —
// derived from the model letters only.
function modelWords(w1, w2, w3) {
  const at = modelLetters(w1, w2, w3);
  const read = (hexFn, lineCount) => {
    const out = [];
    for (let line = 0; line < lineCount; line++) {
      let w = "";
      for (let k = 1; k <= 5; k++) {
        const [c, r] = hexFn(line, k);
        const ch = at[c + "," + r];
        if (!ch) { w = ""; break; }
        w += ch;
      }
      out.push(w);
    }
    return out;
  };
  return {
    w1: read(w1Hex, 6),
    w2: read(w2Hex, 9),
    w3: read(w3Hex, 7),
  };
}

// Per-tile mark: the letter scored at its own position, no cross-hex
// copy accounting (the Swivel trade the display law runs on).
function modelTileMark(ch, answer, pos1) {
  if (ch === answer[pos1 - 1]) return K;
  return answer.includes(ch) ? P : A;
}

// consistency of a candidate secret against one per-tile observation
function fitsPerTile(candidate, ch, pos0, mark) {
  if (mark === K) return candidate[pos0] === ch;
  if (mark === P) return candidate[pos0] !== ch && candidate.includes(ch);
  return !candidate.includes(ch);
}

function boardConsistent(boardIdx, trio, secret) {
  const d = dump();
  const at = modelLetters(d.w1, d.w2, d.w3);
  const hexFn = boardIdx === 0 ? w1Hex : boardIdx === 1 ? w2Hex : w3Hex;
  const lineCount = [6, 9, 7][boardIdx];
  for (let line = 0; line < lineCount; line++) {
    for (let k = 1; k <= 5; k++) {
      const [c, r] = hexFn(line, k);
      const ch = at[c + "," + r];
      if (!ch) continue;
      if (!fitsPerTile(secret, ch, k - 1, modelTileMark(ch, trio[boardIdx], k))) {
        return false;
      }
    }
  }
  return true;
}

// ---------- tests -------------------------------------------------------

// 1. The painted map is the board: all three sets match the paste.
{
  const boards = TRIPLE.boards();
  const byRow = (x, y) => {
    const a = x.split(","), b = y.split(",");
    return (+a[1] - +b[1]) || (+a[0] - +b[0]);
  };
  for (const [name, keys] of Object.entries(PAINTED)) {
    const expect = keys.split(" ").sort(byRow);
    assert.deepEqual(boards[{ w1: 0, w2: 1, w3: 2 }[name]], expect,
      `${name} hexes must match the painted map`);
  }
  assert.equal(boards[0].length, 30, "blue carries 30 hexes");
  assert.equal(boards[1].length, 45, "orange carries 45 hexes");
  assert.equal(boards[2].length, 35, "gray carries 35 hexes");
  const union = new Set([...boards[0], ...boards[1], ...boards[2]]);
  assert.equal(union.size, 60, "the views each paint 60 hexes");
  const inter = (x, y) => x.filter((k) => y.includes(k)).length;
  assert.equal(inter(boards[0], boards[1]), 25);
  assert.equal(inter(boards[0], boards[2]), 15);
  assert.equal(inter(boards[1], boards[2]), 25);
}

// 2. suitangi's simulation, verbatim: blue guesses MOUND..LIGHT refill
// orange's first five columns as PSFRM LTLEO AOISU IRCAN NYKTD; with
// QUIET/CHILL/GHOUL/WORLD typed on orange, gray's first five rows read
// MOUND ESATE ICKII RYUHH NQCGW with two rows left to type. Blue lost is
// not the end — orange and gray still play.
{
  practice("audit", "cramp", "hoist");
  ["MOUND", "RESAT", "FLICK", "STORY", "PLAIN", "LIGHT"].forEach(typeWord);
  assert.deepEqual(dump().w1,
    ["mound", "resat", "flick", "story", "plain", "light"]);
  assert.deepEqual(dump().words.w2.slice(0, 5),
    ["psfrm", "ltleo", "aoisu", "ircan", "nyktd"],
    "the carry columns must read the simulation exactly");
  assert.deepEqual(dump().words.w2.slice(5), ["", "", "", ""]);
  assert.equal(dump().lost[0], true, "blue lost on six misses");
  assert.equal(dump().found[0], false);
  assert.equal(dump().view, 1, "auto-swiveled to orange");
  assert.ok(banner.textContent.includes("out"), "the loss is named");
  ["QUIET", "CHILL", "GHOUL", "WORLD"].forEach(typeWord);
  assert.deepEqual(dump().words.w3,
    ["mound", "esate", "ickii", "ryuhh", "nqcgw", "", ""],
    "gray's seeded rows must read the simulation exactly");
  assert.equal(dump().lost[1], true);
  assert.equal(dump().view, 2, "auto-swiveled to gray");
  // the letters sit on the hexes suitangi named
  assert.equal(cellText(2, 4), "m");
  assert.equal(cellText(3, 3), "o");
  assert.equal(cellText(4, 3), "u");
  assert.equal(cellText(5, 2), "n");
  assert.equal(cellText(6, 2), "d");
  assert.equal(cellText(6, 6), "n", "gray row 4 opens with PLAIN's N");
  assert.equal(cellText(10, 4), "w", "and closes with WORLD's W");
  assert.equal(cellText(8, 7), "", "gray's typed rows stay empty");
}

// 3. The first guess lands where suitangi said — (2,4) (3,3) (4,3)
// (5,2) (6,2) — and the last at (2,9) (3,8) (4,8) (5,7) (6,7).
{
  practice("crane", "slate", "hoist");
  typeWord("pasta");
  assert.equal(cellText(2, 4), "p");
  assert.equal(cellText(3, 3), "a");
  assert.equal(cellText(4, 3), "s");
  assert.equal(cellText(5, 2), "t");
  assert.equal(cellText(6, 2), "a");
  ["mousy", "addle", "robot", "those"].forEach(typeWord);
  typeWord("crane");
  assert.equal(cellText(2, 9), "c");
  assert.equal(cellText(3, 8), "r");
  assert.equal(cellText(4, 8), "a");
  assert.equal(cellText(5, 7), "n");
  assert.equal(cellText(6, 7), "e");
  assert.equal(dump().found[0], true);
  assert.equal(dump().view, 1, "handed to orange");
}

// 4. Per-tile scoring (the documented Swivel trade): eerie vs crane on
// blue reads P,P,P,A,K — the final e greens positionally even though
// crane holds one e. The same letters carry into orange's columns at
// their own positions: four e's sit at position 5 (slate ends in e) and
// the r starves.
{
  practice("crane", "slate", "hoist");
  typeWord("eerie");
  assert.deepEqual(
    [w1Hex(0, 1), w1Hex(0, 2), w1Hex(0, 3), w1Hex(0, 4), w1Hex(0, 5)]
      .map(([c, r]) => cellMark(c, r)),
    [P, P, P, A, K]);
  assert.deepEqual(
    [[2, 4], [3, 3], [4, 3], [5, 2], [6, 2]].map(([c, r]) => cellMark(c, r)),
    [P, P, P, A, K],
    "in view 0 the shared hexes wear blue's clues");
  TRIPLE.swivelTo(1);
  assert.deepEqual(
    [[2, 4], [3, 3], [4, 3], [5, 2], [6, 2]].map(([c, r]) => cellMark(c, r)),
    [K, K, A, A, K],
    "swiveled, they score vs slate at position 5");
  assert.equal(dump().found[0], false);
}

// 5. The view owns the shared hexes' clues (and the keyboard follows):
// typing slate against crane — key s reads absent on blue, present on
// orange; hex (2,4) flips absent -> present with the swivel and back.
{
  practice("crane", "slate", "hoist");
  typeWord("slate");
  assert.equal(keyState("s"), A, "blue clue: s is not in crane");
  assert.equal(cellMark(2, 4), A);
  TRIPLE.swivelTo(1);
  assert.equal(dump().view, 1);
  assert.equal(keyState("s"), P, "orange clue: s lives in slate");
  assert.equal(cellMark(2, 4), P);
  TRIPLE.swivelTo(0);
  assert.equal(keyState("s"), A, "reset-then-repaint on the way back");
  assert.equal(cellMark(2, 4), A);
}

// 6. Gray can find itself: typing pasta as blue guess 1 spells gray's
// row 1 (the same hexes) — found with no gray guess typed, and the game
// plays on.
{
  practice("hoist", "cramp", "pasta");
  typeWord("pasta");
  assert.equal(dump().found[2], true, "gray found by the carry");
  assert.equal(dump().found[0], false);
  assert.equal(dump().done, false);
  assert.ok(toast.textContent.includes("gray"), "the fill gets a toast");
  assert.ok(cellEl(2, 4).classList.contains("win-glow"), "the row glows");
}

// 7. Orange can find itself: blue guesses whose first letters spell
// cramp bottom-up (p-m-a-r-c...) auto-find orange when the fifth blue
// guess completes the carry. Blue still has a row open, so the player
// stays on blue; when blue is then lost, the handover skips the decided
// orange — and gray is still winnable (2 of 3).
{
  practice("audit", "cramp", "hoist");
  ["pasta", "mousy", "addle", "robot"].forEach(typeWord);
  assert.equal(dump().found[1], false, "not until the carry completes");
  typeWord("crane");
  assert.equal(dump().found[0], false, "crane is not blue's answer");
  assert.equal(dump().found[1], true, "orange found by the fill");
  assert.equal(dump().view, 0, "blue still has a row open");
  assert.ok(toast.textContent.includes("orange"));
  typeWord("those"); // blue's last guess, wrong
  assert.equal(dump().lost[0], true);
  assert.equal(dump().view, 2, "handover skipped the decided orange");
  assert.ok(banner.textContent.includes("out"));
  // gray is still winnable: its row 1 carries pasta, rows 2-4 need the
  // orange typing that never happened — but two guesses remain
  typeWord("hoist");
  assert.equal(dump().found[2], true);
  assert.equal(dump().done, true);
  assert.ok(banner.textContent.includes("2 of 3"));
  assert.ok(banner.textContent.includes("AUDIT"));
}

// 8. Full-loss end state: every board spent wrong ends at 0 of 3, and
// the share carries the whole board story (three blocks, blank-lined).
{
  practice("crane", "slate", "hoist");
  ["radio", "pilot", "ghost", "moldy", "spunk", "whiff"].forEach(typeWord);
  assert.equal(dump().lost[0], true);
  ["inbox", "quack", "fjord", "waltz"].forEach(typeWord);
  assert.equal(dump().lost[1], true);
  // gray's seeded row 4: spunk's last letter + the four typed orange
  // first letters
  assert.equal(dump().words.w3[4], "kiqfw");
  typeWord("doing");
  typeWord("index");
  assert.equal(dump().done, true, "gray spent = game over");
  assert.equal(dump().found.filter(Boolean).length, 0);
  assert.ok(banner.textContent.includes("0 of 3"));
  assert.ok(banner.textContent.includes("CRANE"));
  assert.ok(banner.textContent.includes("HOIST"));
  shareBtn.click();
  const lines = lastShareText().split("\n");
  assert.equal(lines[0], "Triple · practice · 0/3");
  assert.equal(lines[1], GAME_URL);
  assert.equal(lines[2], "", "a blank line opens the blue block");
  assert.equal(Array.from(lines[3]).length, 5, "emoji rows are five wide");
  assert.equal(lines.filter((l) => l === "").length, 3, "three blocks");
}

// 9. The win: find all three. An early find keeps the view (spare rows
// could seed the carry); the player swivels on manually.
{
  practice("crane", "slate", "hoist");
  typeWord("crane");
  assert.equal(dump().found[0], true);
  assert.equal(dump().view, 0, "the find keeps the view");
  assert.ok(toast.textContent.includes("Fill the board"),
    "the spare rows get pointed out");
  TRIPLE.swivelTo(1);
  typeWord("slate");
  assert.equal(dump().found[1], true);
  assert.equal(dump().view, 1, "orange found with rows to spare");
  TRIPLE.swivelTo(2);
  typeWord("hoist");
  assert.equal(dump().done, true);
  assert.deepEqual(dump().found, [true, true, true]);
  assert.ok(banner.textContent.startsWith("Impressive"));
  assert.ok(banner.textContent.includes("all three in 3 guesses"));
  shareBtn.click();
  const lines = lastShareText().split("\n");
  assert.equal(lines[0], "Triple · practice · 3/3");
  assert.equal(lines[2], "");
  assert.equal(lines[3], "🟩🟩🟩🟩🟩", "blue's winning row");
  assert.equal(lines[4], "");
  // blue found in one guess, so the carry columns hold a single letter
  // each at position 5 and share padded; the typed slate column is green
  assert.equal(lines[5], "⬛⬛⬛⬛⬛", "column 0: crane's c vs slate's e");
  assert.equal(lines[7], "⬛⬛⬛⬛🟨", "column 2: a is in slate");
  assert.equal(lines[9], "⬛⬛⬛⬛🟩", "column 4: e vs e");
  assert.equal(lines[10], "🟩🟩🟩🟩🟩", "the typed slate column");
  assert.equal(lines[11], "");
  // gray's rows carry crane's tail and slate's letters wherever they
  // land — row 4 reads e,s,s,s,s against hoist (the s strays yellow)
  assert.equal(lines[12], "⬛⬛⬛⬛⬛", "crane vs hoist");
  assert.equal(lines[13], "⬛⬛⬛⬛🟩", "slate's t lands on hoist's t");
  assert.equal(lines[16], "⬛🟨⬛⬛⬛", "e,s,s,s,s vs hoist");
  assert.equal(lines[17], "🟩🟩🟩🟩🟩", "gray's winning row");
  assert.equal(lines.length, 18);
}

// 10. Give up names everything the player missed.
{
  practice("crane", "slate", "hoist");
  giveUpBtn.click();
  assert.equal(dump().done, true);
  assert.equal(dump().gaveUp, true);
  assert.ok(banner.textContent.includes("0 of 3"));
  shareBtn.click();
  assert.ok(lastShareText().startsWith("Triple · practice · gave up · 0/3"));
}

// 11. Validation: short words and non-words refuse; the letters stay for
// editing (the Stifle rule). A decided board refuses typing.
{
  practice("crane", "slate", "hoist");
  keydown("c"); keydown("r"); keydown("q"); keydown("Enter");
  runTimers();
  assert.ok(toast.textContent.includes("Not enough letters"));
  assert.equal(cellText(2, 4), "c", "letters stay for editing");
  keydown("Backspace"); keydown("Backspace"); keydown("Backspace");
  keydown("Enter"); runTimers();
  keydown("c"); keydown("r"); keydown("q"); keydown("p"); keydown("t");
  keydown("Enter"); runTimers();
  assert.ok(toast.textContent.includes("Not in word list"));
  assert.equal(dump().w1.length, 0, "nothing was committed");
  for (let i = 0; i < 5; i++) keydown("Backspace"); // clear the refusal
  typeWord("crane"); // blue found — the view stays for the spare rows
  assert.equal(dump().w1.length, 1);
  assert.equal(dump().view, 0, "an early find keeps the view");
  ["those", "radio", "pilot", "ghost", "moldy"].forEach(typeWord);
  assert.equal(dump().w1.length, 6);
  assert.equal(dump().view, 1, "budget spent — handed over");
  TRIPLE.swivelTo(0); // face the spent board again
  typeWord("spunk"); // refused
  assert.equal(dump().w1.length, 6);
  assert.ok(toast.textContent.includes("swivel"));
}

// 12. Typing lands on the board you face: orange's first typed guess
// goes to column index 5 (c=7) even while the carry is open; gray's
// first typed guess goes to row index 5.
{
  practice("crane", "slate", "hoist");
  TRIPLE.swivelTo(1);
  typeWord("quack");
  assert.equal(cellText(7, 5), "q", "word order climbs bottom-up");
  assert.equal(cellText(7, 1), "k");
  assert.deepEqual(dump().words.w2[5], "quack");
  assert.equal(dump().words.w2[0], "", "carry columns still open");
  TRIPLE.swivelTo(2);
  typeWord("crane");
  assert.deepEqual(dump().words.w3[5], "crane");
  assert.equal(cellText(7, 6), "c");
}

// 13. Save + restore: a mid-game save resumes words, view and derived
// state; corrupt saves fall back to a fresh daily.
{
  seedDaily(["crane", "slate", "hoist"], {
    w1: ["pasta", "mousy"], w2: ["quack"], w3: [], view: 1,
  });
  assert.deepEqual(dump().w1, ["pasta", "mousy"]);
  assert.equal(cellText(2, 4), "p", "carry letters derive from blue");
  assert.equal(cellText(2, 5), "m");
  assert.deepEqual(dump().words.w2[5], "quack");
  assert.equal(dump().view, 1, "the saved view resumes");
  typeWord("slate");
  assert.equal(dump().found[1], true);
  assert.equal(dump().done, false, "blue is still open — the game plays on");
  assert.equal(dump().view, 1, "orange found with rows to spare — it keeps the view");
  TRIPLE.swivelTo(0); // go finish blue off
  ["pilot", "ghost", "moldy", "spunk"].forEach(typeWord); // blue spent
  assert.equal(dump().lost[0], true);
  assert.equal(dump().view, 2, "now the last open board");
  typeWord("doing");
  typeWord("index"); // gray spent
  assert.equal(dump().done, true);
  assert.equal(dump().found.filter(Boolean).length, 1);
  // stale date -> fresh daily
  store.set("triple-day26", JSON.stringify({
    date: "2000-01-01", answers: ["crane", "slate", "hoist"],
    w1: [], w2: [], w3: [], view: 0, done: false, gaveUp: false,
  }));
  TRIPLE.daily();
  assert.deepEqual(dump().answers, TRIPLE.answersFor(TRIPLE.todayKey()));
  assert.equal(dump().w1.length, 0);
  // over-budget words -> corrupt
  store.set("triple-day26", JSON.stringify({
    date: TRIPLE.todayKey(), answers: ["crane", "slate", "hoist"],
    w1: ["radio", "pilot", "ghost", "moldy", "spunk", "whiff", "doing"],
    w2: [], w3: [], view: 0, done: false, gaveUp: false,
  }));
  TRIPLE.daily();
  assert.deepEqual(dump().answers, TRIPLE.answersFor(TRIPLE.todayKey()),
    "seven blue words must read as corrupt");
  // duplicate answers -> corrupt
  seedDaily(["crane", "slate", "hoist"]);
  store.set("triple-day26", JSON.stringify({
    date: TRIPLE.todayKey(), answers: ["crane", "crane", "hoist"],
    w1: [], w2: [], w3: [], view: 0, done: false, gaveUp: false,
  }));
  TRIPLE.daily();
  assert.notDeepEqual(dump().answers, ["crane", "crane", "hoist"]);
  // non-dict answers -> corrupt
  seedDaily(["crane", "slate", "hoist"]);
  store.set("triple-day26", JSON.stringify({
    date: TRIPLE.todayKey(), answers: ["crane", "slate", "zzzzz"],
    w1: [], w2: [], w3: [], view: 0, done: false, gaveUp: false,
  }));
  TRIPLE.daily();
  assert.notDeepEqual(dump().answers, ["crane", "slate", "zzzzz"]);
}

// 14. The daily trio is stable and distinct across dates.
{
  const seen = new Set();
  for (let d = 0; d < 200; d++) {
    const key = "2026-day-" + d;
    const [a, b, c] = TRIPLE.answersFor(key);
    assert.ok(a !== b && b !== c && a !== c, `distinct trio on ${key}`);
    assert.ok(DICT.has(a) && DICT.has(b) && DICT.has(c));
    seen.add(a + "|" + b + "|" + c);
  }
  assert.ok(seen.size > 190, "the trio varies across dates");
}

// 15. every play word in this file must be legal (guards the flows above)
for (const w of ["MOUND", "RESAT", "FLICK", "STORY", "PLAIN", "LIGHT",
  "QUIET", "CHILL", "GHOUL", "WORLD", "pasta", "mousy", "addle", "robot",
  "crane", "eerie", "slate", "radio", "pilot", "ghost", "moldy", "spunk",
  "whiff", "those", "inbox", "quack", "fjord", "waltz", "doing", "index", "hoist",
  "audit", "cramp", "pasta", "trace", "raise", "arise", "stare", "least"]) {
  assert.ok(DICT.has(w.toLowerCase()), `${w} must be in the dictionary`);
}

// 16. Neighbor geometry: every direction's painted offset must be the
// canonical lattice vector (catches the parity inversion that scrambled
// the first outline build).
{
  const W = Math.sqrt(3) * 35.2, C = 1.5 * 35.2;
  const CANON = [
    [0, -W], [C, -W / 2], [C, W / 2],
    [0, W], [-C, W / 2], [-C, -W / 2]
  ];
  const ctr = (c, r) => [c * C, r * W + (c % 2 ? W / 2 : 0)];
  const allKeys = [...new Set(TRIPLE.boards().flat())]
    .map((k) => k.split(",").map(Number));
  for (const [c, r] of allKeys) {
    TRIPLE.neighbors(c, r).forEach(([nc, nr], i) => {
      const [px, py] = ctr(c, r);
      const [qx, qy] = ctr(nc, nr);
      assert.deepEqual(
        [qx - px, qy - py].map(Math.round),
        CANON[i].map(Math.round),
        `neighbor ${i} of (${c},${r}) must sit at the canonical offset`);
    });
  }
}

// 17. The traced outline is exactly the board's geometric boundary:
// recompute every boundary edge independently (geometric neighbor
// lookup — a hex is across the edge whose midpoint doubled from the
// center lands on that hex's center) and compare as an edge multiset
// with the game's traced loops.
{
  const boards = TRIPLE.boards();
  const S = 35.2, C = 1.5 * S, W = Math.sqrt(3) * S;
  const CORNERS = [
    [-S / 2, -W / 2], [S / 2, -W / 2], [S, 0],
    [S / 2, W / 2], [-S / 2, W / 2], [-S, 0]
  ];
  const ctr = (c, r) => [c * C, r * W + (c % 2 ? W / 2 : 0)];
  const r1 = (v) => v.toFixed(1);
  for (let b = 0; b < 3; b++) {
    const members = new Set(boards[b]);
    const centers = new Map(boards[b].map((k) => {
      const [c, r] = k.split(",").map(Number);
      return [ctr(c, r).map(r1).join(","), k];
    }));
    // independent boundary edges
    const expect = [];
    for (const k of boards[b]) {
      const [c, r] = k.split(",").map(Number);
      const [px, py] = ctr(c, r);
      for (let i = 0; i < 6; i++) {
        const a = CORNERS[i], bpt = CORNERS[(i + 1) % 6];
        const mx = px + (a[0] + bpt[0]) / 2, my = py + (a[1] + bpt[1]) / 2;
        const across = centers.get([mx * 2 - px, my * 2 - py].map(r1).join(","));
        if (across && members.has(across)) continue; // interior edge
        expect.push([a, bpt].map((p) => [px + p[0], py + p[1]])
          .map((p) => p.map(r1).join(",")).sort().join("|"));
      }
    }
    // the game's traced edges, from the chained loops
    const got = [];
    for (const loop of TRIPLE.outlineLoops(b)) {
      for (let i = 0; i < loop.length; i++) {
        const a = loop[i], b2 = loop[(i + 1) % loop.length];
        got.push([a, b2].map((p) => p.map(r1).join(",")).sort().join("|"));
      }
    }
    expect.sort();
    got.sort();
    assert.deepEqual(got, expect,
      `board ${b}'s traced outline must equal its geometric boundary`);
  }
}

console.log("triple: functional tests passed");

// ---------- solvability sweep -------------------------------------------
//
// An oracle plays the real game end-to-end over sampled daily dates,
// with the strategy suitangi's simulation describes: crack blue, then
// FILL the spare rows (and orange's spare columns) to seed the later
// boards. Blue is cracked with a computed opener plus greedy
// widest-split picks from the consistent pool; orange and gray filter
// their pools against the per-tile marks the board actually shows
// (carry-over included) and type the widest per-tile split. The sweep
// uses its OWN board model (modelLetters / modelTileMark above), never
// the game's internals, and drives the real keyboard.

function wordleMarks(guess, target) {
  const marks = Array(5).fill(A);
  const rem = {};
  for (let i = 0; i < 5; i++) {
    if (guess[i] === target[i]) marks[i] = K;
    else rem[target[i]] = (rem[target[i]] || 0) + 1;
  }
  for (let j = 0; j < 5; j++) {
    if (marks[j] !== K && rem[guess[j]] > 0) {
      marks[j] = P;
      rem[guess[j]]--;
    }
  }
  return marks;
}

function splitWorst(pool, guess) {
  const buckets = new Map();
  for (const secret of pool) {
    const m = wordleMarks(guess, secret).join("");
    buckets.set(m, (buckets.get(m) || 0) + 1);
  }
  let worst = 0;
  for (const v of buckets.values()) if (v > worst) worst = v;
  return worst;
}

function greedyPick(pool) {
  let best = null, bestScore = Infinity;
  for (const g of pool) {
    const s = splitWorst(pool, g);
    if (s < bestScore) { bestScore = s; best = g; }
  }
  return best;
}

// Per-tile bucket key: the marks a word would earn at positions 1..5
// against a secret — the feedback the board actually shows a typed line.
function perTileKey(guess, secret) {
  let key = "";
  for (let k = 1; k <= 5; k++) key += modelTileMark(guess[k - 1], secret, k);
  return key;
}

function perTilePick(pool) {
  if (!pool.length) return null;
  if (pool.length === 1) return pool[0];
  let best = null, bestWorst = Infinity;
  for (const g of pool) {
    const buckets = new Map();
    for (const s of pool) {
      const k = perTileKey(g, s);
      buckets.set(k, (buckets.get(k) || 0) + 1);
    }
    let worst = 0;
    for (const v of buckets.values()) if (v > worst) worst = v;
    if (worst < bestWorst) { bestWorst = worst; best = g; }
  }
  return best;
}

// The opener: the best of a few strong starters against the full answer
// list (computed once).
const OPENERS = ["slate", "crane", "raise", "arise", "stare", "least", "trace"];
const OPENER = (() => {
  let best = null, bestScore = Infinity;
  for (const g of OPENERS) {
    const s = splitWorst(ANSWERS, g);
    if (s < bestScore) { bestScore = s; best = g; }
  }
  return best;
})();

const SWEEP_DATES = 40;
let allFound = 0;
let w1Fails = 0, w2Fails = 0, w3Fails = 0;
let worstW1 = 0, worstW2 = 0, worstW3 = 0;

for (let d = 0; d < SWEEP_DATES; d++) {
  const key = "2025-" + String((d % 12) + 1).padStart(2, "0") + "-" +
    String((d % 28) + 1).padStart(2, "0");
  const trio = TRIPLE.answersFor(key);
  practice(trio[0], trio[1], trio[2]);

  // ----- blue: standard two-pass oracle -----
  let pool = ANSWERS.slice();
  let guess = OPENER;
  let w1Used = 0;
  let w1FoundAt = 0;
  for (let t = 0; t < 6; t++) {
    typeWord(guess);
    w1Used++;
    if (dump().found[0]) { w1FoundAt = w1Used; break; }
    pool = pool.filter((secret) =>
      dump().w1.every((gw) =>
        wordleMarks(gw, secret).join("") ===
        wordleMarks(gw, trio[0]).join("")));
    guess = greedyPick(pool);
  }
  w1Fails += dump().found[0] ? 0 : 1;
  worstW1 = Math.max(worstW1, w1FoundAt || 6);

  // ----- fill blue's spare rows to seed orange and gray (the fill law):
  // pick gray-informing words from gray's live pool
  let gPool = ANSWERS.filter((secret) => boardConsistent(2, trio, secret));
  while (!dump().found[2] && dump().w1.length < 6) {
    const fill = perTilePick(gPool);
    if (!fill) break;
    typeWord(fill);
    gPool = gPool.filter((secret) => boardConsistent(2, trio, secret));
  }

  // ----- orange: per-tile oracle over everything the board shows. A
  // found-with-spare orange keeps typing gray seeds too.
  let oPool = ANSWERS.filter((secret) => boardConsistent(1, trio, secret));
  let w2Used = 0;
  let w2FoundAt = 0;
  while (dump().w2.length < 4 && !dump().lost[1]) {
    const pick = dump().found[1] ? perTilePick(gPool) : perTilePick(oPool);
    if (!pick) break;
    typeWord(pick);
    w2Used++;
    if (dump().found[1] && !w2FoundAt) w2FoundAt = w2Used;
    oPool = oPool.filter((secret) => boardConsistent(1, trio, secret));
    gPool = gPool.filter((secret) => boardConsistent(2, trio, secret));
  }
  w2Fails += dump().found[1] ? 0 : 1;
  worstW2 = Math.max(worstW2, w2FoundAt || Math.min(w2Used, 4));

  // ----- gray: two guesses, per-tile -----
  if (TRIPLE.view() !== 2 && dump().w3.length < 2 && !dump().lost[2]) {
    TRIPLE.swivelTo(2);
  }
  let w3Used = 0;
  while (dump().w3.length < 2 && !dump().lost[2] && !dump().found[2]) {
    const pick = perTilePick(gPool);
    if (!pick) break;
    typeWord(pick);
    w3Used++;
    gPool = gPool.filter((secret) => boardConsistent(2, trio, secret));
  }
  w3Fails += dump().found[2] ? 0 : 1;
  worstW3 = Math.max(worstW3, w3Used);
  if (dump().found.every(Boolean)) allFound++;
}

console.log(`triple sweep over ${SWEEP_DATES} dates (opener ${OPENER}):`);
console.log(`  blue found:   ${SWEEP_DATES - w1Fails}/${SWEEP_DATES}, worst ${worstW1}/6`);
console.log(`  orange found: ${SWEEP_DATES - w2Fails}/${SWEEP_DATES}, worst ${worstW2}/4`);
console.log(`  gray found:   ${SWEEP_DATES - w3Fails}/${SWEEP_DATES}, worst ${worstW3}/2`);
console.log(`  all three:    ${allFound}/${SWEEP_DATES}`);

assert.equal(w1Fails, 0, "blue must be crackable within six");
assert.equal(w2Fails, 0, "orange must be crackable with the carry + four");
assert.ok(allFound >= SWEEP_DATES - 2,
  `the composite should win nearly every date (${allFound}/${SWEEP_DATES})`);
console.log("triple: sweep passed");
