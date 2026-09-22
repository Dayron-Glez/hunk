import type { DiffFile, Hunk } from '../core/parse/types'
import { describeEmptyBody, describeMode, describePath } from './fileSummary'

const STATUS_STYLES: Record<DiffFile['status'], string> = {
  added: 'bg-emerald-500/15 text-emerald-300',
  deleted: 'bg-rose-500/15 text-rose-300',
  modified: 'bg-sky-500/15 text-sky-300',
  renamed: 'bg-violet-500/15 text-violet-300',
  copied: 'bg-violet-500/15 text-violet-300',
}

export function FileHeaderRow({
  file,
  collapsed,
  onToggle,
}: {
  readonly file: DiffFile
  readonly collapsed: boolean
  readonly onToggle: () => void
}) {
  return (
    <div className="flex w-max min-w-full flex-wrap items-center gap-x-3 gap-y-1 border-t border-neutral-800 bg-neutral-900 px-3 py-2">
      <Chevron collapsed={collapsed} onToggle={onToggle} label={describePath(file)} />
      <span className={`rounded px-1.5 py-0.5 text-[11px] ${STATUS_STYLES[file.status]}`}>
        {file.status}
      </span>
      <h2 className="font-mono text-sm break-all text-neutral-200">{describePath(file)}</h2>
      {file.similarity !== null ? (
        <span className="text-xs text-neutral-500">{file.similarity}% similar</span>
      ) : null}
      {describeMode(file) !== null ? (
        <span className="font-mono text-xs text-neutral-500">{describeMode(file)}</span>
      ) : null}
      <span className="ml-auto pl-6 font-mono text-xs">
        <span className="text-emerald-400">+{file.additions}</span>{' '}
        <span className="text-rose-400">-{file.deletions}</span>
      </span>
    </div>
  )
}

export function HunkHeaderRow({
  hunk,
  collapsed,
  onToggle,
}: {
  readonly hunk: Hunk
  readonly collapsed: boolean
  readonly onToggle: () => void
}) {
  const range = `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`
  return (
    <div className="flex w-max min-w-full items-center gap-2 bg-sky-500/10 px-3 py-1 font-mono text-xs text-sky-300/70">
      <Chevron collapsed={collapsed} onToggle={onToggle} label={range} />
      <span className="select-none">
        {range}
        {hunk.section === '' ? '' : ` ${hunk.section}`}
      </span>
    </div>
  )
}

export function NoteRow({ file }: { readonly file: DiffFile }) {
  return (
    <p className="w-max min-w-full px-3 py-4 text-sm text-neutral-500">{describeEmptyBody(file)}</p>
  )
}

/**
 * The fold control.
 *
 * A button rather than a click handler on the whole header: the header holds a
 * path a reader may want to select, and a row that folds when you try to copy
 * from it is worse than one that needs aiming at. The label says what it
 * folds, because "collapse" repeated eight hundred times down a kernel commit
 * tells a screen reader nothing.
 */
function Chevron({
  collapsed,
  onToggle,
  label,
}: {
  readonly collapsed: boolean
  readonly onToggle: () => void
  readonly label: string
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${label}`}
      className="shrink-0 rounded px-1 text-neutral-500 hover:bg-neutral-700/50 hover:text-neutral-200"
    >
      <span aria-hidden className="inline-block w-3 text-center">
        {collapsed ? '›' : '⌄'}
      </span>
    </button>
  )
}
