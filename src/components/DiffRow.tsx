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

export function DiffRow({ line }: { readonly line: DiffLine }) {
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
      <span className="whitespace-pre text-neutral-200">{line.content}</span>
      {line.noNewlineAtEof ? (
        <span className="pl-4 text-neutral-500 italic select-none">no newline at end of file</span>
      ) : null}
    </div>
  )
}
