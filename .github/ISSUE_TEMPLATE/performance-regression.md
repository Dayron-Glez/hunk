---
name: '📉 Performance Regression'
about: Something got slower, heavier, or janky
title: '[perf] '
labels: performance
---

## 📉 What got worse

One sentence. "Scrolling the kernel fixture stutters", "first paint on 50k lines doubled".

## 📊 The numbers

"It feels slow" is not actionable. hunk's whole premise is a published number, so a regression
has to be stated as one.

|                          | Value                                                        |
| ------------------------ | ------------------------------------------------------------ |
| **Fixture / input**      | e.g. `fixtures/github/linux-93e4b307-huge.diff`              |
| **Metric**               | first paint · FPS while scrolling · memory · parse time      |
| **Expected**             | the target from the README, or the number before the change  |
| **Measured**             | what you actually got                                        |
| **Where that came from** | `npm run bench` · DevTools performance panel · manual timing |

## 🎯 Which target does this miss

|                     | 10k lines | 50k lines | 100k lines |
| ------------------- | --------- | --------- | ---------- |
| First paint         | < 150 ms  | < 400 ms  | < 900 ms   |
| FPS while scrolling | 60        | 60        | ≥ 50       |
| Memory              | < 15 MB   | < 40 MB   | < 80 MB    |

## 🔍 When did it start

- **Last good commit:**
- **First bad commit:**
- [ ] I bisected it
- [ ] I did not — this is where it was first noticed

## 💻 Machine

Numbers only compare against numbers from the same machine.

- CPU:
- RAM:
- OS:
- Browser + version:
- [ ] Ran on battery power
- [ ] Ran with other heavy applications open

## 📎 Evidence

A DevTools performance profile, a trace, a screen recording of the stutter, or the raw
benchmark output.

## 💡 Suspected cause

If you have a theory — a layout thrash, a lost memo, a cache that stopped hitting — say so.
Leave it blank if you don't.
