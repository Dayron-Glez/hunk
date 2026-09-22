import { describe, expect, it } from 'vitest'
import { readFixture } from '../../../tests/fixtures'
import { parseUnifiedDiff } from '../parse/unified'
import type { Hunk } from '../parse/types'
import { reconstructSides, sideForLine } from './sides'

const hunkOf = (...lines: [string, string][]): Hunk => ({
  oldStart: 1,
  oldCount: 0,
  newStart: 1,
  newCount: 0,
  section: '',
  lines: lines.map(([kind, content]) => ({
    kind: kind as 'context' | 'insert' | 'delete',
    content,
    oldNumber: null,
    newNumber: null,
    noNewlineAtEof: false,
  })),
})

describe('rebuilding the two sides', () => {
  const hunk = hunkOf(['context', 'a'], ['delete', 'old'], ['insert', 'new'], ['context', 'b'])

  it('puts context and deletions on the old side', () => {
    expect(reconstructSides(hunk).old?.text).toBe('a\nold\nb')
  })

  it('puts context and insertions on the new side', () => {
    expect(reconstructSides(hunk).new?.text).toBe('a\nnew\nb')
  })

  it('records which hunk line each document line came from', () => {
    const sides = reconstructSides(hunk)
    expect([...(sides.old?.lines ?? [])]).toEqual([0, 1, 3])
    expect([...(sides.new?.lines ?? [])]).toEqual([0, 2, 3])
  })
})

describe('skipping work that nothing needs', () => {
  it('builds no old side for a hunk that only adds', () => {
    const sides = reconstructSides(hunkOf(['context', 'a'], ['insert', 'b']))
    expect(sides.old).toBeNull()
    expect(sides.new?.text).toBe('a\nb')
  })

  it('builds no new side for a hunk that only deletes', () => {
    const sides = reconstructSides(hunkOf(['context', 'a'], ['delete', 'b']))
    expect(sides.new).toBeNull()
    expect(sides.old?.text).toBe('a\nb')
  })

  it('builds one side for a hunk that is all context', () => {
    const sides = reconstructSides(hunkOf(['context', 'a'], ['context', 'b']))
    expect(sides.old).toBeNull()
    expect(sides.new?.text).toBe('a\nb')
  })

  it('handles a hunk with no lines at all', () => {
    const sides = reconstructSides(hunkOf())
    expect(sides.old).toBeNull()
    expect(sides.new?.text).toBe('')
  })
})

describe('choosing which side colours a row', () => {
  const both = reconstructSides(hunkOf(['context', 'a'], ['delete', 'x'], ['insert', 'y']))

  it('colours a deleted line from the old side', () => {
    expect(sideForLine('delete', both)).toBe('old')
  })

  it('colours an inserted line from the new side', () => {
    expect(sideForLine('insert', both)).toBe('new')
  })

  it('prefers the new side for context, which both sides contain', () => {
    expect(sideForLine('context', both)).toBe('new')
  })

  it('falls back to the old side when there is no new one', () => {
    const deletionsOnly = reconstructSides(hunkOf(['context', 'a'], ['delete', 'x']))
    expect(sideForLine('context', deletionsOnly)).toBe('old')
    expect(sideForLine('delete', deletionsOnly)).toBe('old')
  })
})

/**
 * The property that makes the rebuild correct: each side is exactly the file as
 * it was, or as it became, over the span the hunk covers — so the line counts
 * have to match what the hunk header promised.
 */
describe.each([
  'vite-pr-23346-normal.diff',
  'vite-pr-23378-new-files.diff',
  'prettier-bb52ae36-rename.diff',
  'linux-93e4b307-huge.diff',
] as const)('%s', (name) => {
  const diff = parseUnifiedDiff(readFixture('github', name))

  it('reproduces the line counts the hunk headers declare', () => {
    for (const file of diff.files) {
      for (const hunk of file.hunks) {
        const sides = reconstructSides(hunk)
        if (sides.old !== null) expect(sides.old.lines.length).toBe(hunk.oldCount)
        if (sides.new !== null) expect(sides.new.lines.length).toBe(hunk.newCount)
      }
    }
  })

  it('never points at a line the hunk does not have', () => {
    for (const file of diff.files) {
      for (const hunk of file.hunks) {
        const sides = reconstructSides(hunk)
        for (const document of [sides.old, sides.new]) {
          if (document === null) continue
          for (const index of document.lines) {
            expect(index).toBeLessThan(hunk.lines.length)
          }
          expect(document.text.split('\n').length).toBe(Math.max(document.lines.length, 1))
        }
      }
    }
  })

  it('gives every line a side to take its colours from', () => {
    for (const file of diff.files) {
      for (const hunk of file.hunks) {
        const sides = reconstructSides(hunk)
        for (const line of hunk.lines) {
          expect(sideForLine(line.kind, sides)).not.toBeNull()
        }
      }
    }
  })
})
