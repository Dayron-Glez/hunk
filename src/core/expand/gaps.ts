import type { DiffFile, DiffLine, Hunk } from '../parse/types'

/**
 * Unchanged lines a diff left out, between or around its hunks.
 *
 * These are the lines `git diff -U3` decided nobody needed. A diff does not
 * contain them, which is why hunk could not offer this before it could fetch
 * the file — everything in F4 was built from lines the diff already carried.
 *
 * Numbered from 1 and inclusive at both ends, in both files. A gap holds only
 * unchanged lines, so its two numberings run in step and differ by a constant.
 */
export interface Gap {
  /** Hunk above the gap, or -1 when it is the space before the first one. */
  readonly after: number
  /** Hunk below it, or -1 when it runs to the end of the file. */
  readonly before: number
  readonly oldFrom: number
  readonly newFrom: number
  /** Null for the last gap until the length of the file is known. */
  readonly oldTo: number | null
  readonly newTo: number | null
}

/** Lines hidden in a gap, or null while its end is unknown. */
export function sizeOf(gap: Gap): number | null {
  if (gap.newTo === null) return null
  return Math.max(0, gap.newTo - gap.newFrom + 1)
}

/**
 * Every gap in a file, in order.
 *
 * `newFileLines` closes the last one. Without it the diff cannot say where the
 * file ends — a hunk only describes itself — so that gap is left open rather
 * than guessed at.
 */
export function gapsIn(file: DiffFile, newFileLines: number | null = null): Gap[] {
  const gaps: Gap[] = []
  const hunks = file.hunks
  if (hunks.length === 0) return gaps

  // A file that was added or deleted has only one side, and the diff already
  // carries all of it — `@@ -0,0 +1,N @@` and `@@ -1,N +0,0 @@` hide nothing.
  // Asking for gaps there produced one starting at line zero on the kernel
  // commit, which is what a missing side looks like when it is not checked
  // for.
  if (file.oldPath === null || file.newPath === null) return gaps
  if (hunks.some((hunk) => hunk.newStart === 0 || hunk.oldStart === 0)) return gaps

  const first = hunks[0]!
  if (first.newStart > 1 && first.oldStart > 1) {
    gaps.push({
      after: -1,
      before: 0,
      oldFrom: 1,
      newFrom: 1,
      oldTo: first.oldStart - 1,
      newTo: first.newStart - 1,
    })
  }

  for (let i = 0; i < hunks.length - 1; i += 1) {
    const above = hunks[i]!
    const below = hunks[i + 1]!
    const newFrom = above.newStart + above.newCount
    const oldFrom = above.oldStart + above.oldCount
    if (below.newStart <= newFrom) continue
    gaps.push({
      after: i,
      before: i + 1,
      oldFrom,
      newFrom,
      oldTo: below.oldStart - 1,
      newTo: below.newStart - 1,
    })
  }

  const last = hunks[hunks.length - 1]!
  const tailFrom = last.newStart + last.newCount
  const tailOldFrom = last.oldStart + last.oldCount
  if (newFileLines === null || tailFrom <= newFileLines) {
    gaps.push({
      after: hunks.length - 1,
      before: -1,
      oldFrom: tailOldFrom,
      newFrom: tailFrom,
      oldTo: newFileLines === null ? null : newFileLines - (tailFrom - tailOldFrom),
      newTo: newFileLines,
    })
  }

  return gaps
}

/**
 * Whether a fetched file is the one this diff was made against.
 *
 * The file is fetched at `refs/pull/N/head`, which follows the pull request
 * rather than pinning a commit — one API call instead of two, and no fork to
 * resolve. The cost is that a push between loading the diff and opening a gap
 * would hand back a file the numbers no longer fit, and the revealed lines
 * would be quietly wrong.
 *
 * So they are checked. Every line the diff already carries for the new side
 * says what it should find at its own number; if the file disagrees anywhere,
 * it has moved and nothing is revealed from it.
 */
export function fileMatchesDiff(file: DiffFile, source: readonly string[]): boolean {
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.newNumber === null) continue
      // A line marked as having no trailing newline can differ harmlessly.
      if (line.noNewlineAtEof) continue
      if (source[line.newNumber - 1] !== line.content) return false
    }
  }
  return true
}

/** Which end of a gap to open, named by the hunk the lines join. */
export type Direction = 'up' | 'down' | 'all'

/**
 * A file with some of a gap filled in.
 *
 * The revealed lines join a neighbouring hunk rather than becoming a hunk of
 * their own, because that is what they were: `-U3` is a display choice, not a
 * property of the change. Opening a gap completely merges the hunks either
 * side of it, since a header between two adjacent runs would announce a break
 * that is no longer there.
 *
 * `source` is the *new* file, split into lines. A gap holds only unchanged
 * lines, so one side is enough and the other numbering follows by the
 * constant offset between them.
 */
export function expandGap(
  file: DiffFile,
  gap: Gap,
  source: readonly string[],
  direction: Direction,
  chunk: number,
): DiffFile {
  const available = sizeOf(gap)
  if (available === null || available <= 0) return file

  const take = direction === 'all' ? available : Math.min(chunk, available)
  const fromTop = direction === 'down' || direction === 'all'

  const newStart = fromTop ? gap.newFrom : gap.newFrom + available - take
  const offset = gap.oldFrom - gap.newFrom
  const revealed = linesOf(source, newStart, take, offset)
  if (revealed.length === 0) return file

  const hunks = [...file.hunks]
  const closed = revealed.length === available

  if (gap.after === -1) {
    hunks[gap.before] = prepend(hunks[gap.before]!, revealed)
  } else if (gap.before === -1) {
    hunks[gap.after] = append(hunks[gap.after]!, revealed)
  } else if (fromTop) {
    hunks[gap.after] = append(hunks[gap.after]!, revealed)
  } else {
    hunks[gap.before] = prepend(hunks[gap.before]!, revealed)
  }

  if (closed && gap.after !== -1 && gap.before !== -1) {
    hunks.splice(gap.after, 2, merge(hunks[gap.after]!, hunks[gap.before]!))
  }

  return { ...file, hunks }
}

/** Context lines for a run of the new file, numbered on both sides. */
function linesOf(
  source: readonly string[],
  newStart: number,
  count: number,
  offset: number,
): DiffLine[] {
  const lines: DiffLine[] = []
  for (let i = 0; i < count; i += 1) {
    const number = newStart + i
    const content = source[number - 1]
    // The file is shorter than the diff implied: stop rather than invent.
    if (content === undefined) break
    lines.push({
      kind: 'context',
      content,
      oldNumber: number + offset,
      newNumber: number,
      noNewlineAtEof: false,
    })
  }
  return lines
}

function append(hunk: Hunk, lines: readonly DiffLine[]): Hunk {
  return {
    ...hunk,
    oldCount: hunk.oldCount + lines.length,
    newCount: hunk.newCount + lines.length,
    lines: [...hunk.lines, ...lines],
  }
}

function prepend(hunk: Hunk, lines: readonly DiffLine[]): Hunk {
  return {
    ...hunk,
    oldStart: hunk.oldStart - lines.length,
    newStart: hunk.newStart - lines.length,
    oldCount: hunk.oldCount + lines.length,
    newCount: hunk.newCount + lines.length,
    lines: [...lines, ...hunk.lines],
  }
}

/** The section of the upper one: it is the run the reader was already in. */
function merge(above: Hunk, below: Hunk): Hunk {
  return {
    oldStart: above.oldStart,
    oldCount: above.oldCount + below.oldCount,
    newStart: above.newStart,
    newCount: above.newCount + below.newCount,
    section: above.section,
    lines: [...above.lines, ...below.lines],
  }
}
