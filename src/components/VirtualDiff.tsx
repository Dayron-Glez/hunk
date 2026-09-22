import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { HighlightStore } from '../core/highlight/store'
import { EXPAND_BY, Folding, type HunkRef } from '../core/layout/folding'
import { MeasuredHeights } from '../core/layout/measuredHeights'
import { moveFrom, startingPosition, type Move } from '../core/layout/navigation'
import { RowIndex, RowKind, type LayoutMode } from '../core/layout/rowIndex'
import { Virtualizer, type VisibleWindow } from '../core/layout/virtualizer'
import type { ParsedDiff } from '../core/parse/types'
import { HighlightClient } from '../workers/highlightClient'
import { DiffRow, SplitDiffRow } from './DiffRow'
import { ExpanderRow, FileHeaderRow, HunkHeaderRow, NoteRow } from './rows'

/** Starting points only — every row that reaches the screen is measured. They
 *  keep the scrollbar roughly right on the first frame. */
const ESTIMATED_HEIGHT: Record<RowKind, number> = {
  [RowKind.FileHeader]: 37,
  [RowKind.Note]: 52,
  [RowKind.HunkHeader]: 24,
  [RowKind.Line]: 20,
  [RowKind.Gap]: 29,
}

/** Rendered beyond the viewport, so small scrolls need no new rows. */
const OVERSCAN_PX = 600

/** What the keys do. The moves themselves live in core/layout/navigation. */
const MOVES: Readonly<Record<string, Move>> = {
  ArrowDown: 'next-row',
  j: 'next-row',
  ArrowUp: 'previous-row',
  k: 'previous-row',
  n: 'next-hunk',
  p: 'previous-hunk',
  ']': 'next-file',
  '[': 'previous-file',
  PageDown: 'next-page',
  PageUp: 'previous-page',
  Home: 'first',
  End: 'last',
}

const ACTIVE_ROW = 'outline outline-1 -outline-offset-1 outline-sky-400/80'

/** How far one press pans a line too wide for its column. */
const PAN_PX = 120

/** Stable per position, which is what `aria-activedescendant` needs to name. */
const rowElementId = (position: number): string => `diff-row-${position}`

/** Where the reader was looking, so a fold can put them back there. */
interface Anchor {
  /** A row of the full index, which outlives any one projection. */
  readonly row: number
  /** How far into that row the viewport started. */
  readonly within: number
}

interface Layout {
  readonly folding: Folding
  /** Set by the fold that produced this layout; null on the first one. */
  readonly restore: Anchor | null
}

export function VirtualDiff({
  diff,
  mode = 'unified',
}: {
  readonly diff: ParsedDiff
  readonly mode?: LayoutMode
}) {
  // Rebuilt on a mode change rather than kept for both: the second index costs
  // 10 ms on the kernel commit, and holding it costs 1 MB for as long as the
  // reader stays in the mode that does not use it.
  const rows = useMemo(() => new RowIndex(diff, mode), [diff, mode])

  // Kept by row of the full index, so a fold rebuilds the height tree without
  // losing what every row already measured.
  const heights = useMemo(() => new MeasuredHeights(rows, ESTIMATED_HEIGHT), [rows])

  const [layout, setLayout] = useState<Layout>(() => ({
    folding: Folding.initial(rows),
    restore: null,
  }))
  const [openedFor, setOpenedFor] = useState(rows)
  let { folding } = layout
  if (openedFor !== rows) {
    folding = Folding.initial(rows)
    setOpenedFor(rows)
    setLayout({ folding, restore: null })
  }

  const virtualizer = useMemo(
    () => new Virtualizer(heights.seed(folding), OVERSCAN_PX),
    [folding, heights],
  )

  const scrollerRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  // State rather than a ref, because a fold reads it while deciding where to
  // put the reader back. It changes only when the window does, so the extra
  // render costs nothing, and the scroll handler still never touches layout.
  const [viewportHeight, setViewportHeight] = useState(0)
  /** The virtualizer whose restore has already reached the DOM. */
  const restored = useRef(virtualizer)

  // The row the keyboard is on, by row of the full index so it survives a
  // fold. Null until the reader presses a key.
  const [activeRow, setActiveRow] = useState<number | null>(null)

  const [view, setView] = useState<VisibleWindow>(() => virtualizer.visible)
  // Which virtualizer `view` describes. A fold or a layout switch builds a new
  // one over a different document, and a window left over from the old one
  // asks for rows that no longer exist. Reset here rather than in an effect:
  // an effect runs after the render that would already have read past the end.
  const [described, setDescribed] = useState(virtualizer)
  let shown = view
  if (described !== virtualizer) {
    // Aim the new virtualizer at the anchor before reading its window, so the
    // rows rendered this frame are the ones the reader ends up looking at.
    const target = offsetToRestore(virtualizer, folding, layout.restore)
    if (target !== null) virtualizer.setViewport(target, viewportHeight)
    shown = virtualizer.visible
    setDescribed(virtualizer)
    setView(shown)
  }
  // Bumped when colours land, which is the only thing that makes this render
  // without the window having moved.
  const [coloured, setColoured] = useState(0)

  const highlights = useMemo(() => {
    const client = new HighlightClient()
    const store = new HighlightStore(rows, client, () => {
      setColoured((n) => n + 1)
    })
    return { client, store }
  }, [rows])

  useEffect(
    () => () => {
      highlights.client.dispose()
    },
    [highlights],
  )

  // Only what is on screen, plus the overscan the window already carries. The
  // store speaks in rows, so the window's positions are translated back.
  const firstRow = folding.rowAt(view.first)
  const lastRow = folding.rowAt(view.last)
  useEffect(() => {
    if (firstRow !== -1 && lastRow !== -1) highlights.store.requestRange(firstRow, lastRow)
  }, [highlights, firstRow, lastRow])

  const refresh = useCallback(() => {
    const scroller = scrollerRef.current
    if (scroller === null) return
    virtualizer.setViewport(scroller.scrollTop, viewportHeight)
    const next = virtualizer.visible
    setView((current) => (sameWindow(current, next) ? current : next))
  }, [virtualizer, viewportHeight])

  /** Fold, remembering the row at the top so the reader keeps their place. */
  const refold = useCallback(
    (next: Folding) => {
      const scroller = scrollerRef.current
      const position = virtualizer.anchor
      const row = folding.rowAt(position)
      const restore =
        scroller === null || row === -1
          ? null
          : { row, within: scroller.scrollTop - virtualizer.offsetOf(position) }
      setLayout({ folding: next, restore })
    },
    [folding, virtualizer],
  )

  const toggleFile = useCallback(
    (file: number) => {
      refold(folding.toggleFile(file))
    },
    [folding, refold],
  )

  const toggleHunk = useCallback(
    (ref: HunkRef) => {
      refold(folding.toggleHunk(ref))
    },
    [folding, refold],
  )

  const expandHunk = useCallback(
    (ref: HunkRef) => {
      refold(folding.expandHunk(ref))
    },
    [folding, refold],
  )

  const expandHunkFully = useCallback(
    (ref: HunkRef) => {
      refold(folding.expandHunkFully(ref))
    },
    [folding, refold],
  )

  // Folding from the keyboard changes the document without moving the focus,
  // which a screen reader would otherwise pass over in silence.
  const [announcement, setAnnouncement] = useState('')
  const announce = useCallback((message: string) => {
    // Re-announced even when the message repeats: two collapses in a row are
    // two events, and an unchanged string is read once.
    setAnnouncement((previous) => (previous === message ? `${message} ` : message))
  }, [])

  /** Scroll only as far as it takes to bring a position into view. */
  const reveal = useCallback(
    (position: number) => {
      const scroller = scrollerRef.current
      if (scroller === null) return
      const top = virtualizer.offsetOf(position)
      const bottom = top + virtualizer.heightOf(position)
      if (top < scroller.scrollTop) scroller.scrollTop = top
      else if (bottom > scroller.scrollTop + viewportHeight) {
        scroller.scrollTop = bottom - viewportHeight
      }
      refresh()
    },
    [virtualizer, viewportHeight, refresh],
  )

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      // Let the reader use the fold buttons and the layout toggle normally.
      if (event.target !== event.currentTarget) return
      if (event.altKey || event.ctrlKey || event.metaKey) return

      const from = startingPosition(
        activeRow === null ? null : folding.positionAt(activeRow),
        view.first,
        view.last,
      )

      if (event.key === 'Enter' || event.key === ' ') {
        const row = folding.rowAt(from)
        if (row === -1) return
        const kind = rows.kindAt(row)
        const ref = { file: rows.fileIndexAt(row), hunk: rows.hunkIndexAt(row) }

        if (kind === RowKind.FileHeader) {
          toggleFile(ref.file)
          announce(`${folding.isFileCollapsed(ref.file) ? 'Expanded' : 'Collapsed'} file.`)
        } else if (kind === RowKind.HunkHeader) {
          toggleHunk(ref)
          announce(`${folding.isHunkCollapsed(ref) ? 'Expanded' : 'Collapsed'} hunk.`)
        } else if (folding.hiddenAfter(from) > 0) {
          // The expander is out of the tab order, so this is how it is reached.
          expandHunk(ref)
          announce(`Showed ${Math.min(EXPAND_BY, folding.hiddenAfter(from))} more lines.`)
        } else return

        event.preventDefault()
        setActiveRow(row)
        return
      }

      // Left and right pan a two-column row, whose cells each scroll on their
      // own and are out of the tab order for it. In one column the whole grid
      // scrolls sideways, so the browser's own handling is left alone.
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        const element = document.getElementById(rowElementId(from))
        const panes = element?.querySelectorAll<HTMLElement>('[data-pan]') ?? []
        if (panes.length === 0) return
        event.preventDefault()
        const by = event.key === 'ArrowRight' ? PAN_PX : -PAN_PX
        for (const pane of panes) pane.scrollLeft += by
        return
      }

      const move = MOVES[event.key]
      if (move === undefined) return
      event.preventDefault()

      // A page is what the viewport holds, which only this component knows.
      const pageRows = Math.max(1, Math.round(viewportHeight / 20))
      const to = moveFrom(rows, folding, from, move, pageRows)
      setActiveRow(folding.rowAt(to))
      reveal(to)
    },
    [
      activeRow,
      folding,
      rows,
      view.first,
      view.last,
      viewportHeight,
      reveal,
      toggleFile,
      toggleHunk,
      expandHunk,
      announce,
    ],
  )

  /**
   * Measure what was rendered, then put the view back where it was.
   *
   * This loops on purpose — measuring changes the layout, which can change which
   * rows belong on screen. It settles because an unchanged height reports no
   * change, which is why the dependency is the window itself. A layout effect
   * rather than an ordinary one: the correction must land before the paint, or
   * the reader sees the jump it exists to prevent.
   */
  useLayoutEffect(() => {
    const scroller = scrollerRef.current
    const list = listRef.current
    if (scroller === null || list === null) return

    if (viewportHeight === 0) setViewportHeight(scroller.clientHeight)

    // A fold aimed the virtualizer at the anchor during the render; the scroll
    // position itself still has to follow, once per new projection.
    if (restored.current !== virtualizer) {
      restored.current = virtualizer
      const target = offsetToRestore(virtualizer, folding, layout.restore)
      if (target !== null) scroller.scrollTop = target
    }

    const children = list.children
    for (let i = 0; i < children.length; i += 1) {
      const element = children[i]
      if (element === undefined) continue
      const position = view.first + i
      // Not offsetHeight: it rounds to whole pixels, and rounding a hundred
      // thousand rows drifts the document by more than a screenful.
      const height = element.getBoundingClientRect().height
      virtualizer.measure(position, height)
      heights.record(folding.rowAt(position), height)
    }

    const correction = virtualizer.takeScrollCorrection()
    if (correction !== 0) scroller.scrollTop += correction

    virtualizer.setViewport(scroller.scrollTop, viewportHeight)
    const next = virtualizer.visible
    setView((current) => (sameWindow(current, next) ? current : next))
  }, [virtualizer, view, folding, heights, layout.restore, viewportHeight])

  useEffect(() => {
    const scroller = scrollerRef.current
    if (scroller === null) return

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry === undefined) return
      setViewportHeight(entry.contentRect.height)
      refresh()
    })
    observer.observe(scroller)
    return () => {
      observer.disconnect()
    }
  }, [refresh])

  const activePosition = activeRow === null ? -1 : folding.positionAt(activeRow)

  const visibleRows = []
  for (let position = shown.first; position <= shown.last; position += 1) {
    const row = folding.rowAt(position)
    if (row === -1) continue

    const hidden = folding.hiddenAfter(position)
    const ref = { file: rows.fileIndexAt(row), hunk: rows.hunkIndexAt(row) }

    // One wrapper per position, and the expander shares it, so the height the
    // virtualizer measures covers both and the arithmetic stays one row deep.
    visibleRows.push(
      <div
        key={row}
        id={rowElementId(position)}
        role="row"
        aria-rowindex={position + 1}
        className={position === activePosition ? ACTIVE_ROW : undefined}
      >
        <Row
          rows={rows}
          row={row}
          folding={folding}
          store={highlights.store}
          onToggleFile={toggleFile}
          onToggleHunk={toggleHunk}
        />
        {hidden === 0 ? null : (
          <ExpanderRow
            hidden={hidden}
            chunk={EXPAND_BY}
            onExpand={() => {
              expandHunk(ref)
            }}
            onExpandAll={() => {
              expandHunkFully(ref)
            }}
          />
        )}
      </div>,
    )
  }
  void coloured

  return (
    <div
      ref={scrollerRef}
      onScroll={refresh}
      onKeyDown={onKeyDown}
      // One tab stop for the whole diff, with the active row named rather than
      // focused: a row the reader has scrolled past is not in the document to
      // receive focus, and `aria-rowcount` is how a grid says how many rows it
      // has when most of them are not there.
      role="grid"
      tabIndex={0}
      aria-label="Diff"
      aria-rowcount={folding.length}
      aria-activedescendant={
        activePosition >= shown.first && activePosition <= shown.last
          ? rowElementId(activePosition)
          : undefined
      }
      className="h-full overflow-auto bg-neutral-950 font-mono text-xs focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sky-400"
      data-testid="diff-scroller"
    >
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
      {/* Sized for the whole document, so the reader can scroll to rows that
          are not in the DOM yet. */}
      <div role="presentation" style={{ height: shown.totalHeight }} className="relative">
        {/* One transform for the block: rows stay in normal flow, which is
            what lets them be measured. */}
        <div
          ref={listRef}
          data-rows
          role="presentation"
          style={{ transform: `translateY(${shown.offsetTop}px)` }}
        >
          {visibleRows}
        </div>
      </div>
    </div>
  )
}

/**
 * Where to scroll so the anchored row sits where it did before the fold.
 *
 * Folding the file the reader is inside takes the anchor row with it, so the
 * search walks back to the nearest row that survived — which is that file's
 * own header, the thing they just collapsed. Null means there is nothing to
 * restore and the caller should leave the scroll alone.
 */
function offsetToRestore(
  virtualizer: Virtualizer,
  folding: Folding,
  anchor: Anchor | null,
): number | null {
  if (anchor === null) return null

  let row = anchor.row
  while (row >= 0 && folding.positionAt(row) === -1) row -= 1
  if (row < 0) return null

  return Math.max(0, virtualizer.offsetOf(folding.positionAt(row)) + anchor.within)
}

function Row({
  rows,
  row,
  folding,
  store,
  onToggleFile,
  onToggleHunk,
}: {
  readonly rows: RowIndex
  readonly row: number
  readonly folding: Folding
  readonly store: HighlightStore
  readonly onToggleFile: (file: number) => void
  readonly onToggleHunk: (ref: HunkRef) => void
}) {
  switch (rows.kindAt(row)) {
    case RowKind.FileHeader: {
      const file = rows.fileIndexAt(row)
      return (
        <FileHeaderRow
          file={rows.fileAt(row)}
          collapsed={folding.isFileCollapsed(file)}
          onToggle={() => {
            onToggleFile(file)
          }}
        />
      )
    }
    case RowKind.Note:
      return <NoteRow file={rows.fileAt(row)} />
    case RowKind.HunkHeader: {
      const ref = { file: rows.fileIndexAt(row), hunk: rows.hunkIndexAt(row) }
      return (
        <HunkHeaderRow
          hunk={rows.hunkAt(row)!}
          collapsed={folding.isHunkCollapsed(ref)}
          onToggle={() => {
            onToggleHunk(ref)
          }}
        />
      )
    }
    default:
      return rows.mode === 'split' ? (
        <SplitDiffRow
          oldLine={rows.cellAt(row, 'old')}
          newLine={rows.cellAt(row, 'new')}
          oldSegments={store.segmentsFor(row, 'old')}
          newSegments={store.segmentsFor(row, 'new')}
        />
      ) : (
        <DiffRow line={rows.lineAt(row)!} segments={store.segmentsFor(row)} />
      )
  }
}

function sameWindow(a: VisibleWindow, b: VisibleWindow): boolean {
  return (
    a.first === b.first &&
    a.last === b.last &&
    a.offsetTop === b.offsetTop &&
    a.totalHeight === b.totalHeight
  )
}
