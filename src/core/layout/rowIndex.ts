import { GHOST, alignHunk, alignedRowCount } from '../diff/align'
import type { DiffFile, DiffLine, Hunk, ParsedDiff } from '../parse/types'

/** An object rather than an enum: the build bans non-erasable syntax, and the
 *  values have to be numbers anyway to live in a typed array. */
export const RowKind = {
  FileHeader: 0,
  /** A file with nothing to show: binary, a mode change, a move with no edits. */
  Note: 1,
  HunkHeader: 2,
  Line: 3,
} as const

export type RowKind = (typeof RowKind)[keyof typeof RowKind]

/** One line per row, or the two versions beside each other. */
export type LayoutMode = 'unified' | 'split'

/** Which version of the file a cell shows. Both name the same line for context. */
export type Column = 'old' | 'new'

/** Stored in the typed arrays where a row has no hunk or no line of its own. */
const ABSENT = 0xffffffff

/**
 * The diff flattened into a numbered list of rows, so "what is row 47.312?" is
 * answered without walking the file and hunk structure — a different row, on
 * every frame.
 *
 * Parallel typed arrays at thirteen bytes a row: 1.3 MB for a 100.000-line
 * diff, against tens of megabytes as objects and a million small allocations
 * handed to the collector during first paint.
 *
 * Split mode adds a second cell per row and so a fourth byte-per-row array.
 * Unified leaves it unallocated rather than filling it with a copy of the
 * first: the mode nobody switched away from should not pay for the one they
 * did not ask for.
 */
export class RowIndex {
  private readonly kinds: Uint8Array
  private readonly files: Uint32Array
  private readonly hunks: Uint32Array
  /** The line in the left column, and the only line in unified mode. */
  private readonly oldCells: Uint32Array
  /** The line in the right column. Null in unified, where there is one cell. */
  private readonly newCells: Uint32Array | null
  /** Row where each file begins, for jumping between them. */
  private readonly fileStarts: Uint32Array
  private readonly diff: ParsedDiff
  readonly mode: LayoutMode

  constructor(diff: ParsedDiff, mode: LayoutMode = 'unified') {
    this.diff = diff
    this.mode = mode
    const split = mode === 'split'

    let count = 0
    for (const file of diff.files) {
      count += 1
      if (file.hunks.length === 0) {
        count += 1
        continue
      }
      for (const hunk of file.hunks) {
        count += 1 + (split ? alignedRowCount(hunk.lines) : hunk.lines.length)
      }
    }

    this.kinds = new Uint8Array(count)
    this.files = new Uint32Array(count)
    this.hunks = new Uint32Array(count).fill(ABSENT)
    this.oldCells = new Uint32Array(count).fill(ABSENT)
    this.newCells = split ? new Uint32Array(count).fill(ABSENT) : null
    this.fileStarts = new Uint32Array(diff.files.length)

    let row = 0
    for (let fileIndex = 0; fileIndex < diff.files.length; fileIndex += 1) {
      const file = diff.files[fileIndex]!
      this.fileStarts[fileIndex] = row

      this.kinds[row] = RowKind.FileHeader
      this.files[row] = fileIndex
      row += 1

      if (file.hunks.length === 0) {
        this.kinds[row] = RowKind.Note
        this.files[row] = fileIndex
        row += 1
        continue
      }

      for (let hunkIndex = 0; hunkIndex < file.hunks.length; hunkIndex += 1) {
        const hunk = file.hunks[hunkIndex]!

        this.kinds[row] = RowKind.HunkHeader
        this.files[row] = fileIndex
        this.hunks[row] = hunkIndex
        row += 1

        if (this.newCells === null) {
          for (let lineIndex = 0; lineIndex < hunk.lines.length; lineIndex += 1) {
            this.kinds[row] = RowKind.Line
            this.files[row] = fileIndex
            this.hunks[row] = hunkIndex
            this.oldCells[row] = lineIndex
            row += 1
          }
          continue
        }

        for (const cells of alignHunk(hunk.lines)) {
          this.kinds[row] = RowKind.Line
          this.files[row] = fileIndex
          this.hunks[row] = hunkIndex
          if (cells.old !== GHOST) this.oldCells[row] = cells.old
          if (cells.new !== GHOST) this.newCells[row] = cells.new
          row += 1
        }
      }
    }
  }

  get length(): number {
    return this.kinds.length
  }

  get fileCount(): number {
    return this.fileStarts.length
  }

  kindAt(row: number): RowKind {
    this.assertRow(row)
    return this.kinds[row] as RowKind
  }

  fileIndexAt(row: number): number {
    this.assertRow(row)
    return this.files[row]!
  }

  /** The hunk this row belongs to, or -1 for a file header or a note. */
  hunkIndexAt(row: number): number {
    this.assertRow(row)
    const value = this.hunks[row]!
    return value === ABSENT ? -1 : value
  }

  /**
   * The line in one of the row's two cells, or -1 where that side is a gap.
   *
   * Unified mode has one cell, and both columns answer with it: a deleted line
   * is the row whichever version is being asked about.
   */
  cellIndexAt(row: number, column: Column): number {
    this.assertRow(row)
    const cells = column === 'new' ? (this.newCells ?? this.oldCells) : this.oldCells
    const value = cells[row]!
    return value === ABSENT ? -1 : value
  }

  /** The line this row shows, or -1 for anything that is not a diff line. */
  lineIndexAt(row: number): number {
    const left = this.cellIndexAt(row, 'old')
    return left === -1 ? this.cellIndexAt(row, 'new') : left
  }

  fileAt(row: number): DiffFile {
    return this.diff.files[this.fileIndexAt(row)]!
  }

  /** The hunk this row belongs to, or null for a file header or a note. */
  hunkAt(row: number): Hunk | null {
    const hunkIndex = this.hunkIndexAt(row)
    if (hunkIndex === -1) return null
    return this.fileAt(row).hunks[hunkIndex]!
  }

  /** The line in one of the row's cells, or null where that side is a gap. */
  cellAt(row: number, column: Column): DiffLine | null {
    const lineIndex = this.cellIndexAt(row, column)
    if (lineIndex === -1) return null
    return this.hunkAt(row)!.lines[lineIndex]!
  }

  /** The line this row shows, or null for anything that is not a diff line. */
  lineAt(row: number): DiffLine | null {
    const lineIndex = this.lineIndexAt(row)
    if (lineIndex === -1) return null
    return this.hunkAt(row)!.lines[lineIndex]!
  }

  /** The row where a file's header sits. */
  rowOfFile(fileIndex: number): number {
    if (!Number.isInteger(fileIndex) || fileIndex < 0 || fileIndex >= this.fileStarts.length) {
      throw new RangeError(`file index ${fileIndex} is outside 0..${this.fileStarts.length - 1}`)
    }
    return this.fileStarts[fileIndex]!
  }

  private assertRow(row: number): void {
    if (!Number.isInteger(row) || row < 0 || row >= this.kinds.length) {
      throw new RangeError(`row ${row} is outside 0..${this.kinds.length - 1}`)
    }
  }
}
