---
name: '🧪 Unhandled Diff Case'
about: A shape of diff the parser mangles, drops, or misreads
title: '[diff] '
labels: parser, fixture
---

## 🧪 The case

What is unusual about this diff? A mode change, a submodule, a path git had to quote, a
combined merge diff, an encoding — name the shape.

## 📄 The diff

The smallest version that still reproduces it. If it came from a real repository, link the
commit or pull request so it can be re-fetched later.

```diff

```

**Where it came from:**

- [ ] A real repository — link:
- [ ] Produced with git locally — commands:
- [ ] Hand-written to isolate the case

## 🔍 What hunk does with it

What you see now: a dropped file, wrong line numbers, mangled characters, a warning that
should not be there, an exception.

## ✅ What it should do

What the correct reading of this diff is.

## 📚 What the format says

If git's documentation or source settles it, quote or link it. Diff format has corners that
are only defined by what git actually emits.

## 🗂️ Adding it to the corpus

Every case that broke the parser once should be unable to break it again unnoticed. That means
it becomes a fixture.

- [ ] **Real diff** → goes in `fixtures/github/`, added to `fetch.sh` and `MANIFEST.tsv`
- [ ] **Produced with git** → goes in `fixtures/edge/`, added to `generate.sh` so it stays
      reproducible byte for byte
- [ ] Checksums regenerated, `fixtures/README.md` row added
- [ ] It passes the four parser invariants in `src/core/parse/unified.test.ts`
- [ ] A test names this specific case, not just the invariants
