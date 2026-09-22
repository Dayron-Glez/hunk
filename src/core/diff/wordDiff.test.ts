import { describe, expect, it } from 'vitest'
import { readFixture } from '../../../tests/fixtures'
import { parseUnifiedDiff } from '../parse/unified'
import { wordDiff, type Range } from './wordDiff'

/** What the reader would see marked, as text — far easier to check than offsets. */
const marked = (line: string, ranges: readonly Range[]): string[] =>
  ranges.map((r) => line.slice(r.start, r.end))

describe('finding the change inside a line', () => {
  it('marks one changed word and nothing else', () => {
    const before = 'const greeting = "hola"'
    const after = 'const greeting = "adios"'
    const changes = wordDiff(before, after)
    expect(marked(before, changes.before)).toEqual(['hola'])
    expect(marked(after, changes.after)).toEqual(['adios'])
  })

  it('marks an insertion with nothing removed', () => {
    const before = 'call(a, b)'
    const after = 'call(a, b, c)'
    const changes = wordDiff(before, after)
    expect(changes.before).toEqual([])
    expect(marked(after, changes.after)).toEqual([', c'])
  })

  it('marks a removal with nothing added', () => {
    const before = 'call(a, b, c)'
    const after = 'call(a, b)'
    const changes = wordDiff(before, after)
    expect(marked(before, changes.before)).toEqual([', c'])
    expect(changes.after).toEqual([])
  })

  it('marks changes in two places', () => {
    const before = 'let x = 1; let y = 2'
    const after = 'let a = 1; let b = 2'
    const changes = wordDiff(before, after)
    expect(marked(before, changes.before)).toEqual(['x', 'y'])
    expect(marked(after, changes.after)).toEqual(['a', 'b'])
  })

  it('treats a word as a unit rather than scattering letters', () => {
    const before = 'const threshold = 1'
    const after = 'const thrashold = 1'
    expect(marked(before, wordDiff(before, after).before)).toEqual(['threshold'])
  })

  it('notices a change that is only whitespace', () => {
    const before = 'if (a)  return'
    const after = 'if (a) return'
    const changes = wordDiff(before, after)
    expect(marked(before, changes.before)).toEqual(['  '])
    expect(marked(after, changes.after)).toEqual([' '])
  })
})

describe('saying nothing', () => {
  it('finds no change between identical lines', () => {
    expect(wordDiff('same', 'same')).toEqual({ before: [], after: [] })
  })

  it('stays quiet when the lines share almost nothing', () => {
    const before = 'const totallyDifferentThing = compute(a, b, c)'
    const after = 'throw new RangeError("nope")'
    expect(wordDiff(before, after)).toEqual({ before: [], after: [] })
  })

  it('stays quiet rather than marking a whole line', () => {
    const changes = wordDiff('aaa bbb ccc', 'xxx yyy zzz')
    expect(changes).toEqual({ before: [], after: [] })
  })

  it('handles an empty line on either side', () => {
    expect(() => wordDiff('', 'something')).not.toThrow()
    expect(() => wordDiff('something', '')).not.toThrow()
    expect(() => wordDiff('', '')).not.toThrow()
  })
})

describe('input that would cost too much', () => {
  it('says nothing about a line too long to be read closely', () => {
    const before = 'x'.repeat(2_001)
    const after = `${'x'.repeat(2_000)}y`
    expect(wordDiff(before, after)).toEqual({ before: [], after: [] })
  })

  it('still works right up to the ceiling', () => {
    const before = `${'x'.repeat(1_990)} old`
    const after = `${'x'.repeat(1_990)} new`
    expect(marked(before, wordDiff(before, after).before)).toEqual(['old'])
  })

  it('stays quiet on two token-heavy lines that share nothing', () => {
    // Under the character ceiling, so this exercises the token cap rather than it.
    const before = Array.from({ length: 400 }, (_, i) => `a${i}`).join(' ')
    const after = Array.from({ length: 400 }, (_, i) => `b${i}`).join(' ')
    expect(before.length).toBeLessThan(2_000)

    const started = performance.now()
    expect(wordDiff(before, after)).toEqual({ before: [], after: [] })
    // The table is never built: it bails on token count first.
    expect(performance.now() - started).toBeLessThan(200)
  })

  it('still finds a small edit at the end of a token-heavy line', () => {
    const common = Array.from({ length: 400 }, (_, i) => `t${i}`).join(' ')
    const changes = wordDiff(`${common} end`, `${common} END`)
    expect(marked(`${common} end`, changes.before)).toEqual(['end'])
  })
})

describe('the ranges themselves', () => {
  it('merges neighbouring changed tokens into one range', () => {
    const before = 'a.b.c'
    const after = 'a.x.y.c'
    const changes = wordDiff(before, after)
    expect(changes.after.length).toBeLessThanOrEqual(2)
    for (const range of changes.after) expect(range.end).toBeGreaterThan(range.start)
  })

  it('never runs past the end of its line', () => {
    const before = 'const value = compute()'
    const after = 'const value = computeAgain(1)'
    for (const range of wordDiff(before, after).before) {
      expect(range.end).toBeLessThanOrEqual(before.length)
    }
    for (const range of wordDiff(before, after).after) {
      expect(range.end).toBeLessThanOrEqual(after.length)
    }
  })

  it('returns ranges in order and without overlap', () => {
    const before = 'one two three four five'
    const after = 'one TWO three FOUR five'
    const ranges = wordDiff(before, after).before
    for (let i = 1; i < ranges.length; i += 1) {
      expect(ranges[i]!.start).toBeGreaterThanOrEqual(ranges[i - 1]!.end)
    }
  })
})

describe('against a real pull request', () => {
  it('reduces a regex change to the part that actually changed', () => {
    const diff = parseUnifiedDiff(readFixture('github', 'vite-pr-23346-normal.diff'))
    const hunk = diff.files[1]?.hunks[0]
    const before = hunk?.lines.find((l) => l.kind === 'delete')?.content ?? ''
    const after = hunk?.lines.find((l) => l.kind === 'insert')?.content ?? ''
    expect(before).not.toBe('')

    const changes = wordDiff(before, after)
    // The two lines are 120 characters and differ in a handful.
    const changedChars = changes.after.reduce((n, r) => n + (r.end - r.start), 0)
    expect(changedChars).toBeGreaterThan(0)
    expect(changedChars).toBeLessThan(10)
    expect(marked(after, changes.after).join('')).toContain('.')
  })

  it('never marks a range outside its line, across a whole fixture', () => {
    const diff = parseUnifiedDiff(readFixture('github', 'vite-pr-23378-new-files.diff'))
    for (const file of diff.files) {
      for (const hunk of file.hunks) {
        const deletions = hunk.lines.filter((l) => l.kind === 'delete')
        const insertions = hunk.lines.filter((l) => l.kind === 'insert')
        for (let i = 0; i < Math.min(deletions.length, insertions.length); i += 1) {
          const before = deletions[i]?.content ?? ''
          const after = insertions[i]?.content ?? ''
          const changes = wordDiff(before, after)
          for (const r of changes.before) expect(r.end).toBeLessThanOrEqual(before.length)
          for (const r of changes.after) expect(r.end).toBeLessThanOrEqual(after.length)
        }
      }
    }
  })
})
