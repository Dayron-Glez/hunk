import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { RowIndex, RowKind } from '../core/layout/rowIndex'
import { Virtualizer, type VisibleWindow } from '../core/layout/virtualizer'
import type { ParsedDiff } from '../core/parse/types'
import { DiffRow } from './DiffRow'
import { FileHeaderRow, HunkHeaderRow, NoteRow } from './rows'

/** Starting points only — every row that reaches the screen is measured. They
 *  keep the scrollbar roughly right on the first frame. */
const ESTIMATED_HEIGHT: Record<RowKind, number> = {
  [RowKind.FileHeader]: 37,
  [RowKind.Note]: 52,
  [RowKind.HunkHeader]: 24,
  [RowKind.Line]: 20,
}

/** Rendered beyond the viewport, so small scrolls need no new rows. */
const OVERSCAN_PX = 600

export function VirtualDiff({ diff }: { readonly diff: ParsedDiff }) {
  const rows = useMemo(() => new RowIndex(diff), [diff])

  const virtualizer = useMemo(() => {
    const estimates = new Float64Array(rows.length)
    for (let row = 0; row < rows.length; row += 1) {
      estimates[row] = ESTIMATED_HEIGHT[rows.kindAt(row)]
    }
    return new Virtualizer(estimates, OVERSCAN_PX)
  }, [rows])

  const scrollerRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  // Cached: reading layout inside a scroll handler can force the browser to
  // flush pending work at the worst possible moment.
  const viewportHeight = useRef(0)

  const [view, setView] = useState<VisibleWindow>(() => virtualizer.visible)

  const refresh = useCallback(() => {
    const scroller = scrollerRef.current
    if (scroller === null) return
    virtualizer.setViewport(scroller.scrollTop, viewportHeight.current)
    const next = virtualizer.visible
    setView((current) => (sameWindow(current, next) ? current : next))
  }, [virtualizer])

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

    if (viewportHeight.current === 0) viewportHeight.current = scroller.clientHeight

    const children = list.children
    for (let i = 0; i < children.length; i += 1) {
      const element = children[i]
      if (element === undefined) continue
      // Not offsetHeight: it rounds to whole pixels, and rounding a hundred
      // thousand rows drifts the document by more than a screenful.
      virtualizer.measure(view.first + i, element.getBoundingClientRect().height)
    }

    const correction = virtualizer.takeScrollCorrection()
    if (correction !== 0) scroller.scrollTop += correction

    virtualizer.setViewport(scroller.scrollTop, viewportHeight.current)
    const next = virtualizer.visible
    setView((current) => (sameWindow(current, next) ? current : next))
  }, [virtualizer, view])

  useEffect(() => {
    const scroller = scrollerRef.current
    if (scroller === null) return

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry === undefined) return
      viewportHeight.current = entry.contentRect.height
      refresh()
    })
    observer.observe(scroller)
    return () => {
      observer.disconnect()
    }
  }, [refresh])

  const visibleRows = []
  for (let row = view.first; row <= view.last; row += 1) {
    visibleRows.push(<Row key={row} rows={rows} row={row} />)
  }

  return (
    <div
      ref={scrollerRef}
      onScroll={refresh}
      className="h-full overflow-auto bg-neutral-950 font-mono text-xs"
      data-testid="diff-scroller"
    >
      {/* Sized for the whole document, so the reader can scroll to rows that
          are not in the DOM yet. */}
      <div style={{ height: view.totalHeight }} className="relative">
        {/* One transform for the block: rows stay in normal flow, which is
            what lets them be measured. */}
        <div ref={listRef} data-rows style={{ transform: `translateY(${view.offsetTop}px)` }}>
          {visibleRows}
        </div>
      </div>
    </div>
  )
}

function Row({ rows, row }: { readonly rows: RowIndex; readonly row: number }) {
  switch (rows.kindAt(row)) {
    case RowKind.FileHeader:
      return <FileHeaderRow file={rows.fileAt(row)} />
    case RowKind.Note:
      return <NoteRow file={rows.fileAt(row)} />
    case RowKind.HunkHeader:
      return <HunkHeaderRow hunk={rows.hunkAt(row)!} />
    default:
      return <DiffRow line={rows.lineAt(row)!} />
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
