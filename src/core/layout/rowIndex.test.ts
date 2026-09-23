import { describe, expect, it } from 'vitest'
import { readFixture } from '../../../tests/fixtures'
import { parseUnifiedDiff } from '../parse/unified'
import { RowIndex, RowKind } from './rowIndex'

const NAMES: Record<RowKind, string> = {
  0: 'file-header',
  1: 'note',
  2: 'hunk-header',
  3: 'line',
  4: 'gap',
}

const shapeOf = (index: RowIndex): string[] =>
  Array.from({ length: index.length }, (_, row) => NAMES[index.kindAt(row)])

const indexOf = (set: 'github' | 'edge', name: string): RowIndex =>
  new RowIndex(parseUnifiedDiff(readFixture(set, name)))

describe('shape', () => {
  it('lays a file out as a header followed by its hunks and lines', () => {
    const index = indexOf('edge', 'single-line-hunk-header.diff')
    expect(shapeOf(index)).toEqual(['file-header', 'hunk-header', 'line', 'line'])
  })

  it('gives a file with no hunks a note row instead of nothing', () => {
    const index = indexOf('edge', 'mode-change-only.diff')
    expect(shapeOf(index)).toEqual(['file-header', 'note'])
  })

  it('gives a binary file a note row too', () => {
    const index = indexOf('github', 'github-docs-5dc99214-binary-delete.diff')
    expect(shapeOf(index)).toEqual(['file-header', 'note'])
  })

  it('has no rows at all for an empty diff', () => {
    const index = new RowIndex(parseUnifiedDiff(''))
    expect(index.length).toBe(0)
    expect(index.fileCount).toBe(0)
  })

  it('puts a header before each of several hunks', () => {
    const index = indexOf('edge', 'many-hunks.diff')
    expect(shapeOf(index).filter((kind) => kind === 'hunk-header')).toHaveLength(3)
    expect(shapeOf(index)[0]).toBe('file-header')
  })
})

describe('resolving a row back to the diff', () => {
  it('returns the line a row shows', () => {
    const index = indexOf('edge', 'single-line-hunk-header.diff')
    expect(index.lineAt(2)).toMatchObject({ kind: 'delete', content: 'solo' })
    expect(index.lineAt(3)).toMatchObject({ kind: 'insert', content: 'unico' })
  })

  it('returns null where there is no line or hunk', () => {
    const index = indexOf('edge', 'single-line-hunk-header.diff')
    expect(index.lineAt(0)).toBeNull()
    expect(index.hunkAt(0)).toBeNull()
    expect(index.lineAt(1)).toBeNull()
    expect(index.hunkAt(1)).not.toBeNull()
  })

  it('reports -1 rather than a bogus index for an absent hunk or line', () => {
    const index = indexOf('edge', 'mode-change-only.diff')
    expect(index.hunkIndexAt(0)).toBe(-1)
    expect(index.lineIndexAt(1)).toBe(-1)
  })

  it('points every row at its file', () => {
    const diff = parseUnifiedDiff(readFixture('github', 'vite-pr-23346-normal.diff'))
    const index = new RowIndex(diff)
    for (let row = 0; row < index.length; row += 1) {
      expect(index.fileAt(row)).toBe(diff.files[index.fileIndexAt(row)])
    }
  })

  it('refuses a row outside the document', () => {
    const index = indexOf('edge', 'mode-change-only.diff')
    expect(() => index.kindAt(2)).toThrow(RangeError)
    expect(() => index.kindAt(-1)).toThrow(RangeError)
  })
})

describe('finding files', () => {
  it('reports where each file starts', () => {
    const index = indexOf('github', 'vite-pr-23346-normal.diff')
    expect(index.fileCount).toBe(2)
    expect(index.rowOfFile(0)).toBe(0)
    expect(index.kindAt(index.rowOfFile(1))).toBe(0)
    expect(index.fileIndexAt(index.rowOfFile(1))).toBe(1)
  })

  it('refuses a file outside the diff', () => {
    const index = indexOf('github', 'vite-pr-23346-normal.diff')
    expect(() => index.rowOfFile(2)).toThrow(RangeError)
  })
})

/**
 * Run over the whole corpus rather than a chosen example. The index is the
 * translation between the parse model and the screen, and a row that resolves
 * to the wrong line is a bug nobody sees until a reader comments on the wrong
 * place in someone's pull request.
 */
describe.each([
  ['github', 'vite-pr-23346-normal.diff'],
  ['github', 'vite-pr-23378-new-files.diff'],
  ['github', 'prettier-bb52ae36-rename.diff'],
  ['github', 'github-docs-90ce4889-binary-add.diff'],
  ['github', 'git-86cfd61e-submodule-add.diff'],
  ['github', 'npm-cli-47fc8b19-mass-rename.diff'],
  ['github', 'npm-cli-75a943de-minified-bundle.diff'],
  ['github', 'linux-93e4b307-huge.diff'],
] as const)('%s/%s holds the index invariants', (set, name) => {
  const diff = parseUnifiedDiff(readFixture(set, name))
  const index = new RowIndex(diff)

  it('has exactly one row per header, note and line', () => {
    let expected = 0
    for (const file of diff.files) {
      expected += 1
      if (file.hunks.length === 0) {
        expected += 1
        continue
      }
      for (const hunk of file.hunks) expected += 1 + hunk.lines.length
    }
    expect(index.length).toBe(expected)
  })

  it('resolves every row to the same object the parse model holds', () => {
    for (let row = 0; row < index.length; row += 1) {
      const file = diff.files[index.fileIndexAt(row)]
      expect(index.fileAt(row)).toBe(file)

      const hunkIndex = index.hunkIndexAt(row)
      if (hunkIndex !== -1) expect(index.hunkAt(row)).toBe(file?.hunks[hunkIndex])

      const lineIndex = index.lineIndexAt(row)
      if (lineIndex !== -1) expect(index.lineAt(row)).toBe(file?.hunks[hunkIndex]?.lines[lineIndex])
    }
  })

  it('walks files in order, each starting at its own header', () => {
    let previous = -1
    for (let fileIndex = 0; fileIndex < index.fileCount; fileIndex += 1) {
      const row = index.rowOfFile(fileIndex)
      expect(row).toBeGreaterThan(previous)
      expect(index.kindAt(row)).toBe(0)
      expect(index.fileIndexAt(row)).toBe(fileIndex)
      previous = row
    }
  })
})

describe('at scale', () => {
  it('indexes the kernel commit without building a million objects', () => {
    const diff = parseUnifiedDiff(readFixture('github', 'linux-93e4b307-huge.diff'))
    const startedAt = performance.now()
    const index = new RowIndex(diff)
    const elapsed = performance.now() - startedAt

    expect(index.length).toBeGreaterThan(60_000)
    // Four typed arrays over one pass. Anything near a second means it started
    // allocating per row.
    expect(elapsed).toBeLessThan(250)
  })

  it('pairs the columns of the same commit without walking it twice over', () => {
    const diff = parseUnifiedDiff(readFixture('github', 'linux-93e4b307-huge.diff'))
    const startedAt = performance.now()
    const index = new RowIndex(diff, 'split')
    const elapsed = performance.now() - startedAt

    // 61.457 rows against 64.807 unified: the 3.350 pairs that share one row.
    expect(index.length).toBeLessThan(new RowIndex(diff).length)
    // 10 ms measured, against 4 ms unified — the aligner allocates a row object
    // per line, and this runs once when the reader switches, not per frame.
    expect(elapsed).toBeLessThan(250)
  })
})

describe('two columns', () => {
  const split = (set: 'github' | 'edge', name: string): RowIndex =>
    new RowIndex(parseUnifiedDiff(readFixture(set, name)), 'split')

  /** Each row as `left|right`, with a dash where a column has a gap. */
  const cells = (index: RowIndex): string[] => {
    const out: string[] = []
    for (let row = 0; row < index.length; row += 1) {
      if (index.kindAt(row) !== 3) continue
      out.push(
        `${index.cellAt(row, 'old')?.content ?? '-'}|${index.cellAt(row, 'new')?.content ?? '-'}`,
      )
    }
    return out
  }

  it('puts a replaced line beside its replacement on one row', () => {
    expect(cells(split('edge', 'single-line-hunk-header.diff'))).toEqual(['solo|unico'])
  })

  it('still lays headers and notes out the same way', () => {
    expect(shapeOf(split('edge', 'mode-change-only.diff'))).toEqual(['file-header', 'note'])
  })

  it('has no rows at all for an empty diff', () => {
    expect(new RowIndex(parseUnifiedDiff(''), 'split').length).toBe(0)
  })

  it('reports which layout it was built for', () => {
    expect(split('edge', 'many-hunks.diff').mode).toBe('split')
    expect(indexOf('edge', 'many-hunks.diff').mode).toBe('unified')
  })
})

/**
 * A line the reader cannot see, or one shown twice, is a file that never
 * existed. The unified mode has held this since F1; the two-column mode drops
 * rows on purpose, so it needs saying again over the same corpus.
 */
describe.each([
  ['github', 'vite-pr-23346-normal.diff'],
  ['github', 'vite-pr-23378-new-files.diff'],
  ['github', 'prettier-bb52ae36-rename.diff'],
  ['github', 'npm-cli-47fc8b19-mass-rename.diff'],
  ['github', 'linux-93e4b307-huge.diff'],
] as const)('%s/%s holds them in two columns too', (set, name) => {
  const diff = parseUnifiedDiff(readFixture(set, name))
  const index = new RowIndex(diff, 'split')

  it('shows every line exactly once, in the column its kind belongs to', () => {
    const seen = new Map<string, number>()
    for (let row = 0; row < index.length; row += 1) {
      if (index.kindAt(row) !== 3) continue
      const key = `${index.fileIndexAt(row)}:${index.hunkIndexAt(row)}`

      for (const column of ['old', 'new'] as const) {
        const lineIndex = index.cellIndexAt(row, column)
        if (lineIndex === -1) continue
        const kind = index.cellAt(row, column)?.kind
        expect(kind).not.toBe(column === 'old' ? 'insert' : 'delete')
        const mark = `${key}:${column}:${lineIndex}`
        expect(seen.has(mark)).toBe(false)
        seen.set(mark, row)
      }
    }

    let expected = 0
    for (const file of diff.files) {
      for (const hunk of file.hunks) {
        for (const line of hunk.lines) expected += line.kind === 'context' ? 2 : 1
      }
    }
    expect(seen.size).toBe(expected)
  })

  it('never leaves a line row with both columns empty', () => {
    for (let row = 0; row < index.length; row += 1) {
      if (index.kindAt(row) !== 3) continue
      expect(index.cellIndexAt(row, 'old') === -1 && index.cellIndexAt(row, 'new') === -1).toBe(
        false,
      )
    }
  })

  it('needs fewer rows than the unified view of the same diff', () => {
    expect(index.length).toBeLessThanOrEqual(new RowIndex(diff).length)
  })
})

/**
 * A row wherever the diff left unchanged lines out — but only for a diff that
 * came from somewhere those lines can be fetched. A pasted `.diff` carries no
 * repository, and a button that cannot do anything is worse than no button.
 */
describe('rows for what the diff left out', () => {
  const load = (set: 'github' | 'edge', name: string) => parseUnifiedDiff(readFixture(set, name))

  it('adds none unless the diff can be expanded', () => {
    const diff = load('github', 'vite-pr-23346-normal.diff')
    const plain = new RowIndex(diff)
    for (let row = 0; row < plain.length; row += 1) {
      expect(plain.kindAt(row)).not.toBe(RowKind.Gap)
      expect(plain.gapAt(row)).toBeNull()
    }
  })

  it('adds one above each hunk that has lines hidden before it', () => {
    const diff = load('github', 'vite-pr-23346-normal.diff')
    const expandable = new RowIndex(diff, 'unified', true)

    let gapRows = 0
    for (let row = 0; row < expandable.length; row += 1) {
      if (expandable.kindAt(row) !== RowKind.Gap) continue
      gapRows += 1
      expect(expandable.gapAt(row)).not.toBeNull()
      // It sits directly above the hunk header it runs into.
      expect(expandable.kindAt(row + 1)).toBe(RowKind.HunkHeader)
      expect(expandable.hunkIndexAt(row)).toBe(expandable.hunkIndexAt(row + 1))
    }
    // Both files of that pull request start well past line one.
    expect(gapRows).toBe(2)
    expect(expandable.length).toBe(new RowIndex(diff).length + 2)
  })

  it('offers nothing after the last hunk, whose end is unknown', () => {
    const diff = load('github', 'vite-pr-23346-normal.diff')
    const expandable = new RowIndex(diff, 'unified', true)

    for (let row = 0; row < expandable.length; row += 1) {
      const gap = expandable.gapAt(row)
      if (gap !== null) expect(gap.before).not.toBe(-1)
    }
  })

  it('works the same in two columns', () => {
    const diff = load('github', 'vite-pr-23346-normal.diff')
    const split = new RowIndex(diff, 'split', true)
    const plain = new RowIndex(diff, 'split')
    expect(split.length).toBe(plain.length + 2)
  })

  it('adds none to a file that was only added or only deleted', () => {
    const diff = load('github', 'vite-pr-23378-new-files.diff')
    const expandable = new RowIndex(diff, 'unified', true)

    for (let row = 0; row < expandable.length; row += 1) {
      if (expandable.kindAt(row) !== RowKind.Gap) continue
      const file = expandable.fileAt(row)
      expect(file.oldPath).not.toBeNull()
      expect(file.newPath).not.toBeNull()
    }
  })

  it('points every gap row at the file and hunk it belongs to', () => {
    const diff = load('github', 'linux-93e4b307-huge.diff')
    const expandable = new RowIndex(diff, 'unified', true)

    let checked = 0
    for (let row = 0; row < expandable.length; row += 1) {
      const gap = expandable.gapAt(row)
      if (gap === null) continue
      checked += 1
      const hunk = expandable.fileAt(row).hunks[gap.before]!
      expect(expandable.hunkIndexAt(row)).toBe(gap.before)
      expect(gap.newTo).toBe(hunk.newStart - 1)
    }
    expect(checked).toBeGreaterThan(100)
  })
})
