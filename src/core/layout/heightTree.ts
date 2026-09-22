/**
 * A Fenwick tree over row heights.
 *
 * Where a row starts, which row covers a pixel, and what a re-measure shifts:
 * all three in O(log n) instead of the O(n) a plain array of heights would
 * cost, on operations the virtualizer repeats on every frame. Typed arrays
 * throughout — 1.6 MB at 100.000 rows, against tens of megabytes as objects.
 */
export class HeightTree {
  private readonly heights: Float64Array
  /** 1-based. `tree[i]` totals the `i & -i` rows ending at `i`. */
  private readonly tree: Float64Array
  private readonly count: number
  /** Largest power of two that fits, where the descent in `indexAt` starts. */
  private readonly highestBit: number
  private total: number

  constructor(count: number, estimatedHeight: number) {
    if (!Number.isInteger(count) || count < 0) {
      throw new RangeError(`row count must be a non-negative integer, got ${count}`)
    }
    if (!Number.isFinite(estimatedHeight) || estimatedHeight < 0) {
      throw new RangeError(`estimated height must be finite and non-negative`)
    }

    this.count = count
    this.heights = new Float64Array(count).fill(estimatedHeight)
    this.tree = new Float64Array(count + 1)
    this.total = estimatedHeight * count

    // Each entry folds into its parent, which builds the tree in O(n) rather
    // than the O(n log n) of inserting the rows one at a time.
    for (let i = 1; i <= count; i += 1) {
      this.tree[i] = this.tree[i]! + estimatedHeight
      const parent = i + (i & -i)
      if (parent <= count) this.tree[parent] = this.tree[parent]! + this.tree[i]!
    }

    let bit = 1
    while (bit * 2 <= count) bit *= 2
    this.highestBit = bit
  }

  /** Seed each row separately. Row kinds are known before anything is measured,
   *  and using them keeps the scrollbar from creeping as real heights arrive. */
  static fromHeights(heights: ArrayLike<number>): HeightTree {
    const tree = new HeightTree(heights.length, 0)
    let total = 0

    for (let i = 0; i < heights.length; i += 1) {
      const height = heights[i]!
      if (!Number.isFinite(height) || height < 0) {
        throw new RangeError(`height at ${i} must be finite and non-negative, got ${height}`)
      }
      tree.heights[i] = height
      total += height
    }

    for (let i = 1; i <= heights.length; i += 1) {
      tree.tree[i] = tree.tree[i]! + tree.heights[i - 1]!
      const parent = i + (i & -i)
      if (parent <= heights.length) tree.tree[parent] = tree.tree[parent]! + tree.tree[i]!
    }

    tree.total = total
    return tree
  }

  get length(): number {
    return this.count
  }

  /** Sum of every row height. O(1). */
  get totalHeight(): number {
    return this.total
  }

  heightOf(index: number): number {
    this.assertIndex(index)
    return this.heights[index]!
  }

  /** Where row `index` starts. O(log n). */
  offsetOf(index: number): number {
    if (index === this.count) return this.total
    this.assertIndex(index)

    let sum = 0
    for (let i = index; i > 0; i -= i & -i) sum += this.tree[i]!
    return sum
  }

  /** Replace a row's height and return the delta — the caller needs it to cancel
   *  the shift it causes, and recovering it later costs another traversal. */
  setHeight(index: number, height: number): number {
    this.assertIndex(index)
    if (!Number.isFinite(height) || height < 0) {
      throw new RangeError(`height must be finite and non-negative, got ${height}`)
    }

    const delta = height - this.heights[index]!
    if (delta === 0) return 0

    this.heights[index] = height
    this.total += delta
    for (let i = index + 1; i <= this.count; i += i & -i) {
      this.tree[i] = this.tree[i]! + delta
    }
    return delta
  }

  /** The row covering pixel `offset`. Offsets outside the document clamp: a
   *  scroll position can sit past the end while heights are still settling. */
  indexAt(offset: number): number {
    if (this.count === 0) return -1
    if (!(offset > 0)) return 0
    if (offset >= this.total) return this.count - 1

    let position = 0
    let remaining = offset
    for (let step = this.highestBit; step > 0; step >>= 1) {
      const next = position + step
      if (next <= this.count && this.tree[next]! <= remaining) {
        position = next
        remaining -= this.tree[position]!
      }
    }
    return position
  }

  /** Every row between `top` and `bottom`, inclusive. Null if empty. */
  rangeAt(top: number, bottom: number): { first: number; last: number } | null {
    if (this.count === 0) return null
    if (bottom < top) return this.rangeAt(bottom, top)
    return { first: this.indexAt(top), last: this.indexAt(bottom) }
  }

  private assertIndex(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.count) {
      throw new RangeError(`row index ${index} is outside 0..${this.count - 1}`)
    }
  }
}
