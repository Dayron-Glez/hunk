import { describe, expect, it } from 'vitest'
import { FontStyle, buffersOf, flatten, spansOf, type SourceToken } from './tokens'

const line = (...tokens: [string, string?, number?][]): SourceToken[] =>
  tokens.map(([content, color, fontStyle]) => ({ content, color, fontStyle }))

describe('flattening', () => {
  it('turns tokens into spans that tile the line', () => {
    const flat = flatten([line(['const', '#F97583'], [' ', '#E1E4E8'], ['x', '#79B8FF'])])
    expect(spansOf(flat, 0)).toEqual([
      { start: 0, end: 5, color: '#F97583', italic: false, bold: false, underline: false },
      { start: 5, end: 6, color: '#E1E4E8', italic: false, bold: false, underline: false },
      { start: 6, end: 7, color: '#79B8FF', italic: false, bold: false, underline: false },
    ])
  })

  it('stores each colour once however often it is used', () => {
    const flat = flatten([line(['a', '#FFF'], ['b', '#000'], ['c', '#FFF'], ['d', '#000'])])
    expect(flat.palette).toEqual(['#FFF', '#000'])
    expect(flat.styles.length).toBe(4)
  })

  it('keeps lines separate', () => {
    const flat = flatten([line(['one', '#FFF']), line(['two', '#000'], ['!', '#111'])])
    expect(spansOf(flat, 0).map((s) => s.color)).toEqual(['#FFF'])
    expect(spansOf(flat, 1).map((s) => s.color)).toEqual(['#000', '#111'])
  })

  it('handles an empty line between two full ones', () => {
    const flat = flatten([line(['a', '#FFF']), [], line(['c', '#000'])])
    expect(spansOf(flat, 1)).toEqual([])
    expect(spansOf(flat, 2).map((s) => s.color)).toEqual(['#000'])
  })

  it('handles no lines at all', () => {
    const flat = flatten([])
    expect(flat.ends.length).toBe(0)
    expect(spansOf(flat, 0)).toEqual([])
  })
})

describe('font styles', () => {
  it('carries italic, bold and underline through', () => {
    const flat = flatten([
      line(
        ['i', '#FFF', FontStyle.Italic],
        ['b', '#FFF', FontStyle.Bold],
        ['u', '#FFF', FontStyle.Underline],
        ['x', '#FFF', FontStyle.Bold | FontStyle.Italic],
      ),
    ])
    const spans = spansOf(flat, 0)
    expect(spans.map((s) => [s.italic, s.bold, s.underline])).toEqual([
      [true, false, false],
      [false, true, false],
      [false, false, true],
      [true, true, false],
    ])
  })

  it('treats the not-set value as no style rather than as flags', () => {
    const flat = flatten([line(['a', '#FFF', -1])])
    expect(spansOf(flat, 0)[0]).toMatchObject({ italic: false, bold: false, underline: false })
  })
})

describe('reading outside the document', () => {
  it('returns nothing rather than failing', () => {
    const flat = flatten([line(['a', '#FFF'])])
    expect(spansOf(flat, -1)).toEqual([])
    expect(spansOf(flat, 1)).toEqual([])
    expect(spansOf(flat, 99)).toEqual([])
  })
})

describe('content the tokens describe', () => {
  it('spans slice the original line back out of it', () => {
    const text = 'const greeting = "hola"'
    const flat = flatten([
      line(
        ['const', '#F97583'],
        [' greeting ', '#E1E4E8'],
        ['= ', '#F97583'],
        ['"hola"', '#9ECBFF'],
      ),
    ])
    expect(
      spansOf(flat, 0)
        .map((s) => text.slice(s.start, s.end))
        .join(''),
    ).toBe(text)
  })

  it('counts characters the way the DOM will slice them', () => {
    // Emoji are two UTF-16 units, and the renderer slices with the same units.
    const flat = flatten([line(['👩‍👩‍👧', '#FFF'], ['x', '#000'])])
    const spans = spansOf(flat, 0)
    expect(spans[0]?.end).toBe('👩‍👩‍👧'.length)
    expect('👩‍👩‍👧x'.slice(spans[1]?.start, spans[1]?.end)).toBe('x')
  })
})

describe('transfer', () => {
  it('offers the three buffers so they move instead of being copied', () => {
    const flat = flatten([line(['a', '#FFF'])])
    const buffers = buffersOf(flat)
    expect(buffers).toHaveLength(3)
    expect(buffers.every((b) => b instanceof ArrayBuffer)).toBe(true)
  })

  it('survives a round trip through the typed arrays alone', () => {
    const original = flatten([line(['let', '#F97583'], [' y', '#79B8FF', FontStyle.Bold])])
    const copy = {
      palette: original.palette,
      lineStarts: new Uint32Array(original.lineStarts),
      ends: new Uint32Array(original.ends),
      styles: new Uint32Array(original.styles),
    }
    expect(spansOf(copy, 0)).toEqual(spansOf(original, 0))
  })
})

describe('size', () => {
  it('costs eight bytes a token, whatever the colours', () => {
    const tokens = Array.from({ length: 1_000 }, (_, i): [string, string] => [
      'x',
      `#${(i % 40).toString(16).padStart(6, '0')}`,
    ])
    const flat = flatten([line(...tokens)])
    expect(flat.ends.byteLength + flat.styles.byteLength).toBe(8_000)
    expect(flat.palette.length).toBe(40)
  })
})
