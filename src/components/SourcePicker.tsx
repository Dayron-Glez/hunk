import { useState, type DragEvent } from 'react'

const samples = import.meta.glob<string>('../../fixtures/github/*.diff', {
  query: '?raw',
  import: 'default',
})

const SAMPLE_LABELS: Record<string, string> = {
  'vite-pr-23346-normal.diff': 'An ordinary pull request — 2 files',
  'vite-pr-23378-new-files.diff': 'A pull request that adds files — 10 files',
  'prettier-bb52ae36-rename.diff': 'A rename, plus new files',
  'github-docs-90ce4889-binary-add.diff': 'An added image next to a text change',
  'git-86cfd61e-submodule-add.diff': 'A submodule being added',
  'npm-cli-47fc8b19-mass-rename.diff': '168 files, mostly renames',
  'npm-cli-75a943de-minified-bundle.diff': 'Minified bundles — 371 KB in 128 lines',
  'linux-93e4b307-huge.diff': 'A Linux kernel commit — 758 files, 2.1 MB',
}

const SAMPLE_ORDER = Object.keys(SAMPLE_LABELS)

export function SourcePicker({ onLoad }: { readonly onLoad: (source: string) => void }) {
  const [pasted, setPasted] = useState('')
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault()
    setDragging(false)
    const file = event.dataTransfer.files[0]
    if (file === undefined) return
    void file.text().then(onLoad)
  }

  const loadSample = (name: string): void => {
    const entry = Object.entries(samples).find(([path]) => path.endsWith(`/${name}`))
    if (entry === undefined) return
    setBusy(name)
    void entry[1]().then((text) => {
      setBusy(null)
      onLoad(text)
    })
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <div>
        <h1 className="font-mono text-2xl font-semibold text-neutral-100">hunk</h1>
        <p className="text-sm text-neutral-400">a high-performance diff viewer</p>
      </div>

      <div
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => {
          setDragging(false)
        }}
        onDrop={handleDrop}
        className={`rounded-lg border border-dashed p-8 text-center text-sm transition-colors ${
          dragging
            ? 'border-sky-400 bg-sky-500/10 text-sky-200'
            : 'border-neutral-700 text-neutral-500'
        }`}
      >
        Drop a <code className="font-mono">.diff</code> or <code className="font-mono">.patch</code>{' '}
        here
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="paste" className="text-sm text-neutral-400">
          …or paste one
        </label>
        <textarea
          id="paste"
          value={pasted}
          onChange={(event) => {
            setPasted(event.target.value)
          }}
          rows={6}
          spellCheck={false}
          className="w-full resize-y rounded-lg border border-neutral-800 bg-neutral-900 p-3 font-mono text-xs text-neutral-200 outline-none focus:border-sky-500"
          placeholder="diff --git a/… b/…"
        />
        <button
          type="button"
          disabled={pasted.trim() === ''}
          onClick={() => {
            onLoad(pasted)
          }}
          className="self-start rounded-md bg-sky-600 px-3 py-1.5 text-sm text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          Render it
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm text-neutral-400">…or try one of the real ones</p>
        <ul className="flex flex-col gap-1">
          {SAMPLE_ORDER.map((name) => (
            <li key={name}>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => {
                  loadSample(name)
                }}
                className="w-full rounded-md border border-neutral-800 px-3 py-2 text-left text-sm text-neutral-300 hover:border-neutral-600 hover:bg-neutral-900 disabled:opacity-40"
              >
                {SAMPLE_LABELS[name]}
                {busy === name ? <span className="text-neutral-500"> — loading…</span> : null}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
