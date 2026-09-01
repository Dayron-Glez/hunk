import { createRoot } from 'react-dom/client'
import { DiffView } from '../../src/components/DiffView'
import { parseUnifiedDiff } from '../../src/core/parse/unified'
import '../../src/index.css'

/**
 * The page the benchmark drives.
 *
 * It renders the same components the application does, but without the picker
 * around them: the diff arrives from the URL, so a measurement starts at the
 * moment the source is in hand and is not polluted by the cost of getting it
 * there. Everything it learns is published on `window.__bench` for the runner
 * in `bench/run.mjs` to read.
 */

interface BenchTimings {
  readonly fetchMs: number
  readonly parseMs: number
  readonly renderMs: number
  readonly totalMs: number
  readonly files: number
  readonly lines: number
  readonly bytes: number
}

interface ScrollReport {
  /**
   * Whether the long-animation-frame observer proved it works before the
   * measurement. When false, the blocking figures below mean nothing and a zero
   * in them is the absence of an instrument, not the absence of a problem.
   */
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

declare global {
  interface Window {
    __bench?: {
      timings: BenchTimings | null
      measureScroll: () => Promise<ScrollReport>
    }
  }
}

const params = new URLSearchParams(window.location.search)
const caseName = params.get('case')
if (caseName === null) throw new Error('bench harness needs a ?case= parameter')

window.__bench = { timings: null, measureScroll }

const startedAt = performance.now()
const source = await fetch(`./cases/${caseName}.diff`).then((response) => response.text())
const fetchedAt = performance.now()

const diff = parseUnifiedDiff(source)
const parsedAt = performance.now()

const container = document.getElementById('root')
if (container === null) throw new Error('#root not found')

createRoot(container).render(<DiffView diff={diff} />)

const lines = diff.files.reduce(
  (total, file) => total + file.hunks.reduce((sum, hunk) => sum + hunk.lines.length, 0),
  0,
)

/**
 * Waiting for React to commit is not the same as waiting for the browser to
 * show anything, and the number that matters is the second one. Poll frames
 * until the expected files are in the document, then let one more frame go by
 * so the paint that puts them on screen is included.
 */
const expectedSections = diff.files.length
await new Promise<void>((resolve) => {
  const tick = (): void => {
    if (document.querySelectorAll('section').length >= expectedSections) {
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
}

/**
 * How well the page scrolls, measured as main-thread blocking rather than as
 * frames per second.
 *
 * Counting `requestAnimationFrame` callbacks was the obvious approach and it is
 * wrong here: headless Chromium drives that callback from a fixed 60 Hz timer
 * that is decoupled from the compositor, so it reports a flat 60 whether the
 * document holds a thousand nodes or a million. It counts frames the browser
 * *scheduled*, not frames it *presented*, and publishing that number would be
 * publishing a constant.
 *
 * Blocking is measurable without a compositor and is the thing that actually
 * makes scrolling feel broken: while the main thread is busy, nothing responds.
 * Two independent views of it are taken, because neither is perfect alone —
 * long animation frames attribute the work, and event-loop lag catches blocking
 * that never made it into a frame at all.
 */
async function measureScroll(): Promise<ScrollReport> {
  window.scrollTo(0, 0)
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

  const height = document.documentElement.scrollHeight
  const step = Math.max(600, Math.round(height / 40))
  const startedScrolling = performance.now()

  for (let i = 0; i < 30; i += 1) {
    window.scrollBy(0, step)
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
 * Block the main thread on purpose and check the observer noticed.
 *
 * A metric that reports zero when the instrument is missing is worse than one
 * that reports nothing, because zero looks like an answer. The frames-per-second
 * figure this file used to publish was exactly that: a constant that survived a
 * thousandfold change in document size. Nothing gets published here now without
 * first proving it can move.
 */
async function proveObserverWorks(sink: number[]): Promise<boolean> {
  const before = sink.length
  const until = performance.now() + 120
  while (performance.now() < until) {
    // Deliberately busy.
  }
  await sleep(150)
  return sink.length > before
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function round(value: number): number {
  return Math.round(value * 10) / 10
}
