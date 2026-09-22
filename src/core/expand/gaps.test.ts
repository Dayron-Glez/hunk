import { describe, expect, it } from 'vitest'
import { readFixture } from '../../../tests/fixtures'
import { parseUnifiedDiff } from '../parse/unified'
import type { DiffFile, Hunk } from '../parse/types'
import { expandGap, fileMatchesDiff, gapsIn, sizeOf } from './gaps'

/** A file of numbered lines, so a revealed line says where it came from. */
const source = (count: number): string[] => Array.from({ length: count }, (_, i) => `line ${i + 1}`)

const hunk = (oldStart: number, newStart: number, kinds: string): Hunk => {
  const lines = []
  let oldNumber = oldStart
  let newNumber = newStart
  let oldCount = 0
  let newCount = 0
  for (const mark of kinds) {
    if (mark === ' ') {
      lines.push({
        kind: 'context' as const,
        content: `line ${newNumber}`,
        oldNumber,
        newNumber,
        noNewlineAtEof: false,
      })
      oldNumber += 1
      newNumber += 1
      oldCount += 1
      newCount += 1
    } else if (mark === '+') {
      lines.push({
        kind: 'insert' as const,
        content: 'added',
        oldNumber: null,
        newNumber,
        noNewlineAtEof: false,
      })
      newNumber += 1
      newCount += 1
    } else {
      lines.push({
        kind: 'delete' as const,
        content: 'removed',
        oldNumber,
        newNumber: null,
        noNewlineAtEof: false,
      })
      oldNumber += 1
      oldCount += 1
    }
  }
  return { oldStart, oldCount, newStart, newCount, section: '', lines }
}

const fileOf = (...hunks: Hunk[]): DiffFile => ({
  oldPath: 'a.ts',
  newPath: 'a.ts',
  status: 'modified',
  oldMode: null,
  newMode: null,
  similarity: null,
  binary: false,
  submodule: false,
  combined: false,
  hunks,
  additions: 0,
  deletions: 0,
})

describe('finding the gaps', () => {
  it('sees the lines before the first hunk', () => {
    const gaps = gapsIn(fileOf(hunk(10, 10, ' + ')))
    expect(gaps[0]).toMatchObject({ after: -1, before: 0, oldFrom: 1, newFrom: 1, newTo: 9 })
    expect(sizeOf(gaps[0]!)).toBe(9)
  })

  it('sees the lines between two hunks', () => {
    const gaps = gapsIn(fileOf(hunk(1, 1, '  '), hunk(20, 21, '  ')))
    const between = gaps.find((g) => g.after === 0 && g.before === 1)!
    expect(between).toMatchObject({ oldFrom: 3, newFrom: 3, oldTo: 19, newTo: 20 })
    expect(sizeOf(between)).toBe(18)
  })

  it('leaves the last gap open until the file says how long it is', () => {
    const gaps = gapsIn(fileOf(hunk(1, 1, '  ')))
    const tail = gaps.at(-1)!
    expect(tail).toMatchObject({ before: -1, newFrom: 3, newTo: null })
    expect(sizeOf(tail)).toBeNull()
  })

  it('closes the last gap once it does', () => {
    const tail = gapsIn(fileOf(hunk(1, 1, '  ')), 40).at(-1)!
    expect(tail.newTo).toBe(40)
    expect(sizeOf(tail)).toBe(38)
  })

  it('offers no trailing gap when the hunk already reaches the end', () => {
    expect(gapsIn(fileOf(hunk(1, 1, '  ')), 2)).toEqual([])
  })

  it('offers nothing before a hunk that starts at line one', () => {
    const gaps = gapsIn(fileOf(hunk(1, 1, '  ')), 2)
    expect(gaps.every((g) => g.after !== -1)).toBe(true)
  })

  it('has nothing to say about a file with no hunks', () => {
    expect(gapsIn(fileOf())).toEqual([])
  })

  /**
   * A file with one side has no hidden middle: the diff already carries all
   * of it. Before this was checked, the kernel commit produced a gap starting
   * at line zero, which is what `@@ -1,N +0,0 @@` looks like unnoticed.
   */
  it('offers nothing for a file that was added', () => {
    const added: DiffFile = {
      ...fileOf(hunk(1, 1, '  ')),
      oldPath: null,
      status: 'added',
      hunks: [{ oldStart: 0, oldCount: 0, newStart: 1, newCount: 2, section: '', lines: [] }],
    }
    expect(gapsIn(added)).toEqual([])
  })

  it('offers nothing for a file that was deleted', () => {
    const deleted: DiffFile = {
      ...fileOf(hunk(1, 1, '  ')),
      newPath: null,
      status: 'deleted',
      hunks: [{ oldStart: 1, oldCount: 2, newStart: 0, newCount: 0, section: '', lines: [] }],
    }
    expect(gapsIn(deleted)).toEqual([])
  })

  it('skips a gap between hunks that are already touching', () => {
    const gaps = gapsIn(fileOf(hunk(1, 1, '  '), hunk(3, 3, '  ')), 4)
    expect(gaps.filter((g) => g.after === 0 && g.before === 1)).toEqual([])
  })
})

describe('opening a gap', () => {
  const two = () => fileOf(hunk(1, 1, '  '), hunk(20, 20, '  '))

  it('joins the lines to the hunk above when opened downwards', () => {
    const gap = gapsIn(two()).find((g) => g.after === 0)!
    const after = expandGap(two(), gap, source(40), 'down', 5)

    const above = after.hunks[0]!
    expect(above.newCount).toBe(7)
    expect(above.lines.at(-1)).toMatchObject({ content: 'line 7', newNumber: 7, kind: 'context' })
    // Still two hunks: the gap is narrower, not gone.
    expect(after.hunks).toHaveLength(2)
  })

  it('joins them to the hunk below when opened upwards', () => {
    const gap = gapsIn(two()).find((g) => g.after === 0)!
    const after = expandGap(two(), gap, source(40), 'up', 5)

    const below = after.hunks[1]!
    expect(below.newStart).toBe(15)
    expect(below.newCount).toBe(7)
    expect(below.lines[0]).toMatchObject({ content: 'line 15', newNumber: 15 })
  })

  /** A header between two runs that now touch would announce a break that is
   *  no longer there. */
  it('merges the hunks when the gap closes', () => {
    const gap = gapsIn(two()).find((g) => g.after === 0)!
    const after = expandGap(two(), gap, source(40), 'all', 5)

    expect(after.hunks).toHaveLength(1)
    const merged = after.hunks[0]!
    expect(merged.newStart).toBe(1)
    expect(merged.newCount).toBe(21)
    expect(merged.lines.map((l) => l.newNumber)).toEqual(
      Array.from({ length: 21 }, (_, i) => i + 1),
    )
  })

  it('never reveals more than the gap holds', () => {
    const gap = gapsIn(two()).find((g) => g.after === 0)!
    const after = expandGap(two(), gap, source(40), 'down', 9_999)
    expect(after.hunks).toHaveLength(1)
    expect(after.hunks[0]!.newCount).toBe(21)
  })

  it('opens the space above the first hunk', () => {
    const file = fileOf(hunk(10, 10, '  '))
    const gap = gapsIn(file).find((g) => g.after === -1)!
    const after = expandGap(file, gap, source(40), 'up', 4)

    expect(after.hunks[0]!.newStart).toBe(6)
    expect(after.hunks[0]!.lines[0]).toMatchObject({ content: 'line 6', newNumber: 6 })
  })

  it('opens the space after the last hunk', () => {
    const file = fileOf(hunk(1, 1, '  '))
    const gap = gapsIn(file, 30).at(-1)!
    const after = expandGap(file, gap, source(30), 'down', 4)

    expect(after.hunks[0]!.newCount).toBe(6)
    expect(after.hunks[0]!.lines.at(-1)).toMatchObject({ content: 'line 6', newNumber: 6 })
  })

  it('stops at the end of a file shorter than the diff implied', () => {
    const file = fileOf(hunk(1, 1, '  '))
    const gap = gapsIn(file, 10).at(-1)!
    // Only four lines really exist, and the gap claims eight.
    const after = expandGap(file, gap, source(4), 'down', 8)
    expect(after.hunks[0]!.newCount).toBe(4)
  })

  it('changes nothing when there is nothing to reveal', () => {
    const file = fileOf(hunk(1, 1, '  '))
    const gap = gapsIn(file, 2).at(-1)
    expect(gap).toBeUndefined()
    const open = gapsIn(file).at(-1)!
    // Its end is unknown, so nothing can be taken from it.
    expect(expandGap(file, open, source(10), 'down', 4)).toBe(file)
  })
})

/**
 * The numbering is what makes this worth doing rather than merely possible: a
 * revealed line has to carry the right number on both sides, and the two
 * differ by however much the hunks above it added or removed.
 */
describe('numbering the revealed lines', () => {
  it('keeps the two sides apart when the change shifted them', () => {
    // The first hunk adds two lines, so after it the new file runs two ahead.
    const file = fileOf(hunk(1, 1, ' ++ '), hunk(30, 32, '  '))
    const gap = gapsIn(file).find((g) => g.after === 0)!
    expect(gap.oldFrom).toBe(3)
    expect(gap.newFrom).toBe(5)

    const after = expandGap(file, gap, source(60), 'down', 3)
    const revealed = after.hunks[0]!.lines.slice(-3)
    expect(revealed.map((l) => [l.oldNumber, l.newNumber])).toEqual([
      [3, 5],
      [4, 6],
      [5, 7],
    ])
  })

  it('takes the content from the new file at the new number', () => {
    const file = fileOf(hunk(1, 1, ' + '), hunk(40, 41, '  '))
    const gap = gapsIn(file).find((g) => g.after === 0)!
    const after = expandGap(file, gap, source(80), 'down', 2)
    expect(after.hunks[0]!.lines.slice(-2).map((l) => l.content)).toEqual(['line 4', 'line 5'])
  })

  it('marks everything it reveals as unchanged', () => {
    const file = fileOf(hunk(1, 1, '  '), hunk(20, 20, '  '))
    const gap = gapsIn(file).find((g) => g.after === 0)!
    const after = expandGap(file, gap, source(40), 'all', 5)
    for (const line of after.hunks[0]!.lines) {
      if (line.newNumber !== null && line.newNumber > 2 && line.newNumber < 20) {
        expect(line.kind).toBe('context')
      }
    }
  })
})

/**
 * Over a real diff rather than a built one. Every gap has to sit strictly
 * between the hunks it separates, or expanding it would duplicate or skip
 * lines of the file.
 */
describe.each([
  'vite-pr-23346-normal.diff',
  'vite-pr-23378-new-files.diff',
  'prettier-bb52ae36-rename.diff',
  'linux-93e4b307-huge.diff',
] as const)('%s', (name) => {
  const diff = parseUnifiedDiff(readFixture('github', name))

  it('puts every gap between its neighbours, without overlap', () => {
    for (const file of diff.files) {
      for (const gap of gapsIn(file)) {
        expect(gap.newFrom).toBeGreaterThan(0)
        if (gap.newTo !== null) expect(gap.newTo).toBeGreaterThanOrEqual(gap.newFrom - 1)

        if (gap.after !== -1) {
          const above = file.hunks[gap.after]!
          expect(gap.newFrom).toBe(above.newStart + above.newCount)
        }
        if (gap.before !== -1) {
          const below = file.hunks[gap.before]!
          expect(gap.newTo).toBe(below.newStart - 1)
        }
      }
    }
  })

  it('keeps the two numberings a constant apart inside one gap', () => {
    for (const file of diff.files) {
      for (const gap of gapsIn(file)) {
        if (gap.newTo === null || gap.oldTo === null) continue
        expect(gap.oldTo - gap.oldFrom).toBe(gap.newTo - gap.newFrom)
      }
    }
  })

  it('leaves the line count of the file unchanged when a gap is opened', () => {
    for (const file of diff.files) {
      const gaps = gapsIn(file)
      const between = gaps.find((g) => g.after !== -1 && g.before !== -1)
      if (between === undefined) continue

      const size = sizeOf(between)!
      const after = expandGap(file, between, source(100_000), 'all', 20)
      const before = file.hunks.reduce((n, h) => n + h.lines.length, 0)
      expect(after.hunks.reduce((n, h) => n + h.lines.length, 0)).toBe(before + size)
      return
    }
  })
})

/**
 * The file is fetched at the pull request's head rather than at a pinned
 * commit — one API call instead of two, and no fork to resolve. A push
 * between loading the diff and opening a gap would hand back a file the
 * numbers no longer fit, so the lines the diff already carries are what
 * decides whether it is still the right file.
 */
describe('refusing a file that has moved on', () => {
  const file = fileOf(hunk(3, 3, ' + '))

  const fileAt = (...lines: string[]): string[] => lines

  it('accepts the file the diff was made against', () => {
    // The hunk holds context at 3 and 5, and an insertion at 4.
    const source = fileAt('line 1', 'line 2', 'line 3', 'added', 'line 5')
    expect(fileMatchesDiff(file, source)).toBe(true)
  })

  it('refuses one where a line has changed underneath', () => {
    const source = fileAt('line 1', 'line 2', 'line 3', 'added', 'something else')
    expect(fileMatchesDiff(file, source)).toBe(false)
  })

  it('refuses one where the lines have shifted', () => {
    const source = fileAt('new', 'line 1', 'line 2', 'line 3', 'added', 'line 5')
    expect(fileMatchesDiff(file, source)).toBe(false)
  })

  it('refuses one that is too short to hold them', () => {
    expect(fileMatchesDiff(file, fileAt('line 1', 'line 2'))).toBe(false)
  })

  it('judges on the new side only, since that is what was fetched', () => {
    // Context at new 3, a removal with no new number at all, then context at
    // new 4 — the removed line is skipped and the numbering closes over it.
    const removals = fileOf(hunk(3, 3, ' - '))
    expect(fileMatchesDiff(removals, fileAt('a', 'b', 'line 3', 'line 4'))).toBe(true)
  })

  it('has nothing to disagree with in a file of no hunks', () => {
    expect(fileMatchesDiff(fileOf(), [])).toBe(true)
  })
})
