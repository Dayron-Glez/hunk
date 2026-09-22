import type { Range } from '../diff/wordDiff'
import type { Span } from './tokens'

export interface Segment {
  readonly start: number
  readonly end: number
  readonly color: string | null
  readonly changed: boolean
  readonly italic: boolean
  readonly bold: boolean
  readonly underline: boolean
}

/**
 * One list of pieces to draw, from two that disagree about where a line
 * divides.
 *
 * Syntax colours and intra-line changes are found independently and overlap
 * however they like: half a token can be new. Cutting the line at every
 * boundary either side knows about is the only split where each piece has one
 * colour and one answer to "did this change".
 */
export function mergeSegments(
  length: number,
  spans: readonly Span[] | null,
  changes: readonly Range[],
): Segment[] {
  if (length === 0) return []

  const cuts = new Set<number>([0, length])
  if (spans !== null) {
    for (const span of spans) {
      if (span.start > 0 && span.start < length) cuts.add(span.start)
      if (span.end > 0 && span.end < length) cuts.add(span.end)
    }
  }
  for (const range of changes) {
    if (range.start > 0 && range.start < length) cuts.add(range.start)
    if (range.end > 0 && range.end < length) cuts.add(range.end)
  }

  const boundaries = [...cuts].sort((a, b) => a - b)
  const segments: Segment[] = []

  let spanIndex = 0
  let rangeIndex = 0

  for (let i = 0; i < boundaries.length - 1; i += 1) {
    const start = boundaries[i]!
    const end = boundaries[i + 1]!

    while (spans !== null && spanIndex < spans.length && spans[spanIndex]!.end <= start) {
      spanIndex += 1
    }
    while (rangeIndex < changes.length && changes[rangeIndex]!.end <= start) {
      rangeIndex += 1
    }

    const span = spans?.[spanIndex]
    const covering = span !== undefined && span.start <= start ? span : null
    const range = changes[rangeIndex]
    const changed = range !== undefined && range.start <= start

    segments.push({
      start,
      end,
      color: covering?.color ?? null,
      changed,
      italic: covering?.italic ?? false,
      bold: covering?.bold ?? false,
      underline: covering?.underline ?? false,
    })
  }

  return segments
}
