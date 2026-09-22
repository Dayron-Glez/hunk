# hunk

A diff viewer for the files that bring the others down. Paste a GitHub pull request URL, drop
two files or a `.patch`, and read it.

> **Status: F2 complete — every target is met, with room to spare.**
> Variable-height virtualization, and syntax highlighting that arrives from a worker without
> touching first paint. The numbers below are measured and reproducible.

## Where it stands today

Only the rows on screen exist in the DOM. Heights start as estimates and are corrected as rows
appear, with the scroll position adjusted in the same frame so nothing moves under the reader.
Colours are computed off the main thread and land when they land — the diff is readable before
they do.

Measured on an AMD Ryzen 7 5800H against a production build, median of three runs each in a
fresh page.

| Case                     |   Lines | Before | **First paint** | Memory | DOM nodes |
| ------------------------ | ------: | -----: | --------------: | -----: | --------: |
| Synthetic                |   1,000 |  71 ms |       **24 ms** |   3 MB |     2,140 |
| Synthetic                |  10,000 | 429 ms |       **36 ms** |   4 MB |     2,343 |
| Synthetic                |  50,000 | 2.17 s |       **35 ms** |   6 MB |     2,075 |
| Synthetic                | 100,000 | 4.52 s |       **43 ms** |   9 MB |     2,207 |
| Linux kernel commit      |  62,165 | 3.07 s |       **48 ms** |   7 MB |     1,562 |
| Minified bundles, 371 KB |     128 |  52 ms |       **53 ms** |   3 MB |     1,267 |
| 168 files, mostly moved  |   5,385 | 269 ms |       **34 ms** |   4 MB |     1,632 |

At 100.000 lines that is **104× faster, 16× lighter, and 453× fewer DOM nodes** — with the
syntax highlighting on.

Read the last column first. **The DOM stops growing with the diff**: about a thousand nodes
whether the file has a thousand lines or a hundred thousand. Everything else follows from
that.

Two rows are worth more than the headline:

- **The minified bundle barely moved**, 52 ms to 47 ms. It is 371 KB in 128 lines, so there
  was never anything to leave out. A benchmark where every case improves enormously is usually
  a benchmark measuring itself.
- **The kernel commit — a real 758-file diff — went from three seconds to forty milliseconds.**
  That is the case this project exists for.

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

**First paint and memory are met at every size**, by 4× at 10k lines and 20× at 100k. Frame
rate is still unmeasured rather than met — `bench/README.md` explains why a number from a
headless browser there would be a constant wearing a costume, and what is measured instead.

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
guessed. The recorded baseline lives in `bench/results/f0-naive-render.json`, with every
individual run kept alongside the median.

## No diff-viewer libraries

`react-diff-viewer` and its community fork put every row in the DOM without virtualizing; they
fall over past 50k lines. GitHub has years of issues about multi-second freezes with the CPU
pinned at 100%, and published an engineering post about how hard the problem is.

**hunk uses no diff-viewer library.** The parser, the variable-height virtualization, the
prefix-sum tree, the worker-based highlighting and the word-level diff are written here. That
is the entire project.

## The fixture corpus

The parser was written against 24 real diffs, gathered before a line of it existed — a pull
request, mass renames, binaries, submodules, a regenerated lockfile, a 758-file Linux kernel
commit.

Two of the cases that break parsers could not be found at all. Scanning hundreds of commits
across git, Linux, npm, Vite, prettier, Babel, TypeScript, esbuild and VS Code turned up not one
`\ No newline at end of file` and not one file mode change. Rare in practice, still fatal, so
they are produced by a script driving real git — byte-identical on every run.

Of the 170 tests, 96 are four invariants applied across the whole corpus, which means they
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
