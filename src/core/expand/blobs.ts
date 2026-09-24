import { authorized } from '../source/github'

/** Where the diff came from, and therefore where its files can be fetched. */
export interface DiffOrigin {
  readonly owner: string
  readonly repo: string
  /**
   * What to fetch the files at. `refs/pull/123/head` for a pull request: it
   * resolves in the base repository however far the branch lives from it, so
   * the fork most pull requests come from never has to be looked up, and the
   * metadata call that would find it is never made.
   *
   * It follows the pull request rather than pinning a commit, so a file may
   * arrive newer than the diff. `fileMatchesDiff` is what refuses that.
   */
  readonly ref: string
}

/** The ref that resolves to a pull request's head in the base repository. */
export function pullRequestRef(number: number): string {
  return `refs/pull/${number}/head`
}

/**
 * Why a file could not be fetched, named like every other failure here.
 *
 * It used to be a free-form string, which was survivable while there was one
 * route and two things that could go wrong. The API route brings a rejected
 * token and a spent limit, and those need their own words.
 */
export type BlobFailure =
  | { readonly kind: 'not-in-commit'; readonly path: string }
  | { readonly kind: 'bad-credentials' }
  | { readonly kind: 'rate-limited' }
  | { readonly kind: 'offline'; readonly reason: string }
  | { readonly kind: 'refused'; readonly status: number }

export type BlobResult =
  | { readonly ok: true; readonly lines: readonly string[] }
  | { readonly ok: false; readonly failure: BlobFailure }

export function describeBlobFailure(failure: BlobFailure): string {
  switch (failure.kind) {
    case 'not-in-commit':
      return `${failure.path} is not in the commit this diff came from.`
    case 'bad-credentials':
      return 'GitHub rejected your token — it may have expired since the diff was loaded.'
    case 'rate-limited':
      return 'GitHub’s hourly limit is spent. Expanding will work again once it resets.'
    case 'offline':
      return `The request never reached GitHub: ${failure.reason}.`
    case 'refused':
      return `GitHub answered ${failure.status} for that file.`
  }
}

/**
 * Files fetched to fill in what a diff left out, kept for as long as the diff
 * is open.
 *
 * Two routes, and the token decides which. Both were measured in a browser.
 *
 * Without one, `raw.githubusercontent.com`: it allows any origin, returns the
 * same bytes as the API, and reports no rate-limit headers at all — it is
 * free. Expanding context is something a reader does repeatedly, and a viewer
 * that ran out after sixty clicks would be a demonstration rather than a tool.
 *
 * With one, the API, because raw cannot be authenticated: adding the header
 * turns the request into a preflight that raw rejects outright, and the fetch
 * fails before it is sent. The API answers that preflight. It spends one of
 * the hourly limit per file, but a token raises that limit from sixty to five
 * thousand, so the trade is worth making by a wide margin.
 *
 * One request per file, and the answer is kept: opening a second gap in a
 * file already fetched costs nothing.
 */
export class BlobStore {
  private readonly origin: DiffOrigin
  private readonly fetchImpl: typeof fetch
  private readonly token: string | null
  private readonly cache = new Map<string, Promise<BlobResult>>()

  constructor(origin: DiffOrigin, fetchImpl: typeof fetch = fetch, token: string | null = null) {
    this.origin = origin
    this.token = token === '' ? null : token
    // Bound, not stored bare. `this.fetchImpl(url)` hands the store to `fetch`
    // as its `this`, and the browser answers "Illegal invocation" — which is
    // exactly what a real page did, while every fake in the tests, being an
    // ordinary function, did not care.
    this.fetchImpl = fetchImpl.bind(globalThis)
  }

  /** The URL a path resolves to, so a test can say what was asked for. */
  urlFor(path: string): string {
    const { owner, repo, ref } = this.origin
    const encoded = path.split('/').map(encodeURIComponent).join('/')
    if (this.token === null) {
      return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${encoded}`
    }
    // The ref goes in the query rather than the path: it contains slashes,
    // and the API reads it as a parameter, not as part of the file's name.
    return `https://api.github.com/repos/${owner}/${repo}/contents/${encoded}?ref=${encodeURIComponent(ref)}`
  }

  /** The file, split into lines. Asked for once however often it is wanted. */
  linesOf(path: string): Promise<BlobResult> {
    const waiting = this.cache.get(path)
    if (waiting !== undefined) return waiting

    const request = this.load(path)
    this.cache.set(path, request)
    return request
  }

  /** What has been fetched so far, for tests and for saying so on screen. */
  get fetched(): number {
    return this.cache.size
  }

  private async load(path: string): Promise<BlobResult> {
    let response: Response
    try {
      // The raw route sends no headers at all. Anything it does not need is
      // a preflight it would fail.
      response = await this.fetchImpl(
        this.urlFor(path),
        this.token === null
          ? undefined
          : { headers: authorized({ Accept: 'application/vnd.github.raw' }, this.token) },
      )
    } catch (error) {
      return {
        ok: false,
        failure: {
          kind: 'offline',
          reason: error instanceof Error ? error.message : String(error),
        },
      }
    }

    if (!response.ok) return { ok: false, failure: failureOf(response, path) }

    return { ok: true, lines: splitLines(await response.text()) }
  }
}

function failureOf(response: Response, path: string): BlobFailure {
  if (response.status === 401) return { kind: 'bad-credentials' }
  if (response.status === 404) return { kind: 'not-in-commit', path }
  if (
    (response.status === 403 || response.status === 429) &&
    response.headers.get('x-ratelimit-remaining') === '0'
  ) {
    return { kind: 'rate-limited' }
  }
  return { kind: 'refused', status: response.status }
}

const NEWLINE = String.fromCharCode(10)
const RETURN = String.fromCharCode(13)

/**
 * One entry per line of the file, with no phantom line after a trailing
 * newline — a file ending in one does not have an extra empty line at the
 * end, and counting one would push every later line number out by one.
 */
export function splitLines(text: string): string[] {
  if (text === '') return []
  const body = text.endsWith(NEWLINE) ? text.slice(0, -1) : text
  return body.split(NEWLINE).map((line) => (line.endsWith(RETURN) ? line.slice(0, -1) : line))
}
