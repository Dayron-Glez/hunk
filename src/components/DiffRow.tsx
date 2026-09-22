import type { CSSProperties } from 'react'
import type { Segment } from '../core/highlight/segments'
import type { DiffLine } from '../core/parse/types'

const ROW_STYLES: Record<DiffLine['kind'], string> = {
  context: 'bg-transparent',
  insert: 'bg-emerald-500/10',
  delete: 'bg-rose-500/10',
}

const MARKERS: Record<DiffLine['kind'], string> = {
  context: ' ',
  insert: '+',
  delete: '-',
}

const MARKER_STYLES: Record<DiffLine['kind'], string> = {
  context: 'text-neutral-600',
  insert: 'text-emerald-400',
  delete: 'text-rose-400',
}

const CHANGED_STYLES: Record<DiffLine['kind'], string> = {
  context: '',
  insert: 'bg-emerald-400/25 rounded-[2px]',
  delete: 'bg-rose-400/25 rounded-[2px]',
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
      {/* Sticky so the numbers stay put while a long line scrolls, and unselectable
          so copying a block of the diff yields code rather than code plus gutters. */}
      <div
        className={`sticky left-0 z-10 flex select-none ${ROW_STYLES[line.kind]} bg-neutral-950`}
        aria-hidden
      >
        <span className="w-12 shrink-0 pr-2 text-right text-neutral-600 tabular-nums">
          {line.oldNumber}
        </span>
        <span className="w-12 shrink-0 pr-2 text-right text-neutral-600 tabular-nums">
          {line.newNumber}
        </span>
        <span className={`w-4 shrink-0 text-center ${MARKER_STYLES[line.kind]}`}>
          {MARKERS[line.kind]}
        </span>
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
  const edge = column === 'old' ? 'border-r border-neutral-800' : ''

  if (line === null) {
    return <div role="gridcell" className={`w-1/2 shrink-0 bg-neutral-900/40 ${edge}`} />
  }

  return (
    <div role="gridcell" className={`flex w-1/2 shrink-0 ${ROW_STYLES[line.kind]} ${edge}`}>
      <span
        className="w-12 shrink-0 pr-2 text-right text-neutral-600 tabular-nums select-none"
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
      <span className="min-w-0 flex-1 [scrollbar-width:none] overflow-x-auto whitespace-pre text-neutral-200 [&::-webkit-scrollbar]:hidden">
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
