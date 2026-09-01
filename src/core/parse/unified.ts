import { readMarkerPath, stripPrefix, unquoteGitPath } from './gitPath'
import type { DiffFile, DiffLine, FileStatus, Hunk, ParseWarning, ParsedDiff } from './types'

const BACKSLASH = 92
const QUOTE = 34
const SPACE = 32
const PLUS = 43
const MINUS = 45

const DEV_NULL = '/dev/null'
const GIT_HEADER = 'diff --git '
/** How `git show` heads a file in a merge commit: one path, not two. */
const COMBINED_HEADERS = ['diff --cc ', 'diff --combined ']
const SUBMODULE_MODE = '160000'

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/

interface FileDraft {
  headerOldPath: string | null
  headerNewPath: string | null
  markerOldPath: string | null | undefined
  markerNewPath: string | null | undefined
  fromPath: string | null
  toPath: string | null
  status: FileStatus
  oldMode: string | null
  newMode: string | null
  similarity: number | null
  binary: boolean
  submodule: boolean
  combined: boolean
  hunks: Hunk[]
  additions: number
  deletions: number
}

/**
 * Parse a unified diff.
 *
 * Accepts what `git diff` and the GitHub API produce, and degrades instead of
 * throwing: anything unrecognised lands in `warnings` and parsing carries on. A
 * viewer that gives up on a 758-file diff because one file is odd is useless.
 */
export function parseUnifiedDiff(source: string): ParsedDiff {
  const files: DiffFile[] = []
  const warnings: ParseWarning[] = []

  if (source === '') return { files, additions: 0, deletions: 0, warnings }

  const stripCarriageReturn = usesCarriageReturns(source)
  let pos = 0
  let lineNumber = 0
  let draft: FileDraft | null = null

  function readLine(): string {
    const start = pos
    const newline = source.indexOf('\n', start)
    const end = newline === -1 ? source.length : newline
    pos = end + 1
    lineNumber += 1
    const line = source.slice(start, end)
    return stripCarriageReturn && line.endsWith('\r') ? line.slice(0, -1) : line
  }

  function flush(): void {
    if (draft !== null) files.push(finishFile(draft))
    draft = null
  }

  function readHunk(target: FileDraft, header: RegExpExecArray): void {
    const oldStart = Number(header[1])
    const oldCount = header[2] === undefined ? 1 : Number(header[2])
    const newStart = Number(header[3])
    const newCount = header[4] === undefined ? 1 : Number(header[4])
    const section = (header[5] ?? '').replace(/^ /, '')

    const lines: DiffLine[] = []
    let oldNumber = oldStart
    let newNumber = newStart
    let oldRemaining = oldCount
    let newRemaining = newCount

    const markLastLine = (): void => {
      const last = lines[lines.length - 1]
      if (last !== undefined) lines[lines.length - 1] = { ...last, noNewlineAtEof: true }
    }

    while (pos < source.length && (oldRemaining > 0 || newRemaining > 0)) {
      const lineStart = pos
      const startLineNumber = lineNumber
      const line = readLine()

      // Inside a hunk every content line starts with a space, a plus or a minus,
      // so a leading backslash can only be the no-newline marker. It describes the
      // line before it, on whichever side that line belongs to.
      if (line.charCodeAt(0) === BACKSLASH) {
        markLastLine()
        continue
      }

      const marker = line.charCodeAt(0)

      // A context line is a space plus the content, but tools in the middle strip
      // trailing whitespace, which turns an empty context line into an empty line.
      // While the hunk still owes lines, read it as the context line it was.
      if (line === '' || marker === SPACE) {
        lines.push({
          kind: 'context',
          content: line === '' ? '' : line.slice(1),
          oldNumber,
          newNumber,
          noNewlineAtEof: false,
        })
        oldNumber += 1
        newNumber += 1
        oldRemaining -= 1
        newRemaining -= 1
        continue
      }

      if (marker === PLUS) {
        lines.push({
          kind: 'insert',
          content: line.slice(1),
          oldNumber: null,
          newNumber,
          noNewlineAtEof: false,
        })
        newNumber += 1
        newRemaining -= 1
        target.additions += 1
        continue
      }

      if (marker === MINUS && !line.startsWith('--- ')) {
        lines.push({
          kind: 'delete',
          content: line.slice(1),
          oldNumber,
          newNumber: null,
          noNewlineAtEof: false,
        })
        oldNumber += 1
        oldRemaining -= 1
        target.deletions += 1
        continue
      }

      pos = lineStart
      lineNumber = startLineNumber
      warnings.push({
        line: startLineNumber,
        message: `hunk ended ${oldRemaining + newRemaining} line(s) short of its header count`,
      })
      break
    }

    // The marker for the last line of a hunk falls outside the header's line
    // count, so the loop above has already spent its budget by the time it
    // appears. Without this the most common case of all — a file whose final
    // line gained or lost its newline — goes unnoticed.
    if (pos < source.length) {
      const lineStart = pos
      const startLineNumber = lineNumber
      if (readLine().charCodeAt(0) === BACKSLASH) {
        markLastLine()
      } else {
        pos = lineStart
        lineNumber = startLineNumber
      }
    }

    target.hunks.push({ oldStart, oldCount, newStart, newCount, section, lines })
  }

  while (pos < source.length) {
    const line = readLine()

    if (line.startsWith(GIT_HEADER)) {
      flush()
      draft = createDraft()
      applyGitHeaderLine(draft, line.slice(GIT_HEADER.length))
      continue
    }

    const combinedHeader = COMBINED_HEADERS.find((prefix) => line.startsWith(prefix))
    if (combinedHeader !== undefined) {
      flush()
      draft = createDraft()
      draft.combined = true
      const path = unquoteGitPath(line.slice(combinedHeader.length))
      draft.headerOldPath = path
      draft.headerNewPath = path
      warnings.push({ line: lineNumber, message: 'combined (merge) diffs are not supported' })
      continue
    }

    if (line.startsWith('--- ')) {
      if (draft === null || draft.hunks.length > 0 || draft.markerOldPath !== undefined) {
        flush()
        draft = createDraft()
      }
      const rest = line.slice(4)
      draft.markerOldPath = rest === DEV_NULL ? null : stripPrefix(readMarkerPath(rest))
      continue
    }

    if (draft !== null && line.startsWith('+++ ')) {
      const rest = line.slice(4)
      draft.markerNewPath = rest === DEV_NULL ? null : stripPrefix(readMarkerPath(rest))
      continue
    }

    if (line.startsWith('@@')) {
      if (draft === null) {
        warnings.push({ line: lineNumber, message: 'hunk header outside any file' })
        continue
      }
      if (line.startsWith('@@@')) {
        if (!draft.combined) {
          warnings.push({ line: lineNumber, message: 'combined (merge) diffs are not supported' })
        }
        draft.combined = true
        continue
      }
      const header = HUNK_HEADER.exec(line)
      if (header === null) {
        warnings.push({ line: lineNumber, message: `unreadable hunk header: ${line}` })
        continue
      }
      readHunk(draft, header)
      continue
    }

    if (draft !== null) applyExtendedHeaderLine(draft, line)
  }

  flush()

  let additions = 0
  let deletions = 0
  for (const file of files) {
    additions += file.additions
    deletions += file.deletions
  }

  return { files, additions, deletions, warnings }
}

function createDraft(): FileDraft {
  return {
    headerOldPath: null,
    headerNewPath: null,
    markerOldPath: undefined,
    markerNewPath: undefined,
    fromPath: null,
    toPath: null,
    status: 'modified',
    oldMode: null,
    newMode: null,
    similarity: null,
    binary: false,
    submodule: false,
    combined: false,
    hunks: [],
    additions: 0,
    deletions: 0,
  }
}

function applyExtendedHeaderLine(draft: FileDraft, line: string): void {
  if (line.startsWith('old mode ')) {
    draft.oldMode = line.slice(9).trim()
  } else if (line.startsWith('new mode ')) {
    draft.newMode = line.slice(9).trim()
  } else if (line.startsWith('new file mode ')) {
    draft.status = 'added'
    draft.newMode = line.slice(14).trim()
  } else if (line.startsWith('deleted file mode ')) {
    draft.status = 'deleted'
    draft.oldMode = line.slice(18).trim()
  } else if (line.startsWith('similarity index ')) {
    draft.similarity = parsePercentage(line.slice(17))
  } else if (line.startsWith('dissimilarity index ')) {
    draft.similarity = parsePercentage(line.slice(20))
  } else if (line.startsWith('rename from ')) {
    draft.status = 'renamed'
    draft.fromPath = unquoteGitPath(line.slice(12))
  } else if (line.startsWith('rename to ')) {
    draft.status = 'renamed'
    draft.toPath = unquoteGitPath(line.slice(10))
  } else if (line.startsWith('copy from ')) {
    draft.status = 'copied'
    draft.fromPath = unquoteGitPath(line.slice(10))
  } else if (line.startsWith('copy to ')) {
    draft.status = 'copied'
    draft.toPath = unquoteGitPath(line.slice(8))
  } else if (line.startsWith('index ')) {
    applyIndexLine(draft, line.slice(6))
  } else if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
    draft.binary = true
  }

  if (draft.oldMode === SUBMODULE_MODE || draft.newMode === SUBMODULE_MODE) draft.submodule = true
}

/** `index <before>..<after>[ <mode>]`. The mode is absent exactly when it changed. */
function applyIndexLine(draft: FileDraft, rest: string): void {
  const space = rest.indexOf(' ')
  if (space === -1) return
  const mode = rest.slice(space + 1).trim()
  draft.oldMode ??= mode
  draft.newMode ??= mode
}

function parsePercentage(rest: string): number | null {
  const value = Number.parseInt(rest, 10)
  return Number.isNaN(value) ? null : value
}

/**
 * Split `a/<old> b/<new>`. The separator is a space and the paths may contain
 * spaces, so the line is ambiguous on its own. Quotes settle it when git had to
 * quote; otherwise the only reliable signal is that both sides name the same file
 * unless it moved — and a move always brings `rename from`/`rename to` lines,
 * which outrank anything guessed here.
 */
function applyGitHeaderLine(draft: FileDraft, rest: string): void {
  if (rest.charCodeAt(0) === QUOTE) {
    const closing = findClosingQuote(rest)
    if (closing !== -1) {
      draft.headerOldPath = stripPrefix(unquoteGitPath(rest.slice(0, closing + 1)))
      draft.headerNewPath = stripPrefix(unquoteGitPath(rest.slice(closing + 2)))
      return
    }
  }

  for (let i = rest.indexOf(' '); i !== -1; i = rest.indexOf(' ', i + 1)) {
    const left = rest.slice(0, i)
    const right = rest.slice(i + 1)
    if (left.startsWith('a/') && right.startsWith('b/') && left.slice(2) === right.slice(2)) {
      draft.headerOldPath = left.slice(2)
      draft.headerNewPath = right.slice(2)
      return
    }
  }

  const split = rest.indexOf(' ')
  if (split === -1) return
  draft.headerOldPath = stripPrefix(unquoteGitPath(rest.slice(0, split)))
  draft.headerNewPath = stripPrefix(unquoteGitPath(rest.slice(split + 1)))
}

function findClosingQuote(text: string): number {
  for (let i = 1; i < text.length; i += 1) {
    const code = text.charCodeAt(i)
    if (code === BACKSLASH) {
      i += 1
      continue
    }
    if (code === QUOTE) return i
  }
  return -1
}

function finishFile(draft: FileDraft): DiffFile {
  let oldPath = draft.markerOldPath ?? null
  let newPath = draft.markerNewPath ?? null

  if (draft.markerOldPath === undefined) oldPath = draft.fromPath ?? draft.headerOldPath
  if (draft.markerNewPath === undefined) newPath = draft.toPath ?? draft.headerNewPath

  if (draft.status === 'added') oldPath = null
  if (draft.status === 'deleted') newPath = null

  return {
    oldPath,
    newPath,
    status: draft.status,
    oldMode: draft.oldMode,
    newMode: draft.newMode,
    similarity: draft.similarity,
    binary: draft.binary,
    submodule: draft.submodule,
    combined: draft.combined,
    hunks: draft.hunks,
    additions: draft.additions,
    deletions: draft.deletions,
  }
}

/**
 * True when the diff document itself is CRLF-terminated, as a `.patch` saved on
 * Windows will be. Structural lines never legitimately end in a carriage return,
 * so one on a hunk header means every line carries a stray CR that is not
 * content. The distinction matters: in a diff *of* a CRLF file the CR is content,
 * and stripping it would corrupt every line.
 */
function usesCarriageReturns(source: string): boolean {
  let pos = 0
  while (pos < source.length) {
    const newline = source.indexOf('\n', pos)
    const end = newline === -1 ? source.length : newline
    const line = source.slice(pos, end)
    if (line.startsWith('@@') || line.startsWith(GIT_HEADER)) return line.endsWith('\r')
    if (newline === -1) break
    pos = newline + 1
  }
  return false
}
