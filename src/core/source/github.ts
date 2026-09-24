/** A pull request, as three pieces that name it. */
export interface PullRequestRef {
  readonly owner: string
  readonly repo: string
  readonly number: number
}

/**
 * Everything that can go wrong, named.
 *
 * A tagged failure rather than a thrown error or a bare string: each of these
 * needs different words in front of the reader, and "something went wrong" is
 * the one message that helps nobody.
 */
export type LoadFailure =
  | { readonly kind: 'unreadable'; readonly input: string }
  | { readonly kind: 'not-found'; readonly ref: PullRequestRef }
  | { readonly kind: 'rate-limited'; readonly resetsAt: Date | null }
  | { readonly kind: 'bad-credentials' }
  | { readonly kind: 'too-large'; readonly ref: PullRequestRef }
  | { readonly kind: 'offline'; readonly reason: string }
  | { readonly kind: 'refused'; readonly status: number; readonly message: string }

export type LoadResult =
  | { readonly ok: true; readonly ref: PullRequestRef; readonly diff: string }
  | { readonly ok: false; readonly failure: LoadFailure }

/** GitHub's own limit on an owner or repository name, so nonsense is refused
 *  before it costs a request. */
const NAME = /^[\w.-]+$/

/**
 * The pull request a reader pasted, from whatever they pasted.
 *
 * A URL copied from a browser carries whatever tab they were on — `/files`,
 * `/commits`, a `#discussion_r...` anchor, a `?w=1` query — and none of that
 * changes which pull request it is. The `owner/repo#123` shorthand is here
 * because it is what people paste from an issue thread.
 */
export function parsePullRequestUrl(input: string): PullRequestRef | null {
  const text = input.trim()
  if (text === '') return null

  const shorthand = /^([\w.-]+)\/([\w.-]+)#(\d+)$/.exec(text)
  if (shorthand !== null) {
    return refOf(shorthand[1]!, shorthand[2]!, shorthand[3]!)
  }

  let url: URL
  try {
    url = new URL(text.includes('://') ? text : `https://${text}`)
  } catch {
    return null
  }

  const host = url.hostname.toLowerCase()
  if (host !== 'github.com' && host !== 'www.github.com') return null

  // /owner/repo/pull/123 and anything after it.
  const parts = url.pathname.split('/').filter((part) => part !== '')
  if (parts.length < 4) return null
  if (parts[2] !== 'pull' && parts[2] !== 'pulls') return null

  return refOf(parts[0]!, parts[1]!, parts[3]!)
}

function refOf(owner: string, repo: string, number: string): PullRequestRef | null {
  const parsed = Number(number)
  if (!Number.isInteger(parsed) || parsed <= 0) return null
  if (!NAME.test(owner) || !NAME.test(repo)) return null
  return { owner, repo: repo.replace(/\.git$/, ''), number: parsed }
}

/** Where the diff comes from, which is not where the reader copied the link. */
export function apiUrlFor(ref: PullRequestRef): string {
  return `https://api.github.com/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}`
}

/**
 * The diff of a pull request.
 *
 * Through the API rather than the `.diff` link a reader would paste, because
 * `github.com` sends no CORS headers and neither does
 * `patch-diff.githubusercontent.com` — both were tried, and both fail in a
 * browser. `api.github.com` allows any origin and answers the same bytes.
 *
 * Unauthenticated, sixty requests an hour per address, and nothing private.
 * A token lifts both: five thousand an hour, and whatever it was scoped to
 * read. Either ceiling is reported rather than hidden — a reader who hits one
 * should be told when it lifts, not shown a blank page.
 */
export async function fetchPullRequestDiff(
  ref: PullRequestRef,
  fetchImpl: typeof fetch = fetch,
  token: string | null = null,
): Promise<LoadResult> {
  let response: Response
  try {
    response = await fetchImpl(apiUrlFor(ref), {
      headers: authorized({ Accept: 'application/vnd.github.v3.diff' }, token),
    })
  } catch (error) {
    return { ok: false, failure: { kind: 'offline', reason: reasonOf(error) } }
  }

  if (response.ok) {
    const diff = await response.text()
    return { ok: true, ref, diff }
  }

  // Only ever the token: an anonymous request is not rejected for its
  // credentials, it is rejected for not having any, which is a 404 or a 403.
  if (response.status === 401) return { ok: false, failure: { kind: 'bad-credentials' } }

  if (response.status === 404) return { ok: false, failure: { kind: 'not-found', ref } }

  // 406 is what the API answers when the diff is past the size it will
  // generate. It says nothing useful in the body, so the status is the signal.
  if (response.status === 406) return { ok: false, failure: { kind: 'too-large', ref } }

  if (isRateLimited(response)) {
    return { ok: false, failure: { kind: 'rate-limited', resetsAt: resetOf(response) } }
  }

  return {
    ok: false,
    failure: { kind: 'refused', status: response.status, message: await messageOf(response) },
  }
}

/**
 * The token, where there is one.
 *
 * `api.github.com` answers a preflight for this header, which is why the
 * blobs a private diff needs come from here too rather than from
 * `raw.githubusercontent.com` — raw rejects the preflight outright.
 */
export function authorized(
  headers: Record<string, string>,
  token: string | null,
): Record<string, string> {
  return token === null || token === '' ? headers : { ...headers, Authorization: `Bearer ${token}` }
}

/** 403 and 429 both mean this, and only the header tells them from a refusal. */
function isRateLimited(response: Response): boolean {
  if (response.status !== 403 && response.status !== 429) return false
  return response.headers.get('x-ratelimit-remaining') === '0'
}

function resetOf(response: Response): Date | null {
  const header = response.headers.get('x-ratelimit-reset')
  if (header === null) return null
  const seconds = Number(header)
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : null
}

/** The API explains itself in JSON; fall back to the status when it does not. */
async function messageOf(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json()
    if (typeof body === 'object' && body !== null && 'message' in body) {
      const message = body.message
      if (typeof message === 'string' && message !== '') return message
    }
  } catch {
    // Not JSON, or nothing at all.
  }
  return response.statusText === '' ? `HTTP ${response.status}` : response.statusText
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
