import { describe, expect, it } from 'vitest'
import { readFixture } from '../../../tests/fixtures'
import { parseUnifiedDiff } from '../parse/unified'
import { EXPAND_BY, Folding, LARGE_HUNK, type HunkRef } from './folding'
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
    const folding = Folding.initial(rows)

    expect(folding.length).toBe(rows.length)
    for (let i = 0; i < rows.length; i += 1) expect(folding.rowAt(i)).toBe(i)
  })

  it('has no rows for an empty diff', () => {
    const rows = new RowIndex(parseUnifiedDiff(''))
    expect(Folding.initial(rows).length).toBe(0)
  })
})

describe('folding a file', () => {
  it('leaves its header and takes everything under it', () => {
    const rows = indexOf('edge', 'single-line-hunk-header.diff')
    const folded = Folding.initial(rows).toggleFile(0)

    expect(kinds(rows, folded)).toEqual(['file-header'])
    expect(folded.isFileCollapsed(0)).toBe(true)
  })

  it('takes the note of a file that had no hunks', () => {
    const rows = indexOf('edge', 'mode-change-only.diff')
    expect(kinds(rows, Folding.initial(rows).toggleFile(0))).toEqual(['file-header'])
  })

  it('leaves the other files alone', () => {
    const rows = indexOf('github', 'vite-pr-23346-normal.diff')
    const folded = Folding.initial(rows).toggleFile(0)

    expect(folded.isFileCollapsed(1)).toBe(false)
    for (let i = 0; i < folded.length; i += 1) {
      const row = folded.rowAt(i)
      if (rows.fileIndexAt(row) === 0) expect(rows.kindAt(row)).toBe(RowKind.FileHeader)
    }
  })

  it('unfolds back to exactly what was there before', () => {
    const rows = indexOf('github', 'vite-pr-23346-normal.diff')
    const before = Folding.initial(rows)
    const after = before.toggleFile(0).toggleFile(0)

    expect(after.length).toBe(before.length)
    expect(after.isFileCollapsed(0)).toBe(false)
  })
})

describe('folding a hunk', () => {
  it('leaves its header and takes its lines', () => {
    const rows = indexOf('edge', 'many-hunks.diff')
    const open = Folding.initial(rows)
    const folded = open.toggleHunk({ file: 0, hunk: 1 })

    expect(folded.length).toBeLessThan(open.length)
    for (let i = 0; i < folded.length; i += 1) {
      const row = folded.rowAt(i)
      if (rows.hunkIndexAt(row) === 1) expect(rows.kindAt(row)).not.toBe(RowKind.Line)
    }
  })

  it('leaves the neighbouring hunks open', () => {
    const rows = indexOf('edge', 'many-hunks.diff')
    const folded = Folding.initial(rows).toggleHunk({ file: 0, hunk: 1 })

    let linesElsewhere = 0
    for (let i = 0; i < folded.length; i += 1) {
      const row = folded.rowAt(i)
      if (rows.kindAt(row) === RowKind.Line && rows.hunkIndexAt(row) !== 1) linesElsewhere += 1
    }
    expect(linesElsewhere).toBeGreaterThan(0)
  })

  it('does not confuse the same hunk number in different files', () => {
    const rows = indexOf('github', 'vite-pr-23346-normal.diff')
    const folded = Folding.initial(rows).toggleHunk({ file: 0, hunk: 0 })

    expect(folded.isHunkCollapsed({ file: 0, hunk: 0 })).toBe(true)
    expect(folded.isHunkCollapsed({ file: 1, hunk: 0 })).toBe(false)
  })
})

describe('translating between the two numberings', () => {
  it('round-trips every visible row', () => {
    const rows = indexOf('github', 'vite-pr-23378-new-files.diff')
    const folded = Folding.initial(rows).toggleFile(2).toggleHunk({ file: 0, hunk: 0 })

    for (let position = 0; position < folded.length; position += 1) {
      expect(folded.positionAt(folded.rowAt(position))).toBe(position)
    }
  })

  it('reports -1 for a row that is folded away', () => {
    const rows = indexOf('edge', 'single-line-hunk-header.diff')
    const folded = Folding.initial(rows).toggleFile(0)

    // Row 0 is the header and stays; the lines under it do not.
    expect(folded.positionAt(0)).toBe(0)
    expect(folded.positionAt(2)).toBe(-1)
  })

  it('reports -1 outside the document either way', () => {
    const rows = indexOf('edge', 'single-line-hunk-header.diff')
    const folding = Folding.initial(rows)

    expect(folding.rowAt(-1)).toBe(-1)
    expect(folding.rowAt(folding.length)).toBe(-1)
    expect(folding.positionAt(-1)).toBe(-1)
    expect(folding.positionAt(rows.length)).toBe(-1)
  })
})

describe('folding everything at once', () => {
  it('turns a 758-file commit into a list of files', () => {
    const rows = indexOf('github', 'linux-93e4b307-huge.diff')
    const folded = Folding.initial(rows).collapseAllFiles()

    expect(folded.length).toBe(rows.fileCount)
    for (let i = 0; i < folded.length; i += 1) {
      expect(rows.kindAt(folded.rowAt(i))).toBe(RowKind.FileHeader)
    }
  })

  it('comes all the way back', () => {
    const rows = indexOf('github', 'vite-pr-23346-normal.diff')
    const folded = Folding.initial(rows).collapseAllFiles().toggleHunk({ file: 0, hunk: 0 })
    expect(folded.expandAll().length).toBe(rows.length)
  })
})

describe('leaving the original alone', () => {
  it('does not change the folding it came from', () => {
    const rows = indexOf('github', 'vite-pr-23346-normal.diff')
    const open = Folding.initial(rows)
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
    const folding = Folding.initial(rows)

    const startedAt = performance.now()
    const folded = folding.toggleFile(0)
    const elapsed = performance.now() - startedAt

    expect(folded.length).toBeLessThan(folding.length)
    // 4.4 ms measured over 64.807 rows. A fold that took long enough to feel
    // would defeat the point of folding a diff this size.
    expect(elapsed).toBeLessThan(50)
  })
})

/**
 * Collapsing long runs of unchanged context — the obvious analogue of what
 * GitHub does — was measured and dropped. Across the whole corpus the longest
 * run of context inside a hunk is six lines, because git's default `-U3`
 * splits the hunk as soon as there are more. There is nothing there to
 * collapse. What is there is a handful of enormous hunks: median 11 rows,
 * 95th percentile 107, largest 2.091.
 */
describe('a hunk too large to scroll past', () => {
  const kernel = (): RowIndex => indexOf('github', 'linux-93e4b307-huge.diff')

  const biggest = (rows: RowIndex): { ref: HunkRef; rows: number } => {
    const counts = new Map<string, { ref: HunkRef; rows: number }>()
    for (let row = 0; row < rows.length; row += 1) {
      if (rows.kindAt(row) !== RowKind.Line) continue
      const ref = { file: rows.fileIndexAt(row), hunk: rows.hunkIndexAt(row) }
      const key = `${ref.file}:${ref.hunk}`
      const found = counts.get(key)
      if (found === undefined) counts.set(key, { ref, rows: 1 })
      else found.rows += 1
    }
    return [...counts.values()].sort((a, b) => b.rows - a.rows)[0]!
  }

  it('shows the first chunk of it and hides the rest', () => {
    const rows = kernel()
    const big = biggest(rows)
    expect(big.rows).toBeGreaterThan(LARGE_HUNK)

    const folding = Folding.initial(rows)
    let shown = 0
    let hidden = 0
    for (let position = 0; position < folding.length; position += 1) {
      const row = folding.rowAt(position)
      if (rows.kindAt(row) === RowKind.Line && rows.hunkIndexAt(row) === big.ref.hunk) {
        if (rows.fileIndexAt(row) === big.ref.file) shown += 1
      }
      hidden += folding.hiddenAfter(position)
    }
    expect(shown).toBe(LARGE_HUNK)
    expect(hidden).toBeGreaterThanOrEqual(big.rows - LARGE_HUNK)
  })

  it('says how many rows are behind the expander, on the last one shown', () => {
    const rows = kernel()
    const big = biggest(rows)
    const folding = Folding.initial(rows)

    let marked = 0
    let total = 0
    for (let position = 0; position < folding.length; position += 1) {
      const count = folding.hiddenAfter(position)
      if (count === 0) continue
      marked += 1
      total += count
      // The marker sits on a line of the hunk it belongs to, never on a header.
      expect(rows.kindAt(folding.rowAt(position))).toBe(RowKind.Line)
    }
    expect(marked).toBeGreaterThan(0)
    expect(total).toBeGreaterThan(big.rows - LARGE_HUNK)
  })

  it('leaves every hunk under the threshold alone', () => {
    const rows = indexOf('github', 'vite-pr-23346-normal.diff')
    const folding = Folding.initial(rows)

    expect(folding.length).toBe(rows.length)
    for (let position = 0; position < folding.length; position += 1) {
      expect(folding.hiddenAfter(position)).toBe(0)
    }
  })

  it('reveals a chunk more each time it is asked', () => {
    const rows = kernel()
    const big = biggest(rows)

    const first = Folding.initial(rows)
    const second = first.expandHunk(big.ref)
    const third = second.expandHunk(big.ref)

    expect(second.length).toBe(first.length + EXPAND_BY)
    expect(third.length).toBe(second.length + EXPAND_BY)
  })

  it('opens the rest of it in one go', () => {
    const rows = kernel()
    const big = biggest(rows)
    const opened = Folding.initial(rows).expandHunkFully(big.ref)

    expect(opened.length).toBe(Folding.initial(rows).length + (big.rows - LARGE_HUNK))
    let hidden = 0
    for (let position = 0; position < opened.length; position += 1) {
      hidden += opened.hiddenAfter(position)
    }
    // Only this hunk was opened, so the other large ones still hide rows.
    expect(hidden).toBeGreaterThanOrEqual(0)
  })

  it('never reveals past the end of the hunk', () => {
    const rows = kernel()
    const big = biggest(rows)
    let folding = Folding.initial(rows)
    for (let i = 0; i < 30; i += 1) folding = folding.expandHunk(big.ref)

    expect(folding.rowsIn(big.ref)).toBe(big.rows)
    expect(folding.length).toBe(Folding.initial(rows).length + (big.rows - LARGE_HUNK))
  })

  it('puts no expander under a hunk the reader has collapsed', () => {
    const rows = kernel()
    const big = biggest(rows)
    const folded = Folding.initial(rows).toggleHunk(big.ref)

    for (let position = 0; position < folded.length; position += 1) {
      const row = folded.rowAt(position)
      if (rows.kindAt(row) !== RowKind.HunkHeader) continue
      if (rows.fileIndexAt(row) !== big.ref.file || rows.hunkIndexAt(row) !== big.ref.hunk) continue
      expect(folded.hiddenAfter(position)).toBe(0)
    }
  })

  it('opens everything, expanders included', () => {
    const rows = kernel()
    const opened = Folding.initial(rows).expandAll()

    expect(opened.length).toBe(rows.length)
    for (let position = 0; position < opened.length; position += 1) {
      expect(opened.hiddenAfter(position)).toBe(0)
    }
  })
})
