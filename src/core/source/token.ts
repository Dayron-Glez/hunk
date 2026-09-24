/**
 * A GitHub token the reader supplied, so hunk can read what is theirs.
 *
 * Without one this viewer sees public repositories and sixty requests an
 * hour. Most diffs worth reading are neither, which is the line between a
 * demonstration and a tool.
 *
 * The token is the reader's, kept where they put it and sent nowhere but
 * `api.github.com`. It never enters a URL: the paths this application pushes
 * are meant to be shared, and a credential in one would be shared with them.
 */

/** Namespaced, because an artifact host may serve other things beside this. */
const KEY = 'hunk.github-token'

/**
 * Reading and writing storage can throw rather than return nothing — a
 * private window, or a browser told to block site data. Every one of these
 * swallows that: no token is a state the whole application already handles,
 * and it is a far better answer than a picker that will not render.
 */
export function readToken(): string | null {
  try {
    const stored = localStorage.getItem(KEY)
    return stored === null || stored === '' ? null : stored
  } catch {
    return null
  }
}

export function writeToken(token: string): void {
  try {
    localStorage.setItem(KEY, token)
  } catch {
    // Kept for this page only. The reader is told; see `storageWorks`.
  }
}

export function forgetToken(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // Nothing was stored to begin with.
  }
}

/** Whether a token would survive a reload, so the reader is not promised it. */
export function storageWorks(): boolean {
  try {
    const probe = `${KEY}.probe`
    localStorage.setItem(probe, '1')
    localStorage.removeItem(probe)
    return true
  } catch {
    return false
  }
}

export type TokenCheck =
  | {
      readonly ok: true
      /** Requests an hour this token is allowed. 5.000 for a personal one. */
      readonly limit: number
      readonly remaining: number
      /** Named scopes, for a classic token. Empty for a fine-grained one,
       *  which does not report them — not a sign that it grants nothing. */
      readonly scopes: readonly string[]
    }
  | { readonly ok: false; readonly reason: 'rejected' | 'unreachable'; readonly detail: string }

/**
 * What a token is worth, before the reader finds out by opening a diff.
 *
 * `rate_limit` is the one endpoint that costs nothing against the limit it
 * reports, so asking is free. A token GitHub does not accept answers 401
 * cleanly through CORS — it was tried in a browser — rather than failing as a
 * network error the way an unauthenticated `raw` request with a header does.
 */
export async function validateToken(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TokenCheck> {
  let response: Response
  try {
    response = await fetchImpl('https://api.github.com/rate_limit', {
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` },
    })
  } catch (error) {
    return {
      ok: false,
      reason: 'unreachable',
      detail: error instanceof Error ? error.message : String(error),
    }
  }

  if (response.status === 401) {
    return { ok: false, reason: 'rejected', detail: 'GitHub did not accept that token' }
  }
  if (!response.ok) {
    return { ok: false, reason: 'unreachable', detail: `GitHub answered ${response.status}` }
  }

  const core = await coreOf(response)
  return {
    ok: true,
    limit: core?.limit ?? 0,
    remaining: core?.remaining ?? 0,
    scopes: scopesOf(response),
  }
}

async function coreOf(response: Response): Promise<{ limit: number; remaining: number } | null> {
  try {
    const body: unknown = await response.json()
    if (typeof body !== 'object' || body === null || !('resources' in body)) return null
    const resources = body.resources
    if (typeof resources !== 'object' || resources === null || !('core' in resources)) return null
    const core = resources.core
    if (typeof core !== 'object' || core === null) return null
    const limit = 'limit' in core ? core.limit : null
    const remaining = 'remaining' in core ? core.remaining : null
    if (typeof limit !== 'number' || typeof remaining !== 'number') return null
    return { limit, remaining }
  } catch {
    return null
  }
}

function scopesOf(response: Response): readonly string[] {
  const header = response.headers.get('x-oauth-scopes')
  if (header === null) return []
  return header
    .split(',')
    .map((scope) => scope.trim())
    .filter((scope) => scope !== '')
}
