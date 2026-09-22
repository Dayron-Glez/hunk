import { RowKind, type RowIndex } from './rowIndex'

/** Which file, and which hunk inside it. */
export interface HunkRef {
  readonly file: number
  readonly hunk: number
}

/**
 * Rows past which a hunk is shown behind an expander instead of in full.
 *
 * Not a performance measure — virtualization already made a long hunk cost the
 * same as a short one. It is for getting past one. Across the kernel commit
 * and the mass rename, the median hunk is 11 rows and the 95th is 107, so this
 * fires on 27 hunks out of 2.013 and leaves 98,7% of them untouched. At 300 it
 * would put a quarter of every line behind a click, which in a diff viewer is
 * the wrong trade.
 */
export const LARGE_HUNK = 500

/** Rows one click reveals. Two and a half screens at a time. */
export const EXPAND_BY = 200

/**
 * The rows a reader can currently see, over a row index that never changes.
 *
 * Folding could have been done by rebuilding the index, which costs 4 ms
 * unified and 10 ms in two columns — imperceptible on a click. It is not done
 * that way because the index owns no heights and the tree that does would be
 * rebuilt with estimates, so every fold would jolt the scrollbar. Here the
 * index and the measured heights both survive, and only this projection is
 * rebuilt.
 *
 * Every instance is immutable: a toggle returns a new one. Rebuilding the
 * projection is a single pass over the rows — 4.4 ms for the kernel commit's
 * 64.807 of them, and 2.1 ms to collapse all 758 files at once, because the
 * pass writes fewer of them. Both are inside the frame the click already
 * costs.
 */
export class Folding {
  private readonly rows: RowIndex
  private readonly collapsedFiles: ReadonlySet<number>
  private readonly collapsedHunks: ReadonlySet<number>
  /** Hunks the reader has opened past the default, by rows revealed. */
  private readonly revealed: ReadonlyMap<number, number>
  /** Rows each hunk holds. Counted once per index and passed down the chain. */
  private readonly hunkRows: ReadonlyMap<number, number>
  /** Visible position to row. The whole point of the class. */
  private readonly rowOf: Uint32Array
  /** Row to visible position, or ABSENT where the row is folded away. */
  private readonly positionOfRow: Uint32Array
  /** Rows of the same hunk still hidden after a position, or 0. */
  private readonly hiddenAfterPosition: Uint32Array

  private constructor(
    rows: RowIndex,
    collapsedFiles: ReadonlySet<number>,
    collapsedHunks: ReadonlySet<number>,
    revealed: ReadonlyMap<number, number>,
    hunkRows?: ReadonlyMap<number, number>,
  ) {
    this.rows = rows
    this.collapsedFiles = collapsedFiles
    this.collapsedHunks = collapsedHunks
    this.revealed = revealed
    this.hunkRows = hunkRows ?? countHunkRows(rows)

    const rowOf = new Uint32Array(rows.length)
    const positionOfRow = new Uint32Array(rows.length).fill(ABSENT)
    const hiddenAfterPosition = new Uint32Array(rows.length)

    let count = 0
    // Both reset at each hunk header, so a limit counts rows of this hunk and
    // reads the same whether one line makes a row or two share it.
    let seenInHunk = 0
    let limit = 0

    for (let row = 0; row < rows.length; row += 1) {
      const kind = rows.kindAt(row)

      if (kind === RowKind.HunkHeader) {
        seenInHunk = 0
        limit = this.limitOf(keyOf({ file: rows.fileIndexAt(row), hunk: rows.hunkIndexAt(row) }))
      }

      // Collapse first: a closed file or hunk already says so with its
      // chevron, and an expander under a header nobody opened is noise.
      if (!visible(rows, row, collapsedFiles, collapsedHunks)) continue

      if (kind === RowKind.Line) {
        seenInHunk += 1
        if (seenInHunk > limit) {
          // Past the limit the row is dropped, and the last one shown carries
          // the count, so the reader is told what they are not being shown.
          if (count > 0) hiddenAfterPosition[count - 1] = (hiddenAfterPosition[count - 1] ?? 0) + 1
          continue
        }
      }

      rowOf[count] = row
      positionOfRow[row] = count
      count += 1
    }

    this.rowOf = rowOf.subarray(0, count)
    this.positionOfRow = positionOfRow
    this.hiddenAfterPosition = hiddenAfterPosition.subarray(0, count)
  }

  /**
   * A diff as it is first shown: every file and hunk open, but a hunk past
   * `LARGE_HUNK` truncated. Not the same as everything visible, which is what
   * `expandAll` gives.
   */
  static initial(rows: RowIndex): Folding {
    return new Folding(rows, EMPTY_SET, EMPTY_SET, EMPTY_MAP)
  }

  get length(): number {
    return this.rowOf.length
  }

  /** The row at a visible position, or -1 past the end. */
  rowAt(position: number): number {
    if (!Number.isInteger(position) || position < 0 || position >= this.rowOf.length) return -1
    return this.rowOf[position]!
  }

  /** Where a row sits among the visible ones, or -1 while it is folded away. */
  positionAt(row: number): number {
    if (!Number.isInteger(row) || row < 0 || row >= this.positionOfRow.length) return -1
    const position = this.positionOfRow[row]!
    return position === ABSENT ? -1 : position
  }

  /** Rows of a truncated hunk still hidden below this position, or 0. */
  hiddenAfter(position: number): number {
    if (
      !Number.isInteger(position) ||
      position < 0 ||
      position >= this.hiddenAfterPosition.length
    ) {
      return 0
    }
    return this.hiddenAfterPosition[position]!
  }

  isFileCollapsed(file: number): boolean {
    return this.collapsedFiles.has(file)
  }

  isHunkCollapsed(ref: HunkRef): boolean {
    return this.collapsedHunks.has(keyOf(ref))
  }

  /** Rows a hunk holds in this layout, whether or not they are all shown. */
  rowsIn(ref: HunkRef): number {
    return this.hunkRows.get(keyOf(ref)) ?? 0
  }

  toggleFile(file: number): Folding {
    return this.with({ files: toggled(this.collapsedFiles, file) })
  }

  toggleHunk(ref: HunkRef): Folding {
    return this.with({ hunks: toggled(this.collapsedHunks, keyOf(ref)) })
  }

  /** Reveal the next chunk of a truncated hunk. */
  expandHunk(ref: HunkRef, by = EXPAND_BY): Folding {
    const key = keyOf(ref)
    const next = new Map(this.revealed)
    next.set(key, Math.min(this.limitOf(key) + by, this.hunkRows.get(key) ?? 0))
    return this.with({ revealed: next })
  }

  /** Reveal the rest of it in one go. */
  expandHunkFully(ref: HunkRef): Folding {
    const key = keyOf(ref)
    const next = new Map(this.revealed)
    next.set(key, this.hunkRows.get(key) ?? 0)
    return this.with({ revealed: next })
  }

  /** Collapse every file at once, which is how a 758-file diff becomes a list. */
  collapseAllFiles(): Folding {
    const files = new Set<number>()
    for (let file = 0; file < this.rows.fileCount; file += 1) files.add(file)
    return this.with({ files })
  }

  expandAll(): Folding {
    const revealed = new Map<number, number>()
    for (const [key, count] of this.hunkRows) revealed.set(key, count)
    return new Folding(this.rows, EMPTY_SET, EMPTY_SET, revealed, this.hunkRows)
  }

  /** How many rows of a hunk are shown before the reader asks for more. */
  private limitOf(key: number): number {
    const asked = this.revealed.get(key)
    if (asked !== undefined) return asked
    const total = this.hunkRows.get(key) ?? 0
    return total > LARGE_HUNK ? LARGE_HUNK : total
  }

  private with(change: {
    files?: ReadonlySet<number>
    hunks?: ReadonlySet<number>
    revealed?: ReadonlyMap<number, number>
  }): Folding {
    return new Folding(
      this.rows,
      change.files ?? this.collapsedFiles,
      change.hunks ?? this.collapsedHunks,
      change.revealed ?? this.revealed,
      this.hunkRows,
    )
  }
}

const EMPTY_SET: ReadonlySet<number> = new Set()
const EMPTY_MAP: ReadonlyMap<number, number> = new Map()

/** Rows are numbered, so a hunk needs one number rather than a string key. */
function keyOf(ref: HunkRef): number {
  return ref.file * 0x10000 + ref.hunk
}

function toggled(set: ReadonlySet<number>, value: number): ReadonlySet<number> {
  const next = new Set(set)
  if (!next.delete(value)) next.add(value)
  return next
}

/** Never stored: a folded row keeps its index, it just has no position. */
const ABSENT = 0xffffffff

/**
 * How many rows each hunk holds — in rows, not lines, because the two-column
 * layout puts a replacement and its replaced line on one of them.
 *
 * Computed once per row index and handed to every projection derived from it,
 * so a toggle stays one pass rather than two.
 */
function countHunkRows(rows: RowIndex): ReadonlyMap<number, number> {
  const counts = new Map<number, number>()
  for (let row = 0; row < rows.length; row += 1) {
    if (rows.kindAt(row) !== RowKind.Line) continue
    const key = keyOf({ file: rows.fileIndexAt(row), hunk: rows.hunkIndexAt(row) })
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

/**
 * A collapsed file shows its header and nothing else; a collapsed hunk shows
 * its header and none of its lines. Both leave the reader something to click,
 * which a fold that hid its own control would not.
 */
function visible(
  rows: RowIndex,
  row: number,
  collapsedFiles: ReadonlySet<number>,
  collapsedHunks: ReadonlySet<number>,
): boolean {
  const kind = rows.kindAt(row)
  if (kind === RowKind.FileHeader) return true

  if (collapsedFiles.has(rows.fileIndexAt(row))) return false
  if (kind === RowKind.Note || kind === RowKind.HunkHeader) return true

  return !collapsedHunks.has(keyOf({ file: rows.fileIndexAt(row), hunk: rows.hunkIndexAt(row) }))
}
