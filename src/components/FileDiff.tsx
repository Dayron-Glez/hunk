import type { DiffFile } from '../core/parse/types'
import { DiffRow } from './DiffRow'

const STATUS_STYLES: Record<DiffFile['status'], string> = {
  added: 'bg-emerald-500/15 text-emerald-300',
  deleted: 'bg-rose-500/15 text-rose-300',
  modified: 'bg-sky-500/15 text-sky-300',
  renamed: 'bg-violet-500/15 text-violet-300',
  copied: 'bg-violet-500/15 text-violet-300',
}

export function FileDiff({ file }: { readonly file: DiffFile }) {
  return (
    <section className="overflow-hidden rounded-lg border border-neutral-800">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-neutral-800 bg-neutral-900 px-3 py-2">
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
        <span className="ml-auto font-mono text-xs">
          <span className="text-emerald-400">+{file.additions}</span>{' '}
          <span className="text-rose-400">-{file.deletions}</span>
        </span>
      </header>

      <FileBody file={file} />
    </section>
  )
}

function FileBody({ file }: { readonly file: DiffFile }) {
  const note = describeEmptyBody(file)
  if (note !== null) {
    return <p className="px-3 py-4 text-sm text-neutral-500">{note}</p>
  }

  return (
    <div className="overflow-x-auto bg-neutral-950 font-mono text-xs">
      {file.hunks.map((hunk, index) => (
        <div key={`${hunk.oldStart}:${hunk.newStart}:${index}`}>
          <div className="sticky left-0 bg-sky-500/10 px-3 py-1 text-sky-300/70 select-none">
            @@ -{hunk.oldStart},{hunk.oldCount} +{hunk.newStart},{hunk.newCount} @@
            {hunk.section === '' ? '' : ` ${hunk.section}`}
          </div>
          {hunk.lines.map((line, lineIndex) => (
            <DiffRow key={lineIndex} line={line} />
          ))}
        </div>
      ))}
    </div>
  )
}

function describePath(file: DiffFile): string {
  if (file.oldPath !== null && file.newPath !== null && file.oldPath !== file.newPath) {
    return `${file.oldPath} → ${file.newPath}`
  }
  return file.newPath ?? file.oldPath ?? '(unnamed)'
}

function describeMode(file: DiffFile): string | null {
  if (file.oldMode === null || file.newMode === null) return null
  if (file.oldMode === file.newMode) return null
  return `${file.oldMode} → ${file.newMode}`
}

/** A file can legitimately have no hunks. Say which case it is instead of showing a void. */
function describeEmptyBody(file: DiffFile): string | null {
  if (file.combined) return 'Combined diff from a merge — not supported yet.'
  if (file.binary) return 'Binary file, not shown.'
  if (file.hunks.length > 0) return null
  if (file.submodule) return 'Submodule pointer changed.'
  if (describeMode(file) !== null) return 'Only the file mode changed.'
  if (file.status === 'renamed' || file.status === 'copied') return 'Moved with no content change.'
  return 'No content changes.'
}
