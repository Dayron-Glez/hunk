import { describe, expect, it } from 'vitest'
import { readFixture } from '../../../tests/fixtures'
import { parseUnifiedDiff } from '../parse/unified'
import type { DiffLine } from '../parse/types'
import { GHOST, alignHunk, alignedRowCount } from './align'

const lines = (...kinds: DiffLine['kind'][]): DiffLine[] =>
  kinds.map((kind, i) => ({
    kind,
    content: `${kind}${i}`,
    oldNumber: null,
    newNumber: null,
    noNewlineAtEof: false,
  }))

/** Each row as `left|right`, with a dash where a side has nothing. */
const shape = (...kinds: DiffLine['kind'][]): string[] => {
  const source = lines(...kinds)
  return alignHunk(source).map(
    (row) =>
      `${row.old === GHOST ? '-' : (source[row.old]?.content ?? '?')}|` +
      `${row.new === GHOST ? '-' : (source[row.new]?.content ?? '?')}`,
  )
}

describe('pairing the two columns', () => {
  it('puts a context line on both sides of one row', () => {
    expect(shape('context')).toEqual(['context0|context0'])
  })

  it('puts a replaced line beside its replacement', () => {
    expect(shape('delete', 'insert')).toEqual(['delete0|insert1'])
  })

  it('keeps several replacements in order', () => {
    expect(shape('delete', 'delete', 'insert', 'insert')).toEqual([
      'delete0|insert2',
      'delete1|insert3',
    ])
  })
})

describe('gaps', () => {
  it('leaves the right side empty for a line only removed', () => {
    expect(shape('context', 'delete', 'context')).toEqual([
      'context0|context0',
      'delete1|-',
      'context2|context2',
    ])
  })

  it('leaves the left side empty for a line only added', () => {
    expect(shape('context', 'insert')).toEqual(['context0|context0', '-|insert1'])
  })

  it('gives the extra removals a gap when fewer lines replaced them', () => {
    expect(shape('delete', 'delete', 'delete', 'insert')).toEqual([
      'delete0|insert3',
      'delete1|-',
      'delete2|-',
    ])
  })

  it('gives the extra additions a gap when fewer lines were removed', () => {
    expect(shape('delete', 'insert', 'insert', 'insert')).toEqual([
      'delete0|insert1',
      '-|insert2',
      '-|insert3',
    ])
  })

  it('does not pair across context', () => {
    expect(shape('delete', 'context', 'insert')).toEqual([
      'delete0|-',
      'context1|context1',
      '-|insert2',
    ])
  })

  it('handles a hunk with no lines', () => {
    expect(shape()).toEqual([])
  })
})

describe('counting the rows before building them', () => {
  const shapes: DiffLine['kind'][][] = [
    [],
    ['context'],
    ['delete', 'insert'],
    ['delete', 'delete', 'insert', 'insert'],
    ['delete', 'delete', 'delete', 'insert'],
    ['delete', 'insert', 'insert', 'insert'],
    ['delete', 'context', 'insert'],
    ['insert', 'delete'],
  ]

  // The index sizes its typed arrays from the count, so a count that disagrees
  // with the rows would leave the tail of the diff pointing at nothing.
  it.each(shapes)('agrees with the rows themselves: %s', (...kinds) => {
    const source = lines(...kinds)
    expect(alignedRowCount(source)).toBe(alignHunk(source).length)
  })
})

/**
 * What makes the two columns readable: every line appears exactly once, on its
 * own side, in the order the hunk gave it. A line shown twice or dropped is a
 * reader looking at a file that never existed.
 */
describe.each([
  'vite-pr-23346-normal.diff',
  'vite-pr-23378-new-files.diff',
  'prettier-bb52ae36-rename.diff',
  'linux-93e4b307-huge.diff',
] as const)('%s', (name) => {
  const diff = parseUnifiedDiff(readFixture('github', name))

  it('shows every line once and only once, on the side it belongs to', () => {
    for (const file of diff.files) {
      for (const hunk of file.hunks) {
        const rows = alignHunk(hunk.lines)
        const onLeft: number[] = []
        const onRight: number[] = []

        for (const row of rows) {
          if (row.old !== GHOST) onLeft.push(row.old)
          if (row.new !== GHOST) onRight.push(row.new)
        }

        const expectedLeft = hunk.lines
          .map((line, i) => (line.kind === 'insert' ? -1 : i))
          .filter((i) => i !== -1)
        const expectedRight = hunk.lines
          .map((line, i) => (line.kind === 'delete' ? -1 : i))
          .filter((i) => i !== -1)

        expect(onLeft).toEqual(expectedLeft)
        expect(onRight).toEqual(expectedRight)
      }
    }
  })

  it('never produces a row that is empty on both sides', () => {
    for (const file of diff.files) {
      for (const hunk of file.hunks) {
        for (const row of alignHunk(hunk.lines)) {
          expect(row.old === GHOST && row.new === GHOST).toBe(false)
        }
      }
    }
  })

  it('is counted correctly without being built', () => {
    for (const file of diff.files) {
      for (const hunk of file.hunks) {
        expect(alignedRowCount(hunk.lines)).toBe(alignHunk(hunk.lines).length)
      }
    }
  })

  it('needs no more rows than the unified view, and no fewer than either side', () => {
    for (const file of diff.files) {
      for (const hunk of file.hunks) {
        const rows = alignHunk(hunk.lines)
        expect(rows.length).toBeLessThanOrEqual(hunk.lines.length)
        expect(rows.length).toBeGreaterThanOrEqual(Math.max(hunk.oldCount, hunk.newCount))
      }
    }
  })
})
