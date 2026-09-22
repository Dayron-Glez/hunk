import { describe, expect, it } from 'vitest'
import type { Range } from '../diff/wordDiff'
import { mergeSegments, type Segment } from './segments'
import type { Span } from './tokens'

const span = (start: number, end: number, color: string, extra: Partial<Span> = {}): Span => ({
  start,
  end,
  color,
  italic: false,
  bold: false,
  underline: false,
  ...extra,
})

const range = (start: number, end: number): Range => ({ start, end })

/** A segment as `text→colour` plus a mark when it is part of the change. */
const render = (line: string, segments: readonly Segment[]): string[] =>
  segments.map((s) => `${line.slice(s.start, s.end)}→${s.color ?? 'plain'}${s.changed ? '*' : ''}`)

describe('covering the line', () => {
  it('tiles it exactly, with no gap and no overlap', () => {
    const line = 'const x = 1'
    const segments = mergeSegments(
      line.length,
      [span(0, 5, '#RED'), span(5, 11, '#GREY')],
      [range(6, 7)],
    )
    expect(segments.map((s) => line.slice(s.start, s.end)).join('')).toBe(line)
    for (let i = 1; i < segments.length; i += 1) {
      expect(segments[i]!.start).toBe(segments[i - 1]!.end)
    }
  })

  it('returns nothing for an empty line', () => {
    expect(mergeSegments(0, [], [])).toEqual([])
  })
})

describe('with only colours', () => {
  it('keeps the spans as they are', () => {
    const line = 'let a'
    expect(
      render(line, mergeSegments(line.length, [span(0, 3, '#RED'), span(3, 5, '#GREY')], [])),
    ).toEqual(['let→#RED', ' a→#GREY'])
  })
})

describe('with only changes', () => {
  it('splits an uncoloured line at the change', () => {
    const line = 'abcdef'
    expect(render(line, mergeSegments(line.length, null, [range(2, 4)]))).toEqual([
      'ab→plain',
      'cd→plain*',
      'ef→plain',
    ])
  })
})

describe('where the two disagree', () => {
  it('cuts a token in half when only part of it changed', () => {
    const line = 'threshold'
    // One colour over the whole word, but only the last three characters are new.
    expect(render(line, mergeSegments(line.length, [span(0, 9, '#BLUE')], [range(6, 9)]))).toEqual([
      'thresh→#BLUE',
      'old→#BLUE*',
    ])
  })

  it('keeps each piece to one colour when a change spans two tokens', () => {
    const line = 'ab.cd'
    const segments = mergeSegments(
      line.length,
      [span(0, 2, '#A'), span(2, 3, '#DOT'), span(3, 5, '#B')],
      [range(1, 4)],
    )
    expect(render(line, segments)).toEqual(['a→#A', 'b→#A*', '.→#DOT*', 'c→#B*', 'd→#B'])
  })

  it('handles a change that starts before the first token ends', () => {
    const line = 'xyz'
    expect(render(line, mergeSegments(line.length, [span(0, 3, '#C')], [range(0, 1)]))).toEqual([
      'x→#C*',
      'yz→#C',
    ])
  })

  it('handles several separate changes', () => {
    const line = 'one two three'
    const segments = mergeSegments(line.length, [span(0, 13, '#C')], [range(0, 3), range(8, 13)])
    expect(render(line, segments)).toEqual(['one→#C*', ' two →#C', 'three→#C*'])
  })
})

describe('font styles', () => {
  it('follows the span the piece sits in', () => {
    const segments = mergeSegments(
      6,
      [span(0, 3, '#C', { italic: true }), span(3, 6, '#D', { bold: true, underline: true })],
      [range(2, 4)],
    )
    expect(segments.map((s) => [s.italic, s.bold, s.underline])).toEqual([
      [true, false, false],
      [true, false, false],
      [false, true, true],
      [false, true, true],
    ])
  })
})

describe('input that does not line up', () => {
  it('ignores boundaries past the end of the line', () => {
    const segments = mergeSegments(4, [span(0, 4, '#C')], [range(2, 99)])
    expect(segments.map((s) => [s.start, s.end, s.changed])).toEqual([
      [0, 2, false],
      [2, 4, true],
    ])
  })

  it('survives a line with no spans and no changes', () => {
    expect(mergeSegments(5, null, [])).toEqual([
      {
        start: 0,
        end: 5,
        color: null,
        changed: false,
        italic: false,
        bold: false,
        underline: false,
      },
    ])
  })

  it('survives spans that do not reach the end of the line', () => {
    const segments = mergeSegments(10, [span(0, 4, '#C')], [])
    expect(segments.map((s) => [s.start, s.end, s.color])).toEqual([
      [0, 4, '#C'],
      [4, 10, null],
    ])
  })
})
