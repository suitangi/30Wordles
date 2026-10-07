// Headless tests for js/quartile.js. Loads the real game script against a
// minimal DOM stub and drives full games through the keyboard handler.
// Run: node tests/quartile.test.js
"use strict";

const assert = require("assert/strict");
const path = require("path");

// ---------- minimal DOM / browser stubs (before loading the game) ----------

const timers = [];
// flipGuess schedules callbacks with extra args after the delay (the tile,
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
["board", "keyboard", "toast", "new-btn", "giveup-btn",
  "share-btn"].forEach((id) => { byId[id] = makeEl("div"); });
const createdEls = [];

globalThis.window = globalThis;
const windowHandlers = {};
globalThis.addEventListener = (t, fn) => { (windowHandlers[t] ||= []).push(fn); };
globalThis.document = {
  documentElement: { dataset: { theme: "dark" } },
  body: makeEl("body"),
  getElementById: (id) => byId[id],
  createElement: (tag) => { const el = makeEl(tag); createdEls.push(el); return el; },
  execCommand: () => true,
};

// ---------- load real game code ----------

require(path.join(__dirname, "..", "js", "words.js"));
const { WORD_LISTS } = globalThis.window;
assert.ok(WORD_LISTS, "words.js must define window.WORD_LISTS");
const GUESSES = WORD_LISTS.guesses;
const DICT = new Set(GUESSES);
const GAME_URL = "https://suitangi.github.io/30Wordles/days/24";
const ALPHA = "abcdefghijklmnopqrstuvwxyz";

require(path.join(__dirname, "..", "js", "quartile.js"));
const Q = globalThis.QUARTILE;
assert.ok(Q, "quartile.js must expose window.QUARTILE");

const board = byId.board;
const toast = byId.toast;
const newBtn = byId["new-btn"];
const giveUpBtn = byId["giveup-btn"];
const shareBtn = byId["share-btn"];
const keydown = (key) =>
  (windowHandlers.keydown || []).forEach((fn) =>
    fn({ key, metaKey: false, ctrlKey: false, altKey: false }));

const tiles = (r) => board.children[r].children;
const cellText = (r, c) => tiles(r)[c].textContent;
const rowText = (r) => tiles(r).map((t) => t.textContent).join("");
const markOf = (t) =>
  t.classList.contains("correct") ? "correct"
    : t.classList.contains("present") ? "present"
      : t.classList.contains("absent") ? "absent" : null;
const cellMark = (r, c) => markOf(tiles(r)[c]);
const keyEl = (letter) => {
  for (const row of byId.keyboard.children) {
    for (const k of row.children) {
      if (k.textContent === letter) return k;
    }
  }
  return null;
};
const readSave = () => JSON.parse(globalThis.localStorage.getItem("quartile-day24"));

// Type a word and submit it, playing out the whole reveal.
function typeRow(word) {
  for (const ch of word) keydown(ch);
  keydown("Enter");
  runTimers();
}

function practice(word) { Q.practice(word); }

function seedDaily(answer, guesses = [], extra = {}) {
  globalThis.localStorage.setItem("quartile-day24", JSON.stringify({
    date: Q.todayKey(), answer, guesses, done: false, won: false,
    gaveUp: false, ...extra,
  }));
  Q.daily();
}

// ---------- independent quartile model (the test's own truth) ----------------

const K = "correct", P = "present", A = "absent";

// Wordle's two pass, wrapped: a letter's position is the column its
// cell landed on ((s+i) mod 4), greens never consume, yellows come out
// of the letters the greens left behind.
function wrapped(guess, s, target) {
  const marks = Array(5).fill(A);
  const consumed = [false, false, false, false];
  for (let i = 0; i < 5; i++) {
    const col = (s + i) % 4;
    if (guess[i] === target[col]) { marks[i] = K; consumed[col] = true; }
  }
  const remain = {};
  for (let c = 0; c < 4; c++) if (!consumed[c]) remain[target[c]] = (remain[target[c]] || 0) + 1;
  for (let j = 0; j < 5; j++) {
    if (marks[j] !== K && remain[guess[j]] > 0) { marks[j] = P; remain[guess[j]]--; }
  }
  return marks;
}

// The stream: guess g lays letters onto cells 5g..5g+4; cell k sits at
// row floor(k/4), column k%4. Guess g opens at column g%4.
function startCol(g) { return g % 4; }
function marksThrough(guessList, answer) {
  const marks = [];
  guessList.forEach((w, g) => marks.push(...wrapped(w, startCol(g), answer)));
  return marks;
}
function greenRowOf(marks) {
  for (let r = 0; r * 4 + 3 < marks.length; r++) {
    if ([0, 1, 2, 3].every((c) => marks[r * 4 + c] === K)) return r;
  }
  return -1;
}

// ---------- 1. word list sanity + THE POOL ALGORITHM CHECK -------------------
//
// The spec's own demand: every 4-letter word served as an answer must
// be spellable across a row — a 4-substring of one 5-letter word (its
// head on a prefix row, its tail on a suffix row) or the end of one
// guess meeting the front of another (1+3, 2+2, 3+1). The pool keeps
// exactly the words that pass; this section re-derives the check
// independently and holds the game to it.

assert.equal(DICT.size, 14855, "guessable count");
for (const w of ["crane", "range", "cramp", "hoist", "donut", "pound",
  "spits", "pleat", "depot", "oozes", "trust"]) {
  assert.ok(DICT.has(w), `test word "${w}" is guessable`);
}

const POOL = Q.pool;
assert.ok(POOL.length >= 4200, `pool is large (${POOL.length})`);
assert.equal(POOL.length, 4251, "pool count pinned (the list is static)");
{
  const head = {}, tail = {};
  for (let k = 1; k <= 4; k++) { head[k] = new Set(); tail[k] = new Set(); }
  for (const w of GUESSES) {
    for (let j = 1; j <= 4; j++) { head[j].add(w.slice(0, j)); tail[j].add(w.slice(5 - j)); }
  }
  // a split row reads A's tail THEN B's head, so A's last j letters
  // must spell the answer's FIRST j and B's first 4-j the rest
  const constructible = (w) => {
    if (head[4].has(w) || tail[4].has(w)) return true;
    for (let j = 1; j <= 3; j++) {
      if (tail[j].has(w.slice(0, j)) && head[4 - j].has(w.slice(j))) return true;
    }
    return false;
  };
  for (const w of POOL) {
    assert.match(w, /^[a-z]{4}$/, `pool word "${w}" is four lowercase letters`);
    assert.ok(constructible(w), `pool word "${w}" is spellable across a row`);
  }
  // the known misses — real 4-letter strings no 5-letter word can spell
  // them across — must never serve
  for (const w of ["cdna", "dvds", "gmbh", "hdtv", "html", "http", "isbn",
    "jinx", "lynx", "mrna", "shhh", "smtp", "swum", "xnxx"]) {
    assert.ok(!constructible(w), `"${w}" is genuinely unspellable`);
    assert.ok(!POOL.includes(w), `"${w}" is excluded from the pool`);
  }
}
console.log(`ok — pool: ${POOL.length} four-letter answers, every one spellable across a row (algorithm check)`);

// ---------- 2. the wrapped scoring --------------------------------------------

assert.equal(Q.COLS, 4, "four columns");
for (let g = 0; g < 8; g++) assert.equal(Q.startCol(g), g % 4, `guess ${g} opens at column ${g % 4}`);

// pinned by hand: pled vs spits at s=0 — s,p,i,t,s land on cols 0,1,2,3,0;
// only the p is anywhere in pled, and the wrapped fifth s is not a
// second chance at column 0
assert.deepEqual(Q.evaluate("spits", 0, "pled"), [A, P, A, A, A],
  "spits on pled: stray p yellow, everything else gray");
// pinned by hand: onto vs oozes at s=2 — cols 2,3,0,1,2; the first o is
// yellow, the second o GREEN at column 3, and the wrapped third o at
// column 2 finds both copies spent (one green, one yellow) and dies
assert.ok(POOL.includes("onto"), '"onto" is a pool word');
assert.deepEqual(Q.evaluate("oozes", 2, "onto"), [P, K, A, A, A],
  "oozes on onto: one yellow o, one green o, the wrapped third o starves");
// pinned by hand: trust vs tots at s=0 — the t opening column 0 and the
// t wrapping back into column 0 BOTH go green; greens never consume
assert.ok(POOL.includes("tots"), '"tots" is a pool word');
assert.deepEqual(Q.evaluate("trust", 0, "tots"), [K, A, A, K, K],
  "trust on tots: column 0 judges both its letters and greens them both");
// the models agree everywhere it matters
for (const g of ["spits", "pleat", "depot", "oozes", "trust", "cramp"]) {
  for (const a of ["pled", "onto", "tots", "acre", " Oven".trim().toLowerCase()]) {
    assert.deepEqual(Q.evaluate(g, startCol(1), a), wrapped(g, 1, a),
      `evaluate("${g}", s=1, "${a}") matches the independent model`);
  }
}
console.log("ok — wrapped scoring: positional at the cell's column, pinned duplicates, model agrees");

// ---------- 3. fresh daily ------------------------------------------------------

store.clear();
Q.daily();

const freshAnswer = Q.answerFor(Q.todayKey());
assert.equal(board.children.length, 1, "one waiting row");
assert.equal(board.children[0].children.length, 4, "four bare tiles");
assert.ok(!giveUpBtn.classList.contains("hidden"), "give up offered");
assert.ok(shareBtn.classList.contains("hidden"), "no share before an end state");

const freshSave = readSave();
assert.equal(freshSave.date, Q.todayKey(), "save stamped with today");
assert.equal(freshSave.answer, freshAnswer, "daily answer is date-derived");
assert.ok(POOL.includes(freshSave.answer), "daily answer comes from the pool");
assert.deepEqual(freshSave.guesses, [], "no guesses yet");
console.log(`ok — fresh daily: ${freshSave.date}, answer ${freshAnswer}`);

// ---------- 4. a live guess: the stream wraps on the board ----------------------

practice("pled");
typeRow("spits");
{
  assert.deepEqual(tiles(0).map(markOf), [A, P, A, A],
    "row 0 wears the first four letters' marks");
  assert.deepEqual(cellMark(1, 0), A,
    "the fifth letter wrapped into row 1 and scored there");
  assert.equal(rowText(0), "spit", "row 0 reads spit");
  assert.equal(cellText(1, 0), "s", "the wrapped s sits under it");
  assert.equal(board.children.length, 3, "a spare row followed the wrap");
  for (const k of ["s", "p", "i", "t"]) {
    const key = keyEl(k);
    const state = k === "p" ? P : A;
    assert.ok(key.classList.contains(state), `key ${k} painted ${state}`);
    assert.equal(key.classList.contains(K), false, `key ${k} never over-ranked`);
  }
  keydown("q");
  assert.equal(cellText(1, 1), "q", "typing continues at the next stream cell");
  for (const ch of "wer") keydown(ch);
  assert.equal(cellText(2, 0), "r", "the stream wrapped into row 2 while typing");
  keydown("Backspace");
  assert.equal(cellText(2, 0), "", "backspace walks back across the wrap");
  assert.equal(cellText(1, 3), "e", "…into row 1, whose letters lift next");
  keydown("Backspace");
  assert.equal(cellText(1, 3), "", "row 1 letters lift too");
  for (let i = 0; i < 5; i++) keydown("Backspace");
  assert.equal(cellText(1, 0), "s", "a submitted letter never lifts — the guess is spent");
  keydown("s");
  assert.equal(cellText(1, 1), "s", "the next typed letter lands after the guess");
}
console.log("ok — a live guess: letters wrap 4+1, marks land in place, keys paint, stream edits");

// ---------- 5. the prefix win: the answer as one word's first four --------------

// find pool answers that extend to a real 5-letter word on either side
let prefixPair = null, suffixPair = null;
for (const a of POOL) {
  if (!prefixPair) for (const ch of ALPHA) if (DICT.has(a + ch)) { prefixPair = [a, a + ch]; break; }
  if (!suffixPair) for (const ch of ALPHA) if (DICT.has(ch + a)) { suffixPair = [a, ch + a]; break; }
  if (prefixPair && suffixPair) break;
}
assert.ok(prefixPair && suffixPair, "the pool yields head- and tail-extendable answers");

practice(prefixPair[0]);
{
  const [a, word] = prefixPair;
  typeRow(word);
  assert.equal(Q.dump().won, true, `${word} spells ${a} across row 0`);
  assert.deepEqual(tiles(0).map(markOf), [K, K, K, K], "row 0 is the row across of greens");
  for (const t of tiles(0)) assert.ok(t.classList.contains("win-glow"), "the win glows");
  assert.equal(cellText(1, 0), word[4], "the fifth letter wrapped below, outside the win");
  assert.ok(!shareBtn.classList.contains("hidden"), "share appears on the win");
  keydown("a");
  assert.equal(Q.dump().guesses.length, 1, "board locked after the win");
}
shareBtn.click();
{
  const ta = createdEls.filter((e) => e.tagName === "textarea").pop();
  const lines = ta.value.split("\n");
  assert.equal(lines[0], "Quartile · practice · 1 guess", "share counts the singular guess");
  assert.equal(lines[1], GAME_URL, "share links to the game");
  assert.equal(lines[2], "\u{1F7E9}\u{1F7E9}\u{1F7E9}\u{1F7E9}", "the win row shares four greens");
  assert.equal(lines[3], "\u2B1B\u2B1B\u2B1B\u2B1B", "the wrapped tail pads with theme empties");
}
console.log("ok — prefix win: row 0 greens, glow, share shows the board");

// ---------- 6. the 2+2 win: two guesses meet mid-row -----------------------------

practice("onto");
{
  // row 2 reads guess 1's last two letters then guess 2's first two —
  // so guess 1 must END with onto's first two ("on") and guess 2 must
  // START with onto's last two ("to")
  let A2 = null, B2 = null;
  for (const w of GUESSES) {
    if (w.slice(3) === "on") { A2 = w; break; }
  }
  for (const w of GUESSES) {
    if (w.slice(0, 2) === "to") { B2 = w; break; }
  }
  assert.ok(A2 && B2, `found the 2+2 pair for onto (${A2} + ${B2})`);
  typeRow("cramp"); // filler: opens the stream, cannot spell onto across row 0
  assert.equal(Q.dump().done, false, "filler spent, game live");
  typeRow(A2);
  assert.equal(Q.dump().done, false, "the 2+2 row is not complete yet");
  typeRow(B2);
  assert.equal(Q.dump().won, true, `${A2}+${B2} spell onto across row 2`);
  assert.deepEqual(tiles(2).map(markOf), [K, K, K, K], "row 2 is the row across");
  assert.deepEqual(rowText(2), "onto", "it reads the answer");
}
console.log("ok — 2+2 win: the end of one guess meets the front of the next");

// ---------- 7. the suffix win — and the guess that completes two rows ------------

practice(suffixPair[0]);
{
  const [a, word] = suffixPair;
  typeRow("cramp");
  typeRow("hoist");
  typeRow("donut");
  assert.equal(Q.dump().done, false, "three fillers spent, rows 0-2 complete and quiet");
  typeRow(word);
  assert.equal(Q.dump().won, true, `${word}'s last four spell ${a} across row 4`);
  // guess 4 fills row 3's last cell AND all of row 4 — five cells, two rows
  for (let r = 0; r <= 4; r++) {
    assert.equal(rowText(r).length, 4, `row ${r} fully laid`);
  }
  const winRow = greenRowOf(marksThrough(Q.dump().guesses, a));
  for (const t of tiles(winRow)) assert.ok(t.classList.contains("win-glow"), "the first green row glows");
}
console.log("ok — suffix win: the fourth guess lands five cells and completes two rows");

// ---------- 8. give up: the ghost row across --------------------------------------

practice("onto");
for (const ch of "on") keydown(ch);
giveUpBtn.click();
{
  const ghost = 2; // two stream rows (typed letters + the spare) then the ghost
  assert.equal(cellText(0, 0), "", "the half-typed letters cleared");
  assert.equal(cellText(0, 1), "", "both cells of them");
  assert.equal(board.children.length, ghost + 1, "the ghost row followed");
  assert.ok(board.children[ghost].classList.contains("answer"), "the reveal row");
  assert.deepEqual(tiles(ghost).map(markOf), [K, K, K, K], "the ghost wears full greens");
  assert.equal(rowText(ghost), "onto", "the ghost spells the word");
  for (const t of tiles(ghost)) assert.ok(t.classList.contains("win-glow"), "the ghost glows");
  assert.equal(Q.dump().gaveUp, true, "gaveUp flag explicit");
  assert.ok(giveUpBtn.classList.contains("hidden"), "give up retired");
}
shareBtn.click();
{
  const ta = createdEls.filter((e) => e.tagName === "textarea").pop();
  assert.equal(ta.value.split("\n")[0],
    "Quartile · practice · gave up · 0 guesses", "surrender tagged in the share");
}
seedDaily("onto");
for (const ch of "on") keydown(ch);
giveUpBtn.click();
{
  const s = readSave();
  assert.equal(s.done, true, "give up saved done");
  assert.equal(s.gaveUp, true, "gaveUp saved");
}
shareBtn.click();
{
  const ta = createdEls.filter((e) => e.tagName === "textarea").pop();
  assert.equal(ta.value.split("\n")[0],
    `Quartile · ${Q.todayKey()} · gave up · 0 guesses`, "daily surrender carries the date");
}
console.log("ok — give up: clears the stream, walks the answer on as a green row across");

// ---------- 9. refresh mid-game: the stream recomputes ----------------------------

seedDaily("pled", ["pleat", "depot"]);
Q.daily(); // simulated refresh
{
  assert.equal(board.children.length, 4, "ten filled cells + a spare row");
  assert.ok(board.children[0].classList.contains("quiet"), "restored rows are quiet");
  assert.equal(rowText(0), "plea", "row 0 repainted");
  assert.equal(cellText(1, 0), "t", "the wrapped fifth letter back in place");
  assert.deepEqual(tiles(0).map(markOf), wrapped("pleat", 0, "pled").slice(0, 4),
    "row 0's marks recompute");
  assert.deepEqual(cellMark(1, 0), wrapped("pleat", 0, "pled")[4],
    "the wrapped cell's mark recomputes");
  // guess 2 opened at column 1 (startCol(g) = g%4): d,e,p fill row 1's
  // right side and o,t wrap onto row 2
  assert.equal(rowText(1), "tdep", "row 1 carries pleat's tail then depot's head");
  assert.equal(rowText(2).slice(0, 2), "ot", "depot's tail wrapped onto row 2");
  assert.deepEqual(cellMark(2, 1), wrapped("depot", 1, "pled")[4],
    "the wrapped tail's mark recomputes");
  assert.ok(keyEl("p").classList.contains(K), "key p green after restore");
  assert.ok(keyEl("d").classList.contains(P), "key d yellow after restore");
  keydown("a");
  assert.equal(Q.dump().guesses.length, 2, "play continues after a refresh");
  keydown("Backspace");
}

// the win restores painted, not animated
seedDaily(prefixPair[0], [prefixPair[1]], { done: true, won: true });
Q.daily();
{
  assert.deepEqual(tiles(0).map(markOf), [K, K, K, K], "restored win row is green");
  for (const t of tiles(0)) assert.ok(t.classList.contains("win-glow"), "the win re-glows");
  assert.ok(!shareBtn.classList.contains("hidden"), "share offered again");
  keydown("a");
  assert.equal(Q.dump().guesses.length, 1, "restored won board is locked");
}

// a finished surrender restores with its ghost
seedDaily("onto", [], { done: true, won: false, gaveUp: true });
Q.daily();
{
  assert.ok(board.children[1].classList.contains("answer"), "the ghost restored");
  assert.deepEqual(tiles(1).map(markOf), [K, K, K, K], "the ghost green on restore");
  keydown("a");
  assert.equal(Q.dump().guesses.length, 0, "restored lost board is locked");
}
console.log("ok — refresh: the wrapped stream recomputes, win and surrender restore finished");

// ---------- 10. corrupt saves ------------------------------------------------------

const good = { date: Q.todayKey(), answer: "pled", guesses: [],
  done: false, won: false, gaveUp: false };
for (const bad of [
  { ...good, answer: "qqqqq" },                          // five letters — not a pool word
  { ...good, answer: "http" },                           // four letters, but unspellable
  { ...good, answer: 42 },                               // not a string
  { date: Q.todayKey(), guesses: [] },                   // no answer
  { ...good, guesses: "pled" },                          // not an array
  { ...good, guesses: ["qqqqq"] },                       // non-word guess
  { ...good, guesses: ["able"] },                        // a FOUR-letter guess
  { ...good, date: "2019-04-01" },                       // stale date
]) {
  globalThis.localStorage.setItem("quartile-day24", JSON.stringify(bad));
  Q.daily();
  const s = readSave();
  assert.equal(s.answer, Q.answerFor(Q.todayKey()),
    `corrupt save ${JSON.stringify(bad).slice(0, 40)}… replaced by a fresh daily`);
  assert.deepEqual(s.guesses, [], "corrupt save's guesses discarded");
}
// unlimited: a long save is LEGAL (no count check — the Tuple precedent)
seedDaily("pled", Array.from({ length: 12 }, (_, i) => ["cramp", "hoist"][i % 2]));
Q.daily();
assert.equal(Q.dump().guesses.length, 12, "twelve guesses restore — the game is endless");
console.log("ok — corrupt saves: stale/fake/off-pool/short guesses fall back fresh; long saves are legal");

// ---------- 11. rejected words keep their letters (the Stifle lesson) --------------

practice("pled");
for (const ch of "ple") keydown(ch);
keydown("Enter"); // not enough letters
{
  assert.equal(toast.textContent, "Not enough letters", "short words refused");
  assert.equal(rowText(0).slice(0, 3), "ple",
    "the letters stay for editing");
}
keydown("Backspace");
for (const ch of "qts") keydown(ch);
keydown("Enter"); // "plqts" — not in the dictionary
{
  assert.equal(toast.textContent, "Not in word list", "non-words refused");
  assert.equal(rowText(0) + cellText(1, 0), "plqts",
    "still there after the shake, wrap and all");
  assert.equal(board.children.length, 3, "no row was spent");
}
runTimers();
console.log("ok — rejections: toasts fire, letters stay wrapped in place, no row spent");

// ---------- 12. practice: isolation, forced words, dump ------------------------------

const saveBeforePractice = globalThis.localStorage.getItem("quartile-day24");
const pledIdx = POOL.indexOf("pled");
Math.random = () => (pledIdx + 0.5) / POOL.length;

Q.practice();
assert.equal(toast.textContent, "Practice round", "practice toasts, no banner");
assert.equal(newBtn.textContent, "Today\u2019s puzzle", "button offers the way back");
assert.equal(Q.dump().answer, "pled", "random word honors the Math.random stub over the pool");

Q.practice("zzzz");
assert.ok(POOL.includes(Q.dump().answer), "invalid forced word rejected for a random pool word");

Q.practice("http"); // real 4-letter string, but not a pool word — allowed as a
// forced PRACTICE answer (debugging backdoor takes any 4-letter dictionary word)
assert.equal(Q.dump().answer, "http", "forced practice accepts any embedded 4-letter word");

const d = Q.dump();
for (const field of ["answer", "guesses", "typed", "marks",
  "practice", "done", "won", "gaveUp", "save"]) {
  assert.ok(field in d, `dump exposes ${field}`);
}
assert.equal(globalThis.localStorage.getItem("quartile-day24"), saveBeforePractice,
  "practice never touches the daily save");

newBtn.click();
assert.equal(newBtn.textContent, "Practice", "button back to Practice");
assert.equal(Q.dump().practice, false, "back to the daily");
assert.equal(Q.dump().guesses.length, 12, "the daily board restored untouched");
assert.equal(board.children.length, Math.ceil(60 / 4) + 1, "its rows all rebuilt");
console.log("ok — practice: forced words, pool-random under the stub, no daily writes");

// ---------- 13. solvability sweep: every daily date has a winning plan ---------------
//
// The end-to-end form of the algorithm check: for sampled dates, find
// a plan INDEPENDENTLY (this file's own heads/tails index) and play it
// through the real input path. The five row types come around in a
// fixed cycle (prefix, 1+3, 2+2, 3+1, suffix — then it repeats), so a
// plan is reachable whenever the letters exist.

{
  const tails = { 1: new Map(), 2: new Map(), 3: new Map() };
  const heads = { 1: new Map(), 2: new Map(), 3: new Map() };
  for (const w of GUESSES) {
    for (let k = 1; k <= 3; k++) {
      if (!tails[k].has(w.slice(5 - k))) tails[k].set(w.slice(5 - k), w);
      if (!heads[k].has(w.slice(0, k))) heads[k].set(w.slice(0, k), w);
    }
  }
  const extend = (a, side) => {
    for (const ch of ALPHA) {
      const w = side === "head" ? a + ch : ch + a;
      if (DICT.has(w)) return w;
    }
    return null;
  };
  function planFor(a) {
    const pre = extend(a, "head");
    if (pre) return [pre];
    const suf = extend(a, "tail");
    if (suf) return ["cramp", "hoist", "donut", suf];
    // split j: A's tail spells the answer's first j, B's head the rest;
    // the j-split row completes on guess j (after j-1 fillers)
    for (const j of [1, 2, 3]) {
      const Aw = tails[j].get(a.slice(0, j));
      const Bw = heads[4 - j].get(a.slice(j));
      if (Aw && Bw) {
        const fill = ["cramp", "hoist", "donut"].slice(0, j - 1);
        return [...fill, Aw, Bw];
      }
    }
    return null;
  }

  let swept = 0;
  const byKind = { prefix: 0, mid: 0 };
  for (let i = 0; i < 40; i++) {
    const key = `2027-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`;
    const a = Q.answerFor(key);
    const plan = planFor(a);
    assert.ok(plan, `${key}: "${a}" has a winning plan`);
    practice(a);
    for (const w of plan) typeRow(w);
    const dump = Q.dump();
    assert.equal(dump.done, true, `${key}: the plan ended the game`);
    assert.equal(dump.won, true, `${key}: solver wins "${a}" with [${plan.join(", ")}]`);
    const winRow = greenRowOf(marksThrough(dump.guesses, a));
    assert.ok(winRow >= 0, `${key}: a row across reads the answer`);
    if (winRow % 5 === 0 || winRow % 5 === 4) byKind.prefix++; else byKind.mid++;
    swept++;
  }
  console.log(`ok — solvability sweep: ${swept} dates won by construction ` +
    `(${byKind.prefix} on head/tail rows, ${byKind.mid} on split rows)`);
}

console.log("quartile.test.js — all sections passed");
