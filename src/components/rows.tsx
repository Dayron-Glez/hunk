import type { DiffFile, Hunk } from '../core/parse/types'
import { describeEmptyBody, describeMode, describePath } from './fileSummary'

const STATUS_STYLES: Record<DiffFile['status'], string> = {
  added: 'bg-emerald-500/15 text-emerald-300',
  deleted: 'bg-rose-500/15 text-rose-300',
  modified: 'bg-sky-500/15 text-sky-300',
  renamed: 'bg-violet-500/15 text-violet-300',
  copied: 'bg-violet-500/15 text-violet-300',
}

export function FileHeaderRow({ file }: { readonly file: DiffFile }) {
  return (
    <div className="flex w-max min-w-full flex-wrap items-center gap-x-3 gap-y-1 border-t border-neutral-800 bg-neutral-900 px-3 py-2">
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

export function HunkHeaderRow({ hunk }: { readonly hunk: Hunk }) {
  return (
    <div className="w-max min-w-full bg-sky-500/10 px-3 py-1 font-mono text-xs text-sky-300/70 select-none">
      @@ -{hunk.oldStart},{hunk.oldCount} +{hunk.newStart},{hunk.newCount} @@
      {hunk.section === '' ? '' : ` ${hunk.section}`}
    </div>
  )
}

export function NoteRow({ file }: { readonly file: DiffFile }) {
  return (
    <p className="w-max min-w-full px-3 py-4 text-sm text-neutral-500">{describeEmptyBody(file)}</p>
  )
}
