import { describe, expect, it } from 'vitest'
import { apiUrlFor, fetchPullRequestDiff, parsePullRequestUrl, type PullRequestRef } from './github'

const VITE: PullRequestRef = { owner: 'vitejs', repo: 'vite', number: 23346 }

describe('reading a pull request out of what was pasted', () => {
  it('takes the plain link', () => {
    expect(parsePullRequestUrl('https://github.com/vitejs/vite/pull/23346')).toEqual(VITE)
  })

  /** Whatever tab the reader was on is still the same pull request. */
  it.each([
    'https://github.com/vitejs/vite/pull/23346/files',
    'https://github.com/vitejs/vite/pull/23346/commits',
    'https://github.com/vitejs/vite/pull/23346/files#diff-abc123',
    'https://github.com/vitejs/vite/pull/23346/files?w=1',
    'https://github.com/vitejs/vite/pull/23346#issuecomment-99',
    'https://github.com/vitejs/vite/pull/23346/',
  ])('ignores what comes after the number: %s', (url) => {
    expect(parsePullRequestUrl(url)).toEqual(VITE)
  })

  it('takes it without the scheme, and with www', () => {
    expect(parsePullRequestUrl('github.com/vitejs/vite/pull/23346')).toEqual(VITE)
    expect(parsePullRequestUrl('https://www.github.com/vitejs/vite/pull/23346')).toEqual(VITE)
  })

  it('takes the shorthand people paste from an issue thread', () => {
    expect(parsePullRequestUrl('vitejs/vite#23346')).toEqual(VITE)
  })

  it('ignores the whitespace around a pasted line', () => {
    expect(parsePullRequestUrl('  https://github.com/vitejs/vite/pull/23346\n')).toEqual(VITE)
  })

  it('drops a .git suffix rather than asking for a repo that does not exist', () => {
    expect(parsePullRequestUrl('https://github.com/vitejs/vite.git/pull/23346')).toEqual(VITE)
  })

  it('keeps a dotted or dashed name intact', () => {
    expect(parsePullRequestUrl('https://github.com/my-org/my.repo/pull/7')).toEqual({
      owner: 'my-org',
      repo: 'my.repo',
      number: 7,
    })
  })
})

describe('refusing what is not one', () => {
  it.each([
    ['nothing at all', ''],
    ['only spaces', '   '],
    ['a repository, not a pull request', 'https://github.com/vitejs/vite'],
    ['an issue', 'https://github.com/vitejs/vite/issues/23346'],
    ['a commit', 'https://github.com/vitejs/vite/commit/abc123'],
    ['another host', 'https://gitlab.com/vitejs/vite/pull/23346'],
    ['a lookalike host', 'https://github.com.evil.example/vitejs/vite/pull/23346'],
    ['no number', 'https://github.com/vitejs/vite/pull/'],
    ['a number that is not one', 'https://github.com/vitejs/vite/pull/abc'],
    ['a negative number', 'https://github.com/vitejs/vite/pull/-3'],
    ['zero', 'https://github.com/vitejs/vite/pull/0'],
    ['prose', 'have a look at my pull request'],
  ])('refuses %s', (_why, input) => {
    expect(parsePullRequestUrl(input)).toBeNull()
  })
})

describe('where it asks', () => {
  it('asks the API, not the page the reader copied', () => {
    // github.com sends no CORS headers and neither does
    // patch-diff.githubusercontent.com; both were tried in a browser.
    expect(apiUrlFor(VITE)).toBe('https://api.github.com/repos/vitejs/vite/pulls/23346')
  })
})

const reply =
  (status: number, body: string, headers: Record<string, string> = {}): typeof fetch =>
  () =>
    Promise.resolve(new Response(body, { status, headers, statusText: statusTextFor(status) }))

function statusTextFor(status: number): string {
  if (status === 200) return 'OK'
  if (status === 404) return 'Not Found'
  if (status === 403) return 'Forbidden'
  if (status === 406) return 'Not Acceptable'
  if (status === 500) return 'Internal Server Error'
  return ''
}

describe('fetching the diff', () => {
  it('hands back the bytes when the API answers', async () => {
    const result = await fetchPullRequestDiff(VITE, reply(200, 'diff --git a/x b/x\n'))
    expect(result).toEqual({ ok: true, ref: VITE, diff: 'diff --git a/x b/x\n' })
  })

  it('sends the media type that asks for a diff rather than JSON', async () => {
    let seen: RequestInit | undefined
    const spy = ((_url: string, init: RequestInit) => {
      seen = init
      return Promise.resolve(new Response('diff', { status: 200 }))
    }) as unknown as typeof fetch

    await fetchPullRequestDiff(VITE, spy)
    expect((seen?.headers as Record<string, string>).Accept).toBe('application/vnd.github.v3.diff')
  })
})

/**
 * Each of these needs different words in front of the reader. "Something went
 * wrong" is the one message that helps nobody, which is why the failures are
 * named rather than thrown.
 */
describe('saying what went wrong', () => {
  it('knows a pull request that is private or not there', async () => {
    const result = await fetchPullRequestDiff(VITE, reply(404, '{"message":"Not Found"}'))
    expect(result).toEqual({ ok: false, failure: { kind: 'not-found', ref: VITE } })
  })

  it('knows the sixty-an-hour ceiling, and when it lifts', async () => {
    const resets = Math.floor(Date.UTC(2026, 8, 23, 12, 0, 0) / 1000)
    const result = await fetchPullRequestDiff(
      VITE,
      reply(403, '{"message":"rate limit exceeded"}', {
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': String(resets),
      }),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('rate-limited')
    if (result.failure.kind !== 'rate-limited') return
    expect(result.failure.resetsAt?.toISOString()).toBe('2026-09-23T12:00:00.000Z')
  })

  it('takes 429 for the same thing', async () => {
    const result = await fetchPullRequestDiff(
      VITE,
      reply(429, '{}', { 'x-ratelimit-remaining': '0' }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.failure.kind).toBe('rate-limited')
  })

  it('does not call a plain 403 a rate limit', async () => {
    // A 403 with requests left is a refusal, and telling the reader to wait an
    // hour for it would be a lie.
    const result = await fetchPullRequestDiff(
      VITE,
      reply(403, '{"message":"Repository access blocked"}', { 'x-ratelimit-remaining': '41' }),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('refused')
    if (result.failure.kind !== 'refused') return
    expect(result.failure.message).toBe('Repository access blocked')
  })

  it('reports a rate limit with no reset header rather than inventing one', async () => {
    const result = await fetchPullRequestDiff(
      VITE,
      reply(403, '{}', { 'x-ratelimit-remaining': '0' }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok && result.failure.kind === 'rate-limited') {
      expect(result.failure.resetsAt).toBeNull()
    }
  })

  it('knows a diff the API will not generate', async () => {
    const result = await fetchPullRequestDiff(VITE, reply(406, ''))
    expect(result).toEqual({ ok: false, failure: { kind: 'too-large', ref: VITE } })
  })

  it('knows the network never answered', async () => {
    const dead = (() => Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof fetch
    const result = await fetchPullRequestDiff(VITE, dead)
    expect(result).toEqual({
      ok: false,
      failure: { kind: 'offline', reason: 'Failed to fetch' },
    })
  })

  it('passes on whatever else the API says', async () => {
    const result = await fetchPullRequestDiff(VITE, reply(500, '{"message":"Server Error"}'))
    expect(result.ok).toBe(false)
    if (!result.ok && result.failure.kind === 'refused') {
      expect(result.failure.status).toBe(500)
      expect(result.failure.message).toBe('Server Error')
    }
  })

  it('falls back to the status when the body is not JSON', async () => {
    const result = await fetchPullRequestDiff(VITE, reply(500, '<html>nope</html>'))
    expect(result.ok).toBe(false)
    if (!result.ok && result.failure.kind === 'refused') {
      expect(result.failure.message).toBe('Internal Server Error')
    }
  })
})
