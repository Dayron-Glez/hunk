import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_RATIO,
  MAX_RATIO,
  MIN_RATIO,
  RATIO_STEP,
  clampPan,
  clampRatio,
  nudgeRatio,
  ratioAsPercent,
  ratioAt,
  REMEMBERED,
  readRatios,
  withRatio,
  writeRatios,
} from './panes'

/**
 * The drag itself is not testable here — `tests/setup.ts` stubs
 * `ResizeObserver` as a no-op and hands back a fixed width — so what is
 * tested is everything the drag asks for before it moves anything.
 */
describe('where the divider may land', () => {
  it('keeps both panes on screen', () => {
    expect(clampRatio(0)).toBe(MIN_RATIO)
    expect(clampRatio(1)).toBe(MAX_RATIO)
    expect(clampRatio(-4)).toBe(MIN_RATIO)
  })

  it('leaves a ratio inside the limits alone', () => {
    expect(clampRatio(0.5)).toBe(0.5)
    expect(clampRatio(MIN_RATIO)).toBe(MIN_RATIO)
    expect(clampRatio(MAX_RATIO)).toBe(MAX_RATIO)
  })

  /** A width of zero is what a view that has not been laid out yet reports,
   *  and dividing by it would put the divider at infinity. */
  it.each([NaN, Infinity])('falls back to half and half for %s', (bad) => {
    expect(clampRatio(bad)).toBe(DEFAULT_RATIO)
    expect(ratioAt(100, 0, bad)).toBe(DEFAULT_RATIO)
  })

  it('reads a pointer against the left edge of the view, not the page', () => {
    expect(ratioAt(400, 0, 800)).toBeCloseTo(0.5)
    expect(ratioAt(600, 200, 800)).toBeCloseTo(0.5)
  })

  it('clamps a pointer dragged past either edge', () => {
    expect(ratioAt(-200, 0, 800)).toBe(MIN_RATIO)
    expect(ratioAt(4000, 0, 800)).toBe(MAX_RATIO)
  })

  it.each([0, -1])('refuses a width of %s rather than dividing by it', (width) => {
    expect(ratioAt(400, 0, width)).toBe(DEFAULT_RATIO)
  })
})

describe('nudging it by keyboard', () => {
  it('moves one step at a time, either way', () => {
    expect(nudgeRatio(0.5, 1)).toBeCloseTo(0.5 + RATIO_STEP)
    expect(nudgeRatio(0.5, -1)).toBeCloseTo(0.5 - RATIO_STEP)
  })

  it('stops at the limits rather than walking past them', () => {
    expect(nudgeRatio(MAX_RATIO, 1)).toBe(MAX_RATIO)
    expect(nudgeRatio(MIN_RATIO, -1)).toBe(MIN_RATIO)
  })

  it('announces whole percentages, which is what aria-valuenow carries', () => {
    expect(ratioAsPercent(0.5)).toBe(50)
    expect(ratioAsPercent(0.333)).toBe(33)
    expect(ratioAsPercent(2)).toBe(ratioAsPercent(MAX_RATIO))
  })
})

/**
 * Panning a column sideways. What a pointer does with it is not testable
 * here — jsdom has no layout, so every width it reports is zero — so what is
 * tested is the limit the pointer is held to.
 */
describe('how far a column may be panned', () => {
  it('stops at the end of the content rather than past it', () => {
    expect(clampPan(500, 900, 400)).toBe(500)
    expect(clampPan(900, 900, 400)).toBe(500)
  })

  it('does not move a column whose content already fits', () => {
    expect(clampPan(300, 400, 400)).toBe(0)
    expect(clampPan(300, 100, 400)).toBe(0)
  })

  it('does not go left of the start', () => {
    expect(clampPan(-200, 900, 400)).toBe(0)
  })

  /** The width is the widest row rendered so far, so the limit grows as the
   *  reader moves down and a pan is never larger than what has been seen. */
  it('grows with what has been measured', () => {
    expect(clampPan(700, 600, 400)).toBe(200)
    expect(clampPan(700, 1_200, 400)).toBe(700)
  })

  it.each([NaN, Infinity])('refuses %s rather than moving by it', (bad) => {
    expect(clampPan(bad, 900, 400)).toBe(0)
  })
})

describe('remembering it across a reload', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('comes back per file, as it was left', () => {
    writeRatios(withRatio(new Map(), 'src/app.ts', 0.62))
    expect(readRatios().get('src/app.ts')).toBeCloseTo(0.62)
  })

  /** Moving one file's divider is the whole point; a width written for every
   *  file would take the untouched ones with it. */
  it("keeps one file out of another file's way", () => {
    const ratios = withRatio(withRatio(new Map(), 'a.ts', 0.7), 'b.ts', 0.3)
    writeRatios(ratios)
    const back = readRatios()
    expect(back.get('a.ts')).toBeCloseTo(0.7)
    expect(back.get('b.ts')).toBeCloseTo(0.3)
  })

  it('has nothing to say about a file nobody has dragged', () => {
    expect(readRatios().get('untouched.ts')).toBeUndefined()
  })

  it('clamps what it reads, in case a stored width predates the limits', () => {
    localStorage.setItem('hunk.split-ratios', JSON.stringify({ 'a.ts': 0.99 }))
    expect(readRatios().get('a.ts')).toBe(MAX_RATIO)
  })

  it('moves a file it writes again to the end, so the oldest is dropped first', () => {
    const ratios = withRatio(withRatio(withRatio(new Map(), 'a.ts', 0.2), 'b.ts', 0.3), 'a.ts', 0.7)
    expect([...ratios.keys()]).toEqual(['b.ts', 'a.ts'])
  })

  it('remembers at most REMEMBERED files, dropping what was set longest ago', () => {
    let ratios: ReadonlyMap<string, number> = new Map()
    for (let n = 0; n < REMEMBERED + 5; n += 1) ratios = withRatio(ratios, `file-${n}.ts`, 0.6)
    writeRatios(ratios)
    const back = readRatios()
    expect(back.size).toBe(REMEMBERED)
    expect(back.has('file-0.ts')).toBe(false)
    expect(back.has(`file-${REMEMBERED + 4}.ts`)).toBe(true)
  })

  it.each(['', 'not json', '[]', 'null', '{"a.ts":"wide"}'])(
    'ignores %o rather than failing to render',
    (bad) => {
      localStorage.setItem('hunk.split-ratios', bad)
      expect(readRatios().size).toBe(0)
    },
  )

  /** A private window, or a browser told to block site data. Neither is a
   *  reason for the viewer not to render. */
  it('survives a browser that refuses to store', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    })
    expect(readRatios().size).toBe(0)
    expect(() => {
      writeRatios(withRatio(new Map(), 'a.ts', 0.6))
    }).not.toThrow()
  })
})
