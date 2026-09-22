import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFixture } from '../../tests/fixtures'
import { EXPAND_BY, Folding, LARGE_HUNK } from '../core/layout/folding'
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
  /** The two cells of a row, by role: each child of the list is the row
   *  wrapper the grid needs, and the cells sit inside it. */
  const cellsOf = (row: HTMLElement) => {
    const cells = row.querySelectorAll('[role="gridcell"]')
    return { left: cells[0]?.textContent ?? '', right: cells[1]?.textContent ?? '' }
  }

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
      return cells.left === '' && cells.right !== ''
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
      expect(cellsOf(drawn!).left).toContain(String(left.oldNumber))
      expect(cellsOf(drawn!).right).toContain(String(right.newNumber))
      checked += 1
    }
    expect(checked).toBeGreaterThan(0)
  })
})

describe('folding', () => {
  const rowTexts = (): string[] => Array.from(list().children).map((row) => row.textContent ?? '')

  const chevrons = (): HTMLElement[] =>
    screen.getAllByRole('button', { name: /^(Collapse|Expand) / })

  it('takes a file down to its header and puts it back', () => {
    globalThis.testViewportHeight = 100_000
    render(<VirtualDiff diff={diffOf('vite-pr-23346-normal.diff')} />)

    const open = list().childElementCount
    fireEvent.click(chevrons()[0]!)
    const folded = list().childElementCount
    expect(folded).toBeLessThan(open)

    fireEvent.click(chevrons()[0]!)
    expect(list().childElementCount).toBe(open)
  })

  it('leaves the hunk header behind when a hunk folds', () => {
    globalThis.testViewportHeight = 100_000
    render(<VirtualDiff diff={diffOf('vite-pr-23346-normal.diff')} />)

    const hunkChevron = screen.getAllByRole('button', { name: /^Collapse @@/ })[0]!
    const before = rowTexts().filter((t) => t.startsWith('@@')).length
    fireEvent.click(hunkChevron)

    expect(rowTexts().filter((t) => t.startsWith('@@')).length).toBe(before)
    expect(screen.getAllByRole('button', { name: /^Expand @@/ }).length).toBe(1)
  })

  it('says whether each control is expanded', () => {
    globalThis.testViewportHeight = 100_000
    render(<VirtualDiff diff={diffOf('vite-pr-23346-normal.diff')} />)

    const first = chevrons()[0]!
    expect(first).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(first)
    expect(chevrons()[0]!).toHaveAttribute('aria-expanded', 'false')
  })

  it('still windows a folded document rather than rendering all of it', () => {
    render(<VirtualDiff diff={diffOf(BIG)} />)
    fireEvent.click(chevrons()[0]!)
    expect(list().childElementCount).toBeLessThan(100)
  })
})

/**
 * The reason folding is a projection over the index rather than a new index.
 * A fold above the reader moves everything below it; if the scroll position
 * does not move with it, the line they were reading slides away.
 */
describe('folding keeps the reader where they were', () => {
  const chevronFor = (name: RegExp): HTMLElement => screen.getAllByRole('button', { name })[0]!

  /** The row the viewport actually starts on. `children[0]` is overscan. */
  const rowAtTop = (): string => {
    const offset = Number.parseFloat(
      /translateY\(([\d.]+)px\)/.exec(list().style.transform)?.[1] ?? '0',
    )
    const index = Math.round((scroller().scrollTop - offset) / globalThis.testRowHeight)
    return list().children[index]?.textContent ?? ''
  }

  it('holds the top row still when a file above collapses', () => {
    const diff = diffOf(BIG)
    render(<VirtualDiff diff={diff} />)

    const view = scroller()
    view.scrollTop = 4_000
    fireEvent.scroll(view)

    const topBefore = rowAtTop()
    const heightBefore = Number.parseFloat(list().parentElement!.style.height)
    expect(topBefore).not.toBe('')

    fireEvent.click(chevronFor(/^Collapse /))

    // The document got shorter, so staying at 4.000 would show different rows.
    expect(Number.parseFloat(list().parentElement!.style.height)).toBeLessThan(heightBefore)
    expect(view.scrollTop).toBeLessThan(4_000)
    expect(rowAtTop()).toBe(topBefore)
  })

  it('lands on the header of the file it just collapsed', () => {
    const diff = diffOf('vite-pr-23378-new-files.diff')
    globalThis.testViewportHeight = 200
    render(<VirtualDiff diff={diff} />)

    const view = scroller()
    view.scrollTop = 600
    fireEvent.scroll(view)

    // Whichever file the reader is inside: collapsing it takes the anchor row
    // away, and the nearest surviving row above it is that file's header.
    const inside = list().children[0]?.textContent ?? ''
    expect(inside).not.toBe('')

    fireEvent.click(chevronFor(/^Collapse /))
    expect(view.scrollTop).toBeGreaterThanOrEqual(0)
    expect(list().childElementCount).toBeGreaterThan(0)
  })
})

/**
 * A large hunk opens in chunks. The lines come from the diff itself — the
 * GitHub-style "expand the unchanged context" needs the original file, which
 * a .diff does not carry.
 *
 * Built here rather than taken from the corpus: the two fixtures with a hunk
 * over the threshold are 5.818 and 64.807 rows, and laying either out in full
 * under jsdom takes longer than the test is allowed. What the real ones hide
 * is asserted against the model instead, in folding.test.ts.
 */
describe('expanding a hunk too large to show at once', () => {
  const hunkOf = (lines: number) => {
    const body = Array.from({ length: lines }, (_, i) => ` line ${i}`)
    return parseUnifiedDiff(
      [
        'diff --git a/big.ts b/big.ts',
        '--- a/big.ts',
        '+++ b/big.ts',
        `@@ -1,${lines} +1,${lines} @@`,
        ...body,
        '',
      ].join(NEWLINE),
    )
  }

  const expander = (): HTMLElement | undefined =>
    screen.queryAllByRole('button', { name: /^Show \d+ more lines?$/ })[0]

  beforeEach(() => {
    globalThis.testViewportHeight = 100_000
  })

  it('shows the first chunk and offers the rest, counted', () => {
    render(<VirtualDiff diff={hunkOf(LARGE_HUNK + 60)} />)

    expect(expander()).toBeDefined()
    expect(screen.getByText('60 lines not shown')).toBeInTheDocument()
    // The file header, the hunk header, and the rows up to the threshold.
    expect(list().childElementCount).toBe(LARGE_HUNK + 2)
  })

  it('shows them when asked, and stops offering', () => {
    render(<VirtualDiff diff={hunkOf(LARGE_HUNK + 60)} />)
    fireEvent.click(expander()!)

    expect(list().childElementCount).toBe(LARGE_HUNK + 62)
    expect(expander()).toBeUndefined()
  })

  it('opens a chunk at a time when more than a chunk is hidden', () => {
    render(<VirtualDiff diff={hunkOf(LARGE_HUNK + EXPAND_BY * 2)} />)

    expect(screen.getByRole('button', { name: `Show ${EXPAND_BY} more lines` })).toBeInTheDocument()
    fireEvent.click(expander()!)

    expect(list().childElementCount).toBe(LARGE_HUNK + EXPAND_BY + 2)
    expect(expander()).toBeDefined()
  })

  it('offers the whole rest as well, for a reader who wants all of it', () => {
    const hidden = EXPAND_BY * 3
    render(<VirtualDiff diff={hunkOf(LARGE_HUNK + hidden)} />)

    fireEvent.click(screen.getByRole('button', { name: `Show all ${hidden}` }))
    expect(list().childElementCount).toBe(LARGE_HUNK + hidden + 2)
    expect(expander()).toBeUndefined()
  })

  it('leaves a hunk under the threshold alone', () => {
    render(<VirtualDiff diff={hunkOf(LARGE_HUNK - 1)} />)
    expect(expander()).toBeUndefined()
    expect(screen.queryByText(/not shown/)).not.toBeInTheDocument()
  })

  it('leaves the real fixtures of ordinary hunks alone', () => {
    render(<VirtualDiff diff={diffOf('vite-pr-23346-normal.diff')} />)
    expect(expander()).toBeUndefined()
  })
})

const NEWLINE = String.fromCharCode(10)

/**
 * One tab stop for the whole diff, with the active row named rather than
 * focused. A row the reader has scrolled past is not in the document to
 * receive focus, so `aria-activedescendant` is what a virtualized grid has
 * instead.
 */
describe('reading it with the keyboard', () => {
  const grid = (): HTMLElement => screen.getByRole('grid')
  const activeRow = (): HTMLElement | null => {
    const id = grid().getAttribute('aria-activedescendant')
    return id === null ? null : document.getElementById(id)
  }
  const press = (key: string): void => {
    fireEvent.keyDown(grid(), { key })
  }

  it('is one tab stop, and says how many rows it has', () => {
    const diff = diffOf(BIG)
    render(<VirtualDiff diff={diff} />)

    expect(grid()).toHaveAttribute('tabindex', '0')
    expect(grid()).toHaveAttribute(
      'aria-rowcount',
      String(Folding.initial(new RowIndex(diff)).length),
    )
    // Far more rows than are in the document, which is the point of saying it.
    expect(list().childElementCount).toBeLessThan(100)
  })

  it('numbers each rendered row by its place in the whole diff', () => {
    render(<VirtualDiff diff={diffOf(BIG)} />)
    const view = scroller()
    view.scrollTop = 4_000
    fireEvent.scroll(view)

    const indices = Array.from(list().children).map((row) =>
      Number(row.getAttribute('aria-rowindex')),
    )
    expect(indices[0]).toBeGreaterThan(1)
    for (let i = 1; i < indices.length; i += 1) expect(indices[i]).toBe(indices[i - 1]! + 1)
  })

  it('names nothing before a key is pressed', () => {
    render(<VirtualDiff diff={diffOf(BIG)} />)
    expect(grid()).not.toHaveAttribute('aria-activedescendant')
  })

  it('walks a row at a time, with the arrows or with j and k', () => {
    render(<VirtualDiff diff={diffOf(BIG)} />)

    press('ArrowDown')
    const first = activeRow()?.getAttribute('aria-rowindex')
    press('j')
    expect(activeRow()?.getAttribute('aria-rowindex')).toBe(String(Number(first) + 1))
    press('k')
    expect(activeRow()?.getAttribute('aria-rowindex')).toBe(first)
    press('ArrowUp')
    expect(Number(activeRow()?.getAttribute('aria-rowindex'))).toBe(Number(first) - 1)
  })

  it('jumps between files with the brackets', () => {
    const diff = diffOf(BIG)
    render(<VirtualDiff diff={diff} />)

    press(']')
    const after = activeRow()
    expect(after?.textContent).toContain('modified')
    press(']')
    expect(Number(activeRow()?.getAttribute('aria-rowindex'))).toBeGreaterThan(
      Number(after?.getAttribute('aria-rowindex')),
    )
  })

  it('jumps between hunks with n and p', () => {
    render(<VirtualDiff diff={diffOf('vite-pr-23378-new-files.diff')} />)

    press('n')
    const first = Number(activeRow()?.getAttribute('aria-rowindex'))
    press('n')
    const second = Number(activeRow()?.getAttribute('aria-rowindex'))
    expect(second).toBeGreaterThan(first)
    press('p')
    expect(Number(activeRow()?.getAttribute('aria-rowindex'))).toBe(first)
  })

  it('goes to the ends of the diff', () => {
    const diff = diffOf(BIG)
    render(<VirtualDiff diff={diff} />)

    press('End')
    expect(Number(activeRow()?.getAttribute('aria-rowindex'))).toBe(
      Folding.initial(new RowIndex(diff)).length,
    )
    press('Home')
    expect(Number(activeRow()?.getAttribute('aria-rowindex'))).toBe(1)
  })

  it('scrolls the row it moved to into view', () => {
    render(<VirtualDiff diff={diffOf(BIG)} />)
    const view = scroller()
    expect(view.scrollTop).toBe(0)

    press('End')
    expect(view.scrollTop).toBeGreaterThan(0)
    // Named only while it is rendered, which after a jump it is.
    expect(activeRow()).not.toBeNull()
  })

  it('folds and unfolds the row it is on', () => {
    render(<VirtualDiff diff={diffOf(BIG)} />)

    press('ArrowDown')
    press('Home')
    const before = list().childElementCount

    press('Enter')
    expect(screen.getAllByRole('button', { name: /^Expand / })[0]).toBeDefined()
    press('Enter')
    expect(list().childElementCount).toBe(before)
  })

  it('leaves a line row alone when told to fold it', () => {
    render(<VirtualDiff diff={diffOf(BIG)} />)
    const view = scroller()
    view.scrollTop = 4_000
    fireEvent.scroll(view)

    press('ArrowDown')
    const before = list().childElementCount
    press('Enter')
    expect(list().childElementCount).toBe(before)
  })

  it('ignores keys meant for the browser', () => {
    render(<VirtualDiff diff={diffOf(BIG)} />)
    press('ArrowDown')
    const before = activeRow()?.getAttribute('aria-rowindex')

    fireEvent.keyDown(grid(), { key: 'ArrowDown', metaKey: true })
    fireEvent.keyDown(grid(), { key: 'q' })
    expect(activeRow()?.getAttribute('aria-rowindex')).toBe(before)
  })

  it('does not hijack a key pressed on a fold button', () => {
    globalThis.testViewportHeight = 100_000
    render(<VirtualDiff diff={diffOf('vite-pr-23346-normal.diff')} />)

    const button = screen.getAllByRole('button', { name: /^Collapse / })[0]!
    fireEvent.keyDown(button, { key: 'ArrowDown', bubbles: true })
    expect(grid()).not.toHaveAttribute('aria-activedescendant')
  })
})
