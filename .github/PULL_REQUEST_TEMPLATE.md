## 📋 Description

What does this change, and why?

---

## 🔗 Related issue

Closes #

---

## 🏷 Type of change

- [ ] 🚀 Feature
- [ ] 🐛 Bug fix
- [ ] 📉 Performance
- [ ] ♻️ Refactor — no behaviour change
- [ ] 🧪 Tests or fixtures
- [ ] 🔧 Chore — config, dependencies, CI

## 📍 Area affected

- [ ] 🧩 Parser — `src/core/parse/`
- [ ] 📐 Layout / virtualization — `src/core/layout/`
- [ ] 🎨 Syntax highlighting — `src/workers/`
- [ ] 🔤 Word-level diff — `src/core/diff/`
- [ ] 🖥️ UI / components — `src/components/`
- [ ] 📊 Benchmark — `bench/`
- [ ] ⚙️ CI / tooling

---

## ✅ Checklist

### Always

- [ ] `npm test` passes
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] `npm run build` passes
- [ ] No commented-out code, no leftover `console.log`
- [ ] Comments explain a _why_ the code cannot say by itself — nothing restating the line below

### 🧩 If it touches the parser

- [ ] A fixture covers the case, in `fixtures/github/` or `fixtures/edge/`
- [ ] `fixtures/edge/generate.sh` regenerates byte-identically, checksums updated
- [ ] The four invariants still hold across the whole corpus
- [ ] Parsing still never throws — anything unreadable becomes a warning

### 📉 If it touches the hot path

- [ ] Benchmark re-run on the same machine, before and after
- [ ] Numbers pasted below
- [ ] No new work per line, or the cost is justified here

| Metric              | Before | After |
| ------------------- | ------ | ----- |
| First paint         |        |       |
| FPS while scrolling |        |       |
| Memory              |        |       |

<sub>Machine and browser used:</sub>

### 🖥️ If it touches the UI

- [ ] Checked against a large diff, not just a small one
- [ ] Copying a block of the diff yields code, not code plus gutters
- [ ] Long lines still scroll horizontally without breaking the layout
- [ ] Keyboard focus stays visible

---

## 📸 Evidence

Screenshots, a recording, or benchmark output.

## 📝 Notes for the reviewer

Anything worth knowing before reading the diff — a decision taken, a trade-off, something left
for later.
