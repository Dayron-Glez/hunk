import { describe, expect, it } from 'vitest'
import { listFixtures, readFixture } from '../../../tests/fixtures'
import { unquoteGitPath } from './gitPath'
import type { DiffFile, ParsedDiff } from './types'
import { parseUnifiedDiff } from './unified'

const edge = (name: string): ParsedDiff => parseUnifiedDiff(readFixture('edge', name))
const github = (name: string): ParsedDiff => parseUnifiedDiff(readFixture('github', name))

const onlyFile = (parsed: ParsedDiff): DiffFile => {
  expect(parsed.files).toHaveLength(1)
  return parsed.files[0]!
}

describe('no newline at end of file', () => {
  it('marks the added line when the new side loses its newline', () => {
    const hunk = onlyFile(edge('no-newline-added.diff')).hunks[0]
    const last = hunk?.lines.at(-1)
    expect(last).toMatchObject({ kind: 'insert', content: 'DELTA', noNewlineAtEof: true })
  })

  it('marks the removed line when the old side lacked its newline', () => {
    const lines = onlyFile(edge('no-newline-removed.diff')).hunks[0]?.lines ?? []
    expect(lines.filter((line) => line.noNewlineAtEof)).toMatchObject([
      { kind: 'delete', content: 'charlie' },
    ])
  })

  it('marks both sides when neither ends with a newline', () => {
    const lines = onlyFile(edge('no-newline-both.diff')).hunks[0]?.lines ?? []
    expect(lines.filter((line) => line.noNewlineAtEof)).toMatchObject([
      { kind: 'delete', content: 'charlie' },
      { kind: 'insert', content: 'ECHO' },
    ])
  })
})

describe('mode changes', () => {
  it('reads a file that carries a mode change and nothing else', () => {
    const file = onlyFile(edge('mode-change-only.diff'))
    expect(file).toMatchObject({
      oldPath: 'lf.txt',
      newPath: 'lf.txt',
      status: 'modified',
      oldMode: '100644',
      newMode: '100755',
      binary: false,
    })
    expect(file.hunks).toHaveLength(0)
  })

  it('keeps both modes when the index line drops its mode suffix', () => {
    const file = onlyFile(edge('mode-change-with-content.diff'))
    expect(file.oldMode).toBe('100644')
    expect(file.newMode).toBe('100755')
    expect(file.hunks).toHaveLength(1)
    expect(file.additions).toBe(1)
    expect(file.deletions).toBe(1)
  })
})

describe('empty inputs', () => {
  it('parses an empty diff into no files and no complaints', () => {
    expect(edge('empty.diff')).toEqual({ files: [], additions: 0, deletions: 0, warnings: [] })
  })

  it('parses an added empty file, which has no hunks to describe it', () => {
    const file = onlyFile(edge('empty-file-add.diff'))
    expect(file).toMatchObject({ oldPath: null, newPath: 'blank.txt', status: 'added' })
    expect(file.hunks).toHaveLength(0)
  })

  it('parses a deleted empty file', () => {
    const file = onlyFile(edge('empty-file-delete.diff'))
    expect(file).toMatchObject({ oldPath: 'blank.txt', newPath: null, status: 'deleted' })
  })
})

describe('paths', () => {
  it('splits a header whose paths contain spaces', () => {
    const file = onlyFile(edge('path-with-spaces.diff'))
    expect(file.oldPath).toBe('spaced name.txt')
    expect(file.newPath).toBe('spaced name.txt')
  })

  it('keeps a tab that belongs to the content, not to the path terminator', () => {
    const lines = onlyFile(edge('path-with-spaces.diff')).hunks[0]?.lines ?? []
    expect(lines.map((line) => line.content)).toEqual(['a b\tc', 'a b\tc d'])
  })

  it('decodes an octal-escaped non-ASCII path', () => {
    const file = onlyFile(edge('path-quoted-utf8.diff'))
    expect(file.oldPath).toBe('café ☕.txt')
    expect(file.newPath).toBe('café ☕.txt')
  })
})

describe('unquoteGitPath', () => {
  it('leaves an unquoted path alone', () => {
    expect(unquoteGitPath('src/index.ts')).toBe('src/index.ts')
  })

  it('decodes octal escapes as UTF-8 bytes rather than one character each', () => {
    expect(unquoteGitPath('"caf\\303\\251"')).toBe('café')
  })

  it('decodes the short escapes', () => {
    expect(unquoteGitPath('"a\\tb\\nc\\"d"')).toBe('a\tb\nc"d')
  })

  it('decodes a backslash in a path', () => {
    expect(unquoteGitPath('"a\\\\b"')).toBe('a\\b')
  })
})

describe('line endings', () => {
  it('keeps carriage returns that are content', () => {
    const lines = onlyFile(edge('crlf.diff')).hunks[0]?.lines ?? []
    expect(lines.map((line) => line.content)).toEqual([
      'alpha\r',
      'bravo\r',
      'BRAVO\r',
      'charlie\r',
    ])
  })

  it('strips carriage returns from a patch that was saved with CRLF endings', () => {
    const asWindowsPatch = readFixture('edge', 'many-hunks.diff').replace(/\n/g, '\r\n')
    const lines = onlyFile(parseUnifiedDiff(asWindowsPatch)).hunks[0]?.lines ?? []
    expect(lines.every((line) => !line.content.includes('\r'))).toBe(true)
  })
})

describe('hunk headers', () => {
  it('defaults an omitted count to one', () => {
    const hunk = onlyFile(edge('single-line-hunk-header.diff')).hunks[0]
    expect(hunk).toMatchObject({ oldStart: 1, oldCount: 1, newStart: 1, newCount: 1 })
  })

  it('splits one file into several hunks', () => {
    const file = onlyFile(edge('many-hunks.diff'))
    expect(file.hunks).toHaveLength(3)
    expect(file.additions).toBe(3)
    expect(file.deletions).toBe(3)
  })

  it('reports a combined diff instead of mangling it', () => {
    const parsed = parseUnifiedDiff(
      [
        'diff --cc merged.txt',
        'index 1111111,2222222..3333333',
        '--- a/merged.txt',
        '+++ b/merged.txt',
        '@@@ -1,2 -1,2 +1,3 @@@',
        '  context',
        ' +ours',
        '++theirs',
        '',
      ].join('\n'),
    )
    expect(parsed.files[0]?.combined).toBe(true)
    expect(parsed.warnings.map((warning) => warning.message)).toContain(
      'combined (merge) diffs are not supported',
    )
  })
})

describe('unicode content', () => {
  it('decodes multi-byte content without mangling it', () => {
    const lines = onlyFile(edge('unicode.diff')).hunks[0]?.lines ?? []
    expect(lines.map((line) => line.content)).toEqual([
      'café ☕',
      '日本語',
      '日本語!',
      'עברית',
      '👩‍👩‍👧',
      '👨‍👩‍👦',
    ])
  })
})

describe('real pull requests', () => {
  it('reads an ordinary two-file pull request', () => {
    const parsed = github('vite-pr-23346-normal.diff')
    expect(parsed.files.map((file) => file.newPath)).toEqual([
      'packages/vite/src/node/__tests__/utils.spec.ts',
      'packages/vite/src/node/utils.ts',
    ])
    expect(parsed.additions).toBe(21)
    expect(parsed.deletions).toBe(1)
    expect(parsed.warnings).toEqual([])
  })

  it('reads added files in a pull request', () => {
    const parsed = github('vite-pr-23378-new-files.diff')
    const added = parsed.files.filter((file) => file.status === 'added')
    expect(added.length).toBeGreaterThan(0)
    expect(added.every((file) => file.oldPath === null && file.newPath !== null)).toBe(true)
  })
})

describe('renames', () => {
  it('reads a rename with full similarity and no content hunks', () => {
    const parsed = github('prettier-bb52ae36-rename.diff')
    const renamed = parsed.files.filter((file) => file.status === 'renamed')
    expect(renamed).toMatchObject([
      {
        oldPath: 'tests/format/js/label/empty_label.js',
        newPath: 'tests/format/js/label/empty-label.js',
        similarity: 100,
      },
    ])
    expect(renamed[0]?.hunks).toHaveLength(0)
  })

  it('reads a diff that is mostly renames', () => {
    const parsed = github('npm-cli-47fc8b19-mass-rename.diff')
    expect(parsed.files).toHaveLength(168)
    expect(parsed.files.filter((file) => file.status === 'renamed').length).toBeGreaterThan(100)
    expect(parsed.files.every((file) => file.oldPath !== null || file.newPath !== null)).toBe(true)
  })
})

describe('binary files', () => {
  it('flags an added binary alongside a text change', () => {
    const parsed = github('github-docs-90ce4889-binary-add.diff')
    const binary = parsed.files.filter((file) => file.binary)
    expect(binary).toMatchObject([
      {
        newPath: 'assets/images/help/billing/request-budget-flow.png',
        oldPath: null,
        status: 'added',
      },
    ])
    expect(binary[0]?.hunks).toHaveLength(0)
    expect(parsed.files.filter((file) => !file.binary)).toHaveLength(1)
  })

  it('flags a deleted binary, which has no hunks at all', () => {
    const file = onlyFile(github('github-docs-5dc99214-binary-delete.diff'))
    expect(file).toMatchObject({
      oldPath: 'assets/images/banner-images/hero-home.png',
      newPath: null,
      status: 'deleted',
      binary: true,
    })
    expect(file.additions).toBe(0)
    expect(file.deletions).toBe(0)
  })
})

describe('submodules', () => {
  it('recognises a submodule by its 160000 mode when one is added', () => {
    const parsed = github('git-86cfd61e-submodule-add.diff')
    const submodules = parsed.files.filter((file) => file.submodule)
    expect(submodules).toMatchObject([
      { newPath: 'sha1collisiondetection', status: 'added', newMode: '160000' },
    ])
    expect(submodules[0]?.hunks[0]?.lines[0]?.content).toMatch(/^Subproject commit /)
  })

  it('recognises a submodule whose mode only appears on the index line', () => {
    const parsed = github('git-4125f782-submodule-bump.diff')
    const bumped = parsed.files.find((file) => file.newPath === 'sha1collisiondetection')
    expect(bumped).toMatchObject({ submodule: true, status: 'modified', newMode: '160000' })
    expect(bumped?.additions).toBe(1)
    expect(bumped?.deletions).toBe(1)
  })
})

describe('the diffs that break other viewers', () => {
  it('reads 758 files without complaint', () => {
    const parsed = github('linux-93e4b307-huge.diff')
    expect(parsed.files).toHaveLength(758)
    expect(parsed.warnings).toEqual([])
  })

  it('keeps very long lines intact instead of splitting them', () => {
    const parsed = github('npm-cli-75a943de-minified-bundle.diff')
    const longest = parsed.files
      .flatMap((file) => file.hunks)
      .flatMap((hunk) => hunk.lines)
      .reduce((widest, line) => Math.max(widest, line.content.length), 0)
    expect(longest).toBeGreaterThan(50_000)
    expect(parsed.warnings).toEqual([])
  })
})

describe.each([
  ...listFixtures('edge').map((n) => ['edge', n]),
  ...listFixtures('github').map((n) => ['github', n]),
] as const)('%s/%s holds the parser invariants', (set, name) => {
  const parsed = parseUnifiedDiff(readFixture(set as 'edge' | 'github', name))

  it('reports a line count that matches its hunk headers', () => {
    for (const file of parsed.files) {
      for (const hunk of file.hunks) {
        const context = hunk.lines.filter((line) => line.kind === 'context').length
        const inserts = hunk.lines.filter((line) => line.kind === 'insert').length
        const deletes = hunk.lines.filter((line) => line.kind === 'delete').length
        expect({ old: context + deletes, new: context + inserts }).toEqual({
          old: hunk.oldCount,
          new: hunk.newCount,
        })
      }
    }
  })

  it('numbers every line consecutively from the hunk start', () => {
    for (const file of parsed.files) {
      for (const hunk of file.hunks) {
        let oldNumber = hunk.oldStart
        let newNumber = hunk.newStart
        for (const line of hunk.lines) {
          if (line.kind !== 'insert') {
            expect(line.oldNumber).toBe(oldNumber)
            oldNumber += 1
          } else {
            expect(line.oldNumber).toBeNull()
          }
          if (line.kind !== 'delete') {
            expect(line.newNumber).toBe(newNumber)
            newNumber += 1
          } else {
            expect(line.newNumber).toBeNull()
          }
        }
      }
    }
  })

  it('totals additions and deletions from the lines it actually produced', () => {
    let additions = 0
    let deletions = 0
    for (const file of parsed.files) {
      const lines = file.hunks.flatMap((hunk) => hunk.lines)
      expect(file.additions).toBe(lines.filter((line) => line.kind === 'insert').length)
      expect(file.deletions).toBe(lines.filter((line) => line.kind === 'delete').length)
      additions += file.additions
      deletions += file.deletions
    }
    expect(parsed.additions).toBe(additions)
    expect(parsed.deletions).toBe(deletions)
  })

  it('names at least one side of every file', () => {
    for (const file of parsed.files) {
      expect(file.oldPath ?? file.newPath).not.toBeNull()
    }
  })
})
