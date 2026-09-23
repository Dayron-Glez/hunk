import { describe, expect, it } from 'vitest'
import { readFixture } from '../../../tests/fixtures'
import { MAX_FILE_BYTES, acceptDiff, acceptSize, describeFileFailure } from './file'

const NEWLINE = String.fromCharCode(10)
const NUL = String.fromCharCode(0)

const DIFF = [
  'diff --git a/a.ts b/a.ts',
  '--- a/a.ts',
  '+++ b/a.ts',
  '@@ -1 +1 @@',
  '-old',
  '+new',
  '',
].join(NEWLINE)

describe('what counts as a diff', () => {
  it('takes one, and says how many files are in it', () => {
    expect(acceptDiff('change.diff', DIFF)).toMatchObject({ ok: true, files: 1 })
  })

  /** The extension is a claim; the parser is evidence. People rename things,
   *  and a `.txt` holding git output is a perfectly good diff. */
  it('does not care what the file is called', () => {
    expect(acceptDiff('notes.txt', DIFF).ok).toBe(true)
    expect(acceptDiff('no-extension', DIFF).ok).toBe(true)
  })

  it('takes a real one from the corpus', () => {
    const result = acceptDiff('linux.diff', readFixture('github', 'linux-93e4b307-huge.diff'))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.files).toBe(758)
  })

  it('takes a plain unified diff with no git header', () => {
    const plain = ['--- a/a.ts', '+++ b/a.ts', '@@ -1 +1 @@', '-old', '+new', ''].join(NEWLINE)
    expect(acceptDiff('patch.txt', plain).ok).toBe(true)
  })
})

describe('what does not', () => {
  it('refuses prose', () => {
    const result = acceptDiff('README.md', '# A readme' + NEWLINE + 'Some words.')
    expect(result).toEqual({ ok: false, failure: { kind: 'not-a-diff', name: 'README.md' } })
  })

  it('refuses an empty file', () => {
    expect(acceptDiff('empty.diff', '')).toMatchObject({ ok: false })
  })

  /** A picture read as text parses to nothing, and "no files in it" is a
   *  confusing way to say "that is an image". */
  it('knows a picture from a diff that is merely wrong', () => {
    const png = String.fromCharCode(137) + 'PNG' + NUL + NUL + 'IHDR'
    expect(acceptDiff('shot.png', png)).toEqual({
      ok: false,
      failure: { kind: 'binary', name: 'shot.png' },
    })
  })

  it('only sniffs the start, so a NUL far in does not decide it', () => {
    const long = DIFF + NEWLINE + 'x'.repeat(9000) + NUL
    expect(acceptDiff('odd.diff', long).ok).toBe(true)
  })
})

describe('size, before it is read', () => {
  it('lets an ordinary diff through', () => {
    expect(acceptSize('a.diff', 2_100_000)).toBeNull()
  })

  it('refuses something no diff would ever be', () => {
    expect(acceptSize('holiday.mp4', MAX_FILE_BYTES + 1)).toEqual({
      kind: 'too-large',
      name: 'holiday.mp4',
      bytes: MAX_FILE_BYTES + 1,
    })
  })

  it('takes one exactly at the ceiling', () => {
    expect(acceptSize('big.diff', MAX_FILE_BYTES)).toBeNull()
  })
})

/**
 * Three failures, three sentences. "Unsupported file" is the message that
 * helps nobody, which is the whole reason these are named.
 */
describe('what the reader is told', () => {
  it('says how big it was, and what hunk is for', () => {
    const said = describeFileFailure({ kind: 'too-large', name: 'holiday.mp4', bytes: 734_003_200 })
    expect(said).toContain('holiday.mp4')
    expect(said).toContain('700.0 MB')
  })

  it('says a picture is not text, and what to drop instead', () => {
    const said = describeFileFailure({ kind: 'binary', name: 'shot.png' })
    expect(said).toContain('not text')
    expect(said).toContain('.diff')
  })

  it('says what a diff has to look like', () => {
    const said = describeFileFailure({ kind: 'not-a-diff', name: 'README.md' })
    expect(said).toContain('README.md')
    expect(said).toContain('diff --git')
  })

  it('names the file in every one of them', () => {
    const all = [
      { kind: 'too-large', name: 'a', bytes: 1 },
      { kind: 'binary', name: 'b' },
      { kind: 'not-a-diff', name: 'c' },
    ] as const
    for (const failure of all) {
      const said = describeFileFailure(failure)
      expect(said).toContain(failure.name)
      expect(said).not.toContain('undefined')
    }
  })
})
