// Headless tests for js/wobble.js. Loads the real game scripts against a
// minimal DOM stub and drives full games through the keyboard handler.
// Run: node tests/wobble.test.js
"use strict";

const assert = require("assert/strict");
const path = require("path");

// ---------- minimal DOM / browser stubs (before loading the games) ----------

const timers = [];
globalThis.setTimeout = (fn, delay, ...args) => {
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
["board", "turnline", "banner", "toast", "new-btn", "share-btn", "keyboard"]
  .forEach((id) => { byId[id] = makeEl("div"); });
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
const GAME_URL = "https://suitangi.github.io/30Wordles/days/3";

require(path.join(__dirname, "..", "js", "wobble.js"));
const WOBBLE = globalThis.WOBBLE;
assert.ok(WOBBLE, "wobble.js must expose window.WOBBLE");

const board = byId.board;
const turnline = byId.turnline;
const banner = byId.banner;
const toast = byId.toast;
const newBtn = byId["new-btn"];
const shareBtn = byId["share-btn"];

const rowEl = (r) => board.children[r];
const tile = (r, c) => rowEl(r).children[c];
const keyFor = (letter) => {
  for (const row of byId.keyboard.children) {
    const k = row.children.find((b) => b.textContent === letter);
    if (k) return k;
  }
  return null;
};
const readSave = () => JSON.parse(globalThis.localStorage.getItem("wobble-day3"));

const keydown = (key) =>
  (windowHandlers.keydown || []).forEach((fn) =>
    fn({ key, metaKey: false, ctrlKey: false, altKey: false }));

function dailyGame() { WOBBLE.daily(); }

function seedDaily(answer, guesses = []) {
  globalThis.localStorage.setItem("wobble-day3", JSON.stringify({
    date: WOBBLE.todayKey(), answer, guesses, done: false, won: false,
  }));
  dailyGame();
}

// Type letters + Enter. An optional word longer than 5 is a test bug.
function typeWord(word) {
  for (const ch of word) keydown(ch);
  keydown("Enter");
  runTimers();
}

// Independent two-pass Wordle evaluation (the spec's scoring rule).
function evaluate(guess, target) {
  const marks = Array(guess.length).fill("absent");
  const left = {};
  for (let i = 0; i < target.length; i++) {
    if (guess[i] === target[i]) marks[i] = "correct";
    else left[target[i]] = (left[target[i]] || 0) + 1;
  }
  for (let j = 0; j < target.length; j++) {
    if (marks[j] !== "correct" && left[guess[j]] > 0) {
      marks[j] = "present";
      left[guess[j]]--;
    }
  }
  return marks;
}

function bundleAnswerFor(key) {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return ANSWERS[h % ANSWERS.length];
}

// ---------- 1. word lists ----------

assert.equal(ANSWERS.length, 2315, "answers count");
assert.equal(DICT.size, 14855, "guessable count");
const PROBES = globalThis.WOBBLE_PROBES || null;
// probe words live inside wobble.js; sanity via behavior instead of a handle
assert.ok(WOBBLE.evaluate, "evaluate exposed for tests");
console.log("ok — word lists (2315 answers, 14855 commit words)");

// ---------- 2. scoring + windows ----------

const ev = WOBBLE.evaluate;
assert.deepEqual(ev("crane", "crane"), ["correct", "correct", "correct", "correct", "correct"]);
assert.deepEqual(ev("eject", "crane"), ["present", "absent", "absent", "present", "absent"],
  "duplicate letters scored per Wordle rules");
assert.deepEqual(WOBBLE.probeWindow(0), [0, 1, 2, 3], "probe 1 reads columns 1-4");
assert.deepEqual(WOBBLE.probeWindow(1), [1, 2, 3, 4], "probe 2 reads columns 2-5");
assert.deepEqual(WOBBLE.probeWindow(4), [0, 1, 2, 3], "probe 5 is odd again");
console.log("ok — scoring: two-pass Wordle, windows alternate by probe count");

// ---------- 3. daily salt differs from the other variants ----------

let differing = 0;
for (let i = 0; i < 200; i++) {
  const key = `2026-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`;
  if (WOBBLE.answerFor(key) !== bundleAnswerFor(key)) differing++;
}
assert.ok(differing > 150, `daily salt differs (${differing}/200 dates)`);
console.log(`ok — daily salt: differs from Bundle on ${differing}/200 sampled dates`);

// ---------- 4. fresh daily: one probe row, countdown ----------

store.clear();
dailyGame();

assert.equal(board.children.length, 1, "one pending row");
assert.equal(rowEl(0).children.length, 5, "five tile slots");
assert.equal(tile(0, 4).style.display, "none", "probe rows hide the 5th slot");
assert.ok(!rowEl(0).classList.contains("even"), "probe 1 rides columns 1-4");
assert.equal(turnline.textContent, "Guess 1 of 8", "turnline announces the first guess");
const freshSave = readSave();
assert.equal(freshSave.date, WOBBLE.todayKey(), "save stamped with today");
assert.equal(freshSave.answer, WOBBLE.answerFor(WOBBLE.todayKey()), "daily answer date-derived");
assert.deepEqual(freshSave.guesses, [], "no guesses yet");
console.log("ok — fresh daily: probe row, countdown live");

// ---------- 5. validation ----------

keydown("n"); keydown("e"); keydown("a");
keydown("Enter");
runTimers();
assert.equal(toast.textContent, "Not enough letters", "3 letters rejected");

keydown("Backspace");
"zzzz".split("").forEach(keydown);
keydown("Enter");
runTimers();
assert.equal(toast.textContent, "Not in word list", "unknown probe rejected");

"zzzz".split("").forEach(() => keydown("Backspace"));
"qqqqq".split("").forEach(keydown);
keydown("Enter");
runTimers();
assert.equal(toast.textContent, "Not in word list", "unknown commit rejected");
console.log("ok — validation: short, probe-list, and commit-list rejects");

// ---------- 6. wobble: parity alternates across probes ----------

seedDaily("crane");

typeWord("near"); // probe 1, odd window (columns 1-4)
// near vs crane: yellows match the whole word — n present, e present,
// a correct (column 3), r present
const nearMarks = WOBBLE.evaluateProbe("near", [0, 1, 2, 3]);
assert.deepEqual(nearMarks, ["present", "present", "correct", "present"]);
for (let c = 0; c < 4; c++) {
  assert.ok(tile(0, c).classList.contains(nearMarks[c]),
    `probe tile(0,${c}) marked ${nearMarks[c]}`);
}
assert.equal(tile(0, 4).style.display, "none", "scored probe keeps 5th slot hidden");
assert.ok(rowEl(0).classList.contains("probe"), "row typed as probe");
assert.ok(!rowEl(0).classList.contains("even"), "probe 1 stays left");
assert.equal(turnline.textContent, "Guess 2 of 8", "countdown advances");

typeWord("rent"); // probe 2, even window (columns 2-5)
assert.ok(rowEl(1).classList.contains("even"), "probe 2 rides columns 2-5");
// rent vs crane: r correct (absolute column 2), e present, n correct
// (column 4), t absent — not in the word at all
const rentMarks = WOBBLE.evaluateProbe("rent", [1, 2, 3, 4]);
assert.deepEqual(rentMarks, ["correct", "present", "correct", "absent"]);
assert.ok(tile(1, 0).classList.contains("correct"), "even probe greens map to column 2");
assert.equal(turnline.textContent, "Guess 3 of 8", "parity flips back after probe 2");

const midSave = readSave();
assert.deepEqual(midSave.guesses, [
  { w: "near", t: "p" }, { w: "rent", t: "p" },
], "probes saved with their type");
console.log("ok — wobble: windows alternate by probe count, greens map to true columns");

// ---------- 6b. a wrong commit is an instant loss ----------

typeWord("least"); // 5 letters — commit, and it's wrong
assert.equal(banner.textContent, "The word was CRANE", "wrong commit loses on the spot");
assert.equal(board.children.length, 3, "two probe rows + the losing commit, no pending row");
assert.ok(rowEl(2).classList.contains("commit"), "losing commit still shows its colors");
const lostEarly = readSave();
assert.equal(lostEarly.done, true, "commit loss saved done");
assert.equal(lostEarly.won, false, "commit loss saved not won");
console.log("ok — commits are final: a wrong 5-letter guess ends the game");

// ---------- 7. probe yellows see the whole word; only greens are windowed ----------

// "onion" = o,n,i,o,n. Even window covers columns 2-5 = n,i,o,n — the word's
// two o's sit at columns 1 (hidden) and 3. "loom" holds two o's at window
// positions that are i and n: both still come back yellow.
seedDaily("onion");
typeWord("area"); // probe 1, odd window — shares no letters with onion
typeWord("loom"); // probe 2, even window
const s = readSave();
assert.equal(s.guesses[1].t, "p", "loom played as probe");
const marks = WOBBLE.evaluateProbe("loom", [1, 2, 3, 4]);
assert.deepEqual(marks, ["absent", "present", "correct", "absent"],
  "pos1 'o' yellow via the hidden column's o — only position is windowed, not presence");
for (let c = 0; c < 4; c++) {
  assert.ok(tile(1, c).classList.contains(marks[c]), `mark on tile(1,${c})`);
}
console.log("ok — probe yellows match the whole word; only greens are window-scoped");

// ---------- 8. full win: commit ends the game immediately ----------

seedDaily("crane");
typeWord("near");
typeWord("crane");
assert.equal(banner.textContent, "Magnificent", "praise on turn-2 win");
assert.ok(!shareBtn.classList.contains("hidden"), "share appears on win");
assert.equal(board.children.length, 2, "no extra row after the win");
const frozen = tile(1, 0).textContent;
keydown("a");
keydown("Backspace");
assert.equal(tile(1, 0).textContent, frozen, "board locked after win");
const winSave = readSave();
assert.equal(winSave.done, true, "win saved done");
assert.equal(winSave.won, true, "win saved won");
assert.deepEqual(winSave.guesses, [
  { w: "near", t: "p" }, { w: "crane", t: "c" },
], "winning game saved");

shareBtn.click();
const ta = createdEls.filter((e) => e.tagName === "textarea").pop();
assert.ok(ta, "share staged a clipboard textarea");
const lines = ta.value.split("\n");
assert.match(lines[0], /^Wobble · \d{4}-\d{2}-\d{2} · 2\/8$/, "share shows date and turns");
assert.equal(lines[1], GAME_URL, "share links to the game");
assert.equal(lines.length, 4, "header + link + two guess rows");
// probe 1 is an odd window (columns 1-4): squares then a trailing blank
assert.equal([...lines[2]].length, 5, "odd probe row pads to 5 on the right");
assert.equal([...lines[2]][4], "\u2B1B", "light theme pads the empty side with a dark square");
assert.ok([...lines[2]].slice(0, 4).every((ch) => ch === "\u{1F7E9}" || ch === "\u{1F7E8}" || ch === "\u2B1C" || ch === "\u2B1B"),
  "probe squares are wordle emoji");
assert.equal(lines[3], "\u{1F7E9}".repeat(5), "winning commit row all green");

// debug dump: full replay of the on-screen game
const dump = WOBBLE.dump();
assert.match(dump, /answer: CRANE/, "dump names the answer");
assert.match(dump, /1\. NEAR  probe  cols 1-4  YYGY/, "dump replays probes with windows");
assert.match(dump, /2\. CRANE  commit  GGGGG/, "dump replays commits with marks");
assert.match(dump, /turns: 2\/8 · probes: 1 · next probe window: 2-5/, "dump counts probes");
assert.match(dump, /raw save: /, "dump includes the raw save");
console.log("ok — debug dump replays the full game");
console.log("ok — full win: immediate end, share = " + lines[0]);

// ---------- 9. turn 8: probes rejected, wrong commit loses ----------

seedDaily("crane");
const fillers = ["near", "rent", "sees", "tear", "east", "read", "area"];
for (const w of fillers) typeWord(w);
assert.equal(board.children.length, 8, "seven scored rows + turn-8 row");
assert.ok(turnline.classList.contains("final"), "turnline flags the forced commit");
assert.equal(turnline.textContent, "Guess 8 of 8 — commit only", "turn 8 announced");

typeWord("rent"); // a 4-letter probe must be refused now
assert.equal(toast.textContent, "Turn 8 is commit only", "probe rejected on turn 8");
assert.equal(board.children.length, 8, "rejected probe consumed no turn");
assert.equal(readSave().guesses.length, 7, "no guess saved");

// the typed letters stay on the board for fixing; swap to a real commit
"rent".split("").forEach(() => keydown("Backspace"));
typeWord("raise"); // wrong commit on turn 8
assert.equal(banner.textContent, "The word was CRANE", "loss reveals the answer");
assert.ok(!shareBtn.classList.contains("hidden"), "share offered after loss");
const lost = readSave();
assert.equal(lost.done, true, "loss saved done");
assert.equal(lost.won, false, "loss saved not won");
assert.equal(lost.guesses.length, 8, "all eight turns saved");
assert.equal(board.children.length, 8, "board frozen at eight rows");
console.log("ok — turn 8: probe refused, losing commit ends the game");

// ---------- 10. refresh mid-game: restore windows, layout, countdown ----------

seedDaily("crane");
typeWord("near");
typeWord("rent");
dailyGame();
assert.equal(board.children.length, 3, "two scored rows + pending row");
for (let c = 0; c < 4; c++) {
  assert.equal(tile(0, c).textContent, "near"[c], "probe letters restored");
  assert.ok(tile(0, c).classList.contains(WOBBLE.evaluateProbe("near", [0, 1, 2, 3])[c]),
    "probe marks restored");
  assert.ok(!tile(0, c).classList.contains("reveal"), "no flip animation on restore");
}
assert.equal(tile(0, 4).style.display, "none", "probe row restores hidden slot");
assert.ok(!rowEl(0).classList.contains("even"), "probe row stays left");
for (let c = 0; c < 4; c++) {
  assert.ok(tile(1, c).classList.contains(WOBBLE.evaluateProbe("rent", [1, 2, 3, 4])[c]),
    "even probe marks restored");
}
assert.equal(tile(1, 4).style.display, "none", "restored probe hides slot 5");
assert.ok(rowEl(1).classList.contains("even"), "restored even probe stays offset");
assert.ok(!rowEl(2).classList.contains("even"), "pending row rides columns 1-4 again");
assert.equal(turnline.textContent, "Guess 3 of 8", "countdown restored");

// typing continues on the restored row: 4 letters probe-mode, 5th flips layout
"near".split("").forEach(keydown);
assert.equal(tile(2, 0).textContent, "n", "typing lands in the pending row");
assert.equal(tile(2, 4).style.display, "none", "probe mode hides slot 5");
keydown("s"); // 5th letter — switches the row to commit layout
assert.equal(tile(2, 4).style.display, "", "5th letter reveals the commit slot");
assert.ok(!rowEl(2).classList.contains("even"), "commit layout is flat");
for (let i = 0; i < 6; i++) keydown("Backspace");
typeWord("crane");
assert.equal(banner.textContent, "Impressive", "win after refresh (turn 3 praise)");
console.log("ok — refresh mid-game: marks, layout and countdown restored, play resumes");

// ---------- 11. refresh after finishing ----------

dailyGame();
assert.equal(banner.textContent, "Impressive", "finished banner restored");
assert.ok(!shareBtn.classList.contains("hidden"), "share offered again");
assert.equal(tile(2, 4).textContent, "e", "restored commit shows all five letters");
assert.equal(tile(2, 4).style.display, "", "restored commit slot 5 is visible");
assert.ok(!rowEl(2).classList.contains("even"), "restored commit sits flat");
keydown("a");
assert.equal(board.children.length, 3, "restored board stays locked");
console.log("ok — refresh after finishing: board, banner and lock restored");

// a losing commit restored after an odd probe count must also sit flat
globalThis.localStorage.setItem("wobble-day3", JSON.stringify({
  date: WOBBLE.todayKey(), answer: "crane", done: true, won: false,
  guesses: [{ w: "near", t: "p" }, { w: "raise", t: "c" }],
}));
dailyGame();
assert.equal(banner.textContent, "The word was CRANE", "loss banner restored");
assert.ok(!rowEl(1).classList.contains("even"), "commit after odd probe count sits flat");
assert.equal(tile(1, 4).textContent, "e", "losing commit shows all five letters");
assert.equal(tile(1, 4).style.display, "", "losing commit slot 5 visible");
console.log("ok — restored commits sit flat and show all five letters");

// ---------- 12. next day: fresh puzzle ----------

const stale = readSave();
stale.date = "1999-12-31";
globalThis.localStorage.setItem("wobble-day3", JSON.stringify(stale));
dailyGame();
const nextSave = readSave();
assert.notEqual(nextSave.date, "1999-12-31", "stale save replaced");
assert.equal(nextSave.answer, WOBBLE.answerFor(WOBBLE.todayKey()), "new day, new word");
assert.deepEqual(nextSave.guesses, [], "guesses reset");
assert.equal(board.children.length, 1, "single pending row");
assert.equal(turnline.textContent, "Guess 1 of 8", "countdown reset");
console.log("ok — next day: fresh board and countdown");

// ---------- 13. practice mode: forced/random word, daily save untouched ----------

const saveBeforePractice = globalThis.localStorage.getItem("wobble-day3");
WOBBLE.practice("crane"); // debugging: force the practice answer
assert.equal(banner.textContent, "Practice round", "practice banner shown");
assert.equal(newBtn.textContent, "Today\u2019s puzzle", "button offers the way back");
assert.match(WOBBLE.dump(), /answer: CRANE/, "forced practice word is in effect");
typeWord("near");
typeWord("rent");
assert.equal(globalThis.localStorage.getItem("wobble-day3"), saveBeforePractice,
  "practice guesses never touch the daily save");
shareBtn.classList.remove("hidden"); // reach the share format mid-practice
shareBtn.click();
const pta = createdEls.filter((e) => e.tagName === "textarea").pop();
assert.match(pta.value.split("\n")[0], /^Wobble · practice · X\/8$/,
  "unfinished practice share shows X/8");
newBtn.click();
assert.equal(newBtn.textContent, "Practice", "button back to Practice");
console.log("ok — practice mode: forced word, no save writes, round-trips to daily");

// ---------- 14. keyboard: best mark across probe + commit ----------

seedDaily("crane");
typeWord("near"); // probe: n present, e absent, a correct, r present
typeWord("crane"); // winning commit: every letter green
assert.ok(keyFor("a").classList.contains("correct"), "'a' green from both guesses");
assert.ok(keyFor("e").classList.contains("correct"),
  "'e' upgrades to green — probe gray must not cap the commit green");
assert.ok(keyFor("n").classList.contains("correct"),
  "'n' upgrades to green from the winning commit");
assert.ok(keyFor("c").classList.contains("correct"), "'c' green from the commit");
console.log("ok — keyboard merges probe and commit evidence by best rank");

console.log("\nAll wobble tests passed.");
