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
