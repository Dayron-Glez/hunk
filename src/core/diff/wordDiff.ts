export interface Range {
  readonly start: number
  readonly end: number
}

export interface WordChanges {
  /** Parts of the removed line that are not in the added one. */
  readonly before: readonly Range[]
  /** Parts of the added line that were not in the removed one. */
  readonly after: readonly Range[]
}

const EMPTY: WordChanges = { before: [], after: [] }

/**
 * Past this many differing tokens the table stops being worth building, and a
 * line that far apart is a rewrite rather than an edit.
 */
const MAX_TOKENS = 300

/**
 * Tokenizing is linear but not free: a pair of 66.000 character lines costs
 * 5.7 ms even when the edit is tiny, against 0.5 ms at this length. The same
 * ceiling the highlighter uses, for the same reason — past it a line is
 * minified, and nobody reads it closely enough to care which word moved.
 */
const MAX_LINE_LENGTH = 2_000

/**
 * Below this share of the line surviving, the two lines are not versions of
 * each other. Marking most of both as changed tells the reader nothing they
 * cannot see from the red and the green.
 */
const MIN_COMMON = 0.25

const WORD = /[\p{L}\p{N}_$]/u

/**
 * What changed inside a pair of lines.
 *
 * Runs only for lines on screen: at 100.000 lines the diff nobody scrolled to
 * is work nobody asked for. Returns nothing when the two lines share too
 * little, because highlighting a whole line as changed repeats what its colour
 * already says.
 */
export function wordDiff(before: string, after: string): WordChanges {
  if (before === after) return EMPTY
  if (before.length > MAX_LINE_LENGTH || after.length > MAX_LINE_LENGTH) return EMPTY

  const a = tokenize(before)
  const b = tokenize(after)

  let prefix = 0
  const shortest = Math.min(a.text.length, b.text.length)
  while (prefix < shortest && a.text[prefix] === b.text[prefix]) prefix += 1

  let suffix = 0
  while (
    suffix < shortest - prefix &&
    a.text[a.text.length - 1 - suffix] === b.text[b.text.length - 1 - suffix]
  ) {
    suffix += 1
  }

  const aMiddle = a.text.slice(prefix, a.text.length - suffix)
  const bMiddle = b.text.slice(prefix, b.text.length - suffix)

  const changed =
    aMiddle.length > MAX_TOKENS || bMiddle.length > MAX_TOKENS
      ? { a: aMiddle.map((_, i) => i), b: bMiddle.map((_, i) => i) }
      : changedTokens(aMiddle, bMiddle)

  const result = {
    before: toRanges(a, prefix, changed.a, before.length),
    after: toRanges(b, prefix, changed.b, after.length),
  }

  return worthShowing(result, before.length, after.length) ? result : EMPTY
}

interface Tokens {
  readonly text: string[]
  readonly starts: number[]
}

/**
 * Words, runs of whitespace, and every other character on its own. Splitting on
 * word boundaries rather than characters is what makes the result read as "this
 * identifier changed" instead of a scatter of letters.
 */
function tokenize(line: string): Tokens {
  const text: string[] = []
  const starts: number[] = []

  let i = 0
  while (i < line.length) {
    const start = i
    const char = line[i]!

    if (WORD.test(char)) {
      while (i < line.length && WORD.test(line[i]!)) i += 1
    } else if (char === ' ' || char === '\t') {
      while (i < line.length && (line[i] === ' ' || line[i] === '\t')) i += 1
    } else {
      i += 1
    }

    text.push(line.slice(start, i))
    starts.push(start)
  }

  return { text, starts }
}

/** Token indices on each side that are not part of the longest common subsequence. */
function changedTokens(a: string[], b: string[]): { a: number[]; b: number[] } {
  const rows = a.length + 1
  const columns = b.length + 1
  const table = new Uint16Array(rows * columns)

  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * columns + j] =
        a[i] === b[j]
          ? table[(i + 1) * columns + j + 1]! + 1
          : Math.max(table[(i + 1) * columns + j]!, table[i * columns + j + 1]!)
    }
  }

  const changedA: number[] = []
  const changedB: number[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1
      j += 1
    } else if (table[(i + 1) * columns + j]! >= table[i * columns + j + 1]!) {
      changedA.push(i)
      i += 1
    } else {
      changedB.push(j)
      j += 1
    }
  }
  for (; i < a.length; i += 1) changedA.push(i)
  for (; j < b.length; j += 1) changedB.push(j)

  return { a: changedA, b: changedB }
}

/** Token indices of the middle to character ranges of the whole line, merged. */
function toRanges(
  tokens: Tokens,
  offset: number,
  middleIndices: readonly number[],
  lineLength: number,
): Range[] {
  const ranges: Range[] = []

  for (const middleIndex of middleIndices) {
    const index = middleIndex + offset
    const start = tokens.starts[index]!
    const end = tokens.starts[index + 1] ?? lineLength

    const last = ranges[ranges.length - 1]
    if (last?.end === start) ranges[ranges.length - 1] = { start: last.start, end }
    else ranges.push({ start, end })
  }

  return ranges
}

function worthShowing(changes: WordChanges, beforeLength: number, afterLength: number): boolean {
  const changedBefore = span(changes.before)
  const changedAfter = span(changes.after)
  if (changedBefore === 0 && changedAfter === 0) return false

  const commonBefore = beforeLength === 0 ? 1 : 1 - changedBefore / beforeLength
  const commonAfter = afterLength === 0 ? 1 : 1 - changedAfter / afterLength
  return commonBefore >= MIN_COMMON && commonAfter >= MIN_COMMON
}

function span(ranges: readonly Range[]): number {
  let total = 0
  for (const range of ranges) total += range.end - range.start
  return total
}
