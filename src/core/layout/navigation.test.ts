import { describe, expect, it } from 'vitest'
import { readFixture } from '../../../tests/fixtures'
import { parseUnifiedDiff } from '../parse/unified'
import { Folding } from './folding'
import { moveFrom, startingPosition, type Move } from './navigation'
import { RowIndex, RowKind } from './rowIndex'

const load = (set: 'github' | 'edge', name: string) => {
  const rows = new RowIndex(parseUnifiedDiff(readFixture(set, name)))
  return { rows, folding: Folding.initial(rows) }
}

const PAGE = 40

const kindAt = (rows: RowIndex, folding: Folding, position: number): RowKind =>
  rows.kindAt(folding.rowAt(position))

describe('one row at a time', () => {
  it('goes down and back up', () => {
    const { rows, folding } = load('github', 'vite-pr-23346-normal.diff')
    expect(moveFrom(rows, folding, 5, 'next-row', PAGE)).toBe(6)
    expect(moveFrom(rows, folding, 5, 'previous-row', PAGE)).toBe(4)
  })

  it('stops at either end rather than wrapping', () => {
    const { rows, folding } = load('github', 'vite-pr-23346-normal.diff')
    const last = folding.length - 1
    expect(moveFrom(rows, folding, 0, 'previous-row', PAGE)).toBe(0)
    expect(moveFrom(rows, folding, last, 'next-row', PAGE)).toBe(last)
  })
})

describe('a screen at a time', () => {
  it('moves by the rows a screen holds', () => {
    const { rows, folding } = load('github', 'prettier-bb52ae36-rename.diff')
    expect(moveFrom(rows, folding, 10, 'next-page', PAGE)).toBe(50)
    expect(moveFrom(rows, folding, 50, 'previous-page', PAGE)).toBe(10)
  })

  it('clamps at the ends', () => {
    const { rows, folding } = load('github', 'vite-pr-23346-normal.diff')
    expect(moveFrom(rows, folding, 1, 'previous-page', PAGE)).toBe(0)
    expect(moveFrom(rows, folding, folding.length - 2, 'next-page', PAGE)).toBe(folding.length - 1)
  })

  it('still moves when told a screen holds nothing', () => {
    const { rows, folding } = load('github', 'vite-pr-23346-normal.diff')
    expect(moveFrom(rows, folding, 3, 'next-page', 0)).toBe(4)
  })
})

describe('jumping between hunks', () => {
  it('lands on a hunk header, or on the file header that starts one', () => {
    const { rows, folding } = load('edge', 'many-hunks.diff')
    let position = 0
    const landed: RowKind[] = []
    for (let i = 0; i < 3; i += 1) {
      position = moveFrom(rows, folding, position, 'next-hunk', PAGE)
      landed.push(kindAt(rows, folding, position))
    }
    expect(landed.every((kind) => kind === RowKind.HunkHeader)).toBe(true)
  })

  it('goes back the way it came', () => {
    const { rows, folding } = load('edge', 'many-hunks.diff')
    const second = moveFrom(
      rows,
      folding,
      moveFrom(rows, folding, 0, 'next-hunk', PAGE),
      'next-hunk',
      PAGE,
    )
    const back = moveFrom(rows, folding, second, 'previous-hunk', PAGE)
    expect(back).toBeLessThan(second)
    expect(kindAt(rows, folding, back)).toBe(RowKind.HunkHeader)
  })

  it('stops at the last hunk rather than running off the end', () => {
    const { rows, folding } = load('edge', 'many-hunks.diff')
    let position = 0
    for (let i = 0; i < 50; i += 1) position = moveFrom(rows, folding, position, 'next-hunk', PAGE)
    expect(position).toBe(folding.length - 1)
  })

  it('does not stand still on a file header', () => {
    const { rows, folding } = load('github', 'vite-pr-23346-normal.diff')
    expect(kindAt(rows, folding, 0)).toBe(RowKind.FileHeader)
    expect(moveFrom(rows, folding, 0, 'next-hunk', PAGE)).toBeGreaterThan(0)
  })
})

describe('jumping between files', () => {
  it('lands on each file header in turn', () => {
    const { rows, folding } = load('github', 'vite-pr-23378-new-files.diff')
    let position = 0
    const seen = [0]
    for (let i = 0; i < 4; i += 1) {
      position = moveFrom(rows, folding, position, 'next-file', PAGE)
      seen.push(position)
      expect(kindAt(rows, folding, position)).toBe(RowKind.FileHeader)
    }
    expect(new Set(seen).size).toBe(seen.length)
  })

  it('skips the hunks inside a file rather than stopping at them', () => {
    const { rows, folding } = load('github', 'vite-pr-23346-normal.diff')
    const next = moveFrom(rows, folding, 0, 'next-file', PAGE)
    expect(rows.fileIndexAt(folding.rowAt(next))).toBe(1)
  })

  it('comes back to the first file', () => {
    const { rows, folding } = load('github', 'vite-pr-23378-new-files.diff')
    const third = moveFrom(
      rows,
      folding,
      moveFrom(rows, folding, 0, 'next-file', PAGE),
      'next-file',
      PAGE,
    )
    expect(moveFrom(rows, folding, third, 'previous-file', PAGE)).toBeLessThan(third)
  })
})

describe('the ends', () => {
  it('goes to the first and last visible rows', () => {
    const { rows, folding } = load('github', 'vite-pr-23346-normal.diff')
    expect(moveFrom(rows, folding, 20, 'first', PAGE)).toBe(0)
    expect(moveFrom(rows, folding, 2, 'last', PAGE)).toBe(folding.length - 1)
  })

  it('answers 0 for a diff with nothing in it', () => {
    const rows = new RowIndex(parseUnifiedDiff(''))
    const folding = Folding.initial(rows)
    const moves: Move[] = ['next-row', 'previous-row', 'next-hunk', 'next-file', 'first', 'last']
    for (const move of moves) expect(moveFrom(rows, folding, 0, move, PAGE)).toBe(0)
  })

  it('takes a position from outside the document without complaint', () => {
    const { rows, folding } = load('github', 'vite-pr-23346-normal.diff')
    expect(moveFrom(rows, folding, -80, 'next-row', PAGE)).toBe(1)
    expect(moveFrom(rows, folding, 9_999, 'previous-row', PAGE)).toBe(folding.length - 2)
  })
})

/** Folding is what the reader sees, so it is what the keyboard walks. */
describe('moving through a folded diff', () => {
  it('treats a collapsed file as one stop, not the lines inside it', () => {
    const { rows } = load('github', 'vite-pr-23346-normal.diff')
    const folded = Folding.initial(rows).toggleFile(0)

    // From the first file's header, one row down is already the next file.
    const next = moveFrom(rows, folded, 0, 'next-row', PAGE)
    expect(rows.fileIndexAt(folded.rowAt(next))).toBe(1)
  })

  it('never lands anywhere the reader cannot see', () => {
    const { rows } = load('github', 'vite-pr-23378-new-files.diff')
    const folded = Folding.initial(rows).toggleFile(1).toggleHunk({ file: 0, hunk: 0 })
    const moves: Move[] = ['next-row', 'next-hunk', 'next-file', 'next-page', 'last']

    let position = 0
    for (let i = 0; i < 40; i += 1) {
      for (const move of moves) {
        position = moveFrom(rows, folded, position, move, PAGE)
        expect(position).toBeGreaterThanOrEqual(0)
        expect(position).toBeLessThan(folded.length)
        expect(folded.rowAt(position)).not.toBe(-1)
      }
    }
  })
})

describe('picking up where the reader is looking', () => {
  it('keeps the focus when it is still on screen', () => {
    expect(startingPosition(120, 100, 150)).toBe(120)
  })

  it('starts from the top of the window when the focus scrolled away', () => {
    expect(startingPosition(12, 100, 150)).toBe(100)
    expect(startingPosition(900, 100, 150)).toBe(100)
  })

  it('starts from the top when nothing is focused yet', () => {
    expect(startingPosition(null, 100, 150)).toBe(100)
  })
})
