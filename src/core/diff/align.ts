import type { DiffLine } from '../parse/types'
import { pairChangedLines } from './pairLines'

/** No line on this side: the cell is a gap opposite something on the other. */
export const GHOST = -1

export interface AlignedRow {
  /** Index into the hunk's lines for the left cell, or GHOST. */
  readonly old: number
  /** Index into the hunk's lines for the right cell, or GHOST. */
  readonly new: number
}

/**
 * A hunk as rows of two cells, for reading the versions beside each other.
 *
 * This is what keeps the two columns in step. Two panes listening to each
 * other's scroll feed each other events and shiver; here there is one list of
 * rows and one scroll, and a line without a counterpart leaves a gap rather
 * than shifting everything below it out of alignment.
 */
export function alignHunk(lines: readonly DiffLine[]): AlignedRow[] {
  const pairs = pairChangedLines(lines)
  const rows: AlignedRow[] = []
  const taken = new Set<number>()

  for (let i = 0; i < lines.length; i += 1) {
    const kind = lines[i]?.kind
    if (kind === 'context') {
      rows.push({ old: i, new: i })
      continue
    }
    if (kind === 'delete') {
      const partner = pairs.get(i)
      if (partner === undefined) rows.push({ old: i, new: GHOST })
      else {
        rows.push({ old: i, new: partner })
        taken.add(partner)
      }
      continue
    }
    if (kind === 'insert' && !taken.has(i)) rows.push({ old: GHOST, new: i })
  }

  return rows
}
