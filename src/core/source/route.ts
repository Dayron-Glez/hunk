import type { PullRequestRef } from './github'

/**
 * What the address bar says, and what it means.
 *
 * A pull request gets a path of its own so it can be linked to, reloaded and
 * gone back from. A diff that was pasted or dropped gets none: there is
 * nothing in a URL that could bring those bytes back, and a link that looked
 * shareable and restored an empty page would be worse than no link.
 *
 * `base` is where the application is served from, which is not always the
 * root — a build published under `/hunk/` has to strip that before reading
 * anything, and put it back before writing.
 */
export type Route =
  { readonly kind: 'picker' } | { readonly kind: 'pull-request'; readonly ref: PullRequestRef }

const NAME = /^[\w.-]+$/

/** The path a pull request is shown at. */
export function pathOf(ref: PullRequestRef, base = '/'): string {
  return `${trimEnd(base)}/${ref.owner}/${ref.repo}/pull/${ref.number}`
}

/** What a path asks for. Anything unrecognised is the picker. */
export function routeOf(pathname: string, base = '/'): Route {
  const prefix = trimEnd(base)
  if (prefix !== '' && !pathname.startsWith(prefix)) return PICKER

  const rest = pathname.slice(prefix.length)
  const parts = rest.split('/').filter((part) => part !== '')
  if (parts.length !== 4 || parts[2] !== 'pull') return PICKER

  const [owner, repo, , number] = parts as [string, string, string, string]
  const parsed = Number(number)
  if (!Number.isInteger(parsed) || parsed <= 0) return PICKER
  if (!NAME.test(owner) || !NAME.test(repo)) return PICKER

  return { kind: 'pull-request', ref: { owner, repo, number: parsed } }
}

const PICKER: Route = { kind: 'picker' }

function trimEnd(base: string): string {
  return base.endsWith('/') ? base.slice(0, -1) : base
}
