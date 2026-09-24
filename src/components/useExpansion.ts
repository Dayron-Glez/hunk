import { useCallback, useMemo, useState } from 'react'
import { BlobStore, describeBlobFailure, type DiffOrigin } from '../core/expand/blobs'
import { expandInDiff, fileMatchesDiff, type Direction, type Gap } from '../core/expand/gaps'
import type { ParsedDiff } from '../core/parse/types'
import type { Expansion } from './VirtualDiff'
import type { GapState } from './rows'

/** Unchanged lines one press of an arrow brings back. */
const CHUNK = 20

/**
 * Fetching what a diff left out, and putting it back.
 *
 * Only for a diff that came from a pull request: a pasted file says nothing
 * about where its lines could be found. `origin` being null is what turns the
 * whole feature off, down to the rows that would have offered it.
 */
export function useExpansion(
  origin: DiffOrigin | null,
  diff: ParsedDiff | null,
  onExpanded: (diff: ParsedDiff) => void,
  fetchImpl?: typeof fetch,
  token: string | null = null,
): Expansion | null {
  const store = useMemo(
    () => (origin === null ? null : new BlobStore(origin, fetchImpl, token)),
    [origin, fetchImpl, token],
  )
  const [states, setStates] = useState<ReadonlyMap<string, GapState>>(new Map())

  const stateOf = useCallback(
    (fileIndex: number, gap: Gap): GapState => states.get(keyOf(fileIndex, gap)) ?? 'idle',
    [states],
  )

  const expand = useCallback(
    (fileIndex: number, gap: Gap, direction: Direction) => {
      if (store === null || diff === null) return
      const file = diff.files[fileIndex]
      const path = file?.newPath
      if (file === undefined || path === undefined || path === null) return

      const key = keyOf(fileIndex, gap)
      if (states.get(key) === 'loading') return
      setStates((current) => replace(current, key, 'loading'))

      void store.linesOf(path).then((result) => {
        if (!result.ok) {
          setStates((current) =>
            replace(current, key, { error: describeBlobFailure(result.failure) }),
          )
          return
        }

        // The file is fetched at the pull request's head, which moves. If it
        // has, its lines no longer sit where this diff says they do, and
        // showing them would be worse than showing nothing.
        if (!fileMatchesDiff(file, result.lines)) {
          setStates((current) =>
            replace(current, key, {
              error: 'This file has changed since the diff was loaded. Reload the pull request.',
            }),
          )
          return
        }

        setStates((current) => without(current, key))
        onExpanded(expandInDiff(diff, fileIndex, gap, result.lines, direction, CHUNK))
      })
    },
    [store, diff, states, onExpanded],
  )

  return useMemo(() => (store === null ? null : { stateOf, expand }), [store, stateOf, expand])
}

/** A gap is named by its file and where it starts, which outlives an index:
 *  expanding renumbers the hunks around it. */
function keyOf(fileIndex: number, gap: Gap): string {
  return `${fileIndex}:${gap.newFrom}`
}

function replace(
  current: ReadonlyMap<string, GapState>,
  key: string,
  state: GapState,
): ReadonlyMap<string, GapState> {
  const next = new Map(current)
  next.set(key, state)
  return next
}

function without(
  current: ReadonlyMap<string, GapState>,
  key: string,
): ReadonlyMap<string, GapState> {
  const next = new Map(current)
  next.delete(key)
  return next
}
