// Headless tests for js/idle.js. Loads the real game script against a
// minimal DOM stub and drives full games through the keyboard handler.
// Run: node tests/idle.test.js
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
// Recorded, never fired: the clock ticker and (in reduced-motion mode)
// the marquee stepper are display-only — firing them would hang node
// (the Hustle stub lesson).
globalThis.setInterval = () => 0;
globalThis.clearInterval = () => {};
// The marquee's rAF loop must not run headless — the tests step the
// scroll by hand through IDLE.mqStep(ms).
globalThis.requestAnimationFrame = undefined;
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
    clientWidth: 0,
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
["board", "stage", "start-btn", "keyboard", "toast", "new-btn",
  "giveup-btn", "share-btn", "clock", "clock-hint",
  "marquee"].forEach((id) => { byId[id] = makeEl("div"); });
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
const GAME_URL = "https://suitangi.github.io/30Wordles/days/29";

require(path.join(__dirname, "..", "js", "idle.js"));
const IDLE = globalThis.IDLE;
assert.ok(IDLE, "idle.js must expose window.IDLE");

const board = byId.board;
const stage = byId.stage;
const startBtn = byId["start-btn"];
const marquee = byId.marquee;
const clock = byId.clock;
const clockHint = byId["clock-hint"];
const toast = byId.toast;
const newBtn = byId["new-btn"];
const giveUpBtn = byId["giveup-btn"];
const shareBtn = byId["share-btn"];
const keydown = (key) =>
  (windowHandlers.keydown || []).forEach((fn) =>
    fn({ key, metaKey: false, ctrlKey: false, altKey: false }));

const K = "correct", P = "present", A = "absent", NONE = "";
const STORE_KEY = "idle-day29";

const readSave = () => JSON.parse(globalThis.localStorage.getItem(STORE_KEY));
const dump = () => IDLE.dump();
const tile = (c) => IDLE.tile(c);
const tileLetter = (c) => tile(c).textContent;
const tileMark = (c) => {
  const cl = tile(c).classList;
  return cl.contains("correct") ? K : cl.contains("present") ? P
    : cl.contains("absent") ? A : NONE;
};
const markOf = (el) => {
  const cl = el.classList;
  return cl.contains("correct") ? K : cl.contains("present") ? P
    : cl.contains("absent") ? A : NONE;
};
const track = () => marquee.children[0];
const mqTile = (letter, copy = 0) => {
  const half = track().children[copy];
  return half.children.find((t) => t.textContent === letter);
};
// The model of the marquee's law: the color letter ch earns on column c.
function markAtModel(ch, c, target) {
  if (target[c] === ch) return K;
  return target.includes(ch) ? P : A;
}
// Step the marquee scroll until `letter` stands on column `col`, plus a
// small nudge into the nearest-column window (one tile = 510ms).
function stepOnto(letter, col) {
  const idx = dump().alphabet.indexOf(letter);
  const target = ((idx - col) % 26 + 26) % 26;
  const u = dump().mqU;
  let delta = ((target - u) % 26 + 26) % 26;
  if (delta === 0) delta = 26; // a full loop — never a zero step
  IDLE.mqStep(delta * 510 + 40);
}
// The player's mark: the start button reveals the board and starts the
// clock together.
function pressStart() { startBtn.click(); }
// Type a word and submit it, playing out the whole reveal.
function typeRow(word) {
  for (const ch of word) keydown(ch);
  keydown("Enter");
  runTimers();
}
// A refused word keeps its letters for editing — backspace out first.
function clearTyped() { for (let i = 0; i < 5; i++) keydown("Backspace"); }

function dailyGame() { IDLE.daily(); }
function seedDone(extra = {}) {
  globalThis.localStorage.setItem(STORE_KEY, JSON.stringify({
    date: IDLE.todayKey(),
    answer: IDLE.answerFor(IDLE.todayKey()),
    guess: "", elapsedMs: 0,
    done: true, won: false, gaveUp: false, ...extra,
  }));
  dailyGame();
}

// The independent model: ordinary two-pass Wordle, rebuilt from scratch,
// zero shared code with the game (it grades the one guess for the share).
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

// ---------- 1. word list sanity ----------

assert.equal(ANSWERS.length, 2315, "answers count");
assert.equal(DICT.size, 14855, "guessable count");
for (const w of ANSWERS) {
  assert.match(w, /^[a-z]{5}$/, `answer "${w}" shape`);
  assert.ok(DICT.has(w), `answer "${w}" must be guessable`);
}
console.log("ok — word lists (2315 answers, 14855 guessable)");

// ---------- 2. the grading law, hand-pinned ---------------------------------

assert.deepEqual(IDLE.evaluate("crane", "crane"), [K, K, K, K, K], "exact");
assert.deepEqual(IDLE.evaluate("crank", "crane"), [K, K, K, K, A],
  "crank vs crane: the stray k grays");
assert.deepEqual(IDLE.evaluate("eeeee", "eerie"), [K, K, A, A, K],
  "duplicate accounting: eerie's own e's green positionally, extras starve to gray");
assert.deepEqual(IDLE.evaluate("cramp", "crane"), [K, K, K, A, A],
  "cramp vs crane: r and a green in place — compute, don't pattern-match");
assert.deepEqual(IDLE.evaluate("pound", "donut"), [A, K, P, P, P],
  "pound vs donut: the trailing d yellows against donut's opening d");
console.log("ok — the law: ordinary two-pass wordle (grades the share)");

// ---------- 3. the law, swept against an independent model ------------------

for (let i = 0; i < 400; i++) {
  const a = ANSWERS[(i * 37) % ANSWERS.length];
  const g = WORD_LISTS.guesses[(i * 977) % WORD_LISTS.guesses.length];
  assert.deepEqual(IDLE.evaluate(g, a), model(g, a),
    `game evaluate matches the spec model on ${g} vs ${a}`);
}
console.log("ok — 400 pairs: game evaluate is the spec model");

// ---------- 4. the day's alphabet --------------------------------------------

{
  const key = IDLE.todayKey();
  const alpha = IDLE.alphabetFor(key);
  assert.equal(alpha.length, 26, "26 letters");
  assert.deepEqual([...alpha].sort(), [..."abcdefghijklmnopqrstuvwxyz"],
    "a permutation of the whole alphabet, each letter once");
  assert.deepEqual(IDLE.alphabetFor(key), alpha, "deterministic per date");

  const seen = new Set();
  for (let i = 0; i < 60; i++) {
    const k = `2027-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`;
    seen.add(IDLE.alphabetFor(k).join(""));
  }
  assert.ok(seen.size >= 58, `the shuffle varies by day (${seen.size}/60 distinct)`);
}
console.log("ok — the marquee order: date-seeded permutation, deterministic");

// ---------- 5. fresh load: dark stage, waiting Start -------------------------

store.clear();
dailyGame();

const freshAnswer = IDLE.answerFor(IDLE.todayKey());
const freshAlpha = IDLE.alphabetFor(IDLE.todayKey());
assert.equal(dump().answer, freshAnswer, "the daily answer is date-derived");
assert.equal(dump().started, false, "the game waits for Start");
assert.equal(dump().running, false, "the clock is not running");
assert.equal(clock.textContent, "0:00.0", "the clock rests at zero");
assert.ok(!stage.classList.contains("started"), "the stage is dark");
assert.ok(!startBtn.classList.contains("hidden"), "Start is offered");
assert.ok(giveUpBtn.classList.contains("hidden"), "no give up before Start");
assert.ok(!clockHint.classList.contains("hidden"), "the hint shows");

// marquee: the day's alphabet twice over, letters up, all dark
assert.equal(track().children.length, 2, "the track holds two copies");
for (let copy = 0; copy < 2; copy++) {
  const half = track().children[copy];
  assert.equal(half.children.length, 26, `copy ${copy} carries 26 letters`);
  for (let i = 0; i < 26; i++) {
    const t = half.children[i];
    assert.equal(t.textContent, freshAlpha[i], `letter ${i} in day order`);
    assert.equal(markOf(t), NONE, `letter ${freshAlpha[i]} starts dark`);
  }
}
// the input row: five empty tiles
assert.equal(board.children.length, 1, "one input row stands");
assert.equal(board.children[0].children.length, 5, "five tiles");
for (let c = 0; c < 5; c++) assert.equal(tileLetter(c), "", `tile ${c} empty`);
assert.ok(shareBtn.classList.contains("hidden"), "no share before an end state");

// the whole matrix is armed: 26 letters × 5 columns, all true
{
  const flat = dump().mqMarks;
  assert.equal(flat.length, 130, "26 letters × 5 columns armed");
  for (let i = 0; i < 26; i++) {
    for (let c = 0; c < 5; c++) {
      const e = flat.find((x) => x.letter === freshAlpha[i] && x.col === c);
      assert.ok(e, `entry for ${freshAlpha[i]} at column ${c}`);
      assert.equal(e.mark, markAtModel(freshAlpha[i], c, freshAnswer),
        `${freshAlpha[i]} on column ${c} carries its true color`);
    }
  }
}

// no typing, and nothing saved — the game doesn't exist until Start
keydown("a");
assert.equal(tileLetter(0), "", "typing is locked before Start");
assert.equal(dump().typed, "", "and nothing registered");
assert.equal(readSave(), null, "nothing persists before Start");
console.log("ok — fresh load: dark stage, Start waiting, clock at zero");

// ---------- 6. Start: the reveal and the clock begin together -----------------

{
  pressStart();
  assert.equal(dump().started, true, "Start opens the game");
  assert.equal(dump().running, true, "the clock started with the reveal");
  assert.ok(stage.classList.contains("started"), "the stage lit up");
  assert.ok(startBtn.classList.contains("hidden"), "Start retired");
  assert.ok(!giveUpBtn.classList.contains("hidden"), "give up offered");
  keydown("a");
  assert.equal(tileLetter(0), "a", "typing works once started");
  clearTyped();

  // every letter lights its true color at each of the five columns
  const sample = [0, 7, 13, 25].map((i) => freshAlpha[i]);
  for (const ch of sample) {
    for (let c = 0; c < 5; c++) {
      stepOnto(ch, c);
      const t = mqTile(ch);
      assert.equal(markOf(t), markAtModel(ch, c, freshAnswer),
        `${ch} on column ${c} lights ${markAtModel(ch, c, freshAnswer)}`);
      assert.equal(markOf(mqTile(ch, 1)), markAtModel(ch, c, freshAnswer),
        "copy 2 agrees");
    }
  }
  // the answer's own letters green on their own columns
  for (let c = 0; c < 5; c++) {
    const ch = freshAnswer[c];
    stepOnto(ch, c);
    assert.equal(markOf(mqTile(ch)), K, `answer letter ${ch} greens column ${c}`);
  }
  // a letter outside the answer grays at every column, never yellow/green
  const stranger = "abcdefghijklmnopqrstuvwxyz".split("")
    .find((ch) => !freshAnswer.includes(ch));
  for (let c = 0; c < 5; c++) {
    stepOnto(stranger, c);
    assert.equal(markOf(mqTile(stranger)), A, `stranger ${stranger} grays column ${c}`);
  }

  // CONTINUOUS lighting: a letter on the board is never dark between
  // columns — it slides yellow, green, yellow with no colorless gap,
  // and only goes dark once it has slid off the board
  const insider = freshAnswer.split("").find((ch) =>
    markAtModel(ch, 4, freshAnswer) !== K); // a letter NOT green on column 4
  assert.ok(insider, "an answer letter with yellow on column 4 exists");
  stepOnto(insider, 4);
  assert.notEqual(markOf(mqTile(insider)), NONE, "lit on column 4");
  const sawSequence = [];
  for (let k = 0; k < 17; k++) {
    IDLE.mqStep(127.5); // quarter-pitch steps: boundaries can't hide a gap
    const m = markOf(mqTile(insider));
    assert.notEqual(m, NONE, `never dark on the board (step ${k}: ${sawSequence})`);
    sawSequence.push(m);
  }
  // the traversal showed exactly its true column colors, 4→3→2→1→0
  const expected = [4, 3, 2, 1, 0]
    .map((c) => markAtModel(insider, c, freshAnswer));
  assert.deepEqual([...new Set(sawSequence)], [...new Set(expected)],
    "the traversal is the true color sequence, in order");
  // and off the board it is dark — the exit is the only silence
  IDLE.mqStep(1200);
  assert.equal(markOf(mqTile(insider)), NONE, "dark only off the board");

  // SIMULTANEOUS: at an aligned instant, all five on-board tiles are lit
  {
    const u = dump().mqU;
    IDLE.mqStep(((Math.ceil(u) - u) % 26) * 510); // land on an integer step
    const step = Math.round(dump().mqU) % 26;
    for (let c = 0; c < 5; c++) {
      const ch = dump().alphabet[(step + c) % 26];
      assert.notEqual(markOf(mqTile(ch)), NONE,
        `on-board letter at column ${c} is lit`);
    }
  }

  // the keyboard NEVER paints in this game — the marquee is the display
  for (const ch of "abcdefghijklmnopqrstuvwxyz") {
    assert.equal(keyStateOf(ch), NONE, `key ${ch} stays unpainted`);
  }
}
console.log("ok — the matrix: continuous colors, no gaps, all on-board letters lit");

function keyStateOf(letter) {
  for (const row of byId.keyboard.children) {
    const k = row.children.find((b) => b.textContent === letter);
    if (k) {
      return k.classList.contains("correct") ? K
        : k.classList.contains("present") ? P
        : k.classList.contains("absent") ? A : NONE;
    }
  }
  return NONE;
}

// ---------- 7. the one guess: refused words are free, a real word is spent -----

{
  // a non-word is refused and does NOT spend the guess
  typeRow("qqqqz");
  assert.equal(toast.textContent, "Not in word list", "word-checked");
  assert.equal(tileLetter(0), "q", "a refused word keeps its letters");
  assert.equal(dump().done, false, "the guess is not spent on a non-word");
  assert.equal(dump().running, true, "the clock never stopped");
  clearTyped();

  typeRow("toni");
  assert.equal(toast.textContent, "Not enough letters", "short words are refused");
  assert.equal(dump().done, false, "still unspent");
  clearTyped();
}
console.log("ok — refusals: not-a-word and too-short cost nothing");

// ---------- 8. a wrong guess is the loss -----------------------------------------

{
  const wrong = ["plots", "crank", "spume"]
    .find((w) => DICT.has(w) && w !== freshAnswer);
  typeRow(wrong);
  assert.equal(dump().done, true, "one guess, spent");
  assert.equal(dump().won, false, "and missed");
  for (let c = 0; c < 5; c++) {
    assert.equal(tileLetter(c), wrong[c], `the word stays on the row`);
    assert.equal(tileMark(c), NONE, "the row never wears colors");
  }
  assert.equal(board.children.length, 2, "the ghost answer walked on");
  const ghost = board.children[1];
  for (let c = 0; c < 5; c++) {
    assert.ok(ghost.children[c].classList.contains("correct"), `ghost ${c} green`);
    assert.equal(ghost.children[c].textContent, freshAnswer[c], `ghost ${c} letter`);
  }
  assert.equal(dump().running, false, "the clock froze");
  assert.ok(!shareBtn.classList.contains("hidden"), "share offered");
  keydown("a");
  assert.equal(dump().typed, "", "board locked");
}
shareBtn.click();
{
  const ta = createdEls.filter((e) => e.tagName === "textarea").pop();
  const lines = ta.value.split("\n");
  assert.match(lines[0], /· X\/1$/, "the miss shares X/1");
  assert.equal(lines[1], GAME_URL, "share links to the game");
  assert.equal(lines.length, 3, "the one guess shares its emoji line");
}
console.log("ok — the loss: the guess is spent, the ghost walks on, X/1");

// ---------- 9. the win: 1/1, the clock is the score ------------------------------

{
  store.clear();
  IDLE.practice("crane");
  pressStart();
  assert.equal(dump().started, true, "practice starts too");
  typeRow("crane");
  assert.equal(dump().won, true, "naming the word wins");
  assert.equal(dump().done, true, "and ends the game");
  for (let c = 0; c < 5; c++) {
    assert.equal(tileMark(c), K, `win tile ${c} green`);
    assert.ok(tile(c).classList.contains("win-glow"), `win tile ${c} glows`);
  }
  assert.equal(dump().running, false, "the clock stopped");
  assert.ok(clock.classList.contains("done"), "the clock froze in the accent");
  assert.match(clock.textContent, /^0:00\.\d$/, "the frozen time shows");
  keydown("a");
  assert.equal(dump().typed, "", "board locked after the win");
}
shareBtn.click();
{
  const ta = createdEls.filter((e) => e.tagName === "textarea").pop();
  const lines = ta.value.split("\n");
  assert.match(lines[0], /^Idle · practice · 1\/1$/, "the win shares 1/1");
  assert.equal(lines[1], GAME_URL, "share links to the game");
  assert.equal(lines[2],
    "CRANE " + "\uD83D\uDFE9".repeat(5), "the perfect guess shares five greens");
}
console.log("ok — the win: green row, frozen clock, 1/1 with the emoji line");

// ---------- 10. give up ------------------------------------------------------------

{
  store.clear();
  IDLE.practice("crane");
  pressStart();
  keydown("c");
  keydown("r");
  giveUpBtn.click();
  assert.equal(dump().gaveUp, true, "gaveUp flag explicit");
  assert.equal(dump().done, true, "ended");
  assert.equal(tileLetter(0), "", "the half-typed word cleared off the row");
  assert.equal(board.children.length, 2, "the ghost row walked on");
  keydown("a");
  assert.equal(dump().typed, "", "board locked");
}
shareBtn.click();
{
  const ta = createdEls.filter((e) => e.tagName === "textarea").pop();
  assert.equal(ta.value.split("\n")[0], "Idle · practice · gave up",
    "surrender shares gave up");
  assert.equal(ta.value.split("\n").length, 2, "no guess — no emoji line");
}

{
  // surrender without typing a thing — but never before Start
  store.clear();
  IDLE.practice("crane");
  assert.ok(giveUpBtn.classList.contains("hidden"), "no give up before Start");
  pressStart();
  giveUpBtn.click();
  assert.equal(dump().gaveUp, true, "immediate surrender works");
}
console.log("ok — give up: clears the row, walks the ghost, shares gave up");

// ---------- 11. refresh: finished results restore, live play starts fresh ----------

{
  // a won board re-shows green and the frozen time
  seedDone({ guess: freshAnswer, elapsedMs: 63400, done: true, won: true });
  for (let c = 0; c < 5; c++) {
    assert.equal(tileLetter(c), freshAnswer[c], "the answer sits on the row");
    assert.equal(tileMark(c), K, "restored win green");
    assert.ok(tile(c).classList.contains("win-glow"), "the glow restored");
  }
  assert.equal(clock.textContent, "1:03.4", "the frozen time restores exactly");
  assert.ok(clock.classList.contains("done"), "the clock stays done");
  assert.equal(dump().running, false, "not ticking");
  assert.ok(!shareBtn.classList.contains("hidden"), "share offered again");
  assert.ok(giveUpBtn.classList.contains("hidden"), "give up retired");
  keydown("a");
  assert.equal(dump().typed, "", "restored won board is locked");
  // the marquee still loops the full matrix for the restored board too
  stepOnto(freshAnswer[0], 0);
  assert.equal(markOf(mqTile(freshAnswer[0])), K, "the clues still light");
}

{
  // a lost board re-shows the spent word and the ghost
  const seedGuess = freshAnswer === "crane" ? "crank" : "crane";
  seedDone({ guess: seedGuess, elapsedMs: 12000, done: true, won: false });
  for (let c = 0; c < 5; c++) {
    assert.equal(tileLetter(c), seedGuess[c], "the spent word restored");
    assert.equal(tileMark(c), NONE, "colorless, as it always was");
  }
  assert.equal(board.children.length, 2, "the restored loss carries its ghost row");
  keydown("a");
  assert.equal(dump().typed, "", "restored lost board is locked");
}

{
  // a surrendered board restores too
  seedDone({ elapsedMs: 3000, done: true, gaveUp: true });
  assert.equal(board.children.length, 2, "the ghost row restored");
  assert.equal(dump().gaveUp, true, "flag restored");
}

{
  // a LIVE save restores the watch — started, and the clock never rewinds
  globalThis.localStorage.setItem(STORE_KEY, JSON.stringify({
    date: IDLE.todayKey(), answer: freshAnswer, guess: "", elapsedMs: 63400,
    done: false, won: false, gaveUp: false,
  }));
  dailyGame();
  assert.equal(dump().done, false, "live play resumes");
  assert.equal(dump().started, true, "an already-started run skips the gate");
  assert.ok(stage.classList.contains("started"), "the stage is up");
  assert.ok(startBtn.classList.contains("hidden"), "Start stays retired");
  assert.equal(dump().running, true, "the clock resumes ticking");
  assert.ok(dump().elapsed >= 63400, "from the banked time, never rewound");
  assert.equal(board.children.length, 1, "one clean row");
  keydown("a");
  assert.equal(tileLetter(0), "a", "typing works right away");
  clearTyped();
  // finishing from a restored run carries the banked time into the result
  typeRow(freshAnswer);
  assert.equal(dump().won, true, "the win lands");
  assert.ok(readSave().elapsedMs >= 63400, "the banked time reached the freeze");
}
console.log("ok — refresh: results restore green/ghost; a live watch resumes its clock");

// ---------- 12. corrupt saves -------------------------------------------------------

dailyGame();
const derived = IDLE.answerFor(IDLE.todayKey());
const good = { date: IDLE.todayKey(), answer: derived, guess: "crane",
  elapsedMs: 1200, done: true, won: true, gaveUp: false };
for (const bad of [
  { ...good, answer: "qqqqz" },                      // not a word
  { ...good, answer: 42 },                           // not a string
  { date: IDLE.todayKey() },                         // nothing else
  { ...good, done: false },                          // live saves carry no guess
  { ...good, won: "yes" },                           // not a boolean
  { ...good, won: true, gaveUp: true },              // won and surrendered
  { ...good, guess: "qqqqz" },                       // non-word guess
  { ...good, guess: "crat" },                        // wrong length
  { ...good, guess: 7 },                             // not a string
  { ...good, guess: "" },                            // wordless but not a give up
  { ...good, guess: "", won: true },                 // won without a word
  { ...good, elapsedMs: -5 },                        // negative time
  { ...good, elapsedMs: "x" },                       // not a number
  { ...good, elapsedMs: null },                      // JSON'd NaN arrives null
]) {
  globalThis.localStorage.setItem(STORE_KEY, JSON.stringify(bad));
  dailyGame();
  assert.equal(dump().done, false,
    `corrupt save ${JSON.stringify(bad).slice(0, 48)}… discarded`);
  assert.equal(dump().started, false, "back behind the Start gate");
  assert.equal(dump().running, false, "the clock waits for Start");
}
console.log("ok — corrupt saves: anything unreadable sits behind Start");

// ---------- 13. practice: isolation, forced words, dump ------------------------------

const saveBeforePractice = globalThis.localStorage.getItem(STORE_KEY);
const stubAnswer = ANSWERS[Math.floor(0.42 * ANSWERS.length)];
Math.random = () => 0.42;

IDLE.practice();
assert.equal(toast.textContent, "Practice round", "practice announced by toast");
assert.equal(newBtn.textContent, "Today\u2019s puzzle", "button offers the way back");
assert.equal(dump().answer, stubAnswer, "random word honors the Math.random stub");
assert.equal(dump().started, false, "practice waits for Start too");
pressStart();
assert.equal(dump().running, true, "practice clocks once started");

IDLE.practice("qqqqz");
assert.ok(DICT.has(dump().answer), "invalid forced word rejected");

const d = dump();
for (const field of ["answer", "alphabet", "guess", "typed", "started",
  "running", "elapsed", "mqU", "mqMarks", "mqStatic", "practice", "done",
  "won", "gaveUp", "save"]) {
  assert.ok(field in d, `dump exposes ${field}`);
}
assert.equal(globalThis.localStorage.getItem(STORE_KEY), saveBeforePractice,
  "practice never touches the daily save");

newBtn.click();
assert.equal(newBtn.textContent, "Practice", "button back to Practice");
console.log("ok — practice: forced words, dump, no daily writes");

// ---------- 14. the information sweep: when does the loop give the word up? -----------

{
  // events arrive in loop order: at tile-step u, the letters standing on
  // the five columns are alphabet[(u + c) % 26], each showing its true
  // color for that column. Filter the candidate pool event by event and
  // find where it collapses to the answer alone.
  const consistent = (w, ch, c, m) =>
    m === K ? w[c] === ch
      : m === P ? (w.includes(ch) && w[c] !== ch)
      : !w.includes(ch);
  let worstU = 0;
  let sumU = 0;
  let collapsed = 0;
  const dates = 40;
  for (let i = 0; i < dates; i++) {
    const key = `2027-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`;
    const a = IDLE.answerFor(key);
    const alpha = IDLE.alphabetFor(key);
    let pool = ANSWERS.slice();
    let collapseU = null;
    for (let u = 0; u < 26; u++) {
      for (let c = 0; c < 5; c++) {
        const ch = alpha[(u + c) % 26];
        const m = markAtModel(ch, c, a);
        pool = pool.filter((w) => consistent(w, ch, c, m));
      }
      if (pool.length === 1 && collapseU === null) collapseU = u;
    }
    assert.deepEqual(pool, [a], `${key}: the full loop determines the answer`);
    assert.ok(collapseU !== null, `${key}: the pool collapses within one loop`);
    assert.ok(pool[0] === a, `${key}: what it collapses to IS the answer`);
    worstU = Math.max(worstU, collapseU);
    sumU += collapseU;
    collapsed++;
  }
  assert.ok(worstU <= 25, `collapse always inside the loop (worst tile-step ${worstU})`);
  console.log(`ok — information sweep: ${collapsed}/${dates} dailies collapse to one` +
    ` candidate within the loop; worst after tile-step ${worstU}` +
    ` (~${Math.round(worstU * 0.51)}s of watching), average ${Math.round((sumU / dates) * 10) / 10}`);
}

console.log("\nAll idle tests passed.");
