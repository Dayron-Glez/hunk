import { ArrowLeft, FileDiff } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { DiffView } from './components/DiffView'
import { SourcePicker } from './components/SourcePicker'
import { Button } from './components/ui/button'
import { useExpansion } from './components/useExpansion'
import type { DiffOrigin } from './core/expand/blobs'
import type { PullRequestRef } from './core/source/github'
import { pathOf, routeOf } from './core/source/route'
import { parseUnifiedDiff } from './core/parse/unified'
import type { ParsedDiff } from './core/parse/types'

interface Loaded {
  readonly diff: ParsedDiff
  /** Where its files can be fetched, or null for a diff that was pasted. */
  readonly origin: DiffOrigin | null
}

/** Where this build is served from, which is not always the root. */
const BASE = import.meta.env.BASE_URL

export function App() {
  // State rather than derived from the text: expanding a gap adds lines the
  // diff never had, so the model outlives the bytes it was parsed from.
  const [loaded, setLoaded] = useState<Loaded | null>(null)

  /**
   * The pull request the address bar is asking for, if any.
   *
   * Held as state and refreshed on `popstate`, so going back really goes
   * back: to the picker from a pull request, and to a pull request from
   * whatever followed it.
   */
  const [wanted, setWanted] = useState<PullRequestRef | null>(() => refOf(location.pathname))

  useEffect(() => {
    const onPop = (): void => {
      const ref = refOf(location.pathname)
      setWanted(ref)
      // A diff that was pasted has no path, so coming back to one is coming
      // back to the picker: there is nothing in a URL that could restore it.
      if (ref === null) setLoaded(null)
    }
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
    }
  }, [])

  const load = useCallback((source: string, origin: DiffOrigin | null): void => {
    setLoaded({ diff: parseUnifiedDiff(source), origin })
  }, [])

  const rememberPullRequest = useCallback((ref: PullRequestRef): void => {
    // One entry per pull request, so back leaves it rather than stepping
    // through however many gaps were opened inside it.
    const path = pathOf(ref, BASE)
    if (location.pathname !== path) history.pushState(null, '', path)
    setWanted(ref)
  }, [])

  const onExpanded = useCallback((diff: ParsedDiff): void => {
    setLoaded((current) => (current === null ? null : { ...current, diff }))
  }, [])

  const expansion = useExpansion(loaded?.origin ?? null, loaded?.diff ?? null, onExpanded)

  if (loaded === null) {
    return (
      <main className="min-h-full bg-neutral-950 text-neutral-100">
        <SourcePicker
          openOnMount={wanted}
          onLoad={(source, origin) => {
            const ref = refOfOrigin(origin)
            if (ref !== null) rememberPullRequest(ref)
            // A pasted diff gets an entry of its own at the same path, so
            // back still returns to the picker rather than leaving the page.
            else history.pushState(null, '', location.pathname)
            load(source, origin)
          }}
        />
      </main>
    )
  }

  return (
    <main className="flex h-full flex-col bg-neutral-950 text-neutral-100">
      <div className="flex shrink-0 items-center gap-2 border-b border-neutral-800 px-4 py-2">
        <FileDiff aria-hidden className="size-4 text-sky-500" />
        <h1 className="font-mono text-sm font-semibold">hunk</h1>
        <Button size="sm" className="ml-auto" onClick={() => history.back()}>
          <ArrowLeft aria-hidden className="size-3.5" />
          Load another
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        <DiffView diff={loaded.diff} expansion={expansion} />
      </div>
    </main>
  )
}

function refOf(pathname: string): PullRequestRef | null {
  const route = routeOf(pathname, BASE)
  return route.kind === 'pull-request' ? route.ref : null
}

/** The pull request an origin came from, read back out of its ref. */
function refOfOrigin(origin: DiffOrigin | null): PullRequestRef | null {
  if (origin === null) return null
  const number = /^refs\/pull\/(\d+)\/head$/.exec(origin.ref)?.[1]
  if (number === undefined) return null
  return { owner: origin.owner, repo: origin.repo, number: Number(number) }
}
