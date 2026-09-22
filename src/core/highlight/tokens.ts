export const FontStyle = { Italic: 1, Bold: 2, Underline: 4 } as const

/** The shape a highlighter hands back, narrowed to what is actually used. */
export interface SourceToken {
  readonly content: string
  readonly color?: string | undefined
  readonly fontStyle?: number | undefined
}

/**
 * Highlighted lines as typed arrays instead of objects.
 *
 * A viewport of tokens is a few thousand small objects, and structured cloning
 * them across the worker boundary costs more than the highlighting did. Flat
 * arrays transfer as buffers — ownership moves, nothing is copied.
 *
 * Tokens for line `i` are the entries in `[lineStarts[i], lineStarts[i + 1])`.
 * Each ends at `ends[t]` characters into its line and starts where the previous
 * one ended.
 */
export interface FlatTokens {
  readonly palette: readonly string[]
  readonly lineStarts: Uint32Array
  readonly ends: Uint32Array
  /** Palette index in the low 24 bits, font style flags in the top 8. */
  readonly styles: Uint32Array
}

export interface Span {
  readonly start: number
  readonly end: number
  readonly color: string
  readonly italic: boolean
  readonly bold: boolean
  readonly underline: boolean
}

const COLOR_MASK = 0x00ffffff

export function flatten(lines: readonly (readonly SourceToken[])[]): FlatTokens {
  const palette: string[] = []
  const indexOfColor = new Map<string, number>()

  let count = 0
  for (const line of lines) count += line.length

  const lineStarts = new Uint32Array(lines.length + 1)
  const ends = new Uint32Array(count)
  const styles = new Uint32Array(count)

  let token = 0
  for (let i = 0; i < lines.length; i += 1) {
    lineStarts[i] = token
    let column = 0
    for (const source of lines[i] ?? []) {
      column += source.content.length
      ends[token] = column

      const color = source.color ?? ''
      let colorIndex = indexOfColor.get(color)
      if (colorIndex === undefined) {
        colorIndex = palette.length
        palette.push(color)
        indexOfColor.set(color, colorIndex)
      }

      const fontStyle =
        source.fontStyle === undefined || source.fontStyle < 0 ? 0 : source.fontStyle
      styles[token] = (colorIndex & COLOR_MASK) | (fontStyle << 24)
      token += 1
    }
  }
  lineStarts[lines.length] = token

  return { palette, lineStarts, ends, styles }
}

/** The spans covering one line, in order. Empty when the line has no tokens. */
export function spansOf(tokens: FlatTokens, line: number): Span[] {
  if (line < 0 || line + 1 >= tokens.lineStarts.length) return []

  const from = tokens.lineStarts[line]!
  const to = tokens.lineStarts[line + 1]!
  const spans: Span[] = []

  let start = 0
  for (let t = from; t < to; t += 1) {
    const end = tokens.ends[t]!
    const style = tokens.styles[t]!
    const fontStyle = style >>> 24
    spans.push({
      start,
      end,
      color: tokens.palette[style & COLOR_MASK] ?? '',
      italic: (fontStyle & FontStyle.Italic) !== 0,
      bold: (fontStyle & FontStyle.Bold) !== 0,
      underline: (fontStyle & FontStyle.Underline) !== 0,
    })
    start = end
  }
  return spans
}

/** The buffers to hand to `postMessage` so they move rather than copy. */
export function buffersOf(tokens: FlatTokens): ArrayBuffer[] {
  return [
    tokens.lineStarts.buffer as ArrayBuffer,
    tokens.ends.buffer as ArrayBuffer,
    tokens.styles.buffer as ArrayBuffer,
  ]
}
