/** Where the diff came from, and therefore where its files can be fetched. */
export interface DiffOrigin {
  /** The repository the head commit lives in — a fork, for most pull requests. */
  readonly owner: string
  readonly repo: string
  /** The head commit, which is the revision the new side of the diff is at. */
  readonly sha: string
}

export type BlobResult =
  | { readonly ok: true; readonly lines: readonly string[] }
  | { readonly ok: false; readonly reason: string }

/**
 * Files fetched to fill in what a diff left out, kept for as long as the diff
 * is open.
 *
 * Through `raw.githubusercontent.com` rather than the API. Both were measured
 * in a browser: both allow any origin and return the same bytes, but the API
 * spends one of sixty requests an hour and raw spends none — it reports no
 * rate-limit headers at all. Expanding context is something a reader does
 * repeatedly, and a viewer that ran out after sixty clicks would be a
 * demonstration rather than a tool.
 *
 * One request per file, and the answer is kept: opening a second gap in a
 * file already fetched costs nothing.
 */
export class BlobStore {
  private readonly origin: DiffOrigin
  private readonly fetchImpl: typeof fetch
  private readonly cache = new Map<string, Promise<BlobResult>>()

  constructor(origin: DiffOrigin, fetchImpl: typeof fetch = fetch) {
    this.origin = origin
    // Bound, not stored bare. `this.fetchImpl(url)` hands the store to `fetch`
    // as its `this`, and the browser answers "Illegal invocation" — which is
    // exactly what a real page did, while every fake in the tests, being an
    // ordinary function, did not care.
    this.fetchImpl = fetchImpl.bind(globalThis)
  }

  /** The URL a path resolves to, so a test can say what was asked for. */
  urlFor(path: string): string {
    const { owner, repo, sha } = this.origin
    const encoded = path.split('/').map(encodeURIComponent).join('/')
    return `https://raw.githubusercontent.com/${owner}/${repo}/${sha}/${encoded}`
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
      response = await this.fetchImpl(this.urlFor(path))
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) }
    }

    if (!response.ok) {
      return {
        ok: false,
        reason:
          response.status === 404
            ? 'that file is not in the commit this diff came from'
            : `GitHub answered ${response.status}`,
      }
    }

    return { ok: true, lines: splitLines(await response.text()) }
  }
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
