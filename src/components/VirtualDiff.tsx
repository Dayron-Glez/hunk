import {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { HighlightCache, HighlightStore } from '../core/highlight/store'
import type { Direction, Gap } from '../core/expand/gaps'
import { sizeOf } from '../core/expand/gaps'
import { EXPAND_BY, Folding, type HunkRef } from '../core/layout/folding'
import { MeasuredHeights } from '../core/layout/measuredHeights'
import { DEFAULT_RATIO, clampPan, readRatios, withRatio, writeRatios } from '../core/layout/panes'
import { onScreen } from '../core/layout/sticky'
import { BAR_HEIGHT, ColumnScrollbars } from './ColumnScrollbars'
import { PaneDivider } from './PaneDivider'
import { describePath } from './fileSummary'
import { moveFrom, startingPosition, type Move } from '../core/layout/navigation'
import { RowIndex, RowKind, type LayoutMode } from '../core/layout/rowIndex'
import { Virtualizer, type VisibleWindow } from '../core/layout/virtualizer'
import type { ParsedDiff } from '../core/parse/types'
import { HighlightClient } from '../workers/highlightClient'
import { DiffRow, SplitDiffRow } from './DiffRow'
import { RowHints } from './RowHints'
import { ExpanderRow, FileHeaderRow, GapRow, HunkHeaderRow, NoteRow, type GapState } from './rows'

/** Starting points only — every row that reaches the screen is measured. They
 *  keep the scrollbar roughly right on the first frame. */
const ESTIMATED_HEIGHT: Record<RowKind, number> = {
  [RowKind.FileHeader]: 54,
  [RowKind.Note]: 52,
  [RowKind.HunkHeader]: 32,
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

/** Unchanged lines one press of an arrow on a gap brings back. */
const CONTEXT_LINES = 20

/** Fetching the lines a diff left out, when the diff came from somewhere they
 *  can be fetched from. Null for a diff that was pasted or dropped. */
export interface Expansion {
  readonly stateOf: (fileIndex: number, gap: Gap) => GapState
  readonly expand: (fileIndex: number, gap: Gap, direction: Direction) => void
}

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
  expansion = null,
}: {
  readonly diff: ParsedDiff
  readonly mode?: LayoutMode
  readonly expansion?: Expansion | null
}) {
  // Rebuilt on a mode change rather than kept for both: the second index costs
  // 10 ms on the kernel commit, and holding it costs 1 MB for as long as the
  // reader stays in the mode that does not use it.
  // Whether gaps can be opened, not who opens them. The expansion object is
  // rebuilt whenever a gap starts or stops fetching, and depending on it here
  // rebuilt the index — and everything under it — twice per click.
  const expandable = expansion !== null
  const rows = useMemo(() => new RowIndex(diff, mode, expandable), [diff, mode, expandable])

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
  const panStyleRef = useRef<HTMLStyleElement>(null)

  /**
   * How wide each file's columns are: the widest row of that file that has
   * been rendered, not its widest row. This viewer will not measure lines
   * nobody has scrolled to, so the bars change size as the reader moves down.
   * Stated in ColumnScrollbars and in the README rather than engineered
   * around.
   */
  const [columnWidths, setColumnWidths] = useState<
    ReadonlyMap<number, { old: number; new: number }>
  >(() => new Map())

  /**
   * The file being read: the one whose header is pinned above the view.
   *
   * State, but it only changes when the reader crosses into another file, so
   * it costs a render then and nothing on the scrolls in between.
   */
  const [currentFile, setCurrentFile] = useState(0)

  /** Bumped when the view changes width, so the rows that reflow at the new
   *  one are measured again rather than placed against the old height. */
  const [remeasure, setRemeasure] = useState(0)
  const lastWidth = useRef(0)

  /**
   * Where each file's columns have been panned to.
   *
   * Written into one stylesheet rather than onto the rows. A file has no box
   * of its own to carry a property — its rows are not wrapped in anything,
   * because the virtualizer measures the list's children one row deep — so
   * the alternative was a loop over the rows of that file on every frame of a
   * pan. One rule per file in one text node is a single write, and the
   * browser was going to recalculate those rows' style either way.
   */
  const pans = useRef(new Map<number, { old: number; new: number }>())

  /**
   * Where each file's rows sit, for the strip held against the bottom of them.
   *
   * A ref and not state: the strips move on every scroll, and putting that
   * through React would re-render the whole window for a scroll that did not
   * change which rows are on it. Filled after the measuring pass, never
   * before — the offsets it reads change as rows are measured, and a strip
   * placed against the older ones chases rows that have already moved.
   */
  const blocks = useRef<{ file: number; top: number; bottom: number }[]>([])

  /** Move the strips, writing straight onto them: one transform per file on
   *  screen, which is a handful, and no render. */
  const placeStrips = useCallback((): void => {
    const scroller = scrollerRef.current
    if (scroller === null) return
    const viewport = { scrollTop: scroller.scrollTop, height: scroller.clientHeight }
    for (const block of blocks.current) {
      const strip = document.querySelector<HTMLElement>(`[data-bars="${String(block.file)}"]`)
      if (strip === null) continue
      const visible = onScreen(block, viewport)
      strip.style.visibility = visible ? 'visible' : 'hidden'
      if (!visible) continue
      // Anchored to the view, not to the document. The strip lives inside the
      // scrolled content, whose width is the widest row rather than the
      // width of the view — a file header is `w-max` and can run past the
      // right edge — so left to itself the bar came out wider than the column
      // it scrolls, with a thumb to match.
      strip.style.width = `${String(scroller.clientWidth)}px`
      // At the end of its own file, never held against the bottom of the
      // view. Held there it sat flush with the edge of the window and its two
      // halves spanned the whole width, which reads as one bar belonging to
      // the viewer rather than as this file's. The cost is that a file taller
      // than the view shows no bar until the reader reaches its end.
      strip.style.transform = `translate(${String(scroller.scrollLeft)}px, ${String(block.bottom - BAR_HEIGHT)}px)`
    }
  }, [])

  const writePans = useCallback((): void => {
    const style = panStyleRef.current
    if (style === null) return
    let text = ''
    for (const [at, pan] of pans.current) {
      text += `[data-file="${String(at)}"]{--hunk-pan-old:${String(pan.old)}px;--hunk-pan-new:${String(pan.new)}px}`
    }
    style.textContent = text
  }, [])

  /**
   * Put every bar of a file where that file is panned to.
   *
   * There can be two: the header of the file being read is pinned above the
   * view as a copy, and that copy carries bars of its own. Writing a
   * scrollLeft that is already right is a no-op, so this never fights the bar
   * the reader is dragging.
   */
  const alignBars = useCallback((file: number): void => {
    const pan = pans.current.get(file) ?? { old: 0, new: 0 }
    for (const strip of document.querySelectorAll(`[data-bars="${String(file)}"]`)) {
      for (const bar of strip.querySelectorAll<HTMLElement>('[data-bar]')) {
        const to = bar.dataset.bar === 'old' ? pan.old : pan.new
        if (bar.scrollLeft !== to) bar.scrollLeft = to
      }
    }
  }, [])

  const syncPan = useCallback(
    (file: number, column: 'old' | 'new', scrollLeft: number): void => {
      const pan = pans.current.get(file) ?? { old: 0, new: 0 }
      if (pan[column] === scrollLeft) return
      pans.current.set(file, { ...pan, [column]: scrollLeft })
      writePans()
      alignBars(file)
    },
    [writePans, alignBars],
  )

  /**
   * How the two columns share the view, per file.
   *
   * Per file and not once for the whole diff because the lines in one file
   * are not the lines in the next, and a width that suits a lockfile does not
   * suit a header. The cost is that the seam moves as the reader crosses a
   * file boundary; the gain is that each file can be read at the width it
   * needs.
   *
   * Only what the reader has moved is kept, keyed by path and remembered
   * across reloads; every other file opens half and half. Moving one file's
   * divider moves that file's, which is the whole point — a single remembered
   * width would be written by every drag and would take every untouched file
   * with it.
   *
   * Nothing is re-measured when any of this changes, and nothing needs to be.
   * A row's height here does not depend on its width: the line rows are
   * `whitespace-pre` inside a cell that scrolls, and the full-width rows are
   * `w-max`, which takes the content's own width — so the `flex-wrap` on the
   * file header has no narrower width to wrap at and never fires. Measured at
   * a 375px view, where that header is 558px wide and 50px tall, the same
   * height it has at 1.009px.
   */
  const [ratios, setRatios] = useState(readRatios)

  /** By path rather than by index, so a width outlives the diff it was set in
   *  — the reader is coming back to the same file, not to the same offset. */
  const pathOfFile = useCallback(
    (file: number): string => {
      const found = diff.files[file]
      return found?.newPath ?? found?.oldPath ?? String(file)
    },
    [diff],
  )

  const ratioOf = useCallback(
    (file: number): number => ratios.get(pathOfFile(file)) ?? DEFAULT_RATIO,
    [ratios, pathOfFile],
  )

  const previewRatio = useCallback(
    (file: number, next: number): void => {
      setRatios((current) => withRatio(current, pathOfFile(file), next))
    },
    [pathOfFile],
  )

  const commitRatio = useCallback(
    (file: number, next: number): void => {
      setRatios((current) => {
        const updated = withRatio(current, pathOfFile(file), next)
        writeRatios(updated)
        return updated
      })
    },
    [pathOfFile],
  )

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

  // The worker outlives the row index. It loads Shiki and a grammar when it
  // starts, so throwing it away whenever the document changes — a fold, a
  // layout switch, an opened gap — paid that cost again every time.
  const client = useMemo(() => new HighlightClient(), [])
  useEffect(
    () => () => {
      client.dispose()
    },
    [client],
  )

  // What has been coloured outlives the store too, and for the same reason:
  // the store is tied to a row index, and the index is rebuilt far more often
  // than the hunks change. Keyed by hunk, so only the hunks that really
  // changed are coloured again.
  //
  // For the life of the component, deliberately. `diff` would be the worst
  // possible dependency — it is a new object after every expansion, which is
  // the case this exists to survive — and it needs no other: loading a
  // different diff goes through the picker, which unmounts this.
  const cache = useMemo(() => new HighlightCache(), [])

  // The store itself is tied to the rows it maps.
  const store = useMemo(
    () =>
      new HighlightStore(
        rows,
        client,
        () => {
          setColoured((n) => n + 1)
        },
        cache,
      ),
    [rows, client, cache],
  )

  // Only what is on screen, plus the overscan the window already carries. The
  // store speaks in rows, so the window's positions are translated back.
  const firstRow = folding.rowAt(view.first)
  const lastRow = folding.rowAt(view.last)
  useEffect(() => {
    if (firstRow !== -1 && lastRow !== -1) store.requestRange(firstRow, lastRow)
  }, [store, firstRow, lastRow])

  const refresh = useCallback(() => {
    const scroller = scrollerRef.current
    if (scroller === null) return
    virtualizer.setViewport(scroller.scrollTop, viewportHeight)
    placeStrips()
    // The row at the top of the view, not of the overscan: the pinned header
    // names the file the reader is looking at, not one rendered above it.
    const row = folding.rowAt(virtualizer.anchor)
    if (row !== -1) setCurrentFile(rows.fileIndexAt(row))
    const next = virtualizer.visible
    setView((current) => (sameWindow(current, next) ? current : next))
  }, [virtualizer, viewportHeight, folding, rows, placeStrips])

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

      // Left and right pan the columns of the file being read, which is the
      // file whose bars are pinned above the view. In one column the whole
      // grid scrolls sideways, so the browser's own handling is left alone.
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        const widths = columnWidths.get(currentFile)
        const scroller = scrollerRef.current
        if (widths === undefined || scroller === null) return
        event.preventDefault()
        const by = event.key === 'ArrowRight' ? PAN_PX : -PAN_PX
        const ratio = ratioOf(currentFile)
        const pan = pans.current.get(currentFile) ?? { old: 0, new: 0 }
        pans.current.set(currentFile, {
          old: clampPan(pan.old + by, widths.old, scroller.clientWidth * ratio),
          new: clampPan(pan.new + by, widths.new, scroller.clientWidth * (1 - ratio)),
        })
        writePans()
        alignBars(currentFile)
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
      columnWidths,
      currentFile,
      ratioOf,
      writePans,
      alignBars,
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

    if (mode === 'split') {
      // In the pass that already walks these rows and already forced layout,
      // not on every frame of a pan. Per file, because the bars are per file.
      const widths = new Map<number, { old: number; new: number }>()
      for (const span of list.querySelectorAll<HTMLElement>('[data-col]')) {
        const file = Number(span.closest<HTMLElement>('[data-file]')?.dataset.file ?? -1)
        if (file < 0) continue
        // How far the line runs past the box that clips it, not how wide it
        // is: the numbers and the marker take part of the column, so the two
        // differ by the width of the gutter, and a bar sized by the second
        // one cannot reach the end of the longest line.
        const clip = span.parentElement?.clientWidth ?? 0
        const over = Math.max(0, span.offsetWidth - clip)
        const found = widths.get(file) ?? { old: 0, new: 0 }
        if (span.dataset.col === 'old') found.old = Math.max(found.old, over)
        else found.new = Math.max(found.new, over)
        widths.set(file, found)
      }
      setColumnWidths((current) => (sameWidths(current, widths) ? current : widths))

      // Now that the heights on screen are the measured ones, and not before.
      //
      // Over the lines, not the whole file. A bar scrolls lines, so a file
      // whose header has just appeared at the bottom edge and has not shown a
      // line yet has nothing for one to scroll — and a second bar stacked
      // under the first, for a file the reader has not reached, is what that
      // looked like.
      const found: { file: number; top: number; bottom: number }[] = []
      for (let position = view.first; position <= view.last; position += 1) {
        const row = folding.rowAt(position)
        if (row === -1 || rows.kindAt(row) !== RowKind.Line) continue
        const file = rows.fileIndexAt(row)
        const top = virtualizer.offsetOf(position)
        const bottom = top + virtualizer.heightOf(position)
        const last = found[found.length - 1]
        if (last?.file === file) last.bottom = bottom
        else found.push({ file, top, bottom })
      }
      blocks.current = found
      placeStrips()
    }

    const correction = virtualizer.takeScrollCorrection()
    if (correction !== 0) scroller.scrollTop += correction

    virtualizer.setViewport(scroller.scrollTop, viewportHeight)
    const next = virtualizer.visible
    setView((current) => (sameWindow(current, next) ? current : next))
  }, [
    virtualizer,
    view,
    folding,
    heights,
    layout.restore,
    viewportHeight,
    mode,
    rows,
    placeStrips,
    remeasure,
  ])

  /**
   * Put the bars back where their files are panned to, once the widths have
   * landed.
   *
   * A bar cannot be scrolled past a spacer that has not been widened yet, so
   * an offset applied in the same commit as the width is clamped straight
   * back to nought. Re-applying costs nothing, because `alignBars` only
   * writes a scrollLeft that is wrong.
   */
  useLayoutEffect(() => {
    for (const file of pans.current.keys()) alignBars(file)
  }, [columnWidths, alignBars])

  /**
   * Panning whatever the pointer is over, with a trackpad or with shift.
   *
   * The bars belong to a file, and with two files on screen only one of them
   * is the file being read — so a long line in the other one had no way of
   * moving until the reader scrolled far enough for it to become current. A
   * wheel over a file moves that file, whichever it is.
   *
   * A native listener rather than React's, because stopping the page from
   * scrolling sideways needs `passive: false`, and React attaches wheel
   * handlers as passive.
   */
  useEffect(() => {
    const scroller = scrollerRef.current
    if (scroller === null || mode !== 'split') return

    const onWheel = (event: WheelEvent): void => {
      // A trackpad sends sideways movement as deltaX; a wheel with shift held
      // sends it as deltaY, which is the convention for a mouse with one
      // axis. Anything mostly vertical is left to the scroller.
      const sideways = event.shiftKey && event.deltaX === 0 ? event.deltaY : event.deltaX
      if (sideways === 0) return
      if (!event.shiftKey && Math.abs(sideways) < Math.abs(event.deltaY)) return

      const under = document.elementFromPoint(event.clientX, event.clientY)
      const file = Number(under?.closest<HTMLElement>('[data-file]')?.dataset.file ?? -1)
      if (file < 0) return

      const ratio = ratioOf(file)
      const seam = scroller.getBoundingClientRect().left + scroller.clientWidth * ratio
      const column = event.clientX < seam ? 'old' : 'new'
      const pane = scroller.clientWidth * (column === 'old' ? ratio : 1 - ratio)
      const pan = pans.current.get(file) ?? { old: 0, new: 0 }
      const next = clampPan(pan[column] + sideways, columnWidths.get(file)?.[column] ?? 0, pane)
      if (next === pan[column]) return

      event.preventDefault()
      pans.current.set(file, { ...pan, [column]: next })
      writePans()
      alignBars(file)
    }

    scroller.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      scroller.removeEventListener('wheel', onWheel)
    }
  }, [mode, ratioOf, columnWidths, writePans, alignBars])

  /**
   * Which file the pointer is in, so only that file's bar shows.
   *
   * Written onto the strip rather than held as state: the pointer crosses a
   * file boundary far more often than the window moves, and a render for each
   * crossing is a render for nothing. Only the file that changed is touched,
   * so a pointer moving inside one file costs a `closest` and nothing else.
   */
  useEffect(() => {
    const scroller = scrollerRef.current
    if (scroller === null || mode !== 'split') return
    let near: string | null = null

    const show = (file: string | null): void => {
      if (file === near) return
      near = file
      for (const strip of document.querySelectorAll<HTMLElement>('[data-bars]')) {
        if (strip.dataset.bars === file) strip.dataset.near = ''
        else delete strip.dataset.near
      }
    }

    const onMove = (event: PointerEvent): void => {
      const under = document.elementFromPoint(event.clientX, event.clientY)
      show(under?.closest<HTMLElement>('[data-file]')?.dataset.file ?? null)
    }
    const onLeave = (): void => {
      show(null)
    }

    scroller.addEventListener('pointermove', onMove)
    scroller.addEventListener('pointerleave', onLeave)
    return () => {
      scroller.removeEventListener('pointermove', onMove)
      scroller.removeEventListener('pointerleave', onLeave)
    }
  }, [mode])

  useEffect(() => {
    const scroller = scrollerRef.current
    if (scroller === null) return

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry === undefined) return
      setViewportHeight(entry.contentRect.height)
      /*
        Width as well as height, which it did not watch.

        In two columns a row that spans both is as wide as the view, so the
        `flex-wrap` on a file header finally has a width to wrap at: narrow
        the window and a long path drops onto a second line, which is a row
        whose height changed. Nothing asked it how tall it had become, so
        every row below it was placed against a height measured at a width
        the view no longer had. Only the rows on screen are re-measured — the
        rest are measured when they arrive, as they always were.
      */
      const width = Math.round(entry.contentRect.width)
      if (width !== lastWidth.current) {
        lastWidth.current = width
        setRemeasure((token) => token + 1)
      }
      refresh()
    })
    observer.observe(scroller)
    return () => {
      observer.disconnect()
    }
  }, [refresh])

  const activePosition = activeRow === null ? -1 : folding.positionAt(activeRow)

  const visibleRows = []
  /**
   * Where each file's divider goes, gathered from the same walk that builds
   * the rows.
   *
   * Only over the lines. A file header, a hunk header, a gap and a note are
   * one column wide — there is nothing there for a divider to divide, and a
   * rule drawn through them reads as a line that starts before the file does.
   * So a run breaks at every row that is not a line, which makes "it never
   * crosses a row that has no seam" true by construction rather than true as
   * far as anyone has scrolled.
   *
   * A file with two hunks on screen therefore has two runs. The first one
   * carries the control — the label, the value, the tab stop — and the rest
   * are rules that happen to be draggable, so a reader hears one divider per
   * file and can still grab whichever piece is under the pointer.
   *
   * Clipped to what is on screen on purpose: there are no rows to divide
   * above or below that, and a run per file on screen beats one per row.
   */
  const dividers: { file: number; top: number; height: number; until: number }[] = []
  for (let position = shown.first; position <= shown.last; position += 1) {
    const row = folding.rowAt(position)
    if (row === -1) continue

    const hidden = folding.hiddenAfter(position)
    const ref = { file: rows.fileIndexAt(row), hunk: rows.hunkIndexAt(row) }

    /** The last row this file has, whether or not the next one is on screen. */
    const after = folding.rowAt(position + 1)
    const endsFile = mode === 'split' && (after === -1 || rows.fileIndexAt(after) !== ref.file)

    if (rows.kindAt(row) === RowKind.Line) {
      const top = virtualizer.offsetOf(position)
      const bottom = top + virtualizer.heightOf(position)
      const last = dividers[dividers.length - 1]
      // Only when the previous row was the previous line of the same file:
      // anything else between them is a row with one column, and the run has
      // to stop before it.
      if (last?.file === ref.file && last.until === position - 1) {
        last.height = bottom - last.top
        last.until = position
      } else {
        dividers.push({ file: ref.file, top, height: bottom - top, until: position })
      }
    }

    // One wrapper per position, and the expander shares it, so the height the
    // virtualizer measures covers both and the arithmetic stays one row deep.
    visibleRows.push(
      <div
        key={row}
        id={rowElementId(position)}
        role="row"
        aria-rowindex={position + 1}
        data-file={ref.file}
        className={`${position === activePosition ? ACTIVE_ROW : ''} ${
          // The last row of a file carries the scrollbar's worth of space, so
          // the strip held against the bottom of the file comes to rest on
          // padding rather than on the last line of code. An editor reserves
          // the same room under its own last line, and for the same reason.
          endsFile ? 'pb-3' : ''
        }`}
        // The share this file's columns take, written where a row can inherit
        // it. A prop would have to pass through every row on screen to reach
        // a cell that has no other reason to know what the layout is doing.
        style={{ '--hunk-split': ratioOf(ref.file) } as CSSProperties}
      >
        <Row
          rows={rows}
          row={row}
          folding={folding}
          store={store}
          expansion={expansion}
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
    <div className="flex h-full flex-col">
      {/*
        The header of the file being read, held above the view, with that
        file's scrollbars in it.

        A copy in a strip of its own rather than the row made sticky: the rows
        of a file are not wrapped in anything — the virtualizer measures the
        list's children one row deep — so there is no box for `position:
        sticky` to stick inside. One copy and not one per file on screen,
        because a copy is opaque and a virtualized row has no space to spare:
        a pinned header per file covered a line of every file at once.

        `aria-hidden`, so a reader who cannot see it hears the real header as
        they reach it rather than twice.
      */}
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
        // The same thin bar in the viewer's own greys that the two-column
        // layout gets, rather than whatever the platform draws by default.
        /*
          Sideways in one column only. In two, each column is scrolled by its
          own bar and nothing here has anywhere to go — but `auto` still gave
          the grid a scrollbar of its own across the bottom, and once it is
          there it holds itself up: the bar takes eleven pixels of height, the
          usable width shrinks with it, the content then fits, and
          `scrollWidth > clientWidth` reports false while the bar is still
          drawn. Measuring that was measuring the consequence.
        */
        className={`min-h-0 flex-1 overflow-y-auto ${
          mode === 'split' ? 'overflow-x-hidden' : 'overflow-x-auto'
        } [scrollbar-width:thin] [scrollbar-color:var(--color-neutral-600)_transparent] bg-neutral-950 font-mono text-xs focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sky-400`}
        data-testid="diff-scroller"
        /*
          How wide a row that spans both columns is.

          `max-content` in one column, where the grid itself scrolls sideways
          and a row has to paint across the whole scrolled width. In two it is
          the view, because nothing there scrolls the grid — each column
          scrolls itself — and a header wide enough to overflow gave the grid
          a horizontal scrollbar of its own, a third bar across the bottom
          that scrolled neither column.

          A long path wraps in two columns rather than running off the edge,
          which is what `flex-wrap` on the file header was always for.
        */
        style={{ '--hunk-row': mode === 'split' ? '100%' : 'max-content' } as CSSProperties}
      >
        <div role="status" aria-live="polite" className="sr-only">
          {announcement}
        </div>
        {/* Empty until a column is panned. See `writePans` for why the offsets
          live in a stylesheet rather than on the rows. */}
        <style ref={panStyleRef} />
        {/* Sized for the whole document, so the reader can scroll to rows that
          are not in the DOM yet. */}
        <div role="presentation" style={{ height: shown.totalHeight }} className="relative">
          {mode === 'split'
            ? dividers.map(({ file, top, height }, at) => (
                <PaneDivider
                  key={`${file}:${at}`}
                  ratio={ratioOf(file)}
                  // One announced control per file, however many runs of lines
                  // that file has on screen. The rest still drag.
                  label={
                    dividers.findIndex((run) => run.file === file) === at
                      ? describePath(diff.files[file]!)
                      : null
                  }
                  top={top}
                  height={height}
                  scrollerRef={scrollerRef}
                  onPreview={(next) => {
                    previewRatio(file, next)
                  }}
                  onCommit={(next) => {
                    commitRatio(file, next)
                  }}
                />
              ))
            : null}
          {mode === 'split'
            ? [...new Set(dividers.map((run) => run.file))].map((file) => (
                <ColumnScrollbars
                  key={file}
                  file={file}
                  ratio={ratioOf(file)}
                  widths={columnWidths.get(file) ?? { old: 0, new: 0 }}
                  onScroll={syncPan}
                />
              ))
            : null}
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
        {/* One for all of them: see RowHints for why not one each. */}
        <RowHints containerRef={scrollerRef} />
      </div>
    </div>
  )
}

/** Whether two passes of the width measurement found the same thing, so an
 *  unchanged measurement does not re-render every bar. */
function sameWidths(
  a: ReadonlyMap<number, { old: number; new: number }>,
  b: ReadonlyMap<number, { old: number; new: number }>,
): boolean {
  if (a.size !== b.size) return false
  for (const [file, widths] of b) {
    const found = a.get(file)
    if (found?.old !== widths.old || found.new !== widths.new) return false
  }
  return true
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
  expansion,
  onToggleFile,
  onToggleHunk,
}: {
  readonly rows: RowIndex
  readonly row: number
  readonly folding: Folding
  readonly store: HighlightStore
  readonly expansion: Expansion | null
  readonly onToggleFile: (file: number) => void
  readonly onToggleHunk: (ref: HunkRef) => void
}) {
  switch (rows.kindAt(row)) {
    case RowKind.Gap: {
      const gap = rows.gapAt(row)
      const hidden = gap === null ? null : sizeOf(gap)
      if (gap === null || hidden === null || expansion === null) return null
      const file = rows.fileIndexAt(row)
      return (
        <GapRow
          hidden={hidden}
          chunk={CONTEXT_LINES}
          state={expansion.stateOf(file, gap)}
          hunkAbove={gap.after !== -1}
          hunkBelow={gap.before !== -1}
          onExpand={(direction) => {
            expansion.expand(file, gap, direction)
          }}
        />
      )
    }
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
