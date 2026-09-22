/**
 * A Fenwick tree over row heights.
 *
 * The virtualizer needs three questions answered constantly while scrolling:
 * where does row `i` start, which row covers pixel `y`, and what happens to
 * everything below when row `i` turns out to be taller than estimated. Done
 * naively each of those walks the whole document, so a single re-measure at
 * 100.000 rows costs 100.000 additions — and re-measures happen continuously as
 * rows scroll into view.
 *
 * A Fenwick tree answers all three in O(log n) — seventeen steps at 100.000
 * rows instead of a hundred thousand — from a single array of partial sums,
 * where `tree[i]` holds the total of a block of rows ending at `i` whose length
 * is the lowest set bit of `i`.
 *
 * Heights live in a plain array beside it so reading one costs nothing, and
 * both are typed arrays: at 100.000 rows they are 1.6 MB between them, against
 * the roughly 50 MB the same information would cost as objects.
 */
export class HeightTree {
  /** Height of each row, for O(1) reads. The tree holds their partial sums. */
  private readonly heights: Float64Array
  /** 1-based. `tree[i]` totals the rows ending at `i` over `i & -i` entries. */
  private readonly tree: Float64Array
  private readonly count: number
  /** The largest power of two that fits, for the descent in `indexAt`. */
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

    // Building in one pass instead of `count` insertions: each entry adds itself
    // into its parent, so the whole tree is filled in O(n) rather than O(n log n).
    // At 100.000 rows that is the difference between a build worth measuring and
    // one that disappears into the noise.
    for (let i = 1; i <= count; i += 1) {
      this.tree[i] = this.tree[i]! + estimatedHeight
      const parent = i + (i & -i)
      if (parent <= count) this.tree[parent] = this.tree[parent]! + this.tree[i]!
    }

    let bit = 1
    while (bit * 2 <= count) bit *= 2
    this.highestBit = bit
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

  /** The pixel where row `index` starts — the sum of everything above it. O(log n). */
  offsetOf(index: number): number {
    if (index === this.count) return this.total
    this.assertIndex(index)

    let sum = 0
    for (let i = index; i > 0; i -= i & -i) sum += this.tree[i]!
    return sum
  }

  /**
   * Replace a row's height and return how much the document grew or shrank.
   *
   * The delta is the point of the return value: when a row above the viewport is
   * re-measured, everything below it moves by exactly this much, and the
   * virtualizer has to add it to the scroll position or the view jumps under the
   * reader. Recomputing that shift by comparing offsets before and after would
   * cost a second traversal for a number this already knows.
   */
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

  /**
   * The row covering pixel `offset`. O(log n).
   *
   * Descends the tree by powers of two rather than searching it — at each step
   * either the whole block fits above `offset`, and it is skipped in one move, or
   * it does not and the step halves. Offsets outside the document clamp to the
   * first or last row, because a scroll position can legitimately be past the end
   * for a moment while heights are still settling.
   */
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

  /**
   * Every row touching the pixels between `top` and `bottom`, inclusive.
   * Returns `null` when the document is empty.
   */
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
