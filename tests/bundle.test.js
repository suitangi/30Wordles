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
    style: {},
    offsetWidth: 0,
    type: "",
    _handlers: {},
    appendChild(child) { this.children.push(child); return child; },
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
const GAME_URL = "https://suitangi.github.io/30Wordles/days/1";

require(path.join(__dirname, "..", "js", "bundle.js"));
const BUNDLE = globalThis.BUNDLE;
assert.ok(BUNDLE, "bundle.js must expose window.BUNDLE");

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

function dailyGame() {
  BUNDLE.daily();
  rebuildMap();
}

const tile = (r, c) => tileMap[r][c];
const readSave = () => JSON.parse(globalThis.localStorage.getItem("bundle-day1"));

// Force today's daily puzzle to `answer` (optionally with guesses played).
function seedDaily(answer, guesses = []) {
  const cur = readSave() || { date: BUNDLE.todayKey() };
  globalThis.localStorage.setItem("bundle-day1", JSON.stringify({
    date: cur.date, answer, guesses, done: false, won: false,
  }));
  dailyGame();
}

// Wordle evaluation, mirrored here to compute expected marks independently.
function evaluate(guess, target) {
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

// ---------- 3. daily puzzle: fresh day, structure, save seeded ----------

store.clear();
dailyGame();

assert.equal(board.children.length, 25, "20 square tiles + 5 pair rectangles");
assert.equal(pairEls.length, 5, "5 bundled rectangles");
for (let i = 0; i < 5; i++) {
  const p = pairEls[i];
  assert.equal(p.style.gridColumn, String(CHAIN[i] + 1), `pair ${i} column`);
  assert.equal(p.style.gridRow, `${2 * i + 1} / span 3`, `pair ${i} spans 2 rows + seam`);
  assert.ok(p.classList.contains("chain"), `pair ${i} starts in chain preview`);
  assert.equal(p.children.length, 2, `pair ${i} has two halves`);
}
for (let r = 0; r < 6; r++) {
  for (let c = 0; c < 5; c++) {
    assert.ok(tile(r, c), `tile(${r},${c}) exists`);
    assert.equal(tile(r, c).textContent, "", `tile(${r},${c}) starts empty`);
  }
}

const freshSave = readSave();
assert.equal(freshSave.date, BUNDLE.todayKey(), "save stamped with today");
assert.equal(freshSave.answer, BUNDLE.answerFor(BUNDLE.todayKey()), "daily answer is date-derived");
assert.deepEqual(freshSave.guesses, [], "no guesses yet");
assert.equal(freshSave.done, false, "not done");
console.log(`ok — daily puzzle: today is ${freshSave.date}, word locked in save`);
console.log("ok — board: 25 tiles + 5 bundled 1x2 rectangles, all slots mapped");

// ---------- 4. input validation ----------

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

// ---------- 5. full winning game: pair states, carries, save, share ----------

seedDaily("crane");
const chain = buildChain("crane", true);
for (let r = 0; r < 6; r++) {
  for (let b = 0; b < 6; b++) keydown("Backspace");
  typeRow(r, chain[r]);

  if (r === 0) {
    // section 4 shook this row with a rejected submit; the real submit
    // must clear `shake` so the flip animation can play
    for (let c = 0; c < 5; c++) {
      assert.ok(!tile(0, c).classList.contains("shake"), `tile(0,${c}) shake cleared on submit`);
      assert.ok(tile(0, c).classList.contains("reveal"), `tile(0,${c}) flipping`);
    }
  }

  if (r >= 1) {
    assert.ok(pairEls[r - 1].classList.contains("spent"), `pair ${r - 1} spent`);
  }
  if (r < 5) {
    const col = CHAIN[r];
    const carried = tile(r + 1, col);
    assert.equal(carried.textContent, chain[r][col], `row ${r + 1} carries letter at col ${col}`);
    assert.ok(carried.classList.contains("carried"), "carried class applied");
    assert.ok(pairEls[r].classList.contains("armed"), `pair ${r} armed`);
    const before = carried.textContent;
    for (let b = 0; b < 10; b++) keydown("Backspace");
    assert.equal(carried.textContent, before, "backspace cannot erase carried tile");
  }
}

for (const p of pairEls) assert.ok(p.classList.contains("spent"), "all pairs spent");
assert.equal(banner.textContent, "Phew", "win banner on guess 6");
assert.ok(!shareBtn.classList.contains("hidden"), "share button appears on win");

const winSave = readSave();
assert.equal(winSave.answer, "crane");
assert.deepEqual(winSave.guesses, chain, "all six guesses saved");
assert.equal(winSave.done, true, "save marked done");
assert.equal(winSave.won, true, "save marked won");

shareBtn.click();
const ta = createdEls.filter((e) => e.tagName === "textarea").pop();
assert.ok(ta, "share staged a clipboard textarea");
const lines = ta.value.split("\n");
assert.match(lines[0], /^Bundle · \d{4}-\d{2}-\d{2} · 6\/6$/, "share shows date, not Day 1");
assert.equal(lines[1], GAME_URL, "share links to the game");
assert.equal(lines.length, 8, "header + link + 6 guess rows");
assert.equal([...lines[7]].every((ch) => ch === "\u{1F7E9}"), true, "final row all green");
console.log("ok — full win: carries, pairs chain→armed→spent, share = " + lines[0]);

// ---------- 6. refresh mid-game: save, restore, keep playing ----------

seedDaily("crane");
const midChain = buildChain("crane", true);
typeRow(0, midChain[0]);
typeRow(1, midChain[1]);

let s = readSave();
assert.deepEqual(s.guesses, midChain.slice(0, 2), "two guesses persisted");

dailyGame(); // simulates a page refresh
for (let r = 0; r < 2; r++) {
  const marks = evaluate(midChain[r], "crane");
  for (let c = 0; c < 5; c++) {
    const t = tile(r, c);
    assert.equal(t.textContent, midChain[r][c], `restored tile(${r},${c}) letter`);
    assert.ok(t.classList.contains(marks[c]), `restored tile(${r},${c}) → ${marks[c]}`);
    assert.ok(!t.classList.contains("reveal"), "restored board has no flip animation");
    assert.ok(!t.classList.contains("carried"), "scored tiles drop carried styling");
  }
}
assert.equal(tile(2, CHAIN[1]).textContent, midChain[1][CHAIN[1]], "carried letter restored in row 2");
assert.ok(tile(2, CHAIN[1]).classList.contains("carried"), "restored carried tile locked");
assert.ok(pairEls[1].classList.contains("armed"), "pair above active row armed");
assert.ok(pairEls[0].classList.contains("spent"), "pair above scored row spent");

// keyboard colors came back too: each key shows the best rank it earned
// across both restored rows
const keyFor = (letter) => {
  const tiles = byId.keyboard.children.flatMap((row) => row.children);
  return tiles.find((k) => k.textContent === letter);
};
const RANKC = { absent: 1, present: 2, correct: 3 };
const bestMark = {};
for (let r = 0; r < 2; r++) {
  const marks = evaluate(midChain[r], "crane");
  for (let c = 0; c < 5; c++) {
    const L = midChain[r][c];
    if (!bestMark[L] || RANKC[marks[c]] > RANKC[bestMark[L]]) bestMark[L] = marks[c];
  }
}
for (const L of Object.keys(bestMark)) {
  assert.ok(keyFor(L).classList.contains(bestMark[L]),
    `key '${L}' restored to ${bestMark[L]}`);
}

// typing lands in row 2 (the restored active row)
"crane".split("").forEach(() => keydown("Backspace"));
for (let b = 0; b < 6; b++) keydown("Backspace");
typeRow(2, midChain[2]);
assert.equal(tile(2, 0).textContent, midChain[2][0], "active row after refresh is row 2");

for (let r = 3; r < 6; r++) {
  for (let b = 0; b < 6; b++) keydown("Backspace");
  typeRow(r, midChain[r]);
}
s = readSave();
assert.equal(s.done, true, "game completed after refresh");
assert.equal(s.won, true, "won after refresh");
assert.equal(banner.textContent, "Phew", "win banner after refreshed finish");
console.log("ok — refresh mid-game: board, carried letter, keys and progress all restored");

// ---------- 7. refresh after finishing: completed board, frozen ----------

dailyGame();
assert.equal(banner.textContent, "Phew", "finished banner restored");
assert.ok(!shareBtn.classList.contains("hidden"), "share offered again");
const frozen = tile(5, 0).textContent;
keydown("a");
keydown("Backspace");
assert.equal(tile(5, 0).textContent, frozen, "restored finished board is locked");
console.log("ok — refresh after finishing: completed board and lock restored");

// ---------- 8. next day: fresh puzzle ----------

s = readSave();
s.date = "1999-12-31";
globalThis.localStorage.setItem("bundle-day1", JSON.stringify(s));
dailyGame();

s = readSave();
assert.notEqual(s.date, "1999-12-31", "stale save replaced");
assert.equal(s.date, BUNDLE.todayKey(), "re-stamped with today");
assert.equal(s.answer, BUNDLE.answerFor(BUNDLE.todayKey()), "new day, new daily word");
assert.deepEqual(s.guesses, [], "guesses reset");
for (let r = 0; r < 6; r++) {
  for (let c = 0; c < 5; c++) {
    const t = tile(r, c);
    assert.equal(t.textContent, "", `tile(${r},${c}) cleared`);
    for (const cls of ["correct", "present", "absent", "carried", "reveal", "filled"]) {
      assert.ok(!t.classList.contains(cls), `tile(${r},${c}) has no ${cls}`);
    }
  }
}
for (const p of pairEls) assert.ok(p.classList.contains("chain"), "pairs back to chain preview");
assert.equal(banner.textContent, "", "banner cleared");
console.log("ok — next day: fresh board and a new date-derived word");

// ---------- 9. evaluation with duplicate letters ----------

seedDaily("crane");
// "eject" has two e's, neither on the green square: first yellow (uses the
// answer's e), second gray (supply exhausted); answer's c unmatched → yellow.
"eject".split("").forEach(keydown);
keydown("Enter");
runTimers();
const expected = ["present", "absent", "absent", "present", "absent"];
for (let c = 0; c < 5; c++) {
  assert.ok(tile(0, c).classList.contains(expected[c]), `tile(0,${c}) → ${expected[c]}`);
}
console.log("ok — duplicate letters: 'eject' vs 'crane' scored per Wordle rules");

// ---------- 10. keyboard state colors ----------

assert.ok(keyFor("e").classList.contains("present"),
  "'e' key stays yellow — the later gray must not overwrite it");
assert.ok(keyFor("c").classList.contains("present"), "'c' key yellow");
assert.ok(keyFor("t").classList.contains("absent"), "'t' key gray");
console.log("ok — on-screen keyboard reflects letter states");

// ---------- 11. losing game ----------

seedDaily("crane");
const losing = buildChain("crane", false);
for (let r = 0; r < 6; r++) typeRow(r, losing[r]);
assert.equal(banner.textContent, "The word was CRANE");
assert.ok(!shareBtn.classList.contains("hidden"), "share offered after loss");
const lost = readSave();
assert.equal(lost.done, true, "loss saved as done");
assert.equal(lost.won, false, "loss saved as not won");
const frozenLost = tile(5, 0).textContent;
keydown("a");
keydown("Backspace");
assert.equal(tile(5, 0).textContent, frozenLost, "board frozen after loss");
console.log("ok — losing game reveals answer, saves the loss, locks the board");

// ---------- 12. practice mode: random word, daily save untouched ----------

const craneIdx = ANSWERS.indexOf("crane");
Math.random = () => (craneIdx + 0.5) / ANSWERS.length;
const saveBeforePractice = globalThis.localStorage.getItem("bundle-day1");

BUNDLE.practice();
rebuildMap();
assert.equal(banner.textContent, "Practice round", "practice banner shown");
assert.equal(newBtn.textContent, "Today\u2019s puzzle", "button offers the way back");
for (let r = 0; r < 6; r++) {
  for (let c = 0; c < 5; c++) assert.equal(tile(r, c).textContent, "", "practice board fresh");
}

const practiceChain = buildChain("crane", true);
for (let r = 0; r < 4; r++) typeRow(r, practiceChain[r]);

assert.equal(globalThis.localStorage.getItem("bundle-day1"), saveBeforePractice,
  "practice guesses never touch the daily save");

shareBtn.click();
const pta = createdEls.filter((e) => e.tagName === "textarea").pop();
assert.match(pta.value.split("\n")[0], /^Bundle · practice · X\/6$/,
  "unfinished practice share shows X/6 with practice tag");

newBtn.click(); // back to today's puzzle
rebuildMap();
assert.equal(newBtn.textContent, "Practice", "button back to Practice");
assert.equal(banner.textContent, "The word was CRANE", "daily loss restored from save");
console.log("ok — practice mode: random word, no save writes, round-trips to daily");

console.log("\nAll bundle tests passed.");
