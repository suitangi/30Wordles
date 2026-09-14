# 30 Wordles

A challenge to design a Wordle-style game every day for 30 (give or take) days.
Each day is its own subpage and grows into its own playable variant.

## Structure

- `index.html` — project home with the Day 1–30 list
- `days/day-N.html` — one subpage per day (Day 1 is **Bundle**)
- `css/styles.css` — shared styles, dark/light themes
- `js/theme.js` — theme toggle (persists choice, defaults to OS preference)
- `js/bundle.js` — Day 1 game logic
- `tests/bundle.test.js` — headless game tests (`node tests/bundle.test.js`)
- `js/words.js` — bundled word lists (`window.WORD_LISTS`): answers (2,315) from
  [cfreshman/wordle-answers-alphabetical](https://gist.github.com/cfreshman/a03ef2cba789d8cf00c08f767e0fad7b),
  allowed guesses (14,855) from
  [tabatkins/wordle-list](https://github.com/tabatkins/wordle-list)

Static site — no build step. Open `index.html` directly, or serve the folder
(`python -m http.server`) and browse.
