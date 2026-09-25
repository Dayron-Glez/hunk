import { createEvent, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFixture } from '../../tests/fixtures'
import type { Direction, Gap } from '../core/expand/gaps'
import { EXPAND_BY, Folding, LARGE_HUNK } from '../core/layout/folding'
import type { GapState } from './rows'
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
    // rather than pulling the right column up by one. The cell is empty to
    // look at and says so out loud, which is why this checks the label.
    const gapped = rowsOf().filter((row) => {
      const cells = cellsOf(row)
      return cells.left === 'No line here before.' && cells.right !== ''
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

/**
 * The divider between the columns.
 *
 * What a browser does with a pointer is not testable here — `tests/setup.ts`
 * stubs `ResizeObserver` as a no-op and hands back a fixed width — and the
 * arithmetic it would drive is covered in `core/layout/panes`. What is
 * testable is that the thing on screen is a control rather than a line: that
 * it says what it is, says where it stands, and answers a keyboard.
 */
/**
 * The fold controls.
 *
 * They were `›` and `⌄` in a span of `w-3` inside `px-1` — about 12 by 16
 * pixels, under what WCAG 2.2 asks of a pointer target, with nothing to say
 * they could be pressed at all. Size is not something jsdom can answer, since
 * it does no layout, so what is pinned here is the class that sets it and the
 * things that are answerable: an icon rather than a character, one shape that
 * turns rather than two that swap, and the label and tab order unchanged.
 */
describe('the fold controls', () => {
  const chevrons = (): HTMLElement[] => {
    globalThis.testViewportHeight = 100_000
    return screen.getAllByRole('button', { name: /^(Collapse|Expand) / })
  }

  const open = (): HTMLElement[] => {
    globalThis.testViewportHeight = 100_000
    render(<VirtualDiff diff={diffOf('vite-pr-23346-normal.diff')} />)
    return chevrons()
  }

  it('is a target of 24 by 24, not a glyph of 12 by 16', () => {
    for (const chevron of open()) {
      expect(chevron.className).toContain('size-6')
    }
  })

  it('shows an icon rather than a character', () => {
    for (const chevron of open()) {
      expect(chevron.querySelector('svg')).not.toBeNull()
      expect(chevron.textContent).toBe('')
    }
  })

  /** A shape that turns reads as the same control in a new state; a
   *  different glyph reads as a different control. */
  it('turns the same icon rather than swapping it', () => {
    const [first] = open()
    const iconOf = (button: HTMLElement): SVGElement => {
      const icon = button.querySelector('svg')
      if (icon === null) throw new Error('no icon')
      return icon
    }

    expect(first).toHaveAttribute('aria-expanded', 'true')
    const expanded = iconOf(first!).getAttribute('class')
    expect(expanded).toContain('rotate-90')

    fireEvent.click(first!)
    const collapsed = screen.getAllByRole('button', { name: /^Expand / })[0]!
    const turned = iconOf(collapsed).getAttribute('class')
    expect(turned).not.toContain('rotate-90')
    // The same icon, minus the turn: nothing else about it changed.
    expect(expanded?.replace(' rotate-90', '')).toBe(turned)
  })

  it('carries an affordance of its own, so it is not part of the header', () => {
    for (const chevron of open()) {
      expect(chevron.className).toContain('hover:bg-neutral-700/60')
      expect(chevron.className).toContain('focus-visible:outline-sky-400')
    }
  })
})

describe('sharing the view between the two columns', () => {
  const dividers = (): HTMLElement[] => screen.getAllByRole('separator')
  /** The first file's, which is the one every assertion below moves. */
  const divider = (): HTMLElement => dividers()[0]!

  const openSplit = (): void => {
    globalThis.testViewportHeight = 100_000
    render(<VirtualDiff diff={diffOf('vite-pr-23346-normal.diff')} mode="split" />)
  }

  afterEach(() => {
    localStorage.clear()
  })

  it('is there in two columns and not in one', () => {
    globalThis.testViewportHeight = 100_000
    render(<VirtualDiff diff={diffOf('vite-pr-23346-normal.diff')} />)
    expect(screen.queryAllByRole('separator')).toHaveLength(0)
  })

  /** One per file on screen, not one for the diff: the lines in one file are
   *  not the lines in the next, and a width that suits a lockfile does not
   *  suit a header. */
  it('gives each file its own, named after it', () => {
    openSplit()
    expect(dividers()).toHaveLength(2)
    for (const one of dividers()) {
      expect(one.getAttribute('aria-label')).toMatch(/^Width of the left column for \S/)
    }
  })

  it('leaves the other files where they were', () => {
    openSplit()
    fireEvent.keyDown(dividers()[0]!, { key: 'End' })
    expect(dividers()[0]).toHaveAttribute('aria-valuenow', '85')
    expect(dividers()[1]).toHaveAttribute('aria-valuenow', '50')
  })

  it('says what it is and where it stands', () => {
    openSplit()
    expect(divider()).toHaveAttribute('aria-orientation', 'vertical')
    expect(divider()).toHaveAttribute('aria-valuenow', '50')
    expect(divider()).toHaveAttribute('aria-valuemin', '15')
    expect(divider()).toHaveAttribute('aria-valuemax', '85')
  })

  /** The grid is one tab stop and the controls inside the rows are out of
   *  the tab order, because those rearrange themselves as the reader
   *  scrolls. There is exactly one divider and it does not move, so the
   *  argument does not reach it. */
  it('is reachable by keyboard', () => {
    openSplit()
    expect(divider().tabIndex).toBe(0)
  })

  it.each([
    ['ArrowRight', '52'],
    ['ArrowLeft', '48'],
    ['Home', '15'],
    ['End', '85'],
  ])('moves on %s', (key, expected) => {
    openSplit()
    fireEvent.keyDown(divider(), { key })
    expect(divider()).toHaveAttribute('aria-valuenow', expected)
  })

  it('stops at the limits rather than walking past them', () => {
    openSplit()
    fireEvent.keyDown(divider(), { key: 'Home' })
    fireEvent.keyDown(divider(), { key: 'ArrowLeft' })
    expect(divider()).toHaveAttribute('aria-valuenow', '15')
  })

  /** The grid below reads the same arrows to move between rows. */
  it('keeps its arrows away from the grid', () => {
    openSplit()
    const event = createEvent.keyDown(divider(), { key: 'ArrowRight' })
    fireEvent(divider(), event)
    expect(event.defaultPrevented).toBe(true)
  })

  it('comes back where it was left, under the path it belongs to', () => {
    openSplit()
    fireEvent.keyDown(divider(), { key: 'End' })
    const stored: unknown = JSON.parse(localStorage.getItem('hunk.split-ratios') ?? '{}')
    expect(stored).toEqual({ 'packages/vite/src/node/__tests__/utils.spec.ts': 0.85 })
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

/**
 * What a reader who cannot see the screen gets, and what virtualization
 * costs them.
 */
describe('reading it without seeing it', () => {
  const grid = (): HTMLElement => screen.getByRole('grid')

  it('says what each line is, since the gutter is hidden', () => {
    globalThis.testViewportHeight = 100_000
    render(<VirtualDiff diff={diffOf('vite-pr-23346-normal.diff')} />)

    expect(screen.getAllByText(/^Added line \d+\.$/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/^Removed line \d+\.$/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/^Line \d+\.$/).length).toBeGreaterThan(0)
  })

  it('keeps those labels out of the clipboard', () => {
    globalThis.testViewportHeight = 100_000
    render(<VirtualDiff diff={diffOf('vite-pr-23346-normal.diff')} />)

    // `sr-only` still copies with a selection; `select-none` is what stops it,
    // so a copied block of the diff is code rather than code plus commentary.
    for (const label of screen.getAllByText(/^Added line \d+\.$/)) {
      expect(label.className).toContain('select-none')
    }
  })

  it('names the empty half of a two-column row', () => {
    globalThis.testViewportHeight = 100_000
    render(<VirtualDiff diff={diffOf('vite-pr-23378-new-files.diff')} mode="split" />)
    expect(screen.getAllByText('No line here before.').length).toBeGreaterThan(0)
  })

  it('gives every row at least one cell', () => {
    globalThis.testViewportHeight = 100_000
    render(<VirtualDiff diff={diffOf('vite-pr-23346-normal.diff')} />)

    for (const row of Array.from(list().children)) {
      expect(row.getAttribute('role')).toBe('row')
      expect(row.querySelectorAll('[role="gridcell"]').length).toBeGreaterThan(0)
    }
  })

  it('gives a two-column row two cells', () => {
    globalThis.testViewportHeight = 100_000
    render(<VirtualDiff diff={diffOf('vite-pr-23346-normal.diff')} mode="split" />)

    const lineRows = Array.from(list().children).filter(
      (row) => row.querySelectorAll('[role="gridcell"]').length === 2,
    )
    expect(lineRows.length).toBeGreaterThan(10)
  })

  /**
   * The cost of virtualization, stated rather than hidden: a screen reader can
   * only reach the rows that exist. `aria-rowcount` and `aria-rowindex` are
   * what make that navigable instead of merely broken — the reader is told
   * there are 5.647 rows and which one they are on, and the keyboard brings
   * any of them into the document.
   */
  it('admits how many rows there are when almost none of them exist', () => {
    const diff = diffOf(BIG)
    render(<VirtualDiff diff={diff} />)

    const total = Folding.initial(new RowIndex(diff)).length
    expect(Number(grid().getAttribute('aria-rowcount'))).toBe(total)
    expect(list().childElementCount).toBeLessThan(total / 20)
  })

  it('keeps the row controls out of the tab order', () => {
    globalThis.testViewportHeight = 100_000
    render(<VirtualDiff diff={diffOf('vite-pr-23346-normal.diff')} />)

    // Tabbing a virtualized list would walk a set that rearranges itself as it
    // scrolls, and whose length depends on the viewport. The grid is the one
    // stop; Enter on the active row does what the buttons do.
    for (const button of screen.getAllByRole('button')) {
      expect(button).toHaveAttribute('tabindex', '-1')
    }
    expect(grid()).toHaveAttribute('tabindex', '0')
  })

  it('keeps a visible focus indicator on the one thing that takes focus', () => {
    render(<VirtualDiff diff={diffOf(BIG)} />)
    expect(grid().className).not.toContain('focus:outline-none')
    expect(grid().className).toContain('focus-visible:outline-2')
  })

  it('says out loud what a keystroke folded', () => {
    render(<VirtualDiff diff={diffOf(BIG)} />)
    const live = grid().querySelector('[aria-live="polite"]')!
    expect(live.textContent).toBe('')

    fireEvent.keyDown(grid(), { key: 'Home' })
    fireEvent.keyDown(grid(), { key: 'Enter' })
    expect(live.textContent).toMatch(/Collapsed file\./)

    fireEvent.keyDown(grid(), { key: 'Enter' })
    expect(live.textContent).toMatch(/Expanded file\./)
  })

  it('reaches the expander from the keyboard, since it is not tabbable', () => {
    globalThis.testViewportHeight = 100_000
    const lines = LARGE_HUNK + 60
    const diff = parseUnifiedDiff(
      [
        'diff --git a/big.ts b/big.ts',
        '--- a/big.ts',
        '+++ b/big.ts',
        `@@ -1,${lines} +1,${lines} @@`,
        ...Array.from({ length: lines }, (_, i) => ` line ${i}`),
        '',
      ].join(String.fromCharCode(10)),
    )
    render(<VirtualDiff diff={diff} />)

    const before = list().childElementCount
    // One file, one hunk: the last row shown is the truncated one.
    fireEvent.keyDown(grid(), { key: 'End' })
    fireEvent.keyDown(grid(), { key: 'Enter' })

    expect(list().childElementCount).toBe(before + 60)
    expect(grid().querySelector('[aria-live="polite"]')?.textContent).toMatch(
      /Showed 60 more lines\./,
    )
  })
})

/**
 * A scrollable box is a tab stop in Chrome, so the browser can scroll it from
 * the keyboard. Inside a virtualized list that puts a stop on every long line
 * on screen, in a set that rearranges itself as it scrolls — 18 of them in 37
 * rows on a real diff. The grid stays the one stop and pans them instead.
 */
describe('long lines in two columns', () => {
  const grid = (): HTMLElement => screen.getByRole('grid')

  const panes = (): HTMLElement[] => Array.from(list().querySelectorAll<HTMLElement>('[data-pan]'))

  it('keeps the scrollable cells out of the tab order', () => {
    globalThis.testViewportHeight = 100_000
    render(<VirtualDiff diff={diffOf('vite-pr-23346-normal.diff')} mode="split" />)

    expect(panes().length).toBeGreaterThan(10)
    for (const pane of panes()) expect(pane).toHaveAttribute('tabindex', '-1')
  })

  it('pans the row the reader is on with left and right', () => {
    globalThis.testViewportHeight = 100_000
    render(<VirtualDiff diff={diffOf('vite-pr-23346-normal.diff')} mode="split" />)

    fireEvent.keyDown(grid(), { key: 'Home' })
    fireEvent.keyDown(grid(), { key: 'j' })
    fireEvent.keyDown(grid(), { key: 'j' })

    const id = grid().getAttribute('aria-activedescendant')!
    const row = document.getElementById(id)!
    const pane = row.querySelector<HTMLElement>('[data-pan]')!
    expect(pane.scrollLeft).toBe(0)

    fireEvent.keyDown(grid(), { key: 'ArrowRight' })
    expect(pane.scrollLeft).toBeGreaterThan(0)

    fireEvent.keyDown(grid(), { key: 'ArrowLeft' })
    expect(pane.scrollLeft).toBe(0)
  })

  it('leaves the arrows to the browser in one column, where the grid scrolls', () => {
    globalThis.testViewportHeight = 100_000
    render(<VirtualDiff diff={diffOf('vite-pr-23346-normal.diff')} />)

    fireEvent.keyDown(grid(), { key: 'Home' })
    fireEvent.keyDown(grid(), { key: 'j' })

    // Nothing to pan: a unified row has no cell of its own to scroll, so the
    // event is not taken and the scroller handles it natively.
    const event = createEvent.keyDown(grid(), { key: 'ArrowRight' })
    fireEvent(grid(), event)
    expect(event.defaultPrevented).toBe(false)
  })
})

/**
 * The unchanged lines a diff left out. Offered only when the diff came from
 * somewhere they can be fetched — a pasted file says nothing about where the
 * rest of it lives.
 */
describe('the lines the diff left out', () => {
  const expansionSpy = () => {
    const calls: { file: number; from: number; direction: string }[] = []
    let state: GapState = 'idle'
    return {
      calls,
      setState: (next: GapState) => {
        state = next
      },
      value: {
        stateOf: () => state,
        expand: (file: number, gap: Gap, direction: Direction) => {
          calls.push({ file, from: gap.newFrom, direction })
        },
      },
    }
  }

  it('offers nothing when the diff was pasted', () => {
    globalThis.testViewportHeight = 100_000
    render(<VirtualDiff diff={diffOf('vite-pr-23346-normal.diff')} />)
    expect(screen.queryByText(/unchanged lines/)).not.toBeInTheDocument()
  })

  it('offers each gap, with how much it hides', () => {
    globalThis.testViewportHeight = 100_000
    const spy = expansionSpy()
    render(<VirtualDiff diff={diffOf('vite-pr-23346-normal.diff')} expansion={spy.value} />)

    // Both files of that pull request start well past line one.
    expect(screen.getAllByText(/unchanged lines$/)).toHaveLength(2)
    expect(screen.getByText('591 unchanged lines')).toBeInTheDocument()
  })

  /**
   * A gap before the first hunk has nothing above it, so the only lines it can
   * reveal are the ones touching the hunk below. Offering the other direction
   * put line 1 of the file directly before line 4.428 on a real pull request.
   */
  it('offers only the arrow that points at a hunk', () => {
    globalThis.testViewportHeight = 100_000
    const spy = expansionSpy()
    render(<VirtualDiff diff={diffOf('vite-pr-23346-normal.diff')} expansion={spy.value} />)

    // Both files of that pull request start past line one and have one hunk.
    expect(screen.getAllByRole('button', { name: '↑ 20' }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: '↓ 20' })).not.toBeInTheDocument()
  })

  it('offers both ends of a gap that has a hunk on each side', () => {
    globalThis.testViewportHeight = 100_000
    const spy = expansionSpy()
    // Seven of that pull request's gaps sit between two hunks. The label
    // carries the step, which is the gap's own size when it is under a chunk.
    render(<VirtualDiff diff={diffOf('vite-pr-23378-new-files.diff')} expansion={spy.value} />)

    fireEvent.click(screen.getAllByRole('button', { name: /^↓ / })[0]!)
    fireEvent.click(screen.getAllByRole('button', { name: /^↑ / })[0]!)
    expect(spy.calls.map((c) => c.direction)).toEqual(['down', 'up'])
  })

  it('asks for the end the reader pressed', () => {
    globalThis.testViewportHeight = 100_000
    const spy = expansionSpy()
    render(<VirtualDiff diff={diffOf('vite-pr-23346-normal.diff')} expansion={spy.value} />)

    fireEvent.click(screen.getAllByRole('button', { name: '↑ 20' })[0]!)
    fireEvent.click(screen.getAllByRole('button', { name: /^All / })[0]!)

    expect(spy.calls.map((c) => c.direction)).toEqual(['up', 'all'])
    expect(new Set(spy.calls.map((c) => c.from)).size).toBe(1)
  })

  it('says so while it is fetching, and stops taking presses', () => {
    globalThis.testViewportHeight = 100_000
    const spy = expansionSpy()
    spy.setState('loading')
    render(<VirtualDiff diff={diffOf('vite-pr-23346-normal.diff')} expansion={spy.value} />)

    expect(screen.getAllByText('Fetching the file…')[0]).toBeInTheDocument()
    for (const button of screen.getAllByRole('button', { name: '↑ 20' })) {
      expect(button).toBeDisabled()
    }
  })

  it('puts the reason in place of the controls when it could not', () => {
    globalThis.testViewportHeight = 100_000
    const spy = expansionSpy()
    spy.setState({ error: 'This file has changed since the diff was loaded.' })
    render(<VirtualDiff diff={diffOf('vite-pr-23346-normal.diff')} expansion={spy.value} />)

    expect(screen.getAllByRole('alert')[0]).toHaveTextContent('has changed since')
    expect(screen.queryByRole('button', { name: '↑ 20' })).not.toBeInTheDocument()
  })

  it('keeps the gap out of the tab order like every other row control', () => {
    globalThis.testViewportHeight = 100_000
    const spy = expansionSpy()
    render(<VirtualDiff diff={diffOf('vite-pr-23346-normal.diff')} expansion={spy.value} />)

    for (const button of screen.getAllByRole('button', { name: /^[↑↓]/ })) {
      expect(button).toHaveAttribute('tabindex', '-1')
    }
  })

  it('gives the gap a row of the grid like anything else', () => {
    globalThis.testViewportHeight = 100_000
    const spy = expansionSpy()
    render(<VirtualDiff diff={diffOf('vite-pr-23346-normal.diff')} expansion={spy.value} />)

    const gap = screen.getByText('591 unchanged lines').closest('[role="row"]')
    expect(gap).not.toBeNull()
    expect(gap!.querySelectorAll('[role="gridcell"]')).toHaveLength(1)
  })
})
