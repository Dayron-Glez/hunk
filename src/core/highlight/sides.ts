import type { Hunk } from '../parse/types'

export type Side = 'old' | 'new'

/** `text` holds one line per entry of `lines`, which indexes into `hunk.lines`. */
export interface SideDocument {
  readonly side: Side
  readonly text: string
  readonly lines: Uint32Array
}

/** Each side is null when the hunk has nothing that needs it. */
export interface HunkSides {
  readonly old: SideDocument | null
  readonly new: SideDocument | null
}

/**
 * Rebuild the two source documents a hunk describes.
 *
 * A diff is not source, so it cannot be highlighted as it stands: old and new
 * lines are interleaved and a grammar carries state across the seam. A deleted
 * line opening a template literal that the added line closes with a quote
 * leaves everything below it coloured as string. A side is skipped when nothing
 * needs it.
 */
export function reconstructSides(hunk: Hunk): HunkSides {
  let hasDelete = false
  let hasInsert = false
  for (const line of hunk.lines) {
    if (line.kind === 'delete') hasDelete = true
    else if (line.kind === 'insert') hasInsert = true
  }

  return {
    old: hasDelete ? build(hunk, 'old') : null,
    new: hasInsert || !hasDelete ? build(hunk, 'new') : null,
  }
}

/** Which side's tokens a row should use, given what the hunk produced. */
export function sideForLine(kind: Hunk['lines'][number]['kind'], sides: HunkSides): Side | null {
  if (kind === 'delete') return sides.old === null ? null : 'old'
  if (sides.new !== null) return 'new'
  return sides.old === null ? null : 'old'
}

function build(hunk: Hunk, side: Side): SideDocument {
  const excluded = side === 'old' ? 'insert' : 'delete'
  const text: string[] = []
  const lines: number[] = []

  for (let i = 0; i < hunk.lines.length; i += 1) {
    const line = hunk.lines[i]
    if (line === undefined || line.kind === excluded) continue
    text.push(line.content)
    lines.push(i)
  }

  return { side, text: text.join('\n'), lines: Uint32Array.from(lines) }
}
