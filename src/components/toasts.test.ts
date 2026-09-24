import { describe, expect, it } from 'vitest'
import { describeFileFailure, type FileFailure } from '../core/source/file'
import { TOAST_DURATION_MS } from './toasts'

/** An unhurried pace, not a skim: three words a second. */
const WORDS_PER_SECOND = 3
/** Before any of it is read, the thing has to be noticed in the corner. */
const NOTICING_MS = 1_000

const wordsIn = (text: string): number => text.split(/\s+/).filter(Boolean).length

const readingTimeOf = (text: string): number =>
  NOTICING_MS + (wordsIn(text) / WORDS_PER_SECOND) * 1_000

/**
 * What the duration buys, in words.
 *
 * Tied to the strings rather than left as a number someone liked, so a
 * message written longer later fails here instead of quietly outrunning the
 * time it is given.
 */
const AFFORDS_WORDS = ((TOAST_DURATION_MS - NOTICING_MS) / 1_000) * WORDS_PER_SECOND

describe('how long a message is given', () => {
  it('is longer than the default it replaces', () => {
    expect(TOAST_DURATION_MS).toBeGreaterThan(4_000)
  })

  it('affords a sentence, not a word', () => {
    expect(AFFORDS_WORDS).toBeGreaterThanOrEqual(12)
  })

  /** Every message raised by the token control and by a file that loaded. */
  it.each([
    ['a token accepted', 'Token accepted — 5,000 requests an hour, private repositories included.'],
    ['a token rejected', 'GitHub rejected that token.'],
    ['a token unchecked', 'The token could not be checked — GitHub was not reachable.'],
    ['a token forgotten', 'Token forgotten. Public repositories only, sixty requests an hour.'],
    ['a file that loaded', 'change.diff — 12 files changed.'],
  ])('is long enough to read %s', (_what, message) => {
    expect(readingTimeOf(message)).toBeLessThanOrEqual(TOAST_DURATION_MS)
  })
})

/**
 * The exception, written down rather than left to be discovered.
 *
 * Refusing a file takes three sentences on purpose — "unsupported file" is
 * the message that helps nobody — and three sentences do not fit in five
 * seconds. These are the toasts that rely on the close button and on the
 * reader's own eyes rather than on the clock.
 *
 * The test is here so the size of the gap is a number somebody chose and
 * can see growing, not a surprise. If one of them doubles, this says so.
 */
describe('the messages that outrun it', () => {
  const NAME = 'holiday-video-from-last-summer.mp4'

  const ALL: readonly FileFailure[] = [
    { kind: 'too-large', name: NAME, bytes: 734_003_200 },
    { kind: 'binary', name: NAME },
    { kind: 'not-a-diff', name: NAME },
  ]

  it.each(ALL.map((failure) => [failure.kind, failure] as const))(
    'refusing a file for being %s runs long, but not runaway',
    (_kind, failure) => {
      const needed = readingTimeOf(describeFileFailure(failure))
      expect(needed).toBeGreaterThan(TOAST_DURATION_MS)
      expect(needed).toBeLessThanOrEqual(TOAST_DURATION_MS * 2)
    },
  )
})
