import type { ParsedDiff } from '../core/parse/types'
import { VirtualDiff } from './VirtualDiff'

export function DiffView({ diff }: { readonly diff: ParsedDiff }) {
  if (diff.files.length === 0) {
    return <p className="p-6 text-sm text-neutral-500">Nothing to show — this diff is empty.</p>
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-baseline gap-3 px-4 py-2 font-mono text-xs text-neutral-400">
        <span>
          {diff.files.length} {diff.files.length === 1 ? 'file' : 'files'}
        </span>
        <span className="text-emerald-400">+{diff.additions}</span>
        <span className="text-rose-400">-{diff.deletions}</span>
      </div>

      {diff.warnings.length > 0 ? (
        <ul className="mx-4 mb-2 shrink-0 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200/80">
          {diff.warnings.map((warning, index) => (
            <li key={index}>
              line {warning.line}: {warning.message}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="min-h-0 flex-1 border-t border-neutral-800">
        <VirtualDiff diff={diff} />
      </div>
    </div>
  )
}
