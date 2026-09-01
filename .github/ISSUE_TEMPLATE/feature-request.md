---
name: '🚀 Feature Request'
about: Propose something hunk should do
title: '[feat] '
labels: enhancement
---

## 📝 Description

What should it do?

## 🎯 What problem it solves

Who is stuck today, and on what?

## 🗺️ Which phase does it belong to

hunk has a fixed roadmap and a fixed budget. A proposal either fits a phase or it is out of
scope for now — saying which keeps that honest.

- [ ] **F1** — variable-height virtualization + prefix-sum tree
- [ ] **F2** — syntax highlighting in a worker, with caching
- [ ] **F3** — word-level diff + side-by-side with alignment rows
- [ ] **F4** — folding, progressive expansion, keyboard navigation, accessibility
- [ ] **F5** — loading pull requests by URL, landing page, published benchmark
- [ ] **F6** — inline comments _(explicitly out of scope for the first month)_
- [ ] None of these — this is new scope

## 🧩 Technical scope

- **Core logic** (`src/core/`):
- **Components** (`src/components/`):
- **New dependencies**:

> **The rule that matters here:** `src/core/` knows nothing about React. It is plain logic with
> no DOM and no components, which is what lets it move into a worker later. If this feature
> would put a hook or an element in there, say so — that is a design decision, not a detail.

## 📊 Performance cost

Every feature is spent from a budget of 900 ms and 80 MB at 100k lines.

- **Does it run per line?** If so, it runs 100.000 times.
- **Does it measure the DOM?** Reading layout costs, and reading it during scroll costs more.
- **Does it add to the first paint, or can it wait?**

## ✅ Acceptance criteria

- [ ]
- [ ]

## 🧪 How to validate

Which tests, which fixtures, and — if it touches the hot path — which benchmark numbers have
to hold.

## 📝 Alternatives considered

What else would solve this, and why this instead.
