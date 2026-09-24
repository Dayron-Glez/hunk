import { execFileSync } from 'node:child_process'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { preview } from 'vite'
import { inspect } from './contrast.page.mjs'

/**
 * Measures the contrast of every piece of text the viewer puts on screen.
 *
 * README.md has claimed since F4 that nothing falls under 4.5:1, from a run
 * done by hand that left nothing behind. This is that run, committed: colour
 * changes are cheap to make and expensive to check by eye, and a claim in a
 * README that no script can reproduce is a claim nobody can defend.
 *
 * Every text node is composited against the background it actually sits on,
 * walked up the ancestors until something opaque, because the viewer stacks
 * translucent tints — a row tint over the page, a word-level mark over that.
 */

const here = dirname(fileURLToPath(import.meta.url))
const root = dirname(here)

/** WCAG 1.4.3 for text, 1.4.11 for the focus indicator. */
const TEXT_RATIO = 4.5
const FOCUS_RATIO = 3

/** Enough to go round the picker, which has the most stops, and stop. */
const TAB_LIMIT = 40

/** How many of the tightest combinations to show per scene. */
const NARROWEST = 4

/**
 * Which diffs to walk. Two rather than one: the statuses are coloured per
 * kind, and a pull request that only adds files never renders a rename.
 */
const SAMPLES = ['A pull request that adds files — 10 files', 'A rename, plus new files']

const run = async () => {
  console.log('Building…')
  execFileSync('npx', ['vite', 'build'], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })

  const server = await preview({ root, preview: { port: 4320, strictPort: true } })
  const origin = server.resolvedUrls?.local[0]?.replace(/\/$/, '')
  if (origin === undefined) throw new Error('preview server did not report a URL')

  const browser = await chromium.launch({ headless: !process.argv.includes('--headed') })
  const scenes = []

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

    await page.goto(origin)
    await page.waitForSelector('text=Paste a diff')
    scenes.push({ name: 'picker', ...(await measure(page)) })

    for (const sample of SAMPLES) {
      for (const layout of ['Unified', 'Split']) {
        await page.goto(origin)
        await page.getByRole('button', { name: sample }).click()
        await page.waitForSelector('[data-testid="diff-scroller"]')
        if (layout === 'Split')
          await page.getByRole('button', { name: 'Split', exact: true }).click()
        // The rows render from a worker; without this the walk can land on a
        // screenful that has not been highlighted yet and pass on its absence.
        await page.waitForTimeout(500)
        scenes.push({ name: `${sample} — ${layout.toLowerCase()}`, ...(await measure(page)) })
      }
    }
  } finally {
    await browser.close()
    await server.close()
  }

  return report(scenes)
}

/**
 * One scene: every text node, then every stop a Tab walk reaches.
 *
 * The ring is read after a real key press rather than after `focus()`,
 * because `:focus-visible` — which is what actually paints it — does not
 * answer to a script calling focus on an element.
 */
const measure = async (page) => {
  const text = await page.evaluate(inspect, 'text')
  const focus = []
  const seen = new Set()

  // A whole lap rather than a walk that stops at the first control it has
  // seen before: Tab starts wherever the last click left the sequence, so
  // stopping on a repeat can end the walk one stop after it began.
  for (let step = 0; step < TAB_LIMIT; step += 1) {
    await page.keyboard.press('Tab')
    // The controls carry `transition-all`, so a reading taken the instant
    // focus lands catches the ring part-way in and reports a colour nobody
    // ever sees. This is the transition finishing, not a guess at timing.
    await page.evaluate(async () => {
      await Promise.race([
        Promise.allSettled(
          (document.activeElement?.getAnimations() ?? []).map((animation) => animation.finished),
        ),
        new Promise((resolve) => setTimeout(resolve, 500)),
      ])
    })
    const ring = await page.evaluate(inspect, 'ring')
    if (ring === null) continue
    const key = `${ring.where}|${ring.sample}`
    if (seen.has(key)) continue
    seen.add(key)
    focus.push(ring)
  }

  return { text, focus }
}

function report(scenes) {
  const nodes = (entries) => entries.reduce((total, entry) => total + entry.count, 0)
  let failed = 0
  let checked = 0

  for (const scene of scenes) {
    checked += nodes(scene.text) + nodes(scene.focus)
    const bad = [
      ...scene.text
        .filter((entry) => entry.ratio < TEXT_RATIO)
        .map((entry) => ({ ...entry, need: `needs ${TEXT_RATIO}` })),
      ...scene.focus
        .filter((entry) => entry.ratio < FOCUS_RATIO)
        .map((entry) => ({ ...entry, need: `needs ${FOCUS_RATIO}` })),
    ]
    failed += nodes(bad)

    console.log(
      `\n${scene.name}\n  ${nodes(scene.text)} text nodes in ${scene.text.length} ` +
        `combinations, ${nodes(scene.focus)} focus rings`,
    )
    for (const entry of bad) print(entry, entry.need)

    // The closest calls, whether or not they failed. A colour change is
    // judged by the room it left, not by whether this run stayed above the
    // line — the next token to move is the one with the least of it.
    console.log('  narrowest text margins:')
    for (const entry of [...scene.text].sort((a, b) => a.ratio - b.ratio).slice(0, NARROWEST)) {
      print(entry, `×${entry.count}`)
    }
  }

  console.log(`\n${checked} checked, ${failed} under the threshold.`)
  return failed
}

function print(entry, note) {
  console.log(
    `  ${entry.ratio.toFixed(2)}:1 (${note}) ${entry.where}\n` +
      `      ${entry.foreground} on ${entry.background}  ${JSON.stringify(entry.sample)}`,
  )
}

run()
  .then((failed) => {
    process.exit(failed === 0 ? 0 : 1)
  })
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
