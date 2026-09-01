import { useMemo, useState } from 'react'
import { DiffView } from './components/DiffView'
import { SourcePicker } from './components/SourcePicker'
import { parseUnifiedDiff } from './core/parse/unified'

export function App() {
  const [source, setSource] = useState<string | null>(null)
  const diff = useMemo(() => (source === null ? null : parseUnifiedDiff(source)), [source])

  if (diff === null) {
    return (
      <main className="min-h-full bg-neutral-950 text-neutral-100">
        <SourcePicker onLoad={setSource} />
      </main>
    )
  }

  return (
    <main className="min-h-full bg-neutral-950 text-neutral-100">
      <div className="flex items-center gap-3 border-b border-neutral-800 px-4 py-2">
        <h1 className="font-mono text-sm font-semibold">hunk</h1>
        <button
          type="button"
          onClick={() => {
            setSource(null)
          }}
          className="ml-auto rounded-md border border-neutral-800 px-2 py-1 text-xs text-neutral-400 hover:border-neutral-600 hover:text-neutral-200"
        >
          Load another
        </button>
      </div>
      <DiffView diff={diff} />
    </main>
  )
}
