import type { CSSProperties } from 'react'
import type { Segment } from '../core/highlight/segments'
import type { DiffLine } from '../core/parse/types'

const ROW_STYLES: Record<DiffLine['kind'], string> = {
  context: 'bg-transparent',
  insert: 'bg-diff-added',
  delete: 'bg-diff-removed',
}

/**
 * The bar down the left of a changed line.
 *
 * The tint cannot be made loud enough to carry this on its own: code sits on
 * it, and every step up in the background costs the code contrast it cannot
 * spare. The bar carries no text, so it can be the full ink — six times the
 * page rather than one and a quarter — and it is what a reader actually sees
 * when they glance down a file. A border on an element that already exists,
 * not another one: the row count is the whole point of this viewer.
 */
const EDGE_STYLES: Record<DiffLine['kind'], string> = {
  context: 'border-l-4 border-l-transparent',
  insert: 'border-l-4 border-l-diff-added-ink',
  delete: 'border-l-4 border-l-diff-removed-ink',
}

const MARKERS: Record<DiffLine['kind'], string> = {
  context: ' ',
  insert: '+',
  delete: '-',
}

const MARKER_STYLES: Record<DiffLine['kind'], string> = {
  context: 'text-neutral-600',
  insert: 'text-diff-added-ink',
  delete: 'text-diff-removed-ink',
}

/**
 * What a screen reader hears in place of the gutter.
 *
 * The gutter itself is hidden from them: read literally it is two bare
 * numbers and a punctuation mark. `select-none` keeps this out of the
 * clipboard, so copying a block of the diff still yields code.
 */
function spokenLabel(line: DiffLine, number: number | null): string {
  const where = number === null ? '' : ` ${number}`
  if (line.kind === 'insert') return `Added line${where}.`
  if (line.kind === 'delete') return `Removed line${where}.`
  return `Line${where}.`
}

/**
 * The words that changed inside a changed line.
 *
 * It used to be a second tint laid over the row's: `emerald-400/25` on top of
 * `emerald-500/10`, two shades of the same family stacking into a third
 * nobody chose. One background now, and the difference it can make is small
 * — the mark is only 1.26 times the row it sits in, because anything louder
 * takes the code below 4.5:1.
 *
 * An underline in the edge's ink was tried to make up that difference and
 * taken out again: inside code a horizontal rule under a run of characters
 * reads as a strikethrough or a spell-check squiggle, and the reader has to
 * work out it means neither. The box is quieter and says the right thing.
 */
const CHANGED_STYLES: Record<DiffLine['kind'], string> = {
  context: '',
  insert: 'bg-diff-added-mark rounded-[2px]',
  delete: 'bg-diff-removed-mark rounded-[2px]',
}

export function DiffRow({
  line,
  segments,
}: {
  readonly line: DiffLine
  readonly segments: readonly Segment[] | null
}) {
  return (
    <div
      role="gridcell"
      className={`flex min-h-5 w-max min-w-full leading-5 ${ROW_STYLES[line.kind]}`}
    >
      <span className="sr-only select-none">
        {spokenLabel(line, line.newNumber ?? line.oldNumber)}
      </span>
      {/*
        Sticky so the numbers stay put while a long line scrolls, and
        unselectable so copying a block of the diff yields code rather than
        code plus gutters.

        Two elements, because one cannot hold two backgrounds. Sticky means
        overlapping, so the gutter needs an opaque base or the line slides
        into view underneath it — and the row's tint has to sit on that base
        rather than replace it. Written as one element carrying both classes,
        which of the two won was whichever Tailwind happened to emit last:
        transparent on a context line, the tint on a removal, the base on an
        insertion. Two of the three let the code through and the third lost
        its colour.
      */}
      <div className="sticky left-0 z-10 flex bg-neutral-950" aria-hidden>
        <div className={`flex select-none ${EDGE_STYLES[line.kind]} ${ROW_STYLES[line.kind]}`}>
          {/*
            One number, not two.

            The second column was blank on every line that changed — which is
            the only kind of line a reader came here for — and nothing told
            the two apart: no placeholder, no dimming, just a gap that moved
            from one side to the other depending on what the line was. Read
            down a hunk it interleaved rather than informed.

            The number shown is the one the line has after the change, and
            the one it had before where it no longer exists after. That is
            already what the spoken label says, so the gutter and the screen
            reader now name the same line.
          */}
          <span className="w-12 shrink-0 pr-2 text-right text-neutral-400 tabular-nums">
            {line.newNumber ?? line.oldNumber}
          </span>
          <span className={`w-4 shrink-0 text-center ${MARKER_STYLES[line.kind]}`}>
            {MARKERS[line.kind]}
          </span>
        </div>
      </div>
      <span className="whitespace-pre text-neutral-200">
        <LineContent line={line} segments={segments} />
      </span>
      {line.noNewlineAtEof ? (
        <span className="pl-4 text-neutral-500 italic select-none">no newline at end of file</span>
      ) : null}
    </div>
  )
}

/**
 * One row of the two-column view: the line before on the left, the line after
 * on the right, and a blank cell where a side has nothing.
 *
 * The gap is what the alignment buys. A removal with no replacement leaves the
 * right cell empty rather than pulling every line below it up by one, so the
 * two versions stay level all the way down a file.
 */
export function SplitDiffRow({
  oldLine,
  newLine,
  oldSegments,
  newSegments,
}: {
  readonly oldLine: DiffLine | null
  readonly newLine: DiffLine | null
  readonly oldSegments: readonly Segment[] | null
  readonly newSegments: readonly Segment[] | null
}) {
  return (
    // Presentational: the two cells below are what the grid sees as cells.
    <div role="presentation" className="flex min-h-5 leading-5">
      <SplitCell line={oldLine} segments={oldSegments} column="old" />
      <SplitCell line={newLine} segments={newSegments} column="new" />
    </div>
  )
}

/**
 * Half a row, or whatever share of it the reader has asked for.
 *
 * A width from the content would make every row's divider land somewhere else,
 * and a width from the widest line in the column would mean measuring lines
 * nobody has scrolled to — the one thing this viewer refuses to do. So the
 * columns are set from outside and a long line is clipped by its cell, then
 * moved as part of its whole column by the bar in that file's header.
 *
 * It used to scroll inside its own cell, which made scrolling a per-row
 * affair: moving one long line left the line beneath it where it was.
 *
 * Both properties are written once, on the row. A prop would have to pass
 * through every row on screen to reach a cell that has no other reason to
 * know what the layout is doing, and would re-render all of them on every
 * frame of a drag.
 */
/**
 * What each column takes from the two numbers a row carries: its share of the
 * width, and how far it has been panned. Written with `_` where CSS needs a
 * space, which is how Tailwind spells an arbitrary value.
 */
const OLD_PANE =
  '[--hunk-pane:calc(var(--hunk-split,0.5)*100%)] [--hunk-shift:var(--hunk-pan-old,0px)]'
const NEW_PANE =
  '[--hunk-pane:calc((1_-_var(--hunk-split,0.5))*100%)] [--hunk-shift:var(--hunk-pan-new,0px)]'

function SplitCell({
  line,
  segments,
  column,
}: {
  readonly line: DiffLine | null
  readonly segments: readonly Segment[] | null
  readonly column: 'old' | 'new'
}) {
  // The two shares are written as one number on the grid; this is the half
  // of it each column takes, as a static class rather than a style object
  // that would be rebuilt for every cell on every frame of a drag.
  const share = column === 'old' ? OLD_PANE : NEW_PANE
  if (line === null) {
    return (
      <div
        role="gridcell"
        className={`${share} w-(--hunk-pane) shrink-0 border-l-4 border-l-transparent bg-neutral-900/40`}
      >
        <span className="sr-only select-none">
          {column === 'old' ? 'No line here before.' : 'No line here after.'}
        </span>
      </div>
    )
  }

  return (
    <div
      role="gridcell"
      className={`${share} flex w-(--hunk-pane) shrink-0 ${EDGE_STYLES[line.kind]} ${ROW_STYLES[line.kind]}`}
    >
      <span className="sr-only select-none">
        {spokenLabel(line, column === 'old' ? line.oldNumber : line.newNumber)}
      </span>
      <span
        className="w-12 shrink-0 pr-2 text-right text-neutral-400 tabular-nums select-none"
        aria-hidden
      >
        {column === 'old' ? line.oldNumber : line.newNumber}
      </span>
      <span
        className={`w-4 shrink-0 text-center select-none ${MARKER_STYLES[line.kind]}`}
        aria-hidden
      >
        {MARKERS[line.kind]}
      </span>
      {/*
        Moved rather than scrolled. A scrollable box is a tab stop in Chrome,
        which put one on every long line on screen — 18 in 37 rows on a real
        diff, in a list that rearranges itself as it scrolls — and scrolling
        each cell made panning a per-row affair.

        Two elements, because one cannot both clip and be measured. The outer
        one is the window: it stays where the flex row puts it and cuts the
        line off at its own left edge, which is what keeps a panned line from
        painting over the number and the marker, both of which come earlier in
        the row and so paint underneath. The inner one is the line at its full
        width, which is the width the bar has to report — and a transform does
        not change a layout width, so reading it costs one `offsetWidth` in
        the pass that already measures these rows.
      */}
      <span className="min-w-0 flex-1 overflow-hidden">
        <span
          data-col={column}
          className="block w-max translate-x-[calc(var(--hunk-shift,0px)*-1)] whitespace-pre text-neutral-200"
        >
          <LineContent line={line} segments={segments} />
          {line.noNewlineAtEof ? (
            <span className="pl-4 text-neutral-500 italic select-none">no newline</span>
          ) : null}
        </span>
      </span>
    </div>
  )
}

function LineContent({
  line,
  segments,
}: {
  readonly line: DiffLine
  readonly segments: readonly Segment[] | null
}) {
  if (segments === null) return line.content
  return segments.map((segment, index) => (
    <span
      key={index}
      className={segment.changed ? CHANGED_STYLES[line.kind] : undefined}
      style={styleOf(segment)}
    >
      {line.content.slice(segment.start, segment.end)}
    </span>
  ))
}

function styleOf(segment: Segment): CSSProperties {
  const style: CSSProperties = {}
  if (segment.color !== null) style.color = segment.color
  if (segment.italic) style.fontStyle = 'italic'
  if (segment.bold) style.fontWeight = 'bold'
  if (segment.underline) style.textDecoration = 'underline'
  return style
}
