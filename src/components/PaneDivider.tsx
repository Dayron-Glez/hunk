import { useCallback, useRef, type RefObject } from 'react'
import {
  MAX_RATIO,
  MIN_RATIO,
  clampRatio,
  nudgeRatio,
  ratioAsPercent,
  ratioAt,
} from '../core/layout/panes'

/**
 * The rule between the two columns of one file, and the handle that moves it.
 *
 * One element per file on screen, not a border on every left-hand cell. That
 * was one segment per row of a line one device pixel wide, and rows have
 * fractional heights, so the segments landed on different subpixels and the
 * joins showed: what a reader saw was the border of each row rather than a
 * rule down the file. A file is bounded by the viewport the same way rows
 * are — a handful at a time, however many the diff has.
 *
 * It is a real control rather than a decoration with a drag handler. A reader
 * who cannot use a pointer gets the arrows and `Home`/`End`, and one who
 * cannot see it is told what it is and where it stands. The grid itself is
 * still a single tab stop; this is a second one, which the argument against
 * tab stops inside the grid does not reach — there is exactly one of these
 * and it does not move as the reader scrolls.
 */
export function PaneDivider({
  ratio,
  label,
  top,
  height,
  scrollerRef,
  onPreview,
  onCommit,
}: {
  readonly ratio: number
  /** The file it belongs to, so eight hundred of them are not all "divider".
   *  Null on the second and later runs of the same file: they move the same
   *  width, and announcing each one would read the file out twice. */
  readonly label: string | null
  /** The stretch of the document this file occupies, clipped to what is on
   *  screen — the rest of it has no rows to divide. */
  readonly top: number
  readonly height: number
  readonly scrollerRef: RefObject<HTMLDivElement | null>
  /** While the pointer is down: the layout follows, nothing is stored. */
  readonly onPreview: (ratio: number) => void
  /** On release, or on a key: this is the one worth remembering. */
  readonly onCommit: (ratio: number) => void
}) {
  const dragging = useRef(false)

  const ratioFor = useCallback(
    (clientX: number): number => {
      const scroller = scrollerRef.current
      if (scroller === null) return ratio
      const box = scroller.getBoundingClientRect()
      // `clientWidth` and not the box: a vertical scrollbar takes width the
      // rows never get, and measuring the divider against a width the cells
      // do not have puts it beside the seam rather than on it.
      return ratioAt(clientX, box.left, scroller.clientWidth)
    },
    [ratio, scrollerRef],
  )

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    dragging.current = true
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }, [])

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      if (!dragging.current) return
      onPreview(ratioFor(event.clientX))
    },
    [onPreview, ratioFor],
  )

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      if (!dragging.current) return
      dragging.current = false
      event.currentTarget.releasePointerCapture(event.pointerId)
      onCommit(ratioFor(event.clientX))
    },
    [onCommit, ratioFor],
  )

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>): void => {
      const next = {
        ArrowLeft: () => nudgeRatio(ratio, -1),
        ArrowRight: () => nudgeRatio(ratio, 1),
        Home: () => MIN_RATIO,
        End: () => MAX_RATIO,
      }[event.key]
      if (next === undefined) return
      // The grid below reads the same arrows to move between rows, and a key
      // pressed on the divider was meant for the divider.
      event.preventDefault()
      event.stopPropagation()
      onCommit(next())
    },
    [onCommit, ratio],
  )

  return (
    <div
      role={label === null ? 'presentation' : 'separator'}
      aria-hidden={label === null ? true : undefined}
      aria-orientation={label === null ? undefined : 'vertical'}
      aria-label={label === null ? undefined : `Width of the left column for ${label}`}
      aria-valuenow={label === null ? undefined : ratioAsPercent(ratio)}
      aria-valuemin={label === null ? undefined : ratioAsPercent(MIN_RATIO)}
      aria-valuemax={label === null ? undefined : ratioAsPercent(MAX_RATIO)}
      tabIndex={label === null ? -1 : 0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onKeyDown={onKeyDown}
      style={{ left: `calc(${clampRatio(ratio) * 100}% )`, top, height }}
      /*
        Above the rows: the block they sit in is transformed, which makes it a
        stacking context, and without a z-index of its own the rule paints
        under every tinted cell and shows only where a line is unchanged.

        Wider than it looks. The rule is one pixel, which is right to read and
        impossible to hit, so the target around it is the 24 pixels WCAG asks
        of a pointer target, centred on the seam and otherwise invisible.
      */
      className="group absolute z-20 -ml-3 w-6 cursor-col-resize focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sky-400"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-3 w-px bg-neutral-800 group-hover:w-0.5 group-hover:bg-neutral-500 group-focus-visible:w-0.5 group-focus-visible:bg-sky-400"
      />
    </div>
  )
}
