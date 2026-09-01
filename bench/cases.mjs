import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSyntheticDiff } from './synthetic.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..')

/**
 * Synthetic sizes come from the targets in the README; the real diffs are the
 * ones that make the synthetic numbers believable. A viewer tuned on generated
 * input and never shown a regenerated lockfile is tuned on a fiction.
 */
export const CASES = [
  { name: 'synthetic-1k', label: '1k lines', kind: 'synthetic', lines: 1_000 },
  { name: 'synthetic-10k', label: '10k lines', kind: 'synthetic', lines: 10_000 },
  { name: 'synthetic-50k', label: '50k lines', kind: 'synthetic', lines: 50_000 },
  { name: 'synthetic-100k', label: '100k lines', kind: 'synthetic', lines: 100_000 },
  {
    name: 'real-kernel',
    label: 'Linux kernel commit — 758 files',
    kind: 'real',
    fixture: 'github/linux-93e4b307-huge.diff',
  },
  {
    name: 'real-minified',
    label: 'Minified bundles — 371 KB in 128 lines',
    kind: 'real',
    fixture: 'github/npm-cli-75a943de-minified-bundle.diff',
  },
  {
    name: 'real-mass-rename',
    label: '168 files, mostly renames',
    kind: 'real',
    fixture: 'github/npm-cli-47fc8b19-mass-rename.diff',
  },
]

/** Writes every case into `outDir` as `<name>.diff`. */
export function materializeCases(outDir) {
  mkdirSync(outDir, { recursive: true })

  return CASES.map((testCase) => {
    const source =
      testCase.kind === 'synthetic'
        ? buildSyntheticDiff(testCase.lines)
        : readFileSync(join(repoRoot, 'fixtures', testCase.fixture), 'utf8')

    writeFileSync(join(outDir, `${testCase.name}.diff`), source)
    return { ...testCase, bytes: Buffer.byteLength(source) }
  })
}
