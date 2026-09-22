import { HeightTree } from './heightTree'

/** The rows to render. `first` and `last` include the overscan, and `last` is
 *  inclusive; `offsetTop` places the whole block with one transform. */
export interface VisibleWindow {
  readonly first: number
  readonly last: number
  readonly offsetTop: number
  readonly totalHeight: number
}

const EMPTY_WINDOW: VisibleWindow = { first: 0, last: -1, offsetTop: 0, totalHeight: 0 }

/**
 * Decides which rows exist on screen, and keeps the view still while it finds
 * out it was wrong about their heights.
 *
 * A row's height is not knowable until it is in the document, so rows are
 * measured as they appear and every correction moves everything below it. When
 * the corrected row is above the viewport, the content the reader is looking at
 * slides out from under them — the failure people describe as "it jumps
 * around". Deltas above the anchor are accumulated so the caller can cancel
 * that shift in the same frame.
 */
export class Virtualizer {
  private readonly tree: HeightTree
  private readonly overscanPx: number

  private scrollTop = 0
  private viewportHeight = 0
  /** First visible row, ignoring overscan. Corrections are measured from it. */
  private anchorRow = 0
  private pendingCorrection = 0

  constructor(initialHeights: ArrayLike<number>, overscanPx = 600) {
    if (!Number.isFinite(overscanPx) || overscanPx < 0) {
      throw new RangeError(`overscan must be finite and non-negative, got ${overscanPx}`)
    }
    this.tree = HeightTree.fromHeights(initialHeights)
    this.overscanPx = overscanPx
  }

  get rowCount(): number {
    return this.tree.length
  }

  get totalHeight(): number {
    return this.tree.totalHeight
  }

  get anchor(): number {
    return this.anchorRow
  }

  offsetOf(row: number): number {
    return this.tree.offsetOf(row)
  }

  heightOf(row: number): number {
    return this.tree.heightOf(row)
  }

  setViewport(scrollTop: number, viewportHeight: number): void {
    if (!Number.isFinite(scrollTop) || !Number.isFinite(viewportHeight)) {
      throw new RangeError('viewport must be described in finite numbers')
    }
    this.scrollTop = Math.max(0, scrollTop)
    this.viewportHeight = Math.max(0, viewportHeight)
    this.anchorRow = this.tree.length === 0 ? 0 : this.tree.indexAt(this.scrollTop)
  }

  /** Everything the viewport covers, plus the overscan margin either side. */
  get visible(): VisibleWindow {
    if (this.tree.length === 0) return EMPTY_WINDOW

    const top = this.scrollTop - this.overscanPx
    const bottom = this.scrollTop + this.viewportHeight + this.overscanPx
    const range = this.tree.rangeAt(top, bottom)
    if (range === null) return EMPTY_WINDOW

    return {
      first: range.first,
      last: range.last,
      offsetTop: this.tree.offsetOf(range.first),
      totalHeight: this.tree.totalHeight,
    }
  }

  /**
   * Record what a row measured. Only rows above the anchor contribute a
   * correction: a change below it, or to the anchor itself, moves nothing the
   * reader can see.
   */
  measure(row: number, height: number): void {
    const delta = this.tree.setHeight(row, height)
    if (delta !== 0 && row < this.anchorRow) this.pendingCorrection += delta
  }

  /** How far to move the scroll position to leave the view where it was, and
   *  forget it. Zero — the common case — means the caller can skip it. */
  takeScrollCorrection(): number {
    const correction = this.pendingCorrection
    this.pendingCorrection = 0
    return correction
  }

  /** Where to scroll so a row sits at the top of the viewport. */
  scrollOffsetFor(row: number): number {
    const target = this.tree.offsetOf(row)
    const furthest = Math.max(0, this.tree.totalHeight - this.viewportHeight)
    return Math.min(target, furthest)
  }
}
