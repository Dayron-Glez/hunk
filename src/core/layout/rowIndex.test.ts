import { describe, expect, it } from 'vitest'
import { readFixture } from '../../../tests/fixtures'
import { parseUnifiedDiff } from '../parse/unified'
import { RowIndex, type RowKind } from './rowIndex'

const NAMES: Record<RowKind, string> = {
  0: 'file-header',
  1: 'note',
  2: 'hunk-header',
  3: 'line',
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
})
