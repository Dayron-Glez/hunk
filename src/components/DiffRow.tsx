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
          <span className="w-12 shrink-0 pr-2 text-right text-neutral-400 tabular-nums">
            {line.oldNumber}
          </span>
          <span className="w-12 shrink-0 pr-2 text-right text-neutral-400 tabular-nums">
            {line.newNumber}
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
 * Half a row, at half the viewport whatever it holds.
 *
 * A width from the content would make every row's divider land somewhere else,
 * and a width from the widest line in the column would mean measuring lines
 * nobody has scrolled to — the one thing this viewer refuses to do. So the
 * columns are fixed and a long line scrolls inside its own cell. The scrollbar
 * is hidden because a horizontal one is as tall as the row it would sit in.
 */
function SplitCell({
  line,
  segments,
  column,
}: {
  readonly line: DiffLine | null
  readonly segments: readonly Segment[] | null
  readonly column: 'old' | 'new'
}) {
  if (line === null) {
    return (
      <div
        role="gridcell"
        className="w-1/2 shrink-0 border-l-4 border-l-transparent bg-neutral-900/40"
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
      className={`flex w-1/2 shrink-0 ${EDGE_STYLES[line.kind]} ${ROW_STYLES[line.kind]}`}
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
      {/* Chrome makes a scrollable box a tab stop so it can be scrolled by
          keyboard. Here that would put a stop on every long line on screen, in
          a list that rearranges itself as it scrolls — 18 of them in 37 rows on
          a real diff. The grid is the one stop, and its left and right arrows
          pan this instead. */}
      <span
        tabIndex={-1}
        data-pan
        className="min-w-0 flex-1 [scrollbar-width:none] overflow-x-auto whitespace-pre text-neutral-200 outline-none [&::-webkit-scrollbar]:hidden"
      >
        <LineContent line={line} segments={segments} />
        {line.noNewlineAtEof ? (
          <span className="pl-4 text-neutral-500 italic select-none">no newline</span>
        ) : null}
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
