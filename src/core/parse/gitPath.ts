const QUOTE = 34
const BACKSLASH = 92

const SHORT_ESCAPES = new Map<string, number>([
  ['a', 0x07],
  ['b', 0x08],
  ['f', 0x0c],
  ['n', 0x0a],
  ['r', 0x0d],
  ['t', 0x09],
  ['v', 0x0b],
  ['"', 0x22],
  [String.fromCharCode(BACKSLASH), BACKSLASH],
])

const utf8 = new TextDecoder('utf-8')

/**
 * Undo the quoting git applies to a path it cannot write literally. Anything
 * outside printable ASCII comes back as octal escapes of the *bytes*, so the
 * escapes have to be collected into bytes and decoded as UTF-8 as a unit —
 * decoding them one at a time would turn every multi-byte character into
 * mojibake.
 */
export function unquoteGitPath(raw: string): string {
  if (raw.length < 2 || raw.charCodeAt(0) !== QUOTE || raw.charCodeAt(raw.length - 1) !== QUOTE) {
    return raw
  }

  const body = raw.slice(1, -1)
  const bytes: number[] = []

  for (let i = 0; i < body.length; i += 1) {
    if (body.charCodeAt(i) !== BACKSLASH) {
      pushUtf8(bytes, body[i]!)
      continue
    }

    const next = body[i + 1]
    if (next === undefined) {
      bytes.push(BACKSLASH)
      break
    }

    const short = SHORT_ESCAPES.get(next)
    if (short !== undefined) {
      bytes.push(short)
      i += 1
      continue
    }

    const octal = /^[0-7]{1,3}/.exec(body.slice(i + 1, i + 4))
    if (octal) {
      bytes.push(parseInt(octal[0], 8) & 0xff)
      i += octal[0].length
      continue
    }

    bytes.push(BACKSLASH)
  }

  return utf8.decode(Uint8Array.from(bytes))
}

function pushUtf8(bytes: number[], char: string): void {
  const code = char.charCodeAt(0)
  if (code < 0x80) {
    bytes.push(code)
    return
  }
  for (const byte of new TextEncoder().encode(char)) bytes.push(byte)
}

/**
 * Read a path off a `---`/`+++` line. git terminates the path with a tab whenever
 * it contains whitespace, and a tab is never part of an unquoted path, so the tab
 * marks the end.
 */
export function readMarkerPath(rest: string): string {
  const tab = rest.indexOf('\t')
  return unquoteGitPath(tab === -1 ? rest : rest.slice(0, tab))
}

/** Drop the `a/`, `b/` prefixes git puts on both sides. */
export function stripPrefix(path: string): string {
  if (path.startsWith('a/') || path.startsWith('b/')) return path.slice(2)
  return path
}
