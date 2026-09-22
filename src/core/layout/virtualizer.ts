import { HeightTree } from './heightTree'

export interface VisibleWindow {
  /** First row to render, overscan included. */
  readonly first: number
  /** Last row to render, inclusive. */
  readonly last: number
  /** Where `first` begins, so the rendered block can be placed without a spacer per row. */
  readonly offsetTop: number
  readonly totalHeight: number
}

const EMPTY_WINDOW: VisibleWindow = { first: 0, last: -1, offsetTop: 0, totalHeight: 0 }

/**
 * Decides which rows exist on screen, and keeps the view still while it finds
 * out it was wrong about their heights.
 *
 * The first part is the easy half: ask the height tree which rows a scroll
 * position covers and render those. The second part is what separates a viewer
 * that works from one that cannot be read.
 *
 * Heights start as estimates, because a row's height is not knowable until it
 * is in the document — a long line wraps, and how many times depends on the
 * width. So rows are measured as they appear, and every correction moves
 * everything below it. When the corrected row is *above* the viewport, the
 * content the reader is looking at slides out from under them. Scrolling then
 * feels like the page is fighting back, which is the failure mode people
 * describe as "it jumps around".
 *
 * The fix is to notice the shift and cancel it: the deltas of rows above the
 * anchor are accumulated, and the caller adds that to the scroll position in
 * the same frame. The reader sees nothing happen, which is the point.
 */
export class Virtualizer {
  private readonly tree: HeightTree
  private readonly overscanPx: number

  private scrollTop = 0
  private viewportHeight = 0
  /** First visible row, ignoring overscan. Corrections are measured against it. */
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

  /** The row the view is anchored to — the first one actually on screen. */
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

  /**
   * The rows to render: everything the viewport covers, plus a margin above and
   * below so a scroll of a few pixels does not force a new render.
   */
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
   * Record what a row actually measured.
   *
   * Only rows above the anchor contribute a correction. A row below it can
   * change height freely: everything above the reader's eyes stays where it
   * was, so nothing visible moves. The anchor's own height is excluded for the
   * same reason — it starts where it started.
   */
  measure(row: number, height: number): void {
    const delta = this.tree.setHeight(row, height)
    if (delta !== 0 && row < this.anchorRow) this.pendingCorrection += delta
  }

  /**
   * How far the scroll position has to move to leave the view where it was, and
   * forget it. Returns zero when nothing shifted, which is the common case and
   * lets the caller skip touching the scroll position at all.
   */
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
