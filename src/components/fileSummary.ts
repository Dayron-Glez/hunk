import type { DiffFile } from '../core/parse/types'

export function describePath(file: DiffFile): string {
  if (file.oldPath !== null && file.newPath !== null && file.oldPath !== file.newPath) {
    return `${file.oldPath} → ${file.newPath}`
  }
  return file.newPath ?? file.oldPath ?? '(unnamed)'
}

export function describeMode(file: DiffFile): string | null {
  if (file.oldMode === null || file.newMode === null) return null
  if (file.oldMode === file.newMode) return null
  return `${file.oldMode} → ${file.newMode}`
}

/** A file can legitimately have no hunks. Say which case it is instead of showing a void. */
export function describeEmptyBody(file: DiffFile): string {
  if (file.combined) return 'Combined diff from a merge — not supported yet.'
  if (file.binary) return 'Binary file, not shown.'
  if (file.submodule) return 'Submodule pointer changed.'
  if (describeMode(file) !== null) return 'Only the file mode changed.'
  if (file.status === 'renamed' || file.status === 'copied') return 'Moved with no content change.'
  return 'No content changes.'
}
