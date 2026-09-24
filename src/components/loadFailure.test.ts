import { describe, expect, it } from 'vitest'
import type { LoadFailure } from '../core/source/github'
import { describeFailure } from './loadFailure'

const REF = { owner: 'vitejs', repo: 'vite', number: 23346 }
const NOW = new Date('2026-09-23T12:00:00Z')

describe('what the reader is told', () => {
  it('shows the shape of a link that would have worked', () => {
    const said = describeFailure({ kind: 'unreadable', input: 'nonsense' }, { now: NOW })
    expect(said).toContain('github.com/owner/repo/pull/123')
  })

  it('names the pull request it could not find, and says why it might be', () => {
    const said = describeFailure({ kind: 'not-found', ref: REF }, { now: NOW })
    expect(said).toContain('vitejs/vite#23346')
    expect(said).toContain('private')
    // Always with a way out that does not need GitHub.
    expect(said).toContain('.diff')
  })

  it('says how long the rate limit has left', () => {
    const said = describeFailure(
      { kind: 'rate-limited', resetsAt: new Date('2026-09-23T12:25:00Z') },
      { now: NOW },
    )
    expect(said).toContain('sixty requests an hour')
    expect(said).toContain('25 more minutes')
  })

  it('does not say a minute when it means minutes', () => {
    const said = describeFailure(
      { kind: 'rate-limited', resetsAt: new Date('2026-09-23T12:00:30Z') },
      { now: NOW },
    )
    expect(said).toContain('one more minute')
  })

  it('invents no time when the header did not give one', () => {
    const said = describeFailure({ kind: 'rate-limited', resetsAt: null }, { now: NOW })
    expect(said).toContain('sixty requests an hour')
    expect(said).not.toMatch(/minute/)
  })

  it('does not tell the reader to wait for a moment already past', () => {
    const said = describeFailure(
      { kind: 'rate-limited', resetsAt: new Date('2026-09-23T11:30:00Z') },
      { now: NOW },
    )
    expect(said).toContain('clear now')
  })

  /** The one failure where the limit is GitHub's and not this viewer's. */
  it('says the size is GitHub refusing, not hunk giving up', () => {
    const said = describeFailure({ kind: 'too-large', ref: REF }, { now: NOW })
    expect(said).toContain('GitHub will not generate')
    expect(said).toContain('hunk itself has no trouble')
  })

  it('passes on what the network said', () => {
    expect(describeFailure({ kind: 'offline', reason: 'Failed to fetch' }, { now: NOW })).toContain(
      'Failed to fetch',
    )
  })

  it('passes on what GitHub said, with the status', () => {
    const said = describeFailure(
      { kind: 'refused', status: 451, message: 'Repository unavailable' },
      { now: NOW },
    )
    expect(said).toContain('Repository unavailable')
    expect(said).toContain('451')
  })

  /** A token changes what a 404 and a 403 mean, so it changes what they say.
   *  Telling a reader with a token that hunk "cannot reach private
   *  repositories" would be false, and telling them the ceiling is sixty
   *  would be off by a factor of eighty. */
  it('stops blaming privacy once a token is in play', () => {
    const anonymous = describeFailure({ kind: 'not-found', ref: REF }, { now: NOW })
    const authorized = describeFailure(
      { kind: 'not-found', ref: REF },
      { now: NOW, hasToken: true },
    )
    expect(anonymous).toContain('private repository')
    expect(authorized).not.toContain('private repository')
    expect(authorized).toContain('token does not cover')
  })

  it('quotes the ceiling the reader actually has', () => {
    const anonymous = describeFailure({ kind: 'rate-limited', resetsAt: null }, { now: NOW })
    const authorized = describeFailure(
      { kind: 'rate-limited', resetsAt: null },
      { now: NOW, hasToken: true },
    )
    expect(anonymous).toContain('sixty requests an hour')
    expect(authorized).toContain('five thousand requests an hour')
    expect(authorized).not.toContain('sixty')
  })

  it('says a rejected token is the token, and how to carry on without it', () => {
    const said = describeFailure({ kind: 'bad-credentials' }, { now: NOW, hasToken: true })
    expect(said).toContain('token')
    expect(said).toContain('forget')
  })

  it('has something to say about every failure there is', () => {
    const all: LoadFailure[] = [
      { kind: 'unreadable', input: 'x' },
      { kind: 'not-found', ref: REF },
      { kind: 'rate-limited', resetsAt: null },
      { kind: 'too-large', ref: REF },
      { kind: 'offline', reason: 'x' },
      { kind: 'refused', status: 500, message: 'x' },
      { kind: 'bad-credentials' },
    ]
    for (const failure of all) {
      for (const hasToken of [false, true]) {
        const said = describeFailure(failure, { now: NOW, hasToken })
        expect(said.length).toBeGreaterThan(20)
        expect(said).not.toContain('undefined')
      }
    }
  })
})
