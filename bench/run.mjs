import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { preview } from 'vite'
import { materializeCases } from './cases.mjs'

/**
 * Measures how long hunk takes to put a diff on screen, how well it scrolls
 * once it is there, and what it costs to keep it there.
 *
 * Every number is a median of REPEATS runs in a fresh page, against a
 * production build. Read bench/README.md before quoting any of it — a number
 * without the machine it came from compares to nothing.
 */

const here = dirname(fileURLToPath(import.meta.url))
const distDir = join(here, 'dist')
const resultsDir = join(here, 'results')

const REPEATS = 3

const run = async () => {
  console.log('Building the harness…')
  execFileSync('npx', ['vite', 'build', '--config', join(here, 'vite.config.ts')], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })

  // After the build, never before: emptyOutDir would delete them.
  console.log('Writing cases…')
  const argv = process.argv.slice(2)
  const headed = argv.includes('--headed')
  const filters = argv.filter((a) => !a.startsWith('--'))
  const cases = materializeCases(join(distDir, 'cases')).filter(
    (testCase) => filters.length === 0 || filters.some((f) => testCase.name.includes(f)),
  )
  if (cases.length === 0) throw new Error(`no case matched ${filters.join(', ')}`)

  for (const testCase of cases) {
    console.log(`  ${testCase.name.padEnd(20)} ${formatBytes(testCase.bytes).padStart(10)}`)
  }

  // Point at the bench config, not at distDir: preview serves `build.outDir`
  // relative to `root`, so handing it the output directory as the root makes it
  // look for a dist inside dist and serve nothing.
  const server = await preview({
    configFile: join(here, 'vite.config.ts'),
    preview: { port: 4319, strictPort: true },
  })
  const origin = server.resolvedUrls?.local[0]?.replace(/\/$/, '')
  if (origin === undefined) throw new Error('preview server did not report a URL')

  const browser = await chromium.launch({ headless: !headed }).catch((error) => {
    if (String(error.message).includes("Executable doesn't exist")) {
      throw new Error(
        'Chromium is missing. Playwright downloads it separately from its npm package:\n\n' +
          '  npx playwright install chromium\n',
        { cause: error },
      )
    }
    throw error
  })
  const results = []

  try {
    for (const testCase of cases) {
      process.stdout.write(`\n${testCase.label}\n`)
      const runs = []

      for (let attempt = 0; attempt < REPEATS; attempt += 1) {
        process.stdout.write(`  run ${attempt + 1}/${REPEATS}… `)
        const measurement = await measureOnce(browser, origin, testCase.name)
        runs.push(measurement)
        process.stdout.write(`${measurement.totalMs} ms\n`)
      }

      // Frame rate and memory come from the last run only: they need a live
      // page, and repeating a three-second scroll for every attempt would
      // triple the wall clock for a number that barely moves between runs.
      const last = runs[runs.length - 1]

      results.push({
        name: testCase.name,
        label: testCase.label,
        bytes: testCase.bytes,
        files: last.files,
        lines: last.lines,
        parseMs: median(runs.map((entry) => entry.parseMs)),
        renderMs: median(runs.map((entry) => entry.renderMs)),
        totalMs: median(runs.map((entry) => entry.totalMs)),
        runs: runs.map((entry) => entry.totalMs),
        scroll: last.scroll,
        memoryMB: last.memoryMB,
        domNodes: last.domNodes,
      })
    }
  } finally {
    await browser.close()
    await server.close()
  }

  report(results)

  mkdirSync(resultsDir, { recursive: true })
  const snapshot = {
    recordedAt: new Date().toISOString(),
    machine: {
      platform: process.platform,
      arch: process.arch,
      cpus: cpuName(),
      node: process.version,
    },
    repeats: REPEATS,
    results,
  }
  const target = join(resultsDir, 'latest.json')
  writeFileSync(target, JSON.stringify(snapshot, null, 2) + '\n')
  console.log(`\nWritten to ${target}`)
}

async function measureOnce(browser, origin, caseName) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const client = await context.newCDPSession(page)
  await client.send('Performance.enable')

  // Without this a broken harness looks exactly like a slow one: the wait below
  // just times out and says nothing about why.
  const failures = []
  page.on('pageerror', (error) => failures.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(message.text())
  })
  page.on('requestfailed', (request) => {
    failures.push(`request failed: ${request.url()}`)
  })

  try {
    await page.goto(`${origin}/index.html?case=${caseName}`, { waitUntil: 'commit' })
    try {
      await page.waitForFunction(() => window.__bench?.timings != null, null, { timeout: 600_000 })
    } catch (error) {
      if (failures.length > 0) {
        throw new Error(`the harness failed before reporting:\n  ${failures.join('\n  ')}`, {
          cause: error,
        })
      }
      throw error
    }

    const timings = await page.evaluate(() => window.__bench.timings)
    const scroll = await page.evaluate(() => window.__bench.measureScroll())

    // Collect garbage first, so the number is what the page is holding rather
    // than what it has not got around to releasing.
    await client.send('HeapProfiler.collectGarbage')
    const metrics = await client.send('Performance.getMetrics')
    const metric = (name) => metrics.metrics.find((entry) => entry.name === name)?.value ?? 0

    return {
      ...timings,
      scroll,
      memoryMB: Math.round(metric('JSHeapUsedSize') / 1048576),
      domNodes: Math.round(metric('Nodes')),
    }
  } finally {
    await context.close()
  }
}

function report(results) {
  const line = '─'.repeat(104)
  console.log()
  console.log(line)
  console.log(
    pad('case', 30) +
      pad('lines', 9, true) +
      pad('parse', 9, true) +
      pad('render', 10, true) +
      pad('total', 10, true) +
      pad('blocked', 10, true) +
      pad('worst', 9, true) +
      pad('memory', 9, true) +
      pad('DOM', 10, true),
  )
  console.log(line)

  for (const entry of results) {
    console.log(
      pad(entry.label.slice(0, 29), 30) +
        pad(entry.lines.toLocaleString('en-US'), 9, true) +
        pad(`${entry.parseMs} ms`, 9, true) +
        pad(`${entry.renderMs} ms`, 10, true) +
        pad(`${entry.totalMs} ms`, 10, true) +
        pad(entry.scroll.blockingMeasurable ? `${entry.scroll.blockingMs} ms` : 'n/a', 10, true) +
        pad(entry.scroll.blockingMeasurable ? `${entry.scroll.worstBlockMs} ms` : 'n/a', 9, true) +
        pad(`${entry.memoryMB} MB`, 9, true) +
        pad(entry.domNodes.toLocaleString('en-US'), 10, true),
    )
  }
  console.log(line)
  console.log(
    'blocked / worst: main-thread blocking while scrolling. Frames per second is not ' +
      'reported — see bench/README.md for why a headless number there means nothing.',
  )
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

function pad(text, width, alignRight = false) {
  const value = String(text)
  return alignRight ? value.padStart(width) : value.padEnd(width)
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

function cpuName() {
  try {
    return execFileSync('node', ['-e', 'console.log(require("os").cpus()[0].model)'], {
      encoding: 'utf8',
    }).trim()
  } catch {
    return 'unknown'
  }
}

await run()
