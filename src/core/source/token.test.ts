import { afterEach, describe, expect, it, vi } from 'vitest'
import { forgetToken, readToken, storageWorks, validateToken, writeToken } from './token'

const KEY = 'hunk.github-token'

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

const answering =
  (status: number, body: string, headers: Record<string, string> = {}): typeof fetch =>
  () =>
    Promise.resolve(new Response(body, { status, headers }))

const LIMIT = JSON.stringify({ resources: { core: { limit: 5000, remaining: 4987, reset: 0 } } })

describe('keeping it', () => {
  it('reads back what was written', () => {
    writeToken('github_pat_abc')
    expect(readToken()).toBe('github_pat_abc')
  })

  it('has none to begin with', () => {
    expect(readToken()).toBeNull()
  })

  it('has none after forgetting', () => {
    writeToken('github_pat_abc')
    forgetToken()
    expect(readToken()).toBeNull()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  /** An empty string is not a credential, and treating it as one would send
   *  `Bearer ` and get a 401 for it. */
  it('treats an empty entry as none', () => {
    localStorage.setItem(KEY, '')
    expect(readToken()).toBeNull()
  })
})

/**
 * A private window, or a browser told to block site data, throws on access
 * rather than returning nothing. No token is a state the whole application
 * already handles; a picker that will not render is not.
 */
describe('a browser that will not store anything', () => {
  const throwing = (): void => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied')
    })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('denied')
    })
  }

  it('reads no token instead of throwing', () => {
    throwing()
    expect(readToken()).toBeNull()
  })

  it('writes without throwing, even though nothing is kept', () => {
    throwing()
    expect(() => {
      writeToken('github_pat_abc')
    }).not.toThrow()
  })

  it('forgets without throwing', () => {
    throwing()
    expect(() => {
      forgetToken()
    }).not.toThrow()
  })

  it('says so, so the reader is not promised it will last', () => {
    throwing()
    expect(storageWorks()).toBe(false)
  })

  it('leaves no probe behind when it does work', () => {
    expect(storageWorks()).toBe(true)
    expect(localStorage.length).toBe(0)
  })
})

/**
 * `rate_limit` is the one endpoint that costs nothing against the limit it
 * reports, so the reader can be told the token works before spending
 * anything on finding out.
 */
describe('checking one', () => {
  it('reports the ceiling a good token buys', async () => {
    const check = await validateToken('github_pat_abc', answering(200, LIMIT))
    expect(check).toEqual({ ok: true, limit: 5000, remaining: 4987, scopes: [] })
  })

  it('sends the token as a bearer', async () => {
    const seen: RequestInit[] = []
    const spy = ((_url: string, init: RequestInit) => {
      seen.push(init)
      return Promise.resolve(new Response(LIMIT, { status: 200 }))
    }) as unknown as typeof fetch

    await validateToken('github_pat_abc', spy)
    expect((seen[0]?.headers as Record<string, string>).Authorization).toBe('Bearer github_pat_abc')
  })

  /** A token GitHub does not accept answers 401 through CORS cleanly — it was
   *  tried in a browser — rather than failing as a network error. */
  it('tells a rejected token from an unreachable GitHub', async () => {
    const rejected = await validateToken('nope', answering(401, '{"message":"Bad credentials"}'))
    expect(rejected).toMatchObject({ ok: false, reason: 'rejected' })

    const dead = (() => Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof fetch
    expect(await validateToken('x', dead)).toMatchObject({
      ok: false,
      reason: 'unreachable',
      detail: 'Failed to fetch',
    })
  })

  it('names the scopes of a classic token', async () => {
    const check = await validateToken(
      'ghp_abc',
      answering(200, LIMIT, { 'x-oauth-scopes': 'repo, read:org' }),
    )
    expect(check).toMatchObject({ ok: true, scopes: ['repo', 'read:org'] })
  })

  /** A fine-grained token reports no scopes at all, which is not a sign that
   *  it grants nothing. */
  it('accepts a token that names no scopes', async () => {
    const check = await validateToken('github_pat_abc', answering(200, LIMIT))
    expect(check).toMatchObject({ ok: true, scopes: [] })
  })

  it('survives a body that is not the shape it expects', async () => {
    const check = await validateToken('github_pat_abc', answering(200, 'not json'))
    expect(check).toEqual({ ok: true, limit: 0, remaining: 0, scopes: [] })
  })
})
