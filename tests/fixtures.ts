import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures')

export type FixtureSet = 'github' | 'edge'

export function fixturePath(set: FixtureSet, name: string): string {
  return join(FIXTURES_DIR, set, name)
}

/** Read as latin1: a diff is a byte stream, and decoding it as UTF-8 would hide encoding bugs. */
export function readFixtureBytes(set: FixtureSet, name: string): Buffer {
  return readFileSync(fixturePath(set, name))
}

export function readFixture(set: FixtureSet, name: string): string {
  return readFileSync(fixturePath(set, name), 'utf8')
}

export function listFixtures(set: FixtureSet): string[] {
  return readdirSync(join(FIXTURES_DIR, set))
    .filter((name) => name.endsWith('.diff'))
    .sort()
}

export function readChecksums(set: FixtureSet): Map<string, string> {
  const raw = readFileSync(join(FIXTURES_DIR, set, 'CHECKSUMS'), 'utf8')
  const entries = raw
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [hash, ...rest] = line.split(/\s+/)
      const name = rest.join(' ').replace(/^\*/, '').replace(/^\.\//, '')
      return [name, hash] as const
    })
  return new Map(entries as Iterable<readonly [string, string]>)
}
