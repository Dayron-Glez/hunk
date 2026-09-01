---
name: '🐞 Bug Report'
about: Something renders wrong, parses wrong, or crashes
title: '[bug] '
labels: bug
---

## 🐛 Description

What is broken? Describe what you saw.

## 📄 The diff that triggers it

**This is the most important field.** hunk takes a diff as input, so without the input there
is no reproducible case. Paste the smallest diff that still shows the problem, or link to the
pull request / commit it came from.

```diff

```

- [ ] This diff belongs in `fixtures/` — no case that broke the parser once should be able to
      break it again unnoticed

## 📍 Area affected

- [ ] 🧩 Parser — `src/core/parse/`
- [ ] 📐 Layout / virtualization — `src/core/layout/`
- [ ] 🎨 Syntax highlighting — `src/workers/`
- [ ] 🔤 Word-level diff — `src/core/diff/`
- [ ] 🖥️ UI / components — `src/components/`
- [ ] 📊 Benchmark — `bench/`
- [ ] ⚙️ CI / tooling

## 🔁 Steps to reproduce

1.
2.
3.

## ✅ Expected

What should have happened.

## ❌ Actual

What happened instead.

## 📸 Screenshots / recordings

For anything visual, a screenshot beats a description.

## 💻 Environment

- Browser:
- OS:
- Node.js:
- Commit / branch:

## 📝 Console output

Any errors from the browser console or the terminal.
