import { describe, expect, it, vi } from 'vitest'
import {
  BlobStore,
  describeBlobFailure,
  pullRequestRef,
  splitLines,
  type BlobFailure,
  type DiffOrigin,
} from './blobs'

const ORIGIN: DiffOrigin = { owner: 'vitejs', repo: 'vite', ref: 'refs/pull/23346/head' }

const NEWLINE = String.fromCharCode(10)
const RETURN = String.fromCharCode(13)

const serving = (body: string, status = 200): { fetch: typeof fetch; calls: string[] } => {
  const calls: string[] = []
  return {
    calls,
    fetch: ((url: string) => {
      calls.push(String(url))
      return Promise.resolve(new Response(body, { status }))
    }) as unknown as typeof fetch,
  }
}

describe('what to fetch at', () => {
  /** One API call per pull request instead of two, and no fork to resolve:
   *  this ref points at the head from inside the base repository. */
  it('names the pull request head rather than a commit', () => {
    expect(pullRequestRef(23346)).toBe('refs/pull/23346/head')
  })
})

describe('where a file is fetched from', () => {
  it('asks raw.githubusercontent at the commit the diff is of', () => {
    const store = new BlobStore(ORIGIN, serving('').fetch)
    expect(store.urlFor('src/a.ts')).toBe(
      'https://raw.githubusercontent.com/vitejs/vite/refs/pull/23346/head/src/a.ts',
    )
  })

  /** Not the API: both work and both allow any origin, but the API spends one
   *  of sixty requests an hour and this spends none. */
  it('does not go through the API', () => {
    const store = new BlobStore(ORIGIN, serving('').fetch)
    expect(store.urlFor('a.ts')).not.toContain('api.github.com')
  })

  it('escapes each path segment without escaping the slashes', () => {
    const store = new BlobStore(ORIGIN, serving('').fetch)
    expect(store.urlFor('src/my folder/a b.ts')).toBe(
      'https://raw.githubusercontent.com/vitejs/vite/refs/pull/23346/head/src/my%20folder/a%20b.ts',
    )
  })

  it('survives a path that is not ASCII', () => {
    const store = new BlobStore(ORIGIN, serving('').fetch)
    expect(store.urlFor('docs/café.md')).toContain('caf%C3%A9.md')
  })
})

describe('fetching', () => {
  it('hands back the file as lines', async () => {
    const store = new BlobStore(ORIGIN, serving(['one', 'two', 'three'].join(NEWLINE)).fetch)
    await expect(store.linesOf('a.ts')).resolves.toEqual({
      ok: true,
      lines: ['one', 'two', 'three'],
    })
  })

  it('asks once however many gaps of a file are opened', async () => {
    const served = serving('one')
    const store = new BlobStore(ORIGIN, served.fetch)

    await Promise.all([store.linesOf('a.ts'), store.linesOf('a.ts')])
    await store.linesOf('a.ts')

    expect(served.calls).toHaveLength(1)
    expect(store.fetched).toBe(1)
  })

  it('shares one request between callers who arrive together', async () => {
    const served = serving('one')
    const store = new BlobStore(ORIGIN, served.fetch)
    const [a, b] = await Promise.all([store.linesOf('a.ts'), store.linesOf('a.ts')])
    expect(a).toEqual(b)
    expect(served.calls).toHaveLength(1)
  })

  it('keeps separate files apart', async () => {
    const calls: string[] = []
    const impl = ((url: string) => {
      calls.push(String(url))
      return Promise.resolve(
        new Response(String(url).endsWith('a.ts') ? 'A' : 'B', { status: 200 }),
      )
    }) as unknown as typeof fetch

    const store = new BlobStore(ORIGIN, impl)
    await expect(store.linesOf('a.ts')).resolves.toEqual({ ok: true, lines: ['A'] })
    await expect(store.linesOf('b.ts')).resolves.toEqual({ ok: true, lines: ['B'] })
    expect(calls).toHaveLength(2)
  })
})

describe('when it cannot be fetched', () => {
  it('explains a file that is not in that commit', async () => {
    const store = new BlobStore(ORIGIN, serving('404: Not Found', 404).fetch)
    const result = await store.linesOf('gone.ts')
    expect(result).toEqual({
      ok: false,
      failure: { kind: 'not-in-commit', path: 'gone.ts' },
    })
  })

  it('reports any other answer with its status', async () => {
    const store = new BlobStore(ORIGIN, serving('', 503).fetch)
    const result = await store.linesOf('a.ts')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.failure).toEqual({ kind: 'refused', status: 503 })
  })

  it('reports a request that never arrived', async () => {
    const dead = (() => Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof fetch
    const store = new BlobStore(ORIGIN, dead)
    const result = await store.linesOf('a.ts')
    expect(result).toEqual({
      ok: false,
      failure: { kind: 'offline', reason: 'Failed to fetch' },
    })
  })

  it('does not ask again after a failure it already reported', async () => {
    const served = serving('', 404)
    const store = new BlobStore(ORIGIN, served.fetch)
    await store.linesOf('a.ts')
    await store.linesOf('a.ts')
    expect(served.calls).toHaveLength(1)
  })
})

/**
 * Off by one here moves every revealed line number, which is the one thing
 * that would make expansion worse than not offering it.
 */
describe('splitting a file into lines', () => {
  it('does not count a line after the final newline', () => {
    expect(splitLines(['a', 'b', ''].join(NEWLINE))).toEqual(['a', 'b'])
  })

  it('keeps a genuinely empty last line', () => {
    expect(splitLines(['a', 'b', '', ''].join(NEWLINE))).toEqual(['a', 'b', ''])
  })

  it('handles a file with no trailing newline', () => {
    expect(splitLines(['a', 'b'].join(NEWLINE))).toEqual(['a', 'b'])
  })

  it('handles an empty file', () => {
    expect(splitLines('')).toEqual([])
  })

  it('handles a file of one line', () => {
    expect(splitLines('only')).toEqual(['only'])
    expect(splitLines(`only${NEWLINE}`)).toEqual(['only'])
  })

  it('strips the carriage return of a CRLF file', () => {
    const crlf = ['a', 'b', ''].join(RETURN + NEWLINE)
    expect(splitLines(crlf)).toEqual(['a', 'b'])
  })

  it('keeps blank lines in the middle', () => {
    expect(splitLines(['a', '', 'c'].join(NEWLINE))).toEqual(['a', '', 'c'])
  })
})

describe('counting what it spent', () => {
  it('reports how many files it has asked for', async () => {
    const store = new BlobStore(ORIGIN, serving('x').fetch)
    expect(store.fetched).toBe(0)
    await store.linesOf('a.ts')
    await store.linesOf('b.ts')
    expect(store.fetched).toBe(2)
  })
})

/**
 * A browser found this and no fake could: `fetch` refuses to run with
 * anything but the window as its `this`, and storing it on the store and
 * calling `this.fetchImpl(url)` hands it the store. Every fake here is an
 * ordinary function that does not care, so this one insists.
 */
describe('calling fetch the way the browser requires', () => {
  it('does not hand the store to fetch as its this', async () => {
    const picky = function (this: unknown, _url: string): Promise<Response> {
      if (this !== undefined && this !== globalThis) {
        return Promise.reject(new TypeError('Illegal invocation'))
      }
      return Promise.resolve(new Response('one', { status: 200 }))
    } as unknown as typeof fetch

    const store = new BlobStore(ORIGIN, picky)
    await expect(store.linesOf('a.ts')).resolves.toEqual({ ok: true, lines: ['one'] })
  })
})

describe('the default', () => {
  it('uses the page fetch when none is given', () => {
    const spy = vi.fn(() => Promise.resolve(new Response('x')))
    vi.stubGlobal('fetch', spy)
    const store = new BlobStore(ORIGIN)
    void store.linesOf('a.ts')
    expect(spy).toHaveBeenCalledOnce()
    vi.unstubAllGlobals()
  })
})

/**
 * Two routes, and the token decides. Both were measured in a browser: raw is
 * free but cannot be authenticated, since the header turns the request into a
 * preflight raw rejects outright. The API answers that preflight and costs
 * one of the hourly limit, which a token raises from sixty to five thousand.
 */
describe('with a token', () => {
  const TOKEN = 'github_pat_abc'

  const spying = (
    body = 'one',
    status = 200,
  ): { fetch: typeof fetch; urls: string[]; inits: (RequestInit | undefined)[] } => {
    const urls: string[] = []
    const inits: (RequestInit | undefined)[] = []
    return {
      urls,
      inits,
      fetch: ((url: string, init?: RequestInit) => {
        urls.push(String(url))
        inits.push(init)
        return Promise.resolve(new Response(body, { status }))
      }) as unknown as typeof fetch,
    }
  }

  it('asks the API instead of raw, with the ref as a parameter', () => {
    const store = new BlobStore(ORIGIN, serving('').fetch, TOKEN)
    expect(store.urlFor('src/a.ts')).toBe(
      'https://api.github.com/repos/vitejs/vite/contents/src/a.ts?ref=refs%2Fpull%2F23346%2Fhead',
    )
  })

  it('still asks raw without one', () => {
    const store = new BlobStore(ORIGIN, serving('').fetch)
    expect(store.urlFor('src/a.ts')).toContain('raw.githubusercontent.com')
  })

  it('treats an empty token as none, rather than sending an empty bearer', async () => {
    const spy = spying()
    const store = new BlobStore(ORIGIN, spy.fetch, '')
    await store.linesOf('a.ts')
    expect(spy.urls[0]).toContain('raw.githubusercontent.com')
    expect(spy.inits[0]).toBeUndefined()
  })

  it('sends the bearer and the raw media type to the API', async () => {
    const spy = spying()
    const store = new BlobStore(ORIGIN, spy.fetch, TOKEN)
    await store.linesOf('a.ts')
    expect(spy.inits[0]?.headers).toEqual({
      Accept: 'application/vnd.github.raw',
      Authorization: `Bearer ${TOKEN}`,
    })
  })

  /** Anything raw does not need is a preflight it would fail, so the
   *  unauthenticated route sends no init object at all. */
  it('sends no headers at all on the raw route', async () => {
    const spy = spying()
    const store = new BlobStore(ORIGIN, spy.fetch)
    await store.linesOf('a.ts')
    expect(spy.inits[0]).toBeUndefined()
  })

  it('returns the same lines whichever route fetched them', async () => {
    const body = ['one', 'two'].join(String.fromCharCode(10))
    const viaRaw = await new BlobStore(ORIGIN, serving(body).fetch).linesOf('a.ts')
    const viaApi = await new BlobStore(ORIGIN, serving(body).fetch, TOKEN).linesOf('a.ts')
    expect(viaApi).toEqual(viaRaw)
  })

  it('names a token the API rejected', async () => {
    const store = new BlobStore(ORIGIN, serving('', 401).fetch, TOKEN)
    expect(await store.linesOf('a.ts')).toEqual({
      ok: false,
      failure: { kind: 'bad-credentials' },
    })
  })

  /** The API route spends the hourly limit, which raw never did. */
  it('tells a spent limit from a plain refusal', async () => {
    const limited = ((_url: string) =>
      Promise.resolve(
        new Response('', { status: 403, headers: { 'x-ratelimit-remaining': '0' } }),
      )) as unknown as typeof fetch
    expect(await new BlobStore(ORIGIN, limited, TOKEN).linesOf('a.ts')).toEqual({
      ok: false,
      failure: { kind: 'rate-limited' },
    })

    const forbidden = ((_url: string) =>
      Promise.resolve(new Response('', { status: 403 }))) as unknown as typeof fetch
    expect(await new BlobStore(ORIGIN, forbidden, TOKEN).linesOf('a.ts')).toEqual({
      ok: false,
      failure: { kind: 'refused', status: 403 },
    })
  })
})

describe('what the reader is told about a file', () => {
  it('has a sentence for every failure, and names the file where it can', () => {
    const all: BlobFailure[] = [
      { kind: 'not-in-commit', path: 'src/a.ts' },
      { kind: 'bad-credentials' },
      { kind: 'rate-limited' },
      { kind: 'offline', reason: 'Failed to fetch' },
      { kind: 'refused', status: 503 },
    ]
    for (const failure of all) {
      const said = describeBlobFailure(failure)
      expect(said.length).toBeGreaterThan(20)
      expect(said).not.toContain('undefined')
    }
    expect(describeBlobFailure({ kind: 'not-in-commit', path: 'src/a.ts' })).toContain('src/a.ts')
  })
})
