import { useCallback, useState } from 'react'
import { DiffView } from './components/DiffView'
import { SourcePicker } from './components/SourcePicker'
import { useExpansion } from './components/useExpansion'
import type { DiffOrigin } from './core/expand/blobs'
import { parseUnifiedDiff } from './core/parse/unified'
import type { ParsedDiff } from './core/parse/types'

interface Loaded {
  readonly diff: ParsedDiff
  /** Where its files can be fetched, or null for a diff that was pasted. */
  readonly origin: DiffOrigin | null
}

export function App() {
  // State rather than derived from the text: expanding a gap adds lines the
  // diff never had, so the model outlives the bytes it was parsed from.
  const [loaded, setLoaded] = useState<Loaded | null>(null)

  const load = useCallback((source: string, origin: DiffOrigin | null): void => {
    setLoaded({ diff: parseUnifiedDiff(source), origin })
  }, [])

  const onExpanded = useCallback((diff: ParsedDiff): void => {
    setLoaded((current) => (current === null ? null : { ...current, diff }))
  }, [])

  const expansion = useExpansion(loaded?.origin ?? null, loaded?.diff ?? null, onExpanded)

  if (loaded === null) {
    return (
      <main className="min-h-full bg-neutral-950 text-neutral-100">
        <SourcePicker onLoad={load} />
      </main>
    )
  }

  return (
    <main className="flex h-full flex-col bg-neutral-950 text-neutral-100">
      <div className="flex shrink-0 items-center gap-3 border-b border-neutral-800 px-4 py-2">
        <h1 className="font-mono text-sm font-semibold">hunk</h1>
        <button
          type="button"
          onClick={() => {
            setLoaded(null)
          }}
          className="ml-auto rounded-md border border-neutral-800 px-2 py-1 text-xs text-neutral-400 hover:border-neutral-600 hover:text-neutral-200"
        >
          Load another
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <DiffView diff={loaded.diff} expansion={expansion} />
      </div>
    </main>
  )
}
