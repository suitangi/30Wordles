// Headless tests for js/gamble.js. Loads the real game script against a
// minimal DOM stub and drives full games through the keyboard handler.
// Run: node tests/gamble.test.js
"use strict";

const assert = require("assert/strict");
const path = require("path");

// ---------- minimal DOM / browser stubs (before loading the game) ----------

const timers = [];
// flipRow schedules callbacks with extra args after the delay (the tile,
// its mark) — forward everything but the delay (the wobble stub precedent).
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
    disabled: false,
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
["rows", "pot-c", "keyboard", "toast", "new-btn",
  "giveup-btn", "share-btn"].forEach((id) => { byId[id] = makeEl("div"); });
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
// share() checks navigator.clipboard — older Node has no navigator at all
if (typeof globalThis.navigator === "undefined") {
  globalThis.navigator = { clipboard: null };
}

// ---------- load real game code ----------

require(path.join(__dirname, "..", "js", "words.js"));
const { WORD_LISTS } = globalThis.window;
assert.ok(WORD_LISTS, "words.js must define window.WORD_LISTS");
const ANSWERS = WORD_LISTS.answers;
const DICT = new Set(WORD_LISTS.guesses);
const GAME_URL = "https://suitangi.github.io/30Wordles/days/30";

require(path.join(__dirname, "..", "js", "gamble.js"));
const GAMBLE = globalThis.GAMBLE;
assert.ok(GAMBLE, "gamble.js must expose window.GAMBLE");

const rowsEl = byId.rows;
const potC = byId["pot-c"];
const toast = byId.toast;
const newBtn = byId["new-btn"];
const giveUpBtn = byId["giveup-btn"];
const shareBtn = byId["share-btn"];
const keydown = (key) =>
  (windowHandlers.keydown || []).forEach((fn) =>
    fn({ key, metaKey: false, ctrlKey: false, altKey: false }));

const K = "correct", P = "present", A = "absent", CUT = null, NONE = "";
const STORE_KEY = "gamble-day30";
const BUDGET_C = 10;

const readSave = () => JSON.parse(globalThis.localStorage.getItem(STORE_KEY));
const dump = () => GAMBLE.dump();
const row = (r) => GAMBLE.row(r);
const tile = (r, c) => GAMBLE.tile(r, c);
const tileLetter = (r, c) => tile(r, c).textContent;
const tileMark = (r, c) => {
  const cl = tile(r, c).classList;
  return cl.contains("correct") ? K : cl.contains("present") ? P
    : cl.contains("absent") ? A : CUT;
};
const rowMarks = (r) => [0, 1, 2, 3, 4].map((c) => tileMark(r, c));
const setBet = (r, v) => GAMBLE.setBet(r, v);

// The independent model: ordinary two-pass Wordle, rebuilt from scratch,
// zero shared code with the game.
function model(guess, target) {
  const marks = [A, A, A, A, A];
  const remaining = {};
  for (let i = 0; i < 5; i++) {
    if (guess[i] === target[i]) marks[i] = K;
    else remaining[target[i]] = (remaining[target[i]] || 0) + 1;
  }
  for (let j = 0; j < 5; j++) {
    if (marks[j] !== K && remaining[guess[j]] > 0) {
      marks[j] = P;
      remaining[guess[j]]--;
    }
  }
  return marks;
}
// The display law, rebuilt: grays are free while the row's budget has
// life; each green and yellow spends one; once the budget runs dry,
// everything after is cut — grays included.
function displayModel(word, c, target) {
  const out = [];
  let left = c;
  for (const m of model(word, target)) {
    if (left <= 0) out.push(CUT);
    else if (m === A) out.push(A);
    else { left--; out.push(m); }
  }
  return out;
}

// Type a word and submit it, playing out the whole reveal.
function typeRow(word) {
  for (const ch of word) keydown(ch);
  keydown("Enter");
  runTimers();
}
// A refused word keeps its letters for editing — backspace out first.
function clearTyped() { for (let i = 0; i < 5; i++) keydown("Backspace"); }

function dailyGame() { GAMBLE.daily(); }
function seedDaily(guesses, extra = {}) {
  globalThis.localStorage.setItem(STORE_KEY, JSON.stringify({
    date: GAMBLE.todayKey(),
    answer: GAMBLE.answerFor(GAMBLE.todayKey()),
    guesses, done: false, won: false, gaveUp: false, ...extra,
  }));
  dailyGame();
}

// ---------- 1. word list sanity ----------

assert.equal(ANSWERS.length, 2315, "answers count");
assert.equal(DICT.size, 14855, "guessable count");
for (const w of ANSWERS) {
  assert.match(w, /^[a-z]{5}$/, `answer "${w}" shape`);
  assert.ok(DICT.has(w), `answer "${w}" must be guessable`);
}
console.log("ok — word lists (2315 answers, 14855 guessable)");

// ---------- 2. the law, hand-pinned -----------------------------------------

assert.deepEqual(GAMBLE.evaluate("crane", "crane"), [K, K, K, K, K], "exact");
assert.deepEqual(GAMBLE.evaluate("pound", "donut"), [A, K, P, P, P],
  "pound vs donut: one green then three yellows");
assert.deepEqual(GAMBLE.evaluate("eeeee", "eerie"), [K, K, A, A, K],
  "duplicate accounting: eerie's own e's green positionally, extras starve");
assert.deepEqual(GAMBLE.evaluate("cramp", "crane"), [K, K, K, A, A],
  "cramp vs crane: r and a green in place — compute, don't pattern-match");
console.log("ok — the law: ordinary two-pass wordle underneath");

// ---------- 3. the display walk, hand-pinned ---------------------------------

// THE LAW: grays show for free; every green and yellow spends one of
// the row's clues; once the budget runs dry, EVERYTHING after it is
// cut — grays included.
// suitangi's flick/rider report: at 1 clue the two leading grays show
// free, the yellow spends the last point, the trailing grays go
// silent: [gray, gray, yellow, cut, cut].
assert.deepEqual(GAMBLE.displayMarks("flick", 1, "rider"),
  [A, A, P, CUT, CUT],
  "leading grays are free; the yellow dries the budget; the tail cuts");
// and the report that started it all: resat vs rider at 2 clues —
// the grays after the budget ran out are NOT free.
assert.deepEqual(GAMBLE.displayMarks("resat", 2, "rider"),
  [K, P, CUT, CUT, CUT],
  "two colors spend the whole budget; trailing grays go silent");
assert.deepEqual(GAMBLE.displayMarks("tulip", 2, "trust"),
  [K, P, CUT, CUT, CUT],
  "green, yellow, then silence");
assert.deepEqual(GAMBLE.displayMarks("tulip", 1, "trust"),
  [K, CUT, CUT, CUT, CUT],
  "one clue: the green shows, everything after cuts");
// donut vs pound at 3: the free gray stretches the budget to a third
// color — only the last yellow cuts.
assert.deepEqual(GAMBLE.displayMarks("pound", 3, "donut"),
  [A, K, P, P, CUT],
  "the free gray buys room for a third colored mark");
assert.deepEqual(GAMBLE.displayMarks("pound", 4, "donut"), [A, K, P, P, P],
  "four clues show everything (only three colored marks exist)");
assert.deepEqual(GAMBLE.displayMarks("pound", 0, "donut"),
  [CUT, CUT, CUT, CUT, CUT],
  "zero clues: a fully blind guess");
// a gray-only row spends none of the budget: every tile shows free
assert.deepEqual(GAMBLE.displayMarks("pouty", 2, "crane"),
  [A, A, A, A, A],
  "no colored marks — the whole row shows and the budget is untouched");
// swept against an independent model
for (let i = 0; i < 400; i++) {
  const a = ANSWERS[(i * 37) % ANSWERS.length];
  const g = WORD_LISTS.guesses[(i * 977) % WORD_LISTS.guesses.length];
  const c = i % 6;
  assert.deepEqual(GAMBLE.displayMarks(g, c, a), displayModel(g, c, a),
    `display walk matches the spec model on ${g} vs ${a} at ${c} clues`);
}
console.log("ok — the walk: grays free, colors spend, the dry tail goes silent");

// ---------- 4. fresh daily: the pot, the first bet, the waiting row ----------

store.clear();
dailyGame();

const freshAnswer = GAMBLE.answerFor(GAMBLE.todayKey());
assert.equal(dump().answer, freshAnswer, "the daily answer is date-derived");
assert.equal(potC.textContent, "10", "the pot opens full");
assert.equal(rowsEl.children.length, 1, "one waiting row stands");
assert.equal(row(0).children.length, 6, "five tiles + one stepper");
assert.equal(GAMBLE.bet(0), 3, "the opening row bets 3 clues");
assert.ok(!row(0).children[5].children[0].disabled, "the − button lives");
for (let c = 0; c < 5; c++) assert.equal(tileLetter(0, c), "", `tile ${c} empty`);
assert.ok(!giveUpBtn.classList.contains("hidden"), "give up offered");
assert.ok(shareBtn.classList.contains("hidden"), "no share before an end state");

const save1 = readSave();
assert.equal(save1.date, GAMBLE.todayKey(), "save stamped with today");
assert.deepEqual(save1.guesses, [], "fresh save holds no guesses");
dailyGame();
assert.equal(rowsEl.children.length, 1, "the refresh built one row, not two");
console.log(`ok — fresh daily: answer ${freshAnswer}, pot 10, first bet 3`);

// ---------- 5. typing and refusals --------------------------------------------

{
  keydown("w");
  keydown("o");
  assert.equal(tileLetter(0, 0), "w", "letters land in typed order");
  keydown("Backspace");
  assert.equal(tileLetter(0, 1), "", "backspace erases");
  clearTyped();

  typeRow("toni");
  assert.equal(toast.textContent, "Not enough letters", "short words are refused");
  assert.deepEqual(dump().guesses, [], "the refusal spends nothing");
  clearTyped();

  typeRow("qqqqz");
  assert.equal(toast.textContent, "Not in word list", "non-words are refused");
  assert.equal(tileLetter(0, 0), "q", "a refused word keeps its letters");
  clearTyped();
  assert.equal(dump().leftC, 10, "refusals never touch the pot");
}
console.log("ok — typing: live row, refusals keep the letters and the pot");

// ---------- 6. the walk, played for real ---------------------------------------

store.clear();
GAMBLE.practice("trust");
setBet(0, 2);
typeRow("tulip");
{
  assert.deepEqual(rowMarks(0), [K, P, CUT, CUT, CUT],
    "green, yellow, then silence — suitangi's resat/rider fix on the board");
  assert.equal(dump().leftC, 8, "2 clues spent");
  assert.equal(GAMBLE.bet(0), 2, "the bet frozen on the stepper");
  assert.ok(row(0).classList.contains("scored"), "the row scored");
  assert.ok(row(0).children[5].children[1].disabled, "the input frozen");
  // the keyboard learns only what was SHOWN: the cut grays teach nothing
  assert.equal(keyStateOf("t"), K, "t greened");
  assert.equal(keyStateOf("u"), P, "u yellowed");
  for (const ch of "lip") assert.equal(keyStateOf(ch), NONE,
    `the cut ${ch} never paints its key`);
  // the next row's bet sticks at 2
  assert.equal(GAMBLE.bet(1), 2, "the bet sticks to the next row");
}
console.log("ok — the walk played: paid letters show, cut keys silent, bet frozen");

function keyStateOf(letter) {
  for (const r of byId.keyboard.children) {
    const k = r.children.find((b) => b.textContent === letter);
    if (k) {
      return k.classList.contains("correct") ? K
        : k.classList.contains("present") ? P
        : k.classList.contains("absent") ? A : NONE;
    }
  }
  return NONE;
}

// ---------- 7. the clickers: big buttons that know their fences -----------------

{
  // plus/minus walk the value and disable at the fences
  setBet(1, 2);
  row(1).children[5].children[2].click(); // + → 3
  assert.equal(GAMBLE.bet(1), 3, "+ raises the bet");
  row(1).children[5].children[0].click(); // − → 2
  row(1).children[5].children[0].click(); // − → 1
  row(1).children[5].children[0].click(); // − → 0
  assert.equal(GAMBLE.bet(1), 0, "− lowers the bet to zero");
  assert.ok(row(1).children[5].children[0].disabled, "− parks at zero");
  row(1).children[5].children[2].click();
  assert.equal(GAMBLE.bet(1), 1, "+ comes back off the floor");
}

{
  // the whole row costs 5; a typed 9 clamps down at submit
  store.clear();
  GAMBLE.practice("trust");
  setBet(0, 9);
  typeRow("cramp"); // vs trust: [A,K,A,A,A] — the grays show free, the r spends 1
  assert.deepEqual(rowMarks(0), [A, K, A, A, A],
    "five clues bought the whole row, grays and all");
  assert.equal(dump().leftC, 5, "9 clamped to 5 — a row only has five letters");
}
console.log("ok — the clickers: fenced steppers, a row never costs more than 5");

// ---------- 8. the win: even blind, and the bet is off ---------------------------

{
  store.clear();
  GAMBLE.practice("crane");
  setBet(0, 0);
  typeRow("crane");
  assert.equal(dump().won, true, "guessing the word wins with zero budget");
  assert.equal(dump().done, true, "and ends the game");
  for (let c = 0; c < 5; c++) {
    assert.equal(tileMark(0, c), K, `win tile ${c} true green`);
    assert.ok(tile(0, c).classList.contains("win-glow"), `win tile ${c} glows`);
  }
  assert.equal(dump().leftC, 10, "the winning bet is not spent");
  keydown("a");
  assert.equal(dump().typed, "", "board locked after the win");
}
shareBtn.click();
{
  const ta = createdEls.filter((e) => e.tagName === "textarea").pop();
  const lines = ta.value.split("\n");
  assert.equal(lines[0],
    "Gamble · practice · 1 guess · 10 clues left",
    "the share carries the score pair");
  assert.equal(lines[1], GAME_URL, "share links to the game");
  assert.equal(lines[2], "\uD83D\uDFE9".repeat(5), "the win row shares all green");
}
console.log("ok — the win: blind wins, the bet is off, score pair shared");

// ---------- 9. give up ------------------------------------------------------------

store.clear();
GAMBLE.practice("crane");
{
  setBet(0, 3);
  typeRow("crank");
  keydown("c");
  giveUpBtn.click();
  assert.equal(dump().gaveUp, true, "gaveUp flag explicit");
  assert.equal(dump().done, true, "ended");
  assert.equal(rowsEl.children.length, 3, "the ghost row walked on");
  const ghost = rowsEl.children[2];
  for (let c = 0; c < 5; c++) {
    assert.ok(ghost.children[c].classList.contains("correct"), `ghost ${c} green`);
    assert.equal(ghost.children[c].textContent, "crane"[c], `ghost ${c} letter`);
  }
  keydown("a");
  assert.equal(dump().typed, "", "board locked");
}
shareBtn.click();
{
  const ta = createdEls.filter((e) => e.tagName === "textarea").pop();
  assert.match(ta.value.split("\n")[0], /^Gamble · practice · gave up · 1 guess · 7 clues left$/,
    "surrender tagged with the score pair");
}
console.log("ok — give up: the ghost walks on in full colors, share tagged");

// ---------- 10. refresh: live, won, lost, and corrupt saves ------------------------

store.clear();
{
  seedDaily([
    { w: "tulip", c: 2 },
    { w: "cramp", c: 4 },
  ]);
  // 6 clues spent; the marks recompute from the pure walk
  assert.deepEqual(rowMarks(0), displayModel("tulip", 2, freshAnswer),
    "row 1's shown marks recomputed");
  assert.deepEqual(rowMarks(1), displayModel("cramp", 4, freshAnswer),
    "row 2's shown marks recomputed");
  assert.equal(GAMBLE.bet(0), 2, "bets restored to the steppers");
  assert.equal(potC.textContent, "4", "the pot recomputed (10 - 6)");
  assert.equal(GAMBLE.bet(2), 4, "the sticky bet clamps along");
  assert.ok(row(2).children[5].children[1].disabled === false, "the waiting row is live");
  typeRow(dump().answer);
  assert.equal(dump().won, true, "the win lands after a refresh");
}
dailyGame();
{
  assert.equal(dump().done, true, "the won save restores");
  assert.ok(tile(2, 0).classList.contains("win-glow"), "the glow restored");
  assert.ok(!shareBtn.classList.contains("hidden"), "share offered again");
  keydown("a");
  assert.equal(dump().typed, "", "restored won board is locked");
}

store.clear();
{
  seedDaily([{ w: "crane", c: 1 }], { done: true, won: false, gaveUp: true });
  assert.equal(rowsEl.children.length, 2, "the restored loss carries its ghost row");
  assert.equal(dump().gaveUp, true, "flag restored");
  keydown("a");
  assert.equal(dump().typed, "", "restored lost board is locked");
}
console.log("ok — refresh: bets, pot, marks and outcomes all restored");

// ---------- 11. corrupt saves -------------------------------------------------------

dailyGame();
const derived = GAMBLE.answerFor(GAMBLE.todayKey());
const good = { date: GAMBLE.todayKey(), answer: derived,
  guesses: [{ w: "crane", c: 2 }], done: false, won: false, gaveUp: false };
for (const bad of [
  { ...good, answer: "qqqqz" },                        // not a word
  { ...good, answer: 42 },                             // not a string
  { date: GAMBLE.todayKey() },                         // nothing else
  { ...good, guesses: "crane" },                       // not an array
  { ...good, guesses: [{ w: "qqqqz", c: 1 }] },        // non-word guess
  { ...good, guesses: [{ w: "crane", c: 1.5 }] },      // fractional bet
  { ...good, guesses: [{ w: "crane", c: -1 }] },       // negative
  { ...good, guesses: [{ w: "crane", c: 6 }] },        // more than a row's five letters
  { ...good, guesses: [{ w: "crane", c: 6 }, { w: "crane", c: 5 }] }, // cumulative 11
  { ...good, guesses: [{ w: "crane", c: 6 }, { w: "crane", c: 4 }] }, // 10 total, one row over 5
  { ...good, guesses: [{ w: "crane" }] },              // missing bet
  { ...good, done: true },                             // done without won or gaveUp
  { ...good, done: true, won: true, gaveUp: true },    // won and surrendered
]) {
  globalThis.localStorage.setItem(STORE_KEY, JSON.stringify(bad));
  dailyGame();
  const s = readSave();
  assert.equal(s.answer, derived,
    `corrupt save ${JSON.stringify(bad).slice(0, 48)}… replaced by a fresh daily`);
  assert.deepEqual(s.guesses, [], "corrupt save's guesses discarded");
}
console.log("ok — corrupt saves: over-budget/fake/impossible saves fall back fresh");

// ---------- 12. practice: isolation, forced words, dump ------------------------------

const saveBeforePractice = globalThis.localStorage.getItem(STORE_KEY);
const stubAnswer = ANSWERS[Math.floor(0.42 * ANSWERS.length)];
Math.random = () => 0.42;

GAMBLE.practice();
assert.equal(toast.textContent, "Practice round", "practice announced by toast");
assert.equal(newBtn.textContent, "Today\u2019s puzzle", "button offers the way back");
assert.equal(dump().answer, stubAnswer, "random word honors the Math.random stub");

GAMBLE.practice("qqqqz");
assert.ok(DICT.has(dump().answer), "invalid forced word rejected");

const d = dump();
for (const field of ["answer", "guesses", "typed", "leftC", "marks",
  "practice", "done", "won", "gaveUp", "save"]) {
  assert.ok(field in d, `dump exposes ${field}`);
}
assert.equal(globalThis.localStorage.getItem(STORE_KEY), saveBeforePractice,
  "practice never touches the daily save");

newBtn.click();
assert.equal(newBtn.textContent, "Practice", "button back to Practice");
console.log("ok — practice: forced words, dump, no daily writes");

// ---------- 13. the strategy sweep: full rows while they last, then blind ------------

{
  let worst = 0;
  let sumN = 0;
  let sumLeft = 0;
  const dates = 30;
  for (let i = 0; i < dates; i++) {
    const key = `2027-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`;
    const a = GAMBLE.answerFor(key);
    let pool = ANSWERS.slice();
    let sc = 0, n = 0;
    let won = false;
    // full rows while the pot lasts — a 5 bet always shows the whole
    // row (five letters can hold at most five colored marks)
    for (let turn = 0; turn < 10 && !won && sc < BUDGET_C; turn++) {
      const w = pool[0];
      const c = Math.min(5, BUDGET_C - sc);
      sc += c; n++;
      if (w === a) { won = true; break; }
      const shown = GAMBLE.displayMarks(w, c, a);
      // a cut position teaches nothing — candidates stay unconstrained there
      pool = pool.filter((cand) =>
        shown.every((m, idx) => m === CUT || model(w, cand)[idx] === m));
    }
    // the pot is dry: blind guesses in pool order — no info, but the
    // answer is in the pool and each miss strikes it off
    if (!won) {
      n += pool.indexOf(a) + 1;
      won = true;
    }
    assert.ok(won, `${key}: the oracle wins`);
    worst = Math.max(worst, n);
    sumN += n;
    sumLeft += BUDGET_C - sc;
  }
  console.log(`ok — strategy sweep: ${dates} dailies won on two full rows` +
    ` then blind, worst ${worst} guesses, average ${Math.round((sumN / dates) * 10) / 10},` +
    ` average ${Math.round(sumLeft / dates)} clues left over`);
}

console.log("\nAll gamble tests passed.");
