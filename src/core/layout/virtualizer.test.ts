import { describe, expect, it } from 'vitest'
import { HeightTree } from './heightTree'
import { Virtualizer } from './virtualizer'

const uniform = (count: number, height: number): Float64Array =>
  new Float64Array(count).fill(height)

/** 100 rows of 20px, no overscan, so window arithmetic is readable in the assertions. */
const plain = (overscan = 0): Virtualizer => new Virtualizer(uniform(100, 20), overscan)

describe('HeightTree.fromHeights', () => {
  it('seeds each row with its own height', () => {
    const tree = HeightTree.fromHeights([10, 30, 5])
    expect(tree.totalHeight).toBe(45)
    expect(tree.offsetOf(1)).toBe(10)
    expect(tree.offsetOf(2)).toBe(40)
    expect(tree.indexAt(39)).toBe(1)
    expect(tree.indexAt(40)).toBe(2)
  })

  it('accepts an empty document', () => {
    const tree = HeightTree.fromHeights([])
    expect(tree.length).toBe(0)
    expect(tree.totalHeight).toBe(0)
  })

  it('refuses a bad height instead of building a corrupt tree', () => {
    expect(() => HeightTree.fromHeights([10, -1])).toThrow(RangeError)
    expect(() => HeightTree.fromHeights([10, Number.NaN])).toThrow(RangeError)
  })

  it('agrees with the uniform constructor when every height is the same', () => {
    const seeded = HeightTree.fromHeights(uniform(50, 18))
    const uniformly = new HeightTree(50, 18)
    for (let i = 0; i < 50; i += 1) {
      expect(seeded.offsetOf(i)).toBe(uniformly.offsetOf(i))
    }
    expect(seeded.totalHeight).toBe(uniformly.totalHeight)
  })
})

describe('the visible window', () => {
  it('is empty before a viewport is set', () => {
    const virtualizer = plain()
    expect(virtualizer.visible).toMatchObject({ first: 0, last: 0, offsetTop: 0 })
  })

  it('covers exactly what the viewport shows', () => {
    const virtualizer = plain()
    virtualizer.setViewport(0, 100)
    expect(virtualizer.visible).toEqual({
      first: 0,
      last: 5,
      offsetTop: 0,
      totalHeight: 2000,
    })
  })

  it('moves with the scroll position', () => {
    const virtualizer = plain()
    virtualizer.setViewport(500, 100)
    expect(virtualizer.visible).toMatchObject({ first: 25, last: 30, offsetTop: 500 })
  })

  it('adds the overscan margin on both sides', () => {
    const virtualizer = plain(100)
    virtualizer.setViewport(500, 100)
    // 500 - 100 = 400 → row 20, and 500 + 100 + 100 = 700 → row 35
    expect(virtualizer.visible).toMatchObject({ first: 20, last: 35, offsetTop: 400 })
  })

  it('does not run off either end', () => {
    const virtualizer = plain(1000)
    virtualizer.setViewport(0, 100)
    expect(virtualizer.visible.first).toBe(0)
    virtualizer.setViewport(1900, 100)
    expect(virtualizer.visible.last).toBe(99)
  })

  it('renders the whole document when it fits on screen', () => {
    const virtualizer = new Virtualizer(uniform(10, 20), 0)
    virtualizer.setViewport(0, 5000)
    expect(virtualizer.visible).toMatchObject({ first: 0, last: 9, totalHeight: 200 })
  })

  it('has nothing to show for an empty diff', () => {
    const virtualizer = new Virtualizer([], 0)
    virtualizer.setViewport(0, 800)
    expect(virtualizer.visible).toEqual({ first: 0, last: -1, offsetTop: 0, totalHeight: 0 })
    expect(virtualizer.rowCount).toBe(0)
  })

  it('treats a negative scroll position as the top', () => {
    const virtualizer = plain()
    virtualizer.setViewport(-200, 100)
    expect(virtualizer.visible.first).toBe(0)
  })

  it('refuses a viewport described in nonsense', () => {
    const virtualizer = plain()
    expect(() => virtualizer.setViewport(Number.NaN, 100)).toThrow(RangeError)
    expect(() => new Virtualizer(uniform(5, 10), -1)).toThrow(RangeError)
  })
})

describe('measuring changes the window', () => {
  it('shows fewer rows once they turn out to be taller', () => {
    const virtualizer = plain()
    virtualizer.setViewport(0, 100)
    expect(virtualizer.visible.last).toBe(5)

    for (let row = 0; row < 10; row += 1) virtualizer.measure(row, 50)
    expect(virtualizer.visible.last).toBe(2)
    expect(virtualizer.totalHeight).toBe(10 * 50 + 90 * 20)
  })
})

/**
 * The reason this class exists. Everything above is bookkeeping; this is the
 * part that decides whether the viewer can be read while it is still measuring.
 */
describe('scroll correction', () => {
  it('reports nothing when no measurement moved anything visible', () => {
    const virtualizer = plain()
    virtualizer.setViewport(500, 100)
    expect(virtualizer.takeScrollCorrection()).toBe(0)
  })

  it('cancels the shift when a row above the viewport grows', () => {
    const virtualizer = plain()
    virtualizer.setViewport(500, 100) // anchored on row 25
    virtualizer.measure(3, 60) // 40px taller, and above the anchor
    expect(virtualizer.takeScrollCorrection()).toBe(40)
  })

  it('cancels it the other way when a row above shrinks', () => {
    const virtualizer = plain()
    virtualizer.setViewport(500, 100)
    virtualizer.measure(3, 5)
    expect(virtualizer.takeScrollCorrection()).toBe(-15)
  })

  it('adds up every row above the anchor', () => {
    const virtualizer = plain()
    virtualizer.setViewport(500, 100)
    virtualizer.measure(1, 30)
    virtualizer.measure(2, 30)
    virtualizer.measure(10, 25)
    expect(virtualizer.takeScrollCorrection()).toBe(10 + 10 + 5)
  })

  it('ignores rows below the anchor, which move nothing the reader can see', () => {
    const virtualizer = plain()
    virtualizer.setViewport(500, 100)
    virtualizer.measure(30, 200)
    virtualizer.measure(99, 200)
    expect(virtualizer.takeScrollCorrection()).toBe(0)
  })

  it('ignores the anchor row itself, which starts where it started', () => {
    const virtualizer = plain()
    virtualizer.setViewport(500, 100)
    expect(virtualizer.anchor).toBe(25)
    virtualizer.measure(25, 200)
    expect(virtualizer.takeScrollCorrection()).toBe(0)
  })

  it('forgets a correction once it has been taken', () => {
    const virtualizer = plain()
    virtualizer.setViewport(500, 100)
    virtualizer.measure(3, 60)
    expect(virtualizer.takeScrollCorrection()).toBe(40)
    expect(virtualizer.takeScrollCorrection()).toBe(0)
  })

  it('reports nothing for a measurement that confirms the estimate', () => {
    const virtualizer = plain()
    virtualizer.setViewport(500, 100)
    virtualizer.measure(3, 20)
    expect(virtualizer.takeScrollCorrection()).toBe(0)
  })

  /**
   * The property the whole mechanism exists to guarantee, stated directly:
   * applying the correction leaves the anchor row exactly where it was on
   * screen. Checked against measurements that grow, shrink and collapse rows.
   */
  it('keeps the anchor row in the same place on screen', () => {
    const virtualizer = new Virtualizer(uniform(200, 20), 0)
    let scrollTop = 1000
    virtualizer.setViewport(scrollTop, 400)

    const anchor = virtualizer.anchor
    const screenPositionBefore = virtualizer.offsetOf(anchor) - scrollTop

    const heights = [55, 3, 0, 120, 21, 19, 80]
    for (let row = 0; row < anchor; row += 1) {
      virtualizer.measure(row, heights[row % heights.length]!)
    }

    scrollTop += virtualizer.takeScrollCorrection()
    expect(virtualizer.offsetOf(anchor) - scrollTop).toBeCloseTo(screenPositionBefore, 9)
  })
})

describe('scrolling to a row', () => {
  it('gives the offset that puts a row at the top', () => {
    const virtualizer = plain()
    virtualizer.setViewport(0, 200)
    expect(virtualizer.scrollOffsetFor(10)).toBe(200)
  })

  it('does not scroll past the end of the document', () => {
    const virtualizer = plain()
    virtualizer.setViewport(0, 500)
    // Row 99 starts at 1980, but 1500 is as far as a 500px viewport can go.
    expect(virtualizer.scrollOffsetFor(99)).toBe(1500)
  })
})
