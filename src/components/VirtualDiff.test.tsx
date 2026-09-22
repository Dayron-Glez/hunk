import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFixture } from '../../tests/fixtures'
import { RowIndex } from '../core/layout/rowIndex'
import { parseUnifiedDiff } from '../core/parse/unified'
import { VirtualDiff } from './VirtualDiff'

/** 5.818 rows — big enough that rendering all of them would be obvious. */
const BIG = 'npm-cli-47fc8b19-mass-rename.diff'

const diffOf = (name: string) => parseUnifiedDiff(readFixture('github', name))

const scroller = (): HTMLElement => screen.getByTestId('diff-scroller')
const list = (): HTMLElement => scroller().querySelector('[data-rows]')!

beforeEach(() => {
  globalThis.testViewportHeight = 400
  globalThis.testRowHeight = 20
})
afterEach(() => {
  globalThis.testViewportHeight = 800
})

describe('only the visible rows exist', () => {
  it('puts a window of rows in the DOM, not the document', () => {
    const diff = diffOf(BIG)
    const rows = new RowIndex(diff)
    expect(rows.length).toBeGreaterThan(5_000)

    render(<VirtualDiff diff={diff} />)

    // 400px of viewport plus 600px of overscan on each side, at 20px a row.
    expect(list().childElementCount).toBeLessThan(100)
    expect(list().childElementCount).toBeGreaterThan(0)
  })

  it('keeps the scrollbar sized for the whole document, not for the window', () => {
    const diff = diffOf(BIG)
    const rows = new RowIndex(diff)
    render(<VirtualDiff diff={diff} />)

    const spacer = list().parentElement!
    const height = Number.parseFloat(spacer.style.height)

    // Rows that have never been on screen still hold their estimate, so the
    // total is not simply "rows times the measured height" — but it has to
    // account for all of them, and be far larger than what is rendered.
    expect(height).toBeGreaterThanOrEqual(rows.length * 20)
    expect(height).toBeGreaterThan(list().childElementCount * 20 * 10)
  })

  it('renders every row when the document is small enough to fit', () => {
    const diff = diffOf('vite-pr-23346-normal.diff')
    const rows = new RowIndex(diff)
    globalThis.testViewportHeight = 100_000
    render(<VirtualDiff diff={diff} />)
    expect(list().childElementCount).toBe(rows.length)
  })
})

describe('scrolling', () => {
  it('swaps in different rows and moves the block to match', () => {
    render(<VirtualDiff diff={diffOf(BIG)} />)

    const firstText = list().textContent
    const offsetBefore = list().style.transform

    const element = scroller()
    element.scrollTop = 20_000
    fireEvent.scroll(element)

    expect(list().textContent).not.toBe(firstText)
    expect(list().style.transform).not.toBe(offsetBefore)
    // The block is pushed down to where those rows actually belong, rather than
    // the rows being positioned one by one.
    expect(list().style.transform).toMatch(/translateY\(\d+(\.\d+)?px\)/)
  })

  it('still shows a window rather than everything above it', () => {
    render(<VirtualDiff diff={diffOf(BIG)} />)
    const element = scroller()
    element.scrollTop = 50_000
    fireEvent.scroll(element)
    expect(list().childElementCount).toBeLessThan(100)
  })

  it('maps the scroll position to the right end of the document', () => {
    const diff = diffOf(BIG)
    const first = diff.files[0]
    const firstPath = (first?.newPath ?? first?.oldPath ?? '').split('/').slice(-2).join('/')

    render(<VirtualDiff diff={diff} />)
    expect(list().textContent).toContain(firstPath)

    const element = scroller()
    element.scrollTop = 10_000_000
    fireEvent.scroll(element)

    expect(list().textContent).not.toContain(firstPath)

    // Scrolled to the end, the rendered block sits at the end: the offset it is
    // pushed down by is almost the whole document. Asserting on which file is
    // on screen would be asserting on the fixture, not on the mapping.
    const offset = Number.parseFloat(
      /translateY\(([\d.]+)px\)/.exec(list().style.transform)?.[1] ?? '0',
    )
    const total = Number.parseFloat(list().parentElement!.style.height)
    expect(offset).toBeGreaterThan(total * 0.9)
  })
})

describe('the empty case', () => {
  it('renders nothing rather than failing', () => {
    render(<VirtualDiff diff={parseUnifiedDiff('')} />)
    expect(list().childElementCount).toBe(0)
  })
})

describe('two columns', () => {
  const rowsOf = (): HTMLElement[] => Array.from(list().children) as HTMLElement[]
  const cellsOf = (row: HTMLElement) => ({
    left: row.children[0]?.textContent ?? '',
    right: row.children[1]?.textContent ?? '',
  })

  it('draws a replacement as one row with both versions on it', () => {
    globalThis.testViewportHeight = 100_000
    render(<VirtualDiff diff={diffOf('vite-pr-23346-normal.diff')} mode="split" />)

    // The one edited line of that pull request, before and after.
    const after = '[\\w.][^,]+'
    const before = '\\w[^,]+'

    const paired = rowsOf().find((row) => cellsOf(row).right.includes(after))
    expect(paired).toBeDefined()
    expect(cellsOf(paired!).left).toContain(before)
  })

  it('needs fewer rows than the unified view of the same diff', () => {
    const diff = diffOf(BIG)
    expect(new RowIndex(diff, 'split').length).toBeLessThan(new RowIndex(diff).length)
  })

  it('still windows rather than rendering the whole document', () => {
    render(<VirtualDiff diff={diffOf(BIG)} mode="split" />)
    expect(list().childElementCount).toBeLessThan(100)
    expect(list().childElementCount).toBeGreaterThan(0)
  })

  it('leaves a blank cell opposite a line with no counterpart', () => {
    globalThis.testViewportHeight = 100_000
    render(<VirtualDiff diff={diffOf('vite-pr-23378-new-files.diff')} mode="split" />)

    // A new file is all insertions, so every line of it has an empty left cell
    // rather than pulling the right column up by one.
    const gapped = rowsOf().filter((row) => {
      const cells = cellsOf(row)
      return row.childElementCount === 2 && cells.left === '' && cells.right !== ''
    })
    expect(gapped.length).toBeGreaterThan(10)
  })

  it('numbers the left cell from the old file and the right from the new', () => {
    globalThis.testViewportHeight = 100_000
    const diff = diffOf('vite-pr-23378-new-files.diff')
    render(<VirtualDiff diff={diff} mode="split" />)

    // After a block of additions the two files no longer agree on line
    // numbers, which is the case a shared gutter would get wrong.
    const rows = new RowIndex(diff, 'split')
    let checked = 0
    for (let row = 0; row < rows.length; row += 1) {
      const left = rows.cellAt(row, 'old')
      const right = rows.cellAt(row, 'new')
      if (left === null || right === null) continue
      if (left.oldNumber === right.newNumber) continue
      const drawn = rowsOf()[row]
      expect(drawn?.children[0]?.textContent).toContain(String(left.oldNumber))
      expect(drawn?.children[1]?.textContent).toContain(String(right.newNumber))
      checked += 1
    }
    expect(checked).toBeGreaterThan(0)
  })
})
