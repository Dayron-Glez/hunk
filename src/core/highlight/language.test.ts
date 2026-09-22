import { describe, expect, it } from 'vitest'
import { readFixture } from '../../../tests/fixtures'
import { parseUnifiedDiff } from '../parse/unified'
import { GRAMMARS } from '../../workers/grammars'
import { SUPPORTED_LANGUAGES, languageOf } from './language'

describe('by extension', () => {
  it('maps the common ones', () => {
    expect(languageOf('src/core/parse/unified.ts')).toBe('typescript')
    expect(languageOf('src/App.tsx')).toBe('tsx')
    expect(languageOf('vite.config.js')).toBe('javascript')
    expect(languageOf('package.json')).toBe('json')
    expect(languageOf('styles/main.scss')).toBe('scss')
    expect(languageOf('README.md')).toBe('markdown')
    expect(languageOf('kernel/sched/core.c')).toBe('c')
  })

  it('ignores the case of the extension', () => {
    expect(languageOf('SCRIPT.PY')).toBe('python')
  })
})

describe('by filename', () => {
  it('recognises names that carry no extension', () => {
    expect(languageOf('Dockerfile')).toBe('docker')
    expect(languageOf('build/Makefile')).toBe('make')
    expect(languageOf('.editorconfig')).toBe('ini')
  })

  it('prefers the name over anything the extension rules would say', () => {
    expect(languageOf('deploy/dockerfile')).toBe('docker')
  })
})

describe('saying no', () => {
  it('returns null for an unknown extension', () => {
    expect(languageOf('data/archive.tar')).toBeNull()
    expect(languageOf('image.png')).toBeNull()
  })

  it('treats a dotfile with no second dot as having no extension', () => {
    expect(languageOf('.gitignore')).toBeNull()
    expect(languageOf('.env')).toBeNull()
  })

  it('returns null for a deleted file, which has no new path', () => {
    expect(languageOf(null)).toBeNull()
  })

  it('returns null for an empty or trailing-slash path', () => {
    expect(languageOf('')).toBeNull()
    expect(languageOf('src/')).toBeNull()
  })

  it('does not choke on a path with no directory', () => {
    expect(languageOf('main.rs')).toBe('rust')
  })
})

describe('the declared list', () => {
  it('holds every grammar the map can produce, once each', () => {
    expect(new Set(SUPPORTED_LANGUAGES).size).toBe(SUPPORTED_LANGUAGES.length)
    for (const path of ['a.ts', 'a.tsx', 'Dockerfile', 'a.rs', 'a.yml']) {
      expect(SUPPORTED_LANGUAGES).toContain(languageOf(path))
    }
  })
})

describe('against the corpus', () => {
  it('resolves a grammar for most of a real pull request, and null for the rest', () => {
    const diff = parseUnifiedDiff(readFixture('github', 'vite-pr-23378-new-files.diff'))
    const decided = diff.files.map((file) => languageOf(file.newPath ?? file.oldPath))
    expect(decided.filter((lang) => lang !== null).length).toBeGreaterThan(0)
    expect(decided.every((lang) => lang === null || SUPPORTED_LANGUAGES.includes(lang))).toBe(true)
  })

  it('never asks for a grammar for a binary file', () => {
    const diff = parseUnifiedDiff(readFixture('github', 'github-docs-90ce4889-binary-add.diff'))
    const binary = diff.files.find((file) => file.binary)
    expect(languageOf(binary?.newPath ?? null)).toBeNull()
  })
})

/**
 * Two lists that must not drift: one decides what to ask for, the other decides
 * what can be loaded. A language in the first and missing from the second is a
 * file that silently renders plain.
 */
describe('the grammar map agrees with the language map', () => {
  it('can load every language the detector can name', () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      expect(Object.keys(GRAMMARS)).toContain(lang)
    }
  })

  it('carries no grammar nothing will ever ask for', () => {
    for (const lang of Object.keys(GRAMMARS)) {
      expect(SUPPORTED_LANGUAGES).toContain(lang)
    }
  })
})
