import { describe, expect, it } from 'vitest'
import { onScreen } from './sticky'

const view = (scrollTop: number, height = 100) => ({ scrollTop, height })

/**
 * The scrollbar sits at the end of its own file's rows, not against the
 * bottom of the view: held there it came out flush with the edge of the
 * window, spanning the full width, which reads as one bar belonging to the
 * viewer rather than as that file's. So all that is left to decide is
 * whether the file is on screen at all.
 */
describe('whether a file is on screen at all', () => {
  it.each([
    [{ top: 0, bottom: 50 }, 0, true],
    [{ top: 0, bottom: 50 }, 60, false],
    [{ top: 200, bottom: 400 }, 0, false],
    [{ top: 90, bottom: 400 }, 0, true],
  ])('%o against a view at %i', (block, scrollTop, expected) => {
    expect(onScreen(block, view(scrollTop))).toBe(expected)
  })
})
