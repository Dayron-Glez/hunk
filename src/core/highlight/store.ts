import { pairChangedLines } from '../diff/pairLines'
import { wordDiff, type Range } from '../diff/wordDiff'
import type { RowIndex } from '../layout/rowIndex'
import type { DiffLine } from '../parse/types'
import { languageOf } from './language'
import { mergeSegments, type Segment } from './segments'
import { reconstructSides, sideForLine, type HunkSides } from './sides'
import { spansOf, type FlatTokens, type Span } from './tokens'

/** Anything that can colour a string. The worker client is one; a fake is another. */
export interface Highlighter {
  highlight(lang: string, text: string): Promise<FlatTokens | null>
}

/** No document line corresponds to this hunk line on this side. */
const ABSENT = 0xffffffff

/**
 * Oniguruma's cost per line is not linear. On real minified JavaScript it takes
 * 2 ms at two thousand characters, 19 ms at four thousand and 510 ms at sixty —
 * one such line stalls the queue for every hunk behind it. Past this a line is
 * generated or minified anyway, where colour buys the reader nothing.
 */
const MAX_LINE_LENGTH = 2_000
const MAX_DOCUMENT_CHARS = 200_000
const NEWLINE = String.fromCharCode(10)

export function worthHighlighting(text: string): boolean {
  if (text.length > MAX_DOCUMENT_CHARS) return false
  let lineStart = 0
  for (;;) {
    const next = text.indexOf(NEWLINE, lineStart)
    const end = next === -1 ? text.length : next
    if (end - lineStart > MAX_LINE_LENGTH) return false
    if (next === -1) return true
    lineStart = next + 1
  }
}

interface Entry {
  readonly sides: HunkSides
  /** Hunk line index to document line index, one array per side. */
  readonly oldLines: Uint32Array
  readonly newLines: Uint32Array
  readonly lines: readonly DiffLine[]
  /** Which line replaced which. One cheap scan; no comparing yet. */
  readonly pairs: ReadonlyMap<number, number>
  /** Hunk line index to the parts of it that changed. Filled as rows are drawn. */
  readonly ranges: Map<number, readonly Range[]>
  oldTokens: FlatTokens | null
  newTokens: FlatTokens | null
  done: boolean
}

/**
 * Keeps highlighted hunks, and asks for the ones coming into view.
 *
 * Work is per hunk rather than per row because a grammar needs the lines around
 * a line to colour it, and per file because a hunk is the largest piece of a
 * file a diff actually contains. Results are kept for the life of the diff: a
 * reader scrolls back, and re-colouring what they already saw would spend the
 * budget twice.
 */
export class HighlightStore {
  private readonly rows: RowIndex
  private readonly highlighter: Highlighter
  private readonly onChange: () => void
  private readonly entries = new Map<number, Entry | null>()

  constructor(rows: RowIndex, highlighter: Highlighter, onChange: () => void) {
    this.rows = rows
    this.highlighter = highlighter
    this.onChange = onChange
  }

  /** Start colouring whatever these rows belong to. Returns without waiting. */
  requestRange(first: number, last: number): void {
    const from = Math.max(0, first)
    const to = Math.min(this.rows.length - 1, last)

    let lastKey = -1
    for (let row = from; row <= to; row += 1) {
      const key = this.keyOf(row)
      if (key === -1 || key === lastKey) continue
      lastKey = key
      if (!this.entries.has(key)) this.start(key, row)
    }
  }

  /** Spans for a row, or null while it is unhighlighted — plain text is fine. */
  spansFor(row: number): Span[] | null {
    const key = this.keyOf(row)
    if (key === -1) return null

    const entry = this.entries.get(key)
    if (!entry?.done) return null

    const line = this.rows.lineAt(row)
    const lineIndex = this.rows.lineIndexAt(row)
    if (line === null || lineIndex === -1) return null

    const side = sideForLine(line.kind, entry.sides)
    if (side === null) return null

    const tokens = side === 'old' ? entry.oldTokens : entry.newTokens
    if (tokens === null) return null

    const documentLine = (side === 'old' ? entry.oldLines : entry.newLines)[lineIndex]
    if (documentLine === undefined || documentLine === ABSENT) return null

    return spansOf(tokens, documentLine)
  }

  /**
   * Everything needed to draw one row: its colours and the parts of it that
   * changed, cut so each piece has one of each. Null means plain text.
   */
  segmentsFor(row: number): Segment[] | null {
    const key = this.keyOf(row)
    if (key === -1) return null

    const entry = this.entries.get(key)
    if (entry == null) return null

    const line = this.rows.lineAt(row)
    const lineIndex = this.rows.lineIndexAt(row)
    if (line === null || lineIndex === -1) return null

    const spans = this.spansFor(row)
    const ranges = changesFor(entry, lineIndex)
    if (spans === null && ranges.length === 0) return null

    return mergeSegments(line.content.length, spans, ranges)
  }

  /** Hunks asked for so far, for tests and for the benchmark to report. */
  get requested(): number {
    return this.entries.size
  }

  /** Lines whose intra-line changes have been worked out. For tests. */
  get diffedLines(): number {
    let total = 0
    for (const entry of this.entries.values()) total += entry?.ranges.size ?? 0
    return total
  }

  private keyOf(row: number): number {
    if (row < 0 || row >= this.rows.length) return -1
    const hunkIndex = this.rows.hunkIndexAt(row)
    if (hunkIndex === -1) return -1
    // One number per hunk of the diff, so the map needs no string keys.
    return this.rows.fileIndexAt(row) * 0x10000 + hunkIndex
  }

  private start(key: number, row: number): void {
    const file = this.rows.fileAt(row)
    const hunk = this.rows.hunkAt(row)
    if (hunk === null) {
      this.entries.set(key, null)
      return
    }

    const sides = reconstructSides(hunk)
    const entry: Entry = {
      sides,
      oldLines: reverse(sides.old?.lines, hunk.lines.length),
      newLines: reverse(sides.new?.lines, hunk.lines.length),
      lines: hunk.lines,
      pairs: pairChangedLines(hunk.lines),
      ranges: new Map(),
      oldTokens: null,
      newTokens: null,
      done: false,
    }
    this.entries.set(key, entry)

    // Colour is optional; what changed inside a line is not, so it is found
    // here whether or not a grammar exists for this file.
    const lang = languageOf(file.newPath ?? file.oldPath)
    if (lang === null) {
      entry.done = true
      return
    }

    const ask = (document: { text: string } | null): Promise<FlatTokens | null> =>
      document === null || !worthHighlighting(document.text)
        ? Promise.resolve(null)
        : this.highlighter.highlight(lang, document.text)

    const jobs = [ask(sides.old), ask(sides.new)] as const

    void Promise.all(jobs).then(([oldTokens, newTokens]) => {
      entry.oldTokens = oldTokens
      entry.newTokens = newTokens
      entry.done = true
      this.onChange()
    })
  }
}

function reverse(lines: Uint32Array | undefined, hunkLineCount: number): Uint32Array {
  const out = new Uint32Array(hunkLineCount).fill(ABSENT)
  if (lines === undefined) return out
  for (let documentLine = 0; documentLine < lines.length; documentLine += 1) {
    const hunkLine = lines[documentLine]
    if (hunkLine !== undefined) out[hunkLine] = documentLine
  }
  return out
}

const NO_RANGES: readonly Range[] = []

/**
 * What changed inside one line, worked out the first time it is drawn.
 *
 * Per line rather than per hunk. On this corpus the difference is small — the
 * worst hunk holds 131 pairs and costs 1.2 ms — because large hunks tend to be
 * wholesale additions with nothing to compare. It is per line anyway: the cost
 * of the hunk-at-a-time version scales with input nobody has scrolled to, and
 * that is the shape of cost this viewer exists to avoid. Both sides of a pair
 * are stored together because finding one finds the other.
 */
function changesFor(entry: Entry, lineIndex: number): readonly Range[] {
  const cached = entry.ranges.get(lineIndex)
  if (cached !== undefined) return cached

  const partner = entry.pairs.get(lineIndex)
  if (partner === undefined) {
    entry.ranges.set(lineIndex, NO_RANGES)
    return NO_RANGES
  }

  const isDeletion = entry.lines[lineIndex]?.kind === 'delete'
  const deleted = isDeletion ? lineIndex : partner
  const inserted = isDeletion ? partner : lineIndex

  const changes = wordDiff(
    entry.lines[deleted]?.content ?? '',
    entry.lines[inserted]?.content ?? '',
  )
  entry.ranges.set(deleted, changes.before)
  entry.ranges.set(inserted, changes.after)

  return entry.ranges.get(lineIndex) ?? NO_RANGES
}
