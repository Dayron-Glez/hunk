import { describe, expect, it } from 'vitest'
import { pathOf, routeOf } from './route'

const VITE = { owner: 'vitejs', repo: 'vite', number: 23346 }

describe('the path a pull request lives at', () => {
  it('reads like the one it was copied from', () => {
    expect(pathOf(VITE)).toBe('/vitejs/vite/pull/23346')
  })

  it('goes back to the same pull request', () => {
    const route = routeOf(pathOf(VITE))
    expect(route).toEqual({ kind: 'pull-request', ref: VITE })
  })

  it('survives a build published under a subdirectory', () => {
    expect(pathOf(VITE, '/hunk/')).toBe('/hunk/vitejs/vite/pull/23346')
    expect(routeOf('/hunk/vitejs/vite/pull/23346', '/hunk/')).toEqual({
      kind: 'pull-request',
      ref: VITE,
    })
  })

  it('takes the base with or without its trailing slash', () => {
    expect(pathOf(VITE, '/hunk')).toBe('/hunk/vitejs/vite/pull/23346')
  })
})

describe('everything else is the picker', () => {
  it.each([
    ['the root', '/'],
    ['nothing at all', ''],
    ['a repository', '/vitejs/vite'],
    ['an issue', '/vitejs/vite/issues/1'],
    ['too many parts', '/vitejs/vite/pull/1/files'],
    ['a number that is not one', '/vitejs/vite/pull/abc'],
    ['zero', '/vitejs/vite/pull/0'],
    ['a name with a slash in it', '/vitejs/vi%2Fte/pull/1'],
  ])('shows the picker for %s', (_why, path) => {
    expect(routeOf(path)).toEqual({ kind: 'picker' })
  })

  it('shows the picker for a path outside the base', () => {
    expect(routeOf('/elsewhere/vitejs/vite/pull/1', '/hunk/')).toEqual({ kind: 'picker' })
  })

  /**
   * A pasted diff has no path, because nothing in a URL could bring those
   * bytes back. A link that looked shareable and restored an empty page would
   * be worse than no link at all.
   */
  it('has nothing to say about a diff that was pasted', () => {
    expect(routeOf('/')).toEqual({ kind: 'picker' })
  })
})
