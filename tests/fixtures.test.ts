import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { listFixtures, readChecksums, readFixtureBytes, type FixtureSet } from './fixtures'

const sets: FixtureSet[] = ['github', 'edge']
const NO_NEWLINE_MARKER = String.raw`\ No newline at end of file`

describe.each(sets)('%s fixture corpus', (set) => {
  const checksums = readChecksums(set)
  const names = listFixtures(set)

  it('is not empty', () => {
    expect(names.length).toBeGreaterThan(0)
  })

  it('has a checksum recorded for every file, and no orphan entries', () => {
    expect(names).toEqual([...checksums.keys()].sort())
  })

  it.each(names)('%s matches its checksum', (name) => {
    const digest = createHash('sha256').update(readFixtureBytes(set, name)).digest('hex')
    expect(digest).toBe(checksums.get(name))
  })
})

describe('edge fixtures keep the bytes that make them interesting', () => {
  const bytes = (name: string) => readFixtureBytes('edge', name).toString('latin1')

  it('keeps CRLF inside crlf.diff', () => {
    expect(bytes('crlf.diff')).toContain('alpha\r\n')
  })

  it('keeps the no-newline marker on both sides', () => {
    const both = bytes('no-newline-both.diff')
    expect(both.split(NO_NEWLINE_MARKER)).toHaveLength(3)
  })

  it('keeps the tab that terminates a path containing a space', () => {
    expect(bytes('path-with-spaces.diff')).toContain('--- a/spaced name.txt\t')
  })

  it('keeps empty.diff empty', () => {
    expect(bytes('empty.diff')).toBe('')
  })
})
