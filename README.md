# hunk

A high-performance diff viewer. Paste a GitHub pull request URL, drop two files or a `.patch`,
and it renders — fast on the files that bring the others down.

## No diff-viewer libraries

`react-diff-viewer` and its community-maintained fork put every row in the DOM without
virtualizing; they fall over past 50k lines. GitHub has years of issues about multi-second
freezes with the CPU pinned at 100%.

**hunk uses no diff-viewer library.** The parser, the variable-height virtualization, the
prefix-sum tree, the worker-based highlighting and the word-level diff are all written here.
That is the entire project.

## The goal, stated as a number

|                     | 10k lines | 50k lines | 100k lines |
| ------------------- | --------- | --------- | ---------- |
| First paint         | < 150 ms  | < 400 ms  | < 900 ms   |
| FPS while scrolling | 60        | 60        | ≥ 50       |
| Memory              | < 15 MB   | < 40 MB   | < 80 MB    |

The benchmark suite lives in `bench/` and anyone can run it.

## Stack

React 19 · TypeScript · Vite · Tailwind · Vitest · Playwright

## Development

```bash
npm install
npm run dev
```

| Script              | What it does                   |
| ------------------- | ------------------------------ |
| `npm run dev`       | Development server             |
| `npm run build`     | Typecheck + production build   |
| `npm test`          | Run the test suite with Vitest |
| `npm run typecheck` | Type checking only             |
| `npm run lint`      | ESLint                         |
| `npm run format`    | Prettier across the repository |
