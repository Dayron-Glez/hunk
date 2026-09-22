import { createRoot } from 'react-dom/client'
import { DiffView } from '../../src/components/DiffView'
import type { LayoutMode } from '../../src/core/layout/rowIndex'
import { parseUnifiedDiff } from '../../src/core/parse/unified'
import '../../src/index.css'

/**
 * The page the benchmark drives. Same components as the application, without
 * the picker: the diff arrives from the URL, so the clock starts once the
 * source is in hand. Results are published on `window.__bench`.
 */

interface BenchTimings {
  readonly fetchMs: number
  readonly parseMs: number
  readonly renderMs: number
  readonly totalMs: number
  readonly files: number
  readonly lines: number
  readonly bytes: number
  readonly mode: LayoutMode
}

interface ScrollReport {
  /** Whether the observer proved it works first. When false, a zero below is
   *  the absence of an instrument, not the absence of a problem. */
  readonly blockingMeasurable: boolean
  /** Total time the main thread was blocked while scrolling. */
  readonly blockingMs: number
  /** The single worst block. This is the one a reader feels as a freeze. */
  readonly worstBlockMs: number
  /** Animation frames that took longer than 50 ms. */
  readonly longFrames: number
  readonly lagMedianMs: number
  readonly lagWorstMs: number
  readonly durationMs: number
  readonly documentHeightPx: number
}

/**
 * What one fold costs.
 *
 * Folding rebuilds the row projection and the height tree over whatever
 * survives, on a click. The rebuild is one pass over every row of the diff,
 * so its cost depends on the size of the document rather than on how much was
 * hidden — which is the claim this measures.
 */
interface FoldReport {
  /** Same self-check as the scroll report: a zero from a missing instrument
   *  is worse than no number at all. */
  readonly blockingMeasurable: boolean
  readonly blockingMs: number
  /** Wall clock from the click to the next frame after it. */
  readonly wallMs: number
  readonly rowsBefore: number
  readonly rowsAfter: number
}

declare global {
  interface Window {
    __bench?: {
      timings: BenchTimings | null
      measureScroll: () => Promise<ScrollReport>
      measureFold: () => Promise<FoldReport | null>
    }
  }
}

const params = new URLSearchParams(window.location.search)
const caseName = params.get('case')
if (caseName === null) throw new Error('bench harness needs a ?case= parameter')

// Rendered in the layout from the start rather than switched into it: a first
// paint measured after a toggle would be measuring the toggle.
const mode: LayoutMode = params.get('mode') === 'split' ? 'split' : 'unified'

window.__bench = { timings: null, measureScroll, measureFold }

const startedAt = performance.now()
const source = await fetch(`./cases/${caseName}.diff`).then((response) => response.text())
const fetchedAt = performance.now()

const diff = parseUnifiedDiff(source)
const parsedAt = performance.now()

const container = document.getElementById('root')
if (container === null) throw new Error('#root not found')

createRoot(container).render(<DiffView diff={diff} initialMode={mode} />)

const lines = diff.files.reduce(
  (total, file) => total + file.hunks.reduce((sum, hunk) => sum + hunk.lines.length, 0),
  0,
)

/**
 * React committing is not the browser showing anything, and the second is what
 * matters: poll until rows are in the document, then let one more frame pass so
 * the paint is included.
 *
 * The condition is "the reader can see the diff", not "every row exists" —
 * different questions since virtualization, as bench/README.md notes.
 */
await new Promise<void>((resolve) => {
  const tick = (): void => {
    const rendered = document.querySelector('[data-rows]')?.childElementCount ?? 0
    if (rendered > 0) {
      requestAnimationFrame(() => {
        resolve()
      })
      return
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
})

const paintedAt = performance.now()

window.__bench.timings = {
  fetchMs: round(fetchedAt - startedAt),
  parseMs: round(parsedAt - fetchedAt),
  renderMs: round(paintedAt - parsedAt),
  totalMs: round(paintedAt - fetchedAt),
  files: diff.files.length,
  lines,
  bytes: source.length,
  mode,
}

/**
 * Main-thread blocking, not frames per second.
 *
 * Counting `requestAnimationFrame` was the obvious approach and is wrong here:
 * headless Chromium drives it from a fixed 60 Hz timer decoupled from the
 * compositor, so it reports a flat 60 from a thousand nodes to a million —
 * frames *scheduled*, not *presented*.
 *
 * Blocking needs no compositor and is what makes scrolling feel broken. Two
 * views of it: long animation frames attribute the work, event-loop lag catches
 * blocking that never reached a frame.
 */
async function measureScroll(): Promise<ScrollReport> {
  // The diff scrolls inside its own element, not with the page.
  const scroller = document.querySelector('[data-testid="diff-scroller"]')
  if (scroller === null) throw new Error('no scroller to measure')

  scroller.scrollTop = 0
  await sleep(300)

  const longFrames: number[] = []
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) longFrames.push(entry.duration)
  })
  let observing = false
  try {
    observer.observe({ type: 'long-animation-frame', buffered: false })
    observing = true
  } catch {
    // Older engines have no such entry type; the lag samples still work.
  }

  const blockingMeasurable = observing && (await proveObserverWorks(longFrames))
  longFrames.length = 0

  const lags: number[] = []
  let sampling = true
  const sampleLag = (): void => {
    const scheduledAt = performance.now()
    setTimeout(() => {
      lags.push(performance.now() - scheduledAt)
      if (sampling) sampleLag()
    }, 0)
  }
  sampleLag()

  const height = scroller.scrollHeight
  const step = Math.max(600, Math.round(height / 40))
  const startedScrolling = performance.now()

  for (let i = 0; i < 30; i += 1) {
    scroller.scrollTop += step
    await sleep(60)
  }

  const durationMs = performance.now() - startedScrolling
  sampling = false
  observer.disconnect()

  lags.sort((a, b) => a - b)

  return {
    blockingMeasurable,
    blockingMs: round(longFrames.reduce((total, duration) => total + duration, 0)),
    worstBlockMs: round(Math.max(0, ...longFrames)),
    longFrames: longFrames.filter((duration) => duration > 50).length,
    lagMedianMs: round(lags[Math.floor(lags.length / 2)] ?? 0),
    lagWorstMs: round(lags.at(-1) ?? 0),
    durationMs: round(durationMs),
    documentHeightPx: height,
  }
}

/**
 * Collapse the first file and time it.
 *
 * One fold, from the control a reader actually clicks. Which file barely
 * matters: the projection is rebuilt in a single pass over every row of the
 * diff whatever is hidden, so this measures the rebuild.
 */
async function measureFold(): Promise<FoldReport | null> {
  const scroller = document.querySelector('[data-testid="diff-scroller"]')
  if (scroller === null) return null

  const rowsOf = (): number => Number(scroller.getAttribute('aria-rowcount') ?? '0')

  const control = scroller.querySelector<HTMLButtonElement>('button[aria-expanded="true"]')
  if (control === null) return null

  const blocks: number[] = []
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) blocks.push(entry.duration)
  })
  let observing = false
  try {
    observer.observe({ type: 'long-animation-frame', buffered: false })
    observing = true
  } catch {
    // No such entry type here; the wall clock below still means something.
  }

  const blockingMeasurable = observing && (await proveObserverWorks(blocks))
  blocks.length = 0

  const rowsBefore = rowsOf()
  const startedAt = performance.now()
  control.click()
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      resolve()
    })
  })
  const wallMs = performance.now() - startedAt

  await sleep(200)
  observer.disconnect()

  return {
    blockingMeasurable,
    blockingMs: round(blocks.reduce((total, duration) => total + duration, 0)),
    wallMs: round(wallMs),
    rowsBefore,
    rowsAfter: rowsOf(),
  }
}

/**
 * Block the main thread on purpose and check the observer noticed. A zero from
 * a missing instrument looks like an answer, which is worse than no answer —
 * nothing is published here without first proving it can move.
 */
async function proveObserverWorks(sink: number[]): Promise<boolean> {
  const before = sink.length
  // Inside an animation frame on purpose. A long *animation frame* is only
  // reported when a frame happens, so blocking an idle page proves nothing
  // and reports nothing — which is how the fold measurement first came back
  // with an unverified zero.
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      const until = performance.now() + 120
      while (performance.now() < until) {
        // Deliberately busy.
      }
      resolve()
    })
  })
  await sleep(150)
  return sink.length > before
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function round(value: number): number {
  return Math.round(value * 10) / 10
}
