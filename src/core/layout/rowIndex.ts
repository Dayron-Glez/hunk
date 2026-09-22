import type { DiffFile, DiffLine, Hunk, ParsedDiff } from '../parse/types'

/**
 * What a single row of the rendered document is.
 *
 * A plain object rather than an enum, because the build bans syntax that cannot
 * be erased, and because the values have to be numbers anyway to live in a
 * typed array.
 */
export const RowKind = {
  FileHeader: 0,
  /** A file with nothing to show: binary, a mode change, a move with no edits. */
  Note: 1,
  HunkHeader: 2,
  Line: 3,
} as const

export type RowKind = (typeof RowKind)[keyof typeof RowKind]

/** Stored in the typed arrays where a row has no hunk or no line of its own. */
const ABSENT = 0xffffffff

/**
 * The diff flattened into a numbered list of rows.
 *
 * Virtualization needs to answer "what is row 47.312?" without walking the file
 * and hunk structure to find out, and it needs to do it for a different row on
 * every frame. This builds that answer once, as a set of parallel typed arrays:
 * thirteen bytes per row, so a 100.000-line diff indexes in 1.3 MB.
 *
 * The same information as objects would cost tens of megabytes against a budget
 * of eighty, and would hand the garbage collector a million small allocations
 * during the one moment — first paint — when it can least afford them.
 */
export class RowIndex {
  private readonly kinds: Uint8Array
  private readonly files: Uint32Array
  private readonly hunks: Uint32Array
  private readonly lines: Uint32Array
  /** Row where each file begins, for jumping between them. */
  private readonly fileStarts: Uint32Array
  private readonly diff: ParsedDiff

  constructor(diff: ParsedDiff) {
    this.diff = diff

    let count = 0
    for (const file of diff.files) {
      count += 1
      if (file.hunks.length === 0) {
        count += 1
        continue
      }
      for (const hunk of file.hunks) count += 1 + hunk.lines.length
    }

    this.kinds = new Uint8Array(count)
    this.files = new Uint32Array(count)
    this.hunks = new Uint32Array(count).fill(ABSENT)
    this.lines = new Uint32Array(count).fill(ABSENT)
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

        for (let lineIndex = 0; lineIndex < hunk.lines.length; lineIndex += 1) {
          this.kinds[row] = RowKind.Line
          this.files[row] = fileIndex
          this.hunks[row] = hunkIndex
          this.lines[row] = lineIndex
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

  /** The line this row shows, or -1 for anything that is not a diff line. */
  lineIndexAt(row: number): number {
    this.assertRow(row)
    const value = this.lines[row]!
    return value === ABSENT ? -1 : value
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
