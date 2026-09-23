import type { LoadFailure } from '../core/source/github'

/**
 * What to put in front of the reader when a pull request will not load.
 *
 * Separated from the component and tested, because these sentences are the
 * whole value of naming the failures in the first place. A viewer that says
 * "something went wrong" has thrown that away.
 */
export function describeFailure(failure: LoadFailure, now: Date = new Date()): string {
  switch (failure.kind) {
    case 'unreadable':
      return 'That does not look like a pull request link. Try github.com/owner/repo/pull/123.'

    case 'not-found':
      return `No pull request ${failure.ref.owner}/${failure.ref.repo}#${failure.ref.number}. If it is in a private repository, hunk cannot reach it — drop the .diff file instead.`

    case 'rate-limited':
      return `GitHub allows sixty requests an hour without an account, and this address has used them${untilWhen(failure.resetsAt, now)}. Dropping a .diff file works meanwhile.`

    case 'too-large':
      return `GitHub will not generate a diff this large. Download it from the pull request and drop the file here — hunk itself has no trouble with the size.`

    case 'offline':
      return `The request never reached GitHub: ${failure.reason}.`

    case 'refused':
      return `GitHub refused the request: ${failure.message} (HTTP ${failure.status}).`
  }
}

/** Only if the header said so, and only if it is still in the future. */
function untilWhen(resetsAt: Date | null, now: Date): string {
  if (resetsAt === null) return ''
  const minutes = Math.ceil((resetsAt.getTime() - now.getTime()) / 60_000)
  if (minutes <= 0) return ' — it should be clear now'
  if (minutes === 1) return ' — one more minute'
  return ` — about ${minutes} more minutes`
}
