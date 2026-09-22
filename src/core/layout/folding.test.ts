import { describe, expect, it } from 'vitest'
import { readFixture } from '../../../tests/fixtures'
import { parseUnifiedDiff } from '../parse/unified'
import { Folding } from './folding'
import { RowIndex, RowKind } from './rowIndex'

const indexOf = (set: 'github' | 'edge', name: string): RowIndex =>
  new RowIndex(parseUnifiedDiff(readFixture(set, name)))

const kinds = (rows: RowIndex, folding: Folding): string[] => {
  const names = ['file-header', 'note', 'hunk-header', 'line']
  return Array.from({ length: folding.length }, (_, i) => names[rows.kindAt(folding.rowAt(i))]!)
}

describe('nothing folded', () => {
  it('shows every row of the index, in order', () => {
    const rows = indexOf('edge', 'many-hunks.diff')
    const folding = Folding.all(rows)

    expect(folding.length).toBe(rows.length)
    for (let i = 0; i < rows.length; i += 1) expect(folding.rowAt(i)).toBe(i)
  })

  it('has no rows for an empty diff', () => {
    const rows = new RowIndex(parseUnifiedDiff(''))
    expect(Folding.all(rows).length).toBe(0)
  })
})

describe('folding a file', () => {
  it('leaves its header and takes everything under it', () => {
    const rows = indexOf('edge', 'single-line-hunk-header.diff')
    const folded = Folding.all(rows).toggleFile(0)

    expect(kinds(rows, folded)).toEqual(['file-header'])
    expect(folded.isFileCollapsed(0)).toBe(true)
  })

  it('takes the note of a file that had no hunks', () => {
    const rows = indexOf('edge', 'mode-change-only.diff')
    expect(kinds(rows, Folding.all(rows).toggleFile(0))).toEqual(['file-header'])
  })

  it('leaves the other files alone', () => {
    const rows = indexOf('github', 'vite-pr-23346-normal.diff')
    const folded = Folding.all(rows).toggleFile(0)

    expect(folded.isFileCollapsed(1)).toBe(false)
    for (let i = 0; i < folded.length; i += 1) {
      const row = folded.rowAt(i)
      if (rows.fileIndexAt(row) === 0) expect(rows.kindAt(row)).toBe(RowKind.FileHeader)
    }
  })

  it('unfolds back to exactly what was there before', () => {
    const rows = indexOf('github', 'vite-pr-23346-normal.diff')
    const before = Folding.all(rows)
    const after = before.toggleFile(0).toggleFile(0)

    expect(after.length).toBe(before.length)
    expect(after.isFileCollapsed(0)).toBe(false)
  })
})

describe('folding a hunk', () => {
  it('leaves its header and takes its lines', () => {
    const rows = indexOf('edge', 'many-hunks.diff')
    const open = Folding.all(rows)
    const folded = open.toggleHunk({ file: 0, hunk: 1 })

    expect(folded.length).toBeLessThan(open.length)
    for (let i = 0; i < folded.length; i += 1) {
      const row = folded.rowAt(i)
      if (rows.hunkIndexAt(row) === 1) expect(rows.kindAt(row)).not.toBe(RowKind.Line)
    }
  })

  it('leaves the neighbouring hunks open', () => {
    const rows = indexOf('edge', 'many-hunks.diff')
    const folded = Folding.all(rows).toggleHunk({ file: 0, hunk: 1 })

    let linesElsewhere = 0
    for (let i = 0; i < folded.length; i += 1) {
      const row = folded.rowAt(i)
      if (rows.kindAt(row) === RowKind.Line && rows.hunkIndexAt(row) !== 1) linesElsewhere += 1
    }
    expect(linesElsewhere).toBeGreaterThan(0)
  })

  it('does not confuse the same hunk number in different files', () => {
    const rows = indexOf('github', 'vite-pr-23346-normal.diff')
    const folded = Folding.all(rows).toggleHunk({ file: 0, hunk: 0 })

    expect(folded.isHunkCollapsed({ file: 0, hunk: 0 })).toBe(true)
    expect(folded.isHunkCollapsed({ file: 1, hunk: 0 })).toBe(false)
  })
})

describe('translating between the two numberings', () => {
  it('round-trips every visible row', () => {
    const rows = indexOf('github', 'vite-pr-23378-new-files.diff')
    const folded = Folding.all(rows).toggleFile(2).toggleHunk({ file: 0, hunk: 0 })

    for (let position = 0; position < folded.length; position += 1) {
      expect(folded.positionAt(folded.rowAt(position))).toBe(position)
    }
  })

  it('reports -1 for a row that is folded away', () => {
    const rows = indexOf('edge', 'single-line-hunk-header.diff')
    const folded = Folding.all(rows).toggleFile(0)

    // Row 0 is the header and stays; the lines under it do not.
    expect(folded.positionAt(0)).toBe(0)
    expect(folded.positionAt(2)).toBe(-1)
  })

  it('reports -1 outside the document either way', () => {
    const rows = indexOf('edge', 'single-line-hunk-header.diff')
    const folding = Folding.all(rows)

    expect(folding.rowAt(-1)).toBe(-1)
    expect(folding.rowAt(folding.length)).toBe(-1)
    expect(folding.positionAt(-1)).toBe(-1)
    expect(folding.positionAt(rows.length)).toBe(-1)
  })
})

describe('folding everything at once', () => {
  it('turns a 758-file commit into a list of files', () => {
    const rows = indexOf('github', 'linux-93e4b307-huge.diff')
    const folded = Folding.all(rows).collapseAllFiles()

    expect(folded.length).toBe(rows.fileCount)
    for (let i = 0; i < folded.length; i += 1) {
      expect(rows.kindAt(folded.rowAt(i))).toBe(RowKind.FileHeader)
    }
  })

  it('comes all the way back', () => {
    const rows = indexOf('github', 'vite-pr-23346-normal.diff')
    const folded = Folding.all(rows).collapseAllFiles().toggleHunk({ file: 0, hunk: 0 })
    expect(folded.expandAll().length).toBe(rows.length)
  })
})

describe('leaving the original alone', () => {
  it('does not change the folding it came from', () => {
    const rows = indexOf('github', 'vite-pr-23346-normal.diff')
    const open = Folding.all(rows)
    const before = open.length

    open.toggleFile(0)
    open.collapseAllFiles()

    expect(open.length).toBe(before)
    expect(open.isFileCollapsed(0)).toBe(false)
  })
})

describe('at scale', () => {
  it('projects the kernel commit fast enough for a click', () => {
    const rows = indexOf('github', 'linux-93e4b307-huge.diff')
    const folding = Folding.all(rows)

    const startedAt = performance.now()
    const folded = folding.toggleFile(0)
    const elapsed = performance.now() - startedAt

    expect(folded.length).toBeLessThan(folding.length)
    // 4.4 ms measured over 64.807 rows. A fold that took long enough to feel
    // would defeat the point of folding a diff this size.
    expect(elapsed).toBeLessThan(50)
  })
})
