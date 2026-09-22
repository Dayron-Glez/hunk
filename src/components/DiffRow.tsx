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
    <div className={`flex min-h-5 w-max min-w-full leading-5 ${ROW_STYLES[line.kind]}`}>
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
        {segments === null
          ? line.content
          : segments.map((segment, index) => (
              <span
                key={index}
                className={segment.changed ? CHANGED_STYLES[line.kind] : undefined}
                style={styleOf(segment)}
              >
                {line.content.slice(segment.start, segment.end)}
              </span>
            ))}
      </span>
      {line.noNewlineAtEof ? (
        <span className="pl-4 text-neutral-500 italic select-none">no newline at end of file</span>
      ) : null}
    </div>
  )
}

function styleOf(segment: Segment): CSSProperties {
  const style: CSSProperties = {}
  if (segment.color !== null) style.color = segment.color
  if (segment.italic) style.fontStyle = 'italic'
  if (segment.bold) style.fontWeight = 'bold'
  if (segment.underline) style.textDecoration = 'underline'
  return style
}
