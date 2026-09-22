import { RowKind, type RowIndex } from './rowIndex'

/** Which file, and which hunk inside it. */
export interface HunkRef {
  readonly file: number
  readonly hunk: number
}

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
  /** Visible position to row. The whole point of the class. */
  private readonly rowOf: Uint32Array
  /** Row to visible position, or ABSENT where the row is folded away. */
  private readonly positionOfRow: Uint32Array

  private constructor(
    rows: RowIndex,
    collapsedFiles: ReadonlySet<number>,
    collapsedHunks: ReadonlySet<number>,
  ) {
    this.rows = rows
    this.collapsedFiles = collapsedFiles
    this.collapsedHunks = collapsedHunks

    const rowOf = new Uint32Array(rows.length)
    const positionOfRow = new Uint32Array(rows.length).fill(ABSENT)

    let count = 0
    for (let row = 0; row < rows.length; row += 1) {
      if (!visible(rows, row, collapsedFiles, collapsedHunks)) continue
      rowOf[count] = row
      positionOfRow[row] = count
      count += 1
    }

    this.rowOf = rowOf.subarray(0, count)
    this.positionOfRow = positionOfRow
  }

  /** Everything open, which is how a diff is first shown. */
  static all(rows: RowIndex): Folding {
    return new Folding(rows, EMPTY, EMPTY)
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

  isFileCollapsed(file: number): boolean {
    return this.collapsedFiles.has(file)
  }

  isHunkCollapsed(ref: HunkRef): boolean {
    return this.collapsedHunks.has(keyOf(ref))
  }

  toggleFile(file: number): Folding {
    return new Folding(this.rows, toggled(this.collapsedFiles, file), this.collapsedHunks)
  }

  toggleHunk(ref: HunkRef): Folding {
    return new Folding(this.rows, this.collapsedFiles, toggled(this.collapsedHunks, keyOf(ref)))
  }

  /** Collapse every file at once, which is how a 758-file diff becomes a list. */
  collapseAllFiles(): Folding {
    const files = new Set<number>()
    for (let file = 0; file < this.rows.fileCount; file += 1) files.add(file)
    return new Folding(this.rows, files, this.collapsedHunks)
  }

  expandAll(): Folding {
    return new Folding(this.rows, EMPTY, EMPTY)
  }
}

const EMPTY: ReadonlySet<number> = new Set()

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
