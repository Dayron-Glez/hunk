# hunk

A diff viewer for the files that bring the others down. Paste a GitHub pull request URL, drop
two files or a `.patch`, and read it.

> **Status: F6 complete — every target is met, with room to spare.**
> Variable-height virtualization, syntax highlighting that arrives from a worker without
> touching first paint, the change inside a line marked word by word in one column or two, the
> whole thing foldable and readable from the keyboard, and a pull request opened from its link
> — public or, with a token of your own, private. The numbers below are measured and
> reproducible.

## Where it stands today

Only the rows on screen exist in the DOM. Heights start as estimates and are corrected as rows
appear, with the scroll position adjusted in the same frame so nothing moves under the reader.
Colours are computed off the main thread and land when they land — the diff is readable before
they do. An edited line shows which words changed, and the two versions can be read side by
side. Files and hunks fold, a hunk too large to scroll past opens in chunks, and the whole diff
is one tab stop that the keyboard walks.

A pull request opens from the link you paste, at an address you can share and leave with the
back button. The unchanged lines `-U3` left out are fetched and put back where they belong,
checked against the diff first so a branch that moved since cannot quietly show you the wrong
ones. Reading a private repository takes a token you make and keep; it is checked before it is
kept, sent to one host, and never put in the address bar.

Measured on an AMD Ryzen 7 5800H against a production build, median of three runs each in a
fresh page.

| Case                     |   Lines | Before | **First paint** | Side by side | One fold | Memory | DOM nodes |
| ------------------------ | ------: | -----: | --------------: | -----------: | -------: | -----: | --------: |
| Synthetic                |   1,000 |  71 ms |       **36 ms** |        43 ms |     6 ms |   4 MB |     2,622 |
| Synthetic                |  10,000 | 429 ms |       **47 ms** |        48 ms |    10 ms |   4 MB |     2,547 |
| Synthetic                |  50,000 | 2.17 s |       **54 ms** |        67 ms |    14 ms |   7 MB |     2,403 |
| Synthetic                | 100,000 | 4.52 s |       **64 ms** |        77 ms |    23 ms |  10 MB |     2,617 |
| Synthetic, real edits    | 100,000 |      — |       **64 ms** |        74 ms |    23 ms |  10 MB |     2,588 |
| Linux kernel commit      |  62,165 | 3.07 s |       **63 ms** |        70 ms |    10 ms |   8 MB |     1,865 |
| Minified bundles, 371 KB |     128 |  52 ms |       **68 ms** |        71 ms |     5 ms |   3 MB |     1,684 |
| 168 files, mostly moved  |   5,385 | 269 ms |       **41 ms** |        56 ms |     9 ms |   4 MB |     2,057 |

At 100.000 lines that is **71× faster, 15× lighter, and 382× fewer DOM nodes** — with the
syntax highlighting, the word-level marking, the folding and the grid semantics on.

Read the last column first. **The DOM stops growing with the diff**: about two thousand nodes
whether the file has a thousand lines or a hundred thousand. Everything else follows from
that, and it holds in the two-column layout too — 3.888 nodes at a hundred thousand lines
against 3.907 at a thousand.

Three rows are worth more than the headline:

- **The minified bundle barely moved**, 52 ms to 53 ms. It is 371 KB in 128 lines, so there
  was never anything to leave out. A benchmark where every case improves enormously is usually
  a benchmark measuring itself.
- **The kernel commit — a real 758-file diff — went from three seconds to forty milliseconds.**
  That is the case this project exists for.
- **First paint has gone up twice now**, 43 ms at F2, 49 at F3, 64 at F4 for 100.000 lines.
  Marking what changed inside a line cost five of that; folding, the row semantics and the
  labels a screen reader needs cost the other fifteen. The headline fell from 104× to 71×
  across those two phases, and recording that is worth more than keeping the older number.

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
13 ms and 1.400 nodes** — the price of two cells where there was one.

Folding cost **+15 ms of first paint and 290 nodes**, the largest single regression in the
project so far. On the kernel commit 7 ms of it happens before any DOM exists: 2.3 ms to work
out which rows a fold leaves visible, 2.6 to seed the height store and 2.4 to hand the tree its
heights. The rest is the wrapper element and the spoken label that every row now carries. **One
fold itself costs 5 to 25 ms**, rising with the size of the document rather than with how much
was hidden, because the projection is rebuilt in a single pass over every row.

That first figure was 8.3 ms until the index started counting each hunk's rows as it wrote
them, instead of the projection walking every row to count them and walking them again to
project. Measured on its own the projection went from 7.5 ms to 2.3. **First paint did not
move**: the saving is smaller than the spread between two runs of this benchmark, and the
table above is unchanged because a number from one noisy run is not an improvement. The
one column that did move is the last one — a hundred nodes in the unified layout, from
giving the sticky line-number gutter an opaque layer of its own so a scrolling line stops
showing through it.

**First paint and memory are met at every size**, by 3.2× at 10k lines, 7.4× at 50k and 14× at
100k — 11.7× there in the two-column layout, which is the tighter of the two. Frame rate is
still unmeasured rather than met: `bench/README.md` explains why a number from a headless
browser there would be a constant wearing a costume. What is measured instead is main-thread
blocking while scrolling, and it is **zero in all sixteen runs**, with the instrument made to
prove itself before each of them.

## Scrolling a line that is wider than its column

In two columns each column is scrolled by a bar of its own, at the end of that file's rows.
A cell clips its line and the line is moved by a transform, so one property moves a whole
column at once — where before each cell scrolled on its own and moving one long line left
the line beneath it where it was. The bars are per file, because the columns are: a width
that suits a lockfile does not suit a header, and neither does a scroll position.

**A bar only knows the widest row of its file that has been rendered, not the widest row it
has.** This viewer will not measure lines nobody has scrolled to — that is what keeps the
first paint flat as the diff grows — so it cannot know the second one, and a bar changes
size as the reader moves down a long file. The same has always been true of the scrollbar in
the one-column layout; showing one per column makes it visible rather than new. A file
taller than the view shows no bar until its end comes up, and is panned with the arrow keys
or a sideways wheel until then.

**The grid itself no longer scrolls sideways in two columns.** A row that spans both — a file
header, a hunk header, a gap — takes the width of the view there rather than of its content,
so a long path wraps onto a second line instead of running off the edge. Left to overflow it
gave the grid a horizontal scrollbar of its own across the bottom, which scrolled neither
column and held itself up: the bar takes eleven pixels of height, the usable width shrinks
with it, the content then fits, and `scrollWidth > clientWidth` reports false while the bar
is still drawn. One column keeps its own bar, where the grid really is what scrolls.

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

**Contrast is measured, not assumed.** `npm run audit:contrast` builds the viewer, walks the
picker and both layouts in a real browser, and composites every text node against the
background it actually sits on — which is rarely the page, since a changed row is a tint and a
changed word is a stronger one on top of it. 1.236 text nodes and focus rings on the last run,
nothing under 4.5:1, the narrowest text margin **5.25:1**.

That audit is what found the line numbers at **2.53:1** — `neutral-500` would not have fixed it
either, at 3.54:1 against a removed line. It is also what sets the diff palette: the row tints
in `src/index.css` are as light as the code sitting on them allows and no lighter, which is why
a changed line is marked by the bar down its left rather than by its background.

Almost nothing moves. One colour transition on the drop zone, and one spinner while a pull
request is being fetched — that one is behind `motion-safe`, so a reader who asks for less
motion gets a still icon and the word "Reading…", which carried the state anyway. There is no
translation, parallax or smooth scrolling to turn off.

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
prefix-sum tree, the worker-based highlighting, the word-level diff, the two-column alignment
and the folding are written here. That is the entire project.

## The fixture corpus

The parser was written against 24 real diffs, gathered before a line of it existed — a pull
request, mass renames, binaries, submodules, a regenerated lockfile, a 758-file Linux kernel
commit.

Two of the cases that break parsers could not be found at all. Scanning hundreds of commits
across git, Linux, npm, Vite, prettier, Babel, TypeScript, esbuild and VS Code turned up not one
`\ No newline at end of file` and not one file mode change. Rare in practice, still fatal, so
they are produced by a script driving real git — byte-identical on every run.

The picker offers eight of them as samples, and none of them is in the bundle a visitor
downloads. `import.meta.glob` without `eager` compiles to a map of dynamic imports, so each
sample is its own chunk and is fetched on the press: the entry is **383.560 bytes**, and the
kernel commit's **2.123.252** sit beside it, reached only if someone asks for them.

Of the 537 tests, 193 are invariants applied across the whole corpus, which means they
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
