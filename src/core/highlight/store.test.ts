import { describe, expect, it, vi } from 'vitest'
import { readFixture } from '../../../tests/fixtures'
import { RowIndex } from '../layout/rowIndex'
import { parseUnifiedDiff } from '../parse/unified'
import { HighlightCache, HighlightStore, worthHighlighting, type Highlighter } from './store'
import { flatten, type FlatTokens } from './tokens'

/**
 * Colours every line the same, so a span's colour identifies which document it
 * came from. That is what the mapping tests need: not real syntax, but proof
 * that row 12 was coloured from the line the rebuild says it is.
 */
function fakeHighlighter(colorFor: (text: string) => string): Highlighter & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    highlight(lang: string, text: string): Promise<FlatTokens | null> {
      calls.push(`${lang}:${text}`)
      const color = colorFor(text)
      return Promise.resolve(
        flatten(text.split('\n').map((line) => [{ content: line, color, fontStyle: 0 }])),
      )
    },
  }
}

const load = (name: string) => {
  const diff = parseUnifiedDiff(readFixture('github', name))
  return { diff, rows: new RowIndex(diff) }
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/** Most tests here do not care when work lands, only what it produced. */
const ignore = (): void => undefined

describe('asking for work', () => {
  it('asks once per hunk however many of its rows are in view', async () => {
    const { rows } = load('vite-pr-23346-normal.diff')
    const highlighter = fakeHighlighter(() => '#FFF')
    const store = new HighlightStore(rows, highlighter, ignore)

    store.requestRange(0, rows.length - 1)
    store.requestRange(0, rows.length - 1)
    await settle()

    // Two files, one hunk each; each hunk has deletions and insertions, so both
    // sides are built.
    expect(store.requested).toBe(2)
    expect(highlighter.calls.length).toBeLessThanOrEqual(4)
  })

  it('asks for nothing when no row in the range belongs to a hunk', async () => {
    const { rows } = load('github-docs-5dc99214-binary-delete.diff')
    const highlighter = fakeHighlighter(() => '#FFF')
    const store = new HighlightStore(rows, highlighter, ignore)

    store.requestRange(0, rows.length - 1)
    await settle()

    expect(highlighter.calls).toEqual([])
  })

  it('never asks for a file whose language it does not know', async () => {
    const { rows } = load('npm-cli-75a943de-minified-bundle.diff')
    const highlighter = fakeHighlighter(() => '#FFF')
    const store = new HighlightStore(rows, highlighter, ignore)

    store.requestRange(0, 40)
    await settle()

    for (const call of highlighter.calls) {
      expect(call.startsWith('undefined')).toBe(false)
    }
  })

  it('tolerates a range that runs off either end', () => {
    const { rows } = load('vite-pr-23346-normal.diff')
    const store = new HighlightStore(
      rows,
      fakeHighlighter(() => '#FFF'),
      ignore,
    )
    expect(() => {
      store.requestRange(-50, rows.length + 50)
    }).not.toThrow()
  })
})

describe('reporting when work lands', () => {
  it('calls back once the tokens for a hunk have arrived', async () => {
    const { rows } = load('vite-pr-23346-normal.diff')
    const onChange = vi.fn()
    const store = new HighlightStore(
      rows,
      fakeHighlighter(() => '#FFF'),
      onChange,
    )

    store.requestRange(0, 10)
    expect(onChange).not.toHaveBeenCalled()
    await settle()
    expect(onChange).toHaveBeenCalled()
  })
})

describe('what a row gets', () => {
  it('gives nothing before the tokens arrive', () => {
    const { rows } = load('vite-pr-23346-normal.diff')
    const store = new HighlightStore(
      rows,
      fakeHighlighter(() => '#FFF'),
      ignore,
    )
    store.requestRange(0, 10)
    const lineRow = firstLineRow(rows)
    expect(store.spansFor(lineRow)).toBeNull()
  })

  it('gives spans that tile the row once they have', async () => {
    const { rows } = load('vite-pr-23346-normal.diff')
    const store = new HighlightStore(
      rows,
      fakeHighlighter(() => '#FFF'),
      ignore,
    )
    store.requestRange(0, rows.length - 1)
    await settle()

    const row = firstLineRow(rows)
    const spans = store.spansFor(row)
    const content = rows.lineAt(row)?.content ?? ''
    expect(spans).not.toBeNull()
    expect(spans?.map((s) => content.slice(s.start, s.end)).join('')).toBe(content)
  })

  it('gives nothing for a header, a note or a row outside the diff', async () => {
    const { rows } = load('vite-pr-23346-normal.diff')
    const store = new HighlightStore(
      rows,
      fakeHighlighter(() => '#FFF'),
      ignore,
    )
    store.requestRange(0, rows.length - 1)
    await settle()

    expect(store.spansFor(0)).toBeNull()
    expect(store.spansFor(-1)).toBeNull()
    expect(store.spansFor(rows.length + 5)).toBeNull()
  })
})

/**
 * The mapping that everything else rests on: a deleted row has to take its
 * colours from the old document and an inserted row from the new one. Getting
 * this backwards colours code with its neighbour's syntax, which looks like a
 * highlighter bug and is not.
 */
describe('each row is coloured from its own side', () => {
  it('reads deletions from the old document and insertions from the new', async () => {
    const { rows } = load('vite-pr-23346-normal.diff')
    // The old side contains the deleted line, the new side the inserted one.
    const store = new HighlightStore(
      rows,
      fakeHighlighter((text) => (text.includes('\\w[^,]+') ? '#OLD' : '#NEW')),
      ignore,
    )
    store.requestRange(0, rows.length - 1)
    await settle()

    let checkedDelete = false
    let checkedInsert = false
    for (let row = 0; row < rows.length; row += 1) {
      const line = rows.lineAt(row)
      if (line === null) continue
      const color = store.spansFor(row)?.[0]?.color
      if (color === undefined) continue
      if (line.kind === 'delete' && line.content.includes('\\w[^,]+')) {
        expect(color).toBe('#OLD')
        checkedDelete = true
      }
      if (line.kind === 'insert' && line.content.includes('[\\w.][^,]+')) {
        expect(color).toBe('#NEW')
        checkedInsert = true
      }
    }
    expect([checkedDelete, checkedInsert]).toEqual([true, true])
  })

  it('covers every line of every requested hunk', async () => {
    const { rows } = load('prettier-bb52ae36-rename.diff')
    const store = new HighlightStore(
      rows,
      fakeHighlighter(() => '#FFF'),
      ignore,
    )
    store.requestRange(0, rows.length - 1)
    await settle()

    let lines = 0
    let coloured = 0
    for (let row = 0; row < rows.length; row += 1) {
      const line = rows.lineAt(row)
      if (line === null) continue
      lines += 1
      const spans = store.spansFor(row)
      if (spans === null) continue
      coloured += 1
      expect(spans.map((s) => line.content.slice(s.start, s.end)).join('')).toBe(line.content)
    }
    expect(lines).toBeGreaterThan(50)
    expect(coloured).toBeGreaterThan(0)
  })
})

describe('falling back', () => {
  it('leaves rows plain when the highlighter answers null', async () => {
    const { rows } = load('vite-pr-23346-normal.diff')
    const store = new HighlightStore(rows, { highlight: () => Promise.resolve(null) }, ignore)
    store.requestRange(0, rows.length - 1)
    await settle()
    expect(store.spansFor(firstLineRow(rows))).toBeNull()
  })
})

function firstLineRow(rows: RowIndex): number {
  for (let row = 0; row < rows.length; row += 1) {
    if (rows.lineAt(row) !== null) return row
  }
  throw new Error('the fixture has no line rows')
}

/**
 * The guard against input that would stall the queue. Highlighting one 66.767
 * character line of real minified JavaScript takes 840 ms and yields 86 tokens;
 * every hunk behind it waits for that.
 */
describe('refusing work that is not worth it', () => {
  const line = (n: number): string => 'x'.repeat(n)

  it('accepts ordinary source', () => {
    expect(worthHighlighting(['const a = 1', 'const b = 2'].join(NEWLINE))).toBe(true)
    expect(worthHighlighting(line(1_999))).toBe(true)
  })

  it('refuses a single line long enough to cost hundreds of milliseconds', () => {
    expect(worthHighlighting(line(2_001))).toBe(false)
  })

  it('refuses it wherever in the document that line sits', () => {
    expect(worthHighlighting(['ok', line(9_000), 'ok'].join(NEWLINE))).toBe(false)
    expect(worthHighlighting(['ok', 'ok', line(9_000)].join(NEWLINE))).toBe(false)
  })

  it('refuses a document that is huge without any one line being long', () => {
    expect(worthHighlighting(Array.from({ length: 300 }, () => line(1_000)).join(NEWLINE))).toBe(
      false,
    )
  })

  it('accepts an empty document', () => {
    expect(worthHighlighting('')).toBe(true)
  })

  it('skips the minified hunks of a real fixture and keeps the rest', async () => {
    // That diff carries minified bundles and an ordinary package.json. The
    // lockfile should still be coloured; the bundles should not.
    const { rows } = load('npm-cli-75a943de-minified-bundle.diff')
    const highlighter = fakeHighlighter(() => '#FFF')
    const store = new HighlightStore(rows, highlighter, ignore)
    store.requestRange(0, rows.length - 1)
    await settle()

    expect(highlighter.calls.length).toBeGreaterThan(0)
    for (const call of highlighter.calls) {
      for (const text of call.split(NEWLINE)) {
        expect(text.length).toBeLessThanOrEqual(2_000)
      }
    }
  })
})

const NEWLINE = String.fromCharCode(10)

/**
 * Work out what changed inside a line only for lines on screen. The saving on
 * this corpus is 1.2 ms at worst; the point is that the hunk-at-a-time version
 * scales with rows nobody has looked at.
 */
describe('intra-line work is done per line, not per hunk', () => {
  const biggestHunkRow = (rows: RowIndex): { row: number; lines: number } => {
    let best = { row: -1, lines: 0 }
    for (let row = 0; row < rows.length; row += 1) {
      const hunk = rows.hunkAt(row)
      if (hunk !== null && hunk.lines.length > best.lines) best = { row, lines: hunk.lines.length }
    }
    return best
  }

  it('compares two lines, not two thousand, to draw one row', async () => {
    const { rows } = load('linux-93e4b307-huge.diff')
    const biggest = biggestHunkRow(rows)
    expect(biggest.lines).toBeGreaterThan(500)

    const store = new HighlightStore(
      rows,
      fakeHighlighter(() => '#FFF'),
      ignore,
    )
    store.requestRange(biggest.row, biggest.row)
    await settle()

    // Nothing drawn yet: asking for the hunk must not compare anything.
    expect(store.diffedLines).toBe(0)

    // Draw ten rows of it.
    for (let row = biggest.row; row < biggest.row + 10; row += 1) store.segmentsFor(row)

    // At most both sides of each pair touched, nowhere near the hunk's size.
    expect(store.diffedLines).toBeLessThanOrEqual(20)
    expect(store.diffedLines).toBeLessThan(biggest.lines / 10)
  })

  it('remembers a line it has already compared', async () => {
    const { rows } = load('vite-pr-23346-normal.diff')
    const store = new HighlightStore(
      rows,
      fakeHighlighter(() => '#FFF'),
      ignore,
    )
    store.requestRange(0, rows.length - 1)
    await settle()

    const row = firstLineRow(rows)
    store.segmentsFor(row)
    const after = store.diffedLines
    for (let i = 0; i < 20; i += 1) store.segmentsFor(row)
    expect(store.diffedLines).toBe(after)
  })

  it('still marks what changed once the row is drawn', async () => {
    const { rows } = load('vite-pr-23346-normal.diff')
    const store = new HighlightStore(
      rows,
      fakeHighlighter(() => '#FFF'),
      ignore,
    )
    store.requestRange(0, rows.length - 1)
    await settle()

    let changed = 0
    for (let row = 0; row < rows.length; row += 1) {
      for (const segment of store.segmentsFor(row) ?? []) if (segment.changed) changed += 1
    }
    expect(changed).toBeGreaterThan(0)
  })
})

/**
 * Expanding a gap changes one hunk of one file, and rebuilds the row index
 * over the result. Before the cache was keyed by hunk, that threw away every
 * hunk already coloured — on a 6.649-line hunk, seconds of the worker's work,
 * for a click that changed twenty lines somewhere else.
 */
describe('what survives the index being rebuilt', () => {
  it('colours a hunk again only when the hunk itself changed', async () => {
    const diff = parseUnifiedDiff(readFixture('github', 'vite-pr-23378-new-files.diff'))
    const rows = new RowIndex(diff)
    const cache = new HighlightCache()
    const highlighter = fakeHighlighter(() => '#FFF')

    const first = new HighlightStore(rows, highlighter, ignore, cache)
    first.requestRange(0, rows.length - 1)
    await settle()
    const asked = highlighter.calls.length
    expect(asked).toBeGreaterThan(0)

    // The same diff with one file's hunks replaced, as an expansion leaves it.
    const changed = diff.files[1]!
    const rebuilt = {
      ...diff,
      files: diff.files.map((file) =>
        file === changed ? { ...file, hunks: file.hunks.map((h) => ({ ...h })) } : file,
      ),
    }

    const second = new HighlightStore(new RowIndex(rebuilt), highlighter, ignore, cache)
    second.requestRange(0, new RowIndex(rebuilt).length - 1)
    await settle()

    // Only the file whose hunks are new objects was asked about again.
    const again = highlighter.calls.length - asked
    expect(again).toBeGreaterThan(0)
    expect(again).toBeLessThan(asked)
  })

  it('asks for nothing at all when no hunk changed', async () => {
    const diff = parseUnifiedDiff(readFixture('github', 'vite-pr-23346-normal.diff'))
    const rows = new RowIndex(diff)
    const cache = new HighlightCache()
    const highlighter = fakeHighlighter(() => '#FFF')

    new HighlightStore(rows, highlighter, ignore, cache).requestRange(0, rows.length - 1)
    await settle()
    const asked = highlighter.calls.length

    // A new index over the very same hunks: a layout switch, or a fold.
    const split = new RowIndex(diff, 'split')
    new HighlightStore(split, highlighter, ignore, cache).requestRange(0, split.length - 1)
    await settle()

    expect(highlighter.calls.length).toBe(asked)
  })

  it('keeps a cache of its own when none is handed to it', async () => {
    const { rows } = load('vite-pr-23346-normal.diff')
    const highlighter = fakeHighlighter(() => '#FFF')

    const a = new HighlightStore(rows, highlighter, ignore)
    const b = new HighlightStore(rows, highlighter, ignore)
    a.requestRange(0, rows.length - 1)
    b.requestRange(0, rows.length - 1)
    await settle()

    expect(a.requested).toBe(b.requested)
  })
})
