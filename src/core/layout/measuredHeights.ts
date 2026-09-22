import type { Folding } from './folding'
import type { RowIndex, RowKind } from './rowIndex'

/**
 * How tall each row turned out to be, kept by row of the full index.
 *
 * Folding rebuilds the height tree, because that tree is indexed by position
 * among the visible rows and folding changes which those are. Without
 * somewhere else to keep them, every fold would throw away every measurement
 * and seed the new tree with estimates — and a scrollbar that resets its
 * length on each click is worse than no folding.
 *
 * Deliberately not React state. A height changes whenever a row reaches the
 * screen, which is far too often to re-render for, and nothing on screen
 * depends on it except through the tree this seeds.
 */
export class MeasuredHeights {
  private readonly heights: Float64Array

  constructor(rows: RowIndex, estimates: Record<RowKind, number>) {
    this.heights = new Float64Array(rows.length)
    for (let row = 0; row < rows.length; row += 1) this.heights[row] = estimates[rows.kindAt(row)]
  }

  /** What a row measured, or the estimate it still carries. */
  heightOf(row: number): number {
    return this.heights[row] ?? 0
  }

  record(row: number, height: number): void {
    if (row < 0 || row >= this.heights.length) return
    if (!Number.isFinite(height) || height < 0) return
    this.heights[row] = height
  }

  /** Heights of the visible rows, in their order, to build a tree from. */
  seed(folding: Folding): Float64Array {
    const seeded = new Float64Array(folding.length)
    for (let position = 0; position < folding.length; position += 1) {
      seeded[position] = this.heights[folding.rowAt(position)] ?? 0
    }
    return seeded
  }
}
