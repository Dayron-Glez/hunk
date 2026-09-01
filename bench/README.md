# The benchmark

hunk's claim is a number, so the number has to be reproducible by anyone who doubts it. This
directory is that claim, executable.

```bash
npx playwright install chromium   # once — the browser is not part of npm install
npm run bench                     # every case
npm run bench -- synthetic-1k     # one case, by name or fragment
```

Playwright ships its browser separately from its npm package, so a fresh clone has the runner
but not the thing it drives. The first command fixes that and is only needed once.

It builds the harness, writes the cases, drives Chromium through Playwright, and prints a
table. The full run takes a while: the largest cases are slow **on purpose** — that is what is
being measured.

## What it measures

| Metric   | What it means                                                                                         |
| -------- | ----------------------------------------------------------------------------------------------------- |
| `parse`  | Turning diff text into the model. Pure computation, no DOM.                                           |
| `render` | From a parsed diff to pixels on screen — the expensive half.                                          |
| `total`  | `parse` + `render`. The number a reader experiences as "how long until I see it".                     |
| `fps`    | Frames served while the page scrolls itself from top to bottom.                                       |
| `memory` | JavaScript heap after a forced garbage collection, from the browser rather than from inside the page. |
| `DOM`    | Nodes in the document. The number virtualization exists to keep small.                                |

`total` is a median of three runs, each in a fresh page. Frame rate and memory come from the
last run only — they need a live page, and repeating a three-second scroll three times triples
the wall clock for a number that barely moves.

## What it deliberately does not measure

- **Fetching the diff.** The clock starts once the source is in hand. Network latency is not
  hunk's to answer for.
- **The application shell.** The harness renders `DiffView` directly, without the file picker
  around it, so a measurement is of the viewer rather than of the page that leads to it.
- **The other libraries.** The comparison against `react-diff-viewer`,
  `react-diff-viewer-continued` and `react-virtualized-diff` is a separate piece of work. A
  claim to be faster than them has to run all four on one machine in one sitting.

## The cases

Four synthetic sizes and three real diffs.

The synthetic ones exist because they are the only way to ask "what happens at exactly 100.000
lines". They are built by `synthetic.mjs` from a seeded generator: the same size always
produces the same bytes, so a number measured today can be compared with one measured in three
weeks. One line in four hundred is long enough to force horizontal scrolling, because real
diffs contain those and a viewer only ever shown short lines is not being measured honestly.

The real ones exist because generated input is a fiction. `real-kernel` is 758 files of a Linux
kernel commit; `real-minified` is 371 KB in 128 lines, which attacks wrapping instead of
volume; `real-mass-rename` is 168 files that are mostly renames, so most of its files have no
content at all.

## Reading the numbers honestly

**A number without its machine compares to nothing.** `results/latest.json` records the CPU,
the platform and the Node version alongside every measurement, and a comparison across two
machines is not a comparison. Re-run the baseline on your machine before drawing any conclusion
from a change.

**The frame rate can refuse to answer.** `requestAnimationFrame` stops firing in a page the
browser considers hidden, and a run in that state reports zero frames per second whether the
renderer is fast or slow. The harness measures an idle page first: if an idle page cannot hold
a reasonable frame rate, the measurement is broken rather than the renderer, and the report
says `n/a` instead of publishing the zero. **A missing number is worth more than a wrong one.**

**Everything is a median, and the spread is kept.** `results/latest.json` holds every
individual run under `runs`, not just the median. A median that hides a run three times slower
than its neighbours is hiding the interesting part.

## The targets

|                     | 10k lines | 50k lines | 100k lines |
| ------------------- | --------- | --------- | ---------- |
| First paint         | < 150 ms  | < 400 ms  | < 900 ms   |
| FPS while scrolling | 60        | 60        | ≥ 50       |
| Memory              | < 15 MB   | < 40 MB   | < 80 MB    |

Committed results are kept whether they meet these or not. A baseline that only records the
good days is not a baseline.

## Snapshots

A run writes `results/latest.json`, which is not committed — it is overwritten every time and
would only produce noisy diffs. Snapshots worth keeping are copied beside it under a name that
says what they are, and those _are_ committed:

| Snapshot               | What it records                                                             |
| ---------------------- | --------------------------------------------------------------------------- |
| `f0-naive-render.json` | Every line in the DOM, nothing virtualized. The measurement F1 has to beat. |

Copy `latest.json` to a new name whenever a run is worth keeping. Without that, the first run
after a change destroys the number the change was supposed to be compared against.
