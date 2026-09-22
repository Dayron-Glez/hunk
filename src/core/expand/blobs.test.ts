import { describe, expect, it, vi } from 'vitest'
import { BlobStore, pullRequestRef, splitLines, type DiffOrigin } from './blobs'

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
      reason: 'that file is not in the commit this diff came from',
    })
  })

  it('reports any other answer with its status', async () => {
    const store = new BlobStore(ORIGIN, serving('', 503).fetch)
    const result = await store.linesOf('a.ts')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('503')
  })

  it('reports a request that never arrived', async () => {
    const dead = (() => Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof fetch
    const store = new BlobStore(ORIGIN, dead)
    const result = await store.linesOf('a.ts')
    expect(result).toEqual({ ok: false, reason: 'Failed to fetch' })
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
