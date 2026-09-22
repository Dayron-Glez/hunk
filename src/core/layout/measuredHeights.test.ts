import { describe, expect, it } from 'vitest'
import { readFixture } from '../../../tests/fixtures'
import { parseUnifiedDiff } from '../parse/unified'
import { Folding } from './folding'
import { MeasuredHeights } from './measuredHeights'
import { RowIndex, RowKind, type RowKind as Kind } from './rowIndex'

const ESTIMATES: Record<Kind, number> = {
  [RowKind.FileHeader]: 37,
  [RowKind.Note]: 52,
  [RowKind.HunkHeader]: 24,
  [RowKind.Line]: 20,
  [RowKind.Gap]: 29,
}

const load = (name: string): RowIndex => new RowIndex(parseUnifiedDiff(readFixture('github', name)))

describe('before anything is measured', () => {
  it('gives each row the estimate for its kind', () => {
    const rows = load('vite-pr-23346-normal.diff')
    const heights = new MeasuredHeights(rows, ESTIMATES)

    for (let row = 0; row < rows.length; row += 1) {
      expect(heights.heightOf(row)).toBe(ESTIMATES[rows.kindAt(row)])
    }
  })
})

describe('recording what a row measured', () => {
  it('keeps it, and leaves its neighbours alone', () => {
    const rows = load('vite-pr-23346-normal.diff')
    const heights = new MeasuredHeights(rows, ESTIMATES)

    heights.record(4, 41.5)
    expect(heights.heightOf(4)).toBe(41.5)
    expect(heights.heightOf(5)).toBe(ESTIMATES[rows.kindAt(5)])
  })

  it('ignores a row outside the document rather than throwing', () => {
    const heights = new MeasuredHeights(load('vite-pr-23346-normal.diff'), ESTIMATES)
    expect(() => {
      heights.record(-1, 20)
      heights.record(9_999_999, 20)
    }).not.toThrow()
  })

  it('ignores a height the layout could not produce', () => {
    const rows = load('vite-pr-23346-normal.diff')
    const heights = new MeasuredHeights(rows, ESTIMATES)
    const before = heights.heightOf(3)

    heights.record(3, Number.NaN)
    heights.record(3, -5)
    expect(heights.heightOf(3)).toBe(before)
  })
})

/**
 * The reason this class exists. Folding rebuilds the height tree, and without
 * somewhere to keep them the rebuild would seed it with estimates — so the
 * scrollbar would change length on every click.
 */
describe('seeding a tree for the rows still visible', () => {
  it('hands back one height per visible row, in order', () => {
    const rows = load('vite-pr-23346-normal.diff')
    const heights = new MeasuredHeights(rows, ESTIMATES)
    const folding = Folding.initial(rows).toggleFile(0)

    const seeded = heights.seed(folding)
    expect(seeded).toHaveLength(folding.length)
    for (let position = 0; position < folding.length; position += 1) {
      expect(seeded[position]).toBe(heights.heightOf(folding.rowAt(position)))
    }
  })

  it('carries a measurement across a fold and back', () => {
    const rows = load('vite-pr-23346-normal.diff')
    const heights = new MeasuredHeights(rows, ESTIMATES)
    const open = Folding.initial(rows)

    // A wrapped line measures taller than the estimate for its kind.
    const row = open.rowAt(open.length - 1)
    heights.record(row, 60)

    const folded = open.toggleFile(0)
    const reopened = folded.toggleFile(0)
    const seeded = heights.seed(reopened)

    expect(seeded[reopened.positionAt(row)]).toBe(60)
  })

  it('seeds nothing for a diff with no rows', () => {
    const rows = new RowIndex(parseUnifiedDiff(''))
    expect(new MeasuredHeights(rows, ESTIMATES).seed(Folding.initial(rows))).toHaveLength(0)
  })
})
