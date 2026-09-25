/**
 * How wide the left pane is in the two-column layout, as a fraction of the
 * view.
 *
 * A number rather than two widths: the panes always fill the view between
 * them, so one of them is the whole state. There is one per file, because
 * the lines in one file are not the lines in the next, and it reaches the
 * cells as a CSS custom property on the row — which is the only way to change
 * forty-five rows without threading a prop through every one of them.
 *
 * The arithmetic lives here, away from the pointer that drives it. A drag
 * cannot be tested in this project — `tests/setup.ts` stubs `ResizeObserver`
 * as a no-op and returns a fixed width from `getBoundingClientRect` — but
 * everything that decides where the divider lands can be.
 */

/** Namespaced, because an artifact host may serve other things beside this. */
const KEY = 'hunk.split-ratios'

export const DEFAULT_RATIO = 0.5

/**
 * How far the divider may travel.
 *
 * Not zero: a pane dragged to nothing looks like a viewer that has lost half
 * the diff, and the way back is a one-pixel target. A seventh of the view
 * still shows the line numbers and the marker, which is enough to see that
 * the column is there and to grab it again.
 */
export const MIN_RATIO = 0.15
export const MAX_RATIO = 0.85

/** One press of an arrow key. Fine enough to aim, coarse enough to arrive. */
export const RATIO_STEP = 0.02

export function clampRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return DEFAULT_RATIO
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio))
}

/** Where the divider goes for a pointer at `x`, over a view of `width`. */
export function ratioAt(x: number, left: number, width: number): number {
  if (!Number.isFinite(width) || width <= 0) return DEFAULT_RATIO
  return clampRatio((x - left) / width)
}

export function nudgeRatio(ratio: number, steps: number): number {
  return clampRatio(clampRatio(ratio) + steps * RATIO_STEP)
}

/** What a screen reader announces, and what the separator carries. */
export function ratioAsPercent(ratio: number): number {
  return Math.round(clampRatio(ratio) * 100)
}

/**
 * How many files are remembered.
 *
 * Only a file the reader has actually dragged gets an entry, so this is not
 * the size of the diff — but a reader who works through a kernel commit over
 * a week should not fill their storage with it either. The oldest go first.
 */
export const REMEMBERED = 200

/**
 * Reading and writing storage can throw rather than return nothing — a
 * private window, or a browser told to block site data. Both of these
 * swallow it: half and half is a state the layout already handles, and it is
 * a better answer than a viewer that will not render.
 *
 * Kept per file rather than once for the whole viewer. A single remembered
 * width would have to be written by every drag, and writing it would move
 * every file the reader had not touched — which is the thing having a width
 * per file exists to avoid.
 */
export function readRatios(): ReadonlyMap<string, number> {
  const ratios = new Map<string, number>()
  try {
    const stored = localStorage.getItem(KEY)
    if (stored === null || stored.trim() === '') return ratios
    const parsed: unknown = JSON.parse(stored)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return ratios
    for (const [path, ratio] of Object.entries(parsed)) {
      if (typeof ratio !== 'number' || !Number.isFinite(ratio)) continue
      ratios.set(path, clampRatio(ratio))
    }
  } catch {
    // A value this version cannot read is a value this version does not have.
  }
  return ratios
}

export function writeRatios(ratios: ReadonlyMap<string, number>): void {
  try {
    const entries = [...ratios].slice(-REMEMBERED)
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(entries)))
  } catch {
    // Kept for this page only, like the token.
  }
}

/** The map with one file moved to the end, so trimming drops what was set
 *  longest ago rather than whatever the object happened to iterate first. */
export function withRatio(
  ratios: ReadonlyMap<string, number>,
  path: string,
  ratio: number,
): ReadonlyMap<string, number> {
  const next = new Map(ratios)
  next.delete(path)
  next.set(path, clampRatio(ratio))
  return next
}
