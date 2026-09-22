/**
 * Builds unified diffs of a requested size.
 *
 * Deterministic on purpose: the same size always produces the same bytes, so a
 * number measured today is comparable with one measured in three weeks. The
 * randomness comes from a seeded generator rather than Math.random, which would
 * make every run measure a slightly different document.
 *
 * The output is a real unified diff — hunk headers agree with the lines under
 * them — so the parser is doing the same work here as on a diff from GitHub.
 * Feeding it something malformed would measure the error path instead.
 */

const NEWLINE = String.fromCharCode(10)

const IDENTIFIERS = [
  'value',
  'result',
  'options',
  'handler',
  'element',
  'previous',
  'candidate',
  'threshold',
  'offset',
  'buffer',
  'segment',
  'cursor',
  'index',
  'payload',
  'registry',
]

const STATEMENTS = [
  'const %s = %s(%s)',
  'if (%s !== null) return %s',
  'return { %s, %s }',
  'let %s = %s.length',
  '%s.push(%s)',
  'for (const %s of %s) {',
  'const %s = %s.map((item) => item.%s)',
  '// %s is derived from %s',
  'await %s.flush(%s)',
  'expect(%s).toEqual(%s)',
]

/** Mulberry32 — small, fast, and identical across platforms. */
function createRandom(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pick(random, list) {
  return list[Math.floor(random() * list.length)]
}

function codeLine(random, indent) {
  const template = pick(random, STATEMENTS)
  const filled = template.replace(/%s/g, () => pick(random, IDENTIFIERS))
  return '  '.repeat(indent) + filled
}

/**
 * One line in every `LONG_LINE_EVERY` is wide enough to force horizontal
 * scrolling. Real diffs contain them — a minified bundle, an inlined data URI —
 * and a viewer that only ever meets short lines is not being measured honestly.
 */
const LONG_LINE_EVERY = 400

function longLine(random) {
  const chunks = []
  for (let i = 0; i < 40; i += 1) chunks.push(pick(random, IDENTIFIERS))
  return `const inlined = ${JSON.stringify(chunks.join('-')).repeat(6)}`
}

/**
 * @param {number} targetLines total content lines across the whole diff
 * @param {number} seed
 * @returns {string} a unified diff
 */
export function buildSyntheticDiff(targetLines, seed = 0x5eed) {
  const random = createRandom(seed)
  const out = []
  let produced = 0
  let fileIndex = 0
  let lineCounter = 0

  while (produced < targetLines) {
    const path = `src/generated/module-${String(fileIndex).padStart(4, '0')}.ts`
    out.push(`diff --git a/${path} b/${path}`)
    out.push(`index ${hash(random)}..${hash(random)} 100644`)
    out.push(`--- a/${path}`)
    out.push(`+++ b/${path}`)

    const hunksInFile = 3 + Math.floor(random() * 5)
    let oldCursor = 1
    let newCursor = 1

    for (let h = 0; h < hunksInFile && produced < targetLines; h += 1) {
      const lines = []
      const wanted = Math.min(20 + Math.floor(random() * 60), targetLines - produced)

      let oldCount = 0
      let newCount = 0

      for (let i = 0; i < wanted; i += 1) {
        lineCounter += 1
        const roll = random()
        const body =
          lineCounter % LONG_LINE_EVERY === 0
            ? longLine(random)
            : codeLine(random, Math.floor(random() * 4))

        if (roll < 0.7) {
          lines.push(` ${body}`)
          oldCount += 1
          newCount += 1
        } else if (roll < 0.85) {
          lines.push(`+${body}`)
          newCount += 1
        } else {
          lines.push(`-${body}`)
          oldCount += 1
        }
      }

      // A hunk that ended up with nothing on one side is not a hunk git would
      // ever emit, so skip it rather than write a diff that could not exist.
      if (oldCount === 0 || newCount === 0) continue

      out.push(`@@ -${oldCursor},${oldCount} +${newCursor},${newCount} @@ function block${h}()`)
      out.push(...lines)

      produced += lines.length
      oldCursor += oldCount + 10 + Math.floor(random() * 30)
      newCursor += newCount + 10 + Math.floor(random() * 30)
    }

    fileIndex += 1
  }

  return out.join('\n') + '\n'
}

function hash(random) {
  let text = ''
  while (text.length < 7) text += Math.floor(random() * 16).toString(16)
  return text.slice(0, 7)
}

/**
 * A diff of the same size whose changed lines are edits of each other, not
 * unrelated lines.
 *
 * `buildSyntheticDiff` pairs a removal with an unrelated insertion, so the
 * intra-line diff correctly finds nothing to mark and the case measures none of
 * that work. Real diffs are mostly small edits: on the Linux kernel fixture
 * 82% of paired lines carry intra-line marks, against 23% here. This one
 * matches that shape, so the cost of finding what changed inside a line is in
 * the numbers rather than missing from them.
 *
 * A separate function on purpose: the older cases keep their bytes, and the
 * recorded F0, F1 and F2 baselines stay comparable.
 */
export function buildEditedDiff(targetLines, seed = 0xed17) {
  const random = createRandom(seed)
  const out = []
  let produced = 0
  let fileIndex = 0

  while (produced < targetLines) {
    const path = `src/edited/module-${String(fileIndex).padStart(4, '0')}.ts`
    out.push(`diff --git a/${path} b/${path}`)
    out.push(`index ${hash(random)}..${hash(random)} 100644`)
    out.push(`--- a/${path}`)
    out.push(`+++ b/${path}`)

    const hunksInFile = 3 + Math.floor(random() * 5)
    let oldCursor = 1
    let newCursor = 1

    for (let h = 0; h < hunksInFile && produced < targetLines; h += 1) {
      const lines = []
      const wanted = Math.min(20 + Math.floor(random() * 60), targetLines - produced)

      let oldCount = 0
      let newCount = 0

      // Real diffs move in blocks: a little context, then a run that is either
      // a replacement, a pure addition or a pure deletion. Interleaving line by
      // line instead leaves unrelated removals and insertions adjacent, and the
      // pairing then finds partners that were never versions of each other.
      while (lines.length < wanted) {
        for (let c = 0; c < 1 + Math.floor(random() * 2) && lines.length < wanted; c += 1) {
          lines.push(` ${codeLine(random, Math.floor(random() * 4))}`)
          oldCount += 1
          newCount += 1
        }

        const block = 1 + Math.floor(random() * 8)
        const roll = random()

        if (roll < 0.12) {
          const replaced = []
          for (let r = 0; r < Math.min(block, 3) && lines.length < wanted - 1; r += 1) {
            replaced.push(codeLine(random, Math.floor(random() * 4)))
            lines.push(`-${replaced[r]}`)
            oldCount += 1
          }
          for (const body of replaced) {
            lines.push(`+${edit(body, random)}`)
            newCount += 1
          }
        } else if (roll < 0.67) {
          for (let b = 0; b < block && lines.length < wanted; b += 1) {
            lines.push(`+${codeLine(random, Math.floor(random() * 4))}`)
            newCount += 1
          }
        } else {
          for (let b = 0; b < block && lines.length < wanted; b += 1) {
            lines.push(`-${codeLine(random, Math.floor(random() * 4))}`)
            oldCount += 1
          }
        }
      }

      if (oldCount === 0 || newCount === 0) continue

      out.push(`@@ -${oldCursor},${oldCount} +${newCursor},${newCount} @@ function block${h}()`)
      out.push(...lines)

      produced += lines.length
      oldCursor += oldCount + 10 + Math.floor(random() * 30)
      newCursor += newCount + 10 + Math.floor(random() * 30)
    }

    fileIndex += 1
  }

  return out.join(NEWLINE) + NEWLINE
}

/** Swap one identifier for another, leaving the rest of the line alone. */
function edit(line, random) {
  const replacement = pick(random, IDENTIFIERS)
  const match = /[A-Za-z_$][A-Za-z0-9_$]*/.exec(line)
  if (match === null) return `${line} // ${replacement}`
  const at = match.index
  return line.slice(0, at) + replacement + line.slice(at + match[0].length)
}
