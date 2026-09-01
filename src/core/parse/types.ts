export type LineKind = 'context' | 'insert' | 'delete'

export type FileStatus = 'added' | 'deleted' | 'modified' | 'renamed' | 'copied'

export interface DiffLine {
  readonly kind: LineKind
  readonly content: string
  /** Position in the pre-image, or null on an inserted line. */
  readonly oldNumber: number | null
  /** Position in the post-image, or null on a deleted line. */
  readonly newNumber: number | null
  readonly noNewlineAtEof: boolean
}

export interface Hunk {
  readonly oldStart: number
  readonly oldCount: number
  readonly newStart: number
  readonly newCount: number
  /** The text git puts after the closing `@@`, usually the enclosing function. */
  readonly section: string
  readonly lines: readonly DiffLine[]
}

export interface DiffFile {
  /** null when the file was added. */
  readonly oldPath: string | null
  /** null when the file was deleted. */
  readonly newPath: string | null
  readonly status: FileStatus
  readonly oldMode: string | null
  readonly newMode: string | null
  /** Percentage git reported for a rename or copy, 0-100. */
  readonly similarity: number | null
  readonly binary: boolean
  readonly submodule: boolean
  /**
   * A merge diff (`@@@`). Its hunks are not parsed: two pre-images per line is a
   * different format, not a variation on this one. Kept distinct so the caller can
   * say so instead of showing an empty file.
   */
  readonly combined: boolean
  readonly hunks: readonly Hunk[]
  readonly additions: number
  readonly deletions: number
}

export interface ParseWarning {
  /** 1-based line in the source diff. */
  readonly line: number
  readonly message: string
}

export interface ParsedDiff {
  readonly files: readonly DiffFile[]
  readonly additions: number
  readonly deletions: number
  /** Everything the parser could not make sense of. Parsing never throws. */
  readonly warnings: readonly ParseWarning[]
}
