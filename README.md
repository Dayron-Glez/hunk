# hunk

A diff viewer for the files that bring the others down. Paste a GitHub pull request URL, drop
two files or a `.patch`, and read it.

> **Status: F0 complete — it is correct, and it is not yet fast.**
> The parser, the fixture corpus, an unoptimised renderer and the benchmark are in place. The
> numbers below are the starting line, not the finish. F1 is the virtualization that has to
> move them.

## Where it stands today

Every line in the DOM, nothing virtualized. Measured on an AMD Ryzen 7 5800H against a
production build, median of three runs each in a fresh page.

| Case                     |   Lines |   Parse | **First paint** | Memory | DOM nodes |
| ------------------------ | ------: | ------: | --------------: | -----: | --------: |
| Synthetic                |   1,000 |  1.1 ms |       **52 ms** |   3 MB |    10,112 |
| Synthetic                |  10,000 |  3.1 ms |      **362 ms** |  17 MB |   100,047 |
| Synthetic                |  50,000 | 10.1 ms |    **1,876 ms** |  75 MB |   500,240 |
| Synthetic                | 100,000 | 17.3 ms |    **3,881 ms** | 147 MB | 1,000,303 |
| Linux kernel commit      |  62,165 | 14.9 ms |    **2,493 ms** |  96 MB |   597,200 |
| Minified bundles, 371 KB |     128 |  0.9 ms |       **48 ms** |   2 MB |     1,499 |
| 168 files, mostly moved  |   5,385 |  2.7 ms |      **228 ms** |  10 MB |    53,730 |

Three things this settles:

- **Parsing is not the problem.** At 100k lines it is 17 ms of 3,881 — under half a percent.
  The entire budget is spent putting rows on screen.
- **The cost is exactly linear in lines.** Ten DOM nodes per line in every case, from 10,112 to
  1,000,303, and roughly 1.5 KB of heap each. That is the price of not virtualizing: every line
  is paid for whether or not anyone looks at it.
- **The cost follows lines, not bytes.** The minified case is 371 KB across 128 lines and paints
  in 48 ms. This is the premise the whole project rests on — materialize only the visible rows
  and the rest is free. Had cost tracked bytes, virtualization would save nothing.

## The goal, stated as a number

|                     | 10k lines | 50k lines | 100k lines |
| ------------------- | --------- | --------- | ---------- |
| First paint         | < 150 ms  | < 400 ms  | < 900 ms   |
| FPS while scrolling | 60        | 60        | ≥ 50       |
| Memory              | < 15 MB   | < 40 MB   | < 80 MB    |

**None of these are met yet.** At 100k lines the gap is 4.3× on time and 1.8× on memory. That
gap is the project.

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
