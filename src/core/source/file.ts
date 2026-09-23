import { parseUnifiedDiff } from '../parse/unified'

/**
 * Why a file could not be shown.
 *
 * Named rather than thrown, for the same reason the network failures are:
 * "unsupported file" tells the reader nothing they can act on, and the three
 * cases below want three different sentences.
 */
export type FileFailure =
  | { readonly kind: 'too-large'; readonly name: string; readonly bytes: number }
  | { readonly kind: 'binary'; readonly name: string }
  | { readonly kind: 'not-a-diff'; readonly name: string }

export type FileResult =
  | { readonly ok: true; readonly name: string; readonly text: string; readonly files: number }
  | { readonly ok: false; readonly failure: FileFailure }

/**
 * Past this a file is not a diff anybody wrote.
 *
 * The largest in this project's own corpus is a 2.1 MB Linux kernel commit,
 * so fifty leaves room for something twenty times worse while still refusing
 * the video somebody dropped by mistake before the browser tries to hold it
 * as a string.
 */
export const MAX_FILE_BYTES = 50 * 1024 * 1024

const NUL = String.fromCharCode(0)

/** How much of a file is enough to tell text from everything else. */
const SNIFF = 8 * 1024

/**
 * Whether a file can be shown, and what it holds if so.
 *
 * The test for "is this a diff" is the parser itself: it never throws, and a
 * file it finds no files in is one this viewer has nothing to draw. That is a
 * stronger check than the extension, which is a claim rather than evidence —
 * people rename things, and `.txt` is a perfectly good diff.
 */
export function acceptDiff(name: string, text: string): FileResult {
  // A NUL byte in the first few kilobytes means it was never text. Reading a
  // PNG as UTF-8 gives a string that parses to nothing, and "no files in it"
  // would be a confusing way to say "that is a picture".
  if (text.slice(0, SNIFF).includes(NUL)) {
    return { ok: false, failure: { kind: 'binary', name } }
  }

  const diff = parseUnifiedDiff(text)
  if (diff.files.length === 0) {
    return { ok: false, failure: { kind: 'not-a-diff', name } }
  }

  return { ok: true, name, text, files: diff.files.length }
}

/** Refused on size before it is read, so nothing enormous is held as a string. */
export function acceptSize(name: string, bytes: number): FileFailure | null {
  return bytes > MAX_FILE_BYTES ? { kind: 'too-large', name, bytes } : null
}

/** What to put in front of the reader, in that failure's own words. */
export function describeFileFailure(failure: FileFailure): string {
  switch (failure.kind) {
    case 'too-large':
      return `${failure.name} is ${megabytes(failure.bytes)} MB. hunk reads diffs, and the largest anybody writes is a few.`
    case 'binary':
      return `${failure.name} is not text. Drop a .diff or .patch, or the output of git diff.`
    case 'not-a-diff':
      return `${failure.name} has no diff in it. It needs to look like git diff output, starting with "diff --git" or "---".`
  }
}

function megabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1)
}
