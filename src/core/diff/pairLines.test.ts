import { describe, expect, it } from 'vitest'
import { readFixture } from '../../../tests/fixtures'
import { parseUnifiedDiff } from '../parse/unified'
import type { DiffLine } from '../parse/types'
import { pairChangedLines } from './pairLines'

const lines = (...kinds: DiffLine['kind'][]): DiffLine[] =>
  kinds.map((kind, i) => ({
    kind,
    content: `${kind}${i}`,
    oldNumber: null,
    newNumber: null,
    noNewlineAtEof: false,
  }))

const pairsOf = (...kinds: DiffLine['kind'][]): [number, number][] =>
  [...pairChangedLines(lines(...kinds))].sort((a, b) => a[0] - b[0])

describe('adjacent runs', () => {
  it('pairs one deletion with one insertion', () => {
    expect(pairsOf('context', 'delete', 'insert', 'context')).toEqual([
      [1, 2],
      [2, 1],
    ])
  })

  it('pairs runs in order', () => {
    expect(pairsOf('delete', 'delete', 'insert', 'insert')).toEqual([
      [0, 2],
      [1, 3],
      [2, 0],
      [3, 1],
    ])
  })

  it('pairs as many as both runs have and leaves the rest alone', () => {
    // Three removed, one added: only the first has a partner.
    expect(pairsOf('delete', 'delete', 'delete', 'insert')).toEqual([
      [0, 3],
      [3, 0],
    ])
  })

  it('handles more insertions than deletions', () => {
    expect(pairsOf('delete', 'insert', 'insert', 'insert')).toEqual([
      [0, 1],
      [1, 0],
    ])
  })

  it('finds several separate runs in one hunk', () => {
    const pairs = pairsOf('delete', 'insert', 'context', 'delete', 'insert')
    expect(pairs).toEqual([
      [0, 1],
      [1, 0],
      [3, 4],
      [4, 3],
    ])
  })
})

describe('what it refuses to pair', () => {
  it('leaves deletions alone when nothing was added after them', () => {
    expect(pairsOf('context', 'delete', 'delete', 'context')).toEqual([])
  })

  it('leaves insertions alone when nothing was removed before them', () => {
    expect(pairsOf('context', 'insert', 'insert')).toEqual([])
  })

  it('does not pair across context, which separates unrelated edits', () => {
    expect(pairsOf('delete', 'context', 'insert')).toEqual([])
  })

  it('handles a hunk with no lines', () => {
    expect(pairsOf()).toEqual([])
  })
})

describe('against the corpus', () => {
  it.each([
    'vite-pr-23346-normal.diff',
    'vite-pr-23378-new-files.diff',
    'prettier-bb52ae36-rename.diff',
    'linux-93e4b307-huge.diff',
  ])('%s pairs only a deletion with an insertion, symmetrically', (name) => {
    const diff = parseUnifiedDiff(readFixture('github', name))
    for (const file of diff.files) {
      for (const hunk of file.hunks) {
        const pairs = pairChangedLines(hunk.lines)
        for (const [from, to] of pairs) {
          const a = hunk.lines[from]
          const b = hunk.lines[to]
          expect(a?.kind).not.toBe('context')
          expect(b?.kind).not.toBe(a?.kind)
          // Every pairing points back at itself.
          expect(pairs.get(to)).toBe(from)
        }
      }
    }
  })
})
