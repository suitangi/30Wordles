// Headless tests for js/bundle.js. Loads the real game script against a
// minimal DOM stub and drives full games through the keyboard handler.
// Run: node tests/bundle.test.js
"use strict";

const assert = require("assert/strict");
const path = require("path");

// ---------- minimal DOM / browser stubs (before loading the game) ----------

const timers = [];
globalThis.setTimeout = (fn) => { timers.push(fn); return timers.length; };
globalThis.clearTimeout = () => {};
function runTimers() { while (timers.length) timers.shift()(); }

function makeEl(tag) {
  const el = {
    tagName: tag,
    children: [],
    textContent: "",
    value: "",
    dataset: {},
    style: {},
    offsetWidth: 0,
    type: "",
    _handlers: {},
    appendChild(child) { this.children.push(child); return child; },
    addEventListener(t, fn) { (this._handlers[t] ||= []).push(fn); },
    setAttribute() {},
    select() {},
    remove() {},
    click() { (this._handlers.click || []).forEach((fn) => fn()); },
  };
  const classes = new Set();
  Object.defineProperty(el, "classList", {
    value: {
      add: (...cs) => cs.forEach((c) => classes.add(c)),
      remove: (...cs) => cs.forEach((c) => classes.delete(c)),
      contains: (c) => classes.has(c),
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
["board", "keyboard", "banner", "toast", "new-btn", "share-btn"].forEach((id) => {
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
const CHAIN = [1, 3, 2, 0, 4]; // shared column between row i and i+1

require(path.join(__dirname, "..", "js", "bundle.js"));

const board = byId.board;
const banner = byId.banner;
const toast = byId.toast;
const newBtn = byId["new-btn"];
const shareBtn = byId["share-btn"];
const keydown = (key) =>
  (windowHandlers.keydown || []).forEach((fn) =>
    fn({ key, metaKey: false, ctrlKey: false, altKey: false }));

// ---------- board map: positions -> elements ----------

let tileMap = [];
let pairEls = [];

function rebuildMap() {
  tileMap = Array.from({ length: 6 }, () => Array(5).fill(null));
  pairEls = [];
  for (const el of board.children) {
    if (el.classList.contains("pair")) {
      const i = pairEls.length;
      pairEls.push(el);
      tileMap[i][CHAIN[i]] = el.children[0];     // upper half
      tileMap[i + 1][CHAIN[i]] = el.children[1]; // lower half
    } else {
      const r = (parseInt(el.style.gridRow, 10) - 1) / 2;
      const c = parseInt(el.style.gridColumn, 10) - 1;
      tileMap[r][c] = el;
    }
  }
}

function newGame() {
  newBtn.click();
  rebuildMap();
}

const tile = (r, c) => tileMap[r][c];

const setAnswer = (word) => {
  const i = ANSWERS.indexOf(word);
  assert.ok(i >= 0, `"${word}" should be in the answers list`);
  // +0.5 so floor() lands exactly on i regardless of float rounding
  Math.random = () => (i + 0.5) / ANSWERS.length;
};

// ---------- helpers ----------

// Type a legal word into row r (skipping the locked carried column).
function typeRow(r, word) {
  const lockedCol = r > 0 ? CHAIN[r - 1] : -1;
  for (let c = 0; c < 5; c++) {
    if (c === lockedCol) continue;
    keydown(word[c]);
  }
  keydown("Enter");
  runTimers();
}

// Build a legal 6-guess chain. win=true ends with the answer itself;
// win=false never guesses the answer. Backtracking greedy search.
function buildChain(answer, win) {
  const rows = [];
  const ok = (i, w) => {
    if (i > 0 && w[CHAIN[i - 1]] !== rows[i - 1][CHAIN[i - 1]]) return false;
    if (win) return i === 5 ? w === answer : w !== answer;
    return w !== answer;
  };
  function dfs(i) {
    if (i === 6) return true;
    for (const w of DICT) {
      if (!ok(i, w)) continue;
      rows.push(w);
      if (dfs(i + 1)) return true;
      rows.pop();
    }
    return false;
  }
  if (!dfs(0)) throw new Error(`no legal chain found for answer "${answer}"`);
  return rows;
}

// ---------- 1. word list sanity ----------

assert.equal(ANSWERS.length, 2315, "answers count");
assert.equal(DICT.size, 14855, "guessable count");
for (const w of ANSWERS) {
  assert.match(w, /^[a-z]{5}$/, `answer "${w}" shape`);
  assert.ok(DICT.has(w), `answer "${w}" must be guessable`);
}
console.log("ok — word lists (2315 answers, 14855 guessable, answers ⊆ guesses)");

// ---------- 2. every puzzle must be completable (sampled) ----------

let sampled = 0;
for (let i = 0; i < ANSWERS.length; i += 9) {
  buildChain(ANSWERS[i], true);
  sampled++;
}
console.log(`ok — solvability: found legal 6-guess chains for ${sampled} sampled answers`);

// ---------- 3. board structure + fresh state ----------

setAnswer("crane");
newGame();

assert.equal(board.children.length, 25, "20 square tiles + 5 pair rectangles");
assert.equal(pairEls.length, 5, "5 bundled rectangles");

for (let i = 0; i < 5; i++) {
  const p = pairEls[i];
  assert.equal(p.style.gridColumn, String(CHAIN[i] + 1), `pair ${i} column`);
  assert.equal(p.style.gridRow, `${2 * i + 1} / span 3`, `pair ${i} spans 2 rows + seam`);
  assert.ok(p.classList.contains("chain"), `pair ${i} starts in chain preview`);
  assert.ok(!p.classList.contains("armed") && !p.classList.contains("spent"));
  assert.equal(p.children.length, 2, `pair ${i} has two halves`);
  assert.equal(tileMap[i][CHAIN[i]], p.children[0], "upper half mapped");
  assert.equal(tileMap[i + 1][CHAIN[i]], p.children[1], "lower half mapped");
}

const halves = new Set();
for (const p of pairEls) {
  halves.add(p.children[0]);
  halves.add(p.children[1]);
}
for (let r = 0; r < 6; r++) {
  for (let c = 0; c < 5; c++) {
    const t = tile(r, c);
    assert.ok(t, `tile(${r},${c}) exists`);
    assert.equal(t.textContent, "", `tile(${r},${c}) starts empty`);
    assert.ok(!t.classList.contains("carried"), `tile(${r},${c}) not carried`);
    if (!halves.has(t)) {
      assert.equal(t.style.gridRow, String(2 * r + 1), `tile(${r},${c}) grid row`);
      assert.equal(t.style.gridColumn, String(c + 1), `tile(${r},${c}) grid column`);
    }
  }
}
console.log("ok — board: 25 tiles + 5 bundled 1x2 rectangles, all slots mapped");

// ---------- 4. input validation ----------

keydown("c"); keydown("r"); keydown("a"); keydown("t");
keydown("Enter");
runTimers();
assert.equal(toast.textContent, "Not enough letters");
assert.ok(tile(0, 0).classList.contains("shake"), "row shakes on invalid submit");
assert.equal(tile(1, 1).classList.contains("carried"), false, "no row advance");

const BAD = ["qqqqq", "jjjjj", "vvvvv"].find((w) => !DICT.has(w));
assert.ok(BAD, "need an invalid 5-letter test word");
"crat".split("").forEach(() => keydown("Backspace"));
BAD.split("").forEach(keydown);
keydown("Enter");
runTimers();
assert.equal(toast.textContent, "Not in word list");
assert.equal(tile(1, 1).classList.contains("carried"), false, "invalid word does not advance");
console.log(`ok — validation rejects short words and "${BAD}"`);

// ---------- 5. full winning game: pair states, carry mechanics, share ----------

const chain = buildChain("crane", true);
for (let r = 0; r < 6; r++) {
  // clear whatever the validation section left typed
  for (let b = 0; b < 6; b++) keydown("Backspace");
  typeRow(r, chain[r]);

  if (r >= 1) {
    const spent = pairEls[r - 1];
    assert.ok(spent.classList.contains("spent"), `pair ${r - 1} spent after its lower half scored`);
    assert.ok(!spent.classList.contains("armed"));
  }
  if (r < 5) {
    const col = CHAIN[r];
    const carried = tile(r + 1, col);
    assert.equal(carried.textContent, chain[r][col], `row ${r + 1} carries letter at col ${col}`);
    assert.ok(carried.classList.contains("carried"), "carried class applied");

    const pair = pairEls[r];
    assert.ok(pair.classList.contains("armed"), `pair ${r} armed while letter is live`);
    assert.ok(!pair.classList.contains("chain"), "chain preview done");

    // carried tile cannot be erased, typing skips it
    const before = carried.textContent;
    for (let b = 0; b < 10; b++) keydown("Backspace");
    assert.equal(carried.textContent, before, "backspace cannot erase carried tile");
    for (let c = 0; c < 5; c++) {
      if (c !== col) assert.equal(tile(r + 1, c).textContent, "", "other slots empty");
    }
  }
}

for (const p of pairEls) {
  assert.ok(p.classList.contains("spent"), "all pairs spent at game end");
  assert.ok(!p.classList.contains("armed") && !p.classList.contains("chain"));
}
assert.equal(banner.textContent, "Phew", "win banner on guess 6");
assert.ok(!shareBtn.classList.contains("hidden"), "share button appears on win");

shareBtn.click();
const ta = createdEls.filter((e) => e.tagName === "textarea").pop();
assert.ok(ta, "share staged a clipboard textarea");
const lines = ta.value.split("\n");
assert.equal(lines[0], "Bundle (Day 1) 6/6", "share header");
assert.equal(lines.length, 7, "header + 6 guess rows");
for (let i = 1; i <= 6; i++) {
  assert.equal([...lines[i]].length, 5, `share row ${i} has 5 cells`);
}
assert.equal([...lines[6]].every((ch) => ch === "\u{1F7E9}"), true, "final row all green");
console.log("ok — full win: carries land on 2nd/4th/3rd/1st/5th letter, pairs chain→armed→spent");

// ---------- 6. evaluation with duplicate letters ----------
// Answer "crane" has one 'e'; "eject" has two, neither on the green square.
// Wordle rules: first 'e' yellow (uses the answer's e), second 'e' gray
// (supply exhausted), and the answer's 'c' is still unmatched → yellow.
newGame(); // answer still "crane"
"eject".split("").forEach(keydown);
keydown("Enter");
runTimers();
const expected = ["present", "absent", "absent", "present", "absent"];
for (let c = 0; c < 5; c++) {
  assert.ok(tile(0, c).classList.contains(expected[c]), `tile(0,${c}) → ${expected[c]}`);
}
console.log("ok — duplicate letters: 'eject' vs 'crane' scored per Wordle rules");

// ---------- 7. keyboard state colors ----------

const keyTiles = byId.keyboard.children.flatMap((row) => row.children);
const keyFor = (letter) => keyTiles.find((k) => k.textContent === letter);
assert.ok(keyFor("e").classList.contains("present"),
  "'e' key stays yellow — the later gray must not overwrite it");
assert.ok(keyFor("c").classList.contains("present"), "'c' key yellow");
assert.ok(keyFor("t").classList.contains("absent"), "'t' key gray");
console.log("ok — on-screen keyboard reflects letter states");

// ---------- 8. losing game + end-of-game lock ----------

newGame();
const losing = buildChain("crane", false);
for (let r = 0; r < 6; r++) typeRow(r, losing[r]);
assert.equal(banner.textContent, "The word was CRANE");
assert.ok(!shareBtn.classList.contains("hidden"), "share offered after loss");

// game is over: typing and backspace must do nothing
const frozen = tile(5, 0).textContent;
keydown("a");
keydown("Backspace");
assert.equal(tile(5, 0).textContent, frozen, "board frozen after game over");
console.log("ok — losing game reveals answer and locks the board");

// ---------- 9. new puzzle resets everything ----------

newGame();
assert.equal(banner.textContent, "", "banner cleared");
assert.ok(shareBtn.classList.contains("hidden"), "share hidden again");
for (let i = 0; i < 5; i++) {
  assert.ok(pairEls[i].classList.contains("chain"), `pair ${i} back to chain preview`);
}
for (let r = 0; r < 6; r++) {
  for (let c = 0; c < 5; c++) {
    const t = tile(r, c);
    assert.equal(t.textContent, "", `tile(${r},${c}) cleared`);
    for (const cls of ["correct", "present", "absent", "carried", "reveal", "filled"]) {
      assert.ok(!t.classList.contains(cls), `tile(${r},${c}) has no ${cls}`);
    }
  }
}
console.log("ok — new puzzle resets board, pairs, banner and buttons");

console.log("\nAll bundle tests passed.");
