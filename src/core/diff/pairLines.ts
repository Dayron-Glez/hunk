import type { DiffLine } from '../parse/types'

/**
 * Which removed line each added line replaced, and back again.
 *
 * A diff records a run of deletions and a run of insertions, never which
 * replaced which — that is lost before the file is written. Position within
 * adjacent runs recovers it whenever the edit kept the lines in order. Runs
 * separated by context are left unpaired: lines that far apart are not versions
 * of each other.
 */
export function pairChangedLines(lines: readonly DiffLine[]): ReadonlyMap<number, number> {
  const pairs = new Map<number, number>()

  let index = 0
  while (index < lines.length) {
    if (lines[index]?.kind !== 'delete') {
      index += 1
      continue
    }

    const deletedFrom = index
    while (lines[index]?.kind === 'delete') index += 1
    const insertedFrom = index
    while (lines[index]?.kind === 'insert') index += 1

    const count = Math.min(insertedFrom - deletedFrom, index - insertedFrom)
    for (let i = 0; i < count; i += 1) {
      pairs.set(deletedFrom + i, insertedFrom + i)
      pairs.set(insertedFrom + i, deletedFrom + i)
    }
  }

  return pairs
}
