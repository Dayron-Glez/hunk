import type { DiffFile, Hunk } from '../core/parse/types'
import { describeEmptyBody, describeMode, describePath } from './fileSummary'

/** What each word means, for a reader who has not spent years in git. */
const STATUS_HINTS: Record<DiffFile['status'], string> = {
  added: 'This file did not exist before the change.',
  deleted: 'This file is gone after the change.',
  modified: 'This file exists on both sides and its contents changed.',
  renamed: 'The same file under a different path. Its contents may also have changed.',
  copied: 'A new file made from an existing one, which is still there too.',
}

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
    <div
      role="gridcell"
      className="flex w-max min-w-full flex-wrap items-center gap-x-3 gap-y-1 border-t border-neutral-800 bg-neutral-900 px-3 py-2"
    >
      <Chevron collapsed={collapsed} onToggle={onToggle} label={describePath(file)} />
      <span
        data-hint={STATUS_HINTS[file.status]}
        className={`cursor-help rounded px-1.5 py-0.5 text-[11px] ${STATUS_STYLES[file.status]}`}
      >
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
  const explains =
    `A piece of the file. Before the change it was ${hunk.oldCount} ` +
    `${hunk.oldCount === 1 ? 'line' : 'lines'} starting at line ${hunk.oldStart}; ` +
    `after it, ${hunk.newCount} ${hunk.newCount === 1 ? 'line' : 'lines'} starting at ` +
    `line ${hunk.newStart}.`

  return (
    <div
      role="gridcell"
      className="flex w-max min-w-full items-center gap-2 bg-sky-500/10 px-3 py-1 font-mono text-xs text-sky-300/70"
    >
      <Chevron collapsed={collapsed} onToggle={onToggle} label={range} />
      <span className="cursor-help select-none" data-hint={explains}>
        {range}
        {hunk.section === '' ? '' : ` ${hunk.section}`}
      </span>
    </div>
  )
}

export function NoteRow({ file }: { readonly file: DiffFile }) {
  return (
    <p role="gridcell" className="w-max min-w-full px-3 py-4 text-sm text-neutral-500">
      {describeEmptyBody(file)}
    </p>
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
 *
 * Out of the tab order on purpose. Only the rows on screen exist, so tabbing
 * would walk a list that rearranges itself under the reader as it scrolls,
 * and its length would depend on the viewport. The grid is one tab stop and
 * Enter on the focused row does this, which is the pattern a grid is supposed
 * to follow anyway.
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
      tabIndex={-1}
      onClick={onToggle}
      aria-expanded={!collapsed}
      aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${label}`}
      className="shrink-0 rounded px-1 text-neutral-400 hover:bg-neutral-700/50 hover:text-neutral-200"
    >
      <span aria-hidden className="inline-block w-3 text-center">
        {collapsed ? '›' : '⌄'}
      </span>
    </button>
  )
}

/**
 * What sits under the last row of a hunk that is not being shown in full.
 *
 * Two controls rather than one: a reader working through a long hunk wants
 * the next screenful, and a reader who has decided they need all of it should
 * not have to click ten times to say so. The count is spelled out because
 * "show more" without a number hides how much is being withheld.
 */
export function ExpanderRow({
  hidden,
  chunk,
  onExpand,
  onExpandAll,
}: {
  readonly hidden: number
  readonly chunk: number
  readonly onExpand: () => void
  readonly onExpandAll: () => void
}) {
  const next = Math.min(chunk, hidden)
  return (
    <div
      role="gridcell"
      className="flex w-max min-w-full items-center gap-3 border-y border-neutral-800 bg-neutral-900/60 px-3 py-1.5 text-xs"
    >
      <button
        type="button"
        tabIndex={-1}
        onClick={onExpand}
        className="rounded border border-neutral-700 px-2 py-0.5 text-neutral-300 hover:bg-neutral-700/50"
      >
        Show {next.toLocaleString('en-US')} more {next === 1 ? 'line' : 'lines'}
      </button>
      {hidden > next ? (
        <button
          type="button"
          tabIndex={-1}
          onClick={onExpandAll}
          className="rounded px-2 py-0.5 text-neutral-400 hover:text-neutral-200"
        >
          Show all {hidden.toLocaleString('en-US')}
        </button>
      ) : null}
      <span className="text-neutral-400">
        {hidden.toLocaleString('en-US')} {hidden === 1 ? 'line' : 'lines'} not shown
      </span>
    </div>
  )
}

/** How a gap row is getting on: nothing yet, fetching, or why it failed. */
export type GapState = 'idle' | 'loading' | { readonly error: string }

/**
 * The unchanged lines a diff left out, offered rather than shown.
 *
 * Up and down rather than one control, because which end matters: a reader
 * on the hunk below wants the lines just above it, and a reader on the hunk
 * above wants the ones just below. Opening the whole gap is a third, and its
 * size is on the label, since "expand" without a number hides whether the
 * next click costs twenty lines or two thousand.
 *
 * A gap with a hunk on only one side gets only the arrow that points at it.
 * The other would have to mean "the far end of the gap", which is a stretch
 * of file joined to nothing.
 */
export function GapRow({
  hidden,
  chunk,
  state,
  hunkAbove,
  hunkBelow,
  onExpand,
}: {
  readonly hidden: number
  readonly chunk: number
  readonly state: GapState
  readonly hunkAbove: boolean
  readonly hunkBelow: boolean
  readonly onExpand: (direction: 'up' | 'down' | 'all') => void
}) {
  const step = Math.min(chunk, hidden)
  const busy = state === 'loading'
  const failed = typeof state === 'object'

  return (
    <div
      role="gridcell"
      className="flex w-max min-w-full items-center gap-2 border-y border-neutral-800 bg-sky-500/5 px-3 py-1.5 text-xs"
    >
      {failed ? (
        <span role="alert" className="text-amber-200/90">
          {state.error}
        </span>
      ) : (
        <>
          {hunkBelow ? (
            <button
              type="button"
              tabIndex={-1}
              disabled={busy}
              onClick={() => {
                onExpand('up')
              }}
              data-hint={`Show the ${step} hidden lines just above the piece below.`}
              className="rounded border border-neutral-700 px-2 py-0.5 text-neutral-300 hover:bg-neutral-700/50 disabled:opacity-50"
            >
              ↑ {step}
            </button>
          ) : null}
          {hunkAbove ? (
            <button
              type="button"
              tabIndex={-1}
              disabled={busy}
              onClick={() => {
                onExpand('down')
              }}
              data-hint={`Show the ${step} hidden lines just below the piece above.`}
              className="rounded border border-neutral-700 px-2 py-0.5 text-neutral-300 hover:bg-neutral-700/50 disabled:opacity-50"
            >
              ↓ {step}
            </button>
          ) : null}
          {hidden > step ? (
            <button
              type="button"
              tabIndex={-1}
              disabled={busy}
              onClick={() => {
                onExpand('all')
              }}
              data-hint="Show every hidden line here. The two pieces either side become one."
              className="rounded px-2 py-0.5 text-neutral-400 hover:text-neutral-200 disabled:opacity-50"
            >
              All {hidden.toLocaleString('en-US')}
            </button>
          ) : null}
          <span
            className="cursor-help text-neutral-400"
            data-hint={
              `${hidden.toLocaleString('en-US')} lines here did not change, so the diff ` +
              'does not contain them. Opening this fetches the file from GitHub to show them.'
            }
          >
            {busy
              ? 'Fetching the file…'
              : `${hidden.toLocaleString('en-US')} unchanged ${hidden === 1 ? 'line' : 'lines'}`}
          </span>
        </>
      )}
    </div>
  )
}
