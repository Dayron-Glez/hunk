import { useState } from 'react'
import type { LayoutMode } from '../core/layout/rowIndex'
import type { ParsedDiff } from '../core/parse/types'
import { VirtualDiff } from './VirtualDiff'

const MODES: readonly { readonly mode: LayoutMode; readonly label: string }[] = [
  { mode: 'unified', label: 'Unified' },
  { mode: 'split', label: 'Split' },
]

export function DiffView({
  diff,
  initialMode = 'unified',
}: {
  readonly diff: ParsedDiff
  /** Which layout to open in. The benchmark uses it to measure a first paint
   *  in either one; a reader's own choice lives in the state below. */
  readonly initialMode?: LayoutMode
}) {
  const [mode, setMode] = useState<LayoutMode>(initialMode)

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

        <div className="ml-auto flex rounded border border-neutral-800" role="group">
          {MODES.map((option) => (
            <button
              key={option.mode}
              type="button"
              onClick={() => {
                setMode(option.mode)
              }}
              aria-pressed={mode === option.mode}
              className={`px-2 py-0.5 first:rounded-l last:rounded-r ${
                mode === option.mode
                  ? 'bg-neutral-800 text-neutral-100'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
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
        <VirtualDiff diff={diff} mode={mode} />
      </div>
    </div>
  )
}
