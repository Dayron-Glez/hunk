# hunk

A diff viewer for the files that bring the others down. Paste a GitHub pull request URL, drop
two files or a `.patch`, and read it.

> **Status: F3 complete — every target is met, with room to spare.**
> Variable-height virtualization, syntax highlighting that arrives from a worker without
> touching first paint, and the change inside a line marked word by word — in one column or
> two. The numbers below are measured and reproducible.

## Where it stands today

Only the rows on screen exist in the DOM. Heights start as estimates and are corrected as rows
appear, with the scroll position adjusted in the same frame so nothing moves under the reader.
Colours are computed off the main thread and land when they land — the diff is readable before
they do. An edited line shows which words changed, and the two versions can be read side by
side.

Measured on an AMD Ryzen 7 5800H against a production build, median of three runs each in a
fresh page.

| Case                     |   Lines | Before | **First paint** | Side by side | Memory | DOM nodes |
| ------------------------ | ------: | -----: | --------------: | -----------: | -----: | --------: |
| Synthetic                |   1,000 |  71 ms |       **32 ms** |        35 ms |   3 MB |     2,128 |
| Synthetic                |  10,000 | 429 ms |       **34 ms** |        33 ms |   4 MB |     2,348 |
| Synthetic                |  50,000 | 2.17 s |       **38 ms** |        45 ms |   7 MB |     2,080 |
| Synthetic                | 100,000 | 4.52 s |       **49 ms** |        63 ms |   9 MB |     2,224 |
| Synthetic, real edits    | 100,000 |      — |       **52 ms** |        55 ms |   9 MB |     2,203 |
| Linux kernel commit      |  62,165 | 3.07 s |       **43 ms** |        50 ms |   8 MB |     1,567 |
| Minified bundles, 371 KB |     128 |  52 ms |       **53 ms** |        55 ms |   3 MB |     1,330 |
| 168 files, mostly moved  |   5,385 | 269 ms |       **27 ms** |        33 ms |   4 MB |     1,749 |

At 100.000 lines that is **92× faster, 16× lighter, and 450× fewer DOM nodes** — with the
syntax highlighting and the word-level marking on.

Read the last column first. **The DOM stops growing with the diff**: about two thousand nodes
whether the file has a thousand lines or a hundred thousand. Everything else follows from
that, and it holds in the two-column layout too — 3.439 nodes at a hundred thousand lines
against 3.260 at a thousand.

Three rows are worth more than the headline:

- **The minified bundle barely moved**, 52 ms to 53 ms. It is 371 KB in 128 lines, so there
  was never anything to leave out. A benchmark where every case improves enormously is usually
  a benchmark measuring itself.
- **The kernel commit — a real 758-file diff — went from three seconds to forty milliseconds.**
  That is the case this project exists for.
- **First paint went up from F2**, 43 ms to 49 ms at 100.000 lines. Marking what changed
  inside a line is not free, and the honest thing is to record the five milliseconds it costs
  rather than quietly keep the older number.

## The goal, stated as a number

|                     | 10k lines | 50k lines | 100k lines |
| ------------------- | --------- | --------- | ---------- |
| First paint         | < 150 ms  | < 400 ms  | < 900 ms   |
| FPS while scrolling | 60        | 60        | ≥ 50       |
| Memory              | < 15 MB   | < 40 MB   | < 80 MB    |

Highlighting cost **+1.6 ms at 100.000 lines** and about a megabyte, because it happens in a
worker and the page never waits for it. It roughly doubles the DOM — a line becomes a handful
of spans rather than one text node — but that is still a fixed cost per screen rather than one
that grows with the diff.

Marking what changed inside a line cost **+5 ms at the same size**, and only for the lines on
screen: the comparison runs when a row is drawn, not when its hunk comes into view, so the
cost stops depending on how many edits the diff contains. The second column costs **another
14 ms, a megabyte and 1.200 nodes** — the price of two cells where there was one.

**First paint and memory are met at every size**, by 4× at 10k lines and 18× at 100k — 14×
there in the two-column layout, which is the tighter of the two. Frame rate is still
unmeasured rather than met: `bench/README.md` explains why a number from a headless browser
there would be a constant wearing a costume. What is measured instead is main-thread blocking
while scrolling, and it is **zero in all sixteen runs**, with the instrument made to prove
itself before each of them.

## Reading it without a mouse, or without the screen

The whole diff is **one tab stop**. Everything inside it is reached from there:
arrows or `j`/`k` for a line, `n`/`p` for a hunk, `[`/`]` for a file, `Home` and `End`, `PageUp`
and `PageDown`, `Enter` to fold whatever you are on, and left and right to pan a line too wide
for its column.

That is not a convenience, it is what virtualization forces. Only the rows on screen exist, so
a tab order through them would walk a set that rearranges itself as the reader scrolls and
whose length depends on the window — 18 stops in 37 rows on one real diff, before the controls
are counted. Every control inside a row is therefore out of the tab order, and the keyboard
reaches each of them from the grid.

The same problem shapes what a screen reader gets. It can only read rows that are in the
document, and at 100.000 lines that is about sixty of them. `aria-rowcount` and `aria-rowindex`
are how a grid says "this is row 1.234 of 55.100" when 55.040 of those rows do not exist, and
the keyboard is what brings any of them into the document to be read. It is navigable rather
than complete, and that is a real cost of the approach rather than an oversight.

Each line says what it is — "Added line 595." — because the gutter it replaces is two bare
numbers and a punctuation mark read aloud. Those labels carry `select-none`, so copying a block
of the diff still yields code and not code plus commentary.

**Contrast is measured, not assumed.** Every text node on both screens and in both layouts is
checked against the background it actually composites onto, with the WCAG AA threshold for its
size: 484 elements in one column, 740 in two, and nothing under 4.5:1. That audit is what found
the line numbers at **2.53:1** — `neutral-500` would not have fixed it either, at 3.54:1
against a removed line.

Nothing moves. There is one colour transition in the application and no animation, translation
or smooth scrolling anywhere, so there is nothing for `prefers-reduced-motion` to turn off. A
media query that switched nothing off would be decoration.

## Run the benchmark yourself

A claim about speed that cannot be re-measured is an opinion.

```bash
npm install
npx playwright install chromium   # once — the browser is not part of npm install
npm run bench
```

It builds the harness, generates the cases, drives Chromium and prints the table above.
`bench/README.md` documents what is measured, what is deliberately not, and how to read the
result without fooling yourself — including why frames per second is **absent** rather than
guessed. The recorded baseline lives in `bench/results/f0-naive-render.json` and each phase
keeps its own snapshot beside it, with every individual run alongside the median.

## No diff-viewer libraries

`react-diff-viewer` and its community fork put every row in the DOM without virtualizing; they
fall over past 50k lines. GitHub has years of issues about multi-second freezes with the CPU
pinned at 100%, and published an engineering post about how hard the problem is.

**hunk uses no diff-viewer library.** The parser, the variable-height virtualization, the
prefix-sum tree, the worker-based highlighting, the word-level diff and the two-column
alignment are written here. That is the entire project.

## The fixture corpus

The parser was written against 24 real diffs, gathered before a line of it existed — a pull
request, mass renames, binaries, submodules, a regenerated lockfile, a 758-file Linux kernel
commit.

Two of the cases that break parsers could not be found at all. Scanning hundreds of commits
across git, Linux, npm, Vite, prettier, Babel, TypeScript, esbuild and VS Code turned up not one
`\ No newline at end of file` and not one file mode change. Rare in practice, still fatal, so
they are produced by a script driving real git — byte-identical on every run.

Of the 449 tests, 193 are invariants applied across the whole corpus, which means they
already cover fixtures nobody has added yet. `fixtures/README.md` has the full list and what
each case is for.

## Stack

React 19 · TypeScript · Vite · Tailwind · Vitest · Playwright

## Development

```bash
npm install
npm run dev
```

| Script               | What it does                          |
| -------------------- | ------------------------------------- |
| `npm run dev`        | Development server                    |
| `npm test`           | Run the test suite                    |
| `npm run test:watch` | Re-run tests as you edit              |
| `npm run bench`      | Measure — see `bench/README.md` first |
| `npm run typecheck`  | Type checking only                    |
| `npm run lint`       | ESLint                                |
| `npm run format`     | Prettier across the repository        |
| `npm run build`      | Typecheck + production build          |

`main` holds completed phases; work lands on `develop` through pull requests. A pre-commit hook
runs formatting, type checking and the tests, so nothing broken gets stored.
