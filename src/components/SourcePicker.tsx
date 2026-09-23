import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react'
import { pullRequestRef, type DiffOrigin } from '../core/expand/blobs'
import {
  fetchPullRequestDiff,
  parsePullRequestUrl,
  type LoadFailure,
  type PullRequestRef,
} from '../core/source/github'
import { FileDiff, GitPullRequest, Loader2, Upload } from 'lucide-react'
import { cn } from '../lib/utils'
import { Explain } from './Explain'
import { describeFailure } from './loadFailure'
import { Button } from './ui/button'
import { TooltipProvider } from './ui/tooltip'

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

export function SourcePicker({
  onLoad,
  openOnMount = null,
}: {
  readonly onLoad: (source: string, origin: DiffOrigin | null) => void
  /** A pull request the address bar already named, opened without a press. */
  readonly openOnMount?: PullRequestRef | null
}) {
  const [pasted, setPasted] = useState('')
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [url, setUrl] = useState('')
  const [fetching, setFetching] = useState(false)
  const [failure, setFailure] = useState<LoadFailure | null>(null)

  const openRef = (ref: PullRequestRef): void => {
    setFailure(null)
    setFetching(true)
    void fetchPullRequestDiff(ref).then((result) => {
      setFetching(false)
      if (result.ok) {
        // Only a diff fetched from a pull request knows where the rest of its
        // files live, which is what lets the reader open the gaps in it.
        onLoad(result.diff, {
          owner: ref.owner,
          repo: ref.repo,
          ref: pullRequestRef(ref.number),
        })
      } else setFailure(result.failure)
    })
  }

  const openPullRequest = (event: FormEvent): void => {
    event.preventDefault()
    if (fetching) return

    const ref = parsePullRequestUrl(url)
    if (ref === null) {
      setFailure({ kind: 'unreadable', input: url })
      return
    }
    openRef(ref)
  }

  // A link straight to a pull request opens it without a press. Once: going
  // back to the picker from one should leave the reader on the picker.
  const opened = useRef(false)
  useEffect(() => {
    if (openOnMount === null || opened.current) return
    opened.current = true
    setUrl(`github.com/${openOnMount.owner}/${openOnMount.repo}/pull/${openOnMount.number}`)
    openRef(openOnMount)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on the ref it was given
  }, [openOnMount])

  /** A dropped file and a chosen one are the same thing once it is in hand. */
  const readFile = (file: File | undefined): void => {
    if (file === undefined) return
    void file.text().then((text) => {
      onLoad(text, null)
    })
  }

  const handleDrop = (event: DragEvent<HTMLLabelElement>): void => {
    event.preventDefault()
    setDragging(false)
    readFile(event.dataTransfer.files[0])
  }

  const loadSample = (name: string): void => {
    const entry = Object.entries(samples).find(([path]) => path.endsWith(`/${name}`))
    if (entry === undefined) return
    setBusy(name)
    void entry[1]().then((text) => {
      setBusy(null)
      onLoad(text, null)
    })
  }

  return (
    <TooltipProvider>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
        <div className="flex items-center gap-3">
          <FileDiff aria-hidden className="size-7 text-sky-500" />
          <div>
            <h1 className="font-mono text-2xl font-semibold text-neutral-100">hunk</h1>
            <p className="text-sm text-neutral-400">a high-performance diff viewer</p>
          </div>
        </div>

        <form onSubmit={openPullRequest} className="flex flex-col gap-2">
          <label htmlFor="pr-url" className="flex items-center gap-2 text-sm text-neutral-400">
            <GitPullRequest aria-hidden className="size-4" />
            Paste a pull request link
          </label>
          <div className="flex gap-2">
            <input
              id="pr-url"
              type="text"
              inputMode="url"
              spellCheck={false}
              value={url}
              onChange={(event) => {
                setUrl(event.target.value)
                setFailure(null)
              }}
              placeholder="github.com/owner/repo/pull/123"
              aria-describedby={failure === null ? 'pr-limit' : 'pr-failure'}
              aria-invalid={failure !== null}
              className="min-w-0 flex-1 rounded-md border border-neutral-800 bg-neutral-900 px-3 py-1.5 font-mono text-xs text-neutral-200 outline-none placeholder:text-neutral-400 focus:border-sky-500"
            />
            <Button type="submit" variant="primary" disabled={url.trim() === '' || fetching}>
              {/* Both labels share one grid cell, so the button is always as
                  wide as the longer of them. Swapping the text instead made
                  the button grow and the field beside it shrink mid-request,
                  which moved the text the reader had just typed. */}
              <span className="grid place-items-center">
                <span
                  className={cn('col-start-1 row-start-1', fetching && 'invisible')}
                  aria-hidden={fetching}
                >
                  Read it
                </span>
                <span
                  className={cn(
                    'col-start-1 row-start-1 flex items-center gap-1.5',
                    !fetching && 'invisible',
                  )}
                  aria-hidden={!fetching}
                >
                  {/* Only where motion is welcome. The word carries the state
                      on its own, so a still icon loses nothing. */}
                  <Loader2 aria-hidden className="size-4 motion-safe:animate-spin" />
                  Reading…
                </span>
              </span>
            </Button>
          </div>
          {failure === null ? (
            <Explain
              side="bottom"
              text="hunk asks GitHub for the diff from your browser. Without an account GitHub allows sixty of those an hour, and it will not hand over anything from a private repository. Dropping a .diff file needs neither."
            >
              <p
                id="pr-limit"
                className="w-fit cursor-help text-xs text-neutral-400 underline decoration-dotted underline-offset-4"
              >
                Public repositories only, through GitHub&rsquo;s API — sixty requests an hour
                without an account.
              </p>
            </Explain>
          ) : (
            <p id="pr-failure" role="alert" className="text-xs text-amber-200/90">
              {describeFailure(failure)}
            </p>
          )}
        </form>

        {/*
          A label rather than a div: dropping a file was the only way in, and
          a reader who would rather pick one — or who is on a keyboard, where
          there is no dragging at all — had nothing to press. The input it
          wraps is the control; `focus-within` is what shows the ring, since
          the input itself is out of sight.
        */}
        <label
          htmlFor="diff-file"
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => {
            setDragging(false)
          }}
          onDrop={handleDrop}
          className={cn(
            'flex cursor-pointer flex-col items-center gap-1 rounded-lg border border-dashed p-8',
            'text-center text-sm transition-colors focus-within:border-sky-400',
            'focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-sky-400',
            dragging
              ? 'border-sky-400 bg-sky-500/10 text-sky-200'
              : 'border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-neutral-300',
          )}
        >
          <input
            id="diff-file"
            type="file"
            accept=".diff,.patch,text/plain"
            className="sr-only"
            onChange={(event) => {
              readFile(event.target.files?.[0])
              // Cleared, so choosing the same file twice in a row still fires.
              event.target.value = ''
            }}
          />
          <Upload aria-hidden className="size-5" />
          <span>
            Drop a <code className="font-mono">.diff</code> or{' '}
            <code className="font-mono">.patch</code> here
          </span>
          <span className="text-xs text-neutral-400">or choose a file</span>
        </label>

        <div className="flex flex-col gap-2">
          <label htmlFor="paste" className="text-sm text-neutral-400">
            …or paste a diff
          </label>
          <textarea
            id="paste"
            value={pasted}
            onChange={(event) => {
              setPasted(event.target.value)
            }}
            rows={6}
            spellCheck={false}
            className="w-full resize-y rounded-lg border border-neutral-800 bg-neutral-900 p-3 font-mono text-xs text-neutral-200 outline-none placeholder:text-neutral-400 focus:border-sky-500"
            placeholder="diff --git a/… b/…"
          />
          <button
            type="button"
            disabled={pasted.trim() === ''}
            onClick={() => {
              onLoad(pasted, null)
            }}
            className="self-start rounded-md bg-sky-700 px-3 py-1.5 text-sm text-white disabled:cursor-not-allowed disabled:opacity-40"
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
                  {busy === name ? <span className="text-neutral-400"> — loading…</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </TooltipProvider>
  )
}
