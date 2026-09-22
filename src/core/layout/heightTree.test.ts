import { describe, expect, it } from 'vitest'
import { HeightTree } from './heightTree'

/**
 * The obvious implementation, kept deliberately slow and stupid.
 *
 * A Fenwick tree is the kind of code that looks right, passes the cases anyone
 * thinks to write, and is wrong on the seventh row of a document with an odd
 * length. Most of the value below comes from running both against the same
 * random operations and demanding they agree, so the clever version is checked
 * against something too simple to be subtly wrong.
 */
class NaiveHeights {
  readonly heights: number[]

  constructor(count: number, estimate: number) {
    this.heights = Array.from({ length: count }, () => estimate)
  }

  get totalHeight(): number {
    return this.heights.reduce((total, height) => total + height, 0)
  }

  offsetOf(index: number): number {
    let sum = 0
    for (let i = 0; i < index; i += 1) sum += this.heights[i]!
    return sum
  }

  setHeight(index: number, height: number): number {
    const delta = height - this.heights[index]!
    this.heights[index] = height
    return delta
  }

  indexAt(offset: number): number {
    if (this.heights.length === 0) return -1
    if (!(offset > 0)) return 0
    if (offset >= this.totalHeight) return this.heights.length - 1

    let accumulated = 0
    for (let i = 0; i < this.heights.length; i += 1) {
      const height = this.heights[i]!
      if (offset < accumulated + height) return i
      accumulated += height
    }
    return this.heights.length - 1
  }
}

/** Mulberry32 — the same generator the fixture builder uses, so runs repeat. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('construction', () => {
  it('starts every row at the estimate', () => {
    const tree = new HeightTree(5, 20)
    expect(tree.length).toBe(5)
    expect(tree.totalHeight).toBe(100)
    expect(tree.heightOf(0)).toBe(20)
    expect(tree.heightOf(4)).toBe(20)
  })

  it('handles an empty document', () => {
    const tree = new HeightTree(0, 20)
    expect(tree.length).toBe(0)
    expect(tree.totalHeight).toBe(0)
    expect(tree.indexAt(0)).toBe(-1)
    expect(tree.rangeAt(0, 100)).toBeNull()
  })

  it('handles a single row', () => {
    const tree = new HeightTree(1, 20)
    expect(tree.offsetOf(0)).toBe(0)
    expect(tree.indexAt(0)).toBe(0)
    expect(tree.indexAt(19)).toBe(0)
    expect(tree.indexAt(1000)).toBe(0)
  })

  it('refuses nonsense', () => {
    expect(() => new HeightTree(-1, 20)).toThrow(RangeError)
    expect(() => new HeightTree(1.5, 20)).toThrow(RangeError)
    expect(() => new HeightTree(5, -1)).toThrow(RangeError)
    expect(() => new HeightTree(5, Number.NaN)).toThrow(RangeError)
  })
})

describe('offsets', () => {
  it('accumulates uniform rows', () => {
    const tree = new HeightTree(10, 20)
    expect(tree.offsetOf(0)).toBe(0)
    expect(tree.offsetOf(1)).toBe(20)
    expect(tree.offsetOf(9)).toBe(180)
  })

  it('treats the index one past the end as the document height', () => {
    const tree = new HeightTree(10, 20)
    expect(tree.offsetOf(10)).toBe(200)
  })

  it('follows a height change', () => {
    const tree = new HeightTree(4, 10)
    tree.setHeight(1, 35)
    expect(tree.offsetOf(0)).toBe(0)
    expect(tree.offsetOf(1)).toBe(10)
    expect(tree.offsetOf(2)).toBe(45)
    expect(tree.offsetOf(3)).toBe(55)
    expect(tree.totalHeight).toBe(65)
  })

  it('rejects an index outside the document', () => {
    const tree = new HeightTree(3, 10)
    expect(() => tree.offsetOf(4)).toThrow(RangeError)
    expect(() => tree.offsetOf(-1)).toThrow(RangeError)
  })
})

describe('setHeight', () => {
  it('returns how far everything below moved', () => {
    const tree = new HeightTree(4, 10)
    expect(tree.setHeight(1, 35)).toBe(25)
    expect(tree.setHeight(1, 5)).toBe(-30)
  })

  it('returns zero and changes nothing when the height is unchanged', () => {
    const tree = new HeightTree(4, 10)
    expect(tree.setHeight(2, 10)).toBe(0)
    expect(tree.totalHeight).toBe(40)
  })

  it('allows a row to collapse to nothing', () => {
    const tree = new HeightTree(3, 10)
    tree.setHeight(1, 0)
    expect(tree.totalHeight).toBe(20)
    expect(tree.offsetOf(2)).toBe(10)
  })

  it('refuses a negative or non-finite height', () => {
    const tree = new HeightTree(3, 10)
    expect(() => tree.setHeight(0, -1)).toThrow(RangeError)
    expect(() => tree.setHeight(0, Number.POSITIVE_INFINITY)).toThrow(RangeError)
  })
})

describe('indexAt', () => {
  it('finds the row covering a pixel', () => {
    const tree = new HeightTree(5, 20)
    expect(tree.indexAt(0)).toBe(0)
    expect(tree.indexAt(19.9)).toBe(0)
    expect(tree.indexAt(20)).toBe(1)
    expect(tree.indexAt(99)).toBe(4)
  })

  it('lands on the row that starts exactly at the boundary', () => {
    const tree = new HeightTree(4, 25)
    expect(tree.indexAt(25)).toBe(1)
    expect(tree.indexAt(50)).toBe(2)
    expect(tree.indexAt(75)).toBe(3)
  })

  it('clamps outside the document instead of failing', () => {
    const tree = new HeightTree(5, 20)
    expect(tree.indexAt(-500)).toBe(0)
    expect(tree.indexAt(100)).toBe(4)
    expect(tree.indexAt(1e9)).toBe(4)
  })

  it('works with wildly uneven rows', () => {
    const tree = new HeightTree(4, 10)
    tree.setHeight(0, 5)
    tree.setHeight(1, 200)
    tree.setHeight(2, 1)
    // rows now start at 0, 5, 205, 206
    expect(tree.indexAt(0)).toBe(0)
    expect(tree.indexAt(4)).toBe(0)
    expect(tree.indexAt(5)).toBe(1)
    expect(tree.indexAt(204)).toBe(1)
    expect(tree.indexAt(205)).toBe(2)
    expect(tree.indexAt(206)).toBe(3)
  })
})

describe('rangeAt', () => {
  it('returns every row the window touches', () => {
    const tree = new HeightTree(10, 20)
    expect(tree.rangeAt(30, 90)).toEqual({ first: 1, last: 4 })
  })

  it('handles a window that is a single pixel', () => {
    const tree = new HeightTree(10, 20)
    expect(tree.rangeAt(45, 45)).toEqual({ first: 2, last: 2 })
  })

  it('accepts a window given backwards', () => {
    const tree = new HeightTree(10, 20)
    expect(tree.rangeAt(90, 30)).toEqual({ first: 1, last: 4 })
  })
})

describe('against the naive implementation', () => {
  // Sizes chosen to straddle the powers of two the descent steps through: a
  // Fenwick bug hides comfortably in a tree whose length is exactly a power of
  // two and shows up one row either side.
  const sizes = [1, 2, 3, 7, 8, 9, 15, 16, 17, 63, 64, 65, 1000]

  it.each(sizes)('agrees on every offset and lookup with %i rows', (size) => {
    const random = createRandom(0x51e5 + size)
    const tree = new HeightTree(size, 18)
    const naive = new NaiveHeights(size, 18)

    for (let round = 0; round < size * 3; round += 1) {
      const index = Math.floor(random() * size)
      // Zero is included deliberately: a collapsed row is a real state, and it
      // is where an off-by-one in the descent surfaces.
      const height = random() < 0.1 ? 0 : Math.round(random() * 400) / 4

      expect(tree.setHeight(index, height)).toBeCloseTo(naive.setHeight(index, height), 9)
      expect(tree.totalHeight).toBeCloseTo(naive.totalHeight, 9)
    }

    for (let index = 0; index < size; index += 1) {
      expect(tree.offsetOf(index)).toBeCloseTo(naive.offsetOf(index), 9)
      expect(tree.heightOf(index)).toBe(naive.heights[index])
    }

    const total = naive.totalHeight
    for (let probe = 0; probe < 200; probe += 1) {
      const offset = random() * (total + 40) - 20
      expect(tree.indexAt(offset)).toBe(naive.indexAt(offset))
    }

    // Every boundary, exactly. Off-by-one lives here.
    for (let index = 0; index < size; index += 1) {
      const start = naive.offsetOf(index)
      expect(tree.indexAt(start)).toBe(naive.indexAt(start))
      expect(tree.indexAt(start - 0.5)).toBe(naive.indexAt(start - 0.5))
      expect(tree.indexAt(start + 0.5)).toBe(naive.indexAt(start + 0.5))
    }
  })
})

describe('the invariant the virtualizer relies on', () => {
  it('always returns a row whose span contains the pixel', () => {
    const random = createRandom(0xfacade)
    const tree = new HeightTree(500, 18)
    for (let i = 0; i < 500; i += 1) tree.setHeight(i, 1 + Math.round(random() * 300) / 4)

    for (let probe = 0; probe < 2_000; probe += 1) {
      const offset = random() * tree.totalHeight
      const index = tree.indexAt(offset)
      const start = tree.offsetOf(index)
      expect(offset).toBeGreaterThanOrEqual(start)
      expect(offset).toBeLessThan(start + tree.heightOf(index))
    }
  })
})

describe('it is actually logarithmic', () => {
  /**
   * This guards the only claim the data structure makes. A linear
   * implementation would need 10^10 operations to finish this, so the budget is
   * generous by six orders of magnitude — it cannot fail for being on a slow
   * machine, only for being the wrong algorithm.
   */
  it('survives 100.000 updates and lookups on a 100.000-row document', () => {
    const rows = 100_000
    const startedAt = performance.now()

    const tree = new HeightTree(rows, 18)
    const random = createRandom(0xbeef)

    for (let i = 0; i < rows; i += 1) {
      tree.setHeight(Math.floor(random() * rows), 10 + Math.round(random() * 200) / 4)
    }
    for (let i = 0; i < rows; i += 1) {
      tree.indexAt(random() * tree.totalHeight)
    }

    expect(performance.now() - startedAt).toBeLessThan(2_000)
  })

  it('builds a 100.000-row document in one pass', () => {
    const startedAt = performance.now()
    const tree = new HeightTree(100_000, 18)
    expect(tree.totalHeight).toBe(1_800_000)
    expect(performance.now() - startedAt).toBeLessThan(200)
  })
})
